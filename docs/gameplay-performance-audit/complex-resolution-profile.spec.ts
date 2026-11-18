import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { dispatch, newRun } from '../../src/game/engine';
import { Resolver } from '../../src/game/effects';
import { placeFlameInstance } from '../../src/game/flames';
import { chunkForResolution, cloneGameState, ledgerForState } from '../../src/game/ledger';
import { MemoryRunRepository } from '../../src/game/runRepository';
import { stringifyExactJson } from '../../src/game/scoreMath';
import { createDieEffect, effectOf, effectRuntime, resetDieRoundState } from '../../src/game/specialDice';
import { rosterDice, syncActiveDiceProjection } from '../../src/game/inventory';
import type { Action, GameState, RandomSource, Rank, Resolution, SpecialDieType } from '../../src/game/types';
import { clearRunDatabase, readRunState, seedRunSession } from '../../tests/uiHelpers';

const output = (name: string) => resolve(process.cwd(), `docs/gameplay-performance-audit/${name}`);
const constant = (value = 0): RandomSource => ({ next: () => value });
const bytes = (value: unknown) => new TextEncoder().encode(stringifyExactJson(value)).byteLength;

interface Fixture { name: string; complexity: 'low' | 'medium' | 'high'; state: GameState; action: Action }

function base(seed: string, values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const state = newRun(seed, constant(.73)).state;
  state.target = 10n ** 30n;
  state.stats.rounds.at(-1)!.target = state.target;
  rosterDice(state).forEach((die, index) => { die.value = values[index] ?? values.at(-1)!; });
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  return state;
}

function setEffects(state: GameState, dieIndex: number, effects: Array<[SpecialDieType, number]>) {
  const die = rosterDice(state)[dieIndex];
  die.effects = effects.map(([type, level]) => createDieEffect(die.id, type, level));
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
}

function complexPlay(seed: string, boss = false): Fixture {
  const state = base(seed);
  for (let index = 0; index < 5; index++) setEffects(state, index,
    [['bonus', 5], ['golden', 3], ['workout', 3], ['doubleTime', boss ? 3 : 1]]);
  state.handLevels.largeStraight = 12;
  (['ultimate', 'momentum', 'heavyHitters', 'frankenstein', 'fatCat'] as const)
    .forEach((flame, slot) => placeFlameInstance(state, flame, 100, slot as 0 | 1 | 2 | 3 | 4));
  if (boss) state.boss = { type: 'juggler' };
  return { name: boss ? 'boss-juggler-multi-flame-play' : 'multi-flame-special-dice-play',
    complexity: boss ? 'high' : 'medium', state,
    action: { type: 'PLAY', hand: 'largeStraight', dieIds: rosterDice(state).map(die => die.id) } };
}

function curtainCall(): Fixture {
  const state = base('phase2-curtain', [5, 2, 3, 4, 6]);
  setEffects(state, 0, [['freePlay', 5], ['bonus', 5], ['furnace', 3], ['workout', 3],
    ['tank', 3], ['golden', 3], ['vintage', 3]]);
  const die = rosterDice(state)[0];
  effectRuntime(state.dieRoundState[die.id], effectOf(die, 'furnace'))!.furnacePips = 20;
  effectRuntime(state.dieRoundState[die.id], effectOf(die, 'workout'))!.temporaryPips = 15;
  effectRuntime(state.dieRoundState[die.id], effectOf(die, 'tank'))!.temporaryPips = 20;
  (['freeRealEstate', 'heavyHitters', 'frankenstein', 'fatCat', 'momentum'] as const)
    .forEach((flame, slot) => placeFlameInstance(state, flame, 100, slot as 0 | 1 | 2 | 3 | 4));
  return { name: 'curtain-call-free-play-reroll', complexity: 'medium', state,
    action: { type: 'MANUAL_REROLL', dieIds: [die.id] } };
}

function jumpingBeanChain(name: string, diceCount: number, level: number,
  complexity: Fixture['complexity']): Fixture {
  const state = base(`phase2-${name}`, [6, 6, 6, 6, 6]);
  for (let index = 0; index < diceCount; index++) {
    setEffects(state, index, [['jumpingBean', level], ['bonus', 5], ['golden', 3], ['workout', 3]]);
    const die = rosterDice(state)[index];
    die.faces.forEach(face => { face.rank = 1; });
    effectOf(die, 'jumpingBean')!.persistent.jumpingBeanNumber = 1;
  }
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  (['freeRealEstate', 'lowball', 'heavyHitters', 'frankenstein', 'fatCat'] as const)
    .forEach((flame, slot) => placeFlameInstance(state, flame, 100, slot as 0 | 1 | 2 | 3 | 4));
  const ids = rosterDice(state).slice(0, diceCount).map(die => die.id);
  return { name, complexity, state, action: { type: 'MANUAL_REROLL', dieIds: ids } };
}

