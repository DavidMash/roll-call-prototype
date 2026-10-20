import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { newRun, dispatch } from '../src/game/engine';
import { activeFace } from '../src/game/dice';
import { handOptions, handStats, HANDS, HAND_IDS, LOWER_HAND_IDS, relativeHandStrengthTiers, UPPER_HAND_IDS } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import { CONFIG } from '../src/game/config';
import type { Action, GameState, SpecialDieType } from '../src/game/types';
import { activeEncounterDice, unavailableEncounterHands } from '../src/game/bosses';
import { RUN_STORAGE_KEY, RUN_STORAGE_VERSION } from '../src/game/persistence';
import { enterRun, goToShopStage, installRunState, openGameMenu, openMenuItem, setDiceDisplay, setPlaybackSpeed } from './uiHelpers';
import { specialOfferName } from '../src/game/specialOffers';
import { chapterLabel } from '../src/game/chapters';
import { createDieEffect, effectOf, resetDieRoundState, runtimeFor } from '../src/game/specialDice';
import { rosterDice, syncActiveDiceProjection } from '../src/game/inventory';

function dieUiLabel(dice: GameState['dice'], die: GameState['dice'][number]): string {
  if (die.owner === 'boss') return 'Cursed Die';
  return `Die ${dice.filter(item => item.owner === 'player').findIndex(item => item.id === die.id) + 1}`;
}

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
    .sort((a, b) => (callerHand ? Number(b.hand === callerHand) - Number(a.hand === callerHand) : 0)
      || (b.score > a.score ? 1 : b.score < a.score ? -1 : 0))[0];
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
function unlockShopExit(game: GameState): GameState {
  let next = game.shop?.exitUnlocked === false ? dispatch(game, { type: 'UNLOCK_SHOP_EXIT' }).state : game;
  if (next.shop?.stage === 'shop') next = dispatch(next, { type: 'SET_SHOP_STAGE', stage: 'train' }).state;
  if (next.shop?.stage === 'train' && next.flameSlots.some(Boolean))
    next = dispatch(next, { type: 'SET_SHOP_STAGE', stage: 'flames' }).state;
  return next;
}
async function ready(page: Page) {
  await page.locator('main').waitFor();
  await enterRun(page);
  for (let barrier = 0; barrier < 2; barrier++) {
    await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0);
    const map = page.getByTestId('run-map-transition');
    if (await map.count()) {
      await page.getByTestId('run-action-row').getByRole('button', { name: 'Continue', exact: true }).evaluate(element => (element as HTMLElement).click());
      await expect(map).toHaveCount(0);
      continue;
    }
    const bustContinue = page.getByTestId('run-action-row').getByRole('button', { name: 'Continue', exact: true });
    if (await bustContinue.count()) { await bustContinue.click(); continue; }
    break;
  }
}
async function matchBoard(page: Page, game: GameState) {
  await ready(page);
  await expect(page.getByTestId('stat-round')).toContainText(chapterLabel(game.round));
  await expect(page.getByTestId('stat-gold').getByText(String(game.gold), { exact: true })).toBeVisible();
  for (const stat of ['goal', 'score', 'rerolls']) await expect(page.getByTestId(`stat-${stat}`)).toHaveCount(0);
  if (game.phase === 'roundSummary') {
    await expect(page.getByTestId('round-summary')).toBeVisible();
    return;
  }
  if (game.phase === 'specialOffer') {
    await expect(page.getByRole('main').getByText('SPECIAL OFFER', { exact: true })).toBeVisible();
    return;
  }
  if (game.phase === 'shop' || game.phase === 'flameSelection') {
    if (game.phase === 'shop' && game.bust) await expect(page.getByTestId('bust-shop-banner')).toBeVisible();
    else if (game.phase === 'shop') await expect(page.getByTestId('shop-stage-shop')).toBeVisible();
    else await expect(page.getByRole('main').getByText('FLAME SELECTION', { exact: true })).toBeVisible();
    await expect(page.getByTestId('manual-reroll')).toHaveCount(0);
  } else if (game.phase === 'round') {
    await expect(page.getByTestId('round-score-progress')).toHaveText(
      `${game.score.toLocaleString('en-US')} / ${game.target.toLocaleString('en-US')}`,
    );
    await expect(page.getByTestId('round-goal-progress')).toHaveAttribute('aria-valuetext',
      `${game.score.toLocaleString('en-US')} of ${game.target.toLocaleString('en-US')} points toward the Goal`,
    );
  }
  if (game.phase === 'shop' && game.shop?.stage === 'shop') {
    for (const [index, dieId] of game.diceInventory.roster.entries()) {
      const slot = page.getByTestId(`collection-slot-roster-${index}`);
      if (dieId === null) await expect(slot.getByRole('button', { name: /empty/ })).toBeVisible();
      else await expect(slot).toHaveAttribute('data-die-id', String(dieId));
    }
    return;
  }
  const visibleDice = game.bustPresentationDice ?? (game.phase === 'round' ? activeEncounterDice(game) : game.dice);
  for (const die of visibleDice) await expect(page.getByRole('button', { name: new RegExp(`^${dieUiLabel(visibleDice, die)}, face ${activeFace(die).rank},`) })).toBeVisible();
}
async function progressSpecialOffer(page: Page, game: GameState): Promise<GameState> {
  if (game.specialOffer!.acquired) {
    const next = dispatch(game, { type: 'CONTINUE_SPECIAL_OFFER' }).state;
    await matchBoard(page, next);
    return next;
  }
  const offer = game.specialOffer!.offers.find(item => item.type !== 'timeTravel') ?? game.specialOffer!.offers[0];
  await page.getByRole('heading', { name: specialOfferName(offer), exact: true }).locator('..').getByRole('button', { name: 'CHOOSE' }).click();
  const next = dispatch(game, { type: 'CHOOSE_SPECIAL_OFFER', offerId: offer.id }).state;
  await matchBoard(page, next);
  return next;
}
async function playBest(page: Page, game: GameState): Promise<GameState> {
  if (game.boss?.type === 'warden' && game.boss.pendingReinforcements > 0) {
    const activeDieIds = game.boss.activeDieIds;
    const die = game.dice.find(item => item.owner === 'player' && !activeDieIds.includes(item.id))!;
    await page.getByRole('button', { name: new RegExp(`^${dieUiLabel(game.dice, die)},.*selectable to unlock$`) }).click();
    await page.getByRole('button', { name: 'UNLOCK DIE', exact: true }).click();
    const next = dispatch(game, { type: 'UNLOCK_WARDEN_DIE', dieId: die.id }).state;
    await matchBoard(page, next);
    return next;
  }
  const choice = bestHand(game);
  if (game.boss?.type === 'caller' && !game.boss.satisfied && choice?.hand !== game.boss.calledHand && game.manualRerollsRemaining > 0) {
    const die = activeEncounterDice(game)[0];
    await page.getByRole('button', { name: new RegExp(`^${dieUiLabel(game.dice, die)},`) }).click();
    await page.getByTestId('manual-reroll').click();
    const next = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [die.id] }).state;
    await matchBoard(page, next);
    return next;
  }
  if (!choice) {
    const die = activeEncounterDice(game)[0];
    await page.getByRole('button', { name: new RegExp(`^${dieUiLabel(game.dice, die)},`) }).click();
    await page.getByTestId('manual-reroll').click();
    const next = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [die.id] }).state;
    await matchBoard(page, next);
    return next;
  }
  const handRow = page.getByRole('button', { name: new RegExp(`^${HANDS[choice.hand].name} `) });
  await handRow.click();
  for (const die of activeEncounterDice(game)) {
    const target = page.getByRole('button', { name: new RegExp(`^${dieUiLabel(game.dice, die)},`) });
    const selected = await target.getAttribute('aria-pressed') === 'true';
    if (selected !== choice.dieIds.includes(die.id)) await target.click();
  }
  if (await handRow.getAttribute('aria-pressed') !== 'true') await handRow.click();
  await page.getByRole('button', { name: /^(PLAY|LAST PLAY[?.])$/ }).click();
  const next = dispatch(game, { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }).state;
  await matchBoard(page, next);
  return next;
}
function findShopSeed(required?: SpecialDieType) {
  for (let i = 0; i < 1000; i++) {
    const seed = `browser-${i}`;
    let game = newRun(seed).state;
    for (let step = 0; step < 12 && game.phase === 'round'; step++) {
      game = dispatch(game, automaticAction(game)).state;
    }
    if (game.phase === 'roundSummary') game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
    if (game.phase === 'shop' && !game.bust && (!required || game.shop!.offers.some(offer => offer.dieType === required))) return seed;
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
    game = dispatch(game, { type: 'SET_SHOP_STAGE', stage: 'train' }).state;
    const next = dispatch(unlockShopExit(game), { type: 'NEXT_ROUND' }).state;
    for (const option of handOptions(next.dice, next.consumed).filter(item => !item.consumed)) {
      const scored = handScore(next.dice, option.id, option.combinations[0], 2);
      if (!Number.isInteger(scored.rawScore) && scored.score < next.target) return { seed, hand: option.id };
    }
  }
  throw new Error('No suitable Hand Training seed found');
}
function highInterestState() {
  for (let index = 0; index < 500; index++) {
    const seed = `interest-browser-${index}`;
    let game = newRun(seed).state;
    for (let step = 0; step < 250 && game.phase !== 'lost'; step++) {
      if (game.lastRoundPayout && game.lastRoundPayout.interestGold >= 6) return game;
      if (game.phase === 'round') {
        game = dispatch(game, automaticAction(game)).state;
      } else if (game.phase === 'roundSummary') {
        game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
      } else if (game.phase === 'shop') {
        game = dispatch(game, game.shop?.stage === 'shop' ? { type: 'SET_SHOP_STAGE', stage: 'train' }
          : game.shop?.stage === 'train' && game.flameSlots.some(Boolean) ? { type: 'SET_SHOP_STAGE', stage: 'flames' }
            : game.shop?.exitUnlocked === false ? { type: 'UNLOCK_SHOP_EXIT' }
              : game.bust ? { type: 'RETRY_ROUND' }
                : game.shop?.kind === 'post_boss' ? { type: 'NEXT_CHAPTER' } : { type: 'NEXT_ROUND' }).state;
      } else if (game.phase === 'flameSelection') {
        game = game.flameSelection!.acquired
          ? dispatch(game, { type: 'CONTINUE_FLAME_SELECTION' }).state
          : dispatch(game, { type: 'CHOOSE_FLAME', offerId: game.flameSelection!.offers[0].id,
              ...(game.flameSlots.every(slot => slot !== null) ? { replaceSlot: 0 as const } : {}) }).state;
      } else if (game.phase === 'specialOffer') {
        const offer = game.specialOffer!.offers.find(item => item.type !== 'timeTravel') ?? game.specialOffer!.offers[0];
        game = dispatch(game, game.specialOffer!.acquired
          ? { type: 'CONTINUE_SPECIAL_OFFER' }
          : { type: 'CHOOSE_SPECIAL_OFFER', offerId: offer.id }).state;
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
  for (let step = 0; step < 50 && game.phase === 'round'; step++) game = dispatch(game, automaticAction(game)).state;
  if (game.phase === 'roundSummary') game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
  expect(game.phase).toBe('shop');
  await installRunState(page, game);
  await matchBoard(page, game);
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
    await expect(page.getByTestId(`scorecard-stats-${hand}`)).toHaveText(`Lv. ${stats.level} · ${stats.basePips} × ${stats.baseMultiplier}`);
    const section = UPPER_HAND_IDS.includes(hand) ? UPPER_HAND_IDS : LOWER_HAND_IDS;
    const expectedTier = relativeHandStrengthTiers(Object.fromEntries(HAND_IDS.map(id => [id, 1])) as GameState['handLevels'], section)[hand];
    await expect(row).toHaveAttribute('data-strength-tier', expectedTier!);
    await expect(page.getByTestId(`scorecard-score-${hand}`)).toHaveText('—');
  }
  await expect(page.locator('[data-state="playable"]')).not.toHaveCount(0);
  await expect(page.locator('[data-state="unavailable"]')).not.toHaveCount(0);
  await expect(page.locator('[data-state="unavailable"][data-strength-tier]')).not.toHaveCount(0);
  await expect(page.getByText('Scorecard', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear selection' })).toHaveCount(0);
  await expect(page.getByTestId('round-score-progress')).toHaveText('0 / 100');
  await expect(page.getByTestId('round-score-progress')).toHaveClass(/round-score-readout/);
  await expect(page.getByTestId('round-goal-progress')).toHaveAttribute('aria-valuetext', '0 of 100 points toward the Goal');
  await expect(page.getByLabel('Overkill: +1 Temper per 20% above target · max +5')).toBeVisible();
  await expect(page.locator('.hud-phase')).toHaveCount(0);

  const playable = page.locator('[data-state="playable"]').first();
  const playableTestId = await playable.getAttribute('data-testid');
  const playableRow = page.getByTestId(playableTestId!);
  await playableRow.click();
  await expect(playableRow).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.die[aria-pressed="true"]').count()).toBeGreaterThan(0);
  for (let click = 0; click < 32 && await playableRow.getAttribute('aria-pressed') === 'true'; click++) {
    await playableRow.click();
  }
  await expect(playableRow).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.die[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeDisabled();
  await expect(page.getByTestId('round-score-progress')).toHaveText('0 / 100');
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
  state.target = 500n;

  await page.goto('/?seed=last-play-language&speed=instant');
  async function load(consumed: typeof HAND_IDS, score: bigint) {
    state.consumed = [...consumed];
    state.score = score;
    await page.evaluate(([key, version, stored]) => localStorage.setItem(key, JSON.stringify({ version, state: stored }, (_key, value) => typeof value === 'bigint' ? value.toString() : value)),
      [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, state] as const);
    await page.reload();
    await ready(page);
    await page.getByTestId(`scorecard-row-${selected.id}`).click();
  }

  await load(HAND_IDS.filter(hand => hand !== selected.id && hand !== unplayable), 0n);
  await expect(page.getByRole('button', { name: 'LAST PLAY?', exact: true })).toContainText('• LAST PLAY?');

  const finalConsumed = HAND_IDS.filter(hand => hand !== selected.id);
  await load(finalConsumed, 0n);
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
  await expect(help).toContainText('Reach the Round Target before you run out of playable Hands and Manual Rerolls.');
  await expect(help).toContainText('Pips × Mult × XMult = Score');
  await expect(help).not.toContainText('pre-attempt');
  await expect(help).not.toContainText('interpolation');
  await help.getByRole('tab', { name: 'Dice' }).click();
  await expect(help.getByTestId('help-die-jackpot')).toContainText('you earn 3 Gold');
  await expect(help.getByTestId('help-die-golden')).toContainText('up to 3 Gold each Round');
  await expect(help.getByTestId('help-die-magic')).toContainText('Legendary');
  await help.getByTestId('help-die-bonus').getByRole('button', { name: 'Explain Pips' }).click();
  const pipsDefinition = page.getByRole('dialog', { name: 'Pips definition' });
  await expect(pipsDefinition).toContainText('points added to a Hand');
  await pipsDefinition.getByRole('button', { name: 'Explain Hand' }).click();
  const handDefinition = page.getByRole('dialog', { name: 'Hand definition' });
  await expect(handDefinition).toContainText('scoring pattern');
  await handDefinition.getByRole('button', { name: 'Back to previous definition' }).click();
  await expect(page.getByRole('dialog', { name: 'Pips definition' })).toBeVisible();
  await page.getByRole('button', { name: 'Close definition' }).click();
  const scoreTerm = help.getByTestId('help-die-bonus').getByRole('button', { name: 'Explain Scores' });
  await scoreTerm.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Score definition' })).toBeVisible();
  await page.getByRole('button', { name: 'Close definition' }).click();
  await help.getByRole('tab', { name: 'Flames' }).click();
  await help.getByTestId('help-flame-fluxCapacitor').getByRole('button', { name: 'Explain Magnetic' }).click();
  await expect(page.getByRole('dialog', { name: 'Magnetic definition' }))
    .toContainText('next other die to be Rolled while this power is available');
  await page.getByRole('button', { name: 'Close definition' }).click();
  await expect(help.getByText('Boomerang', { exact: true })).toHaveCount(0);
  await expect(help.getByText('Personal Trainer', { exact: true })).toHaveCount(0);
});

test('header omits redundant phase labels and always reserves the menu on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const base = newRun('menu-safe-header').state;
  base.round = 599_994;
  base.gold = 987_654_321;
  const fixtures: GameState[] = [
    structuredClone(base),
    Object.assign(structuredClone(base), {
      phase: 'shop' as const,
      shop: { kind: 'between_rounds' as const, offers: [], offerRerolls: 0, lifeRestores: 0 },
    }),
    Object.assign(structuredClone(base), {
      phase: 'flameSelection' as const,
      flameSelection: { offers: [{ id: 1, flame: 'ultimate' as const }], acquired: false },
    }),
    Object.assign(structuredClone(base), {
      phase: 'specialOffer' as const,
      specialOffer: { offers: [{ id: 1, type: 'carePackage' as const }], acquired: false },
    }),
  ];

  for (const state of fixtures) {
    await installRunState(page, state);
    await ready(page);
    await expect(page.locator('.hud-phase')).toHaveCount(0);
    const menu = page.getByRole('button', { name: 'Open menu', exact: true });
    await expect(menu).toBeInViewport();
    const geometry = await page.locator('.top-hud').evaluate(header => {
      const hud = header.getBoundingClientRect();
      const trigger = header.querySelector<HTMLElement>('.menu-trigger')!.getBoundingClientRect();
      return { hudLeft: hud.left, hudRight: hud.right, menuLeft: trigger.left, menuRight: trigger.right,
        documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
    });
    expect(geometry.menuLeft).toBeGreaterThanOrEqual(geometry.hudLeft);
    expect(geometry.menuRight).toBeLessThanOrEqual(geometry.hudRight);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    await menu.click();
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

test('physical dice default to numerals and persist the Pips preference across gameplay, Shop, and face details', async ({ page }) => {
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
  await expect(page.getByTestId('shop-roster-dock').locator('.pip-face')).toHaveCount(5);
  await page.getByTestId('collection-slot-roster-0').getByRole('button', { name: 'INFO' }).click();
  await expect(page.getByRole('dialog', { name: 'DIE DETAILS' })).toBeVisible();
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
  const shopMap = page.getByTestId('run-map-transition');
  await expect(shopMap).toHaveAttribute('data-destination', `shop:before-round:${game.round + 1}`);
  await expect(shopMap.locator('[aria-current="step"] .node-label')).toHaveText('SHOP');
  await expect(shopMap.locator('[aria-current="step"]')).not.toContainText('Prepare for');
  await expect(shopMap.locator('[aria-current="step"]')).not.toContainText('Goal');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await ready(page);
  await expect(page.getByTestId('shop-stage-shop')).toBeVisible();
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
  await expect(page.getByTestId('hand-multiplier')).toHaveText(String(update.handScore!.currentMultiplier));
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
  const game = highInterestState();
  await installRunState(page, game);
  await matchBoard(page, game);
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
  await goToShopStage(page, 'training');
  game = dispatch(game, { type: 'SET_SHOP_STAGE', stage: 'train' }).state;
  await expect(page.locator('[data-testid^="training-offer-"]')).toHaveCount(14);
  await expect(page.getByTestId(`training-stats-${hand}`)).toHaveText(`Lv. 1 · ${level1.basePips} × ${level1.baseMultiplier}`);

  const goldBefore = game.gold;
  await page.getByTestId(`train-${hand}`).click();
  game = dispatch(game, { type: 'TRAIN_HAND', hand }).state;
  await matchBoard(page, game);
  expect(game.gold).toBe(goldBefore - 2);
  expect(game.handLevels[hand]).toBe(2);
  await expect(page.getByTestId(`train-${hand}`)).toBeEnabled();
  await expect(page.getByTestId(`training-offer-${hand}`)).toContainText('TRAINED ×1');
  await expect(page.getByTestId(`train-${hand}`)).toHaveText('4G');
  await expect(page.getByTestId(`train-${hand}`)).toHaveAccessibleName(`Train ${HANDS[hand].name} for 4 GOLD`);
  await expect(page.getByTestId(`training-stats-${hand}`)).toHaveText(`Lv. 2 · ${level2.basePips} × ${level2.baseMultiplier}`);

  await goToShopStage(page, 'flames');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = unlockShopExit(game);
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await matchBoard(page, game);
  const row = page.getByTestId(`scorecard-row-${hand}`);
  await expect(row).toContainText(`Lv. 2`);
  await expect(page.getByTestId(`scorecard-stats-${hand}`)).toHaveText(
    `Lv. 2 · ${level2.basePips} × ${level2.baseMultiplier}`,
  );
  const section = UPPER_HAND_IDS.includes(hand) ? UPPER_HAND_IDS : LOWER_HAND_IDS;
  const expectedTier = relativeHandStrengthTiers(game.handLevels, section)[hand];
  await expect(row).toHaveAttribute('data-strength-tier', expectedTier!);

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
      await expect(page.locator('.score-tick')).toHaveText(`${HANDS[hand].name.toUpperCase()} · LV. 2 · BASE`);
      await expect(page.getByTestId('hand-pips')).toHaveText(String(level2.basePips));
      await expect(page.getByTestId('hand-multiplier')).toHaveText(String(level2.baseMultiplier));
    }
    if (event.type === 'HAND_SCORE_FINALIZED') {
      await expect(page.getByTestId('hand-pips')).toHaveText(String(scored.pips));
      await expect(page.getByTestId('hand-multiplier')).toHaveText(String(scored.multiplier));
      await expect(page.locator('.score-tick')).toHaveText(`+${scored.score}`);
      await expect(page.locator('.score-tick')).not.toContainText(String(scored.rawScore));
    }
    if (index < finalizedIndex) await page.clock.runFor(CONFIG.tickMs.normal);
  }
  await page.getByRole('button', { name: 'Skip playback' }).click();
  await page.clock.runFor(500);
  await ready(page);
  game = result.state;
  expect(typeof game.score).toBe('bigint');
  expect(Object.values(game.scoreByHand).every(score => typeof score === 'bigint')).toBe(true);
  await expect(page.getByTestId(`scorecard-score-${hand}`)).toHaveText(String(scored.score));
  await expect(page.getByTestId('round-score-progress')).toHaveText(`${scored.score} / ${game.target}`);
});

test('Training uses a compact fourteen-hand scorecard on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await reachShop(page, findShopSeed());
  await goToShopStage(page, 'training');
  await expect(page.locator('[data-testid^="training-offer-"]')).toHaveCount(14);
  await expect(page.getByTestId('training-scorecard')).toBeVisible();
  await expect(page.getByTestId('training-offer-team')).toHaveCount(0);
  await expect(page.getByText('Baseline · Lv. 1')).toHaveCount(2);
  await expect(page.locator('.dice-offer-grid .dice-offer')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('.training-scorecard .scorecard-grid')
    .evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
  expect(await page.getByTestId('training-scorecard').evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(460);
  await expect(page.locator('.roster-grid .collection-slot')).toHaveCount(0);
  await expect(page.locator('.storage-grid .collection-slot')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('.phase-sticky-header')).toBeInViewport();
  await expect(page.locator('.shop-action-dock')).toBeInViewport();
  expect(await page.locator('.phase-sticky-header').evaluate(element => getComputedStyle(element).position)).toBe('sticky');
  await expect(page.getByTestId('run-action-row').locator('.shop-action-dock')).toHaveCount(1);
  expect(await page.locator('.shop-action-dock').evaluate(element => getComputedStyle(element).position)).toBe('static');
  await page.screenshot({ path: test.info().outputPath('shop-mobile.png'), fullPage: true });
});

test('glossary drill-down stays tappable, dismissible, and inside a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?seed=mobile-glossary&speed=instant');
  await ready(page);
  await openMenuItem(page, 'How to Play');
  const help = page.getByRole('dialog', { name: 'How to Play' });
  await help.getByRole('tab', { name: 'Dice' }).click();
  const bonus = help.getByTestId('help-die-bonus');
  await bonus.scrollIntoViewIfNeeded();
  await bonus.getByRole('button', { name: 'Explain Pips' }).click();
  let definition = page.getByRole('dialog', { name: 'Pips definition' });
  const box = await definition.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await definition.getByRole('button', { name: 'Explain Hand' }).click();
  definition = page.getByRole('dialog', { name: 'Hand definition' });
  await expect(definition.getByRole('button', { name: 'Back to previous definition' })).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: test.info().outputPath('mobile-nested-glossary.png'), fullPage: true });
  await definition.getByRole('button', { name: 'Close definition' }).click();
  await expect(page.getByRole('dialog', { name: 'Hand definition' })).toHaveCount(0);
});

test('Round Dice leave Normal dice unlabeled and identify special dice without D6', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const game = newRun('round-die-labels').state;
  game.diceInventory.instances[1].effects = [createDieEffect(1, 'golden')];
  syncActiveDiceProjection(game);
  game.dieRoundState = resetDieRoundState(rosterDice(game));
  await installRunState(page, game);
  await enterRun(page);

  const normal = page.getByTestId('flame-die-0');
  const golden = page.getByTestId('flame-die-1');
  await expect(normal.locator('.die-face-details')).toHaveCount(0);
  await expect(normal.locator('.die-details-placeholder')).toHaveCount(1);
  await expect(golden.locator('.die-face-details')).toHaveText('Golden · I');
  await expect(page.getByRole('main')).not.toContainText('Golden D6');
  await expect(page.getByTestId('special-dice-controls')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('round-dice-labels-mobile.png'), fullPage: true });
  await golden.locator('.die-face-details').click();
  const details = page.getByRole('dialog', { name: 'GOLDEN · I' });
  await expect(details).toContainText('Each time this die Scores, you earn 1 Gold');
  await expect(details).toContainText(/Gold earned this Round\s*0 \/ 3/);
  await expect(details).not.toContainText('D6');
  await expect(details).not.toContainText('PHYSICAL FACES');
  await expect(details.locator('.manage-face-tile')).toHaveCount(0);
});

