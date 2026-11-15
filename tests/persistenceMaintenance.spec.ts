import { expect, test, type Page } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { RUN_DATABASE_NAME, RUN_DATABASE_VERSION } from '../src/game/runRepository';
import { clearRunDatabase, seedRunSession } from './uiHelpers';

async function openModulePage(page: Page) {
  await page.addInitScript(() => {
    const callbacks: IdleRequestCallback[] = [];
    const idle = {
      callbacks,
      run() {
        const pending = callbacks.splice(0);
        for (const callback of pending) callback({ didTimeout: false, timeRemaining: () => 50 });
        return pending.length;
      },
    };
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: (callback: IdleRequestCallback) => { callbacks.push(callback); return callbacks.length; },
    });
    Object.defineProperty(window, 'cancelIdleCallback', { configurable: true, value: () => undefined });
    (window as unknown as { __maintenanceIdle: typeof idle }).__maintenanceIdle = idle;
  });
  await page.goto('/@vite/client');
  await clearRunDatabase(page);
}

async function runIdle(page: Page) {
  return page.evaluate(() => (window as unknown as { __maintenanceIdle: { run(): number } }).__maintenanceIdle.run());
}

async function idleCount(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { __maintenanceIdle: { callbacks: IdleRequestCallback[] } }).__maintenanceIdle.callbacks.length);
}

async function addOrphanChunk(page: Page, runId: string) {
  await page.evaluate(async ({ databaseName, databaseVersion, runId }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('ledgerChunks', 'readwrite');
      transaction.objectStore('ledgerChunks').put({ key: [runId, 0], runId, ordinal: 0,
        actionId: null, action: null, events: [] });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  }, { databaseName: RUN_DATABASE_NAME, databaseVersion: RUN_DATABASE_VERSION, runId });
}

async function storedCounts(page: Page) {
  return page.evaluate(async ({ databaseName, databaseVersion }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise<{ sessions: number; runIds: string[] }>((resolve, reject) => {
      const transaction = database.transaction(['sessions', 'ledgerChunks'], 'readonly');
      const sessions = transaction.objectStore('sessions').count();
      const chunks = transaction.objectStore('ledgerChunks').getAll();
      transaction.oncomplete = () => resolve({ sessions: sessions.result,
        runIds: chunks.result.map(chunk => chunk.runId as string) });
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    return result;
  }, { databaseName: RUN_DATABASE_NAME, databaseVersion: RUN_DATABASE_VERSION });
}

test('an interrupted durable transaction publishes no partial session or ledger', async ({ page }) => {
  await openModulePage(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves this browser-only module path.
    const { IndexedDbRunRepository } = await import('/src/game/runRepository.ts');
    // @ts-expect-error Vite serves this browser-only module path.
    const { newRun } = await import('/src/game/engine.ts');
    const repository = new IndexedDbRunRepository();
    const resolution = newRun('interrupted-maintenance-save');
    const original = IDBDatabase.prototype.transaction;
    let aborted = false;
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const transaction = original.apply(this, args);
      const stores = Array.isArray(args[0]) ? args[0] : [args[0]];
      if (!aborted && args[1] === 'readwrite' && stores.includes('sessions') && stores.includes('ledgerChunks')) {
        aborted = true;
        queueMicrotask(() => transaction.abort());
      }
      return transaction;
    };
    let rejected = false;
    try { await repository.commit('normal', resolution.session, [resolution.ledgerChunk]); }
    catch { rejected = true; }
    finally { IDBDatabase.prototype.transaction = original; }
    return { rejected, committedActionId: resolution.session.ledger.committedActionId,
      committedHistorySeq: resolution.session.ledger.committedHistorySeq };
  });
  expect(result).toEqual({ rejected: true, committedActionId: 0, committedHistorySeq: 0 });
  expect(await storedCounts(page)).toEqual({ sessions: 0, runIds: [] });
});

test('cleanup failure is non-blocking and a later maintenance lifecycle removes abandoned chunks', async ({ page }) => {
  await openModulePage(page);
  const live = newRun('maintenance-live').state;
  await seedRunSession(page, live);
  await addOrphanChunk(page, 'abandoned-run');
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves this browser-only module path.
    const { IndexedDbRunRepository } = await import('/src/game/runRepository.ts');
    const repository = new IndexedDbRunRepository();
    await repository.load('normal');
    const original = IDBDatabase.prototype.transaction;
    let failed = false;
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const stores = Array.isArray(args[0]) ? args[0] : [args[0]];
      if (!failed && args[1] === 'readwrite' && stores.includes('sessions') && stores.includes('ledgerChunks')) {
        failed = true;
        throw new DOMException('Injected cleanup failure', 'AbortError');
      }
      return original.apply(this, args);
    };
    (window as unknown as { __restoreTransaction: () => void }).__restoreTransaction = () => {
      IDBDatabase.prototype.transaction = original;
    };
  });
  expect(await runIdle(page)).toBe(1);
  await page.waitForTimeout(25);
  await page.evaluate(() => (window as unknown as { __restoreTransaction: () => void }).__restoreTransaction());
  expect((await storedCounts(page)).runIds).toContain('abandoned-run');

  await page.evaluate(async () => {
    // @ts-expect-error Vite serves this browser-only module path.
    const { IndexedDbRunRepository } = await import('/src/game/runRepository.ts');
    await new IndexedDbRunRepository().load('normal');
  });
  expect(await runIdle(page)).toBe(1);
  await expect.poll(async () => (await storedCounts(page)).runIds).not.toContain('abandoned-run');
  expect((await storedCounts(page)).runIds.some(runId => runId.startsWith('maintenance-live:'))).toBe(true);
});

test('replacement maintenance is coalesced, preserves the new run, reloads, and deletes cleanly', async ({ page }) => {
  await openModulePage(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves these browser-only module paths.
    const { IndexedDbRunRepository } = await import('/src/game/runRepository.ts');
    // @ts-expect-error Vite serves these browser-only module paths.
    const { newRun } = await import('/src/game/engine.ts');
    const first = newRun('maintenance-first');
    const replacement = newRun('maintenance-replacement');
    const primary = new IndexedDbRunRepository();
    const competing = new IndexedDbRunRepository();
    await primary.commit('normal', first.session, [first.ledgerChunk]);
    await primary.commit('normal', replacement.session, [replacement.ledgerChunk]);
    await Promise.all([competing.load('tutorial'), primary.load('normal')]);
    return { firstRunId: first.session.ledger.runId, replacementRunId: replacement.session.ledger.runId };
  });

  expect(await idleCount(page)).toBe(1);
  const before = await storedCounts(page);
  expect(before.runIds).toContain(result.firstRunId);
  expect(before.runIds).toContain(result.replacementRunId);
  expect(await runIdle(page)).toBe(1);
  await expect.poll(async () => (await storedCounts(page)).runIds).not.toContain(result.firstRunId);
  expect((await storedCounts(page)).runIds).toContain(result.replacementRunId);

  const loadedSeed = await page.evaluate(async () => {
    // @ts-expect-error Vite serves this browser-only module path.
    const { IndexedDbRunRepository } = await import('/src/game/runRepository.ts');
    const repository = new IndexedDbRunRepository();
    const loaded = await repository.load('normal');
    await repository.remove('normal');
    return loaded?.session.state.seed;
  });
  expect(loadedSeed).toBe('maintenance-replacement');
  await expect.poll(async () => storedCounts(page)).toEqual({ sessions: 0, runIds: [] });
});
