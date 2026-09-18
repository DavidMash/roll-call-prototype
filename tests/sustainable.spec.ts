import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CONFIG } from '../src/game/config';
import { dispatch, newRun } from '../src/game/engine';
import { HANDS } from '../src/game/hands';
import type { Action, GameState } from '../src/game/types';
import { stickySustainableRun } from './sustainableFixture';

const die = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) });
async function ready(page: Page) { await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0); }
async function perform(page: Page, game: GameState, action: Action) {
  if (action.type === 'PLAY') {
    await page.getByRole('button', { name: new RegExp(`^${HANDS[action.hand].name} `) }).click();
    for (const physical of game.dice) {
      const shouldSelect = action.dieIds.includes(physical.id);
      const selected = await die(page, physical.id).getAttribute('aria-pressed') === 'true';
      if (selected !== shouldSelect) await die(page, physical.id).click();
    }
    await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  } else if (action.type === 'MANUAL_REROLL') {
    for (const id of action.dieIds) await die(page, id).click();
    await page.getByRole('button', { name: `Reroll Selected — ${action.dieIds.length}`, exact: true }).click();
  } else if (action.type === 'BUY') {
    const offer = game.shop!.offers.find(offer => offer.id === action.offerId)!;
    await page.getByTestId(`offer-${offer.enhancement}`).getByRole('button').click();
    await die(page, action.dieId).click();
  } else if (action.type === 'NEXT_ROUND') await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  else throw new Error(`Unexpected fixture action ${action.type}`);
  await ready(page);
  return dispatch(game, action).state;
}

test('Sticky + Sustainable can succeed repeatedly without any spent-state presentation', async ({ page }) => {
  const fixture = stickySustainableRun();
  let game = newRun(fixture.seed).state;
  await page.goto(`/?seed=${fixture.seed}&speed=instant`);
  await ready(page);
  for (const action of fixture.actions) game = await perform(page, game, action);
  expect(game).toEqual(fixture.game);
  const physical = die(page, fixture.dieId);
  await expect(physical).toHaveAccessibleName(new RegExp(`face ${fixture.face},`));
  await expect(physical).toContainText('Sticky');
  await expect(physical).toContainText('Sustainable');
  await expect(physical).not.toContainText('spent');

  // Select just the enhanced die even if other dice show the same upper face.
  const hand = page.getByRole('button', { name: new RegExp(`^${HANDS[fixture.hand].name} `) });
  await hand.click();
  for (const candidate of fixture.game.dice) {
    const shouldSelect = candidate.id === fixture.dieId;
    const selected = await die(page, candidate.id).getAttribute('aria-pressed') === 'true';
    if (selected !== shouldSelect) await die(page, candidate.id).click();
  }
  await page.clock.install({ time: new Date('2026-09-18T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-18T12:00:01Z'));
  await page.getByText('NORMAL', { exact: true }).click();
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  const triggerIndex = fixture.first.events.findIndex(event => event.enhancement === 'sustainable');
  for (let index = 0; index <= triggerIndex; index++) {
    await expect(page.getByText(`EVENT ${index + 1} / ${fixture.first.events.length}`, { exact: true })).toBeVisible();
    await expect(page.locator('.die.rolling')).toHaveCount(0);
    if (index < triggerIndex) await page.clock.runFor(CONFIG.tickMs.normal);
  }
  await expect(page.locator('.score-tick')).toHaveText('SUSTAINABLE');
  await expect(page.locator('.ability-label').nth(fixture.dieId)).toHaveText('SUSTAINABLE');
  await expect(physical).not.toContainText('spent');
  await page.getByRole('button', { name: 'Skip playback' }).click();
  await ready(page);
  await expect(hand).toBeEnabled();
  await expect(page.getByTestId(`scorecard-score-${fixture.hand}`)).toHaveText(String(fixture.first.state.scoreByHand[fixture.hand]));
  await expect(physical).toHaveAccessibleName(new RegExp(`face ${fixture.face},`));
  await expect(physical).not.toContainText('spent');
  await page.getByText('INSTANT', { exact: true }).click();

  game = await perform(page, fixture.first.state, fixture.play);
  expect(game).toEqual(fixture.second.state);
  await expect(hand).toBeEnabled();
  await expect(page.getByTestId(`scorecard-score-${fixture.hand}`)).toHaveText(String(fixture.second.state.scoreByHand[fixture.hand]));
  await expect(physical).toHaveAccessibleName(new RegExp(`face ${fixture.face},`));
  expect(game.stats.triggers.sustainable).toBe(2);
  expect(game.stats.probabilityProcs.sustainable).toMatchObject({ checks: 2, successes: 2, failures: 0 });
  await page.getByRole('button', { name: /^Run data & event history/ }).click();
  await expect(page.locator('.log-entry').filter({ hasText: 'Sustainable succeeded' })).toHaveCount(2);
  await expect(page.locator('.log-entry').filter({ hasText: 'spent' })).toHaveCount(0);
});