function bossJuggler(): Fixture {
  const fixture = complexPlay('phase2-boss', true);
  fixture.name = 'boss-juggler-multi-flame-play';
  fixture.action = { type: 'PLAY', hand: 'ones', dieIds: [rosterDice(fixture.state)[0].id] };
  return fixture;
}

function fixtures(): Fixture[] {
  const low = base('phase2-low');
  const reroll = base('phase2-reroll');
  return [
    { name: 'simple-left-play', complexity: 'low', state: low,
      action: { type: 'PLAY', hand: 'ones', dieIds: [rosterDice(low)[0].id] } },
    { name: 'ordinary-manual-reroll', complexity: 'low', state: reroll,
      action: { type: 'MANUAL_REROLL', dieIds: [rosterDice(reroll)[0].id] } },
    complexPlay('phase2-complex'), curtainCall(),
    jumpingBeanChain('jumping-bean-40-event-chain', 1, 1, 'medium'),
    jumpingBeanChain('jumping-bean-200-event-chain', 1, 3, 'high'),
    jumpingBeanChain('jumping-bean-400-event-chain', 2, 3, 'high'),
    bossJuggler(),
  ];
}

type CloneCategory = 'gameState' | 'boardSnapshot' | 'ledgerEvents' | 'action' | 'other';
interface CloneSample { calls: Record<CloneCategory, number>; ms: Record<CloneCategory, number> }

function cloneCategory(value: unknown): CloneCategory {
  if (Array.isArray(value) && value.length && typeof value[0] === 'object' && value[0]
    && 'seq' in value[0] && 'kind' in value[0]) return 'ledgerEvents';
  if (!value || typeof value !== 'object') return 'other';
  if ('rngState' in value && 'stats' in value && 'diceInventory' in value) return 'gameState';
  if ('phase' in value && 'dice' in value && 'handLevels' in value && !('stats' in value)) return 'boardSnapshot';
  if ('type' in value && Object.keys(value).length < 8) return 'action';
  return 'other';
}

function emptyCloneSample(): CloneSample {
  return { calls: { gameState: 0, boardSnapshot: 0, ledgerEvents: 0, action: 0, other: 0 },
    ms: { gameState: 0, boardSnapshot: 0, ledgerEvents: 0, action: 0, other: 0 } };
}

function withCloneProbe<T>(run: () => T): { value: T; clones: CloneSample } {
  const original = globalThis.structuredClone;
  const clones = emptyCloneSample();
  globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
    const category = cloneCategory(value);
    const started = performance.now();
    const result = original(value, options);
    clones.ms[category] += performance.now() - started;
    clones.calls[category]++;
    return result;
  }) as typeof structuredClone;
  try { return { value: run(), clones }; }
  finally { globalThis.structuredClone = original; }
}

function applyResolverAction(resolver: Resolver, action: Action) {
  if (action.type === 'PLAY') resolver.play(action.hand, action.dieIds, 'manual', action.decisionMs ?? null);
  else if (action.type === 'MANUAL_REROLL') resolver.manualReroll(action.dieIds);
  else throw new Error(`Unsupported profile action ${action.type}`);
}

function directResolverProfile(fixture: Fixture, options: import('../../src/game/effects').ResolverOptions = {}) {
  const state = cloneGameState(fixture.state);
  const prototype = Resolver.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const originalEmit = prototype.emitRecord;
  const originalEmitV2 = prototype.emitV2;
  let emitDepth = 0; let emitMs = 0; let emitCalls = 0; let directV2Ms = 0; let directV2Calls = 0;
  prototype.emitRecord = function (...args: unknown[]) {
    const started = performance.now(); emitDepth++;
    try { return originalEmit.apply(this, args); }
    finally { emitDepth--; emitMs += performance.now() - started; emitCalls++; }
  };
  prototype.emitV2 = function (...args: unknown[]) {
    if (emitDepth) return originalEmitV2.apply(this, args);
    const started = performance.now();
    try { return originalEmitV2.apply(this, args); }
    finally { directV2Ms += performance.now() - started; directV2Calls++; }
  };
  try {
    const profiled = withCloneProbe(() => {
      const started = performance.now();
      const resolver = new Resolver(state, constant(0), options);
      applyResolverAction(resolver, fixture.action);
      return { totalMs: performance.now() - started, resolution: resolver };
    });
    return { totalMs: profiled.value.totalMs, playbackEvents: profiled.value.resolution.events.length,
      snapshotCounts: { ...profiled.value.resolution.snapshotCounts },
      emitMs, emitCalls, directV2Ms, directV2Calls, clones: profiled.clones };
  } finally {
    prototype.emitRecord = originalEmit;
    prototype.emitV2 = originalEmitV2;
  }
}

