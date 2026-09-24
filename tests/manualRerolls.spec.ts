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
    const prefix: Action[] = [];
    for (let round = 1; round <= 5 && game.phase !== 'lost'; round++) {
      let attempt = structuredClone(game);
      const attemptActions: Action[] = [];
      while (attempt.phase === 'round') {
        const choices = handOptions(attempt.dice, attempt.consumed).filter(hand => !hand.consumed)
          .flatMap(hand => hand.combinations.map(dieIds => ({ type: 'PLAY' as const, hand: hand.id, dieIds })))
          .sort((a, b) => handScore(attempt.dice, a.hand, a.dieIds).score - handScore(attempt.dice, b.hand, b.dieIds).score);
        const action = choices.find(choice => attempt.score + handScore(attempt.dice, choice.hand, choice.dieIds).score < attempt.target);
        if (!action) break;
        attemptActions.push(action);
        attempt = dispatch(attempt, action).state;
      }
      if (attempt.phase === 'round' && !hasPlayableHand(attempt.dice, attempt.consumed)) {
        const original = structuredClone(attempt);
        let resolved = attempt;
        if (rescue) {
          resolved = dispatch(resolved, { type: 'MANUAL_REROLL', dieIds: [0] }).state;
          if (resolved.phase === 'round' && hasPlayableHand(resolved.dice, resolved.consumed)) {
            return { seed: game.seed, actions: [...prefix, ...attemptActions], game: original };
          }
        } else {
          let remainsDeadUntilLoss = true;
          for (let step = 0; step < 3; step++) {
            resolved = dispatch(resolved, { type: 'MANUAL_REROLL', dieIds: [0] }).state;
            if (step < 2 && (resolved.phase !== 'round' || hasPlayableHand(resolved.dice, resolved.consumed))) {
              remainsDeadUntilLoss = false;
            }
          }
          if (remainsDeadUntilLoss && resolved.phase === 'shop' && resolved.bust) {
            return { seed: game.seed, actions: [...prefix, ...attemptActions], game: original };
          }
        }
      }
      while (game.phase === 'round') {
        const best = handOptions(game.dice, game.consumed).filter(hand => !hand.consumed)
          .flatMap(hand => hand.combinations.map(dieIds => ({ type: 'PLAY' as const, hand: hand.id, dieIds })))
          .sort((a, b) => handScore(game.dice, b.hand, b.dieIds).score - handScore(game.dice, a.hand, a.dieIds).score)[0];
        const action: Action = best ?? { type: 'MANUAL_REROLL', dieIds: [0] };
        prefix.push(action);
        game = dispatch(game, action).state;
      }
      if (game.phase === 'shop') {
        const action: Action = game.bust ? { type: 'RETRY_ROUND' } : { type: 'NEXT_ROUND' };
        prefix.push(action);
        game = dispatch(game, action).state;
      }
    }
  }
  throw new Error('No suitable deterministic dead-board run found');
}
async function reachDeadBoard(page: Page, rescue: boolean) {
  const fixture = deadBoardRun(rescue);
  await page.goto(`/?seed=${fixture.seed}&speed=instant`);
  for (const action of fixture.actions) {
    await ready(page);
    if (action.type === 'PLAY') {
      await page.getByRole('button', { name: new RegExp(`^${HANDS[action.hand].name} `) }).click();
      for (let id = 0; id < 5; id++) {
        const physical = page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) });
        const selected = await physical.getAttribute('aria-pressed') === 'true';
        if (selected !== action.dieIds.includes(id)) await physical.click();
      }
      await page.getByRole('button', { name: 'PLAY', exact: true }).click();
    } else if (action.type === 'MANUAL_REROLL') {
      for (const id of action.dieIds) await page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) }).click();
      await page.getByRole('button', { name: `Reroll Selected — ${action.dieIds.length}`, exact: true }).click();
    } else if (action.type === 'NEXT_ROUND') {
      await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
    } else if (action.type === 'RETRY_ROUND') {
      await page.getByRole('button', { name: /^RETRY ROUND / }).click();
    }
  }
  await matchRound(page, fixture.game);
  await expect(page.getByRole('heading', { name: 'Run over' })).toHaveCount(0);
  await expect(page.getByText('Select dice and use a reroll.', { exact: true })).toBeVisible();
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
    await expect(page.getByText('Select dice and use a reroll.', { exact: true })).toBeVisible();
  }
  await page.getByText('NORMAL', { exact: true }).click();
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  await page.getByRole('button', { name: 'Reroll Selected — 1', exact: true }).click();
  await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Run over' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'BUST', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('1 LIFE LOST', { exact: true })).toBeVisible();
  const failedRound = game.round;
  const expectedShop = structuredClone(game.roundCheckpoint?.shop);
  game = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }).state;
  await expect(page.getByTestId('bust-shop-banner')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/ROUND \d+ BUST · 1 LIFE LOST/)).toBeVisible();
  await expect(page.getByRole('button', { name: `RETRY ROUND ${game.round}`, exact: true })).toBeVisible();
  expect(game.phase).toBe('shop');
  expect(game.lives).toBe(2);
  expect(game.shop).toEqual(expectedShop);
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  await expect(page.getByRole('dialog', { name: /D1 .* Manage Die/ })).toBeVisible();
  await page.getByRole('dialog', { name: /D1 .* Manage Die/ }).getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('stat-lives').click();
  await expect(page.getByRole('dialog', { name: 'RESTORE LIVES' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: `RETRY ROUND ${failedRound}`, exact: true }).click();
  game = dispatch(game, { type: 'RETRY_ROUND' }).state;
  await matchRound(page, game);
  expect(game.round).toBe(failedRound);
  expect(game.roundAttemptNumber).toBeGreaterThan(1);
});

test('a manual reroll rescues a dead board and restores legal hand controls', async ({ page }) => {
  const game = await reachDeadBoard(page, true);
  const result = await reroll(page, game, [0]);
  expect(result.state.stats.deadBoardRescues).toBe(1);
  await expect(page.getByText('Select dice and use a reroll.', { exact: true })).toHaveCount(0);
  const option = handOptions(result.state.dice, result.state.consumed).find(hand => !hand.consumed)!;
  await page.getByRole('button', { name: new RegExp(`^${HANDS[option.id].name} `) }).click();
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeEnabled();
});
