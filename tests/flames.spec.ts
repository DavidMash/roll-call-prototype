import { expect, test } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { flameByType, placeFlameInstance } from '../src/game/flames';
import type { Flame, GameState } from '../src/game/types';
import { enterRun, goToShopStage, installRunState } from './uiHelpers';
import { RUN_STORAGE_KEY } from '../src/game/persistence';

function reward(flame: Flame = 'ultimate'): GameState {
  const state = newRun(`global-flame-reward-${flame}`).state;
  state.phase = 'flameSelection';
  state.shop = null;
  state.flameSelection = { offers: [{ id: 51, flame }], acquired: false };
  state.flameTutorial.completed = true;
  return state;
}

test('Flame reward fills the first empty global slot without asking for a carrier die', async ({ page }) => {
  const state = reward();
  placeFlameInstance(state, 'minigun', 20, 0);
  placeFlameInstance(state, 'hailMary', 100, 2);
  await installRunState(page, state);
  await enterRun(page);

  await expect(page.getByTestId('global-flame-slots')).toContainText('2 / 5');
  await page.getByTestId('flame-offer-ultimate').getByRole('button', { name: 'SELECT FLAME' }).click();
  await expect(page.getByRole('main').getByText('SHOP', { exact: true })).toBeVisible();

  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state as GameState, RUN_STORAGE_KEY);
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
  await expect(dialog).toContainText('lose 12 invested Gold');
  await dialog.getByRole('button', { name: 'REPLACE', exact: true }).click();
  await expect(page.getByRole('main').getByText('SHOP', { exact: true })).toBeVisible();

  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state as GameState, RUN_STORAGE_KEY);
  expect(saved.flameSlots[2]).toMatchObject({ type: 'ultimate', investedGold: 0, stage: 'ember' });
  expect(saved.flameSlots.filter(Boolean)).toHaveLength(5);
});

test('Fire Keeping renders only owned Flames and stokes an instance in place into Bonfire', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = newRun('global-fire-keeping').state;
  state.gold = 10;
  const flame = placeFlameInstance(state, 'doubleDown', 99, 3);
  state.phase = 'shop';
  state.shop = { visitId: 1, stage: 'dice', offers: [], offerRerolls: 0, lifeRestores: 0 };
  state.nextShopVisitId = 2;
  await installRunState(page, state);
  await enterRun(page);
  const beforeTabs = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state as GameState, RUN_STORAGE_KEY);
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.getByTestId('shop-stage-back')).toHaveCount(0);
  await page.getByTestId('shop-stage-fire-keeping').click();
  await expect(page.getByTestId('shop-stage-fire-keeping')).toHaveAttribute('data-active', 'true');
  const afterDirect = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state as GameState, RUN_STORAGE_KEY);
  expect(afterDirect.shop!.stage).toBe('fireKeeping');
  expect(afterDirect.shop!.visitId).toBe(beforeTabs.shop!.visitId);
  expect(afterDirect.rngState).toBe(beforeTabs.rngState);
  expect(afterDirect.shop!.offers).toEqual(beforeTabs.shop!.offers);
  expect(afterDirect.shop!.trainingSession).toEqual(beforeTabs.shop!.trainingSession);
  expect(afterDirect.flameSlots).toEqual(beforeTabs.flameSlots);
  await page.getByTestId('shop-stage-dice').click();
  await expect(page.getByTestId('shop-stage-dice')).toHaveAttribute('data-active', 'true');
  await goToShopStage(page, 'fireKeeping');

  await expect(page.locator('.fire-keeping-card')).toHaveCount(1);
  await expect(page.getByTestId('fire-keeping-shop')).toContainText('1 / 5 FLAMES');
  await expect(page.getByTestId('fire-keeping-shop')).not.toContainText('EMPTY');
  const card = page.getByTestId(`fire-keeping-flame-${flame.instanceId}`);
  await expect(card).toContainText('EMBER');
  await page.screenshot({ path: test.info().outputPath('fire-keeping-one-flame-mobile.png'), fullPage: true });
  await card.getByRole('button', { name: 'MANAGE FLAME' }).click();
  const dialog = page.getByRole('dialog', { name: 'Double Down' });
  await dialog.getByRole('button', { name: 'Increase investment' }).click();
  await dialog.getByRole('button', { name: 'STOKE 1 GOLD' }).click();
  await expect(card).toContainText('BONFIRE');

  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state as GameState, RUN_STORAGE_KEY);
  expect(saved.flameSlots[3]).toMatchObject({ instanceId: flame.instanceId, type: 'doubleDown', investedGold: 100, stage: 'bonfire' });
  expect(saved.flameSlots[0]).toBeNull();
});

test('global Flame details remain available during a Round without appearing on a die', async ({ page }) => {
  const state = newRun('global-flame-round-details').state;
  placeFlameInstance(state, 'momentum', 25, 4);
  await installRunState(page, state);
  await enterRun(page);

  await expect(page.locator('.die-flame-cap')).toHaveCount(0);
  await page.getByRole('button', { name: /View Momentum ember details/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Momentum' });
  await expect(dialog).toContainText('Investment: 25 / 100 Gold');
  await expect(dialog).toContainText('Current Effect: +0.125 Charge per Play');
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
  await expect(page.getByRole('dialog', { name: 'Fetch' })).toContainText('Investment: 44 / 100 Gold');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state as GameState, RUN_STORAGE_KEY);
  expect(flameByType(saved, 'fetch')).toMatchObject({ instanceId: flame.instanceId });
  expect(saved.fetchTarget).toEqual(state.fetchTarget);
  expect(saved.flameSlots[2]?.instanceId).toBe(flame.instanceId);
});
