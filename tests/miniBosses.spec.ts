import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dispatch, newRun } from '../src/game/engine';
import { HAND_IDS } from '../src/game/hands';
import { RUN_STORAGE_KEY, RUN_STORAGE_VERSION } from '../src/game/persistence';
import type { GameState, MiniBossType, RandomSource } from '../src/game/types';

const constant = (value = .2): RandomSource => ({ next: () => value });

function shopBeforeMini(type: MiniBossType): GameState {
  const state = newRun(`browser-mini-${type}`, constant()).state;
  state.phase = 'shop';
  state.round = 2;
  state.currentNodeId = 'shop:before-round:3';
  state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
  state.bossSchedule[3] = type;
  return state;
}

async function install(page: Page, state: GameState) {
  await page.evaluate(([key, version, saved]) => localStorage.setItem(key, JSON.stringify({ version, state: saved })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, state] as const);
  await page.reload();
  await expect(page.locator('main')).toBeVisible();
}

test('Mini-Boss map, preview, encounter label, and Neglected badges reuse the boss presentation', async ({ page }) => {
  const state = shopBeforeMini('neglected');
  for (const hand of HAND_IDS) state.handPlayCounts[hand] = 5;
  state.handPlayCounts.ones = 0;
  state.handPlayCounts.threes = 0;
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto(`/?seed=${state.seed}&speed=instant`);
  await install(page, state);

  await expect(page.getByTestId('boss-preview')).toContainText('MINI-BOSS');
  await expect(page.getByTestId('boss-preview')).toContainText('THE NEGLECTED');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  const map = page.getByTestId('run-map-transition');
  await expect(map).toHaveAttribute('data-destination', 'boss:3');
  await expect(map.locator('[aria-current="step"]')).toHaveClass(/node-mini_boss_round/);
  await expect(map.locator('[aria-current="step"]')).toContainText('MINI-BOSS');
  await map.getByRole('button', { name: 'Continue', exact: true }).evaluate(element => (element as HTMLElement).click());
  await expect(map).toHaveCount(0);

  await expect(page.getByTestId('boss-panel')).toContainText('MINI-BOSS · THE NEGLECTED');
  for (const hand of ['ones', 'threes']) {
    await expect(page.getByTestId(`scorecard-row-${hand}`)).toHaveAttribute('data-state', 'consumed');
    await expect(page.getByTestId(`scorecard-row-${hand}`)).toContainText('NEGLECTED');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Magician presents all calls while the missing die is absent', async ({ page }) => {
  const state = dispatch(shopBeforeMini('magician'), { type: 'NEXT_ROUND' }, constant()).state;
  await page.setViewportSize({ width: 390, height: 740 });
  await page.goto(`/?seed=${state.seed}&speed=instant`);
  await install(page, state);

  await expect(page.getByTestId('boss-panel')).toContainText('MINI-BOSS · THE MAGICIAN');
  await expect(page.getByTestId('magician-calls').locator('.mantine-Badge-root')).toHaveCount(3);
  await expect(page.locator('.gameplay-dock .die')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Mini-Boss summary labels its reward and continues to Special Offer', async ({ page }) => {
  let state = dispatch(shopBeforeMini('capitalReturn'), { type: 'NEXT_ROUND' }, constant()).state;
  state.target = 1;
  state.stats.rounds.at(-1)!.target = 1;
  state.dice[0].value = 6;
  state = dispatch(state, { type: 'PLAY', hand: 'sixes', dieIds: [0] }, constant()).state;
  await page.goto(`/?seed=${state.seed}&speed=instant`);
  await install(page, state);

  await expect(page.getByRole('heading', { name: 'MINI-BOSS DEFEATED' })).toBeVisible();
  await expect(page.getByTestId('summary-gold-breakdown')).toContainText('Mini-Boss Reward');
  await expect(page.getByTestId('summary-gold-breakdown')).toContainText('+10');
  await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
  const map = page.getByTestId('run-map-transition');
  await expect(map).toHaveAttribute('data-destination', 'special:after-round:3');
  await map.getByRole('button', { name: 'Continue', exact: true }).evaluate(element => (element as HTMLElement).click());
  await expect(page.getByRole('heading', { name: 'SPECIAL OFFER' })).toBeVisible();
  await expect(page.getByText('Mini-Boss Reward', { exact: true })).toBeVisible();
});
