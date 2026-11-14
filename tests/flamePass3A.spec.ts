import { expect, test } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { placeFlameInstance, recalculateMaxCharge } from '../src/game/flames';
import { rosterDice, syncActiveDiceProjection } from '../src/game/inventory';
import { createDieEffect, resetDieRoundState } from '../src/game/specialDice';
import { enterRun, installRunState, readRunState } from './uiHelpers';

function interactiveRound() {
  const state = newRun('flame-context-ui', { next: () => .8 }).state;
  state.target = 100n; state.score = 25n; state.gold = 100;
  state.stats.rounds.at(-1)!.target = state.target;
  state.dice.forEach(die => { die.value = 5; });
  for (const flame of ['burnItDown', 'greaseTheEngine', 'lightningStrike', 'dareDevil'] as const)
    placeFlameInstance(state, flame, 100);
  recalculateMaxCharge(state);
  return state;
}

test('Burn It Down and Grease the Engine use contextual Score and Charge controls with no Flame Actions surface', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await installRunState(page, interactiveRound()); await enterRun(page);

  await expect(page.getByTestId('flame-actions-trigger')).toHaveCount(0);
  await expect(page.getByTestId('flame-actions-list')).toHaveCount(0);
  const burn = page.getByTestId('burn-it-down-bar');
  await expect(burn).toContainText('Sacrifice 25 Score');
  await expect(burn).toContainText('Charge ×1 → ×1.75');
  await burn.getByTestId('burn-it-down-action').click();
  await expect(page.getByTestId('round-score-progress')).toContainText('0 / 100');
  await expect(page.getByTestId('burn-it-down-action')).toBeDisabled();
  await expect(burn).toContainText('Build Round Score');

  const grease = page.getByTestId('grease-the-engine-action');
  await expect(grease).toHaveText('GREASE 5G');
  await grease.click();
  await expect(page.getByTestId('stat-gold')).toHaveAttribute('aria-label', 'Gold 95');
  await expect(grease).toHaveText('GREASE 10G');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Lightning Strike intercepts one normal mixed-die reroll and renders the real special dice', async ({ page }) => {
  const state = interactiveRound();
  const chameleon = rosterDice(state)[0];
  chameleon.effects = [createDieEffect(chameleon.id, 'chameleon', 1)];
  chameleon.faces.forEach((face, index) => { face.rank = ([2, 2, 3, 3, 4, 4] as const)[index]; });
  syncActiveDiceProjection(state); state.dieRoundState = resetDieRoundState(rosterDice(state));
  await installRunState(page, state); await enterRun(page);

  await page.getByRole('button', { name: /^Die 1,/ }).click();
  await page.getByRole('button', { name: /^Die 2,/ }).click();
  const reroll = page.getByTestId('manual-reroll');
  await expect(reroll).toHaveAccessibleName(/Opens Lightning Strike prediction/);
  await reroll.click();
  const dialog = page.getByRole('dialog', { name: /Lightning Strike/ });
  await expect(dialog).toContainText('Submit your prediction');
  await expect(page.getByTestId('lightning-prediction-row').locator('.die-slot')).toHaveCount(2);
  await expect(page.getByTestId(`lightning-prediction-${chameleon.id}`)).toContainText('Chameleon');
  await page.getByRole('button', { name: 'Next prediction for Die 1' }).click();
  await page.getByTestId('confirm-lightning-strike').click();
  await expect.poll(async () => (await readRunState(page))?.manualRerollsUsedThisRound).toBe(1);
  await expect.poll(async () => (await readRunState(page))?.manualRerollsRemaining).toBe(1);
});

test('Dare Devil intercepts an eligible Ultimate and supports PLAY NOW and RISK IT', async ({ page }) => {
  const state = interactiveRound();
  await installRunState(page, state); await enterRun(page);
  await page.getByTestId('scorecard-row-fiveKind').click();
  await page.getByTestId('play-action').click();
  const dialog = page.getByRole('dialog', { name: /Dare Devil/ });
  await expect(dialog).toContainText('Up the ante by rerolling all dice?');
  await expect(dialog).toContainText('DARE 0/4');
  await page.getByTestId('dare-devil-play-now').click();
  await expect.poll(async () => (await readRunState(page))?.roundPlayCount).toBe(1);

  await installRunState(page, interactiveRound()); await enterRun(page);
  await page.getByTestId('scorecard-row-fiveKind').click();
  await page.getByTestId('play-action').click();
  await page.getByTestId('dare-devil-risk-it').click();
  await expect.poll(async () => (await readRunState(page))?.interactiveFlames.dareDevilCount).toBe(1);
  await expect.poll(async () => (await readRunState(page))?.roundPlayCount).toBe(0);
  await expect(page.getByTestId('score-wager-status')).toContainText('DARE DEVIL ×3');
});
