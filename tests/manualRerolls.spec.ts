import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dispatch, newRun } from '../src/game/engine';
import { hasPlayableHand, handOptions, HANDS, HAND_IDS } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { Action, GameState } from '../src/game/types';
import { enterRun, setPlaybackSpeed } from './uiHelpers';
import { RUN_STORAGE_KEY, RUN_STORAGE_VERSION } from '../src/game/persistence';

async function ready(page: Page) {
  await page.locator('main').waitFor();
  await enterRun(page);
  for (let barrier = 0; barrier < 2; barrier++) {
    await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0);
    const bustContinue = page.getByTestId('run-action-row').getByRole('button', { name: 'Continue', exact: true });
    if (await bustContinue.count()) { await bustContinue.click(); continue; }
    const map = page.getByTestId('run-map-transition');
    if (await map.count()) {
      await page.getByTestId('run-action-row').getByRole('button', { name: 'Continue', exact: true }).evaluate(element => (element as HTMLElement).click());
      await expect(map).toHaveCount(0);
      continue;
    }
    break;
  }
}
async function matchRound(page: Page, game: GameState) {
  await ready(page);
  await expect(page.getByTestId('round-score-progress')).toHaveText(`${game.score} / ${game.target}`);
  for (const die of game.dice) {
    const button = page.getByRole('button', { name: new RegExp(`^Die ${die.id + 1}, face ${die.value},`) });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  }
}
async function reroll(page: Page, game: GameState, dieIds: number[]) {
  for (const id of dieIds) await page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) }).click();
  await page.getByTestId('manual-reroll').click();
  const next = dispatch(game, { type: 'MANUAL_REROLL', dieIds });
  await matchRound(page, next.state);
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeDisabled();
  return next;
}
function deadBoardRun(rescue: boolean) {
  for (let i = 0; i < 1000; i++) {
    let game = newRun(`dead-manual-${i}`).state;
    const prefix: Action[] = [];
    // This fixture targets ordinary dead-board behavior; stay before the first Boss.
    for (let round = 1; round <= 2 && game.phase !== 'lost'; round++) {
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
      if (game.phase === 'roundSummary') {
        const action: Action = { type: 'CONTINUE_ROUND_SUMMARY' };
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
async function installRun(page: Page, state: GameState) {
  await page.evaluate(([key, version, saved]) => localStorage.setItem(key, JSON.stringify({ version, state: saved })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, state] as const);
  await page.reload();
  await ready(page);
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
      await page.getByTestId('manual-reroll').click();
    } else if (action.type === 'NEXT_ROUND') {
      await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
    } else if (action.type === 'CONTINUE_ROUND_SUMMARY') {
      await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
    } else if (action.type === 'RETRY_ROUND') {
      await page.getByRole('button', { name: /^RETRY ROUND / }).click();
    }
  }
  await matchRound(page, fixture.game);
  await expect(page.getByRole('heading', { name: 'Run Over' })).toHaveCount(0);
  await expect(page.getByText('Use a Reroll.', { exact: true })).toBeVisible();
  return fixture.game;
}

test('strategic single-die and multi-die rerolls cost charges, clear selection and preserve hand play', async ({ page }) => {
  let game = newRun('manual-browser').state;
  await page.goto('/?seed=manual-browser&speed=instant');
  await matchRound(page, game);
  await expect(page.getByTestId('manual-reroll')).toHaveAccessibleName('REROLL · 3 REROLLS REMAINING');
  await expect(page.getByTestId('manual-reroll')).toHaveAttribute('data-normal-fill-percent', '100');
  await expect(page.getByTestId('manual-reroll')).toBeDisabled();
  const single = await reroll(page, game, [1]);
  game = single.state;
  expect(game.manualRerollsRemaining).toBe(2);
  await expect(page.getByTestId('manual-reroll')).toHaveAccessibleName('REROLL · 2 REROLLS REMAINING');
  await expect(page.getByTestId('manual-reroll')).toHaveAttribute('data-normal-fill-percent', '67');
  expect(single.events.filter(event => event.type === 'DIE_ROLLED').map(event => event.dieIds)).toEqual([[1]]);
  for (const id of [0, 2, 4]) await page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) }).click();
  await expect(page.getByTestId('manual-reroll')).toHaveAccessibleName('REROLL 3 DICE · 2 REROLLS REMAINING');
  await expect(page.getByTestId('manual-reroll')).toBeDisabled();
  await page.getByRole('button', { name: /^Die 5,/ }).click();
  const button = page.getByTestId('manual-reroll');
  await expect(button).toBeEnabled();
  await setPlaybackSpeed(page, 'NORMAL');
  await button.click();
  await expect(page.getByTestId('manual-reroll')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Die 1,/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Skip playback' }).click();
  game = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0, 2] }).state;
  await matchRound(page, game);
  expect(game.manualRerollsRemaining).toBe(0);
  await expect(page.getByTestId('manual-reroll')).toHaveAttribute('data-normal-fill-percent', '0');
  expect(game.phase).toBe('round');
  await setPlaybackSpeed(page, 'INSTANT');
  const option = handOptions(game.dice, game.consumed).find(hand => !hand.consumed)!;
  await page.getByRole('button', { name: new RegExp(`^${HANDS[option.id].name} `) }).click();
  await expect(page.getByTestId('manual-reroll')).toBeDisabled();
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  game = dispatch(game, { type: 'PLAY', hand: option.id, dieIds: option.combinations[0] }).state;
  await matchRound(page, game);
  expect(game.manualRerollsRemaining).toBe(0);
});

