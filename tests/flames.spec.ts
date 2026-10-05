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
import { specialOfferName } from '../src/game/specialOffers';
import { enterRun, openMenuItem, setDiceDisplay, setPlaybackSpeed } from './uiHelpers';

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
      } else if (game.phase === 'specialOffer') {
        const offer = game.specialOffer!.offers.find(item => item.type !== 'timeTravel') ?? game.specialOffer!.offers[0];
        game = dispatch(game, game.specialOffer!.acquired
          ? { type: 'CONTINUE_SPECIAL_OFFER' }
          : { type: 'CHOOSE_SPECIAL_OFFER', offerId: offer.id }).state;
      } else break;
    }
  }
  throw new Error('No deterministic three-round Flame Selection seed found.');
}

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

async function perform(page: Page, game: GameState, action: Extract<Action, { type: 'PLAY' | 'MANUAL_REROLL' | 'UNLOCK_WARDEN_DIE' | 'NEXT_ROUND' | 'RETRY_ROUND' | 'CONTINUE_ROUND_SUMMARY' | 'CHOOSE_SPECIAL_OFFER' | 'CONTINUE_SPECIAL_OFFER' }>) {
  if (action.type === 'PLAY') {
    const handRow = page.getByRole('button', { name: new RegExp(`^${HANDS[action.hand].name} `) });
    await handRow.click();
    for (const die of activeEncounterDice(game)) {
      const target = page.getByRole('button', { name: new RegExp(`^${die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`},`) });
      const selected = await target.getAttribute('aria-pressed') === 'true';
      if (selected !== action.dieIds.includes(die.id)) await target.click();
    }
    if (await handRow.getAttribute('aria-pressed') !== 'true') await handRow.click();
    await page.getByRole('button', { name: /^(PLAY|LAST PLAY[?.])$/ }).click();
  } else if (action.type === 'MANUAL_REROLL') {
    const die = game.dice.find(item => item.id === action.dieIds[0])!;
    await page.getByRole('button', { name: new RegExp(`^${die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`},`) }).click();
    await page.getByTestId('manual-reroll').click();
  } else if (action.type === 'UNLOCK_WARDEN_DIE') {
    await page.getByRole('button', { name: new RegExp(`^Die ${action.dieId + 1},.*selectable to unlock$`) }).click();
    await page.getByRole('button', { name: 'UNLOCK DIE', exact: true }).click();
  } else if (action.type === 'CONTINUE_ROUND_SUMMARY') await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
  else if (action.type === 'CHOOSE_SPECIAL_OFFER') {
    const offer = game.specialOffer!.offers.find(item => item.id === action.offerId)!;
    await page.getByRole('heading', { name: specialOfferName(offer), exact: true }).locator('..').getByRole('button', { name: 'CHOOSE' }).click();
  } else if (action.type === 'CONTINUE_SPECIAL_OFFER') await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
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
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).not.toContainText('*');
  await initialRow.click();

  while (game.phase !== 'flameSelection') {
    if (game.phase === 'round') {
      game = await perform(page, game, automaticAction(game));
    } else if (game.phase === 'roundSummary') game = await perform(page, game, { type: 'CONTINUE_ROUND_SUMMARY' });
    else if (game.phase === 'shop') game = await perform(page, game, game.bust ? { type: 'RETRY_ROUND' } : { type: 'NEXT_ROUND' });
    else if (game.phase === 'specialOffer') {
      const offer = game.specialOffer!.offers.find(item => item.type !== 'timeTravel') ?? game.specialOffer!.offers[0];
      game = await perform(page, game, game.specialOffer!.acquired
        ? { type: 'CONTINUE_SPECIAL_OFFER' }
        : { type: 'CHOOSE_SPECIAL_OFFER', offerId: offer.id });
    }
    else throw new Error(`Unexpected phase before Flame Selection: ${game.phase}`);
  }
  return game;
}

