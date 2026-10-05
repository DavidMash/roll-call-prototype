import { expect, test } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { activeFace } from '../src/game/dice';
import { RUN_STORAGE_KEY, RUN_STORAGE_VERSION } from '../src/game/persistence';
import type { GameState, RoundSummary } from '../src/game/types';
import { enterRun } from './uiHelpers';

async function installRun(page: import('@playwright/test').Page, state: GameState) {
  await page.goto(`/?seed=${state.seed}&speed=instant`);
  await page.evaluate(([key, version, saved]) => localStorage.setItem(key, JSON.stringify({ version, state: saved })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, state] as const);
  await page.reload();
  await page.locator('main').waitFor();
  await enterRun(page);
  await expect(page.locator('[data-testid="dice-dock"]')).toHaveCount(1);
}

function detailedState(seed: string) {
  const state = newRun(seed).state;
  const face = activeFace(state.dice[0]);
  face.enhancements.bonus = 2;
  face.enhancements.mirror = 1;
  face.enhancements.vintage = 1;
  face.vintageSellValue = 9;
  state.dice[0].flame = { id: 'straightShooter', investedGold: 35 };
  return state;
}

test('stable die anatomy keeps value clear and shared Round details read-only', async ({ page }) => {
  const state = detailedState('dice-dock-anatomy');
  state.bonfires = ['ultimate'];
  activeFace(state.dice[0]).snakeEyed = true;
  activeFace(state.dice[1]).infected = true;
  activeFace(state.dice[2]).magneticSourceUsed = true;
  activeFace(state.dice[2]).enhancements.magnetic = 1;
  await page.setViewportSize({ width: 320, height: 700 });
  await installRun(page, state);

  const dock = page.getByTestId('dice-dock');
  const slot = dock.getByTestId('flame-die-0');
  const body = slot.getByRole('button', { name: /^Die 1, face/ });
  const flame = slot.getByRole('button', { name: 'View Straight Shooter Flame details, Ember at 35 of 100 Gold' });
  const strip = slot.getByRole('button', { name: /View Enhancements on D1 face/ });
  await expect(flame).toContainText('STR8');
  await expect(strip.locator('.enhancement-icon')).toHaveCount(3);
  await expect(strip.locator('.enhancement-bonus')).toContainText('×2');
  await expect(body).not.toContainText('Bonus');
  await expect(body).not.toContainText('Straight Shooter');
  await expect(body).toHaveClass(/snake-eyed-face/);
  await expect(page.getByTestId('flame-die-1').locator('.die')).toHaveClass(/infected-face/);
  await expect(page.getByTestId('flame-die-2').locator('.die')).toHaveClass(/magnetic-used/);
  expect(await slot.evaluate(element => {
    const cap = element.querySelector('.die-flame-cap')!.getBoundingClientRect();
    const die = element.querySelector('.die')!.getBoundingClientRect();
    const number = element.querySelector('.die-number')!.getBoundingClientRect();
    const enhancements = element.querySelector('.die-enhancement-strip')!.getBoundingClientRect();
    return cap.bottom <= die.top + 1 && number.top >= die.top && number.bottom <= die.bottom && enhancements.top >= die.bottom - 1;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => {
    const main = document.querySelector('main')!.getBoundingClientRect();
    const dockBox = document.querySelector<HTMLElement>('[data-testid="dice-dock"]')!.getBoundingClientRect();
    return main.bottom <= dockBox.top + 1 && parseFloat(getComputedStyle(document.querySelector<HTMLElement>('[data-testid="dice-dock"]')!).paddingBottom) >= 5;
  })).toBe(true);

  await strip.click();
  const faceModal = page.getByRole('dialog', { name: `D1 · FACE ${state.dice[0].value}` });
  await expect(faceModal).toContainText('Bonus ×2');
  await expect(faceModal).toContainText('Mirror');
  await expect(faceModal).toContainText('Current sell value: 9 Gold');
  await expect(faceModal.getByRole('button', { name: /^Sell / })).toHaveCount(0);
  await faceModal.getByRole('button', { name: 'Close' }).click();

  await flame.click();
  const flameModal = page.getByRole('dialog', { name: 'Straight Shooter' });
  await expect(flameModal).toContainText('Investment: 35 / 100 Gold');
  await expect(flameModal).toContainText('Current XMult: up to ×3.8');
  await expect(flameModal).toContainText('Play Small Straight before Large Straight');
  await expect(flameModal.getByLabel('Stoke amount for Straight Shooter')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'View Ultimate Flame details' }).click();
  const bonfireModal = page.getByRole('dialog', { name: 'Ultimate' });
  await expect(bonfireModal).toContainText('BONFIRE');
  await expect(bonfireModal).toContainText('Investment: 100 / 100 Gold');
  await expect(bonfireModal).toContainText('Current XMult: up to ×5');
  await expect(bonfireModal.locator('[role="progressbar"]')).toHaveCount(1);
});

