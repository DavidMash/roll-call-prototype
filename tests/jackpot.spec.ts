import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CONFIG } from '../src/game/config';
import { dispatch, newRun } from '../src/game/engine';
import { HANDS } from '../src/game/hands';
import type { Action, GameState } from '../src/game/types';
import { jackpotRun } from './jackpotFixture';

const die = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) });
async function ready(page: Page) { await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0); }
async function selectPlay(page: Page, game: GameState, action: Extract<Action, { type: 'PLAY' }>) {
  await page.getByRole('button', { name: new RegExp(`^${HANDS[action.hand].name} `) }).click();
  for (const physical of game.dice) {
    const shouldSelect = action.dieIds.includes(physical.id);
    const selected = await die(page, physical.id).getAttribute('aria-pressed') === 'true';
    if (selected !== shouldSelect) await die(page, physical.id).click();
  }
}
async function perform(page: Page, game: GameState, action: Action) {
  if (action.type === 'PLAY') {
    await selectPlay(page, game, action);
    await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  } else if (action.type === 'MANUAL_REROLL') {
    for (const id of action.dieIds) await die(page, id).click();
    await page.getByRole('button', { name: `Reroll Selected — ${action.dieIds.length}`, exact: true }).click();
  } else if (action.type === 'BUY') {
    const offer = game.shop!.offers.find(item => item.id === action.offerId)!;
    await page.getByTestId(`offer-${offer.enhancement}`).getByRole('button').click();
    await die(page, action.dieId).click();
  } else if (action.type === 'NEXT_ROUND') {
    await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  } else throw new Error(`Unsupported fixture action: ${action.type}`);
  await ready(page);
  return dispatch(game, action).state;
}

test('scoring Jackpot pays on a played-hand clear before the no-reroll transition', async ({ page }) => {
  const fixture = jackpotRun();
  let game = newRun(fixture.seed).state;
  await page.goto(`/?seed=${fixture.seed}&speed=instant`);
  await ready(page);
  for (const action of fixture.actions) game = await perform(page, game, action);
  expect(game).toEqual(fixture.game);
  await expect(die(page, fixture.heldDieId)).toContainText('Jackpot');
  const heldValue = game.dice[fixture.heldDieId].value;
  const goldBefore = game.gold;

  await selectPlay(page, game, fixture.play);
  await expect(die(page, fixture.heldDieId)).toHaveAttribute('aria-pressed', 'true');
  await page.clock.install({ time: new Date('2026-09-18T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-18T12:00:01Z'));
  await page.getByText('NORMAL', { exact: true }).click();
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  const jackpotIndex = fixture.result.events.findIndex(event => event.enhancement === 'jackpot');
  for (let index = 0; index <= jackpotIndex; index++) {
    await expect(page.getByText(`EVENT ${index + 1} / ${fixture.result.events.length}`, { exact: true })).toBeVisible();
    if (index < jackpotIndex) await page.clock.runFor(CONFIG.tickMs.normal);
  }
  await expect(page.locator('.score-tick')).toHaveText('JACKPOT');
  await expect(page.locator('.ability-label').nth(fixture.heldDieId)).toHaveText('JACKPOT');
  await expect(die(page, fixture.heldDieId)).toHaveAccessibleName(new RegExp(`face ${heldValue},`));
  await page.getByRole('button', { name: 'Skip playback' }).click();
  await ready(page);
  if (fixture.result.state.phase === 'flameReward') await expect(page.getByText('FLAME REWARD', { exact: true })).toBeVisible();
  else await expect(page.getByText(new RegExp(`^Round ${game.round} cleared`))).toBeVisible();
  expect(fixture.result.state.gold).toBe(goldBefore + CONFIG.jackpotGold + fixture.result.state.lastRoundPayout!.total);
  expect(fixture.result.events.some(event => event.type === 'DICE_REROLL_STARTED' && event.message.startsWith('Post-hand'))).toBe(false);
});