function snapshotStats(resolution: Resolution) {
  const started = performance.now();
  const serialized = resolution.events.map(event => stringifyExactJson(event.board));
  const serializationMs = performance.now() - started;
  const sizes = serialized.map(value => new TextEncoder().encode(value).byteLength);
  const unique = new Map<string, number>();
  serialized.forEach((value, index) => { if (!unique.has(value)) unique.set(value, sizes[index]); });
  let adjacentIdentical = 0;
  const adjacentIdenticalPairs: Record<string, number> = {};
  for (let index = 1; index < serialized.length; index++) if (serialized[index] === serialized[index - 1]) {
    adjacentIdentical++;
    const pair = `${resolution.events[index - 1].type} -> ${resolution.events[index].type}`;
    adjacentIdenticalPairs[pair] = (adjacentIdenticalPairs[pair] ?? 0) + 1;
  }
  return { snapshotCount: serialized.length, distinctSnapshotReferences: new Set(resolution.events.map(event => event.board)).size,
    snapshotBytes: sizes.reduce((sum, size) => sum + size, 0),
    uniqueSnapshotCount: unique.size, uniqueSnapshotBytes: [...unique.values()].reduce((sum, size) => sum + size, 0),
    adjacentIdentical, adjacentIdenticalPairs, serializationMs };
}

async function collectEngineRows(options: import('../../src/game/effects').ResolverOptions = {}) {
  const rows: unknown[] = [];
  for (const fixture of fixtures()) {
    for (let warmup = 0; warmup < 3; warmup++) dispatch(fixture.state, fixture.action, constant(0), options);
    const samples: unknown[] = [];
    for (let sample = 0; sample < 15; sample++) {
      const heapBefore = process.memoryUsage().heapUsed;
      const totalStarted = performance.now();
      const total = withCloneProbe(() => dispatch(fixture.state, fixture.action, constant(0), options));
      const dispatchMs = performance.now() - totalStarted;
      const heapAfterDispatch = process.memoryUsage().heapUsed;
      expect(total.value.error).toBeUndefined();

      const cloneStarted = performance.now(); cloneGameState(fixture.state); const stateCloneMs = performance.now() - cloneStarted;
      const direct = directResolverProfile(fixture, options);
      const firstSeq = total.value.ledgerChunk.events[0]?.seq ?? total.value.state.nextHistorySeq;
      const ledgerStarted = performance.now();
      const ledger = withCloneProbe(() => chunkForResolution(total.value.state, fixture.action,
        total.value.state.nextActionId, firstSeq));
      const ledgerMs = performance.now() - ledgerStarted;
      const serializeStarted = performance.now();
      const ledgerJson = stringifyExactJson(total.value.ledgerChunk);
      const ledgerSerializeMs = performance.now() - serializeStarted;
      const repository = new MemoryRunRepository();
      const persistenceStarted = performance.now();
      await repository.commit('normal', total.value.session, [total.value.ledgerChunk]);
      const memoryPersistenceMs = performance.now() - persistenceStarted;
      samples.push({ dispatchMs, stateCloneMs, direct, dispatchClones: total.clones,
        ledgerMs, ledgerClones: ledger.clones, ledgerSerializeMs, memoryPersistenceMs,
        ledgerBytes: new TextEncoder().encode(ledgerJson).byteLength,
        ledgerEventCount: total.value.ledgerChunk.events.length,
        heapDeltaBytes: heapAfterDispatch - heapBefore,
        ...snapshotStats(total.value) });
    }
    rows.push({ fixture: fixture.name, complexity: fixture.complexity, action: fixture.action.type, samples });
  }
  return rows;
}

test('profile complex engine resolution stages and snapshot duplication', async () => {
  const before = { generatedAt: new Date().toISOString(),
    notes: '15 samples per deterministic fixture using the legacy fresh-snapshot path. Direct Resolver timing excludes GameState clone and ledger chunk construction.',
    rows: await collectEngineRows({ disableSnapshotReuse: true }) };
  const after = { generatedAt: new Date().toISOString(),
    notes: '15 samples per deterministic fixture using audited snapshot reuse. Snapshot bytes serialize the public event shape and therefore include repeated content even when runtime Board references are shared.',
    rows: await collectEngineRows() };
  writeFileSync(output('phase2-snapshot-before.json'), `${JSON.stringify(before, null, 2)}\n`);
  writeFileSync(output('phase2-snapshot-after.json'), `${JSON.stringify(after, null, 2)}\n`);
  writeFileSync(output('phase2-engine-stages.json'), `${JSON.stringify(after, null, 2)}\n`);
});

