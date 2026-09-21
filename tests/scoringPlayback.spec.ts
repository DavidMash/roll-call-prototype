import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CONFIG } from '../src/game/config';
import { dispatch, newRun } from '../src/game/engine';
import { HANDS } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { Action, GameState } from '../src/game/types';
import { scoringPlaybackRun } from './scoringFixture';

async function ready(page: Page) {
  await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0);
}
async function selectDice(page: Page, dieIds: number[]) {
  for (const id of dieIds) await page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) }).click();
}
async function perform(page: Page, game: GameState, action: Action) {
  if (action.type === 'PLAY') {
    await page.getByRole('button', { name: new RegExp(`^${HANDS[action.hand].name} `) }).click();
    for (const physical of game.dice) {
      const target = page.getByRole('button', { name: new RegExp(`^Die ${physical.id + 1},`) });
      const selected = await target.getAttribute('aria-pressed') === 'true';
      if (selected !== action.dieIds.includes(physical.id)) await target.click();
    }
    await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  } else if (action.type === 'BUY') {
    const offer = game.shop!.offers.find(item => item.id === action.offerId)!;
    await page.getByTestId(`offer-${offer.enhancement}`).getByRole('button').click();
    await selectDice(page, [action.dieId]);
  } else if (action.type === 'NEXT_ROUND') {
    await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  } else if (action.type === 'CHOOSE_FLAME') {
    const offer = game.flameReward!.offers.find(item => item.id === action.offerId)!;
    await page.getByTestId(`flame-offer-${offer.flame}`).getByRole('button', { name: 'Select Flame' }).click();
    await page.getByRole('button', { name: new RegExp(`^Die ${action.dieId + 1},`) }).click();
    if (game.dice[action.dieId].flame) await page.getByRole('button', { name: 'Replace Flame', exact: true }).click();
  } else if (action.type === 'CONTINUE_FLAME_REWARD') {
    await page.getByRole('button', { name: 'CONTINUE TO SHOP', exact: false }).click();
  } else if (action.type === 'MANUAL_REROLL') {
    await selectDice(page, action.dieIds);
    await page.getByRole('button', { name: `Reroll Selected — ${action.dieIds.length}`, exact: true }).click();
  } else throw new Error(`Unexpected fixture action: ${action.type}`);
  await ready(page);
  return dispatch(game, action).state;
}

test('live Pips and Mult build through Bonus, Multiplier and Hitchhiker before one final award', async ({ page }) => {
  const fixture = scoringPlaybackRun();
  const final = fixture.result.events.find(event => event.type === 'HAND_SCORE_FINALIZED')!;
  const started = fixture.result.events.find(event => event.type === 'HAND_STARTED')!;
  let game = newRun(fixture.seed).state;
  await page.goto(`/?seed=${fixture.seed}&speed=instant`);
  await ready(page);
  for (const action of fixture.actions) game = await perform(page, game, action);
  expect(game).toEqual(fixture.game);
  await expect(page.getByTestId('stat-score').getByText(String(game.score), { exact: true })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`^${HANDS[fixture.action.hand].name} `) }).click();
  for (const physical of game.dice) {
    const target = page.getByRole('button', { name: new RegExp(`^Die ${physical.id + 1},`) });
    const selected = await target.getAttribute('aria-pressed') === 'true';
    if (selected !== fixture.action.dieIds.includes(physical.id)) await target.click();
  }
  const deterministicPreview = handScore(game.dice, fixture.action.hand, fixture.action.dieIds, game.handLevels[fixture.action.hand]);
  await expect(page.locator('.selection-preview')).toContainText(`${deterministicPreview.pips} pips × ${deterministicPreview.multiplier}`);

  await page.clock.install({ time: new Date('2026-09-17T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-17T12:00:01Z'));
  await page.getByText('NORMAL', { exact: true }).click();
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  const observed: [string, number, number][] = [];
  for (const [index, event] of fixture.result.events.entries()) {
    await expect(page.getByText(`EVENT ${index + 1} / ${fixture.result.events.length}`, { exact: true })).toBeVisible();
    if (event.handScore) {
      await expect(page.getByTestId('hand-pips')).toHaveText(String(event.handScore.currentPips));
      await expect(page.getByTestId('hand-multiplier')).toHaveText(`x${event.handScore.currentMultiplier}`);
      await expect(page.getByTestId('stat-score').getByText(String(event.board.score), { exact: true })).toBeVisible();
      if (event.type !== 'SCORE_ADDED') expect(event.board.score).toBe(game.score);
      if (event.type === 'HAND_STARTED') {
        expect(event.handScore.basePips).toBe(started.handScore!.basePips);
        await expect(page.getByTestId('hand-pips')).toHaveText(String(started.handScore!.basePips));
      }
      if (event.type === 'HAND_PIPS_CHANGED' && event.enhancement === 'bonus') {
        await expect(page.locator('.score-tick')).toHaveText('BONUS');
        observed.push(['Bonus', event.handScore.currentPips, event.handScore.currentMultiplier]);
      }
      if (event.type === 'HAND_MULTIPLIER_CHANGED') {
        await expect(page.locator('.score-tick')).toHaveText('MULTIPLIER');
        observed.push(['Multiplier', event.handScore.currentPips, event.handScore.currentMultiplier]);
      }
      if (event.type === 'HITCHHIKER_ADDED_PIPS') {
        await expect(page.locator('.score-tick')).toHaveText('HITCHHIKER');
        observed.push(['Hitchhiker', event.handScore.currentPips, event.handScore.currentMultiplier]);
      }
      if (event.type === 'HAND_SCORE_FINALIZED') await expect(page.locator('.score-tick')).toHaveText(`+${final.amount}`);
    }
    if (event.type === 'SCORE_ADDED' && event.source === 'hand') {
      await expect(page.locator('.score-tick')).toHaveText(`+${final.amount}`);
      break;
    }
    await page.clock.runFor(CONFIG.tickMs.normal);
  }
  const expectedStages = fixture.result.events.filter(event =>
    (event.type === 'HAND_PIPS_CHANGED' && event.enhancement === 'bonus')
    || event.type === 'HAND_MULTIPLIER_CHANGED' || event.type === 'HITCHHIKER_ADDED_PIPS');
  expect(expectedStages).toHaveLength(3);
  expect(observed).toEqual(expectedStages.map(event => [
    event.enhancement === 'bonus' ? 'Bonus' : event.enhancement === 'multiplier' ? 'Multiplier' : 'Hitchhiker',
    event.handScore!.currentPips, event.handScore!.currentMultiplier,
  ]));
  await page.getByRole('button', { name: 'Skip playback' }).click();
  await ready(page);
  await expect(page.getByTestId('stat-score').getByText(String(fixture.result.state.score), { exact: true })).toBeVisible();
});
