import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dispatch, newRun } from '../src/game/engine';
import { hasPlayableHand, handOptions, HANDS } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { Action, GameState } from '../src/game/types';

async function ready(page: Page) { await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0); }
async function matchRound(page: Page, game: GameState) {
  await ready(page);
  await expect(page.getByTestId('stat-rerolls').getByText(String(game.manualRerollsRemaining), { exact: true })).toBeVisible();
  await expect(page.getByTestId('stat-score').getByText(String(game.score), { exact: true })).toBeVisible();
  for (const die of game.dice) {
    const button = page.getByRole('button', { name: new RegExp(`^Die ${die.id + 1}, face ${die.value},`) });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  }
}
async function reroll(page: Page, game: GameState, dieIds: number[]) {
  for (const id of dieIds) await page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) }).click();
  await page.getByRole('button', { name: `Reroll Selected — ${dieIds.length}`, exact: true }).click();
  const next = dispatch(game, { type: 'MANUAL_REROLL', dieIds });
  await matchRound(page, next.state);
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeDisabled();
  return next;
}
function deadBoardRun(rescue: boolean) {
  for (let i = 0; i < 1000; i++) {
    let game = newRun(`dead-manual-${i}`).state;
    const actions: Extract<Action, { type: 'PLAY' }>[] = [];
    for (let step = 0; step < 14; step++) {
      const choices = handOptions(game.dice, game.consumed).filter(hand => !hand.consumed)
        .flatMap(hand => hand.combinations.map(dieIds => ({ type: 'PLAY' as const, hand: hand.id, dieIds })))
        .sort((a, b) => handScore(game.dice, a.hand, a.dieIds).score - handScore(game.dice, b.hand, b.dieIds).score);
      const action = choices.find(choice => game.score + handScore(game.dice, choice.hand, choice.dieIds).score < game.target);
      if (!action) break;
      actions.push(action);
      game = dispatch(game, action).state;
    }
    if (game.phase !== 'round' || hasPlayableHand(game.dice, game.consumed)) continue;
    const original = game;
    if (rescue) {
      const next = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }).state;
      if (next.phase === 'round' && hasPlayableHand(next.dice, next.consumed)) return { seed: game.seed, actions, game: original };
    } else {
      for (let step = 0; step < 3; step++) {
        game = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }).state;
        if (hasPlayableHand(game.dice, game.consumed)) break;
      }
      if (game.phase === 'lost') return { seed: game.seed, actions, game: original };
    }
  }
  throw new Error('No suitable deterministic dead-board run found');
}
async function reachDeadBoard(page: Page, rescue: boolean) {
  const fixture = deadBoardRun(rescue);
  await page.goto(`/?seed=${fixture.seed}&speed=instant`);
  for (const action of fixture.actions) {
    await ready(page);
    for (const id of action.dieIds) await page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) }).click();
    await page.getByRole('button', { name: new RegExp(`^${HANDS[action.hand].name} `) }).click();
    await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  }
  await matchRound(page, fixture.game);
  await expect(page.getByRole('heading', { name: 'Run over' })).toHaveCount(0);
  await expect(page.getByText('Use your remaining rerolls. Select any dice below to try to make a new hand.', { exact: true })).toBeVisible();
  return fixture.game;
}

test('strategic single-die and multi-die rerolls cost charges, clear selection and preserve hand play', async ({ page }) => {
  let game = newRun('manual-browser').state;
  await page.goto('/?seed=manual-browser&speed=instant');
  await matchRound(page, game);
  await expect(page.getByRole('button', { name: 'Reroll Selected — 0', exact: true })).toBeDisabled();
  const single = await reroll(page, game, [1]);
  game = single.state;
  expect(game.manualRerollsRemaining).toBe(2);
  expect(single.events.filter(event => event.type === 'DIE_ROLLED').map(event => event.dieIds)).toEqual([[1]]);
  for (const id of [0, 2, 4]) await page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) }).click();
  await expect(page.getByRole('button', { name: 'Reroll Selected — 3', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^Die 5,/ }).click();
  const button = page.getByRole('button', { name: 'Reroll Selected — 2', exact: true });
  await expect(button).toBeEnabled();
  await page.getByText('NORMAL', { exact: true }).click();
  await button.click();
  await expect(page.getByRole('button', { name: 'Reroll Selected — 0', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Die 1,/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Skip playback' }).click();
  game = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0, 2] }).state;
  await matchRound(page, game);
  expect(game.manualRerollsRemaining).toBe(0);
  expect(game.phase).toBe('round');
  await page.getByText('INSTANT', { exact: true }).click();
  const option = handOptions(game.dice, game.consumed).find(hand => !hand.consumed)!;
  await page.getByRole('button', { name: new RegExp(`^${HANDS[option.id].name} `) }).click();
  await expect(page.getByRole('button', { name: /^Reroll Selected/ })).toBeDisabled();
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  game = dispatch(game, { type: 'PLAY', hand: option.id, dieIds: option.combinations[0] }).state;
  await matchRound(page, game);
  expect(game.manualRerollsRemaining).toBe(0);
});

test('dead board remains playable with rerolls and loses only after the final complete roll sequence', async ({ page }) => {
  let game = await reachDeadBoard(page, false);
  expect(game.manualRerollsRemaining).toBe(3);
  for (const remaining of [2, 1]) {
    game = (await reroll(page, game, [0])).state;
    expect(game.manualRerollsRemaining).toBe(remaining);
    await expect(page.getByRole('heading', { name: 'Run over' })).toHaveCount(0);
    await expect(page.getByText('Use your remaining rerolls. Select any dice below to try to make a new hand.', { exact: true })).toBeVisible();
  }
  await page.getByText('NORMAL', { exact: true }).click();
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  await page.getByRole('button', { name: 'Reroll Selected — 1', exact: true }).click();
  await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Run over' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Skip playback' }).click();
  game = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }).state;
  await matchRound(page, game);
  await expect(page.getByRole('heading', { name: 'Run over' })).toBeVisible();
  expect(game.manualRerollsRemaining).toBe(0);
});

test('a manual reroll rescues a dead board and restores legal hand controls', async ({ page }) => {
  const game = await reachDeadBoard(page, true);
  const result = await reroll(page, game, [0]);
  expect(result.state.stats.deadBoardRescues).toBe(1);
  await expect(page.getByText('Use your remaining rerolls. Select any dice below to try to make a new hand.', { exact: true })).toHaveCount(0);
  const option = handOptions(result.state.dice, result.state.consumed).find(hand => !hand.consumed)!;
  await page.getByRole('button', { name: new RegExp(`^${HANDS[option.id].name} `) }).click();
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeEnabled();
});
