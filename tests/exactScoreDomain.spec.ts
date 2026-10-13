import { expect, test } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { enterRun, installRunState } from './uiHelpers';

test('huge score, Goal, Inferno, progress, and Warden text retain every digit', async ({ page }) => {
  const state = newRun('exact-score-browser', { next: () => .99 }).state;
  const goal = 59_604_644_775_390_625n;
  state.score = goal - 1n;
  state.target = goal;
  state.stats.rounds[0].target = goal;
  state.stats.rounds[0].finalScore = goal - 1n;
  state.engulfmentLevel = 12;
  state.boss = { type: 'warden', activeDieIds: [0], startingDieId: 0, nextUnlockTarget: goal,
    unlockCosts: [goal], unlockTargets: [goal], pendingReinforcements: 0 };

  await installRunState(page, state);
  await enterRun(page);

  await expect(page.getByTestId('round-goal-progress')).toHaveAttribute('aria-valuetext',
    '59,604,644,775,390,624 of 59,604,644,775,390,625 points toward the Goal');
  await expect(page.getByLabel('Inferno status')).toContainText('59,604,644,775,390,625');
  await page.getByRole('button', { name: 'Boss information' }).click();
  await expect(page.getByTestId('boss-info-modal')).toContainText('Next unlock at 59,604,644,775,390,625 score.');
});
