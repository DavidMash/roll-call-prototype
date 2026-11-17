import { expect, test } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { flameByType, placeFlameInstance } from '../src/game/flames';
import type { Flame, GameState } from '../src/game/types';
import { enterRun, goToShopStage, installRunState, readRunState } from './uiHelpers';

function reward(flame: Flame = 'ultimate'): GameState {
  const state = newRun(`global-flame-reward-${flame}`).state;
  state.phase = 'flameSelection';
  state.shop = null;
  state.flameSelection = { offers: [{ id: 51, flame }], acquired: false };
  state.flameTutorial.completed = true;
  return state;
}

test('Flame reward fills the first empty global slot without asking for a carrier die', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const state = reward();
  state.flameSelection!.offers = [
    { id: 51, flame: 'ultimate' }, { id: 52, flame: 'thirdRail' }, { id: 53, flame: 'speedDemon' },
  ];
  placeFlameInstance(state, 'minigun', 20, 0);
  placeFlameInstance(state, 'hailMary', 100, 2);
  await installRunState(page, state);
  await enterRun(page);

  await expect(page.getByTestId('flames-strip')).toContainText('FLAMES · 2/5');
  await expect(page.getByTestId('flames-strip').locator('[data-testid^="active-flame-"]')).toHaveCount(2);
  await expect(page.getByText(/YOUR FLAMES/i)).toHaveCount(0);
  await expect(page.getByTestId('global-flame-slots')).toHaveCount(0);
  await expect(page.getByTestId('dice-dock')).toHaveAttribute('data-phase', 'flameSelection');
  await expect(page.getByRole('button', { name: 'SKIP REWARD' })).toBeVisible();
  const cards = page.locator('.flame-offer');
  await expect(cards).toHaveCount(3);
  const boxes = await cards.evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { top: box.top, width: box.width, left: box.left, right: box.right };
  }));
  expect(boxes[1].top).toBeGreaterThan(boxes[0].top);
  expect(boxes[2].top).toBeGreaterThan(boxes[1].top);
  expect(boxes.every(box => box.width > 260 && box.left >= 0 && box.right <= 320)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('flame-selection-320.png'), fullPage: true });
  await page.getByTestId('flame-offer-ultimate').getByRole('button', { name: 'SELECT FLAME' }).click();
  await expect(page.getByRole('main').getByText('SHOP', { exact: true })).toBeVisible();

  const saved = (await readRunState(page))!;
  expect(saved.flameSlots[1]).toMatchObject({ type: 'ultimate', investedGold: 0, stage: 'ember' });
  expect(saved.flameSlots).toHaveLength(5);
});

test('a full fire requires an explicit replacement confirmation and leaves a hole-free five-slot layout', async ({ page }) => {
  const state = reward('ultimate');
  (['minigun', 'hailMary', 'fullOfGrace', 'momentum', 'thirdRail'] as const)
    .forEach((type, slot) => placeFlameInstance(state, type, 10 + slot, slot as 0 | 1 | 2 | 3 | 4));
  await installRunState(page, state);
  await enterRun(page);

  await page.getByTestId('flame-offer-ultimate').getByRole('button', { name: 'SELECT TO REPLACE' }).click();
  await page.getByTestId('flame-replacement-picker').getByRole('button', { name: /Full of Grace/ }).click();
  const dialog = page.getByRole('dialog', { name: 'REPLACE A FLAME?' });
  await expect(dialog).toContainText('lose 12G invested');
  await dialog.getByRole('button', { name: 'REPLACE', exact: true }).click();
  await expect(page.getByRole('main').getByText('SHOP', { exact: true })).toBeVisible();

  const saved = (await readRunState(page))!;
  expect(saved.flameSlots[2]).toMatchObject({ type: 'ultimate', investedGold: 0, stage: 'ember' });
  expect(saved.flameSlots.filter(Boolean)).toHaveLength(5);
});