test('Shop uses the same face and Flame modals for authoritative Sell and Stoke actions', async ({ page }) => {
  const state = detailedState('dice-dock-shop-actions');
  state.phase = 'shop';
  state.gold = 20;
  state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
  await installRun(page, state);
  const slot = page.getByTestId('flame-die-0');

  await slot.getByRole('button', { name: /View Enhancements on D1 face/ }).click();
  const faceModal = page.getByRole('dialog', { name: 'D1 — MANAGE DIE' });
  await faceModal.getByRole('button', { name: /Sell Vintage from D1 face .* for 9 Gold/ }).click();
  await page.getByRole('dialog', { name: 'SELL VINTAGE?' }).getByRole('button', { name: 'SELL', exact: true }).click();
  await expect(faceModal).not.toContainText('Current sell value: 9 Gold');
  await faceModal.getByRole('button', { name: 'Close' }).click();
  await expect(slot.locator('.enhancement-vintage')).toHaveCount(0);

  await slot.getByRole('button', { name: 'View Straight Shooter Flame details, Ember at 35 of 100 Gold' }).click();
  const flameModal = page.getByRole('dialog', { name: 'Straight Shooter' });
  await flameModal.getByLabel('Stoke amount for Straight Shooter').fill('2');
  await flameModal.getByRole('button', { name: 'STOKE 2 GOLD' }).click();
  await expect(flameModal).toContainText('Investment: 37 / 100 Gold');
  await expect(slot.getByRole('button', { name: 'View Straight Shooter Flame details, Ember at 37 of 100 Gold' })).toBeVisible();
});

test('shared Flame details show Charge capacity and keep Round, Shop, and Bonfire actions phase-correct', async ({ page }) => {
  const state = newRun('charge-flame-details').state;
  state.dice[0].flame = { id: 'momentum', investedGold: 25 };
  await installRun(page, state);

  await page.getByRole('button', { name: 'View Momentum Flame details, Ember at 25 of 100 Gold' }).click();
  let modal = page.getByRole('dialog', { name: 'Momentum' });
  await expect(modal).toContainText('Investment: 25 / 100 Gold');
  await expect(modal).toContainText('Max Flame Contribution: +2 Max Charge');
  await expect(modal).toContainText('Current Effect: +0.125 Charge per hand');
  await expect(modal.getByLabel('Stoke amount for Momentum')).toHaveCount(0);
  await page.keyboard.press('Escape');

  state.phase = 'shop';
  state.gold = 20;
  state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
  await installRun(page, state);
  await page.getByRole('button', { name: 'View Momentum Flame details, Ember at 25 of 100 Gold' }).click();
  modal = page.getByRole('dialog', { name: 'Momentum' });
  await expect(modal.getByLabel('Stoke amount for Momentum')).toBeVisible();
  await page.keyboard.press('Escape');

  state.dice[0].flame = null;
  state.bonfires = ['momentum'];
  await installRun(page, state);
  await page.getByRole('button', { name: 'View Momentum Flame details' }).click();
  modal = page.getByRole('dialog', { name: 'Momentum' });
  await expect(modal).toContainText('Investment: 100 / 100 Gold');
  await expect(modal).toContainText('Max Flame Contribution: +5 Max Charge');
  await expect(modal.getByLabel('Stoke amount for Momentum')).toHaveCount(0);
});

