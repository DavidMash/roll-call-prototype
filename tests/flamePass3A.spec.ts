import { expect, test } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { placeFlameInstance, recalculateMaxCharge } from '../src/game/flames';
import { enterRun, installRunState } from './uiHelpers';

function interactiveRound() {
  const state = newRun('flame-pass-3a-ui', { next: () => .8 }).state;
  state.target = 100n;
  state.score = 25n;
  state.gold = 100;
  state.stats.rounds.at(-1)!.target = state.target;
  state.dice.forEach(die => { die.value = 5; });
  for (const flame of ['burnItDown', 'greaseTheEngine', 'lightningStrike', 'dareDevil', 'hotPotatoClock'] as const)
    placeFlameInstance(state, flame, 100);
  recalculateMaxCharge(state);
  state.interactiveFlames.hotPotatoDieId = state.dice[0].id;
  return state;
}

test('shared Flame Actions surface stays compact and supports multiple reactive actions', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await installRunState(page, interactiveRound());
  await enterRun(page);

  await expect(page.getByTestId('flame-actions-trigger')).toHaveCount(1);
  await expect(page.getByText('HOT', { exact: true })).toBeVisible();
  await page.getByTestId('flame-actions-trigger').click();
  await expect(page.getByTestId('flame-actions-list')).toBeVisible();
  for (const id of ['burn-it-down', 'grease-the-engine', 'lightning-strike', 'dare-devil'])
    await expect(page.getByTestId(`flame-action-${id}`)).toBeVisible();
  await expect(page.getByTestId('flame-action-burn-it-down')).toContainText('25% of the Round Target');
  await expect(page.getByTestId('flame-action-grease-the-engine')).toContainText('Pay 5 Gold');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByTestId('flame-action-burn-it-down').getByRole('button', { name: 'SACRIFICE SCORE' }).click();
  await expect(page.getByTestId('round-score-progress')).toContainText('0 / 100');
  await page.getByTestId('flame-actions-trigger').click();
  const burn = page.getByTestId('flame-action-burn-it-down');
  await expect(burn.getByRole('button', { name: 'SACRIFICE SCORE' })).toBeDisabled();
  await expect(burn).toContainText('Build Round Score');
});

test('Lightning Strike choice can cancel cleanly or confirm one canonical Manual Reroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await installRunState(page, interactiveRound());
  await enterRun(page);

  const reroll = page.getByTestId('manual-reroll');
  await expect(reroll).toHaveAttribute('aria-label', /3 REROLLS LEFT/);
  await page.getByTestId('flame-actions-trigger').click();
  await page.getByTestId('flame-action-lightning-strike').getByRole('button', { name: 'CHOOSE PREDICTION' }).click();
  await expect(page.getByTestId('lightning-strike-flow')).toBeVisible();
  await page.getByRole('button', { name: /D1 · FACE/ }).click();
  await page.getByRole('button', { name: 'Predicted Face: 2' }).click();
  await page.getByRole('button', { name: 'CANCEL', exact: true }).click();
  await expect(page.getByTestId('flame-actions-list')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(reroll).toHaveAttribute('aria-label', /3 REROLLS LEFT/);

  await page.getByTestId('flame-actions-trigger').click();
  await page.getByTestId('flame-action-lightning-strike').getByRole('button', { name: 'CHOOSE PREDICTION' }).click();
  await page.getByRole('button', { name: /D1 · FACE/ }).click();
  await page.getByRole('button', { name: 'Predicted Face: 2' }).click();
  await page.getByTestId('confirm-lightning-strike').click();
  await expect(reroll).toHaveAttribute('aria-label', /2 REROLLS LEFT/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