test('five special dice do not add a persistent Round panel or change scorecard height', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const normal = newRun('round-five-normal-layout').state;
  await installRunState(page, normal);
  await enterRun(page);
  const normalHeight = await page.locator('.scorecard-panel').evaluate(element => element.getBoundingClientRect().height);
  await page.screenshot({ path: test.info().outputPath('round-zero-special-dice-mobile.png'), fullPage: true });

  const mixed = newRun('round-three-special-layout').state;
  const mixedTypes: SpecialDieType[] = ['doubleTime', 'workout', 'bonus'];
  rosterDice(mixed).slice(0, 3).forEach((die, index) => { die.effects = [createDieEffect(die.id, mixedTypes[index])]; });
  syncActiveDiceProjection(mixed);
  mixed.dieRoundState = resetDieRoundState(rosterDice(mixed));
  await installRunState(page, mixed);
  await page.reload();
  await enterRun(page);
  const mixedHeight = await page.locator('.scorecard-panel').evaluate(element => element.getBoundingClientRect().height);
  expect(Math.abs(mixedHeight - normalHeight)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: test.info().outputPath('round-three-special-dice-mobile.png'), fullPage: true });

  const special = newRun('round-five-special-layout').state;
  const types: SpecialDieType[] = ['doubleTime', 'workout', 'bonus', 'magnetic', 'magic'];
  rosterDice(special).forEach((die, index) => { die.effects = [createDieEffect(die.id, types[index])]; });
  syncActiveDiceProjection(special);
  special.dieRoundState = resetDieRoundState(rosterDice(special));
  await installRunState(page, special);
  await page.reload();
  await enterRun(page);

  await expect(page.getByText('SPECIAL DICE', { exact: true })).toHaveCount(0);
  await expect(page.locator('.die-face-details.special')).toHaveText(['Double Time · I', 'Workout · I', 'Bonus · I', 'Magnetic · I', 'Magic · I']);
  const specialHeight = await page.locator('.scorecard-panel').evaluate(element => element.getBoundingClientRect().height);
  expect(Math.abs(specialHeight - normalHeight)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: test.info().outputPath('round-five-special-dice-mobile.png'), fullPage: true });
});

