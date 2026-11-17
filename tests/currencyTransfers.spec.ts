import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { placeFlameInstance } from '../src/game/flames';
import { rosterDice, syncActiveDiceProjection } from '../src/game/inventory';
import { createDieEffect, resetDieRoundState } from '../src/game/specialDice';
import type { GameState } from '../src/game/types';
import { enterRun, installRunState, readRunState } from './uiHelpers';

interface TransferTrace {
  gold: number[];
  temper: number[];
  particles: { currency: string; direction: string; source: string }[];
}

async function installTrace(page: Page) {
  await page.evaluate(() => {
    const trace = { gold: [] as number[], temper: [] as number[], particles: [] as { currency: string; direction: string; source: string }[] };
    const value = (currency: 'gold' | 'temper') => Number(document.querySelector(`[data-testid="stat-${currency}"] .currency-value`)?.textContent ?? 0);
    const record = () => {
      const gold = value('gold'); const temper = value('temper');
      if (trace.gold.at(-1) !== gold) trace.gold.push(gold);
      if (trace.temper.at(-1) !== temper) trace.temper.push(temper);
    };
    record();
    const counters = new MutationObserver(record);
    counters.observe(document.querySelector('[data-testid="stat-gold"]')!, { childList: true, subtree: true, characterData: true });
    counters.observe(document.querySelector('[data-testid="stat-temper"]')!, { childList: true, subtree: true, characterData: true });
    const particles = new MutationObserver(records => records.forEach(entry => entry.addedNodes.forEach(node => {
      if (!(node instanceof HTMLElement) || !node.matches('[data-testid="currency-particle"]')) return;
      trace.particles.push({ currency: node.dataset.currency ?? '', direction: node.dataset.direction ?? '', source: node.dataset.source ?? '' });
    })));
    particles.observe(document.querySelector('[data-testid="currency-transfer-layer"]')!, { childList: true });
    (window as unknown as { currencyTrace: TransferTrace }).currencyTrace = trace;
  });
}

async function trace(page: Page): Promise<TransferTrace> {
  return page.evaluate(() => (window as unknown as { currencyTrace: TransferTrace }).currencyTrace);
}

async function waitForParticles(page: Page, count: number) {
  await expect.poll(async () => (await trace(page)).particles.length).toBe(count);
  await expect(page.getByTestId('currency-particle')).toHaveCount(0);
}

function flameShop(seed: string, investedGold: number, gold: number): { state: GameState; instanceId: number } {
  const state = newRun(seed).state;
  state.gold = gold;
  const flame = placeFlameInstance(state, 'doubleDown', investedGold, 0);
  state.phase = 'shop';
  state.shop = { visitId: 1, stage: 'flames', offers: [], offerRerolls: 0, lifeRestores: 0 };
  state.nextShopVisitId = 2;
  return { state, instanceId: flame.instanceId };
}

test('1G keyboard Stoke and 5G final Stoke tick per unit and preserve cost/reward directions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let setup = flameShop('currency-stoke-one', 90, 10);
  await installRunState(page, setup.state); await enterRun(page); await installTrace(page);
  const one = page.getByTestId(`stoke-flame-${setup.instanceId}-1`);
  const center = await one.boundingBox();
  await one.focus(); await page.keyboard.press('Enter');
  await expect.poll(async () => (await trace(page)).particles.length).toBe(1);
  const particle = page.getByTestId('currency-particle');
  const destination = await particle.evaluate(element => ({
    x: Number(element.getAttribute('style')?.match(/--currency-to-x:\s*([\d.]+)px/)?.[1]),
    y: Number(element.getAttribute('style')?.match(/--currency-to-y:\s*([\d.]+)px/)?.[1]),
  }));
  expect(Math.abs(destination.x - (center!.x + center!.width / 2))).toBeLessThan(2);
  expect(Math.abs(destination.y - (center!.y + center!.height / 2))).toBeLessThan(2);
  await expect(particle).toHaveCount(0);
  let recorded = await trace(page);
  expect(recorded.gold).toEqual([10, 9]);
  expect(recorded.particles).toEqual([{ currency: 'gold', direction: 'spend', source: 'flameInvestment' }]);

  setup = flameShop('currency-stoke-final', 95, 5);
  await installRunState(page, setup.state); await enterRun(page); await installTrace(page);
  const right = page.getByTestId(`stoke-flame-${setup.instanceId}-right`);
  await right.click({ position: { x: 8, y: 8 } });
  await waitForParticles(page, 15);
  recorded = await trace(page);
  expect(recorded.gold).toEqual([5, 4, 3, 2, 1, 0]);
  expect(recorded.temper).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(recorded.particles.filter(item => item.currency === 'gold' && item.direction === 'spend')).toHaveLength(5);
  expect(recorded.particles.filter(item => item.currency === 'temper' && item.direction === 'gain' && item.source === 'bonfire')).toHaveLength(10);
  const saved = (await readRunState(page))!;
  expect(saved.gold).toBe(0); expect(saved.temper).toBe(10);
  expect(saved.actionJournal.filter(action => action.type === 'STOKE_FLAME')).toHaveLength(1);
});

