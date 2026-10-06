import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CONFIG } from '../src/game/config';
import { dispatch, newRun } from '../src/game/engine';
import { HANDS } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { Action, GameState } from '../src/game/types';
import { scoringPlaybackRun } from './scoringFixture';
import { activeEncounterDice } from '../src/game/bosses';
import { enterRun, setPlaybackSpeed } from './uiHelpers';
import { captureHandStart, composeXMult, handXMultContributions } from '../src/game/flames';
import { finalizeScore } from '../src/game/scoring';
import { specialOfferName } from '../src/game/specialOffers';

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
async function selectDice(page: Page, dieIds: number[]) {
  for (const id of dieIds) await page.getByRole('button', { name: new RegExp(`^Die ${id + 1},`) }).click();
}
async function perform(page: Page, game: GameState, action: Action) {
  if (action.type === 'PLAY') {
    const row = page.getByRole('button', { name: new RegExp(`^${HANDS[action.hand].name} `) });
    await row.click();
    for (const physical of activeEncounterDice(game)) {
      const target = page.getByRole('button', { name: new RegExp(`^${physical.owner === 'boss' ? 'Cursed Die' : `Die ${physical.id + 1}`},`) });
      const selected = await target.getAttribute('aria-pressed') === 'true';
      if (selected !== action.dieIds.includes(physical.id)) await target.click();
    }
    if (await row.getAttribute('aria-pressed') !== 'true') await row.click();
    await page.getByRole('button', { name: /^(PLAY|LAST PLAY[?.])$/ }).click();
  } else if (action.type === 'BUY') {
    const offer = game.shop!.offers.find(item => item.id === action.offerId)!;
    await page.getByTestId(`offer-${offer.enhancement}`).getByRole('button', { name: 'SELECT OR DRAG' }).click();
    await selectDice(page, [action.dieId]);
  } else if (action.type === 'NEXT_ROUND') {
    await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  } else if (action.type === 'CHOOSE_FLAME') {
    const offer = game.flameSelection!.offers.find(item => item.id === action.offerId)!;
    await page.getByTestId(`flame-offer-${offer.flame}`).getByRole('button', { name: 'Select Flame' }).click();
    await page.getByRole('button', { name: new RegExp(`^Die ${action.dieId + 1},`) }).click();
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
  } else if (action.type === 'MANUAL_REROLL') {
    for (const physical of activeEncounterDice(game)) {
      const target = page.getByRole('button', { name: new RegExp(`^${physical.owner === 'boss' ? 'Cursed Die' : `Die ${physical.id + 1}`},`) });
      const selected = await target.getAttribute('aria-pressed') === 'true';
      if (selected !== action.dieIds.includes(physical.id)) await target.click();
    }
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

test('live Pips build through Bonus and Hitchhiker under trained Mult before one final award', async ({ page }) => {
  const fixture = scoringPlaybackRun();
  const final = fixture.result.events.find(event => event.type === 'HAND_SCORE_FINALIZED')!;
  const started = fixture.result.events.find(event => event.type === 'HAND_STARTED')!;
  let game = newRun(fixture.seed).state;
  await page.goto(`/?seed=${fixture.seed}&speed=instant`);
  await ready(page);
  for (const action of fixture.actions) game = await perform(page, game, action);
  expect(game).toEqual(fixture.game);
  await expect(page.getByTestId('round-score-progress')).toHaveText(`${game.score} / ${game.target}`);
  const finalRow = page.getByRole('button', { name: new RegExp(`^${HANDS[fixture.action.hand].name} `) });
  await finalRow.click();
  for (const physical of activeEncounterDice(game)) {
    const target = page.getByRole('button', { name: new RegExp(`^${physical.owner === 'boss' ? 'Cursed Die' : `Die ${physical.id + 1}`},`) });
    const selected = await target.getAttribute('aria-pressed') === 'true';
    if (selected !== fixture.action.dieIds.includes(physical.id)) await target.click();
  }
  if (await finalRow.getAttribute('aria-pressed') !== 'true') await finalRow.click();
  const deterministicPreview = handScore(activeEncounterDice(game), fixture.action.hand, fixture.action.dieIds, game.handLevels[fixture.action.hand]);
  const snapshot = captureHandStart(game, fixture.action.hand, fixture.action.dieIds);
  const xMult = composeXMult(handXMultContributions(snapshot, fixture.action.hand,
    game.handLevels[fixture.action.hand], fixture.action.dieIds));
  const effectiveXMult = Number((xMult * snapshot.bossFactor).toFixed(12));
  const previewScore = finalizeScore(deterministicPreview.pips, deterministicPreview.multiplier, effectiveXMult).finalScore;
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toHaveText(
    `${deterministicPreview.pips} × ${deterministicPreview.multiplier} × ${effectiveXMult} = ${previewScore.toLocaleString('en-US')} • PLAY`,
  );

  await page.clock.install({ time: new Date('2026-09-17T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-17T12:00:01Z'));
  await setPlaybackSpeed(page, 'NORMAL');
  await page.getByRole('button', { name: /^(PLAY|LAST PLAY[?.])$/ }).click();
  const observed: [string, number, number][] = [];
  for (const event of fixture.result.events) {
    await expect(page.getByTestId('round-score-progress')).toHaveText(
      `${event.board.score.toLocaleString('en-US')} / ${event.board.target.toLocaleString('en-US')}`,
    );
    if (event.handScore) {
      await expect(page.getByTestId('hand-pips')).toHaveText(String(event.handScore.currentPips));
      await expect(page.getByTestId('hand-multiplier')).toHaveText(String(event.handScore.currentMultiplier));
      if (event.type !== 'SCORE_ADDED') expect(event.board.score).toBe(game.score);
      if (event.type === 'HAND_STARTED') {
        expect(event.handScore.basePips).toBe(started.handScore!.basePips);
        await expect(page.getByTestId('hand-pips')).toHaveText(String(started.handScore!.basePips));
      }
      if (event.type === 'HAND_PIPS_CHANGED' && event.enhancement === 'bonus') {
        await expect(page.locator('.score-tick')).toHaveText(`BONUS +${event.amount}`);
        await expect(page.locator(`[data-die-id="${event.dieIds![0]}"] .die`)).toHaveAttribute('data-resolving', 'true');
        observed.push(['Bonus', event.handScore.currentPips, event.handScore.currentMultiplier]);
      }
      if (event.type === 'HITCHHIKER_ADDED_PIPS') {
        await expect(page.locator('.score-tick')).toHaveText(`HITCHHIKER +${event.amount}`);
        await expect(page.locator(`[data-die-id="${event.dieIds![0]}"] .die`)).toHaveAttribute('data-resolving', 'true');
        observed.push(['Hitchhiker', event.handScore.currentPips, event.handScore.currentMultiplier]);
      }
      if (event.type === 'HAND_SCORE_FINALIZED') {
        await expect(page.locator('.score-tick')).toHaveText(`+${final.amount}`);
        await expect(page.getByTestId('hand-final-score')).toContainText(String(final.amount));
      }
    }
    if (event.type === 'SCORE_ADDED' && event.source === 'hand') {
      await expect(page.locator('.score-tick')).toHaveText(`+${final.amount}`);
      break;
    }
    await page.clock.runFor(CONFIG.tickMs.normal);
  }
  const expectedStages = fixture.result.events.filter(event =>
    (event.type === 'HAND_PIPS_CHANGED' && event.enhancement === 'bonus')
    || event.type === 'HITCHHIKER_ADDED_PIPS');
  expect(expectedStages).toHaveLength(2);
  expect(observed).toEqual(expectedStages.map(event => [
    event.enhancement === 'bonus' ? 'Bonus' : 'Hitchhiker',
    event.handScore!.currentPips, event.handScore!.currentMultiplier,
  ]));
  await expect(page.getByTestId('score-box-pips')).toBeVisible();
  await expect(page.getByTestId('score-box-mult')).toBeVisible();
  await expect(page.getByTestId('score-box-xmult')).toHaveCount(0);
  await page.getByRole('button', { name: 'Skip playback' }).click();
  await expect(page.getByTestId('hand-final-score')).toContainText(String(final.amount));
  await page.clock.runFor(500);
  await ready(page);
  if (fixture.result.state.phase === 'roundSummary') {
    await expect(page.getByRole('heading', { name: /DEFEATED|CLEARED/ })).toBeVisible();
    await expect(page.getByText(`${fixture.result.state.score.toLocaleString('en-US')} / ${fixture.result.state.target.toLocaleString('en-US')}`, { exact: true })).toBeVisible();
  } else {
    await expect(page.getByTestId('round-score-progress')).toHaveText(`${fixture.result.state.score} / ${fixture.result.state.target}`);
  }
});

test('score formula stays inside a narrow viewport above the persistent Dice Dock', async ({ page }) => {
  const fixture = scoringPlaybackRun();
  let game = newRun(fixture.seed).state;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`/?seed=${fixture.seed}&speed=instant`);
  await ready(page);
  for (const action of fixture.actions) game = await perform(page, game, action);
  const row = page.getByRole('button', { name: new RegExp(`^${HANDS[fixture.action.hand].name} `) });
  await row.click();
  for (const physical of activeEncounterDice(game)) {
    const die = page.getByRole('button', { name: new RegExp(`^${physical.owner === 'boss' ? 'Cursed Die' : `Die ${physical.id + 1}`},`) });
    if ((await die.getAttribute('aria-pressed') === 'true') !== fixture.action.dieIds.includes(physical.id)) await die.click();
  }
  if (await row.getAttribute('aria-pressed') !== 'true') await row.click();
  await page.getByRole('button', { name: /^(PLAY|LAST PLAY[?.])$/ }).click();
  const formula = page.getByTestId('hand-accumulator');
  await expect(formula).toBeVisible();
  const layout = await page.evaluate(() => {
    const formulaRect = document.querySelector('[data-testid="hand-accumulator"]')!.getBoundingClientRect();
    const dockRect = document.querySelector('[data-testid="dice-dock"]')!.getBoundingClientRect();
    return { left: formulaRect.left, right: formulaRect.right, width: innerWidth, bottom: formulaRect.bottom, dockTop: dockRect.top,
      scrollWidth: document.documentElement.scrollWidth };
  });
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.width);
  expect(layout.scrollWidth).toBe(layout.width);
  expect(layout.bottom).toBeLessThanOrEqual(layout.dockTop);
  await expect(page.getByTestId('hand-final-score')).toBeVisible();
  await expect(page.getByTestId('score-box-pips')).toHaveCSS('animation-name', 'none');
  await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0, { timeout: 2_000 });
});
