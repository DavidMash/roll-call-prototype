import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CONFIG } from '../src/game/config';
import { HANDS } from '../src/game/hands';
import type { Action, GameState } from '../src/game/types';
import { jackpotRun } from './jackpotFixture';
import { enterRun, installRunState, setPlaybackSpeed } from './uiHelpers';

const die = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) });
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
async function selectPlay(page: Page, game: GameState, action: Extract<Action, { type: 'PLAY' }>) {
  await page.getByRole('button', { name: new RegExp(`^${HANDS[action.hand].name} `) }).click();
  for (const physical of game.dice) {
    const shouldSelect = action.dieIds.includes(physical.id);
    const selected = await die(page, physical.id).getAttribute('aria-pressed') === 'true';
    if (selected !== shouldSelect) await die(page, physical.id).click();
  }
}
test('scoring Jackpot pays on a played-hand clear before the final physical settle', async ({ page }) => {
  const fixture = jackpotRun();
  const game = fixture.game;
  await installRunState(page, game);
  await ready(page);
  const jackpotStrip = page.getByTestId(`flame-die-${fixture.heldDieId}`).locator('.die-enhancement-strip');
  await expect(jackpotStrip).toHaveAccessibleName(/Jackpot ×1/);
  await expect(jackpotStrip.locator('.enhancement-jackpot')).toHaveCount(1);
  const heldValue = game.dice[fixture.heldDieId].value;
  const goldBefore = game.gold;

  await selectPlay(page, game, fixture.play);
  await expect(die(page, fixture.heldDieId)).toHaveAttribute('aria-pressed', 'true');
  await page.clock.install({ time: new Date('2026-09-18T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-18T12:00:01Z'));
  await setPlaybackSpeed(page, 'NORMAL');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  const jackpotIndex = fixture.result.events.findIndex(event => event.enhancement === 'jackpot');
  for (let index = 0; index <= jackpotIndex; index++) {
    const event = fixture.result.events[index];
    await expect(page.getByTestId('round-score-progress')).toHaveText(
      `${event.board.score.toLocaleString('en-US')} / ${event.board.target.toLocaleString('en-US')}`,
    );
    if (index < jackpotIndex) await page.clock.runFor(CONFIG.tickMs.normal);
  }
  await expect(page.locator('.score-tick')).toHaveText('★JACKPOT');
  await expect(page.locator('.score-tick .enhancement-jackpot')).toContainText('★');
  await expect(page.getByTestId(`flame-die-${fixture.heldDieId}`).locator('.die.pulse')).toHaveCount(1);
  await expect(page.getByTestId(`flame-die-${fixture.heldDieId}`).locator('.enhancement-jackpot')).toHaveCount(1);
  await expect(die(page, fixture.heldDieId)).toHaveAccessibleName(new RegExp(`face ${heldValue},`));
  await page.getByRole('button', { name: 'Skip playback' }).click();
  await page.clock.runFor(500);
  await ready(page);
  await expect(page.getByTestId('round-summary')).toBeVisible();
  expect(fixture.result.state.gold).toBe(goldBefore + CONFIG.jackpotGold + fixture.result.state.lastRoundPayout!.totalRoundRewardGold);
  expect(fixture.result.events.some(event => event.type === 'DICE_REROLL_STARTED' && event.message.startsWith('Winning hand settle'))).toBe(true);
});