test('Reroll control separates selected dice from normal and Care Package resources responsively', async ({ page }) => {
  let game = newRun('care-package-reroll-ui').state;
  game.specialOfferEffects.carePackageRerolls = 3;
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`/?seed=${game.seed}&speed=instant`);
  await installRun(page, game);

  const button = page.getByTestId('manual-reroll');
  await expect(button).toHaveAccessibleName('REROLL · 3 REROLLS REMAINING + 3');
  await expect(button).toHaveAttribute('data-normal-fill-percent', '100');
  await expect(page.getByTestId('special-effect-carePackage')).toHaveText('Care Package · 3 Rerolls Left');

  for (const id of [0, 1]) await page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) }).click();
  await expect(button).toHaveAccessibleName('REROLL 2 DICE · 3 REROLLS REMAINING + 3');
  await button.click();
  game = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0, 1] }).state;
  await matchRound(page, game);
  const actionLayout = await page.evaluate(() => {
    const dock = document.querySelector<HTMLElement>('[data-testid="dice-dock"]')!.getBoundingClientRect();
    const row = document.querySelector<HTMLElement>('[data-testid="run-action-row"]')!.getBoundingClientRect();
    const reroll = document.querySelector<HTMLElement>('[data-testid="manual-reroll"]')!.getBoundingClientRect();
    const play = document.querySelector<HTMLElement>('[data-testid="play-action"]')!.getBoundingClientRect();
    return { dockBottom: dock.bottom, rowTop: row.top, rowRight: row.right, rerollLeft: reroll.left, playLeft: play.left, playRight: play.right };
  });
  expect(actionLayout.dockBottom).toBeLessThanOrEqual(actionLayout.rowTop + 1);
  expect(actionLayout.rerollLeft).toBeLessThan(actionLayout.playLeft);
  expect(actionLayout.rowRight - actionLayout.playRight).toBeLessThan(12);
  expect(game).toMatchObject({ manualRerollsRemaining: 1, specialOfferEffects: { carePackageRerolls: 3 } });
  await expect(button).toHaveAccessibleName('REROLL · 1 REROLL REMAINING + 3');
  await expect(button).toHaveAttribute('data-normal-fill-percent', '33');

  for (const id of [0, 1]) await page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) }).click();
  await button.click();
  game = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0, 1] }).state;
  await matchRound(page, game);
  expect(game).toMatchObject({ manualRerollsRemaining: 0, specialOfferEffects: { carePackageRerolls: 2 } });
  await expect(button).toHaveAccessibleName('REROLL · 0 REROLLS REMAINING + 2');
  await expect(button).toHaveAttribute('data-normal-fill-percent', '0');
  await expect(page.getByTestId('special-effect-carePackage')).toHaveText('Care Package · 2 Rerolls Left');
  await expect(button.locator('.reroll-action-resource')).not.toContainText('CARE PACKAGE');
  expect(await button.locator('.reroll-action-resource').evaluate(element => ({
    singleLine: element.getBoundingClientRect().height < parseFloat(getComputedStyle(element).lineHeight) * 1.5,
    fits: element.scrollWidth <= element.clientWidth,
  }))).toEqual({ singleLine: true, fits: true });

  for (const id of [0, 1]) await page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) }).click();
  await button.click();
  game = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0, 1] }).state;
  await ready(page);
  expect(game.specialOfferEffects.carePackageRerolls).toBe(0);
  await expect(page.getByTestId('special-effect-carePackage')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('dead-board UI and engine stay usable while only Care Package Rerolls remain', async ({ page }) => {
  let game = newRun('care-package-dead-board-ui').state;
  game.target = 999;
  game.consumed = [...HAND_IDS];
  game.manualRerollsRemaining = 0;
  game.specialOfferEffects.carePackageRerolls = 3;
  await page.goto(`/?seed=${game.seed}&speed=instant`);
  await installRun(page, game);

  const button = page.getByTestId('manual-reroll');
  await expect(page.getByRole('status', { name: 'NO PLAYABLE HANDS' })).toContainText('Use a Reroll.');
  await expect(button).toHaveAccessibleName('REROLL · 0 REROLLS REMAINING + 3');
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  await expect(button).toBeEnabled();
  await button.click();
  game = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }).state;
  await matchRound(page, game);
  expect(game.phase).toBe('round');
  expect(game.specialOfferEffects.carePackageRerolls).toBe(2);
  await expect(button).toHaveAccessibleName('REROLL · 0 REROLLS REMAINING + 2');
  await expect(page.getByTestId('special-effect-carePackage')).toHaveText('Care Package · 2 Rerolls Left');
  await expect(page.getByRole('heading', { name: 'Run Over' })).toHaveCount(0);
});

