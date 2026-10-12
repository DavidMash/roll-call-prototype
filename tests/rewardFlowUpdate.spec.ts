import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { Resolver } from '../src/game/effects';
import { RUN_STORAGE_KEY } from '../src/game/persistence';
import type { Flame, GameState, SpecialOfferType } from '../src/game/types';
import { enterRun, installRunState } from './uiHelpers';

const fixedRandom = { next: () => .25 };

function flameReward(flame: Flame = 'ultimate'): GameState {
  const state = newRun(`browser-flame-${flame}`, fixedRandom).state;
  state.phase = 'flameSelection';
  state.shop = null;
  state.roundSummary = null;
  state.specialOffer = null;
  state.flameSelection = { offers: [{ id: 801, flame }], acquired: false };
  state.flameTutorial.completed = true;
  return state;
}

function specialReward(type: SpecialOfferType = 'carePackage'): GameState {
  const state = newRun(`browser-special-${type}`, fixedRandom).state;
  state.round = 3;
  state.phase = 'specialOffer';
  state.shop = null;
  state.roundSummary = null;
  state.flameSelection = null;
  state.specialOffer = { offers: [{ id: 901, type }], acquired: false };
  return state;
}

function shopState(kind: 'normal' | 'post_boss' = 'normal'): GameState {
  const state = newRun(`browser-shop-lock-${kind}`, fixedRandom).state;
  state.gold = 100;
  if (kind === 'post_boss') state.round = 6;
  new Resolver(state, fixedRandom).openShop();
  return state;
}

async function persistedState(page: Page): Promise<GameState> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, RUN_STORAGE_KEY);
}

test('Flame selection waits for assignment, then claims and advances exactly once', async ({ page }) => {
  await installRunState(page, flameReward());
  await enterRun(page);

  await page.getByTestId('flame-offer-ultimate').getByRole('button', { name: 'Select Flame' }).click();
  await expect(page.getByRole('main').getByText('FLAME SELECTION', { exact: true })).toBeVisible();
  await expect(page.getByTestId('flame-offer-ultimate')).toHaveClass(/selected/);

  await page.getByRole('button', { name: /^Die 1,/ }).evaluate(element => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect(page.getByRole('main').getByText('SHOP', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /CONTINUE TO SHOP/i })).toHaveCount(0);

  const saved = await persistedState(page);
  expect(saved.dice[0].flame?.id).toBe('ultimate');
  expect(saved.actionJournal.filter(action => action.type === 'CHOOSE_FLAME')).toHaveLength(1);
  expect(saved.historyV2.filter(event => event.kind === 'flame_changed'
    && event.change.type === 'acquired')).toHaveLength(1);
});

test('Flame replacement finishes its confirmation before automatic progression', async ({ page }) => {
  const state = flameReward('ultimate');
  state.dice[0].flame = { id: 'doubleDown', investedGold: 40 };
  await installRunState(page, state);
  await enterRun(page);

  await page.getByTestId('flame-offer-ultimate').getByRole('button', { name: 'Select Flame' }).click();
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  const replacement = page.getByRole('dialog', { name: 'Replace Flame?' });
  await expect(replacement).toContainText('Double Down');
  await replacement.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('main').getByText('FLAME SELECTION', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /^Die 1,/ }).click();
  await replacement.getByRole('button', { name: 'Replace Flame', exact: true }).evaluate(element => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect(page.getByRole('main').getByText('SHOP', { exact: true })).toBeVisible();
  const saved = await persistedState(page);
  expect(saved.dice[0].flame).toEqual({ id: 'ultimate', investedGold: 0 });
  expect(saved.actionJournal.filter(action => action.type === 'CHOOSE_FLAME')).toHaveLength(1);
});

