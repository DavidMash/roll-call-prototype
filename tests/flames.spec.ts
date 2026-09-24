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
      } else if (game.phase === 'shop') game = dispatch(game, game.bust ? { type: 'RETRY_ROUND' } : { type: 'NEXT_ROUND' }).state;
      else if (game.phase === 'flameReward') {
        if (game.flameReward!.offers.some(offer => offer.flame === 'wellTrained')) return seed;
        break;
      } else break;
    }
  }
  throw new Error('No deterministic three-round Flame Reward seed found.');
}

async function ready(page: Page) {
  await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0);
}

async function perform(page: Page, game: GameState, action: Extract<Action, { type: 'PLAY' | 'MANUAL_REROLL' | 'NEXT_ROUND' | 'RETRY_ROUND' }>) {
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
  } else await page.getByRole('button', { name: action.type === 'RETRY_ROUND' ? `RETRY ROUND ${game.round}` : 'NEXT ROUND', exact: true }).click();
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
    } else if (game.phase === 'shop') game = await perform(page, game, game.bust ? { type: 'RETRY_ROUND' } : { type: 'NEXT_ROUND' });
    else throw new Error(`Unexpected phase before Flame Reward: ${game.phase}`);
  }
  return game;
}

test('Flame Reward has fixed offers, preserves faces, reveals XMult, and previews Well Trained', async ({ page }) => {
  const seed = flameSeed();
  let game = await reachReward(page, seed);
  await expect(page.getByText('FLAME REWARD', { exact: true })).toBeVisible();
  await expect(page.getByTestId('round-payout-breakdown')).toContainText('5 Flame Bonus');
  await expect(page.getByText('Active Embers', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-testid^="flame-offer-"]')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByTestId('flame-die-4')).toBeVisible();
  const rewardFaces = game.dice.map(die => die.value);

  await expect(page.getByRole('button', { name: /Reroll.*Gold/ })).toHaveCount(0);
  expect(game.dice.map(die => die.value)).toEqual(rewardFaces);
  await expect(page.getByTestId('stat-gold').getByText(String(game.gold), { exact: true })).toBeVisible();

  const offer = game.flameReward!.offers.find(item => item.flame === 'wellTrained')!;
  const card = page.getByTestId('flame-offer-wellTrained');
  await card.getByRole('button', { name: 'Select Flame', exact: true }).click();
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  game = dispatch(game, { type: 'CHOOSE_FLAME', offerId: offer.id, dieId: 0 }).state;
  await ready(page);

  expect(game.phase).toBe('flameReward');
  await expect(page.getByTestId('active-flame-wellTrained')).toContainText('0 / 100 → BONFIRE');
  await page.getByRole('button', { name: 'CONTINUE TO SHOP', exact: false }).click();
  game = dispatch(game, { type: 'CONTINUE_FLAME_REWARD' }).state;
  await ready(page);
  expect(game.phase).toBe('shop');
  expect(game.dice.map(die => die.value)).toEqual(rewardFaces);
  await expect(page.getByRole('button', { name: new RegExp(`^Die 1, face ${rewardFaces[0]},.*Flame ${FLAMES.wellTrained.name}`) })).toBeVisible();
  await expect(page.getByRole('tooltip')).toContainText('Your Flame is only an Ember—it has no effect yet.');
  await expect(page.getByRole('tooltip')).toContainText('Stoke the Flame with Gold');
  await expect(page.getByRole('tooltip')).toContainText('100 Gold');
  await expect(page.locator('.flame-tutorial-anchor')).toHaveCount(1);
  await expect(page.getByText(`🔥 ${FLAMES.wellTrained.shortName} 0`, { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid^="flame-offer-"]')).toHaveCount(0);

  const goldBeforeStoke = game.gold;
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  game = dispatch(game, { type: 'DISMISS_FLAME_TUTORIAL' }).state;
  await ready(page);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const manager = page.getByRole('dialog', { name: 'D1 — Manage Die' });
  await expect(manager.getByTestId('shop-flame-context')).toContainText('0 / 100 → BONFIRE');
  await manager.getByRole('button', { name: 'Stoke Flame', exact: true }).click();
  const shopStoke = page.getByRole('dialog', { name: `D1 — Stoke ${FLAMES.wellTrained.name}` });
  await shopStoke.getByLabel(`Stoke amount for ${FLAMES.wellTrained.name}`).fill('2');
  await expect(shopStoke.getByText(/After Stoke · 2\/100/)).toBeVisible();
  await shopStoke.getByRole('button', { name: 'Stoke 2 Gold', exact: true }).click();
  game = dispatch(game, { type: 'STOKE_FLAME', dieId: 0, amount: 2 }).state;
  await ready(page);
  expect(game.gold).toBe(goldBeforeStoke - 2);
  expect(game.dice[0].flame?.investedGold).toBe(2);
  expect(game.stats.flameStokes.at(-1)?.source).toBe('shop');
  await expect(shopStoke).toContainText('2 / 100 → BONFIRE');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

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
  await expect(page.getByTestId(`well-trained-preview-${choice.hand}`)).toHaveText('WELL TRAINED ×1');
  await expect(page.locator('.selection-preview')).toContainText('XMult');

  await page.getByRole('button', { name: /^Die 1,/ }).click();
  await expect(page.getByTestId(`well-trained-preview-${choice.hand}`)).toHaveCount(0);
});

test('Flame Reward only acquires while Shop Manage Die supports arbitrary Stoke and optional acquisition', async ({ page }) => {
  const seed = flameSeed();
  let game = await reachReward(page, seed);
  const rewardFaces = game.dice.map(die => die.value);
  const offer = game.flameReward!.offers[0];
  await page.getByTestId(`flame-offer-${offer.flame}`).getByRole('button', { name: 'Select Flame' }).click();
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  game = dispatch(game, { type: 'CHOOSE_FLAME', offerId: offer.id, dieId: 0 }).state;
  await ready(page);
  const active = page.getByTestId(`active-flame-${offer.flame}`);
  await expect(active).toContainText('0 / 100 → BONFIRE');
  await expect(page.getByText(/Donate/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Stoke/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'CONTINUE TO SHOP', exact: false }).click();
  game = dispatch(game, { type: 'CONTINUE_FLAME_REWARD' }).state;
  await ready(page);
  expect(game.phase).toBe('shop');
  expect(game.dice.map(die => die.value)).toEqual(rewardFaces);
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss Flame tip', exact: true }).click();
  game = dispatch(game, { type: 'DISMISS_FLAME_TUTORIAL' }).state;
  await ready(page);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  const manager = page.getByRole('dialog', { name: 'D1 — Manage Die' });
  await manager.getByRole('button', { name: 'Stoke Flame', exact: true }).click();
  const stoke = page.getByRole('dialog', { name: new RegExp(`Stoke ${FLAMES[offer.flame].name}`) });
  await expect(stoke).toContainText('Current');
  await expect(stoke).toContainText('At Bonfire');
  await stoke.getByLabel(`Stoke amount for ${FLAMES[offer.flame].name}`).fill('7');
  await stoke.getByRole('button', { name: 'Stoke 7 Gold', exact: true }).click();
  game = dispatch(game, { type: 'STOKE_FLAME', dieId: 0, amount: 7 }).state;
  await ready(page);
  await expect(stoke).toContainText('7 / 100 → BONFIRE');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // A separate deterministic run can use the same primary action without taking an offer.
  game = await reachReward(page, seed);
  await page.getByRole('button', { name: 'CONTINUE TO SHOP', exact: false }).click();
  game = dispatch(game, { type: 'CONTINUE_FLAME_REWARD' }).state;
  await ready(page);
  expect(game.phase).toBe('shop');
  expect(game.stats.flameSkips).toContain(game.round);
});