test('Bust UI and retry keep a depleted Care Package reserve depleted', async ({ page }) => {
  let game = newRun('care-package-bust-checkpoint-ui').state;
  game.specialOfferEffects.carePackageRerolls = 3;
  game.roundCheckpoint!.specialOfferEffects.carePackageRerolls = 3;
  game.target = 1_000_000;
  game.consumed = [...HAND_IDS];
  game = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0, 1, 2] }).state;
  game = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0, 1, 2] }).state;
  expect(game.phase).toBe('shop');
  expect(game.specialOfferEffects.carePackageRerolls).toBe(0);

  await page.goto(`/?seed=${game.seed}&speed=instant`);
  await installRun(page, game);
  await expect(page.getByTestId('bust-shop-banner')).toBeVisible();
  await expect(page.getByTestId('special-effect-carePackage')).toHaveCount(0);

  await page.getByRole('button', { name: `RETRY ROUND ${game.round}`, exact: true }).click();
  game = dispatch(game, { type: 'RETRY_ROUND' }).state;
  await matchRound(page, game);
  await expect(page.getByTestId('manual-reroll')).toHaveAccessibleName('REROLL · 3 REROLLS REMAINING');
  await expect(page.getByTestId('special-effect-carePackage')).toHaveCount(0);
});

test('normal Reroll fill exposes deterministic 100/67/33/0 percent states', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  for (const [remaining, fill] of [[3, 100], [2, 67], [1, 33], [0, 0]] as const) {
    const state = newRun(`reroll-fill-${remaining}`).state;
    state.manualRerollsRemaining = remaining;
    await page.goto(`/?seed=${state.seed}&speed=instant`);
    await installRun(page, state);
    await expect(page.getByTestId('manual-reroll')).toHaveAttribute('data-normal-fill-percent', String(fill));
  }
});

for (const playbackSpeed of ['normal', 'instant'] as const) test(`dead board Bust waits for Continue at ${playbackSpeed} playback speed`, async ({ page }) => {
  let game = await reachDeadBoard(page, false);
  expect(game.manualRerollsRemaining).toBe(3);
  for (const remaining of [2, 1]) {
    game = (await reroll(page, game, [0])).state;
    expect(game.manualRerollsRemaining).toBe(remaining);
    await expect(page.getByRole('heading', { name: 'Run Over' })).toHaveCount(0);
    await expect(page.getByText('Use a Reroll.', { exact: true })).toBeVisible();
  }
  if (playbackSpeed === 'normal') await setPlaybackSpeed(page, 'NORMAL');
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  await page.getByTestId('manual-reroll').click();
  await expect(page.getByRole('heading', { name: 'Run Over' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: `ROUND ${game.round} BUST`, exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('1 Life Lost', { exact: true })).toBeVisible();
  const bustContinue = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(bustContinue).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByRole('heading', { name: `ROUND ${game.round} BUST`, exact: true })).toBeVisible();
  const failedRound = game.round;
  const expectedShop = structuredClone(game.roundCheckpoint?.shop);
  game = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }).state;
  await bustContinue.click();
  const fallbackMap = page.getByTestId('run-map-transition');
  await expect(fallbackMap).toBeVisible({ timeout: 15000 });
  const fallbackConnector = fallbackMap.getByTestId('active-map-connector');
  await expect(fallbackConnector).toHaveClass(/route-backward/);
  const fallbackConnectorStyle = await fallbackConnector.evaluate(element => {
    const style = getComputedStyle(element);
    return { animationName: style.animationName, stroke: style.stroke, pathLength: element.getAttribute('pathLength') };
  });
  expect(fallbackConnectorStyle.animationName).toBe('map-route-fill-backward');
  expect(fallbackConnectorStyle.stroke).toBe('rgb(245, 158, 11)');
  expect(fallbackConnectorStyle.pathLength).toBe('1');
  await page.getByTestId('run-action-row').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('bust-shop-banner')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/C\d+ R\d+ BUST/)).toBeVisible();
  await expect(page.getByText('1 Life Lost', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `RETRY ROUND ${game.round}`, exact: true })).toBeVisible();
  expect(game.phase).toBe('shop');
  expect(game.lives).toBe(2);
  expect(game.shop).toEqual(expectedShop);
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  await expect(page.getByRole('dialog', { name: /D1 .* MANAGE DIE/ })).toBeVisible();
  await page.getByRole('dialog', { name: /D1 .* MANAGE DIE/ }).getByRole('button', { name: 'Close' }).click();
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
  await expect(page.getByText('Use a Reroll.', { exact: true })).toHaveCount(0);
  const option = handOptions(result.state.dice, result.state.consumed).find(hand => !hand.consumed)!;
  await page.getByRole('button', { name: new RegExp(`^${HANDS[option.id].name} `) }).click();
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeEnabled();
});
