import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { newRun, dispatch } from '../src/game/engine';
import { activeFace } from '../src/game/dice';
import { handOptions, handStats, HANDS, HAND_IDS } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import { enhancementCost, ENHANCEMENTS } from '../src/game/enhancements';
import { CONFIG } from '../src/game/config';
import type { Action, Enhancement, GameState } from '../src/game/types';
import { activeEncounterDice, unavailableEncounterHands } from '../src/game/bosses';
import { RUN_STORAGE_KEY } from '../src/game/persistence';
import { openGameMenu, openMenuItem, setDiceDisplay, setPlaybackSpeed } from './uiHelpers';

async function expectCenteredPips(die: Locator) {
  const dieBox = await die.boundingBox();
  const faceBox = await die.locator('.pip-face').boundingBox();
  const pipBox = await die.locator('.pip').first().boundingBox();
  expect(dieBox).not.toBeNull();
  expect(faceBox).not.toBeNull();
  expect(pipBox).not.toBeNull();
  expect(Math.abs((faceBox!.x + faceBox!.width / 2) - (dieBox!.x + dieBox!.width / 2))).toBeLessThan(1);
  expect(Math.abs((faceBox!.y + faceBox!.height / 2) - (dieBox!.y + dieBox!.height / 2))).toBeLessThan(1);
  expect(pipBox!.width / dieBox!.width).toBeGreaterThan(.09);
}