async function seedArchivedChunks(page: Page, runId: string, count: number) {
  if (!count) return;
  await page.evaluate(async ({ runId, count }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('roll-call-runs', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('ledgerChunks', 'readwrite');
      const store = transaction.objectStore('ledgerChunks');
      for (let index = 0; index < count; index++) {
        const ordinal = 10_000 + index;
        store.put({ key: [runId, ordinal], runId, ordinal, actionId: ordinal, action: null, events: [] });
      }
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  }, { runId, count });
}

async function install(page: Page, state: GameState, viewport: { width: number; height: number }, archivedChunks = 0) {
  await page.setViewportSize(viewport);
  await page.goto('about:blank'); await page.goto('/');
  await clearRunDatabase(page); await seedRunSession(page, state);
  await seedArchivedChunks(page, ledgerForState(state).runId, archivedChunks);
  await page.goto(`/?seed=${encodeURIComponent(state.seed)}&speed=instant`);
  const title = page.getByRole('heading', { name: 'ROLL CALL', exact: true });
  if (await title.count()) {
    const continueButton = page.getByRole('button', { name: /^Continue Chapter / });
    await continueButton.waitFor({ state: 'visible' });
    await continueButton.evaluate(element => (element as HTMLElement).click());
    await title.waitFor({ state: 'hidden' });
  }
  await page.locator('main').waitFor();
  await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0);
}

async function prepareAction(page: Page, fixture: Fixture) {
  if (fixture.action.type === 'PLAY') {
    await page.getByTestId(`scorecard-row-${fixture.action.hand}`).click();
    return '[data-testid="play-action"]';
  }
  for (const id of fixture.action.dieIds) await page.getByTestId(`flame-die-${id}`).locator('.die').click();
  return '[data-testid="manual-reroll"]';
}

async function browserActionSample(page: Page, selector: string, expectedActionId: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.collectGarbage');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
  const before = await metrics();
  await page.evaluate(() => {
    type Audit = { active: boolean; started: number; syncEnd: number | null; firstMutation: number | null;
      firstPlaybackMutation: number | null;
      mutationTimes: number[]; transactions: Array<{ started: number; completed: number | null }>; longTasks: number[] };
    const audit: Audit = { active: true, started: performance.now(), syncEnd: null, firstMutation: null,
      firstPlaybackMutation: null, mutationTimes: [], transactions: [], longTasks: [] };
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const transaction = original.apply(this, args);
      if (audit.active && args[1] === 'readwrite') {
        const item = { started: performance.now() - audit.started, completed: null as number | null };
        audit.transactions.push(item);
        transaction.addEventListener('complete', () => { item.completed = performance.now() - audit.started; }, { once: true });
      }
      return transaction;
    };
    document.addEventListener('click', () => {
      if (!audit.active) return;
      queueMicrotask(() => { audit.syncEnd ??= performance.now() - audit.started; });
    }, { capture: true, once: true });
    const mutation = new MutationObserver(records => {
      audit.mutationTimes.push(performance.now() - audit.started);
      if (audit.active && audit.firstMutation === null) audit.firstMutation = performance.now() - audit.started;
      if (audit.active && audit.firstPlaybackMutation === null) {
        const eventMarkerAdded = records.some(record => [...record.addedNodes].some(node =>
          /EVENT \d+ \/ [1-9]\d*/.test(node.textContent ?? ''))
          || /EVENT \d+ \/ [1-9]\d*/.test(record.target.textContent ?? ''));
        if (eventMarkerAdded) audit.firstPlaybackMutation = performance.now() - audit.started;
      }
    });
    mutation.observe(document.body, { attributes: true, childList: true, subtree: true, characterData: true });
    const longTask = new PerformanceObserver(list => list.getEntries().forEach(entry => audit.longTasks.push(entry.duration)));
    try { longTask.observe({ type: 'longtask', buffered: false }); } catch { /* unsupported */ }
    (window as unknown as { __phase2Audit: Audit & { mutation: MutationObserver; longTask: PerformanceObserver } }).__phase2Audit
      = Object.assign(audit, { mutation, longTask });
  });
  const clickStarted = performance.now(); await page.locator(selector).click(); const clickRoundTripMs = performance.now() - clickStarted;
  await expect.poll(async () => (await readRunState(page))?.nextActionId, { timeout: 30_000 }).toBe(expectedActionId);
  await page.waitForTimeout(300);
  const audit = await page.evaluate(() => {
    const item = (window as unknown as { __phase2Audit: { active: boolean; started: number; syncEnd: number | null;
      firstMutation: number | null; firstPlaybackMutation: number | null;
      mutationTimes: number[];
      transactions: Array<{ started: number; completed: number | null }>;
      longTasks: number[]; mutation: MutationObserver; longTask: PerformanceObserver } }).__phase2Audit;
    item.active = false; item.mutation.disconnect(); item.longTask.disconnect();
    return { syncEnd: item.syncEnd, firstMutation: item.firstMutation,
      firstPlaybackMutation: item.firstPlaybackMutation, transactions: item.transactions,
      mutationTimes: item.mutationTimes, longTasks: item.longTasks };
  });
  const after = await metrics(); await cdp.send('HeapProfiler.collectGarbage'); const afterGc = await metrics(); await cdp.detach();
  const deltaMs = (name: string) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1000;
  return { clickRoundTripMs, ...audit, taskMs: deltaMs('TaskDuration'), scriptMs: deltaMs('ScriptDuration'),
    layoutMs: deltaMs('LayoutDuration'), styleMs: deltaMs('RecalcStyleDuration'),
    heapPeakDeltaBytes: (after.JSHeapUsedSize ?? 0) - (before.JSHeapUsedSize ?? 0),
    heapRetainedDeltaBytes: (afterGc.JSHeapUsedSize ?? 0) - (before.JSHeapUsedSize ?? 0) };
}

