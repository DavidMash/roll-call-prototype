import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CONFIG } from '../src/game/config';
import { dispatch, newRun } from '../src/game/engine';
import { HANDS } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { Action, GameState } from '../src/game/types';
import { pairSelectionRun, winningSlippyRun } from './handFixtures';
import { enterRun, setPlaybackSpeed } from './uiHelpers';
import { specialOfferName } from '../src/game/specialOffers';

async function ready(page: Page) {
  await page.locator('main').waitFor();
  await enterRun(page);
  for (let barrier = 0; barrier < 2; barrier++) {
    await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0);
    const bustContinue = page.locator('.bust-state').getByRole('button', { name: 'Continue', exact: true });
    if (await bustContinue.count()) { await bustContinue.click(); continue; }
    const map = page.getByTestId('run-map-transition');
    if (await map.count()) {
      await map.getByRole('button', { name: 'Continue', exact: true }).evaluate(element => (element as HTMLElement).click());
      await expect(map).toHaveCount(0);
      continue;
    }
    break;
  }
}
const die = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) });
async function select(page: Page, ids: number[]) { for (const id of ids) await die(page, id).click(); }
async function perform(page: Page, game: GameState, action: Action) {
  if (action.type === 'PLAY') {
    await page.getByRole('button', { name: new RegExp(`^${HANDS[action.hand].name} `) }).click();
    for (const physical of game.dice) {
      const selected = await die(page, physical.id).getAttribute('aria-pressed') === 'true';
      if (selected !== action.dieIds.includes(physical.id)) await die(page, physical.id).click();
    }
    await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  } else if (action.type === 'BUY') {
    const offer = game.shop!.offers.find(item => item.id === action.offerId)!;
    await page.getByTestId(`offer-${offer.enhancement}`).getByRole('button', { name: 'SELECT OR DRAG' }).click();
    await die(page, action.dieId).click();
  } else if (action.type === 'NEXT_ROUND') await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  else if (action.type === 'CHOOSE_FLAME') {
    const offer = game.flameSelection!.offers.find(item => item.id === action.offerId)!;
    await page.getByTestId(`flame-offer-${offer.flame}`).getByRole('button', { name: 'Select Flame' }).click();
    await die(page, action.dieId).click();
    if (game.dice[action.dieId].flame) await page.getByRole('button', { name: 'Replace Flame', exact: true }).click();
  } else if (action.type === 'CONTINUE_FLAME_SELECTION') {
    await page.getByRole('button', { name: 'CONTINUE TO SHOP', exact: false }).click();
  } else if (action.type === 'CONTINUE_ROUND_SUMMARY') {
    await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
  } else if (action.type === 'CHOOSE_SPECIAL_OFFER') {
    const offer = game.specialOffer!.offers.find(item => item.id === action.offerId)!;
    await page.getByRole('heading', { name: specialOfferName(offer), exact: true }).locator('..').getByRole('button', { name: 'CHOOSE' }).click();
  } else if (action.type === 'CONTINUE_SPECIAL_OFFER') {
    await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
  }
  else if (action.type === 'MANUAL_REROLL') {
    await select(page, action.dieIds);
    await page.getByTestId('manual-reroll').click();
  } else if (action.type === 'UNLOCK_WARDEN_DIE') {
    await page.getByRole('button', { name: new RegExp(`^Die ${action.dieId + 1},.*selectable to unlock$`) }).click();
    await page.getByRole('button', { name: 'UNLOCK DIE', exact: true }).click();
  } else if (action.type === 'RETRY_ROUND') {
    await page.getByRole('button', { name: /^RETRY ROUND / }).click();
  } else throw new Error(`Unexpected fixture action: ${action.type}`);
  await ready(page);
  return dispatch(game, action).state;
}