test('Forge Temper spend animates once and an unaffordable Stoke emits nothing', async ({ page }) => {
  const state = newRun('currency-forge').state;
  state.phase = 'shop'; state.temper = 10; state.forgeUnlocked = true;
  state.shop = { visitId: 1, stage: 'forge', offers: [], offerRerolls: 0, lifeRestores: 0,
    forgeSelection: { dieAId: 0, dieBId: 1 } };
  await installRunState(page, state); await enterRun(page); await installTrace(page);
  const forge = page.getByRole('button', { name: /Forge for \d+ Temper$/ });
  const label = await forge.getAttribute('aria-label') ?? await forge.locator('[aria-label]').getAttribute('aria-label');
  const cost = Number(label?.match(/(\d+) Temper/)?.[1]);
  await forge.click();
  await waitForParticles(page, cost);
  let recorded = await trace(page);
  expect(recorded.temper).toEqual(Array.from({ length: cost + 1 }, (_, index) => 10 - index));
  expect(recorded.particles.every(item => item.currency === 'temper' && item.direction === 'spend')).toBe(true);

  const poor = flameShop('currency-unaffordable', 96, 3);
  await installRunState(page, poor.state); await enterRun(page); await installTrace(page);
  const disabled = page.getByTestId(`stoke-flame-${poor.instanceId}-right`);
  await expect(disabled).toBeDisabled();
  await disabled.evaluate(element => (element as HTMLButtonElement).click());
  await page.waitForTimeout(500);
  recorded = await trace(page);
  expect(recorded.particles).toHaveLength(0);
  expect(recorded.gold).toEqual([3]);
});

test('a portal confirmation uses its clicked control as the Gold destination', async ({ page }) => {
  const state = newRun('currency-portal-confirmation').state;
  state.phase = 'shop'; state.gold = 100; state.lives = state.infernoRewards.upgrades.maxLives - 1;
  state.shop = { visitId: 1, stage: 'shop', offers: [], offerRerolls: 0, lifeRestores: 0 };
  await installRunState(page, state); await enterRun(page); await installTrace(page);
  await page.getByTestId('stat-lives').click();
  const restore = page.getByRole('button', { name: /Restore life for \d+ Gold/ });
  const label = await restore.getAttribute('aria-label') ?? await restore.locator('[aria-label]').getAttribute('aria-label');
  const cost = Number(label?.match(/(\d+) Gold/)?.[1]);
  await restore.click();
  await waitForParticles(page, cost);
  const recorded = await trace(page);
  expect(recorded.particles).toHaveLength(cost);
  expect(recorded.particles.every(item => item.currency === 'gold' && item.direction === 'spend'
    && item.source === 'lifeRestore')).toBe(true);
});

