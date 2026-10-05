import { expect, test } from '@playwright/test';
import { BOSSES } from '../src/game/bosses';
import { newRun } from '../src/game/engine';
import { RUN_STORAGE_KEY, RUN_STORAGE_VERSION } from '../src/game/persistence';
import type { GameState } from '../src/game/types';
import { enterRun } from './uiHelpers';

async function installRun(page: import('@playwright/test').Page, state: GameState) {
  await page.evaluate(([key, version, saved]) => localStorage.setItem(key, JSON.stringify({ version, state: saved })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, state] as const);
  await page.reload();
  await page.locator('main').waitFor();
  await enterRun(page);
}

test('Chapter splash leads into one complete current-Chapter map without revealing encounters', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seed = 'chapter-presentation';
  const expected = newRun(seed).state.chapterPlans[1]!;
  await page.goto(`/?seed=${seed}&speed=normal`);
  await enterRun(page);

  const splash = page.getByTestId('chapter-splash');
  await expect(splash).toBeVisible();
  const dock = page.getByTestId('dice-dock');
  const dockHandle = await dock.elementHandle();
  await expect(dock).toBeVisible();
  await expect(dock).toHaveAttribute('data-cinematic', 'true');
  await expect(dock.locator('.die')).toHaveCount(5);
  expect(await dock.locator('button').evaluateAll(buttons => buttons.every(button => (button as HTMLButtonElement).disabled))).toBe(true);
  await expect(splash).toHaveText(/CHAPTER 1/);
  await expect(splash).toHaveAttribute('data-start-color', BOSSES[expected.miniBoss].primary);
  await expect(splash).toHaveAttribute('data-end-color', BOSSES[expected.boss].primary);
  await expect(splash).not.toContainText(BOSSES[expected.miniBoss].name);
  await expect(splash).not.toContainText(BOSSES[expected.boss].name);
  expect(await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main')!.getBoundingClientRect();
    const dock = document.querySelector<HTMLElement>('[data-testid="dice-dock"]')!.getBoundingClientRect();
    return document.documentElement.scrollHeight <= innerHeight && main.bottom <= dock.top + 1 && dock.bottom <= innerHeight;
  })).toBe(true);

  const map = page.getByTestId('run-map-transition');
  await expect(map).toBeVisible({ timeout: 4_000 });
  expect(await dockHandle!.evaluate(element => element === document.querySelector('[data-testid="dice-dock"]'))).toBe(true);
  await expect(dock).not.toHaveAttribute('data-cinematic', 'true');
  await expect(page.locator('[data-testid="dice-dock"]')).toHaveCount(1);
  await expect(map.locator('.map-kicker')).toHaveText('CHAPTER 1');
  await expect(map.locator('.node-label')).toHaveText([
    'R1', 'SHOP', 'R2', 'SHOP', 'MINI-BOSS', 'SPECIAL OFFER', 'SHOP',
    'R4', 'SHOP', 'R5', 'SHOP', 'BOSS', 'FLAME',
  ]);
  await expect(map.locator('.node-shop')).toHaveCount(5);
  await expect(map.locator('.node-special_offer .node-glyph')).toHaveCSS('color', 'rgb(46, 214, 143)');
  await expect(map.locator('.node-flame_selection')).toHaveCount(1);
  expect(await page.evaluate(() => {
    const hud = document.querySelector<HTMLElement>('.top-hud')!.getBoundingClientRect();
    const main = document.querySelector<HTMLElement>('main')!.getBoundingClientRect();
    const dock = document.querySelector<HTMLElement>('[data-testid="dice-dock"]')!.getBoundingClientRect();
    return document.documentElement.scrollHeight <= innerHeight && main.top >= hud.bottom && main.bottom <= dock.top + 1 && dock.bottom <= innerHeight;
  })).toBe(true);
});

test('finishing the Boss reward enters a fresh Chapter once before its map and preserves the inter-Chapter Shop', async ({ page }) => {
  const state = newRun('chapter-boundary').state;
  state.round = 6;
  state.phase = 'flameSelection';
  state.currentNodeId = 'flame:after-round:6';
  state.flameSelection = { offers: [], acquired: true };
  state.shop = null;
  state.roundSummary = null;
  state.presentedChapters = [1];
  delete state.chapterPlans[2];
  delete state.bossSchedule[9];
  delete state.bossSchedule[12];

  await page.goto(`/?seed=${state.seed}&speed=normal`);
  await installRun(page, state);
  await page.getByRole('button', { name: 'CONTINUE TO SHOP', exact: false }).click();

  const splash = page.getByTestId('chapter-splash');
  await expect(splash).toHaveAttribute('data-chapter', '2');
  await expect(splash).toHaveText(/CHAPTER 2/);
  const map = page.getByTestId('run-map-transition');
  await expect(map).toBeVisible({ timeout: 4_000 });
  await expect(map.locator('.map-kicker')).toHaveText('CHAPTER 2');
  await expect(map.locator('.run-map-track')).toHaveAttribute('data-chapter', '2');
  await expect(map.locator('.node-label')).toHaveText([
    'R1', 'SHOP', 'R2', 'SHOP', 'MINI-BOSS', 'SPECIAL OFFER', 'SHOP',
    'R4', 'SHOP', 'R5', 'SHOP', 'BOSS', 'FLAME',
  ]);
  await expect(map.locator('.node-shop')).toHaveCount(5);
  await expect(map).not.toContainText('R6');

  await map.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(map).toHaveCount(0);
  await expect(page.locator('.shop-summary').getByText('SHOP', { exact: true })).toBeVisible();
  await expect(page.getByTestId('chapter-splash')).toHaveCount(0);
});