for (const hand of ['pair', 'twoPair'] as const) {
  test(`${HANDS[hand].name}: stable default, physical replacement, scoring and consumed display`, async ({ page }) => {
    const fixture = pairSelectionRun(hand);
    const { game, initial, action, result } = fixture;
    await page.goto(`/?seed=${game.seed}&speed=instant`);
    await ready(page);
    const handButton = page.getByRole('button', { name: new RegExp(`^${HANDS[hand].name} `) });
    await handButton.click();
    for (const id of initial) await expect(die(page, id)).toHaveAttribute('aria-pressed', 'true');
    const removed = initial.find(id => !action.dieIds.includes(id))!;
    const added = action.dieIds.find(id => !initial.includes(id))!;
    await die(page, removed).click();
    if (hand === 'pair') {
      const upperName = ['Ones', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes'][game.dice[initial.find(id => id !== removed)!].value - 1];
      await expect(page.getByRole('button', { name: new RegExp(`^${upperName} `) })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeEnabled();
    } else await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeDisabled();
    await die(page, added).click();
    if (hand === 'pair') await handButton.click();
    await expect(handButton).toHaveAttribute('aria-pressed', 'true');
    await expect(die(page, removed)).toHaveAttribute('aria-pressed', 'false');
    for (const id of action.dieIds) await expect(die(page, id)).toHaveAttribute('aria-pressed', 'true');
    const score = handScore(game.dice, hand, action.dieIds);
    expect(score.multiplier).toBe(hand === 'pair' ? 1.5 : 2);
    await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toHaveText(
      `${score.pips} × ${score.multiplier} × 1 = ${score.score.toLocaleString('en-US')} • PLAY`,
    );
    await expect(page.getByTestId('round-score-progress')).toHaveText(`0 / ${game.target}`);
    await page.getByRole('button', { name: 'PLAY', exact: true }).click();
    await ready(page);
    await expect(page.getByTestId('round-score-progress')).toHaveText(`${score.score} / ${game.target}`);
    await expect(handButton).toBeDisabled();
    await expect(handButton).toHaveAccessibleName(/· Used$/);
    for (const physical of result.state.dice) {
      await expect(page.getByRole('button', { name: new RegExp(`^Die ${physical.id + 1}, face ${physical.value},`) })).toBeVisible();
      if (!action.dieIds.includes(physical.id)) expect(physical.value).toBe(game.dice[physical.id].value);
    }
    expect(result.events.filter(event => event.type === 'DIE_ROLLED').map(event => event.dieIds![0])).toEqual(action.dieIds);
  });
}

test('winning hand shows its final award, physical settle, and ROUND CLEARED in order', async ({ page }) => {
  const fixture = winningSlippyRun();
  let game = newRun(fixture.seed).state;
  await page.goto(`/?seed=${fixture.seed}&speed=instant`);
  await ready(page);
  for (const action of fixture.actions) game = await perform(page, game, action);
  expect(game).toEqual(fixture.game);
  await page.getByRole('button', { name: new RegExp(`^${HANDS[fixture.action.hand].name} `) }).click();
  for (const physical of game.dice) {
    const selected = await die(page, physical.id).getAttribute('aria-pressed') === 'true';
    if (selected !== fixture.action.dieIds.includes(physical.id)) await die(page, physical.id).click();
  }
  await page.clock.install({ time: new Date('2026-09-17T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-17T12:00:01Z'));
  await setPlaybackSpeed(page, 'NORMAL');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  const observed: string[] = [];
  for (const event of fixture.result.events) {
    await expect(page.getByTestId('round-score-progress')).toHaveText(
      `${event.board.score.toLocaleString('en-US')} / ${event.board.target.toLocaleString('en-US')}`,
    );
    if (event.type === 'DICE_REROLL_STARTED') await expect(page.locator('.die.rolling')).not.toHaveCount(0);
    if (event.type === 'HAND_SCORE_FINALIZED') {
      await expect(page.locator('.score-tick')).toHaveText(`+${event.amount}`);
      observed.push(event.type);
    }
    if (event.type === 'SCORE_ADDED') {
      await expect(page.locator('.score-tick')).toHaveText(`+${event.amount}`);
      observed.push(event.type);
    }
    if (event.type === 'ROUND_CLEARED') {
      await expect(page.locator('.score-tick')).toHaveText('ROUND CLEARED');
      observed.push(event.type);
      break;
    }
    await page.clock.runFor(CONFIG.tickMs.normal);
  }
  expect(observed).toEqual(['HAND_SCORE_FINALIZED', 'SCORE_ADDED', 'ROUND_CLEARED']);
  await page.getByRole('button', { name: 'Skip playback' }).click();
  await page.clock.runFor(500);
  await ready(page);
  await expect(page.getByTestId('round-summary')).toBeVisible();
  await expect(page.getByTestId('summary-score')).toContainText(`${fixture.result.state.score}`);
  await page.clock.resume();
  await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
  await ready(page);
  for (const physical of fixture.result.state.dice)
    await expect(page.getByRole('button', { name: new RegExp(`^Die ${physical.id + 1}, face ${physical.value},`) })).toBeVisible();
});