test('Fire Keeping renders only owned Flames and stokes an instance in place into Bonfire', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = newRun('global-fire-keeping').state;
  state.gold = 10;
  const flame = placeFlameInstance(state, 'doubleDown', 99, 3);
  state.phase = 'shop';
  state.shop = { visitId: 1, stage: 'shop', offers: [], offerRerolls: 0, lifeRestores: 0 };
  state.nextShopVisitId = 2;
  await installRunState(page, state);
  await enterRun(page);
  const beforeTabs = (await readRunState(page))!;
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.getByTestId('shop-stage-back')).toHaveCount(0);
  await page.getByTestId('shop-stage-flames').click();
  await expect(page.getByTestId('shop-stage-flames')).toHaveAttribute('data-active', 'true');
  const afterDirect = (await readRunState(page))!;
  expect(afterDirect.shop!.stage).toBe('flames');
  expect(afterDirect.shop!.visitId).toBe(beforeTabs.shop!.visitId);
  expect(afterDirect.rngState).toBe(beforeTabs.rngState);
  expect(afterDirect.shop!.offers).toEqual(beforeTabs.shop!.offers);
  expect(afterDirect.shop!.trainingSession).toEqual(beforeTabs.shop!.trainingSession);
  expect(afterDirect.flameSlots).toEqual(beforeTabs.flameSlots);
  await page.getByTestId('shop-stage-shop').click();
  await expect(page.getByTestId('shop-stage-shop')).toHaveAttribute('data-active', 'true');
  await goToShopStage(page, 'flames');

  await expect(page.locator('.fire-keeping-card')).toHaveCount(1);
  await expect(page.getByTestId('fire-keeping-shop')).toContainText('1 / 5 FLAMES');
  await expect(page.getByTestId('fire-keeping-shop')).not.toContainText('EMPTY');
  const card = page.getByTestId(`fire-keeping-flame-${flame.instanceId}`);
  await expect(card).toContainText('EMBER');
  await expect(card).toContainText('Complete this Bonfire: +10T');
  const grid = page.getByTestId('global-flame-slots');
  const mobileWidths = await Promise.all([grid, card].map(async element => (await element.boundingBox())!.width));
  expect(Math.abs(mobileWidths[0] - mobileWidths[1])).toBeLessThan(2);
  await page.setViewportSize({ width: 1180, height: 844 });
  const desktopWidths = await Promise.all([grid, card].map(async element => (await element.boundingBox())!.width));
  expect(Math.abs(desktopWidths[1] - (desktopWidths[0] - 7) / 2)).toBeLessThan(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath('fire-keeping-one-flame-mobile.png'), fullPage: true });
  const info = card.getByRole('button', { name: 'Info about Double Down' });
  await info.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Double Down' });
  await expect(dialog).toContainText('Play a Pair to set up Two Pair');
  await expect(dialog).not.toContainText('Investment:');
  await expect(dialog.getByRole('spinbutton')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(info).toBeFocused();
  const left = card.getByTestId(`stoke-flame-${flame.instanceId}-1`);
  await page.keyboard.press('Tab');
  await expect(left).toBeFocused();
  await expect(left).toHaveAccessibleName('Stoke Double Down for 1 Gold.');
  await expect(card.getByTestId(`stoke-flame-${flame.instanceId}-right`)).toHaveAccessibleName('Stoke Double Down for 1 Gold.');
  await card.getByTestId(`stoke-flame-${flame.instanceId}-right`).click();
  await expect(card).toContainText('BONFIRE');
  await expect(card).toContainText('BONFIRE COMPLETE');
  await expect(card.getByText('STOKE', { exact: true })).toHaveCount(0);

  const saved = (await readRunState(page))!;
  expect(saved.flameSlots[3]).toMatchObject({ instanceId: flame.instanceId, type: 'doubleDown', investedGold: 100, stage: 'bonfire' });
  expect(saved.flameSlots[0]).toBeNull();
});

function fireKeepingState(seed: string, investedGold: number, gold: number) {
  const state = newRun(seed).state;
  state.gold = gold;
  const flame = placeFlameInstance(state, 'doubleDown', investedGold, 0);
  state.phase = 'shop';
  state.shop = { visitId: 1, stage: 'flames', offers: [], offerRerolls: 0, lifeRestores: 0 };
  state.nextShopVisitId = 2;
  return { state, flame };
}

test('right-hand Stoke target stays fixed as 5G reduces to the exact completion amount', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const { state, flame } = fireKeepingState('fixed-stoke-target', 91, 9);
  await installRunState(page, state);
  await enterRun(page);

  const card = page.getByTestId(`fire-keeping-flame-${flame.instanceId}`);
  const left = card.getByTestId(`stoke-flame-${flame.instanceId}-1`);
  const right = card.getByTestId(`stoke-flame-${flame.instanceId}-right`);
  await expect(right).toHaveAccessibleName('Stoke Double Down for 5 Gold.');
  const mobileRight = await right.boundingBox();
  const mobileLeft = await left.boundingBox();
  expect(mobileRight).not.toBeNull();
  expect(mobileLeft).not.toBeNull();
  expect(Math.abs(mobileRight!.width - mobileLeft!.width)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1024, height: 800 });
  const initial = await right.boundingBox();
  const leftBox = await left.boundingBox();
  expect(initial).not.toBeNull();
  expect(leftBox).not.toBeNull();
  expect(Math.abs(initial!.width - leftBox!.width)).toBeLessThanOrEqual(1);
  const cardHeight = (await card.boundingBox())!.height;
  const effectBefore = await card.getByTestId(`flame-effect-${flame.instanceId}`).textContent();

  await right.click();
  await expect(right).toHaveAccessibleName('Stoke Double Down for 4 Gold.');
  await expect(page.getByTestId('stat-gold')).toHaveAttribute('aria-label', 'Gold 4');
  await expect(card).toContainText('96G / 100G');
  await expect(card.getByRole('progressbar', { name: 'Double Down investment: 96 of 100 Gold' })).toHaveAttribute('aria-valuenow', '96');
  expect(await card.getByTestId(`flame-effect-${flame.instanceId}`).textContent()).not.toBe(effectBefore);
  const reduced = await right.boundingBox();
  expect(reduced).not.toBeNull();
  expect(Math.abs(reduced!.x - initial!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(reduced!.width - initial!.width)).toBeLessThanOrEqual(1);
  await right.click();
  await expect(card).toContainText('BONFIRE COMPLETE');
  expect(Math.abs((await card.boundingBox())!.height - cardHeight)).toBeLessThanOrEqual(1);

  const saved = (await readRunState(page))!;
  expect(saved.gold).toBe(0);
  expect(saved.flameSlots[0]).toMatchObject({ investedGold: 100, stage: 'bonfire' });
  expect(saved.temper).toBe(10);
  expect(saved.stats.temperBySource.bonfire).toBe(10);
});

