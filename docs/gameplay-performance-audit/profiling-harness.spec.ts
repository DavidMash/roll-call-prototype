import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { newRun, dispatch } from '../../src/game/engine';
import { activeEncounterDice } from '../../src/game/bosses';
import { handOptions, ultimateHands } from '../../src/game/hands';
import { attachLedger, createRunLedger } from '../../src/game/ledger';
import { placeFlameInstance } from '../../src/game/flames';
import { createDieEffect, resetDieRoundState } from '../../src/game/specialDice';
import { rosterDice, syncActiveDiceProjection } from '../../src/game/inventory';
import type { Action, GameState, RandomSource } from '../../src/game/types';
import { clearRunDatabase, readRunState, seedRunSession } from '../../tests/uiHelpers';

type Sample = {
  inputToFirstMutationMs: number | null;
  inputToFeedbackMs: number | null;
  inputToPlaybackMs: number | null;
  observationWindowMs: number;
  domMutations: number;
  longTasks: { startTime: number; duration: number }[];
  timedOut: boolean;
  taskMs?: number;
  scriptMs?: number;
  layoutMs?: number;
  styleMs?: number;
  layoutCount?: number;
  styleCount?: number;
  heapDeltaKb?: number;
};
type ResultRow = { interaction: string; environment: string; samples: Sample[] };

const outputPath = resolve(process.cwd(), 'docs/gameplay-performance-audit/measurements.json');
const results: ResultRow[] = [];
const constant = (value: number): RandomSource => ({ next: () => value });

function roundState(seed: string): GameState {
  const state = newRun(seed, constant(.37)).state;
  state.target = 1_000_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
  return state;
}

function flywheelState(seed: string): GameState {
  const state = roundState(seed);
  state.diceInventory.instances[0].effects = [createDieEffect(0, 'flywheel', 5)];
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  return state;
}

function lightningState(seed: string): GameState {
  const state = roundState(seed);
  placeFlameInstance(state, 'lightningStrike', 100);
  return state;
}

function complexPlayState(seed: string): GameState {
  const state = roundState(seed);
  const faces = [1, 2, 3, 4, 5] as const;
  rosterDice(state).forEach((die, index) => {
    die.value = faces[index];
    die.effects = [createDieEffect(die.id, 'bonus', 5), createDieEffect(die.id, 'golden', 3),
      createDieEffect(die.id, 'workout', 3)];
  });
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  state.handLevels.largeStraight = 12;
  (['ultimate', 'momentum', 'heavyHitters', 'frankenstein', 'fatCat'] as const)
    .forEach((flame, slot) => placeFlameInstance(state, flame, 100, slot as 0 | 1 | 2 | 3 | 4));
  return state;
}

function chainedRerollState(): { state: GameState; eventCount: number } {
  let best: { state: GameState; eventCount: number } | null = null;
  for (let attempt = 0; attempt < 250; attempt++) {
    const state = roundState(`audit-chain-${attempt}`);
    rosterDice(state).forEach(die => {
      die.effects = [createDieEffect(die.id, 'jumpingBean', 5), createDieEffect(die.id, 'bonus', 3)];
      die.effects[0].persistent.jumpingBeanNumber = 1;
    });
    syncActiveDiceProjection(state);
    state.dieRoundState = resetDieRoundState(rosterDice(state));
    const ids = [activeEncounterDice(state)[0].id];
    const probe = dispatch(state, { type: 'MANUAL_REROLL', dieIds: ids });
    const rolled = probe.events.filter(event => event.type === 'DIE_ROLLED' && event.dieIds?.length === 1);
    const firstById = new Map<number, number>();
    for (const event of rolled) if (event.dieIds?.[0] !== undefined && event.resultFace !== undefined
      && !firstById.has(event.dieIds[0])) firstById.set(event.dieIds[0], event.resultFace);
    for (const die of rosterDice(state)) {
      const predicted = firstById.get(die.id);
      if (predicted) die.effects[0].persistent.jumpingBeanNumber = predicted as 1 | 2 | 3 | 4 | 5 | 6;
    }
    state.dieRoundState = resetDieRoundState(rosterDice(state));
    const resolved = dispatch(state, { type: 'MANUAL_REROLL', dieIds: ids });
    if (!resolved.error && (!best || resolved.events.length > best.eventCount)) best = { state, eventCount: resolved.events.length };
  }
  if (!best) throw new Error('Unable to create chained reroll fixture.');
  return best;
}

