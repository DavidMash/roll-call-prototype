import type { Action, GameState, RunLedgerChunk, RunLedgerRuntime, RunSession } from './types';
import type { RunHistoryV2Coverage, RunHistoryV2Event } from './runHistoryV2';

export const RECENT_HISTORY_LIMIT = 200;
const RUNTIME_ACTION_LIMIT = 200;
const ENGULFMENT_EVIDENCE_ROUNDS = 6;

const ledgerByState = new WeakMap<GameState, RunLedgerRuntime>();

const defaultCoverage = (): RunHistoryV2Coverage => ({
  complete: true, firstRound: 1, firstActionId: 0, firstSeq: 0,
});

export function createRunId(seed: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${seed}:${random}`;
}

export function createRunLedger(seed: string, runId = createRunId(seed)): RunLedgerRuntime {
  return { runId, actions: [], events: [], coverage: defaultCoverage(), committedActionId: 0, committedHistorySeq: 0 };
}

function runtimeFromLegacyState(state: GameState): RunLedgerRuntime {
  const actions = Array.isArray(state.actionJournal) ? state.actionJournal : [];
  const events = Array.isArray(state.historyV2) ? state.historyV2 : [];
  return {
    runId: createRunId(state.seed), actions, events,
    coverage: state.historyV2Coverage ?? defaultCoverage(),
    committedActionId: 0, committedHistorySeq: 0,
  };
}

export function ledgerForState(state: GameState): RunLedgerRuntime {
  return ledgerByState.get(state) ?? attachLedger(state, runtimeFromLegacyState(state));
}

/**
 * Keeps compatibility getters available to rules and tests without allowing the
 * append-only ledger to participate in structuredClone(GameState).
 */
export function attachLedger(state: GameState, ledger: RunLedgerRuntime): RunLedgerRuntime {
  for (const key of ['actionJournal', 'historyV2', 'history'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(state, key);
    if (descriptor?.configurable !== false) delete state[key];
  }
  Object.defineProperties(state, {
    actionJournal: { configurable: true, enumerable: false, get: () => ledger.actions },
    historyV2: { configurable: true, enumerable: false, get: () => ledger.events },
    history: { configurable: true, enumerable: false, get: () => [] },
  });
  state.historyV2Coverage = ledger.coverage;
  ledgerByState.set(state, ledger);
  return ledger;
}

export function cloneLedger(ledger: RunLedgerRuntime): RunLedgerRuntime {
  return {
    ...ledger,
    actions: [...ledger.actions], events: [...ledger.events], coverage: { ...ledger.coverage },
  };
}

export function cloneGameState(state: GameState): GameState {
  const ledger = cloneLedger(ledgerForState(state));
  const clone = structuredClone(state) as GameState;
  attachLedger(clone, ledger);
  return clone;
}

export function sessionForState(state: GameState): RunSession {
  return { state, ledger: ledgerForState(state) };
}

export function chunkForResolution(state: GameState, action: Action | null,
  actionId: number | null, eventStartSeq: number): RunLedgerChunk {
  const ledger = ledgerForState(state);
  const chunk = {
    runId: ledger.runId,
    ordinal: actionId ?? 0,
    actionId,
    action: action ? structuredClone(action) : null,
    events: structuredClone(ledger.events.filter(event => event.seq >= eventStartSeq)),
  };
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(chunk);
  return chunk;
}

export function recentHistory(state: GameState): RunHistoryV2Event[] {
  return ledgerForState(state).events.slice(-RECENT_HISTORY_LIMIT);
}

/**
 * Drops archive-only data after it has been durably committed. The retained
 * window contains the six latest canonical clear attempts, the active
 * rollback timeline, and the latest target-selection records used by Flames.
 */
export function compactRuntimeLedger(state: GameState): void {
  const ledger = ledgerForState(state);
  ledger.actions = ledger.actions.slice(-RUNTIME_ACTION_LIMIT);
  if (ledger.events.length > RECENT_HISTORY_LIMIT) {
    const clears = ledger.events.filter(event => event.kind === 'round_attempt_finished'
      && event.outcome === 'cleared').slice(-ENGULFMENT_EVIDENCE_ROUNDS);
    const attemptKeys = new Set(clears.map(event => `${event.timelineId}:${event.round}:${event.attempt}`));
    const rollbackRoundFloor = Math.max(1, state.round - 8);
    const latestUltimate = [...ledger.events].reverse().find(event => event.kind === 'ultimate_targets_changed')?.seq;
    const latestBench = [...ledger.events].reverse().find(event => event.kind === 'bench_warmer_target_changed')?.seq;
    const recentFrom = ledger.events.at(-RECENT_HISTORY_LIMIT)?.seq ?? 0;
    ledger.events = ledger.events.filter(event => event.seq >= recentFrom
      || event.round >= rollbackRoundFloor
      || attemptKeys.has(`${event.timelineId}:${event.round}:${event.attempt}`)
      || event.seq === latestUltimate || event.seq === latestBench);
  }

  compactRuntimeStats(state);
}

/** Detailed telemetry is already represented in V2 ledger events. */
export function compactRuntimeStats(state: GameState): void {
  // Keep only the active gameplay horizon needed by rules and tutorial gates.
  const currentAttempt = <T extends { round: number; attempt?: number }>(items: T[]) => items.filter(item =>
    item.round === state.round && (item.attempt === undefined || item.attempt === state.roundAttemptNumber));
  const activeRounds = currentAttempt(state.stats.rounds).slice(-1);
  state.stats.rounds = activeRounds.length ? activeRounds : state.stats.rounds.slice(-1);
  state.stats.busts = state.stats.busts.slice(-1);
  state.stats.mapTransitions = state.stats.mapTransitions.slice(-2);
  state.stats.bossEncounters = currentAttempt(state.stats.bossEncounters).slice(-1);
  state.stats.callerEvents = currentAttempt(state.stats.callerEvents);
  state.stats.wardenEvents = currentAttempt(state.stats.wardenEvents);
  state.stats.hexerEvents = currentAttempt(state.stats.hexerEvents);
  state.stats.lifeRestores = state.stats.lifeRestores.filter(item => item.round === state.round);
  state.stats.trainingPurchases = state.stats.trainingPurchases.filter(item => item.round === state.round);
  state.stats.flameAcquisitions = state.stats.flameAcquisitions.filter(item => item.round === state.round);
  state.stats.flameStokes = state.stats.flameStokes.filter(item => item.round === state.round);
  state.stats.hotStreakSkippedHands = state.stats.hotStreakSkippedHands.filter(item => item.round === state.round);
  state.stats.manualRerolls = state.stats.manualRerolls.filter(item => item.round === state.round);
  state.stats.temperTransactions = state.stats.temperTransactions.filter(item => item.round === state.round);
  state.stats.handScores = state.stats.handScores.filter(item => item.round === state.round);
  state.stats.jumpingBeanFreePlays = state.stats.jumpingBeanFreePlays.filter(item => item.round === state.round);
  state.stats.standaloneScores = state.stats.standaloneScores.filter(item => item.round === state.round);
}

/** Creates a short-lived export state backed by the complete archived ledger. */
export function stateWithLedger(state: GameState, actions: Action[], events: RunHistoryV2Event[]): GameState {
  const clone = structuredClone(state) as GameState;
  const current = ledgerForState(state);
  attachLedger(clone, { ...cloneLedger(current), actions, events });
  return clone;
}
