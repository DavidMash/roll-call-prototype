import { expect, test } from '@playwright/test';
import { createCollectibleDie } from '../src/game/dice';
import { createInfernoEvaluation } from '../src/game/engulfment';
import { newRun } from '../src/game/engine';
import { placeFlameInstance } from '../src/game/flames';
import { INFERNO_REWARD_OFFERS } from '../src/game/infernoRewards';
import { resetDieRoundState } from '../src/game/specialDice';
import { syncActiveDiceProjection } from '../src/game/inventory';
import type { GameState, HandId, InfernoRewardOfferId } from '../src/game/types';
import { enterRun, installRunState, readRunState } from './uiHelpers';

function readyInferno(seed: string): GameState {
  const state = newRun(seed).state;
  placeFlameInstance(state, 'vineyard');
  const evaluation = createInfernoEvaluation(state)!;
  evaluation.success = true; evaluation.effectiveValue = 25; evaluation.readiness = 1;
  evaluation.suspendAfterContinue = false; evaluation.currentCollectionTheoreticallySufficient = true;
  evaluation.feedbackMessage = null; evaluation.feedbackMessageId = null;
  evaluation.flamesSnuffed = [structuredClone(evaluation.flames[0].asset)]; evaluation.flamesPreserved = [];
  evaluation.selectedFlameInstanceIds = [evaluation.flames[0].asset.instanceId];
  evaluation.selectedEffectiveValue = 25; evaluation.earnedInfernoFactor = 25; evaluation.consumedFinalFlame = true;
  evaluation.engulfmentCountAfter = 1; evaluation.infernoLevelAfter = 1; evaluation.infernoMultiplierAfter = 25n;
  state.phase = 'inferno'; state.infernoEvaluation = evaluation;
  return state;
}

function pendingReward(seed: string, offers: InfernoRewardOfferId[]): GameState {
  const state = newRun(seed).state;
  state.phase = 'infernoReward';
  state.infernoRewards.screenCount = 1;
  state.infernoRewards.pending = { screenNumber: 1, offers, recycledOfferIds: [], makeRoomOfferId: null };
  return state;
}

test('Engulfment opens one persisted Inferno Reward screen, then claims and continues', async ({ page }) => {
  await installRunState(page, readyInferno('inferno-reward-flow'));
  await enterRun(page);
  await expect(page.getByTestId('inferno-ready')).toBeVisible();
  await page.getByRole('button', { name: 'ENGULF SELECTED FLAMES', exact: true }).click();
  await expect(page.getByTestId('engulfment-success')).toBeVisible();
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).click();
  await expect(page.getByTestId('inferno-reward-screen')).toBeVisible();
  const before = (await readRunState(page))!;
  const offered = [...before.infernoRewards.pending!.offers];
  expect(offered).toHaveLength(3);
  await page.reload();
  await enterRun(page);
  await expect(page.getByTestId('inferno-reward-screen')).toBeVisible();
  expect((await readRunState(page))!.infernoRewards.pending!.offers).toEqual(offered);
  const chosen = offered.find(id => INFERNO_REWARD_OFFERS[id].category !== 'die')!;
  await page.getByRole('heading', { name: INFERNO_REWARD_OFFERS[chosen].name, exact: true })
    .locator('..').locator('..').getByRole('button', { name: 'CHOOSE', exact: true }).click();
  await expect(page.getByTestId('dice-shop')).toBeVisible();
  const claimed = (await readRunState(page))!;
  expect(claimed.infernoRewards.claimedOfferIds).toContain(chosen);
  expect(claimed.infernoRewards.pending).toBeNull();
  expect(claimed.historyV2.some(event => event.kind === 'inferno_reward_offered')).toBe(true);
  expect(claimed.historyV2.some(event => event.kind === 'inferno_reward_claimed')).toBe(true);
});

test('full collection curated die Make Room can cancel or replace without sale Gold', async ({ page }) => {
  const state = pendingReward('inferno-make-room-browser', ['dieInvestor', 'goldWindfall']);
  for (let index = 0; index < state.diceInventory.storage.length; index++) {
    const die = createCollectibleDie(state.diceInventory.nextDieId++);
    state.diceInventory.instances[die.id] = die; state.diceInventory.storage[index] = die.id;
  }
  const replaced = state.diceInventory.storage[0]!;
  await installRunState(page, state); await enterRun(page);
  const investor = page.getByRole('heading', { name: 'New Die: The Investor', exact: true }).locator('..').locator('..');
  await investor.getByRole('button', { name: 'CHOOSE', exact: true }).click();
  await expect(page.getByTestId('inferno-make-room')).toBeVisible();
  await page.getByRole('button', { name: 'CANCEL · BACK TO REWARDS', exact: true }).click();
  await expect(page.getByTestId('inferno-reward-screen')).toBeVisible();
  await investor.getByRole('button', { name: 'CHOOSE', exact: true }).click();
  const goldBefore = ((await readRunState(page))!).gold;
  await page.getByText(`Storage 1 · Die ${replaced}`, { exact: true }).locator('..')
    .getByRole('button', { name: 'REPLACE WITH REWARD', exact: true }).click();
  const claimed = (await readRunState(page))!;
  expect(claimed.gold).toBe(goldBefore);
  expect(claimed.diceInventory.instances[replaced]).toBeUndefined();
  expect(claimed.infernoRewards.claimedOfferIds).toContain('dieInvestor');
});

test('unlocked scorecard order and seven-die roster remain usable on mobile', async ({ page }) => {
  const state = newRun('inferno-expanded-mobile').state;
  const unlocked: HandId[] = ['odds', 'evens', 'chance', 'miniStraight', 'oddStraight', 'evenStraight', 'threePair',
    'wideStraight', 'doubleTriple', 'fullerHouse', 'xlStraight', 'sixKind'];
  state.infernoRewards.unlockedHands = unlocked;
  state.infernoRewards.upgrades.rosterCap = 7;
  for (const hand of unlocked) state.handLevels[hand] = 1;
  for (let index = 0; index < 2; index++) {
    const die = createCollectibleDie(state.diceInventory.nextDieId++);
    state.diceInventory.instances[die.id] = die; state.diceInventory.roster.push(die.id);
  }
  state.dieRoundState = resetDieRoundState(Object.values(state.diceInventory.instances));
  syncActiveDiceProjection(state);
  await page.setViewportSize({ width: 390, height: 844 });
  await installRunState(page, state); await enterRun(page);
  await expect(page.locator('[data-testid^="scorecard-row-"]')).toHaveCount(26);
  const upper = await page.locator('#scorecard-upper').locator('..').locator('[data-testid^="scorecard-row-"]')
    .evaluateAll(rows => rows.map(row => row.getAttribute('data-testid')));
  expect(upper.slice(-3)).toEqual(['scorecard-row-odds', 'scorecard-row-evens', 'scorecard-row-chance']);
  const dice = page.getByTestId('dice-dock').locator('.die-slot');
  await expect(dice).toHaveCount(7);
  const viewportWidth = page.viewportSize()!.width;
  for (const box of await dice.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()))) {
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
  }
});