test('whole-die details show live status and only contextual boss face mutations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const game = newRun('round-die-mutation-details').state;
  const dice = rosterDice(game);
  dice[0].effects = [createDieEffect(dice[0].id, 'workout')];
  dice[1].effects = [createDieEffect(dice[1].id, 'bonus')];
  activeFace(dice[0]).bossMutation = { kind: 'infected' };
  const originalRank = 4 as const;
  activeFace(dice[1]).bossMutation = { kind: 'snakeEyes', originalRank };
  activeFace(dice[1]).rank = 1;
  syncActiveDiceProjection(game);
  game.dieRoundState = resetDieRoundState(rosterDice(game));
  runtimeFor(dice[0], game.dieRoundState[dice[0].id], 'workout')!.temporaryPips = 6;
  await installRunState(page, game);
  await enterRun(page);

  const workout = page.getByTestId(`flame-die-${dice[0].id}`);
  await expect(workout).toHaveClass(/effect-suppressed/);
  await expect(workout.getByRole('button', { name: /View details for Workout/ })).toContainText('Workout');
  await workout.getByRole('button', { name: /View details for Workout/ }).click();
  let details = page.getByRole('dialog', { name: 'WORKOUT · I' });
  await expect(details).toContainText(/Current bonus this Round\s*\+6 Pips/);
  await expect(details).toContainText('INFECTED FACE');
  await expect(details).toContainText("This die's effects are suppressed");
  await expect(details).not.toContainText('physical face');
  await page.screenshot({ path: test.info().outputPath('workout-infected-details-mobile.png'), fullPage: true });
  await details.getByRole('button', { name: 'Close' }).click();

  await page.getByTestId(`flame-die-${dice[1].id}`).getByRole('button', { name: 'View details for Bonus' }).click();
  details = page.getByRole('dialog', { name: 'BONUS · I' });
  await expect(details).toContainText('SNAKE EYES');
  await expect(details).toContainText(`changed from ${originalRank} to 1`);
  await expect(details).not.toContainText('INFECTED FACE');
  await details.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByTestId(`flame-die-${dice[2].id}`).locator('.die-face-details')).toHaveCount(0);
});