test('Flame Selection has fixed offers, preserves faces, reveals XMult, and previews Well Trained', async ({ page }) => {
  test.setTimeout(120_000);
  const seed = flameSeed();
  let game = await reachReward(page, seed);
  await expect(page.getByRole('main').getByText('FLAME SELECTION', { exact: true })).toBeVisible();
  await expect(page.getByText('Active Embers', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-testid^="flame-offer-"]')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('.flame-offers').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(3);
  expect(await page.locator('.dice-dock .dice-row').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(5);
  const mobileLayout = await page.evaluate(() => ({
    offerHeights: [...document.querySelectorAll<HTMLElement>('.flame-offer')].map(card => card.getBoundingClientRect().height),
    offerNameHeights: [...document.querySelectorAll<HTMLElement>('.flame-offer-name')].map(name => name.getBoundingClientRect().height),
    dieCardTops: [...document.querySelectorAll<HTMLElement>('.dice-dock .die-slot')].map(card => Math.round(card.getBoundingClientRect().top)),
    dieHeights: [...document.querySelectorAll<HTMLElement>('.dice-dock .die')].map(die => die.getBoundingClientRect().height),
  }));
  expect(Math.max(...mobileLayout.offerHeights) - Math.min(...mobileLayout.offerHeights)).toBeLessThan(2);
  expect(Math.max(...mobileLayout.offerNameHeights)).toBeLessThan(40);
  expect(new Set(mobileLayout.dieCardTops).size).toBe(1);
  expect(Math.max(...mobileLayout.dieHeights)).toBeLessThanOrEqual(62);
  await expect(page.locator('.flame-offer .flame-offer-info').first()).toBeVisible();
  await expect(page.getByTestId('flame-die-4')).toBeVisible();
  await expect(page.locator('.dice-dock .die-number')).toHaveCount(5);
  await page.screenshot({ path: test.info().outputPath('flame-selection-mobile.png'), fullPage: true });
  await setDiceDisplay(page, 'PIPS');
  await expect(page.locator('.dice-dock .pip-face')).toHaveCount(5);
  const rewardFaces = game.dice.map(die => die.value);

  await expect(page.getByRole('button', { name: /Reroll.*Gold/ })).toHaveCount(0);
  expect(game.dice.map(die => die.value)).toEqual(rewardFaces);
  await expect(page.getByTestId('stat-gold').getByText(String(game.gold), { exact: true })).toBeVisible();

  const offer = game.flameSelection!.offers.find(item => item.flame === 'wellTrained')!;
  const card = page.getByTestId('flame-offer-wellTrained');
  await expect(card).not.toContainText(FLAMES.wellTrained.description);
  await card.getByRole('button', { name: `About ${FLAMES.wellTrained.name}` }).click();
  await expect(page.getByRole('dialog', { name: FLAMES.wellTrained.name })).toContainText(FLAMES.wellTrained.description);
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'Select Flame', exact: true }).click();
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  game = dispatch(game, { type: 'CHOOSE_FLAME', offerId: offer.id, dieId: 0 }).state;
  await ready(page);

  expect(game.phase).toBe('flameSelection');
  await expect(page.getByTestId('active-flame-wellTrained')).toHaveAccessibleName('View Well Trained Flame details, Ember at 0 of 100 Gold');
  await page.screenshot({ path: test.info().outputPath('flame-selection-acquired-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'CONTINUE TO SHOP', exact: false }).click();
  game = dispatch(game, { type: 'CONTINUE_FLAME_SELECTION' }).state;
  await ready(page);
  expect(game.phase).toBe('shop');
  expect(game.dice.map(die => die.value)).toEqual(rewardFaces);
  await expect(page.getByRole('button', { name: new RegExp(`^Die 1, face ${rewardFaces[0]},.*Ember ${FLAMES.wellTrained.name}`) })).toBeVisible();
  await expect(page.getByRole('tooltip')).toContainText('NEW EMBER');
  await expect(page.getByRole('tooltip')).toContainText('Stoke Flames in the Shop. At 100 Gold, they become Bonfires.');
  await expect(page.locator('.flame-tutorial-anchor')).toHaveCount(1);
  await expect(page.getByTestId('active-flame-wellTrained')).toBeVisible();
  await expect(page.locator('[data-testid^="flame-offer-"]')).toHaveCount(0);

  const goldBeforeStoke = game.gold;
  await page.getByRole('button', { name: 'Dismiss Flame tip', exact: true }).click();
  game = dispatch(game, { type: 'DISMISS_FLAME_TUTORIAL' }).state;
  await ready(page);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByRole('button', { name: `View ${FLAMES.wellTrained.name} Flame details, Ember at 0 of 100 Gold` }).click();
  const shopStoke = page.getByRole('dialog', { name: FLAMES.wellTrained.name });
  await shopStoke.getByLabel(`Stoke amount for ${FLAMES.wellTrained.name}`).fill('2');
  await expect(shopStoke.getByText(/AFTER STOKE · 2\/100/)).toBeVisible();
  await shopStoke.getByRole('button', { name: 'STOKE 2 GOLD', exact: true }).click();
  game = dispatch(game, { type: 'STOKE_FLAME', dieId: 0, amount: 2 }).state;
  await ready(page);
  expect(game.gold).toBe(goldBeforeStoke - 2);
  expect(game.dice[0].flame?.investedGold).toBe(2);
  expect(game.stats.flameStokes.at(-1)?.source).toBe('shop');
  await expect(shopStoke).toContainText('2 / 100');
  await expect(shopStoke).toContainText('BONFIRE AT 100');
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
  await expect(page.getByTestId(`well-trained-preview-${choice.hand}`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toContainText(`× ${wellTrained} =`);
  await page.setViewportSize({ width: 500, height: 520 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const panel = page.getByTestId('live-score-panel');
  await expect(panel).toBeInViewport();
  await page.clock.install({ time: new Date('2026-09-24T12:00:00Z') });
  await setPlaybackSpeed(page, 'NORMAL');
  await page.getByRole('button', { name: /^(PLAY|LAST PLAY[?.])$/ }).click();
  const result = dispatch(game, { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds });
  const xMultIndex = result.events.findIndex(event => event.type === 'HAND_XMULT_CHANGED' && event.flame === 'wellTrained');
  expect(xMultIndex).toBeGreaterThan(0);
  await page.clock.runFor(CONFIG.tickMs.normal * xMultIndex);
  await expect(page.getByTestId('hand-xmult')).toHaveText(String(result.events[xMultIndex].handScore!.currentXMult));
  await expect(panel).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight
    && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Flame Selection only acquires while Shop Manage Die supports arbitrary Stoke and optional acquisition', async ({ page }) => {
  test.setTimeout(150_000);
  const seed = flameSeed();
  let game = await reachReward(page, seed);
  const rewardFaces = game.dice.map(die => die.value);
  const offer = game.flameSelection!.offers[0];
  await page.getByTestId(`flame-offer-${offer.flame}`).getByRole('button', { name: 'Select Flame' }).click();
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  game = dispatch(game, { type: 'CHOOSE_FLAME', offerId: offer.id, dieId: 0 }).state;
  await ready(page);
  const active = page.getByTestId(`active-flame-${offer.flame}`);
  await expect(active).toHaveAccessibleName(`View ${FLAMES[offer.flame].name} Flame details, Ember at 0 of 100 Gold`);
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
  await page.getByRole('button', { name: `View ${FLAMES[offer.flame].name} Flame details, Ember at 0 of 100 Gold` }).click();
  const stoke = page.getByRole('dialog', { name: FLAMES[offer.flame].name });
  await expect(stoke).toContainText('BONFIRE AT 100');
  await expect(stoke).not.toContainText('Full strength');
  await expect(stoke).not.toContainText('At Bonfire');
  await stoke.getByLabel(`Stoke amount for ${FLAMES[offer.flame].name}`).fill('7');
  await stoke.getByRole('button', { name: 'STOKE 7 GOLD', exact: true }).click();
  game = dispatch(game, { type: 'STOKE_FLAME', dieId: 0, amount: 7 }).state;
  await ready(page);
  await expect(stoke).toContainText('7 / 100');
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

test('arming and canceling Charge preserves the selected hand and dice', async ({ page }) => {
  const seed = 'charge-selection-preservation';
  const game = newRun(seed).state;
  game.dice[0].flame = { id: 'momentum', investedGold: 50 };
  game.chargeXMult = 3;
  game.dice.forEach(die => { die.value = 1; });
  const choice = bestHand(game)!;

  await page.goto('/');
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify({ version: 1, state })), {
    key: RUN_STORAGE_KEY,
    state: game,
  });
  await page.goto(`/?seed=${seed}&speed=instant`);
  await ready(page);
  await expect(page.getByTestId('charge-status')).toHaveText('⚡ MAX CHARGE ×3');
  await expect(page.getByTestId('charge-guidance')).toHaveText('SELECT CHARGE DIE TO USE');

  const handRow = page.getByTestId(`scorecard-row-${choice.hand}`);
  await handRow.click();
  for (const die of game.dice) {
    const dieButton = page.getByRole('button', { name: new RegExp(`^Die ${die.id + 1},`) });
    const selected = await dieButton.getAttribute('aria-pressed') === 'true';
    if (selected !== choice.dieIds.includes(die.id)) await dieButton.click();
  }
  await expect(handRow).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('charge-guidance')).toHaveCount(0);

  const chargeButton = page.getByRole('button', { name: 'ARM CHARGE', exact: true });
  await chargeButton.click();
  await ready(page);
  await expect(page.getByTestId('charge-status')).toHaveText('⚡ ×3 ARMED');
  await expect(handRow).toHaveAttribute('aria-pressed', 'true');
  for (const dieId of choice.dieIds) {
    await expect(page.getByRole('button', { name: new RegExp(`^Die ${dieId + 1},`) })).toHaveAttribute('aria-pressed', 'true');
  }

  await page.getByRole('button', { name: 'DISARM', exact: true }).click();
  await ready(page);
  await expect(handRow).toHaveAttribute('aria-pressed', 'true');
  for (const dieId of choice.dieIds) {
    await expect(page.getByRole('button', { name: new RegExp(`^Die ${dieId + 1},`) })).toHaveAttribute('aria-pressed', 'true');
  }

  await chargeButton.click();
  await ready(page);
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  await ready(page);
  await expect(page.getByRole('button', { name: 'ARM CHARGE', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Die 1,/ })).toHaveAttribute('aria-pressed', 'false');
});

test('Speed Demon meter pauses in modals, stays out of preview, and reveals the frozen Play factor', async ({ page }) => {
  const seed = 'speed-demon-browser';
  const game = newRun(seed).state;
  game.dice.forEach(die => { die.value = 1; });
  game.dice[0].flame = { id: 'speedDemon', investedGold: 100 };
  game.target = 1_000_000;
  game.stats.rounds[0].target = game.target;

  await page.goto('/');
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify({ version: 1, state })), {
    key: RUN_STORAGE_KEY,
    state: game,
  });
  await page.clock.install({ time: new Date('2026-09-29T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-29T12:00:01Z'));
  await page.goto(`/?seed=${seed}&speed=normal`);
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('scorecard-row-ones').click();
  const play = page.getByTestId('play-action');
  const previewText = await play.textContent();
  await expect(page.getByTestId('speed-demon-meter')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.clock.runFor(1500);
  await openMenuItem(page, 'How to Play');
  await expect(page.getByRole('dialog', { name: 'How to Play' })).toBeVisible();
  const beforePause = await page.locator('.speed-demon-meter-fill').getAttribute('style');
  await page.clock.runFor(4000);
  expect(await page.locator('.speed-demon-meter-fill').getAttribute('style')).toBe(beforePause);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'How to Play' })).toHaveCount(0);
  await page.clock.runFor(4000);
  await expect(play).toHaveText(previewText!);

  await play.evaluate(element => (element as HTMLElement).click());
  const storedAction = await page.evaluate(key => {
    const saved = JSON.parse(localStorage.getItem(key)!).state as GameState;
    return saved.stats.actions.at(-1)!;
  }, RUN_STORAGE_KEY);
  if (storedAction.type !== 'PLAY' || storedAction.decisionMs === undefined) throw new Error('Missing frozen Speed Demon decision time');
  expect(storedAction.decisionMs).toBeGreaterThanOrEqual(5400);
  expect(storedAction.decisionMs).toBeLessThan(6000);
  const result = dispatch(game, storedAction);
  const revealIndex = result.events.findIndex(event => event.type === 'SPEED_DEMON_REVEALED');
  expect(revealIndex).toBeGreaterThan(0);
  let revealed = false;
  for (let index = 0; index <= result.events.length; index++) {
    if (await page.getByTestId('speed-demon-reveal').count()) { revealed = true; break; }
    await page.clock.runFor(CONFIG.tickMs.normal);
  }
  expect(revealed).toBe(true);
  await expect(page.getByTestId('speed-demon-reveal')).toHaveText(/SPEED DEMON ×/);
  await page.clock.runFor(CONFIG.tickMs.normal);
  await expect(play).not.toHaveText(previewText!);
});