function summaryAndShopState(): { summary: GameState; shop: GameState } {
  const state = roundState('audit-transition');
  state.target = 1n;
  state.stats.rounds.at(-1)!.target = state.target;
  const option = handOptions(activeEncounterDice(state), state.consumed).find(item => !item.consumed)!;
  const summary = dispatch(state, { type: 'PLAY', hand: option.id, dieIds: option.combinations[0] }).state;
  const shop = dispatch(summary, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
  return { summary, shop };
}

function withArchivedActions(state: GameState, actionCount: number): GameState {
  state.nextActionId = actionCount;
  const ledger = createRunLedger(state.seed);
  ledger.actions = Array.from({ length: actionCount }, () => ({ type: 'TOGGLE_ALL_IN' } as Action));
  attachLedger(state, ledger);
  return state;
}

async function install(page: Page, state: GameState, viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  // Unmount the previous app so it cannot retain an IndexedDB connection while
  // the next isolated fixture clears and reseeds the same origin.
  await page.goto('about:blank');
  await page.goto('/');
  await clearRunDatabase(page);
  await seedRunSession(page, state);
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

async function browserMetrics(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const read = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
  return { cdp, read };
}

async function measuredProcessingClick(page: Page, selector: string, settleMs = 75): Promise<Sample> {
  const metrics = await browserMetrics(page);
  const before = await metrics.read();
  const started = performance.now();
  await page.locator(selector).click();
  const clickReturnMs = performance.now() - started;
  await page.waitForTimeout(settleMs);
  const after = await metrics.read();
  await metrics.cdp.detach();
  const deltaMs = (name: string) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1000;
  return { inputToFirstMutationMs: null, inputToFeedbackMs: clickReturnMs, inputToPlaybackMs: null,
    observationWindowMs: clickReturnMs + settleMs, domMutations: 0, longTasks: [], timedOut: false,
    taskMs: deltaMs('TaskDuration'), scriptMs: deltaMs('ScriptDuration'),
    layoutMs: deltaMs('LayoutDuration'), styleMs: deltaMs('RecalcStyleDuration'),
    layoutCount: (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0),
    styleCount: (after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0),
    heapDeltaKb: ((after.JSHeapUsedSize ?? 0) - (before.JSHeapUsedSize ?? 0)) / 1024 };
}

async function measuredClick(page: Page, selector: string, mode: 'toggle' | 'action' | 'modal' | 'shop', timeoutMs = 8000): Promise<Sample> {
  const clickStarted = performance.now();
  await page.locator(selector).click();
  const clickReturnMs = performance.now() - clickStarted;
  // Give the authoritative IndexedDB commit and instant playback time to finish
  // before the next isolated fixture clears the database.
  await page.waitForTimeout(mode === 'action' ? 3_000 : 250);
  return { inputToFirstMutationMs: clickReturnMs, inputToFeedbackMs: clickReturnMs,
    inputToPlaybackMs: null, observationWindowMs: clickReturnMs, domMutations: 0,
    longTasks: clickReturnMs >= 50 ? [{ startTime: clickStarted, duration: clickReturnMs }] : [],
    timedOut: clickReturnMs > timeoutMs, taskMs: clickReturnMs, scriptMs: clickReturnMs };
}

async function measureSelectAll(page: Page): Promise<Sample> {
  const metrics = await browserMetrics(page);
  const before = await metrics.read();
  await page.evaluate(() => {
    const audit = { started: performance.now(), mutations: 0, first: null as number | null,
      longTasks: [] as { startTime: number; duration: number }[], mutation: null as MutationObserver | null,
      longTask: null as PerformanceObserver | null };
    audit.mutation = new MutationObserver(records => { audit.mutations += records.length; audit.first ??= performance.now() - audit.started; });
    audit.mutation.observe(document.body, { attributes: true, childList: true, subtree: true, characterData: true });
    audit.longTask = new PerformanceObserver(list => list.getEntries().forEach(entry => audit.longTasks.push({ startTime: entry.startTime, duration: entry.duration })));
    try { audit.longTask.observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
    (window as unknown as { __selectionAudit: typeof audit }).__selectionAudit = audit;
  });
  const dice = page.locator('.dice-row .die');
  const count = await dice.count();
  for (let index = 0; index < count; index++) {
    await dice.nth(index).evaluate(element => (element as HTMLElement).click());
    await page.waitForTimeout(0);
  }
  await page.waitForTimeout(25);
  const measured = await page.evaluate(() => {
    const audit = (window as unknown as { __selectionAudit: { started: number; mutations: number; first: number | null;
      longTasks: { startTime: number; duration: number }[]; mutation: MutationObserver; longTask: PerformanceObserver } }).__selectionAudit;
    const elapsed = performance.now() - audit.started;
    audit.mutation.disconnect(); audit.longTask.disconnect();
    return { inputToFirstMutationMs: audit.first, inputToFeedbackMs: elapsed, inputToPlaybackMs: null,
      observationWindowMs: elapsed, domMutations: audit.mutations, longTasks: audit.longTasks, timedOut: false };
  });
  const after = await metrics.read();
  await metrics.cdp.detach();
  const deltaMs = (name: string) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1000;
  return { ...measured, taskMs: deltaMs('TaskDuration'), scriptMs: deltaMs('ScriptDuration'),
    layoutMs: deltaMs('LayoutDuration'), styleMs: deltaMs('RecalcStyleDuration'),
    layoutCount: (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0),
    styleCount: (after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0),
    heapDeltaKb: ((after.JSHeapUsedSize ?? 0) - (before.JSHeapUsedSize ?? 0)) / 1024 };
}

async function addSamples(interaction: string, environment: string, count: number, run: (sample: number) => Promise<Sample>) {
  const samples: Sample[] = [];
  for (let sample = 0; sample < count; sample++) {
    process.stdout.write(`profiling: ${interaction} (${environment}) sample ${sample + 1}/${count}\n`);
    samples.push(await run(sample));
  }
  results.push({ interaction, environment, samples });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({ partial: true, results }, null, 2)}\n`);
  process.stdout.write(`profiled: ${interaction} (${environment})\n`);
}

async function selectedDie(page: Page, index = 0) {
  return `.dice-row [data-testid^="flame-die-"]:nth-child(${index + 1}) .die`;
}

test('collect Phase 1 focused optimization benchmark', async ({ page }) => {
  const phase = process.env.PERF_PHASE ?? 'current';
  const rows: ResultRow[] = [];
  const record = async (interaction: string, environment: string, count: number,
    run: (sample: number) => Promise<Sample>) => {
    const samples: Sample[] = [];
    for (let sample = 0; sample < count; sample++) {
      process.stdout.write(`phase1 ${phase}: ${interaction} (${environment}) ${sample + 1}/${count}\n`);
      samples.push(await run(sample));
    }
    rows.push({ interaction, environment, samples });
  };
  const firstDie = await selectedDie(page);

  await install(page, roundState(`phase1-${phase}-desktop-selection`));
  await record('select die', 'desktop production', 20, async () => {
    const sample = await measuredProcessingClick(page, firstDie);
    await page.locator(firstDie).click();
    return sample;
  });
  await record('deselect die', 'desktop production', 20, async () => {
    await page.locator(firstDie).click();
    return measuredProcessingClick(page, firstDie);
  });
  await record('select all five dice', 'desktop production', 15, async sample => {
    await install(page, roundState(`phase1-${phase}-all-${sample}`));
    return measureSelectAll(page);
  });
  await record('select die with complex Flames', 'desktop production', 15, async sample => {
    await install(page, complexPlayState(`phase1-${phase}-complex-select-${sample}`));
    return measuredProcessingClick(page, firstDie);
  });
  await record('select die with Speed Demon', 'desktop production', 15, async sample => {
    const state = roundState(`phase1-${phase}-speed-select-${sample}`);
    placeFlameInstance(state, 'speedDemon', 100);
    await install(page, state);
    return measuredProcessingClick(page, firstDie);
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await install(page, roundState(`phase1-${phase}-mobile-selection`), { width: 360, height: 740 });
  await record('select die', 'mobile 360x740, 4x CPU throttle', 15, async () => {
    const sample = await measuredProcessingClick(page, firstDie);
    await page.locator(firstDie).click();
    return sample;
  });
  await record('deselect die', 'mobile 360x740, 4x CPU throttle', 15, async () => {
    await page.locator(firstDie).click();
    return measuredProcessingClick(page, firstDie);
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.detach();

  const idleRows: unknown[] = [];
  for (const environment of ['desktop production', 'mobile 360x740, 4x CPU throttle']) {
    const throttle = environment.startsWith('mobile') ? 4 : 1;
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    for (let sample = 0; sample < 5; sample++) {
      const state = roundState(`phase1-${phase}-idle-${throttle}-${sample}`);
      placeFlameInstance(state, 'speedDemon', 100);
      await install(page, state, throttle === 4 ? { width: 360, height: 740 } : { width: 1280, height: 900 });
      const metrics = await browserMetrics(page); const before = await metrics.read();
      await page.waitForTimeout(2_000); const after = await metrics.read(); await metrics.cdp.detach();
      const deltaMs = (name: string) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1000;
      idleRows.push({ environment, sample, observationMs: 2_000, taskMs: deltaMs('TaskDuration'),
        scriptMs: deltaMs('ScriptDuration'), layoutMs: deltaMs('LayoutDuration'),
        styleMs: deltaMs('RecalcStyleDuration') });
    }
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await session.detach();
  }
  writeFileSync(resolve(process.cwd(), `docs/gameplay-performance-audit/phase1-${phase}.json`), `${JSON.stringify({
    generatedAt: new Date().toISOString(), phase, browser: await page.evaluate(() => navigator.userAgent),
    measurementNotes: 'inputToFeedbackMs is Playwright click round-trip; task/script/layout/style are Chrome process deltas over the click plus settle window.',
    rows, idleRows,
  }, null, 2)}\n`);
});

test('collect Phase 1 supporting interaction benchmark', async ({ page }) => {
  const phase = process.env.PERF_PHASE ?? 'current';
  const rows: ResultRow[] = [];
  const runEnvironment = async (environment: string, throttle: number, viewport: { width: number; height: number }) => {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const record = async (interaction: string, run: (sample: number) => Promise<Sample>) => {
      const samples: Sample[] = [];
      for (let sample = 0; sample < 5; sample++) samples.push(await run(sample));
      rows.push({ interaction, environment, samples });
    };
    const firstDie = await selectedDie(page);
    await record('normal manual reroll', async sample => {
      await install(page, roundState(`phase1-${phase}-${throttle}-reroll-${sample}`), viewport);
      await page.locator(firstDie).click();
      return measuredProcessingClick(page, '[data-testid="manual-reroll"]', 500);
    });
    await record('multi-Flame multi-effect Hand play', async sample => {
      await install(page, complexPlayState(`phase1-${phase}-${throttle}-play-${sample}`), viewport);
      await page.getByTestId('scorecard-row-largeStraight').click();
      return measuredProcessingClick(page, '[data-testid="play-action"]', 1_000);
    });
    await record('open Lightning Strike', async sample => {
      await install(page, lightningState(`phase1-${phase}-${throttle}-lightning-${sample}`), viewport);
      await page.locator(firstDie).click();
      return measuredProcessingClick(page, '[data-testid="manual-reroll"]', 250);
    });
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await session.detach();
  };
  await runEnvironment('desktop production', 1, { width: 1280, height: 900 });
  await runEnvironment('mobile 360x740, 4x CPU throttle', 4, { width: 360, height: 740 });
  writeFileSync(resolve(process.cwd(), `docs/gameplay-performance-audit/phase1-supporting-${phase}.json`), `${JSON.stringify({
    generatedAt: new Date().toISOString(), phase,
    measurementNotes: 'inputToFeedbackMs is Playwright click round-trip; Chrome metrics include the stated post-click settle window.',
    rows,
  }, null, 2)}\n`);
});

test('collect detailed selection profile', async ({ page }) => {
  await page.addInitScript(() => {
    type Fiber = { actualDuration?: number; flags?: number; child?: Fiber | null; sibling?: Fiber | null;
      elementType?: string | { displayName?: string; name?: string }; type?: string | { displayName?: string; name?: string } };
    const commits: unknown[] = [];
    let rendererId = 0;
    (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown; __reactAuditCommits: unknown[] }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(), inject: () => ++rendererId,
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
        const fibers: { name: string; actualDuration: number; flags: number }[] = [];
        const visit = (fiber: Fiber | null | undefined) => {
          if (!fiber) return;
          const candidate = fiber.elementType ?? fiber.type;
          const name = typeof candidate === 'string' ? candidate : candidate?.displayName ?? candidate?.name ?? 'Anonymous';
          const actualDuration = fiber.actualDuration ?? 0; const flags = fiber.flags ?? 0;
          if ((actualDuration > 0 || flags !== 0) && name !== 'Anonymous') fibers.push({ name, actualDuration, flags });
          visit(fiber.child); visit(fiber.sibling);
        };
        visit(root.current);
        commits.push({ at: performance.now(), rootDuration: root.current.actualDuration ?? 0,
          fibers: fibers.sort((a, b) => b.actualDuration - a.actualDuration).slice(0, 40) });
      }, onCommitFiberUnmount: () => {}, checkDCE: () => {}, supportsFlight: true,
    };
    (window as unknown as { __reactAuditCommits: unknown[] }).__reactAuditCommits = commits;
  });
  await install(page, roundState('audit-detailed-selection'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const read = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
  const before = await read();
  await page.evaluate(() => { (window as unknown as { __reactAuditCommits: unknown[] }).__reactAuditCommits.length = 0; });
  const started = performance.now();
  await page.locator(await selectedDie(page)).click();
  const clickReturnMs = performance.now() - started;
  await page.waitForTimeout(100);
  const after = await read();
  const commits = await page.evaluate(() => (window as unknown as { __reactAuditCommits: unknown[] }).__reactAuditCommits);
  const deltaMs = (name: string) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1000;
  const detailPhase = process.env.PERF_PHASE;
  const detailPath = detailPhase ? `phase1-selection-detail-${detailPhase}.json` : 'selection-detail.json';
  writeFileSync(resolve(process.cwd(), `docs/gameplay-performance-audit/${detailPath}`), `${JSON.stringify({
    clickReturnMs, taskMs: deltaMs('TaskDuration'), scriptMs: deltaMs('ScriptDuration'),
    layoutMs: deltaMs('LayoutDuration'), styleMs: deltaMs('RecalcStyleDuration'),
    layoutCount: (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0),
    styleCount: (after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0), commits,
  }, null, 2)}\n`);
  await cdp.detach();
});

test('collect chained automatic-effect profile', async ({ page }) => {
  const chained = chainedRerollState();
  const samples: Sample[] = [];
  for (let sample = 0; sample < 3; sample++) {
    const state = structuredClone(chained.state); state.seed = `audit-chain-browser-${sample}`;
    await install(page, state);
    await page.locator(await selectedDie(page)).click();
    samples.push(await measuredClick(page, '[data-testid="manual-reroll"]', 'action', 15_000));
  }
  writeFileSync(resolve(process.cwd(), 'docs/gameplay-performance-audit/chained-measurements.json'), `${JSON.stringify({
    interaction: 'Jumping Bean chained Free Plays and automatic rolls', playbackEventCount: chained.eventCount, samples,
  }, null, 2)}\n`);
});

test('collect durable persistence completion profile', async ({ page }) => {
  const rows: { archivedChunks: number; samples: { clickReturnMs: number; durableCompletionMs: number }[] }[] = [];
  for (const archivedChunks of [0, 200, 1000]) {
    const samples: { clickReturnMs: number; durableCompletionMs: number }[] = [];
    for (let sample = 0; sample < 3; sample++) {
      const state = withArchivedActions(roundState(`audit-persist-${archivedChunks}-${sample}`), archivedChunks);
      await install(page, state);
      await page.locator(await selectedDie(page)).click();
      const started = performance.now();
      await page.getByTestId('manual-reroll').click();
      const clickReturnMs = performance.now() - started;
      await expect.poll(async () => (await readRunState(page))?.nextActionId, { timeout: 20_000 }).toBe(archivedChunks + 1);
      samples.push({ clickReturnMs, durableCompletionMs: performance.now() - started });
    }
    rows.push({ archivedChunks, samples });
  }
  writeFileSync(resolve(process.cwd(), 'docs/gameplay-performance-audit/persistence-measurements.json'), `${JSON.stringify({ rows }, null, 2)}\n`);
});

test('collect idle animation timer profile', async ({ page }) => {
  const rows: unknown[] = [];
  for (const speedDemon of [false, true]) {
    const state = roundState(`audit-idle-${speedDemon ? 'speed-demon' : 'baseline'}`);
    if (speedDemon) placeFlameInstance(state, 'speedDemon', 100);
    await install(page, state);
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const read = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
    const before = await read(); await page.waitForTimeout(2_000); const after = await read(); await cdp.detach();
    const deltaMs = (name: string) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1000;
    rows.push({ speedDemon, observationMs: 2_000, taskMs: deltaMs('TaskDuration'), scriptMs: deltaMs('ScriptDuration'),
      layoutMs: deltaMs('LayoutDuration'), styleMs: deltaMs('RecalcStyleDuration'),
      layoutCount: (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0),
      styleCount: (after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0) });
  }
  writeFileSync(resolve(process.cwd(), 'docs/gameplay-performance-audit/idle-animation-measurements.json'), `${JSON.stringify({ rows }, null, 2)}\n`);
});

test('collect repeated modal memory profile', async ({ page }) => {
  const state = summaryAndShopState().shop; state.seed = 'audit-modal-memory';
  await install(page, state);
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  const heap = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value])).JSHeapUsedSize;
  await cdp.send('HeapProfiler.collectGarbage'); const snapshots = [{ cycles: 0, heapBytes: await heap() }];
  const started = performance.now();
  for (let batch = 1; batch <= 2; batch++) {
    for (let iteration = 0; iteration < 30; iteration++) {
      await page.getByTestId('collection-slot-roster-0').getByRole('button', { name: 'INFO' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'CLOSE' }).click();
    }
    await cdp.send('HeapProfiler.collectGarbage'); snapshots.push({ cycles: batch * 30, heapBytes: await heap() });
  }
  await cdp.detach();
  writeFileSync(resolve(process.cwd(), 'docs/gameplay-performance-audit/modal-memory-measurements.json'), `${JSON.stringify({
    cycles: 60, elapsedMs: performance.now() - started, snapshots,
  }, null, 2)}\n`);
});

test('collect production gameplay performance samples', async ({ page }) => {
  await install(page, roundState('audit-selection'));
  const firstDie = await selectedDie(page);
  await addSamples('select die', 'desktop production', 3, async () => measuredClick(page, firstDie, 'toggle'));
  await addSamples('deselect die', 'desktop production', 3, async () => measuredClick(page, firstDie, 'toggle'));

  await addSamples('normal manual reroll', 'desktop production', 3, async sample => {
    await install(page, roundState(`audit-reroll-${sample}`));
    await page.locator(firstDie).click();
    return measuredClick(page, '[data-testid="manual-reroll"]', 'action');
  });
  await addSamples('Flywheel-assisted reroll', 'desktop production', 3, async sample => {
    await install(page, flywheelState(`audit-flywheel-${sample}`));
    await page.locator(firstDie).click();
    return measuredClick(page, '[data-testid="manual-reroll"]', 'action');
  });

  await addSamples('open Lightning Strike', 'desktop production', 3, async sample => {
    await install(page, lightningState(`audit-lightning-open-${sample}`));
    await page.locator(firstDie).click();
    return measuredClick(page, '[data-testid="manual-reroll"]', 'modal');
  });
  await addSamples('confirm Lightning Strike', 'desktop production', 3, async sample => {
    await install(page, lightningState(`audit-lightning-confirm-${sample}`));
    await page.locator(firstDie).click();
    await page.getByTestId('manual-reroll').click();
    await page.getByTestId('confirm-lightning-strike').waitFor();
    return measuredClick(page, '[data-testid="confirm-lightning-strike"]', 'action');
  });

  await addSamples('normal Hand play', 'desktop production', 3, async sample => {
    const state = roundState(`audit-play-${sample}`);
    await install(page, state);
    const option = handOptions(activeEncounterDice(state), state.consumed).find(item => !item.consumed)!;
    await page.getByTestId(`scorecard-row-${option.id}`).click();
    return measuredClick(page, '[data-testid="play-action"]', 'action');
  });
  await addSamples('multi-Flame multi-effect Hand play', 'desktop production', 3, async sample => {
    const state = complexPlayState(`audit-complex-${sample}`);
    await install(page, state);
    await page.getByTestId('scorecard-row-largeStraight').click();
    return measuredClick(page, '[data-testid="play-action"]', 'action', 12_000);
  });

  const transition = summaryAndShopState();
  await addSamples('Round Summary to Shop', 'desktop production', 3, async sample => {
    const state = structuredClone(transition.summary); state.seed = `audit-summary-${sample}`;
    await install(page, state);
    return measuredClick(page, '[data-testid="run-action-row"] button', 'shop');
  });
  await addSamples('Shop stage navigation', 'desktop production', 3, async sample => {
    const state = structuredClone(transition.shop); state.seed = `audit-shop-${sample}`;
    await install(page, state);
    return measuredClick(page, '[data-testid="shop-stage-train"]', 'shop');
  });
  await addSamples('open Shop die management', 'desktop production', 3, async sample => {
    const state = structuredClone(transition.shop); state.seed = `audit-shop-modal-${sample}`;
    await install(page, state);
    return measuredClick(page, '[data-testid="collection-slot-roster-0"] .collection-slot-main', 'modal');
  });

  for (const archived of [0, 200, 1000]) {
    await addSamples('manual reroll after archived actions', `${archived} IndexedDB ledger chunks`, 3, async sample => {
      const state = withArchivedActions(roundState(`audit-history-${archived}-${sample}`), archived);
      await install(page, state);
      await page.locator(firstDie).click();
      return measuredClick(page, '[data-testid="manual-reroll"]', 'action', 12_000);
    });
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await addSamples('select die', 'mobile 360x740, 4x CPU throttle', 3, async sample => {
    await install(page, roundState(`audit-mobile-select-${sample}`), { width: 360, height: 740 });
    return measuredClick(page, firstDie, 'toggle');
  });
  await addSamples('normal manual reroll', 'mobile 360x740, 4x CPU throttle', 3, async sample => {
    await install(page, roundState(`audit-mobile-reroll-${sample}`), { width: 360, height: 740 });
    await page.locator(firstDie).click();
    return measuredClick(page, '[data-testid="manual-reroll"]', 'action', 15_000);
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.detach();

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), browser: await page.evaluate(() => navigator.userAgent), results }, null, 2)}\n`);
});