test('mobile staged Shop keeps each section, navigation, and the compact Roster usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const game = await reachShop(page, findShopSeed());
  game.round = 2;
  game.gold = 100;
  await page.evaluate(([key, version, state]) => localStorage.setItem(key, JSON.stringify({ version, state }, (_key, value) => typeof value === 'bigint' ? value.toString() : value)),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, game] as const);
  await page.reload();
  await enterRun(page);
  await expect(page.locator('.shop-screen')).toBeVisible();

  const stage = page.getByTestId('stat-round');
  await expect(stage).toHaveText('C1 R2');
  await expect(stage.locator('.hud-stage-letter')).toHaveText(['C', 'R']);
  await expect(stage.locator('.hud-stat-icon')).toHaveCount(0);
  await expect(stage.locator('.hud-stat-label')).toHaveCount(0);
  const stageColors = await stage.evaluate(element => ({
    letters: [...element.querySelectorAll<HTMLElement>('.hud-stage-letter')].map(letter => getComputedStyle(letter).color),
    value: getComputedStyle(element.querySelector<HTMLElement>('.hud-stage-segment')!).color,
  }));
  expect(new Set(stageColors.letters).size).toBe(1);
  expect(stageColors.letters[0]).not.toBe(stageColors.value);

  const header = page.locator('.phase-sticky-header');
  const boss = page.getByTestId('boss-preview');
  await expect(header).toContainText('SHOP');
  await expect(header).toContainText('Prepare for');
  await expect(boss).toBeVisible();
  await expect(page.getByTestId('shop-stage-indicator')).toBeVisible();
  await expect(page.getByTestId('training-shop')).toHaveCount(0);
  await expect(page.getByTestId('fire-keeping-shop')).toHaveCount(0);
  await expect(page.getByTestId('shop-stage-continue')).toBeInViewport();
  await expect(page.getByTestId('shop-stage-continue')).toContainText('CONTINUE TO TRAINING');
  await expect(page.getByRole('button', { name: /REROLL ALL DICE/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /REROLL OFFERS/ })).toBeVisible();
  await expect(page.getByTestId('dice-dock')).toHaveCount(0);
  await expect(page.getByTestId('shop-roster-dock')).toBeInViewport();
  await expect(page.getByTestId('shop-dice-controls')).toHaveCount(0);
  await expect(page.getByTestId('shop-roster-dock').locator('.collection-slot')).toHaveCount(5);

  await expect(page.getByTestId('dice-shop')).toBeVisible();
  await expect(page.locator('.dice-offer')).toHaveCount(3);
  const offerTops = await page.locator('.dice-offer').evaluateAll(cards => cards.map(card => Math.round(card.getBoundingClientRect().top)));
  expect(new Set(offerTops).size).toBe(1);
  await expect(page.locator('.dice-offer .collectible-die-visual')).toHaveCount(3);
  await expect(page.locator('.dice-offer').first()).not.toContainText('D6');
  await page.locator('.dice-offer .dice-offer-info').first().click();
  const offerDetails = page.getByRole('dialog', { name: 'DIE DETAILS' });
  await expect(offerDetails).toBeVisible();
  await offerDetails.getByRole('button', { name: 'CLOSE' }).click();
  await expect(offerDetails).toBeHidden();
  await expect(page.locator('.roster-grid .collection-slot')).toHaveCount(5);
  await expect(page.locator('.storage-grid .collection-slot')).toHaveCount(5);
  expect(await page.getByTestId('storage-strip').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(5);
  await page.screenshot({ path: test.info().outputPath('dice-shop-mobile.png'), fullPage: true });
  const purchasedOffer = game.shop!.offers[0];
  await page.getByTestId(`dice-offer-${purchasedOffer.id}`).getByRole('button', { name: /BUY/ }).click();
  await expect(page.getByTestId(`dice-offer-${purchasedOffer.id}`)).toContainText('PURCHASED');
  await expect(page.getByTestId('shop-stage-gold')).toContainText(`${100 - purchasedOffer.price!} GOLD`);
  await goToShopStage(page, 'training');
  await expect(page.getByTestId('training-shop')).toBeInViewport();
  await expect(page.getByTestId('dice-shop')).toHaveCount(0);
  await expect(page.getByTestId('shop-stage-gold')).toContainText(`${100 - purchasedOffer.price!} GOLD`);
  await goToShopStage(page, 'dice');
  await expect(page.getByTestId(`dice-offer-${purchasedOffer.id}`)).toContainText('PURCHASED');
  await expect(page.getByTestId('shop-stage-flames')).toHaveCount(0);
  await goToShopStage(page, 'training');
  await expect(page.getByRole('button', { name: 'NEXT ROUND', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('shop-shell-mobile.png'), fullPage: true });

  await goToShopStage(page, 'dice');
  await page.getByTestId('collection-slot-roster-0').getByRole('button', { name: 'INFO' }).click();
  await expect(page.getByRole('dialog', { name: 'DIE DETAILS' })).toContainText('Normal');
  await expect(page.getByRole('dialog', { name: 'DIE DETAILS' })).not.toContainText('D6');
});

