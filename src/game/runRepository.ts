import { createDebugTrace } from './debugTrace';
import { attachLedger, compactRuntimeLedger, compactRuntimeStats, createRunLedger, ledgerForState, sessionForState } from './ledger';
import { normalizeGameState } from './engine';
import { createStats } from './telemetry';
import type { GameState, RunLedgerChunk, RunSession } from './types';
import type { RunHistoryV2Coverage, RunHistoryV2Event } from './runHistoryV2';

export type RunSlot = 'normal' | 'tutorial' | 'scenario';
export type PersistenceStatus =
  | { kind: 'loading' }
  | { kind: 'saved' }
  | { kind: 'unsaved'; message: string; partialHistory: boolean };

export interface StoredRunSession {
  session: RunSession;
  scenario?: unknown;
}

export interface RunRepository {
  load(slot: RunSlot): Promise<StoredRunSession | null>;
  commit(slot: RunSlot, session: RunSession, chunks: RunLedgerChunk[], scenario?: unknown): Promise<void>;
  remove(slot: RunSlot): Promise<void>;
  recentHistory(runId: string, limit?: number): Promise<RunHistoryV2Event[]>;
  readLedger(runId: string): Promise<{ actions: RunSession['ledger']['actions']; events: RunHistoryV2Event[] }>;
}

export const RUN_DATABASE_NAME = 'roll-call-runs';
export const RUN_DATABASE_VERSION = 1;
const SESSION_FORMAT_VERSION = 1;
const SESSION_STORE = 'sessions';
const LEDGER_STORE = 'ledgerChunks';
const RUN_INDEX = 'runId';

interface SessionRecord {
  slot: RunSlot;
  formatVersion: typeof SESSION_FORMAT_VERSION;
  runId: string;
  state: GameState;
  coverage: RunHistoryV2Coverage;
  committedActionId: number;
  committedHistorySeq: number;
  scenario?: unknown;
}

type StoredChunk = RunLedgerChunk & { key: [string, number] };

const requestValue = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
});

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
});

async function cleanupOrphanedChunks(database: IDBDatabase): Promise<void> {
  const read = database.transaction(SESSION_STORE, 'readonly');
  const readDone = transactionDone(read);
  const sessions = await requestValue(read.objectStore(SESSION_STORE).getAll()) as SessionRecord[];
  await readDone;
  const liveRunIds = new Set(sessions.map(record => record.runId));
  const transaction = database.transaction(LEDGER_STORE, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(LEDGER_STORE);
  const request = store.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const chunk = cursor.value as StoredChunk;
    if (!liveRunIds.has(chunk.runId)) cursor.delete();
    cursor.continue();
  };
  await done;
}

function compactCore(state: GameState): GameState {
  const compact = structuredClone(state) as GameState;
  compactRuntimeStats(compact);
  const empty = createStats(state.seed);
  compact.stats.busts = empty.busts;
  compact.stats.mapTransitions = empty.mapTransitions;
  compact.stats.lifeRestores = empty.lifeRestores;
  compact.stats.trainingPurchases = empty.trainingPurchases;
  compact.stats.flameAcquisitions = empty.flameAcquisitions;
  compact.stats.flameStokes = empty.flameStokes;
  compact.stats.handScores = empty.handScores;
  compact.stats.jumpingBeanFreePlays = empty.jumpingBeanFreePlays;
  compact.stats.loss = null;
  const trace = createDebugTrace('bounded');
  trace.critical = structuredClone(state.debugTrace.critical);
  compact.debugTrace = trace;
  return compact;
}