function bestHand(game: GameState) {
  const dice = activeEncounterDice(game);
  const callerHand = game.boss?.type === 'caller' && !game.boss.satisfied ? game.boss.calledHand : null;
  return handOptions(dice, unavailableEncounterHands(game)).filter(option => !option.consumed)
    .flatMap(option => option.combinations.map(dieIds => ({ hand: option.id, dieIds,
      score: handScore(dice, option.id, dieIds, game.handLevels[option.id]).score })))
    .filter(choice => game.boss?.type !== 'hexer' || choice.dieIds.includes(game.boss.cursedDieId))
    .sort((a, b) => (callerHand ? Number(b.hand === callerHand) - Number(a.hand === callerHand) : 0) || b.score - a.score)[0];
}
function automaticAction(game: GameState): Action {
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
async function matchBoard(page: Page, game: GameState) {
  await ready(page);
  for (const [stat, value] of [['round', game.round], ['gold', game.gold]] as const) {
    await expect(page.getByTestId(`stat-${stat}`).getByText(String(value), { exact: true })).toBeVisible();
  }
  for (const stat of ['goal', 'score', 'rerolls']) await expect(page.getByTestId(`stat-${stat}`)).toHaveCount(0);
  if (game.phase === 'roundSummary') {
    await expect(page.getByTestId('round-summary')).toBeVisible();
    return;
  }
  if (game.phase === 'shop' || game.phase === 'flameSelection') {
    if (game.phase === 'shop' && game.bust) await expect(page.getByTestId('bust-shop-banner')).toBeVisible();
    else if (game.phase === 'shop') await expect(page.getByRole('main').getByText('SHOP', { exact: true })).toBeVisible();
    else await expect(page.getByRole('main').getByText('FLAME SELECTION', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^REROLL \d+ \/ 3$/ })).toHaveCount(0);
  } else if (game.phase === 'round') {
    await expect(page.getByTestId('round-score-progress')).toHaveText(`${game.score} / ${game.target}`);
    await expect(page.getByTestId('round-goal-progress')).toHaveAttribute('aria-valuetext', `${game.score} of ${game.target} points toward the Goal`);
  }
  const visibleDice = game.phase === 'round' ? activeEncounterDice(game) : game.dice;
  for (const die of visibleDice) await expect(page.getByRole('button', { name: new RegExp(`^${die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`}, face ${activeFace(die).rank},`) })).toBeVisible();
}
async function playBest(page: Page, game: GameState): Promise<GameState> {
  if (game.boss?.type === 'warden' && game.boss.pendingReinforcements > 0) {
    const activeDieIds = game.boss.activeDieIds;
    const die = game.dice.find(item => item.owner === 'player' && !activeDieIds.includes(item.id))!;
    await page.getByRole('button', { name: new RegExp(`^Die ${die.id + 1},.*selectable to unlock$`) }).click();
    await page.getByRole('button', { name: 'UNLOCK DIE', exact: true }).click();
    const next = dispatch(game, { type: 'UNLOCK_WARDEN_DIE', dieId: die.id }).state;
    await matchBoard(page, next);
    return next;
  }
  const choice = bestHand(game);
  if (game.boss?.type === 'caller' && !game.boss.satisfied && choice?.hand !== game.boss.calledHand && game.manualRerollsRemaining > 0) {
    const die = activeEncounterDice(game)[0];
    await page.getByRole('button', { name: new RegExp(`^Die ${die.id + 1},`) }).click();
    await page.getByRole('button', { name: /^REROLL \d+ \/ 3$/ }).click();
    const next = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [die.id] }).state;
    await matchBoard(page, next);
    return next;
  }
  if (!choice) {
    const die = activeEncounterDice(game)[0];
    await page.getByRole('button', { name: new RegExp(`^${die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`},`) }).click();
    await page.getByRole('button', { name: `REROLL ${CONFIG.manualRerollsPerRound - game.manualRerollsRemaining + 1} / ${CONFIG.manualRerollsPerRound}`, exact: true }).click();
    const next = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [die.id] }).state;
    await matchBoard(page, next);
    return next;
  }
  const handRow = page.getByRole('button', { name: new RegExp(`^${HANDS[choice.hand].name} `) });
  await handRow.click();
  for (const die of activeEncounterDice(game)) {
    const target = page.getByRole('button', { name: new RegExp(`^${die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`},`) });
    const selected = await target.getAttribute('aria-pressed') === 'true';
    if (selected !== choice.dieIds.includes(die.id)) await target.click();
  }
  if (await handRow.getAttribute('aria-pressed') !== 'true') await handRow.click();
  await page.getByRole('button', { name: /^(PLAY|LAST PLAY[?.])$/ }).click();
  const next = dispatch(game, { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }).state;
  await matchBoard(page, next);
  return next;
}
function findShopSeed(required?: Enhancement) {
  for (let i = 0; i < 1000; i++) {
    const seed = `browser-${i}`;
    let game = newRun(seed).state;
    for (let step = 0; step < 12 && game.phase === 'round'; step++) {
      game = dispatch(game, automaticAction(game)).state;
    }
    if (game.phase === 'roundSummary') game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
    if (game.phase === 'shop' && !game.bust && (!required || game.shop!.offers.some(offer => offer.enhancement === required))) return seed;
  }
  throw new Error('No suitable shop seed found');
}
function findTrainingSeed() {
  for (let i = 0; i < 1000; i++) {
    const seed = `training-browser-${i}`;
    let game = newRun(seed).state;
    for (let step = 0; step < 12 && game.phase === 'round'; step++) {
      game = dispatch(game, automaticAction(game)).state;
    }
    if (game.phase === 'roundSummary') game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
    if (game.phase !== 'shop' || game.bust) continue;
    for (const offer of game.shop!.trainingOffers) {
      if (offer.kind !== 'hand') continue;
      const trained = dispatch(game, { type: 'TRAIN_HAND', hand: offer.hand }).state;
      const next = dispatch(trained, { type: 'NEXT_ROUND' }).state;
      const option = handOptions(next.dice, next.consumed).find(item => item.id === offer.hand && !item.consumed);
      if (option) {
        const scored = handScore(next.dice, offer.hand, option.combinations[0], 2);
        if (!Number.isInteger(scored.rawScore) && scored.score < next.target) return { seed, hand: offer.hand };
      }
    }
  }
  throw new Error('No suitable Hand Training seed found');
}
function findTeamTrainingSeed() {
  for (let i = 0; i < 1000; i++) {
    const seed = `team-training-browser-${i}`;
    let game = newRun(seed).state;
    for (let step = 0; step < 12 && game.phase === 'round'; step++) game = dispatch(game, automaticAction(game)).state;
    if (game.phase === 'roundSummary') game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
    if (game.phase === 'shop' && !game.bust && game.shop!.trainingOffers.some(offer => offer.kind === 'team')) return seed;
  }
  throw new Error('No Team Training seed found');
}
function findStickyStackSeed() {
  for (let i = 0; i < 3000; i++) {
    const seed = `sticky-stack-${i}`;
    let game = newRun(seed).state;
    for (let step = 0; step < 12 && game.phase === 'round'; step++) {
      game = dispatch(game, automaticAction(game)).state;
    }
    if (game.phase === 'roundSummary') game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
    if (game.phase !== 'shop' || game.bust) continue;
    const first = game.shop!.offers.find(offer => offer.enhancement === 'sticky');
    if (!first) continue;
    game = dispatch(game, { type: 'BUY', offerId: first.id, dieId: 0 }).state;
    game = dispatch(game, { type: 'REROLL_OFFERS' }).state;
    if (game.shop!.offers.some(offer => offer.enhancement === 'sticky')) return seed;
  }
  throw new Error('No shop seed found for a repeated Sticky purchase');
}
function findCapacitySeed() {
  for (let i = 0; i < 2000; i++) {
    const seed = `capacity-browser-${i}`;
    let game = newRun(seed).state;
    for (let round = 1; round <= 2; round++) {
      for (let step = 0; step < 12 && game.phase === 'round'; step++) {
        game = dispatch(game, automaticAction(game)).state;
      }
      if (game.phase === 'roundSummary') game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
      if (game.phase !== 'shop' || game.bust) break;
      if (round === 1) game = dispatch(game, { type: 'NEXT_ROUND' }).state;
    }
    if (game.phase !== 'shop' || game.bust || game.round !== 2) continue;
    const startingGold = game.gold;
    const initial = [...game.shop!.offers];
    for (const offer of initial) game = dispatch(game, { type: 'BUY', offerId: offer.id, dieId: 0 }).state;
    if (game.shop!.offers.some(offer => !offer.purchased)) continue;
    game = dispatch(game, { type: 'REROLL_OFFERS' }).state;
    const next = game.shop!.offers.find(item => !initial.some(old => old.enhancement === item.enhancement));
    if (next && game.gold >= enhancementCost(next.enhancement)) return { seed, startingGold };
  }
  throw new Error('No deterministic capacity workflow seed found');
}
function findHighInterestSeed() {
  for (let index = 0; index < 500; index++) {
    const seed = `interest-browser-${index}`;
    let game = newRun(seed).state;
    for (let step = 0; step < 250 && game.phase !== 'lost'; step++) {
      if (game.lastRoundPayout && game.lastRoundPayout.interestGold >= 6) return seed;
      if (game.phase === 'round') {
        game = dispatch(game, automaticAction(game)).state;
      } else if (game.phase === 'roundSummary') {
        game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
      } else if (game.phase === 'shop') {
        game = dispatch(game, game.bust ? { type: 'RETRY_ROUND' } : { type: 'NEXT_ROUND' }).state;
      } else if (game.phase === 'flameSelection') {
        game = game.flameSelection!.acquired
          ? dispatch(game, { type: 'CONTINUE_FLAME_SELECTION' }).state
          : dispatch(game, { type: 'CHOOSE_FLAME', offerId: game.flameSelection!.offers[0].id, dieId: 0 }).state;
      }
    }
  }
  throw new Error('No deterministic high-interest browser seed found');
}
function nearStraightRun() {
  for (let i = 0; i < 5000; i++) {
    const game = newRun(`upper-subset-${i}`).state;
    if (game.dice.map(die => die.value).sort().join(',') !== '1,2,4,4,5') continue;
    const matches = game.dice.filter(die => die.value === 4).map(die => die.id);
    const next = dispatch(game, { type: 'PLAY', hand: 'fours', dieIds: [matches[1]] });
    if (next.state.dice[matches[1]].value === 3) return { game, matches, next };
  }
  throw new Error('No near-straight seed found');
}
async function reachShop(page: Page, seed: string) {
  let game = newRun(seed).state;
  await page.goto('/');
  await page.evaluate(key => localStorage.removeItem(key), RUN_STORAGE_KEY);
  await page.goto(`/?seed=${seed}&speed=instant`);
  await matchBoard(page, game);
  while (game.phase === 'round') game = await playBest(page, game);
  if (game.phase === 'roundSummary') {
    await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
    game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
    await matchBoard(page, game);
  }
  expect(game.phase).toBe('shop');
  return game;
}

test('scorecard keeps all fourteen categories visible with simplified actionable states', async ({ page }) => {
  await page.goto('/?seed=persistent-scorecard&speed=instant');
  await ready(page);
  await expect(page.locator('[data-testid^="scorecard-row-"]')).toHaveCount(14);
  for (const hand of HAND_IDS) {
    const row = page.getByTestId(`scorecard-row-${hand}`);
    const stats = handStats(hand, 1);
    await expect(row).toBeVisible();
    await expect(row).toContainText(`Lv. ${stats.level}`);
    await expect(page.getByTestId(`scorecard-stats-${hand}`)).toHaveCount(0);
    await expect(page.getByTestId(`scorecard-score-${hand}`)).toHaveText('—');
  }
  await expect(page.locator('[data-state="playable"]')).not.toHaveCount(0);
  await expect(page.locator('[data-state="unavailable"]')).not.toHaveCount(0);
  await expect(page.getByText('Scorecard', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear selection' })).toHaveCount(0);
  await expect(page.getByTestId('round-score-progress')).toHaveText('0 / 50');
  await expect(page.getByTestId('round-score-progress')).toHaveClass(/round-score-readout/);
  await expect(page.getByTestId('round-goal-progress')).toHaveAttribute('aria-valuetext', '0 of 50 points toward the Goal');
  await expect(page.locator('.hud-phase')).toHaveText('ROUND 1');

  const playable = page.locator('[data-state="playable"]').first();
  const playableTestId = await playable.getAttribute('data-testid');
  const playableRow = page.getByTestId(playableTestId!);
  await playableRow.click();
  await expect(playableRow).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.die[aria-pressed="true"]').count()).toBeGreaterThan(0);
  await playableRow.click();
  await expect(playableRow).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.die[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeDisabled();
  await expect(page.getByTestId('round-score-progress')).toHaveText('0 / 50');
});

test('selected hands expose desktop score-slot and Enter PLAY shortcuts without adding the button to mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?seed=scorecard-quick-play&speed=instant');
  await ready(page);
  const initialPlayable = page.locator('[data-state="playable"]').first();
  const row = page.getByTestId((await initialPlayable.getAttribute('data-testid'))!);
  const shell = row.locator('..');
  await row.click();
  const quickPlay = shell.getByRole('button', { name: /^Play .* for \d+ points$/ });
  await expect(quickPlay).toBeVisible();
  await expect(quickPlay.locator('.quick-score-expression')).toHaveText(/^\d+ × \d+(?:\.\d+)? × \d+(?:\.\d+)? = [\d,]+$/);
  await expect(quickPlay).not.toContainText('PLAY');
  await expect(quickPlay.locator('.quick-submit-icon')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(quickPlay).toBeHidden();
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(quickPlay).toBeVisible();
  await quickPlay.click();
  await ready(page);
  await expect(row).toHaveAttribute('data-state', 'consumed');

  const nextPlayable = page.locator('[data-state="playable"]').first();
  const keyboardRow = page.getByTestId((await nextPlayable.getAttribute('data-testid'))!);
  await keyboardRow.click();
  await keyboardRow.press('Enter');
  await ready(page);
  await expect(keyboardRow).toHaveAttribute('data-state', 'consumed');
});

test('Play action distinguishes possible, definite, and guaranteed final chances', async ({ page }) => {
  const state = newRun('last-play-language').state;
  const options = handOptions(state.dice, []);
  const selected = options[0];
  const unplayable = HAND_IDS.find(hand => !options.some(option => option.id === hand));
  expect(unplayable).toBeDefined();
  state.manualRerollsRemaining = 0;
  state.target = 500;

  await page.goto('/?seed=last-play-language&speed=instant');
  async function load(consumed: typeof HAND_IDS, score: number) {
    state.consumed = [...consumed];
    state.score = score;
    await page.evaluate(([key, stored]) => localStorage.setItem(key, JSON.stringify({ version: 1, state: stored })),
      [RUN_STORAGE_KEY, state] as const);
    await page.reload();
    await ready(page);
    await page.getByTestId(`scorecard-row-${selected.id}`).click();
  }

  await load(HAND_IDS.filter(hand => hand !== selected.id && hand !== unplayable), 0);
  await expect(page.getByRole('button', { name: 'LAST PLAY?', exact: true })).toContainText('• LAST PLAY?');

  const finalConsumed = HAND_IDS.filter(hand => hand !== selected.id);
  await load(finalConsumed, 0);
  await expect(page.getByRole('button', { name: 'LAST PLAY.', exact: true })).toContainText('• LAST PLAY.');

  const preview = handScore(state.dice, selected.id, selected.combinations[0], state.handLevels[selected.id]);
  await load(finalConsumed, state.target - preview.score);
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toContainText('• PLAY');
  await expect(page.getByRole('button', { name: /LAST PLAY/ })).toHaveCount(0);
});

test('compact HUD, Run Info and Help keep secondary information off the gameplay surface', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?seed=ui-overhaul&speed=instant');
  await ready(page);
  for (const stat of ['round', 'gold']) await expect(page.getByTestId(`stat-${stat}`)).toBeVisible();
  for (const stat of ['goal', 'score', 'rerolls']) await expect(page.getByTestId(`stat-${stat}`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
  const menu = await openGameMenu(page);
  await expect(menu.getByLabel('Playback speed')).toBeVisible();
  await expect(menu.getByLabel('Dice display')).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Run Info' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'How to Play' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid^="scorecard-row-"]')).toHaveCount(14);
  await expect(page.getByRole('button', { name: /^Die 5,/ })).toBeVisible();
  const playBox = await page.getByRole('button', { name: 'PLAY', exact: true }).boundingBox();
  expect(playBox && playBox.y + playBox.height).toBeLessThanOrEqual(768);

  await openMenuItem(page, 'Run Info');
  const runInfo = page.getByRole('dialog', { name: 'Run Info' });
  await expect(runInfo).toBeVisible();
  await runInfo.getByRole('tab', { name: 'Debug' }).click();
  await expect(runInfo.getByLabel('Run seed')).toHaveValue('ui-overhaul');
  await expect(runInfo.getByRole('button', { name: 'Restart same seed' })).toBeVisible();
  await page.keyboard.press('Escape');

  await openMenuItem(page, 'How to Play');
  const help = page.getByRole('dialog', { name: 'How to Play' });
  await expect(help).toBeVisible();
  await expect(help).toContainText('Reach the Goal before you run out of playable hands and Rerolls.');
  await expect(help).toContainText('Pips × Mult × XMult = Score');
  await expect(help).not.toContainText('pre-attempt');
  await expect(help).not.toContainText('interpolation');
  await help.getByRole('tab', { name: 'Enhancements' }).click();
  await expect(help.getByText('Jackpot', { exact: true })).toBeVisible();
  await expect(help.getByText('Gain +3 Gold if this face scores in the hand that clears the Round.')).toBeVisible();
  await expect(help.getByText('Multiplier', { exact: true })).toHaveCount(0);
  await expect(help.getByText('Loose Cannon', { exact: true })).toHaveCount(0);
  await expect(help.getByText('Bump', { exact: true }).locator('..')).toContainText('next roll moves up one face');
  await expect(help.getByText('Vintage', { exact: true })).toBeVisible();
  await expect(help.getByText('Golden', { exact: true }).locator('..')).toContainText('Gain +1 Gold');
  await expect(help.getByText('Jackpot', { exact: true }).locator('..')).toContainText('Gain +3 Gold');
});

test('physical dice default to numerals and persist the Pips preference across gameplay, Shop, and Manage Die', async ({ page }) => {
  const game = newRun('pip-browser').state;
  await page.goto('/?seed=pip-browser&speed=instant');
  await matchBoard(page, game);
  await expect(page.locator('.die-number')).toHaveCount(5);
  await expect(page.locator('.pip-face')).toHaveCount(0);
  await setDiceDisplay(page, 'PIPS');
  for (const physical of game.dice) {
    const button = page.getByRole('button', { name: new RegExp(`^Die ${physical.id + 1}, face ${physical.value},`) });
    await expect(button.locator('.pip-face')).toHaveAttribute('aria-label', `Die ${physical.id + 1} showing ${physical.value}`);
    await expect(button.locator('.pip')).toHaveCount(physical.value);
    await expectCenteredPips(button);
  }
  await page.reload();
  await matchBoard(page, game);
  await expect(page.locator('.die-number')).toHaveCount(0);
  await expect(page.locator('.pip-face')).toHaveCount(5);
  const shop = await reachShop(page, findShopSeed());
  await expect(page.locator('.exposed-section .pip-face')).toHaveCount(5);
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  const manager = page.getByRole('dialog', { name: /D1 .* MANAGE DIE/ });
  for (let face = 1; face <= 6; face++) await expect(manager.getByTestId(`manage-face-${face}`).locator('.pip')).toHaveCount(face);
  expect(shop.phase).toBe('shop');
});

test('successful normal encounter shows a reconciled Round Summary before the Shop map', async ({ page }) => {
  const seed = findShopSeed();
  let game = newRun(seed).state;
  await page.goto(`/?seed=${seed}&speed=instant`);
  await matchBoard(page, game);
  while (game.phase === 'round') game = await playBest(page, game);
  expect(game.phase).toBe('roundSummary');
  const summary = game.roundSummary!;
  await expect(page.getByTestId('round-summary')).toBeVisible();
  await expect(page.getByRole('heading', { name: `ROUND ${game.round} CLEARED` })).toBeVisible();
  await expect(page.getByTestId('summary-score')).toHaveText(`${summary.score.toLocaleString()} / ${summary.target.toLocaleString()}`);
  await expect(page.getByTestId('summary-gold-earned')).toHaveText(`+${summary.totalGoldEarned}`);
  await expect(page.getByTestId('summary-gold-breakdown')).toContainText('Base Reward');
  await expect(page.getByTestId('summary-gold-breakdown')).toContainText('Unused Rerolls');
  await expect(page.getByTestId('summary-gold-breakdown')).toContainText('Interest');
  await expect(page.getByTestId('summary-gold-before-after')).toContainText(`${summary.goldBefore} → ${summary.goldAfter}`);
  await expect(page.getByText('Flame Bonus')).toHaveCount(0);
  expect(summary.goldAfter - summary.goldBefore).toBe(summary.totalGoldEarned);

  await setPlaybackSpeed(page, 'NORMAL');
  await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
  await expect(page.getByTestId('run-map-transition')).toHaveAttribute('data-destination', `shop:before-round:${game.round + 1}`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('main').getByText('SHOP', { exact: true })).toBeVisible();
});

test('live scoring panel updates inside the fixed mobile gameplay viewport', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 520 });
  const game = newRun('sticky-panel').state;
  await page.goto('/?seed=sticky-panel&speed=instant');
  await matchBoard(page, game);
  const choice = bestHand(game)!;
  const row = page.getByRole('button', { name: new RegExp(`^${HANDS[choice.hand].name} `) });
  await row.click();
  for (const physical of game.dice) {
    const button = page.getByRole('button', { name: new RegExp(`^Die ${physical.id + 1},`) });
    const selected = await button.getAttribute('aria-pressed') === 'true';
    if (selected !== choice.dieIds.includes(physical.id)) await button.click();
  }
  const panel = page.getByTestId('live-score-panel');
  const scorecard = page.locator('.scorecard-panel');
  const selectedScore = handScore(game.dice, choice.hand, choice.dieIds, game.handLevels[choice.hand]);
  await expect(page.locator('.mobile-score-total')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toHaveText(
    `${selectedScore.pips} × ${selectedScore.multiplier} × 1 = ${selectedScore.score.toLocaleString('en-US')} • PLAY`,
  );
  const before = await scorecard.boundingBox();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const after = await scorecard.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
  const hudBox = await page.locator('.top-hud').boundingBox();
  const panelBox = await panel.boundingBox();
  expect(await panel.evaluate(element => getComputedStyle(element).position)).toBe('relative');
  expect(panelBox!.y).toBeGreaterThanOrEqual(hudBox!.y + hudBox!.height - 1);
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(520);
  expect(panelBox!.height).toBeLessThan(260);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight
    && document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.clock.install({ time: new Date('2026-09-24T12:00:00Z') });
  await setPlaybackSpeed(page, 'NORMAL');
  await page.getByRole('button', { name: /^(PLAY|LAST PLAY[?.])$/ }).click();
  const resolution = dispatch(game, { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds });
  const updateIndex = resolution.events.findIndex(event => event.type === 'HAND_PIPS_CHANGED');
  await page.clock.runFor(CONFIG.tickMs.normal * updateIndex);
  const update = resolution.events[updateIndex];
  await expect(page.getByTestId('hand-pips')).toHaveText(String(update.handScore!.currentPips));
  await expect(page.getByTestId('hand-multiplier')).toHaveText(`×${update.handScore!.currentMultiplier}`);
  await expect(panel).toBeInViewport();
  await expect(page.getByRole('button', { name: /^(PLAY|LAST PLAY[?.])$/ })).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('HUD hearts are interactive only in Shop and the restore modal enforces the three-life maximum', async ({ page }) => {
  await page.goto('/?seed=life-modal&speed=instant');
  await ready(page);
  await expect(page.getByTestId('stat-lives')).toHaveAccessibleName('3 of 3 lives');
  await expect(page.getByTestId('stat-lives')).not.toHaveAttribute('role', 'button');
  const game = await reachShop(page, findShopSeed());
  expect(game.lives).toBe(3);
  await expect(page.getByTestId('stat-lives')).toHaveAccessibleName('3 of 3 lives; restore lives');
  await page.getByTestId('stat-lives').click();
  const modal = page.getByRole('dialog', { name: 'RESTORE LIVES' });
  await expect(modal).toContainText('All lives restored.');
  await expect(modal).toContainText('Next restore: 25 Gold');
  await expect(modal.getByRole('button', { name: 'ALL LIVES RESTORED', exact: true })).toBeDisabled();
});

test('round payout UI displays interest above five', async ({ page }) => {
  const seed = findHighInterestSeed();
  let game = newRun(seed).state;
  await page.goto(`/?seed=${seed}&speed=instant`);
  await matchBoard(page, game);
  for (let step = 0; step < 250 && (game.lastRoundPayout?.interestGold ?? 0) < 6; step++) {
    if (game.phase === 'round') game = await playBest(page, game);
    else if (game.phase === 'roundSummary') {
      await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
      game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
      await matchBoard(page, game);
    }
    else if (game.phase === 'shop') {
      const action = game.bust ? { type: 'RETRY_ROUND' as const } : { type: 'NEXT_ROUND' as const };
      await page.getByRole('button', { name: game.bust ? `RETRY ROUND ${game.round}` : 'NEXT ROUND', exact: true }).click();
      game = dispatch(game, action).state;
      await matchBoard(page, game);
    } else if (game.phase === 'flameSelection') {
      if (game.flameSelection!.acquired) {
        await page.getByRole('button', { name: /CONTINUE TO SHOP/ }).click();
        game = dispatch(game, { type: 'CONTINUE_FLAME_SELECTION' }).state;
      } else {
        const offer = game.flameSelection!.offers[0];
        await page.getByTestId(`flame-offer-${offer.flame}`).getByRole('button', { name: 'Select Flame' }).click();
        await page.getByRole('button', { name: /^Die 1,/ }).click();
        game = dispatch(game, { type: 'CHOOSE_FLAME', offerId: offer.id, dieId: 0 }).state;
      }
      await matchBoard(page, game);
    }
  }
  expect(game.lastRoundPayout?.interestGold).toBeGreaterThanOrEqual(6);
  await expect(page.getByTestId('summary-gold-breakdown')).toContainText('Interest');
  await expect(page.getByTestId('summary-gold-breakdown')).toContainText(`+${game.lastRoundPayout!.interestGold}`);
});

test('Hand Training purchase persists into scorecard and trained scoring playback', async ({ page }) => {
  const fixture = findTrainingSeed();
  let game = await reachShop(page, fixture.seed);
  const hand = fixture.hand;
  const level1 = handStats(hand, 1);
  const level2 = handStats(hand, 2);
  const level3 = handStats(hand, 3);
  await expect(page.locator('[data-testid^="training-offer-"]')).toHaveCount(3);
  await expect(page.getByTestId(`training-pips-${hand}`)).toHaveText(`${level1.basePips} → ${level2.basePips} Pips`);
  await expect(page.getByTestId(`training-mult-${hand}`)).toHaveText(`×${level1.baseMultiplier} → ×${level2.baseMultiplier} Mult`);

  const goldBefore = game.gold;
  await page.getByTestId(`train-${hand}`).click();
  game = dispatch(game, { type: 'TRAIN_HAND', hand }).state;
  await matchBoard(page, game);
  expect(game.gold).toBe(goldBefore - CONFIG.handTrainingCost);
  expect(game.handLevels[hand]).toBe(2);
  await expect(page.getByTestId(`train-${hand}`)).toBeEnabled();
  await expect(page.getByTestId(`training-offer-${hand}`)).toContainText('Trained ×1');
  await expect(page.getByTestId(`train-${hand}`)).toHaveText('TRAIN · 4 GOLD');
  await expect(page.getByTestId(`training-pips-${hand}`)).toHaveText(`${level2.basePips} → ${level3.basePips} Pips`);
  await expect(page.getByTestId(`training-mult-${hand}`)).toHaveText(`×${level2.baseMultiplier} → ×${level3.baseMultiplier} Mult`);

  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await matchBoard(page, game);
  const row = page.getByTestId(`scorecard-row-${hand}`);
  await expect(row).toContainText(`Lv. 2`);
  await expect(page.getByTestId(`scorecard-stats-${hand}`)).toHaveCount(0);

  await page.clock.install({ time: new Date('2026-09-18T12:00:00Z') });
  await setPlaybackSpeed(page, 'NORMAL');
  await row.click();
  const option = handOptions(game.dice, game.consumed).find(item => item.id === hand && !item.consumed)!;
  const scored = handScore(game.dice, hand, option.combinations[0], 2);
  expect(Number.isInteger(scored.rawScore)).toBe(false);
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toHaveText(
    `${scored.pips} × ${scored.multiplier} × 1 = ${scored.score.toLocaleString('en-US')} • PLAY`,
  );
  await page.getByRole('button', { name: /^(PLAY|LAST PLAY[?.])$/ }).click();
  const result = dispatch(game, { type: 'PLAY', hand, dieIds: option.combinations[0] });
  const finalizedIndex = result.events.findIndex(event => event.type === 'HAND_SCORE_FINALIZED');
  for (let index = 0; index <= finalizedIndex; index++) {
    const event = result.events[index];
    await expect(page.getByTestId('round-score-progress')).toHaveText(
      `${event.board.score.toLocaleString('en-US')} / ${event.board.target.toLocaleString('en-US')}`,
    );
    if (event.type === 'HAND_STARTED') {
      await expect(page.locator('.score-tick')).toHaveText(`${HANDS[hand].name} — Lv. 2`);
      await expect(page.getByTestId('hand-pips')).toHaveText(String(level2.basePips));
      await expect(page.getByTestId('hand-multiplier')).toHaveText(`×${level2.baseMultiplier}`);
    }
    if (event.type === 'HAND_SCORE_FINALIZED') {
      await expect(page.getByTestId('hand-pips')).toHaveText(String(scored.pips));
      await expect(page.getByTestId('hand-multiplier')).toHaveText(`×${scored.multiplier}`);
      await expect(page.locator('.score-tick')).toHaveText(`+${scored.score}`);
      await expect(page.locator('.score-tick')).not.toContainText(String(scored.rawScore));
    }
    if (index < finalizedIndex) await page.clock.runFor(CONFIG.tickMs.normal);
  }
  await page.getByRole('button', { name: 'Skip playback' }).click();
  await ready(page);
  game = result.state;
  expect(Number.isInteger(game.score)).toBe(true);
  expect(Object.values(game.scoreByHand).every(Number.isInteger)).toBe(true);
  await expect(page.getByTestId(`scorecard-score-${hand}`)).toHaveText(String(scored.score));
  await expect(page.getByTestId('round-score-progress')).toHaveText(`${scored.score} / ${game.target}`);
});

test('Team Training occupies one existing slot and presents itself as a special all-hands offer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await reachShop(page, findTeamTrainingSeed());
  await expect(page.locator('[data-testid^="training-offer-"]')).toHaveCount(3);
  const team = page.getByTestId('training-offer-team');
  await expect(team).toHaveClass(/team-training-card/);
  await expect(team).toContainText('TEAM TRAINING');
  await expect(team.getByRole('button', { name: 'About Team Training' })).toBeVisible();
  await expect(page.getByTestId('train-team')).toHaveText('TRAIN ALL · 15 GOLD');
  for (const selector of ['.training-grid', '.enhancement-grid']) {
    const columns = await page.locator(selector).evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(3);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const shopLayout = await page.evaluate(() => ({
    trainingHeights: [...document.querySelectorAll<HTMLElement>('.training-grid .training-card')].map(card => card.getBoundingClientRect().height),
    enhancementHeights: [...document.querySelectorAll<HTMLElement>('.enhancement-grid .offer')].map(card => card.getBoundingClientRect().height),
    enhancementNameHeights: [...document.querySelectorAll<HTMLElement>('.enhancement-grid .offer-name')].map(name => name.getBoundingClientRect().height),
    dieHeights: [...document.querySelectorAll<HTMLElement>('.exposed-section .die')].map(die => die.getBoundingClientRect().height),
  }));
  expect(Math.max(...shopLayout.trainingHeights) - Math.min(...shopLayout.trainingHeights)).toBeLessThan(2);
  expect(Math.max(...shopLayout.enhancementHeights) - Math.min(...shopLayout.enhancementHeights)).toBeLessThan(2);
  expect(Math.max(...shopLayout.enhancementNameHeights)).toBeLessThan(40);
  expect(Math.max(...shopLayout.dieHeights)).toBeLessThanOrEqual(76);
  const enhancement = page.locator('.enhancement-grid .offer').first();
  const enhancementName = await enhancement.locator('.mantine-Text-root').first().textContent();
  const info = enhancement.getByRole('button', { name: `About ${enhancementName}` });
  await expect(info.locator('.info-circle-icon')).toBeVisible();
  await info.click();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('.phase-sticky-header')).toBeInViewport();
  await expect(page.locator('.shop-action-dock')).toBeInViewport();
  expect(await page.locator('.phase-sticky-header').evaluate(element => getComputedStyle(element).position)).toBe('sticky');
  expect(await page.locator('.shop-action-dock').evaluate(element => getComputedStyle(element).position)).toBe('sticky');
  await page.screenshot({ path: test.info().outputPath('shop-mobile.png'), fullPage: true });
});

test('full seeded run: select/play, clear, buy onto a face, reroll dice, next round, lose and export', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const seed = findShopSeed('sticky');
  let game = await reachShop(page, seed);
  await page.screenshot({ path: test.info().outputPath('shop-desktop.png'), fullPage: true });
  await expect(page.locator('.offer')).toHaveCount(3);
  const offer = game.shop!.offers.find(item => item.enhancement === 'sticky')!;
  await page.getByTestId('offer-sticky').getByRole('button', { name: 'SELECT OR DRAG' }).click();
  const physicalFace = game.dice[0].value;
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  game = dispatch(game, { type: 'BUY', offerId: offer.id, dieId: 0 }).state;
  await matchBoard(page, game);
  await expect(page.getByTestId('offer-sticky').getByRole('button', { name: 'Purchased' })).toBeDisabled();
  expect(game.dice[0].faces[physicalFace - 1].enhancements.sticky).toBe(1);
  await page.getByRole('button', { name: 'REROLL DICE · 2 GOLD', exact: true }).click();
  game = dispatch(game, { type: 'REROLL_DICE' }).state;
  await matchBoard(page, game);
  await expect(page.getByRole('button', { name: 'REROLL DICE · 4 GOLD', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await matchBoard(page, game);
  for (let step = 0; step < 220 && game.phase !== 'lost'; step++) {
    if (game.phase === 'round') game = await playBest(page, game);
    else if (game.phase === 'roundSummary') {
      await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
      game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
      await matchBoard(page, game);
    }
    else if (game.phase === 'shop') {
      const action = game.bust ? { type: 'RETRY_ROUND' as const } : { type: 'NEXT_ROUND' as const };
      await page.getByRole('button', { name: game.bust ? `RETRY ROUND ${game.round}` : 'NEXT ROUND' }).click();
      game = dispatch(game, action).state;
      await matchBoard(page, game);
    } else if (game.phase === 'flameSelection') {
      if (game.flameSelection!.acquired) {
        await page.getByRole('button', { name: 'CONTINUE TO SHOP', exact: false }).click();
        game = dispatch(game, { type: 'CONTINUE_FLAME_SELECTION' }).state;
      } else {
        const offer = game.flameSelection!.offers[0];
        const dieId = game.dice.find(die => !die.flame)?.id ?? 0;
        await page.getByTestId(`flame-offer-${offer.flame}`).getByRole('button', { name: 'Select Flame' }).click();
        await page.getByRole('button', { name: new RegExp(`^Die ${dieId + 1},`) }).click();
        game = dispatch(game, { type: 'CHOOSE_FLAME', offerId: offer.id, dieId }).state;
      }
      await matchBoard(page, game);
    } else throw new Error(`Unexpected phase: ${game.phase}`);
  }
  expect(game.phase).toBe('lost');
  await expect(page.getByRole('heading', { name: 'Run Over' })).toBeVisible();
  await expect(page.locator('.bust-state').getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Restart same seed', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New seed', exact: true })).toBeVisible();
  await expect(page.getByTestId('bust-shop-banner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^RETRY ROUND / })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('run-over.png'), fullPage: true });
  await openMenuItem(page, 'Run Info');
  const runInfo = page.getByRole('dialog', { name: 'Run Info' });
  await runInfo.getByRole('tab', { name: 'Debug' }).click();
  await runInfo.getByRole('button', { name: 'COPY RUN DATA' }).click();
  const data = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(data.seed).toBe(seed);
  expect(data.loss).not.toBeNull();
  expect(data.purchases[0]).toMatchObject({ dieId: 0, face: physicalFace, enhancement: 'sticky' });
  expect(data.actions).toEqual(game.stats.actions);
  await runInfo.getByRole('tab', { name: /History/ }).click();
  await runInfo.getByRole('button', { name: 'COPY EVENT LOG' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Run Over');
  await runInfo.getByRole('tab', { name: 'Debug' }).click();
  await runInfo.getByRole('button', { name: 'Restart same seed', exact: true }).click();
  await matchBoard(page, newRun(seed).state);
  expect(errors).toEqual([]);
});

test('native drag-and-drop purchase and enhancement refresh', async ({ page }) => {
  let game = await reachShop(page, findShopSeed('slippy'));
  const offer = game.shop!.offers.find(item => item.enhancement === 'slippy')!;
  const target = page.getByRole('button', { name: /^Die 3,/ });
  const source = page.getByTestId('offer-slippy');
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + 10);
  await page.mouse.down();
  // Start the real drag before scrolling the below-the-fold destination into view.
  await page.mouse.move(from.x + 30, from.y + 30, { steps: 5 });
  await target.scrollIntoViewIfNeeded();
  const to = (await target.boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.move(to.x + to.width / 2 + 1, to.y + to.height / 2 + 1);
  await page.mouse.up();
  game = dispatch(game, { type: 'BUY', offerId: offer.id, dieId: 2 }).state;
  await matchBoard(page, game);
  await expect(page.getByTestId('offer-slippy').getByRole('button', { name: 'Purchased' })).toBeDisabled();
  // Restart an independently reproducible shop with its complete reward to refresh offers.
  game = await reachShop(page, findShopSeed());
  await page.getByRole('button', { name: 'REROLL OFFERS · 3 GOLD', exact: true }).click();
  game = dispatch(game, { type: 'REROLL_OFFERS' }).state;
  await matchBoard(page, game);
  await expect(page.locator('.offer')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'REROLL OFFERS · 6 GOLD', exact: true })).toBeVisible();
  for (const item of game.shop!.offers) await expect(page.getByTestId(`offer-${item.enhancement}`).getByText(ENHANCEMENTS[item.enhancement].name, { exact: true })).toBeVisible();
});

test('Vintage offer and Manage Die expose its authoritative dynamic sell value', async ({ page }) => {
  let game = await reachShop(page, findShopSeed('vintage'));
  const offer = game.shop!.offers.find(item => item.enhancement === 'vintage')!;
  const card = page.getByTestId('offer-vintage');
  await expect(card).toContainText('3 GOLD');
  await card.getByRole('button', { name: 'About Vintage' }).click();
  await expect(page.getByRole('tooltip')).toContainText(ENHANCEMENTS.vintage.description);
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'SELECT OR DRAG' }).click();
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  game = dispatch(game, { type: 'BUY', offerId: offer.id, dieId: 0 }).state;
  await matchBoard(page, game);
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  const manager = page.getByRole('dialog', { name: 'D1 — MANAGE DIE' });
  const face = activeFace(game.dice[0]).rank;
  await expect(manager.getByTestId(`manage-face-${face}`)).toContainText('Vintage');
  await expect(manager.getByTestId(`manage-face-${face}`)).toContainText('Sell 0 Gold');
  await expect(manager.getByRole('button', { name: `Sell Vintage from D1 face ${face} for 0 Gold`, exact: true })).toBeVisible();
});

test('stackable enhancement purchases show a single readable count badge', async ({ page }) => {
  let game = await reachShop(page, findStickyStackSeed());
  await setDiceDisplay(page, 'PIPS');
  const startingGold = game.gold;
  const first = game.shop!.offers.find(offer => offer.enhancement === 'sticky')!;
  await page.getByTestId('offer-sticky').getByRole('button', { name: 'SELECT OR DRAG' }).click();
  const physical = page.getByRole('button', { name: /^Die 1,/ });
  await physical.click();
  game = dispatch(game, { type: 'BUY', offerId: first.id, dieId: 0 }).state;
  await matchBoard(page, game);

  await page.getByRole('button', { name: 'REROLL OFFERS · 3 GOLD', exact: true }).click();
  game = dispatch(game, { type: 'REROLL_OFFERS' }).state;
  await matchBoard(page, game);
  const second = game.shop!.offers.find(offer => offer.enhancement === 'sticky')!;
  await page.getByTestId('offer-sticky').getByRole('button', { name: 'SELECT OR DRAG' }).click();
  await physical.click();
  game = dispatch(game, { type: 'BUY', offerId: second.id, dieId: 0 }).state;
  await matchBoard(page, game);

  await expect(physical).toContainText('Sticky ×2');
  await expectCenteredPips(physical);
  expect(game.dice[0].faces[game.dice[0].value - 1].enhancements.sticky).toBe(2);
  expect(game.gold).toBe(startingGold - 7); // two 2-Gold Sticky stacks and one 3-Gold offer reroll
  const face = game.dice[0].value;
  await expect(page.getByText('Manage faces', { exact: true })).toHaveCount(0);
  await physical.click();
  const manager = page.getByRole('dialog', { name: 'D1 — MANAGE DIE' });
  await expect(manager).toBeVisible();
  await expect(manager.locator('[data-testid^="manage-face-"]')).toHaveCount(6);
  await expect(manager.getByTestId(`manage-face-${face}`)).toContainText('1 / 3 ENHANCEMENTS');
  await manager.getByRole('button', { name: `Sell Sticky from D1 face ${face} for 2 Gold`, exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'SELL STICKY?' });
  await expect(confirmation).toContainText('+2 GOLD');
  await confirmation.getByRole('button', { name: 'SELL', exact: true }).click();
  game = dispatch(game, { type: 'SELL_ENHANCEMENT', dieId: 0, face, enhancement: 'sticky' }).state;
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  await matchBoard(page, game);
  await expect(physical).not.toContainText('Sticky');
  expect(game.gold).toBe(startingGold - 5);
});

test('a fourth enhancement type opens Manage Die and preserves the offer through sell and apply', async ({ page }) => {
  const fixture = findCapacitySeed();
  let game = await reachShop(page, fixture.seed);
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await matchBoard(page, game);
  while (game.phase === 'round') game = await playBest(page, game);
  if (game.phase === 'roundSummary') {
    await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
    game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
    await matchBoard(page, game);
  }
  expect(game.round).toBe(2);
  const initial = [...game.shop!.offers];
  for (const offer of initial) {
    await page.getByTestId(`offer-${offer.enhancement}`).getByRole('button', { name: 'SELECT OR DRAG' }).click();
    await page.getByRole('button', { name: /^Die 1,/ }).click();
    game = dispatch(game, { type: 'BUY', offerId: offer.id, dieId: 0 }).state;
    await matchBoard(page, game);
  }
  const face = game.dice[0].value;
  await expect(page.getByRole('button', { name: /^Die 1,/ })).toContainText('3 / 3');
  await page.getByRole('button', { name: 'REROLL OFFERS · 3 GOLD', exact: true }).click();
  game = dispatch(game, { type: 'REROLL_OFFERS' }).state;
  await matchBoard(page, game);
  const pending = game.shop!.offers.find(item => !initial.some(old => old.enhancement === item.enhancement))!;
  await page.getByTestId(`offer-${pending.enhancement}`).getByRole('button', { name: 'SELECT OR DRAG' }).click();
  const target = page.getByRole('button', { name: /^Die 1,/ });
  await expect(target).toHaveAttribute('aria-disabled', 'false');
  await expect(target).toHaveAttribute('title', /This Face is full/);
  await target.click();
  const manager = page.getByRole('dialog', { name: 'D1 — MANAGE DIE' });
  await expect(manager).toContainText('Sell an Enhancement to make room.');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(manager.getByTestId('manage-face-6')).toBeVisible();
  const removed = initial[0].enhancement;
  const proceeds = ENHANCEMENTS[removed].baseSellPrice;
  await manager.getByRole('button', { name: `Sell ${ENHANCEMENTS[removed].name} from D1 face ${face} for ${proceeds} Gold`, exact: true }).click();
  await page.getByRole('dialog', { name: `SELL ${ENHANCEMENTS[removed].name.toUpperCase()}?` })
    .getByRole('button', { name: 'SELL', exact: true }).click();
  game = dispatch(game, { type: 'SELL_ENHANCEMENT', dieId: 0, face, enhancement: removed }).state;
  const apply = manager.getByRole('button', { name: `Apply ${ENHANCEMENTS[pending.enhancement].name}`, exact: true });
  await expect(apply).toBeEnabled();
  await expect(page.getByText(`${ENHANCEMENTS[pending.enhancement].name} selected`, { exact: true })).toBeVisible();
  await apply.click();
  game = dispatch(game, { type: 'BUY', offerId: pending.id, dieId: 0 }).state;
  await matchBoard(page, game);
  expect(game.dice[0].faces[face - 1].enhancements[removed]).toBeUndefined();
  expect(game.dice[0].faces[face - 1].enhancements[pending.enhancement]).toBe(1);
  const spent = initial.reduce((total, item) => total + enhancementCost(item.enhancement), 0) + 3 + enhancementCost(pending.enhancement);
  expect(game.gold).toBe(fixture.startingGold - spent + proceeds);
});

test('ambiguous physical dice can be changed and filtering never ends the run', async ({ page }) => {
  let seed = '';
  let game: GameState | undefined;
  for (let i = 0; i < 3000; i++) {
    const candidate = newRun(`subset-${i}`).state;
    if (handOptions(candidate.dice, []).find(option => option.id === 'threeKind')?.combinations.length === 4) { seed = candidate.seed; game = candidate; break; }
  }
  expect(game).toBeDefined();
  await page.goto(`/?seed=${seed}&speed=instant`);
  await ready(page);
  await page.screenshot({ path: test.info().outputPath('round-desktop.png'), fullPage: true });
  const option = handOptions(game!.dice, []).find(item => item.id === 'threeKind')!;
  await page.getByRole('button', { name: /^Three of a Kind / }).click();
  const removed = option.combinations[0][0];
  const replacement = option.combinations[3].find(id => !option.combinations[0].includes(id))!;
  await page.getByRole('button', { name: new RegExp(`^Die ${removed + 1},`) }).click();
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: new RegExp(`^Die ${replacement + 1},`) }).click();
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeEnabled();
  const dieIds = option.combinations[0].filter(id => id !== removed).concat(replacement);
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  game = dispatch(game!, { type: 'PLAY', hand: 'threeKind', dieIds }).state;
  await matchBoard(page, game);
  if (game.phase === 'round') {
    for (const die of game.dice) await page.getByRole('button', { name: new RegExp(`^Die ${die.id + 1},`) }).click();
    await expect(page.getByRole('heading', { name: 'Run Over' })).toHaveCount(0);
    for (const die of game.dice) {
      const button = page.getByRole('button', { name: new RegExp(`^Die ${die.id + 1},`) });
      if (await button.getAttribute('aria-pressed') === 'true') await button.click();
    }
  }
});

for (const direction of ['hand-first', 'dice-first'] as const) {
  test(`upper subset ${direction}: reroll one duplicate and preserve the straight structure`, async ({ page }) => {
    const { game, matches: [preserved, played], next } = nearStraightRun();
    await page.goto(`/?seed=${game.seed}&speed=instant`);
    await matchBoard(page, game);
    const fours = page.getByRole('button', { name: /^Fours / });
    const preservedDie = page.getByRole('button', { name: new RegExp(`^Die ${preserved + 1},`) });
    const playedDie = page.getByRole('button', { name: new RegExp(`^Die ${played + 1},`) });
    if (direction === 'hand-first') {
      await fours.click();
      await expect(preservedDie).toHaveAttribute('aria-pressed', 'true');
      await expect(playedDie).toHaveAttribute('aria-pressed', 'true');
      await preservedDie.click();
    } else {
      await playedDie.click();
      await expect(fours).toBeEnabled();
    }
    await expect(preservedDie).toHaveAttribute('aria-pressed', 'false');
    await expect(playedDie).toHaveAttribute('aria-pressed', 'true');
    await expect(fours).toHaveAttribute('aria-pressed', 'true');
    await expect(fours).toHaveAccessibleName(/^Fours · Lv\. 1 · 7 Pips · ×1 Mult /);
    await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toHaveText('11 × 1 × 1 = 11 • PLAY');
    await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeEnabled();
    await matchBoard(page, game); // Selection alone never scores or rolls.
    await page.getByRole('button', { name: 'PLAY', exact: true }).click();
    await matchBoard(page, next.state);
    expect(next.state.score).toBe(11);
    expect(next.state.dice[preserved].value).toBe(4);
    expect(next.state.dice[played].value).toBe(3);
    expect(next.events.filter(event => event.type === 'DIE_ROLLED').map(event => event.dieIds)).toEqual([[played]]);
    await expect(fours).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Small Straight / })).toBeEnabled();
    // Even under a one-die selection filter, the consumed category remains visible.
    await preservedDie.click();
    await expect(fours).toBeVisible();
    await expect(fours).toBeDisabled();
    await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeDisabled();
  });
}

test('fast event playback and skipping produce the same outcome as instant playback', async ({ page }) => {
  const game = newRun('playback').state;
  await page.goto('/?seed=playback&speed=fast');
  await page.getByTestId('run-map-transition').getByRole('button', { name: 'Continue', exact: true }).click();
  await matchBoard(page, game);
  const choice = bestHand(game);
  await page.getByRole('button', { name: new RegExp(`^${HANDS[choice.hand].name} `) }).click();
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Skip playback' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip playback' }).click();
  await matchBoard(page, dispatch(game, { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }).state);
});

test('a seedless first visit generates a random seed and then resumes it', async ({ page }) => {
  await page.goto('/?speed=instant');
  await ready(page);
  const firstSeed = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state.seed as string, RUN_STORAGE_KEY);
  expect(firstSeed).toMatch(/^roll-[a-z0-9]+-[a-z0-9]+$/);
  expect(firstSeed).not.toBe('roll-call');

  await page.reload();
  await ready(page);
  const resumedSeed = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state.seed as string, RUN_STORAGE_KEY);
  expect(resumedSeed).toBe(firstSeed);
});

test('settled progress resumes across reloads and return visits with seed-aware precedence', async ({ page }) => {
  const seed = 'resume-browser';
  let game = newRun(seed).state;
  await page.goto(`/?seed=${seed}&speed=fast`);
  await ready(page);
  const choice = bestHand(game);
  await page.getByRole('button', { name: new RegExp(`^${HANDS[choice.hand].name} `) }).click();
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  game = dispatch(game, { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }).state;
  await expect(page.getByRole('button', { name: 'Skip playback' })).toBeVisible();
  await expect(page.getByTestId('round-score-progress')).toHaveText(`0 / ${game.target}`);

  await page.reload();
  await page.locator('main').waitFor();
  await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0);
  await expect(page.getByTestId('run-map-transition')).toHaveCount(0);
  await matchBoard(page, game);

  await page.goto('about:blank');
  await page.goto('/?speed=instant');
  await matchBoard(page, game);

  await page.goto(`/?seed=${seed}&speed=instant`);
  await matchBoard(page, game);

  const different = newRun('different-browser-run').state;
  await page.goto('/?seed=different-browser-run&speed=instant');
  await expect(page.getByTestId('run-map-transition')).toBeVisible();
  await page.reload();
  await page.locator('main').waitFor();
  await expect(page.getByTestId('run-map-transition')).toHaveCount(0);
  await matchBoard(page, different);

  await openMenuItem(page, 'Run Info');
  let runInfo = page.getByRole('dialog', { name: 'Run Info' });
  await runInfo.getByRole('tab', { name: 'Debug' }).click();
  await runInfo.getByRole('button', { name: 'New seed', exact: true }).click();
  const generatedSeed = new URL(page.url()).searchParams.get('seed');
  expect(generatedSeed).toMatch(/^roll-/);
  await expect(page.getByTestId('run-map-transition')).toBeVisible();
  await page.reload();
  await matchBoard(page, newRun(generatedSeed!).state);

  const generated = newRun(generatedSeed!).state;
  const generatedChoice = bestHand(generated);
  await page.getByRole('button', { name: new RegExp(`^${HANDS[generatedChoice.hand].name} `) }).click();
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await matchBoard(page, dispatch(generated, { type: 'PLAY', hand: generatedChoice.hand, dieIds: generatedChoice.dieIds }).state);
  await openMenuItem(page, 'Run Info');
  runInfo = page.getByRole('dialog', { name: 'Run Info' });
  await runInfo.getByRole('tab', { name: 'Debug' }).click();
  await runInfo.getByRole('button', { name: 'Restart same seed', exact: true }).click();
  await page.reload();
  await matchBoard(page, generated);
});

test('purchased Jumping Bean visibly triggers and rerolls on the next initial gameplay roll', async ({ page }) => {
  test.slow();
  let seed: string | null = null;
  for (let i = 0; i < 1500 && !seed; i++) {
    let candidate = newRun(`chain-${i}`).state;
    for (let step = 0; step < 12 && candidate.phase === 'round'; step++) {
      const choice = bestHand(candidate);
      candidate = dispatch(candidate, choice ? { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }
        : { type: 'MANUAL_REROLL', dieIds: [0] }).state;
    }
    if (candidate.phase === 'roundSummary') candidate = dispatch(candidate, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
    if (candidate.phase !== 'shop' || candidate.bust) continue;
    const offer = candidate.shop!.offers.find(item => item.enhancement === 'jumpingBean');
    if (!offer) continue;
    candidate = dispatch(candidate, { type: 'BUY', offerId: offer.id, dieId: 0 }).state;
    const next = dispatch(candidate, { type: 'NEXT_ROUND' });
    if (next.events.some(event => event.enhancement === 'jumpingBean')) seed = candidate.seed;
  }
  expect(seed).not.toBeNull();
  let game = await reachShop(page, seed!);
  const offer = game.shop!.offers.find(item => item.enhancement === 'jumpingBean')!;
  await page.getByTestId('offer-jumpingBean').getByRole('button', { name: 'SELECT OR DRAG' }).click();
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  game = dispatch(game, { type: 'BUY', offerId: offer.id, dieId: 0 }).state;
  await matchBoard(page, game);
  const next = dispatch(game, { type: 'NEXT_ROUND' });
  await page.clock.install({ time: new Date('2026-09-18T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-18T12:00:01Z'));
  await setPlaybackSpeed(page, 'NORMAL');
  await page.getByRole('button', { name: 'NEXT ROUND' }).click();
  // Observe the transient ability tick deterministically instead of hoping the
  // real-time assertion polling catches its 350 ms display window.
  const beanIndex = next.events.findIndex(event => event.type === 'JUMPING_BEAN_FREE_PLAY');
  expect(beanIndex).toBeGreaterThanOrEqual(0);
  for (let index = 0; index <= beanIndex; index++) {
    if (next.events[index].type === 'MAP_TRANSITION') {
      await expect(page.getByTestId('run-map-transition')).toBeVisible();
      await page.getByTestId('run-map-transition').getByRole('button', { name: 'Continue', exact: true }).click();
      await page.clock.runFor(281);
      await expect(page.getByTestId('run-map-transition')).toHaveCount(0);
    } else {
      const event = next.events[index];
      await expect(page.getByTestId('round-score-progress')).toHaveText(
        `${event.board.score.toLocaleString('en-US')} / ${event.board.target.toLocaleString('en-US')}`,
      );
      if (index < beanIndex) await page.clock.runFor(CONFIG.tickMs.normal);
    }
  }
  const freePlay = next.events[beanIndex];
  await expect(page.locator('.resolution .score-tick')).toHaveText(`JUMPING BEAN · FREE ${HANDS[freePlay.hand!].name.toUpperCase()}`);
  await expect(page.locator('.ability-label').first()).toHaveText('JUMPING BEAN');
  await page.getByRole('button', { name: 'Skip playback' }).click();
  await matchBoard(page, next.state);
  await expect(page.getByTestId('scorecard-effect-score')).toHaveCount(0);
  await expect(page.getByTestId(`scorecard-score-${freePlay.hand}`)).toHaveText(String(next.state.scoreByHand[freePlay.hand!]));
  await expect(page.getByTestId(`scorecard-row-${freePlay.hand}`)).not.toHaveAttribute('data-state', 'consumed');
  await expect(page.getByTestId('round-score-progress')).toHaveText(`${next.state.score} / ${next.state.target}`);
  expect(next.state.stats.scoreBySource.jumpingBean).toBeGreaterThan(0);
  expect(next.state.effectScore).toBe(0);
  expect(next.events.filter(event => event.type === 'DIE_ROLLED' && event.dieIds?.includes(0)).length).toBeGreaterThan(1);
});

test('active mobile gameplay stays inside the viewport with a two-column scorecard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?speed=instant');
  await ready(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 667 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    const measurements = await page.evaluate(() => {
      const upper = document.querySelector<HTMLElement>('#scorecard-upper')!.closest<HTMLElement>('.scorecard-section')!.getBoundingClientRect();
      const lower = document.querySelector<HTMLElement>('#scorecard-lower')!.closest<HTMLElement>('.scorecard-section')!.getBoundingClientRect();
      const rows = [...document.querySelectorAll<HTMLElement>('[data-testid^="scorecard-row-"]')].map(row => row.getBoundingClientRect());
      const dock = document.querySelector<HTMLElement>('.gameplay-dock')!.getBoundingClientRect();
      const reroll = document.querySelector<HTMLElement>('.reroll-action')!.getBoundingClientRect();
      const play = document.querySelector<HTMLElement>('.play-action')!.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        upper: { x: upper.x, width: upper.width },
        lower: { x: lower.x, width: lower.width },
        rowsInside: rows.every(row => row.left >= 0 && row.right <= window.innerWidth && row.top >= 0 && row.bottom <= window.innerHeight),
        dockBottom: dock.bottom,
        actions: { rerollX: reroll.x, rerollWidth: reroll.width, playX: play.x, playWidth: play.width },
      };
    });
    expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.innerWidth);
    expect(measurements.scrollHeight).toBeLessThanOrEqual(measurements.innerHeight);
    expect(measurements.lower.x).toBeGreaterThan(measurements.upper.x + measurements.upper.width - 1);
    expect(Math.abs(measurements.upper.width - measurements.lower.width)).toBeLessThan(1);
    expect(measurements.rowsInside).toBe(true);
    expect(measurements.dockBottom).toBeLessThanOrEqual(measurements.innerHeight);
    expect(measurements.actions.rerollX).toBeLessThan(measurements.actions.playX);
    expect(measurements.actions.playWidth / measurements.actions.rerollWidth).toBeGreaterThan(1.9);
    await expect(page.locator('.selection-preview')).toBeHidden();
    await expect(page.locator('[data-testid^="scorecard-row-"]')).toHaveCount(14);
    await expect(page.getByRole('button', { name: /^Die 5,/ })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeInViewport();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath('round-narrow.png'), fullPage: true });
});