test('full seeded run: select/play, clear, buy a collectible die, next round, lose and export', async ({ page, context }) => {
  // Bad Dream can intentionally replay the second half of a Chapter before this full-run fixture loses.
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const seed = findShopSeed('bonus');
  let game = await reachShop(page, seed);
  if (game.shop?.exitUnlocked === false) game = dispatch(game, { type: 'UNLOCK_SHOP_EXIT' }).state;
  await page.screenshot({ path: test.info().outputPath('shop-desktop.png'), fullPage: true });
  await expect(page.locator('.dice-offer')).toHaveCount(3);
  const offer = game.shop!.offers.find(item => item.dieType === 'bonus')!;
  if (game.gold < offer.price!) {
    game.gold = offer.price!;
    await installRunState(page, game);
    await enterRun(page);
  }
  await page.getByTestId(`dice-offer-${offer.id}`).getByRole('button', { name: /BUY/ }).click();
  game = dispatch(game, { type: 'BUY_DIE', offerId: offer.id }).state;
  await expect(page.getByTestId('stat-gold').getByText(String(game.gold), { exact: true })).toBeVisible();
  await expect(page.getByTestId(`dice-offer-${offer.id}`).getByRole('button', { name: 'PURCHASED' })).toBeDisabled();
  const purchasedId = game.diceInventory.storage.find(id => id !== null)!;
  expect(game.diceInventory.instances[purchasedId]).toMatchObject({ effects: [{ type: 'bonus', level: 1 }] });
  await expect(page.getByRole('button', { name: /REROLL ALL DICE/ })).toHaveCount(0);
  await goToShopStage(page, 'flames');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = unlockShopExit(game);
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
      await goToShopStage(page, 'flames');
      game = unlockShopExit(game);
      const action = game.bust ? { type: 'RETRY_ROUND' as const }
        : game.shop?.kind === 'post_boss' ? { type: 'NEXT_CHAPTER' as const } : { type: 'NEXT_ROUND' as const };
      const progression = page.getByRole('button', { name: game.bust ? `RETRY ROUND ${game.round}`
        : game.shop?.kind === 'post_boss' ? 'NEXT CHAPTER' : 'NEXT ROUND' });
      await expect(progression).toBeEnabled();
      await progression.evaluate((element: HTMLButtonElement) => element.click());
      game = dispatch(game, action).state;
      await matchBoard(page, game);
    } else if (game.phase === 'flameSelection') {
      if (game.flameSelection!.acquired) {
        game = dispatch(game, { type: 'CONTINUE_FLAME_SELECTION' }).state;
      } else {
        const offer = game.flameSelection!.offers[0];
        const full = game.flameSlots.every(slot => slot !== null);
        await page.getByTestId(`flame-offer-${offer.flame}`).getByRole('button', {
          name: full ? 'SELECT TO REPLACE' : 'SELECT FLAME',
        }).click();
        if (full) {
          await page.getByTestId('flame-replacement-picker').getByRole('button').first().click();
          await page.getByRole('dialog').getByRole('button', { name: 'REPLACE' }).click();
        }
        game = dispatch(game, {
          type: 'CHOOSE_FLAME',
          offerId: offer.id,
          ...(full ? { replaceSlot: 0 as const } : {}),
        }).state;
      }
      await matchBoard(page, game);
    } else if (game.phase === 'specialOffer') {
      game = await progressSpecialOffer(page, game);
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
  expect(data.exportType).toBe('roll_call_run_history_v2');
  expect(data.identity.seed).toBe(seed);
  expect(data.summary.canonical.outcome).toBe('lost');
  expect(data.events).toContainEqual(expect.objectContaining({ kind: 'shop_transaction', transaction: expect.objectContaining({
    type: 'dice_purchased', dieId: purchasedId, dieType: 'bonus',
  }) }));
  expect(data.events.some((event: { kind: string }) => event.kind === 'hand_scored')).toBe(true);
  await runInfo.getByRole('tab', { name: /History/ }).click();
  await runInfo.getByRole('button', { name: 'COPY RUN HISTORY' }).click();
  const historyExport = await page.evaluate(() => navigator.clipboard.readText());
  expect(historyExport).toContain('ROLL CALL · RUN HISTORY V2');
  expect(historyExport).toContain('Outcome: lost');
  expect(historyExport).toContain('CHRONOLOGICAL HISTORY');
  await runInfo.getByRole('tab', { name: 'Debug' }).click();
  await runInfo.getByRole('button', { name: 'COPY DEBUG TRACE' }).click();
  const debugData = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(debugData.exportType).toBe('roll_call_debug_trace');
  const withoutTimerUnlocks = (actions: Action[]) => actions.filter(action => action.type !== 'UNLOCK_SHOP_EXIT');
  expect(withoutTimerUnlocks(debugData.actionJournal)).toEqual(withoutTimerUnlocks(game.actionJournal));
  expect(debugData.actionJournal.filter((action: Action) => action.type === 'UNLOCK_SHOP_EXIT')).toHaveLength(
    game.actionJournal.filter(action => action.type === 'UNLOCK_SHOP_EXIT').length,
  );
  expect(debugData.trace).not.toHaveProperty('board');
  await runInfo.getByRole('button', { name: 'Restart same seed', exact: true }).click();
  await matchBoard(page, newRun(seed).state);
  expect(errors).toEqual([]);
});