test('shop-tab cancellation clears queued spend particles and prevents delayed ticks', async ({ page }) => {
  const setup = flameShop('currency-tab-cancel', 90, 20);
  await installRunState(page, setup.state); await enterRun(page); await installTrace(page);
  await page.getByTestId(`stoke-flame-${setup.instanceId}-right`).click();
  await expect(page.getByTestId('stat-gold')).toHaveAttribute('aria-label', 'Gold 15');
  await expect.poll(async () => (await trace(page)).particles.length).toBeGreaterThan(0);
  await page.getByTestId('shop-stage-shop').click();
  await expect(page.getByTestId('currency-particle')).toHaveCount(0);
  await expect(page.getByTestId('stat-gold')).toHaveText('Gold15G');
  const afterCancel = (await trace(page)).gold;
  await page.waitForTimeout(1000);
  expect((await trace(page)).gold).toEqual(afterCancel);
  await expect(page.getByTestId('stat-gold')).toHaveText('Gold15G');
});

test('reduced motion reconciles a Stoke immediately without decorative particles', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const setup = flameShop('currency-reduced-motion', 90, 10);
  await installRunState(page, setup.state); await enterRun(page); await installTrace(page);
  await page.getByTestId(`stoke-flame-${setup.instanceId}-right`).click();
  await expect(page.getByTestId('stat-gold')).toHaveText('Gold5G');
  await expect(page.getByTestId('currency-particle')).toHaveCount(0);
  expect((await trace(page)).particles).toHaveLength(0);
});

test('Great Fairy Gold launches from its visible offer and lands before automatic progression', async ({ page }) => {
  const state = newRun('currency-great-fairy').state;
  state.round = 3; state.phase = 'specialOffer'; state.shop = null; state.flameSelection = null; state.roundSummary = null;
  state.gold = 2; state.lives = state.infernoRewards.upgrades.maxLives;
  state.specialOffer = { offers: [{ id: 91, type: 'greatFairy' }], acquired: false };
  await installRunState(page, state); await enterRun(page); await installTrace(page);
  await page.getByRole('button', { name: 'CHOOSE', exact: true }).click();
  await waitForParticles(page, 15);
  const recorded = await trace(page);
  expect(recorded.gold).toEqual(Array.from({ length: 16 }, (_, index) => 2 + index));
  expect(recorded.particles.every(item => item.currency === 'gold' && item.direction === 'gain' && item.source === 'specialOffer')).toBe(true);
  await expect.poll(async () => (await readRunState(page))?.gold).toBe(17);
});

function scoringRewardState(seed: string, effect: 'golden' | 'jackpot', effectCount = 1,
  target = 100_000n): { state: GameState; dieIds: number[] } {
  const state = newRun(seed, { next: () => .99 }).state;
  state.target = target; state.stats.rounds[0].target = target; state.gold = 4;
  state.dice.forEach(die => { die.value = 6; });
  const dice = rosterDice(state).slice(0, effectCount);
  for (const die of dice) die.effects = [createDieEffect(die.id, effect)];
  syncActiveDiceProjection(state); state.dieRoundState = resetDieRoundState(rosterDice(state));
  return { state, dieIds: dice.map(die => die.id) };
}

async function playScoringRow(page: Page, row: 'sixes') {
  await page.getByTestId(`scorecard-row-${row}`).click();
  await page.getByTestId('play-action').click();
}

