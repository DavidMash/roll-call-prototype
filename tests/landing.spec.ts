import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { activeFace } from '../src/game/dice';
import { newRun } from '../src/game/engine';
import { RUN_STORAGE_KEY, RUN_STORAGE_VERSION } from '../src/game/persistence';
import { ONBOARDING_STORAGE_KEY, ONBOARDING_STORAGE_VERSION } from '../src/tutorial/tutorialPersistence';
import { TUTORIAL_VERSION } from '../src/tutorial/types';
import type { GameState } from '../src/game/types';

async function installRun(page: Page, state: GameState, speed: 'normal' | 'instant' = 'instant') {
  await page.goto(`/?seed=${state.seed}&speed=${speed}`);
  await page.evaluate(([key, version, saved]) => localStorage.setItem(key, JSON.stringify({ version, state: saved })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, state] as const);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'ROLL CALL', exact: true })).toBeVisible();
}

async function clearRun(page: Page, seed: string, speed: 'normal' | 'instant' = 'instant') {
  await page.goto(`/?seed=${seed}&speed=${speed}`);
  await page.evaluate(key => localStorage.removeItem(key), RUN_STORAGE_KEY);
  await page.reload();
}

test('startup always shows the landing gate and only offers Continue for a valid active run', async ({ page }) => {
  await clearRun(page, 'landing-empty');
  await expect(page.getByRole('heading', { name: 'ROLL CALL', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Continue Chapter / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'PLAY TUTORIAL', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'SKIP TUTORIAL', exact: true })).toBeVisible();
  await expect(page.getByTestId('dice-dock')).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), RUN_STORAGE_KEY)).toBeNull();

  const terminal = newRun('landing-terminal').state;
  terminal.phase = 'lost';
  await installRun(page, terminal);
  await expect(page.getByRole('button', { name: /^Continue Chapter / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'PLAY TUTORIAL', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'NEW RUN', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Start a new run?' })).toHaveCount(0);

  const active = newRun('landing-active').state;
  await installRun(page, active);
  await expect(page.getByRole('button', { name: /^Continue Chapter 1 Round 1/ })).toBeVisible();
  await expect(page.getByTestId('dice-dock')).toHaveCount(0);
});

test('completed tutorial metadata survives refresh and restores the normal landing hierarchy', async ({ page }) => {
  await page.goto('/?speed=instant');
  await page.evaluate(([key, version, tutorialVersion]) => localStorage.setItem(key, JSON.stringify({
    version,
    metadata: { tutorialVersion, tutorialCompleted: true, normalRunFinishedOnce: false },
  })), [ONBOARDING_STORAGE_KEY, ONBOARDING_STORAGE_VERSION, TUTORIAL_VERSION] as const);
  await page.reload();

  await expect(page.getByRole('button', { name: 'NEW RUN', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'REPLAY TUTORIAL', exact: true })).toBeVisible();
  await expect(page.getByText('Learn the basics in a guided run.')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'REPLAY TUTORIAL', exact: true })).toBeVisible();
});

test('Continue presents compact progress and restores the exact Round state without rewriting it', async ({ page }) => {
  const state = newRun('landing-round-resume').state;
  state.round = 10;
  state.gold = 47;
  state.lives = 2;
  state.rngState = 987654321;
  state.dice[0].value = 6;
  state.dice[1].value = 2;
  await installRun(page, state);

  const rawBefore = await page.evaluate(key => localStorage.getItem(key), RUN_STORAGE_KEY);
  const continueButton = page.getByRole('button', { name: 'Continue Chapter 2 Round 4, 47 Gold, 2 lives' });
  await expect(continueButton).toContainText('CONTINUE');
  await expect(continueButton).toContainText('C2 R4 · 47 Gold · ♥♥');
  await continueButton.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('dice-dock')).toBeVisible();
  await expect(page.getByTestId('stat-round')).toContainText('C2 R4');
  await expect(page.getByTestId('stat-gold')).toContainText('47');
  await expect(page.getByRole('button', { name: new RegExp(`^Die 1, face ${activeFace(state.dice[0]).rank},`) })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(`^Die 2, face ${activeFace(state.dice[1]).rank},`) })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), RUN_STORAGE_KEY)).toBe(rawBefore);
});

