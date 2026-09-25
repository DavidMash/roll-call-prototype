import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dispatch, newRun } from '../src/game/engine';
import { FLAMES, wellTrainedMultiplier } from '../src/game/flames';
import { handOptions, HANDS } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { Action, GameState } from '../src/game/types';
import { activeEncounterDice, unavailableEncounterHands } from '../src/game/bosses';
import { CONFIG } from '../src/game/config';
import { RUN_STORAGE_KEY } from '../src/game/persistence';

function bestHand(game: GameState, requiredDie?: number, requireHistory = false) {
  const dice = activeEncounterDice(game);
  const callerHand = game.boss?.type === 'caller' && !game.boss.satisfied ? game.boss.calledHand : null;
  return handOptions(dice, unavailableEncounterHands(game)).filter(option => !option.consumed)
    .flatMap(option => option.combinations
      .filter(dieIds => requiredDie === undefined || dieIds.includes(requiredDie))
      .map(dieIds => ({ hand: option.id, dieIds,
        score: handScore(dice, option.id, dieIds, game.handLevels[option.id]).score })))
    .filter(choice => !requireHistory || game.handPlayCounts[choice.hand] > 0)
    .filter(choice => game.boss?.type !== 'hexer' || choice.dieIds.includes(game.boss.cursedDieId))
    .sort((a, b) => (callerHand ? Number(b.hand === callerHand) - Number(a.hand === callerHand) : 0) || b.score - a.score)[0];
}
function automaticAction(game: GameState): Extract<Action, { type: 'PLAY' | 'MANUAL_REROLL' | 'UNLOCK_WARDEN_DIE' }> {
  if (game.boss?.type === 'warden' && game.boss.pendingReinforcements > 0) {
    const activeDieIds = game.boss.activeDieIds;
    const die = game.dice.find(item => item.owner === 'player' && !activeDieIds.includes(item.id))!;
    return { type: 'UNLOCK_WARDEN_DIE', dieId: die.id };
  }
  const choice = bestHand(game);
  if (game.boss?.type === 'caller' && !game.boss.satisfied && choice?.hand !== game.boss.calledHand && game.manualRerollsRemaining > 0) {
    return { type: 'MANUAL_REROLL', dieIds: [activeEncounterDice(game)[0].id] };
  }
  return choice ? { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }
    : { type: 'MANUAL_REROLL', dieIds: [activeEncounterDice(game)[0].id] };
}

function flameSeed() {
  for (let index = 0; index < 2500; index++) {
    const seed = `flame-browser-${index}`;
    let game = newRun(seed).state;
    for (let step = 0; step < 250; step++) {
      if (game.phase === 'round') {
        game = dispatch(game, automaticAction(game)).state;
      } else if (game.phase === 'roundSummary') game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
      else if (game.phase === 'shop') game = dispatch(game, game.bust ? { type: 'RETRY_ROUND' } : { type: 'NEXT_ROUND' }).state;
      else if (game.phase === 'flameSelection') {
        if (game.flameSelection!.offers.some(offer => offer.flame === 'wellTrained')) {
          const shop = dispatch(game, { type: 'CONTINUE_FLAME_SELECTION' }).state;
          const next = dispatch(shop, { type: 'NEXT_ROUND' }).state;
          if (bestHand(next, 0, true)) return seed;
        }
        break;
      } else break;
    }
  }
  throw new Error('No deterministic three-round Flame Selection seed found.');
}

async function ready(page: Page) {
  await page.locator('main').waitFor();
  for (let barrier = 0; barrier < 2; barrier++) {
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
  await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0);
}