test('Golden rewards fly from the scoring die and tick the header on each landing', async ({ page }) => {
  const { state, dieIds } = scoringRewardState('currency-golden-immediate', 'golden', 2);
  await installRunState(page, state); await enterRun(page); await installTrace(page);
  const dieBounds = await Promise.all(dieIds.map(dieId => page.locator(`[data-die-id="${dieId}"]`).boundingBox()));
  await playScoringRow(page, 'sixes');
  await expect(page.getByTestId('stat-gold')).toHaveAttribute('aria-label', 'Gold 6');
  await expect.poll(async () => (await trace(page)).particles.length).toBe(2);
  const particles = page.getByTestId('currency-particle');
  const origins = await particles.evaluateAll(elements => elements.map(element => ({
    x: Number(element.getAttribute('style')?.match(/--currency-from-x:\s*([\d.]+)px/)?.[1]),
    y: Number(element.getAttribute('style')?.match(/--currency-from-y:\s*([\d.]+)px/)?.[1]),
  })));
  for (let index = 0; index < origins.length; index++) {
    expect(Math.abs(origins[index].x - (dieBounds[index]!.x + dieBounds[index]!.width / 2))).toBeLessThan(2);
    expect(Math.abs(origins[index].y - (dieBounds[index]!.y + dieBounds[index]!.height / 2))).toBeLessThan(2);
  }
  await expect(page.getByTestId('stat-gold')).toHaveText('Gold4G');
  await expect(particles).toHaveCount(0);
  await waitForParticles(page, 2);
  const recorded = await trace(page);
  expect(recorded.gold).toEqual([4, 5, 6]);
  expect(recorded.particles).toEqual([
    { currency: 'gold', direction: 'gain', source: 'golden' },
    { currency: 'gold', direction: 'gain', source: 'golden' },
  ]);
  expect((await readRunState(page))!.gold).toBe(6);
});

function payoutState(priorRoundSpend = false): GameState {
  const state = newRun('currency-round-payout', { next: () => .99 }).state;
  state.target = 1n; state.stats.rounds[0].target = 1n;
  state.gold = priorRoundSpend ? 7 : 4; state.stats.rounds[0].goldBefore = priorRoundSpend ? 10 : 4;
  state.stats.rounds[0].goldBySourceBefore = structuredClone(state.stats.goldBySource);
  state.dice.forEach(die => { die.value = 6; });
  rosterDice(state)[0].effects = [createDieEffect(rosterDice(state)[0].id, 'golden')];
  rosterDice(state)[1].effects = [createDieEffect(rosterDice(state)[1].id, 'jackpot')];
  syncActiveDiceProjection(state); state.dieRoundState = resetDieRoundState(rosterDice(state));
  return state;
}

async function playPayout(page: Page) {
  await page.getByTestId('scorecard-row-sixes').click();
  await page.getByTestId('play-action').click();
  await expect(page.getByTestId('round-summary')).toBeVisible();
}

test('round summary is static and immediately reconciles Gold and Temper', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await installRunState(page, payoutState(true)); await enterRun(page); await installTrace(page);
  await playPayout(page);
  const saved = (await readRunState(page))!;
  await expect(page.getByTestId('currency-particle')).toHaveCount(0);
  await expect(page.getByTestId('stat-gold')).toHaveText(`Gold${saved.gold}G`);
  await expect(page.getByTestId('stat-temper')).toHaveText(`Temper${saved.temper}T`);
  await expect(page.getByTestId('summary-gold-breakdown')).toContainText('Golden');
  await expect(page.getByTestId('summary-gold-breakdown')).toContainText('Jackpot');
  expect(saved.roundSummary!.sources.goldenGold).toBeGreaterThan(0);
  expect(saved.roundSummary!.sources.jackpotGold).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  const recorded = await trace(page);
  expect(recorded.particles).toHaveLength(0);
  expect(recorded.gold.at(-1)).toBe(saved.gold);
  expect(recorded.temper.at(-1)).toBe(saved.temper);
});

test('continuing past the static round summary leaves committed counters stable', async ({ page }) => {
  await installRunState(page, payoutState()); await enterRun(page); await installTrace(page);
  await playPayout(page);
  const committed = (await readRunState(page))!;
  await expect(page.getByTestId('currency-particle')).toHaveCount(0);
  await page.getByRole('button', { name: /CONTINUE/ }).click();
  await expect(page.getByTestId('currency-particle')).toHaveCount(0);
  await expect(page.getByTestId('stat-gold')).toHaveText(`Gold${committed.gold}G`);
  await expect(page.getByTestId('stat-temper')).toHaveText(`Temper${committed.temper}T`);
  const balances = await page.locator('[data-testid="stat-gold"], [data-testid="stat-temper"]').allTextContents();
  await page.waitForTimeout(1200);
  expect(await page.locator('[data-testid="stat-gold"], [data-testid="stat-temper"]').allTextContents()).toEqual(balances);
});