class IndexedDbRunRepository implements RunRepository {
  private database: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is unavailable.')); return; }
      const request = indexedDB.open(RUN_DATABASE_NAME, RUN_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SESSION_STORE))
          database.createObjectStore(SESSION_STORE, { keyPath: 'slot' });
        if (!database.objectStoreNames.contains(LEDGER_STORE)) {
          const chunks = database.createObjectStore(LEDGER_STORE, { keyPath: 'key' });
          chunks.createIndex(RUN_INDEX, 'runId', { unique: false });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        void cleanupOrphanedChunks(database).then(() => resolve(database), reject);
      };
      request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB.'));
    });
    return this.database;
  }

  private async chunks(runId: string): Promise<RunLedgerChunk[]> {
    const database = await this.open();
    const transaction = database.transaction(LEDGER_STORE, 'readonly');
    const done = transactionDone(transaction);
    const request = transaction.objectStore(LEDGER_STORE).index(RUN_INDEX).getAll(IDBKeyRange.only(runId));
    const stored = await requestValue(request) as StoredChunk[];
    await done;
    return stored.sort((a, b) => a.ordinal - b.ordinal).map(({ key: _key, ...chunk }) => chunk);
  }

  async load(slot: RunSlot): Promise<StoredRunSession | null> {
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, 'readonly');
    const done = transactionDone(transaction);
    const record = await requestValue(transaction.objectStore(SESSION_STORE).get(slot)) as SessionRecord | undefined;
    await done;
    if (!record || record.formatVersion !== SESSION_FORMAT_VERSION) return null;
    const chunks = await this.chunks(record.runId);
    const ledger = createRunLedger(record.state.seed, record.runId);
    ledger.coverage = { ...record.coverage };
    ledger.actions = chunks.flatMap(chunk => chunk.action ? [structuredClone(chunk.action)] : []);
    ledger.events = chunks.flatMap(chunk => structuredClone(chunk.events)).sort((a, b) => a.seq - b.seq);
    ledger.committedActionId = record.committedActionId;
    ledger.committedHistorySeq = record.committedHistorySeq;
    const raw = structuredClone(record.state);
    attachLedger(raw, ledger);
    const state = normalizeGameState(raw);
    const normalizedLedger = ledgerForState(state);
    normalizedLedger.committedActionId = record.committedActionId;
    normalizedLedger.committedHistorySeq = record.committedHistorySeq;
    compactRuntimeLedger(state);
    return { session: sessionForState(state), ...(record.scenario === undefined ? {} : { scenario: structuredClone(record.scenario) }) };
  }

  async commit(slot: RunSlot, session: RunSession, chunks: RunLedgerChunk[], scenario?: unknown): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction([SESSION_STORE, LEDGER_STORE], 'readwrite');
    const chunkStore = transaction.objectStore(LEDGER_STORE);
    const ledger = session.ledger;
    for (const chunk of chunks) chunkStore.put({ ...structuredClone(chunk), key: [chunk.runId, chunk.ordinal] } satisfies StoredChunk);
    const record: SessionRecord = {
      slot, formatVersion: SESSION_FORMAT_VERSION, runId: ledger.runId,
      state: compactCore(session.state), coverage: { ...ledger.coverage },
      committedActionId: session.state.nextActionId,
      committedHistorySeq: session.state.nextHistorySeq,
      ...(scenario === undefined ? {} : { scenario: structuredClone(scenario) }),
    };
    transaction.objectStore(SESSION_STORE).put(record);
    await transactionDone(transaction);
    ledger.committedActionId = record.committedActionId;
    ledger.committedHistorySeq = record.committedHistorySeq;
    await cleanupOrphanedChunks(database);
  }

  async remove(slot: RunSlot): Promise<void> {
    const database = await this.open();
    const read = database.transaction(SESSION_STORE, 'readonly');
    const readDone = transactionDone(read);
    const record = await requestValue(read.objectStore(SESSION_STORE).get(slot)) as SessionRecord | undefined;
    await readDone;
    const transaction = database.transaction([SESSION_STORE, LEDGER_STORE], 'readwrite');
    transaction.objectStore(SESSION_STORE).delete(slot);
    if (record) {
      const index = transaction.objectStore(LEDGER_STORE).index(RUN_INDEX);
      const request = index.openKeyCursor(IDBKeyRange.only(record.runId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        transaction.objectStore(LEDGER_STORE).delete(cursor.primaryKey);
        cursor.continue();
      };
    }
    await transactionDone(transaction);
  }

  async recentHistory(runId: string, limit = 200): Promise<RunHistoryV2Event[]> {
    const database = await this.open();
    const transaction = database.transaction(LEDGER_STORE, 'readonly');
    const done = transactionDone(transaction);
    const index = transaction.objectStore(LEDGER_STORE).index(RUN_INDEX);
    const request = index.openCursor(IDBKeyRange.only(runId), 'prev');
    const events: RunHistoryV2Event[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || events.length >= limit) return;
      const chunk = cursor.value as StoredChunk;
      events.unshift(...chunk.events.slice(Math.max(0, chunk.events.length - (limit - events.length))));
      cursor.continue();
    };
    await done;
    return events.sort((a, b) => a.seq - b.seq).slice(-limit);
  }

  async readLedger(runId: string) {
    const chunks = await this.chunks(runId);
    return {
      actions: chunks.flatMap(chunk => chunk.action ? [chunk.action] : []),
      events: chunks.flatMap(chunk => chunk.events).sort((a, b) => a.seq - b.seq),
    };
  }
}

let browserRepository: RunRepository | null = null;

export function browserRunRepository(): RunRepository {
  browserRepository ??= new IndexedDbRunRepository();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem('roll-call:active-run');
      window.localStorage.removeItem('roll-call:tutorial-run');
    } catch { /* Preferences can still work when legacy storage cleanup is unavailable. */ }
  }
  return browserRepository;
}

export class MemoryRunRepository implements RunRepository {
  readonly sessions = new Map<RunSlot, StoredRunSession>();
  readonly chunks = new Map<string, RunLedgerChunk[]>();
  failCommits = false;

  async load(slot: RunSlot) { return this.sessions.get(slot) ?? null; }
  async commit(slot: RunSlot, session: RunSession, chunks: RunLedgerChunk[], scenario?: unknown) {
    if (this.failCommits) throw new Error('Persistence failed.');
    const existing = this.chunks.get(session.ledger.runId) ?? [];
    for (const chunk of chunks) {
      const index = existing.findIndex(item => item.ordinal === chunk.ordinal);
      if (index >= 0) existing[index] = structuredClone(chunk); else existing.push(structuredClone(chunk));
    }
    existing.sort((a, b) => a.ordinal - b.ordinal);
    this.chunks.set(session.ledger.runId, existing);
    this.sessions.set(slot, { session, ...(scenario === undefined ? {} : { scenario }) });
    for (const runId of this.chunks.keys()) {
      if (![...this.sessions.values()].some(value => value.session.ledger.runId === runId)) this.chunks.delete(runId);
    }
    session.ledger.committedActionId = session.state.nextActionId;
    session.ledger.committedHistorySeq = session.state.nextHistorySeq;
  }
  async remove(slot: RunSlot) { this.sessions.delete(slot); }
  async recentHistory(runId: string, limit = 200) {
    return (this.chunks.get(runId) ?? []).flatMap(chunk => chunk.events).sort((a, b) => a.seq - b.seq).slice(-limit);
  }
  async readLedger(runId: string) {
    const chunks = this.chunks.get(runId) ?? [];
    return { actions: chunks.flatMap(chunk => chunk.action ? [chunk.action] : []),
      events: chunks.flatMap(chunk => chunk.events).sort((a, b) => a.seq - b.seq) };
  }
}