test('native drag-and-drop moves collection dice and Dice-offer rerolls stay authoritative', async ({ page }) => {
  let game = await reachShop(page, findShopSeed('bonus'));
  const source = page.getByTestId('collection-slot-roster-0');
  const target = page.getByTestId('collection-slot-storage-0');
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + 10);
  await page.mouse.down();
  // Start the real drag before scrolling the below-the-fold destination into view.
  await page.mouse.move(from.x + 30, from.y + 30, { steps: 5 });
  await expect(source).toHaveAttribute('data-dragging', 'true');
  await target.scrollIntoViewIfNeeded();
  const to = (await target.boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.move(to.x + to.width / 2 + 1, to.y + to.height / 2 + 1);
  await expect(target).toHaveAttribute('data-drop-target', 'true');
  await page.screenshot({ path: test.info().outputPath('collection-drag-target.png'), fullPage: true });
  await page.mouse.up();
  game = dispatch(game, { type: 'MOVE_DIE', source: { area: 'roster', index: 0 }, destination: { area: 'storage', index: 0 },
    expectedSourceDieId: 0, expectedDestinationDieId: null }).state;
  await expect(page.getByTestId('collection-slot-roster-0').getByRole('button', { name: /Roster 1, empty/ })).toBeVisible();
  await expect(page.getByTestId('collection-slot-storage-0')).toHaveAttribute('data-die-id', '0');
  const oldOfferIds = game.shop!.offers.map(offer => offer.id);
  await page.getByRole('button', { name: 'REROLL OFFERS · 3 GOLD', exact: true }).click();
  game = dispatch(game, { type: 'REROLL_OFFERS' }).state;
  await expect(page.getByTestId('stat-gold').getByText(String(game.gold), { exact: true })).toBeVisible();
  await expect(page.locator('.dice-offer')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'REROLL OFFERS · 6 GOLD', exact: true })).toBeVisible();
  expect(game.shop!.offers.map(offer => offer.id)).not.toEqual(oldOfferIds);
});