test('Stoke affordability is independent at 96/100 and the 4G action rewards once', async ({ page }) => {
  let setup = fireKeepingState('stoke-affordability-3', 96, 3);
  await installRunState(page, setup.state);
  await enterRun(page);
  let card = page.getByTestId(`fire-keeping-flame-${setup.flame.instanceId}`);
  await expect(card.getByTestId(`stoke-flame-${setup.flame.instanceId}-right`)).toBeDisabled();
  await expect(card.getByTestId(`stoke-flame-${setup.flame.instanceId}-1`)).toBeEnabled();
  await card.getByTestId(`stoke-flame-${setup.flame.instanceId}-1`).click();
  let saved = (await readRunState(page))!;
  expect(saved.gold).toBe(2);
  expect(saved.flameSlots[0]).toMatchObject({ investedGold: 97, stage: 'ember' });

  setup = fireKeepingState('stoke-affordability-4', 96, 4);
  await installRunState(page, setup.state);
  await enterRun(page);
  card = page.getByTestId(`fire-keeping-flame-${setup.flame.instanceId}`);
  const right = card.getByTestId(`stoke-flame-${setup.flame.instanceId}-right`);
  await expect(right).toBeEnabled();
  await right.evaluate(button => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(card).toContainText('BONFIRE COMPLETE');
  saved = (await readRunState(page))!;
  expect(saved.gold).toBe(0);
  expect(saved.flameSlots[0]).toMatchObject({ investedGold: 100, stage: 'bonfire' });
  expect(saved.actionJournal.filter(action => action.type === 'STOKE_FLAME'
    && action.flameInstanceId === setup.flame.instanceId)).toHaveLength(1);
  expect(saved.stats.temperBySource.bonfire).toBe(10);
});

test('either 1G control can independently finish a Flame at 99/100', async ({ page }) => {
  for (const side of ['1', 'right'] as const) {
    const setup = fireKeepingState(`finish-with-${side}`, 99, 1);
    await installRunState(page, setup.state);
    await enterRun(page);
    const card = page.getByTestId(`fire-keeping-flame-${setup.flame.instanceId}`);
    const button = card.getByTestId(`stoke-flame-${setup.flame.instanceId}-${side}`);
    await expect(button).toHaveAccessibleName('Stoke Double Down for 1 Gold.');
    await expect(button).toBeEnabled();
    await button.click();
    await expect(card).toContainText('BONFIRE COMPLETE');
    const saved = (await readRunState(page))!;
    expect(saved.gold).toBe(0);
    expect(saved.flameSlots[0]).toMatchObject({ investedGold: 100, stage: 'bonfire' });
    expect(saved.stats.temperBySource.bonfire).toBe(10);
  }
});

test('global Flame details remain available during a Round without appearing on a die', async ({ page }) => {
  const state = newRun('global-flame-round-details').state;
  placeFlameInstance(state, 'momentum', 25, 4);
  await installRunState(page, state);
  await enterRun(page);

  await expect(page.locator('.die-flame-cap')).toHaveCount(0);
  await page.getByRole('button', { name: /View Momentum ember details/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Momentum' });
  await expect(dialog).toContainText('Investment: 25G / 100G');
  await expect(dialog.getByLabel('25 Gold')).toBeVisible();
  await expect(dialog).toContainText('Current Effect: ×1.063 Charge per Play');
  await expect(dialog.getByLabel('Stoke amount for Momentum')).toHaveCount(0);
});

test('global Flame state survives a responsive reload with exact instance identity and slot', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = newRun('global-flame-reload').state;
  const flame = placeFlameInstance(state, 'fetch', 44, 2);
  state.fetchTarget = { dieId: state.dice[1].id, physicalFace: 4 };
  await installRunState(page, state);
  await enterRun(page);
  await page.reload();
  await enterRun(page);

  await page.getByRole('button', { name: /View Fetch ember details/ }).click();
  await expect(page.getByRole('dialog', { name: 'Fetch' })).toContainText('Investment: 44G / 100G');
  const saved = (await readRunState(page))!;
  expect(flameByType(saved, 'fetch')).toMatchObject({ instanceId: flame.instanceId });
  expect(saved.fetchTarget).toEqual(state.fetchTarget);
  expect(saved.flameSlots[2]?.instanceId).toBe(flame.instanceId);
});
