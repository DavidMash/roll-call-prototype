import type { Page } from '@playwright/test';
import type { GameState } from '../src/game/types';
import { ledgerForState } from '../src/game/ledger';
import { RUN_DATABASE_NAME, RUN_DATABASE_VERSION } from '../src/game/runRepository';

export async function seedRunSession(page: Page, state: GameState, slot: 'normal' | 'tutorial' = 'normal', scenario?: unknown) {
  const ledger = ledgerForState(state);
  const firstRuntimeActionId = state.nextActionId - ledger.actions.length + 1;
  const actionById = new Map(ledger.actions.map((action, index) => [firstRuntimeActionId + index, action]));
  const grouped = new Map<number, typeof ledger.events>();
  for (const event of ledger.events) grouped.set(event.actionId,
    [...(grouped.get(event.actionId) ?? []), event]);
  const ordinals = new Set([0, ...grouped.keys(), ...actionById.keys()]);
  const chunks = [...ordinals].sort((a, b) => a - b).map(actionId => ({
    runId: ledger.runId, ordinal: actionId, actionId: actionId || null,
    action: actionId ? actionById.get(actionId) ?? null : null, events: grouped.get(actionId) ?? [],
  }));
  await page.evaluate(async ({ databaseName, databaseVersion, slot, state, runId, coverage, chunks, scenario }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'slot' });
        if (!db.objectStoreNames.contains('ledgerChunks')) {
          const store = db.createObjectStore('ledgerChunks', { keyPath: 'key' });
          store.createIndex('runId', 'runId');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['sessions', 'ledgerChunks'], 'readwrite');
      transaction.objectStore('sessions').put({ slot, formatVersion: 1, runId, state, coverage,
        committedActionId: state.nextActionId, committedHistorySeq: state.nextHistorySeq,
        ...(scenario === undefined ? {} : { scenario }) });
      for (const chunk of chunks) transaction.objectStore('ledgerChunks').put({ ...chunk, key: [runId, chunk.ordinal] });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }, { databaseName: RUN_DATABASE_NAME, databaseVersion: RUN_DATABASE_VERSION, slot, state,
    runId: ledger.runId, coverage: ledger.coverage, chunks, scenario });
}

export async function clearRunDatabase(page: Page): Promise<void> {
  await page.evaluate(async ({ databaseName, databaseVersion }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['sessions', 'ledgerChunks'], 'readwrite');
      transaction.objectStore('sessions').clear();
      transaction.objectStore('ledgerChunks').clear();
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  }, { databaseName: RUN_DATABASE_NAME, databaseVersion: RUN_DATABASE_VERSION });
}

export async function readRunState(page: Page, slot: 'normal' | 'tutorial' = 'normal'): Promise<GameState | null> {
  return page.evaluate(async ({ databaseName, databaseVersion, slot }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['sessions', 'ledgerChunks'], 'readonly');
      const request = transaction.objectStore('sessions').get(slot);
      request.onsuccess = () => {
        const record = request.result;
        if (!record) { database.close(); resolve(null); return; }
        const chunksRequest = transaction.objectStore('ledgerChunks').index('runId').getAll(IDBKeyRange.only(record.runId));
        chunksRequest.onsuccess = () => {
          const chunks = chunksRequest.result.sort((a, b) => a.ordinal - b.ordinal);
          database.close();
          resolve({ ...record.state,
            actionJournal: chunks.flatMap(chunk => chunk.action ? [chunk.action] : []),
            historyV2: chunks.flatMap(chunk => chunk.events).sort((a, b) => a.seq - b.seq), history: [] });
        };
        chunksRequest.onerror = () => reject(chunksRequest.error);
      };
      request.onerror = () => reject(request.error);
    });
  }, { databaseName: RUN_DATABASE_NAME, databaseVersion: RUN_DATABASE_VERSION, slot });
}

export async function installRunState(page: Page, state: GameState, speed: 'normal' | 'fast' | 'instant' = 'instant') {
  await page.goto('/');
  await seedRunSession(page, state);
  await page.goto(`/?seed=${encodeURIComponent(state.seed)}&speed=${speed}`);
}

export async function enterRun(page: Page) {
  const title = page.getByRole('heading', { name: 'ROLL CALL', exact: true });
  if (!await title.count()) return;
  const continueButton = page.getByRole('button', { name: /^Continue Chapter / });
  if (await continueButton.count()) await continueButton.click();
  else {
    const newRun = page.getByRole('button', { name: 'NEW RUN', exact: true });
    if (await newRun.count()) await newRun.click();
    else await page.getByRole('button', { name: 'SKIP TUTORIAL', exact: true }).click();
  }
  await title.waitFor({ state: 'detached' });
}

export async function openGameMenu(page: Page) {
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  return page.getByRole('dialog', { name: 'Menu' });
}

export async function setPlaybackSpeed(page: Page, speed: 'NORMAL' | 'FAST' | 'INSTANT') {
  const menu = await openGameMenu(page);
  await menu.getByText(speed, { exact: true }).click();
  await page.keyboard.press('Escape');
}

export async function setDiceDisplay(page: Page, display: 'NUMERALS' | 'PIPS') {
  const menu = await openGameMenu(page);
  await menu.getByText(display, { exact: true }).click();
  await page.keyboard.press('Escape');
}

export async function openMenuItem(page: Page, item: 'Run Info' | 'How to Play') {
  const menu = await openGameMenu(page);
  await menu.getByRole('button', { name: item, exact: true }).click();
}

export async function goToShopStage(page: Page, stage: 'shop' | 'forge' | 'train' | 'flames' | 'dice' | 'training') {
  const normalized = stage === 'dice' ? 'shop' : stage === 'training' ? 'train' : stage;
  let testId = `shop-stage-${normalized}`;
  let target = page.getByTestId(testId);
  if (!await target.count() && stage === 'flames') {
    testId = 'shop-stage-train';
    target = page.getByTestId(testId);
  }
  if (!await target.count()) return;
  if (await target.getAttribute('data-active') !== 'true') await target.click();
  await page.waitForFunction(id => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-active') === 'true', testId);
}
