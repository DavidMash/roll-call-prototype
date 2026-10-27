import { expect, test } from '@playwright/test';
import { Resolver } from '../src/game/effects';
import { newRun } from '../src/game/engine';
import { placeFlameInstance } from '../src/game/flames';
import type { GameState } from '../src/game/types';
import { enterRun, installRunState } from './uiHelpers';

const constant = { next: () => 0 };

function pendingOfferState(): GameState {
  const state = newRun('flame-pass-3b-offer', constant).state;
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
  placeFlameInstance(state, 'doubleOrNothing', 100);
  state.handLevels.ones = 3;
  state.handLevels.twos = 2;
  state.dice[0].value = 1;
  new Resolver(state, constant).play('ones', [state.dice[0].id]);
  state.dice[1].value = 2;
  return state;
}

function allInState(): GameState {
  const state = newRun('flame-pass-3b-all-in', constant).state;
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
  placeFlameInstance(state, 'allIn', 100);
  return state;
}

test('Double or Nothing presents a persistent scorecard wager and accepts it', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const state = pendingOfferState();
  await installRunState(page, state);
  await enterRun(page);

  const wager = page.getByTestId('accept-double-or-nothing-ones');
  await expect(wager).toBeVisible();
  await expect(wager).toHaveAccessibleName(/give up .* Score and replay it for ×9 XMult/i);
  await expect(page.locator('[data-testid^="double-or-nothing-target-"]')).toHaveCount(3);
  await expect(page.getByTestId('double-or-nothing-offer')).toHaveCount(0);
  await page.waitForTimeout(5_200);
  await expect(wager).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await wager.click();
  await expect(wager).toHaveCount(0);
  await expect(page.getByTestId('score-wager-status')).toContainText('DOUBLE OR NOTHING · REPLAY ONES ×9');
  await expect(page.getByTestId('round-score-progress')).toContainText('0 / 1,000,000');
});

for (const speed of ['normal', 'fast', 'instant'] as const) {
  test(`${speed} playback replaces the pending scorecard wager after the next manual Play`, async ({ page }) => {
    await installRunState(page, pendingOfferState(), speed);
    await enterRun(page);

    await expect(page.getByTestId('accept-double-or-nothing-ones')).toBeVisible();
    await page.getByTestId('scorecard-row-twos').click();
    await page.getByTestId('play-action').click();
    await expect(page.getByTestId('accept-double-or-nothing-ones')).toHaveCount(0);
    await expect(page.getByTestId('accept-double-or-nothing-twos')).toBeVisible();
  });
}

test('All In uses shared Flame Actions and clearly marks the armed next manual Play', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await installRunState(page, allInState());
  await enterRun(page);

  await page.getByTestId('flame-actions-trigger').click();
  const action = page.getByTestId('flame-action-all-in');
  await expect(action).toContainText("Failure removes that Play's Score and directly caused Free Play Score");
  await expect(action).toContainText('NEXT MANUAL PLAY ×12');
  await action.getByRole('button', { name: 'ARM ALL IN' }).click();
  await expect(page.getByTestId('score-wager-status')).toContainText('ALL IN ARMED · NEXT MANUAL PLAY ×12');

  await page.getByTestId('flame-actions-trigger').click();
  await expect(page.getByTestId('flame-action-all-in').getByRole('button', { name: 'ALL IN ARMED' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