test('Continue resumes Shop, Special Offer, and Flame Selection without forcing a Round', async ({ page }) => {
  const shop = newRun('landing-shop').state;
  shop.phase = 'shop';
  shop.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
  await installRun(page, shop);
  await page.getByRole('button', { name: /^Continue Chapter / }).click();
  await expect(page.getByRole('main').getByText('SHOP', { exact: true })).toBeVisible();

  const specialOffer = newRun('landing-special').state;
  specialOffer.phase = 'specialOffer';
  specialOffer.specialOffer = { offers: [{ id: 41, type: 'carePackage' }], acquired: false };
  await installRun(page, specialOffer);
  await page.getByRole('button', { name: /^Continue Chapter / }).click();
  await expect(page.getByRole('main').getByText('SPECIAL OFFER', { exact: true })).toBeVisible();

  const flameSelection = newRun('landing-flame').state;
  flameSelection.phase = 'flameSelection';
  flameSelection.flameSelection = { offers: [{ id: 51, flame: 'ultimate' }], acquired: false };
  await installRun(page, flameSelection);
  await page.getByRole('button', { name: /^Continue Chapter / }).click();
  await expect(page.getByRole('main').getByText('FLAME SELECTION', { exact: true })).toBeVisible();
});

test('New Run starts immediately without a save and preserves the Chapter 1 splash and map flow', async ({ page }) => {
  await clearRun(page, 'landing-new-flow', 'normal');
  await page.getByRole('button', { name: 'SKIP TUTORIAL', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Start a new run?' })).toHaveCount(0);
  await expect(page.getByTestId('chapter-splash')).toHaveAttribute('data-chapter', '1');
  await expect(page.getByTestId('dice-dock')).toBeVisible();
  await expect(page.getByTestId('run-map-transition')).toBeVisible({ timeout: 4000 });
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state as GameState, RUN_STORAGE_KEY);
  expect(saved).toMatchObject({ seed: 'landing-new-flow', round: 1, phase: 'round', gold: 0, lives: 3 });
  expect(saved.presentedChapters).toEqual([1]);
});

test('New Run confirmation preserves the save on open and Cancel, then replaces it explicitly', async ({ page }) => {
  const state = newRun('landing-replace').state;
  state.round = 8;
  state.gold = 73;
  state.lives = 1;
  activeFace(state.dice[0]).enhancements.bonus = 2;
  if (!state.roundCheckpoint) throw new Error('Expected a run checkpoint');
  state.roundCheckpoint.gold = 19;
  await installRun(page, state);
  const rawBefore = await page.evaluate(key => localStorage.getItem(key), RUN_STORAGE_KEY);
  const newRunButton = page.getByRole('button', { name: 'SKIP TUTORIAL', exact: true });

  await newRunButton.click();
  const dialog = page.getByRole('dialog', { name: 'Start a new run?' });
  await expect(dialog).toContainText('Your current run will be replaced.');
  expect(await page.evaluate(key => localStorage.getItem(key), RUN_STORAGE_KEY)).toBe(rawBefore);
  await dialog.getByRole('button', { name: 'CANCEL', exact: true }).click();
  await expect(newRunButton).toBeFocused();
  expect(await page.evaluate(key => localStorage.getItem(key), RUN_STORAGE_KEY)).toBe(rawBefore);

  await newRunButton.click();
  await dialog.getByRole('button', { name: 'START NEW RUN', exact: true }).click();
  await expect(page.getByTestId('dice-dock')).toBeVisible();
  const replaced = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state as GameState, RUN_STORAGE_KEY);
  expect(replaced).toMatchObject({ seed: state.seed, round: 1, phase: 'round', gold: 0, lives: 3 });
  expect(replaced.rngState).toBe(newRun(state.seed).state.rngState);
  expect(activeFace(replaced.dice[0]).enhancements.bonus).toBeUndefined();
  expect(replaced.roundCheckpoint?.gold).toBe(0);
});
