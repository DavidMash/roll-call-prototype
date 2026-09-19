import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dispatch, newRun } from '../src/game/engine';
import { FLAMES } from '../src/game/flames';
import { handOptions, HANDS } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { Action, GameState } from '../src/game/types';

function bestHand(game: GameState, requiredDie?: number) {
  return handOptions(game.dice, game.consumed).filter(option => !option.consumed)
    .flatMap(option => option.combinations
      .filter(dieIds => requiredDie === undefined || dieIds.includes(requiredDie))
      .map(dieIds => ({ hand: option.id, dieIds,
        score: handScore(game.dice, option.id, dieIds, game.handLevels[option.id]).score })))
    .sort((a, b) => b.score - a.score)[0];
}

function flameSeed() {
  for (let index = 0; index < 2500; index++) {
    const seed = `flame-browser-${index}`;
    let game = newRun(seed).state;
    for (let step = 0; step < 250; step++) {
      if (game.phase === 'round') {
        const choice = bestHand(game);
        if (choice) game = dispatch(game, { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }).state;
        else if (game.manualRerollsRemaining > 0) game = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }).state;
        else break;
      } else if (game.phase === 'shop') game = dispatch(game, { type: 'NEXT_ROUND' }).state;
      else if (game.phase === 'flameReward') {
        const rerolled = dispatch(game, { type: 'REROLL_FLAMES' }).state;
        if (rerolled.flameReward!.offers.some(offer => offer.flame === 'wellTrained')) return seed;
        break;
      } else break;
    }
  }
  throw new Error('No deterministic three-round Flame Reward seed found.');
}

async function ready(page: Page) {
  await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0);
}

async function perform(page: Page, game: GameState, action: Extract<Action, { type: 'PLAY' | 'MANUAL_REROLL' | 'NEXT_ROUND' }>) {
  if (action.type === 'PLAY') {
    await page.getByRole('button', { name: new RegExp(`^${HANDS[action.hand].name} `) }).click();
    for (const die of game.dice) {
      const target = page.getByRole('button', { name: new RegExp(`^Die ${die.id + 1},`) });
      const selected = await target.getAttribute('aria-pressed') === 'true';
      if (selected !== action.dieIds.includes(die.id)) await target.click();
    }
    await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  } else if (action.type === 'MANUAL_REROLL') {
    await page.getByRole('button', { name: /^Die 1,/ }).click();
    await page.getByRole('button', { name: 'Reroll Selected — 1', exact: true }).click();
  } else await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  const next = dispatch(game, action).state;
  await ready(page);
  return next;
}

async function reachReward(page: Page, seed: string) {
  let game = newRun(seed).state;
  await page.goto(`/?seed=${seed}&speed=instant`);
  await ready(page);

  const initial = bestHand(game)!;
  const initialRow = page.getByRole('button', { name: new RegExp(`^${HANDS[initial.hand].name} `) });
  await initialRow.click();
  await expect(page.locator('.selection-preview')).not.toContainText('XMult');
  await initialRow.click();

  while (game.phase !== 'flameReward') {
    if (game.phase === 'round') {
      const choice = bestHand(game);
      game = await perform(page, game, choice
        ? { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }
        : { type: 'MANUAL_REROLL', dieIds: [0] });
    } else if (game.phase === 'shop') game = await perform(page, game, { type: 'NEXT_ROUND' });
    else throw new Error(`Unexpected phase before Flame Reward: ${game.phase}`);
  }
  return game;
}

test('Flame Reward rerolls offers, preserves faces, reveals XMult, and previews Well Trained', async ({ page }) => {
  const seed = flameSeed();
  let game = await reachReward(page, seed);
  await expect(page.getByText('FLAME REWARD', { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid^="flame-offer-"]')).toHaveCount(3);
  const rewardFaces = game.dice.map(die => die.value);

  await page.getByRole('button', { name: '↻ Reroll · 5 gold', exact: true }).click();
  game = dispatch(game, { type: 'REROLL_FLAMES' }).state;
  await ready(page);
  expect(game.dice.map(die => die.value)).toEqual(rewardFaces);
  await expect(page.getByTestId('stat-gold').getByText(String(game.gold), { exact: true })).toBeVisible();

  const offer = game.flameReward!.offers.find(item => item.flame === 'wellTrained')!;
  const card = page.getByTestId('flame-offer-wellTrained');
  await card.getByRole('button', { name: 'Select Flame', exact: true }).click();
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  game = dispatch(game, { type: 'CHOOSE_FLAME', offerId: offer.id, dieId: 0 }).state;
  await ready(page);

  expect(game.phase).toBe('shop');
  expect(game.dice.map(die => die.value)).toEqual(rewardFaces);
  await expect(page.getByRole('button', { name: new RegExp(`^Die 1, face ${rewardFaces[0]},.*Flame ${FLAMES.wellTrained.name}`) })).toBeVisible();
  await expect(page.getByText(`🔥 ${FLAMES.wellTrained.shortName}`, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await ready(page);
  const choice = bestHand(game, 0)!;
  await page.getByRole('button', { name: new RegExp(`^${HANDS[choice.hand].name} `) }).click();
  for (const die of game.dice) {
    const target = page.getByRole('button', { name: new RegExp(`^Die ${die.id + 1},`) });
    const selected = await target.getAttribute('aria-pressed') === 'true';
    if (selected !== choice.dieIds.includes(die.id)) await target.click();
  }
  const expectedBonus = Number((game.handPlayCounts[choice.hand] * 0.1).toFixed(12));
  await expect(page.getByTestId(`well-trained-preview-${choice.hand}`)).toHaveText(`WELL TRAINED +${expectedBonus} XMULT`);
  await expect(page.locator('.selection-preview')).toContainText('XMult');

  await page.getByRole('button', { name: /^Die 1,/ }).click();
  await expect(page.getByTestId(`well-trained-preview-${choice.hand}`)).toHaveCount(0);
});