test('profile complex browser resolution, persistence, and publication', async ({ page }) => {
  const rows: unknown[] = [];
  const all = fixtures();
  for (const environment of [
    { name: 'desktop production', throttle: 1, viewport: { width: 1280, height: 900 } },
    { name: 'mobile 360x740, 4x CPU throttle', throttle: 4, viewport: { width: 360, height: 740 } },
  ]) {
    const throttle = await page.context().newCDPSession(page);
    await throttle.send('Emulation.setCPUThrottlingRate', { rate: environment.throttle });
    for (const fixture of all) {
      const samples = [];
      for (let sample = 0; sample < 5; sample++) {
        const state = cloneGameState(fixture.state); state.seed = `${fixture.state.seed}-browser-${environment.throttle}-${sample}`;
        await install(page, state, environment.viewport);
        const selector = await prepareAction(page, fixture);
        samples.push(await browserActionSample(page, selector, state.nextActionId + 1));
      }
      rows.push({ fixture: fixture.name, complexity: fixture.complexity, environment: environment.name, samples });
    }
    await throttle.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await throttle.detach();
  }
  writeFileSync(output('phase2-browser-stages.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(),
    notes: 'Five production-build samples per fixture/environment. Only read-write IndexedDB transactions are recorded relative to click capture. Optimized gameplay commits complete in one durable transaction; idle orphan maintenance is not awaited by publication. The first DOM mutation at or after durable completion is the publication bound.', rows }, null, 2)}\n`);
});

test('profile persistence publication with archived ledger chunks', async ({ page }) => {
  const rows: unknown[] = [];
  const fixture = fixtures().find(item => item.name === 'ordinary-manual-reroll')!;
  for (const environment of [
    { name: 'desktop production', throttle: 1, viewport: { width: 1280, height: 900 } },
    { name: 'mobile 360x740, 4x CPU throttle', throttle: 4, viewport: { width: 360, height: 740 } },
  ]) {
    const throttle = await page.context().newCDPSession(page);
    await throttle.send('Emulation.setCPUThrottlingRate', { rate: environment.throttle });
    for (const archivedChunks of [0, 200, 1_000]) {
      const samples = [];
      for (let sample = 0; sample < 5; sample++) {
        const state = cloneGameState(fixture.state);
        state.seed = `${fixture.state.seed}-archive-${archivedChunks}-${environment.throttle}-${sample}`;
        await install(page, state, environment.viewport, archivedChunks);
        const selector = await prepareAction(page, fixture);
        samples.push(await browserActionSample(page, selector, state.nextActionId + 1));
      }
      rows.push({ environment: environment.name, archivedChunks, samples });
    }
    await throttle.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await throttle.detach();
  }
  writeFileSync(output('phase2-persistence-scaling.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(),
    notes: 'Five production samples for an ordinary one-die Manual Reroll after loading 0, 200, or 1,000 empty archived chunks belonging to the active run. Setup/load time is excluded; publication remains gated by the active durable transaction only.', rows }, null, 2)}\n`);
});