test('Vintage collectible details expose its authoritative appreciation and sell value', async ({ page }) => {
  let game = await reachShop(page, findShopSeed('vintage'));
  game.gold = 100;
  await installRunState(page, game);
  await matchBoard(page, game);
  const offer = game.shop!.offers.find(item => item.dieType === 'vintage')!;
  const card = page.getByTestId(`dice-offer-${offer.id}`);
  await expect(card).toContainText('10 GOLD');
  await card.getByRole('button', { name: /BUY/ }).click();
  game = dispatch(game, { type: 'BUY_DIE', offerId: offer.id }).state;
  const vintageId = game.diceInventory.storage[0]!;
  effectOf(game.diceInventory.instances[vintageId], 'vintage')!.persistent.vintageAppreciation = 7;
  await installRunState(page, game);
  await matchBoard(page, game);
  const slot = page.getByTestId('collection-slot-storage-0');
  await expect(slot).toContainText('Sell 12G');
  await slot.getByRole('button', { name: 'INFO' }).click();
  const details = page.getByRole('dialog', { name: 'DIE DETAILS' });
  await expect(details).toContainText(/Appreciation:\s*\+7 Gold/);
  await expect(details).toContainText('Current sell value: 12 Gold');
});

test('mobile Dice offers keep long names and Legendary rarity inside the card', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const game = await reachShop(page, findShopSeed('conjoined'));
  const offer = game.shop!.offers.find(item => item.dieType === 'conjoined')!;
  const card = page.getByTestId(`dice-offer-${offer.id}`);
  await expect(card.getByText('Conjoined', { exact: true })).toBeVisible();
  await expect(card).toContainText('Legendary');
  await expect(card).toContainText('40 GOLD');
  expect(await card.evaluate(element => {
    const cardRect = element.getBoundingClientRect();
    const identity = element.querySelector('.dice-offer-name')!.getBoundingClientRect();
    return document.documentElement.scrollWidth <= innerWidth
      && identity.left >= cardRect.left - 1 && identity.right <= cardRect.right + 1;
  })).toBe(true);
});