async function perform(page: Page, game: GameState, action: Extract<Action, { type: 'PLAY' | 'MANUAL_REROLL' | 'UNLOCK_WARDEN_DIE' | 'NEXT_ROUND' | 'RETRY_ROUND' | 'CONTINUE_ROUND_SUMMARY' }>) {
  if (action.type === 'PLAY') {
    const handRow = page.getByRole('button', { name: new RegExp(`^${HANDS[action.hand].name} `) });
    await handRow.click();
    for (const die of activeEncounterDice(game)) {
      const target = page.getByRole('button', { name: new RegExp(`^${die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`},`) });
      const selected = await target.getAttribute('aria-pressed') === 'true';
      if (selected !== action.dieIds.includes(die.id)) await target.click();
    }
    if (await handRow.getAttribute('aria-pressed') !== 'true') await handRow.click();
    await page.getByRole('button', { name: /^(PLAY|LAST PLAY)$/ }).click();
  } else if (action.type === 'MANUAL_REROLL') {
    const die = game.dice.find(item => item.id === action.dieIds[0])!;
    await page.getByRole('button', { name: new RegExp(`^${die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`},`) }).click();
    await page.getByRole('button', { name: 'Reroll Selected — 1', exact: true }).click();
  } else if (action.type === 'UNLOCK_WARDEN_DIE') {
    await page.getByRole('button', { name: new RegExp(`^Die ${action.dieId + 1},.*selectable to unlock$`) }).click();
    await page.getByRole('button', { name: 'UNLOCK DIE', exact: true }).click();
  } else if (action.type === 'CONTINUE_ROUND_SUMMARY') await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
  else await page.getByRole('button', { name: action.type === 'RETRY_ROUND' ? `RETRY ROUND ${game.round}` : 'NEXT ROUND', exact: true }).click();
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

  while (game.phase !== 'flameSelection') {
    if (game.phase === 'round') {
      game = await perform(page, game, automaticAction(game));
    } else if (game.phase === 'roundSummary') game = await perform(page, game, { type: 'CONTINUE_ROUND_SUMMARY' });
    else if (game.phase === 'shop') game = await perform(page, game, game.bust ? { type: 'RETRY_ROUND' } : { type: 'NEXT_ROUND' });
    else throw new Error(`Unexpected phase before Flame Selection: ${game.phase}`);
  }
  return game;
}

test('Flame Selection has fixed offers, preserves faces, reveals XMult, and previews Well Trained', async ({ page }) => {
  const seed = flameSeed();
  let game = await reachReward(page, seed);
  await expect(page.getByRole('main').getByText('FLAME SELECTION', { exact: true })).toBeVisible();
  await expect(page.getByText('Active Embers', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-testid^="flame-offer-"]')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByTestId('flame-die-4')).toBeVisible();
  await expect(page.locator('.flame-die-card .pip-face')).toHaveCount(5);
  const rewardFaces = game.dice.map(die => die.value);

  await expect(page.getByRole('button', { name: /Reroll.*Gold/ })).toHaveCount(0);
  expect(game.dice.map(die => die.value)).toEqual(rewardFaces);
  await expect(page.getByTestId('stat-gold').getByText(String(game.gold), { exact: true })).toBeVisible();

  const offer = game.flameSelection!.offers.find(item => item.flame === 'wellTrained')!;
  const card = page.getByTestId('flame-offer-wellTrained');
  await card.getByRole('button', { name: 'Select Flame', exact: true }).click();
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  game = dispatch(game, { type: 'CHOOSE_FLAME', offerId: offer.id, dieId: 0 }).state;
  await ready(page);

  expect(game.phase).toBe('flameSelection');
  await expect(page.getByTestId('active-flame-wellTrained')).toContainText('0 / 100 → BONFIRE');
  await page.getByRole('button', { name: 'CONTINUE TO SHOP', exact: false }).click();
  game = dispatch(game, { type: 'CONTINUE_FLAME_SELECTION' }).state;
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
  const choice = bestHand(game, 0, true)!;
  await page.getByRole('button', { name: new RegExp(`^${HANDS[choice.hand].name} `) }).click();
  for (const die of game.dice) {
    const target = page.getByRole('button', { name: new RegExp(`^Die ${die.id + 1},`) });
    const selected = await target.getAttribute('aria-pressed') === 'true';
    if (selected !== choice.dieIds.includes(die.id)) await target.click();
  }
  const wellTrained = Number(wellTrainedMultiplier(2, game.handPlayCounts[choice.hand]).toFixed(4));
  await expect(page.getByTestId(`well-trained-preview-${choice.hand}`)).toHaveText(`WELL TRAINED ×${wellTrained}`);
  await expect(page.locator('.selection-preview')).toContainText('XMult');
  await page.setViewportSize({ width: 500, height: 520 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const panel = page.getByTestId('live-score-panel');
  await expect(panel).toBeInViewport();
  await page.clock.install({ time: new Date('2026-09-24T12:00:00Z') });
  await page.getByText('NORMAL', { exact: true }).click();
  await page.getByRole('button', { name: /^(PLAY|LAST PLAY)$/ }).click();
  const result = dispatch(game, { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds });
  const xMultIndex = result.events.findIndex(event => event.type === 'HAND_XMULT_CHANGED' && event.flame === 'wellTrained');
  expect(xMultIndex).toBeGreaterThan(0);
  await page.clock.runFor(CONFIG.tickMs.normal * xMultIndex);
  await expect(page.getByTestId('hand-xmult')).toHaveText(`x${result.events[xMultIndex].handScore!.currentXMult}`);
  await expect(panel).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('Flame Selection only acquires while Shop Manage Die supports arbitrary Stoke and optional acquisition', async ({ page }) => {
  const seed = flameSeed();
  let game = await reachReward(page, seed);
  const rewardFaces = game.dice.map(die => die.value);
  const offer = game.flameSelection!.offers[0];
  await page.getByTestId(`flame-offer-${offer.flame}`).getByRole('button', { name: 'Select Flame' }).click();
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  game = dispatch(game, { type: 'CHOOSE_FLAME', offerId: offer.id, dieId: 0 }).state;
  await ready(page);
  const active = page.getByTestId(`active-flame-${offer.flame}`);
  await expect(active).toContainText('0 / 100 → BONFIRE');
  await expect(page.getByText(/Donate/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Stoke/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'CONTINUE TO SHOP', exact: false }).click();
  game = dispatch(game, { type: 'CONTINUE_FLAME_SELECTION' }).state;
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
  await page.evaluate(key => localStorage.removeItem(key), RUN_STORAGE_KEY);
  game = await reachReward(page, seed);
  await page.getByRole('button', { name: 'CONTINUE TO SHOP', exact: false }).click();
  game = dispatch(game, { type: 'CONTINUE_FLAME_SELECTION' }).state;
  await ready(page);
  expect(game.phase).toBe('shop');
  expect(game.stats.flameSkips).toContain(game.round);
});