test('one mounted dock carries unchanged faces through Summary, Map, and Shop', async ({ page }) => {
  const state = newRun('dice-dock-persistence').state;
  state.phase = 'roundSummary';
  state.score = state.target;
  const summary: RoundSummary = { round: state.round, encounterType: 'normal', bossType: null, score: state.score, target: state.target,
    goldBefore: state.gold, goldAfter: state.gold, totalGoldEarned: 0,
    sources: { baseRewardGold: 0, unusedRerollGold: 0, interestGold: 0, bossRewardGold: 0, goldenGold: 0, jackpotGold: 0, otherGold: 0 } };
  state.roundSummary = summary;
  await installRun(page, state);
  const dock = page.getByTestId('dice-dock');
  const dockHandle = await dock.elementHandle();
  const faces = await dock.locator('.die-number').allTextContents();

  await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
  await expect(page.getByTestId('run-map-transition')).toBeVisible();
  expect(await dockHandle!.evaluate(element => element === document.querySelector('[data-testid="dice-dock"]'))).toBe(true);
  await expect(dock.locator('.die-number')).toHaveText(faces);
  await page.getByTestId('run-map-transition').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.shop-screen')).toBeVisible();
  expect(await dockHandle!.evaluate(element => element === document.querySelector('[data-testid="dice-dock"]'))).toBe(true);
  await expect(dock.locator('.die-number')).toHaveText(faces);
  await expect(page.locator('[data-testid="dice-dock"]')).toHaveCount(1);
});

test('Special Offer and Flame Selection retain the same compact dock grammar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = detailedState('dice-dock-progression');
  const faces = state.dice.map(die => String(die.value));
  state.phase = 'specialOffer';
  state.specialOffer = { offers: [{ id: 1, type: 'carePackage' }], acquired: false };
  await installRun(page, state);
  await expect(page.getByTestId('dice-dock').locator('.die-number')).toHaveText(faces);
  await expect(page.getByTestId('dice-dock').locator('.die-enhancement-strip')).toHaveCount(5);
  expect(await page.evaluate(() => {
    const hud = document.querySelector<HTMLElement>('.top-hud')!.getBoundingClientRect();
    const main = document.querySelector<HTMLElement>('main')!.getBoundingClientRect();
    const dock = document.querySelector<HTMLElement>('[data-testid="dice-dock"]')!.getBoundingClientRect();
    return document.documentElement.scrollHeight <= innerHeight && main.top >= hud.bottom && main.bottom <= dock.top + 1 && dock.bottom <= innerHeight;
  })).toBe(true);

  state.phase = 'flameSelection';
  state.specialOffer = null;
  state.flameSelection = { offers: [{ id: 2, flame: 'ultimate' }], acquired: false };
  await installRun(page, state);
  await expect(page.getByTestId('dice-dock').locator('.die-number')).toHaveText(faces);
  await expect(page.locator('[data-testid="dice-dock"]')).toHaveCount(1);
  expect(await page.evaluate(() => {
    const hud = document.querySelector<HTMLElement>('.top-hud')!.getBoundingClientRect();
    const main = document.querySelector<HTMLElement>('main')!.getBoundingClientRect();
    const dock = document.querySelector<HTMLElement>('[data-testid="dice-dock"]')!.getBoundingClientRect();
    const header = document.querySelector<HTMLElement>('.phase-sticky-header')!.getBoundingClientRect();
    return document.documentElement.scrollHeight <= innerHeight && main.top >= hud.bottom && header.top >= main.top
      && main.bottom <= dock.top + 1 && dock.bottom <= innerHeight;
  })).toBe(true);
});