test('same-type collection interaction always swaps without implicit Fusion', async ({ page }) => {
  const game = await reachShop(page, findShopSeed());
  game.diceInventory.instances[0].effects = [createDieEffect(0, 'bonus', 2)];
  game.diceInventory.instances[1].effects = [createDieEffect(1, 'bonus', 1)];
  await installRunState(page, game);
  await enterRun(page);
  await expect(page.getByTestId('stat-gold').getByText(String(game.gold), { exact: true })).toBeVisible();

  const first = page.getByTestId('collection-slot-roster-0');
  const second = page.getByTestId('collection-slot-roster-1');
  await first.locator('.collection-slot-main').click();
  await second.locator('.collection-slot-main').click();
  await expect(page.getByRole('dialog', { name: /FUSE/i })).toHaveCount(0);
  await expect(first).toHaveAttribute('data-die-id', '1');
  await expect(second).toHaveAttribute('data-die-id', '0');
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
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^Three of a Kind / }).click();
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeEnabled();
  const dieIds = option.combinations[0].filter(id => id !== removed).concat(replacement);
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  game = dispatch(game!, { type: 'PLAY', hand: 'threeKind', dieIds }).state;
  await matchBoard(page, game);
  if (game.phase === 'round') {
    for (const die of game.dice) await page.getByRole('button', { name: new RegExp(`^${dieUiLabel(game.dice, die)},`) }).click();
    await expect(page.getByRole('heading', { name: 'Run Over' })).toHaveCount(0);
    for (const die of game.dice) {
      const button = page.getByRole('button', { name: new RegExp(`^${dieUiLabel(game.dice, die)},`) });
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
    expect(next.state.score).toBe(BigInt(11n));
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
  await enterRun(page);
  await page.getByTestId('run-action-row').getByRole('button', { name: 'Continue', exact: true }).click();
  await matchBoard(page, game);
  const choice = bestHand(game);
  const expected = dispatch(game, { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds });
  await page.getByRole('button', { name: new RegExp(`^${HANDS[choice.hand].name} `) }).click();
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Skip playback' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip playback' }).click();
  const finalized = expected.events.find(event => event.type === 'HAND_SCORE_FINALIZED')!;
  await expect(page.getByTestId('hand-final-score')).toContainText(String(finalized.amount));
  await matchBoard(page, expected.state);
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
  await enterRun(page);
  await expect(page.getByTestId('stat-round')).toContainText('C1 R1');
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
  await expect(page.getByTestId('stat-round')).toContainText('C1 R1');
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

test('Jumping Bean runs its Free Play and explicit reroll only when invoked On Command', async ({ page }) => {
  const game = newRun('jumping-bean-command-browser').state;
  rosterDice(game)[0].effects = [createDieEffect(rosterDice(game)[0].id, 'jumpingBean')];
  syncActiveDiceProjection(game);
  game.dieRoundState = resetDieRoundState(rosterDice(game));
  await installRunState(page, game);
  await matchBoard(page, game);
  const next = dispatch(game, { type: 'INVOKE_JUMPING_BEAN', dieId: 0 });
  const bean = page.getByTestId('flame-die-0');
  await bean.getByRole('button', { name: 'View details for Jumping Bean' }).click();
  const details = page.getByRole('dialog', { name: 'JUMPING BEAN · I' });
  await expect(details).toContainText(/Uses Remaining\s*1 \/ 1/);
  await details.getByRole('button', { name: 'USE JUMPING BEAN' }).click();
  await matchBoard(page, next.state);
  expect(next.state.stats.scoreBySource.jumpingBean).toBeGreaterThan(0);
  expect(next.state.effectScore).toBe(BigInt(0n));
  expect(next.events.some(event => event.type === 'JUMPING_BEAN_FREE_PLAY')).toBe(true);
  expect(next.events.some(event => event.type === 'DIE_ROLLED' && event.dieIds?.includes(0))).toBe(true);
  await bean.getByRole('button', { name: 'View details for Jumping Bean' }).click();
  await expect(page.getByRole('dialog', { name: 'JUMPING BEAN · I' })).toContainText(/Uses Remaining\s*0 \/ 1/);
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
      const dock = document.querySelector<HTMLElement>('[data-testid="dice-dock"]')!.getBoundingClientRect();
      const actionRow = document.querySelector<HTMLElement>('[data-testid="run-action-row"]')!.getBoundingClientRect();
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
        actionRow: { top: actionRow.top, right: actionRow.right, bottom: actionRow.bottom },
        actions: { rerollX: reroll.x, rerollWidth: reroll.width, playX: play.x, playWidth: play.width },
      };
    });
    expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.innerWidth);
    expect(measurements.scrollHeight).toBeLessThanOrEqual(measurements.innerHeight);
    expect(measurements.lower.x).toBeGreaterThan(measurements.upper.x + measurements.upper.width - 1);
    expect(Math.abs(measurements.upper.width - measurements.lower.width)).toBeLessThan(1);
    expect(measurements.rowsInside).toBe(true);
    expect(measurements.dockBottom).toBeLessThanOrEqual(measurements.actionRow.top + 1);
    expect(measurements.actionRow.bottom).toBeLessThanOrEqual(measurements.innerHeight);
    expect(measurements.actions.rerollX).toBeLessThan(measurements.actions.playX);
    expect(measurements.actionRow.right - (measurements.actions.playX + measurements.actions.playWidth)).toBeLessThan(12);
    await expect(page.locator('.selection-preview')).toBeHidden();
    await expect(page.locator('[data-testid^="scorecard-row-"]')).toHaveCount(14);
    await expect(page.getByRole('button', { name: /^Die 5,/ })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeInViewport();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath('round-narrow.png'), fullPage: true });
});
