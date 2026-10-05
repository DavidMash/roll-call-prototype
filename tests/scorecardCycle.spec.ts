import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { activeFace } from '../src/game/dice';
import { newRun } from '../src/game/engine';
import { HAND_IDS } from '../src/game/hands';
import { RUN_STORAGE_KEY, RUN_STORAGE_VERSION } from '../src/game/persistence';
import type { GameState, Rank } from '../src/game/types';
import { enterRun } from './uiHelpers';

function cycleState(seed: string): GameState {
  const state = newRun(seed, { next: () => 0 }).state;
  state.target = 1_000_000;
  state.stats.rounds[0].target = state.target;
  state.score = 73;
  state.gold = 19;
  state.manualRerollsRemaining = 2;
  state.targetPracticeHand = 'ones';
  state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
  state.scorecardCycleConsumed = [...state.consumed];
  state.dice.forEach((die, index) => { die.value = (index + 1) as Rank; });
  activeFace(state.dice[0]).enhancements.sticky = 1;
  return state;
}

async function install(page: Page, state: GameState, speed: 'normal' | 'fast' | 'instant') {
  await page.goto(`/?seed=${state.seed}&speed=${speed}`);
  await page.evaluate(([key, version, saved]) => localStorage.setItem(key, JSON.stringify({ version, state: saved })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, state] as const);
  await page.reload();
  await enterRun(page);
}

async function playFinalHand(page: Page) {
  await page.getByTestId('scorecard-row-ones').click();
  await page.getByTestId('play-action').click();
}

test('filled scorecard reactivates Used rows and shows the exact accessible celebration', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page, cycleState('scorecard-cycle-ui'), 'normal');
  await expect(page.locator('.scorecard-row.consumed')).toHaveCount(HAND_IDS.length - 1);

  await playFinalHand(page);
  const celebration = page.getByTestId('scorecard-refresh-celebration');
  await expect(celebration).toBeVisible();
  await expect(celebration.locator('span')).toHaveText('SCORECARD FILLED');
  await expect(celebration.locator('strong')).toHaveText('ALL HANDS REFRESHED');
  await expect(celebration).toHaveAccessibleName('Scorecard filled. All hands refreshed.');
  await expect(page.locator('.scorecard-row.consumed')).toHaveCount(0);
  await expect(page.getByText('USED', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('scorecard-row-ones')).toContainText('TARGET');
  expect(await celebration.evaluate(element => getComputedStyle(element).animationName)).toContain('scorecard-refresh-celebration');
  expect(await page.locator('.scorecard-panel.is-refreshing .scorecard-row').first()
    .evaluate(element => getComputedStyle(element).animationName)).toContain('scorecard-row-reactivate');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
    && document.documentElement.scrollHeight <= innerHeight)).toBe(true);

  await expect(celebration).toHaveCount(0, { timeout: 2_000 });
  await expect(page.getByTestId('scorecard-row-ones')).not.toBeDisabled();
  await expect(page.getByTestId('round-score-progress')).toContainText('81');
  await expect(page.getByTestId('stat-gold')).toContainText('19');
  await expect(page.getByTestId('manual-reroll')).toHaveAccessibleName(/2 REROLLS REMAINING/);
});

for (const speed of ['fast', 'instant'] as const) {
  test(`${speed} playback still presents the scorecard refresh moment`, async ({ page }) => {
    await install(page, cycleState(`scorecard-cycle-${speed}`), speed);
    await playFinalHand(page);
    await expect(page.getByTestId('scorecard-refresh-celebration')).toBeVisible();
    await expect(page.getByTestId('scorecard-refresh-celebration')).toContainText('SCORECARD FILLED');
    await expect(page.getByTestId('scorecard-refresh-celebration')).toContainText('ALL HANDS REFRESHED');
    await expect(page.getByTestId('scorecard-refresh-celebration')).toHaveCount(0, { timeout: 2_000 });
  });
}

test('reduced motion keeps the refresh announcement while removing sweep animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await install(page, cycleState('scorecard-cycle-reduced-motion'), 'instant');
  await playFinalHand(page);
  const refreshSnapshot = await page.waitForFunction(() => {
    const celebration = document.querySelector<HTMLElement>('[data-testid="scorecard-refresh-celebration"]');
    const row = document.querySelector<HTMLElement>('.scorecard-panel .scorecard-row');
    if (!celebration || !row || celebration.getClientRects().length === 0) return null;
    return {
      accessibleName: celebration.getAttribute('aria-label'),
      celebrationAnimation: getComputedStyle(celebration).animationName,
      rowAnimation: getComputedStyle(row).animationName,
    };
  });
  const snapshot = await refreshSnapshot.jsonValue();
  expect(snapshot).not.toBeNull();
  if (!snapshot) throw new Error('Scorecard refresh snapshot was not captured.');
  expect(snapshot.accessibleName).toBe('Scorecard filled. All hands refreshed.');
  expect(['', 'none']).toContain(snapshot.celebrationAnimation);
  expect(['', 'none']).toContain(snapshot.rowAnimation);
});
