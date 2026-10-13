import { expect, test } from '@playwright/test';
import { dispatch, newRun, normalizeGameState } from '../src/game/engine';
import { Resolver } from '../src/game/effects';
import { HAND_IDS, LOWER_HAND_IDS, UPPER_HAND_IDS } from '../src/game/hands';
import { RUN_STORAGE_KEY } from '../src/game/persistence';
import type { GameState, RandomSource } from '../src/game/types';
import { enterRun, installRunState } from './uiHelpers';

const constant: RandomSource = { next: () => 0.99 };

async function storedState(page: import('@playwright/test').Page): Promise<GameState> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, RUN_STORAGE_KEY);
}

async function load(page: import('@playwright/test').Page, state: GameState) {
  await installRunState(page, state, 'instant');
  await enterRun(page);
}

test('deterministic Engulfment fixture covers rejection, Bust refresh, success, Inferno scoring, and resume', async ({ page }) => {
  let state = newRun('engulfment-browser-fixture', constant).state;
  state.phase = 'shop';
  state.shop = { visitId: 1, engulfmentAttemptUsed: false, kind: 'between_rounds', exitUnlocked: true,
    offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
  state.nextShopVisitId = 2;
  state.bonfires = ['ultimate', 'minigun', 'hailMary', 'speedDemon'];
  state = normalizeGameState(state);
  const hailMaryInstance = state.flameInstanceIds.hailMary!;
  state.historyV2 = [
    { seq: 0, kind: 'hand_scored', round: 1, attempt: 1, actionId: 0, timelineId: 0,
      hand: 'ones', level: 1, playSource: 'manual', selectedDice: [0], scoringDice: [], consumed: true,
      score: { infernoMultiplier: 1, basePips: 100, finalPips: 100, baseMult: 1, finalMult: 1,
        finalXMult: 20, bossFactor: 1, raw: 2000, awarded: 2000, rounding: { mode: 'nearest_integer', delta: 0 } },
      roundScore: { before: 0, afterAward: 2000, after: 2000 }, pipsContributions: [], multContributions: [],
      xMultContributions: [{ sourceId: 'hailMary', sourceInstanceId: hailMaryInstance, origin: 'bonfire', factor: 20 }],
      checks: [], sideEffects: [] },
    { seq: 1, kind: 'round_attempt_finished', round: 1, attempt: 1, actionId: 1, timelineId: 0,
      outcome: 'cleared', score: 2000, target: 1, boss: null, livesBefore: 3, livesAfter: 3 },
  ];
  UPPER_HAND_IDS.forEach((hand, index) => { state.handLevels[hand] = [13, 12, 14, 13, 10, 12][index]; });
  LOWER_HAND_IDS.forEach((hand, index) => { state.handLevels[hand] = index + 1; });
  state.hoodedFigure.issuedChapters = [1];
  state.hoodedFigure.active = { id: 'fiveAlive', issuedChapter: 1, target: 5,
    committed: { value: 1, keys: [], invalid: false, jackpotPaid: false },
    attempt: { value: 2, keys: [], invalid: false, jackpotPaid: false }, complete: false, dialogueLine: 'test' };
  await load(page, state);

  await expect(page.getByTestId('attempt-inferno')).toBeEnabled();
  await page.getByTestId('attempt-inferno').click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Select one or more Flames to offer to the Inferno.')).toBeVisible();
  await expect(dialog.getByText('The Inferno prefers Flames that have proven to be vital to your run.')).toBeVisible();
  await expect(dialog.getByText('Upon success:')).toBeVisible();
  await expect(dialog).toContainText('Inferno ×1 → ×25');
  await expect(dialog.getByText('Upper and Lower hands will be unified.')).toBeVisible();
  await expect(dialog.getByText('Offered Flames will be snuffed out.')).toBeVisible();
  await expect(dialog.getByText('An insufficient offering costs nothing, but you only get one attempt this Shop.')).toBeVisible();
  await expect(dialog).not.toContainText('100 Fuel');
  await expect(dialog).not.toContainText('×20');
  await expect(dialog).not.toContainText('OfferingMultiplier');
  await expect(dialog).not.toContainText('contribution');
  await expect(dialog).not.toContainText('%');
  await dialog.getByRole('button', { name: /Ultimate.*BONFIRE/i }).click();
  await dialog.getByRole('button', { name: /Minigun.*BONFIRE/i }).click();
  await dialog.getByRole('button', { name: 'ATTEMPT ENGULFMENT', exact: true }).click();
  await expect(dialog.getByText('Your active quest will be forfeited if this Engulfment is successful.')).toBeVisible();
  await dialog.getByRole('button', { name: 'BACK', exact: true }).click();
  await expect(dialog.getByText('Select one or more Flames to offer to the Inferno.')).toBeVisible();
  expect((await storedState(page)).shop!.engulfmentAttemptUsed).toBe(false);
  await dialog.getByRole('button', { name: 'ATTEMPT ENGULFMENT', exact: true }).click();
  await dialog.getByRole('button', { name: 'CONTINUE', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'THE INFERNO REJECTS YOUR OFFERING', exact: true })).toBeVisible({ timeout: 6000 });
  await expect(dialog.getByText('Nothing was lost.')).toBeVisible();
  await dialog.getByRole('button', { name: 'RETURN TO SHOP' }).click();
  await expect(page.getByTestId('attempt-inferno')).toBeDisabled();
  let failed = await storedState(page);
  expect(failed.bonfires).toEqual(state.bonfires);
  expect(failed.hoodedFigure.active?.id).toBe('fiveAlive');

  failed.phase = 'round'; failed.shop = null; failed.bust = null;
  const bustResolver = new Resolver(failed, constant);
  bustResolver.startRound();
  failed.consumed = [...HAND_IDS]; failed.manualRerollsRemaining = 0; failed.score = 0; failed.target = 1_000_000;
  bustResolver.evaluate();
  expect(failed.phase).toBe('shop');
  await load(page, failed);
  await expect(page.getByTestId('bust-shop-banner')).toBeVisible();
  await expect(page.getByTestId('attempt-inferno')).toBeEnabled();

  await page.getByTestId('attempt-inferno').click();
  dialog = page.getByRole('dialog');
  for (const flame of ['Ultimate', 'Minigun', 'Hail Mary'])
    await dialog.getByRole('button', { name: new RegExp(`${flame}.*BONFIRE`, 'i') }).click();
  await dialog.getByRole('button', { name: 'ATTEMPT ENGULFMENT', exact: true }).click();
  await dialog.getByRole('button', { name: 'CONTINUE', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'INFERNO I', exact: true })).toBeVisible({ timeout: 6000 });
  await expect(dialog.getByText('×25', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Upper hands unified → Lv.12')).toBeVisible();
  await expect(dialog.getByText('Lower hands unified → Lv.5')).toBeVisible();
  await dialog.getByRole('button', { name: 'RETURN TO SHOP' }).click();

  let success = await storedState(page);
  expect(success.engulfmentLevel).toBe(1);
  expect(success.bonfires).toEqual(['speedDemon']);
  expect(UPPER_HAND_IDS.map(hand => success.handLevels[hand])).toEqual([12, 12, 12, 12, 12, 12]);
  expect(LOWER_HAND_IDS.map(hand => success.handLevels[hand])).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
  expect(success.hoodedFigure.active).toBeNull();
  await page.reload();
  await enterRun(page);
  await expect(page.getByText(/INFERNO I · ×25/)).toBeVisible();

  success = await storedState(page);
  success.shop!.exitUnlocked = true;
  const round = dispatch(success, { type: success.bust ? 'RETRY_ROUND' : 'NEXT_ROUND' }, constant).state;
  round.target = 1_000_000;
  round.dice.forEach(die => { die.value = 1; });
  await load(page, round);
  await page.getByTestId('scorecard-row-ones').click();
  await expect(page.getByTestId('play-action')).toContainText(/^25 ×/);
  await page.getByTestId('play-action').click();
  await expect.poll(async () => (await storedState(page)).historyV2.filter(event => event.kind === 'hand_scored').at(-1)?.score.infernoMultiplier)
    .toBe(25);
  await page.reload();
  await enterRun(page);
  expect((await storedState(page)).engulfmentLevel).toBe(1);
});