test('reward skipping is keyboard-safe, cancelable, and single-submit on both reward screens', async ({ page }) => {
  await installRunState(page, flameReward());
  await enterRun(page);
  await page.getByTestId('flame-offer-ultimate').getByRole('button', { name: 'Select Flame' }).click();

  const skip = page.getByRole('button', { name: 'SKIP REWARD', exact: true });
  await skip.focus();
  await page.keyboard.press('Enter');
  let confirmation = page.getByRole('dialog', { name: 'Skip this reward?' });
  await expect(confirmation.getByRole('button', { name: 'GO BACK', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByTestId('flame-offer-ultimate')).toHaveClass(/selected/);

  await skip.click();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole('main').getByText('FLAME SELECTION', { exact: true })).toBeVisible();

  await skip.click();
  confirmation = page.getByRole('dialog', { name: 'Skip this reward?' });
  await confirmation.getByRole('button', { name: 'SKIP REWARD', exact: true }).evaluate(element => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect(page.getByRole('main').getByText('SHOP', { exact: true })).toBeVisible();
  let saved = await persistedState(page);
  expect(saved.actionJournal.filter(action => action.type === 'SKIP_FLAME_SELECTION')).toHaveLength(1);
  expect(saved.historyV2.filter(event => event.kind === 'flame_changed'
    && event.change.type === 'skipped')).toHaveLength(1);

  await installRunState(page, specialReward());
  await enterRun(page);
  await page.getByRole('button', { name: 'SKIP REWARD', exact: true }).click();
  confirmation = page.getByRole('dialog', { name: 'Skip this reward?' });
  await confirmation.getByRole('button', { name: 'GO BACK', exact: true }).click();
  await expect(page.getByRole('main').getByText('SPECIAL OFFER', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'SKIP REWARD', exact: true }).click();
  await confirmation.getByRole('button', { name: 'SKIP REWARD', exact: true }).click();
  await expect(page.getByRole('main').getByText('SHOP', { exact: true })).toBeVisible();
  saved = await persistedState(page);
  expect(saved.actionJournal.filter(action => action.type === 'SKIP_SPECIAL_OFFER')).toHaveLength(1);
  expect(saved.chapterLifecycle[1]?.specialOfferConsumed).toBe(true);
});

test('Special Offers apply and advance atomically under repeated input', async ({ page }) => {
  await installRunState(page, specialReward());
  await enterRun(page);
  await page.getByRole('button', { name: 'CHOOSE', exact: true }).evaluate(element => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect(page.getByRole('main').getByText('SHOP', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /CONTINUE/i })).toHaveCount(0);
  const saved = await persistedState(page);
  expect(saved.specialOfferEffects.carePackageRerolls).toBe(3);
  expect(saved.actionJournal.filter(action => action.type === 'CHOOSE_SPECIAL_OFFER')).toHaveLength(1);
  expect(saved.chapterLifecycle[1]?.specialOfferConsumed).toBe(true);
});

test('Shop exit stays disabled for one second and Shop interactions do not restart it', async ({ page }) => {
  const clockStart = new Date('2026-10-12T12:00:00Z');
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(clockStart);
  const state = shopState();
  await installRunState(page, state);
  await enterRun(page);

  const next = page.getByTestId('shop-progression-action');
  await expect(next).toBeDisabled();
  await page.clock.fastForward(500);
  const offer = state.shop!.offers[0];
  await page.getByTestId(`offer-${offer.enhancement}`).getByRole('button', { name: 'SELECT OR DRAG' }).click();
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  await expect(page.getByTestId(`offer-${offer.enhancement}`)).toContainText('PURCHASED');

  await page.clock.fastForward(499);
  await expect(next).toBeDisabled();
  await page.clock.fastForward(1);
  await expect(next).toBeEnabled();

  const saved = await persistedState(page);
  expect(saved.shop?.exitUnlocked).toBe(true);
  expect(saved.actionJournal.filter(action => action.type === 'UNLOCK_SHOP_EXIT')).toHaveLength(1);
});

test('post-Boss Shop locks NEXT CHAPTER on entry', async ({ page }) => {
  const clockStart = new Date('2026-10-12T12:00:00Z');
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(clockStart);
  await installRunState(page, shopState('post_boss'));
  await enterRun(page);
  const next = page.getByRole('button', { name: 'NEXT CHAPTER', exact: true });
  await expect(next).toBeDisabled();
  await page.clock.fastForward(1000);
  await expect(next).toBeEnabled();
});
