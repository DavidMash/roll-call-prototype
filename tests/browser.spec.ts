import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { newRun, dispatch } from '../src/game/engine';
import { handOptions, handStats, HANDS, HAND_IDS } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import { ENHANCEMENTS } from '../src/game/enhancements';
import { CONFIG } from '../src/game/config';
import type { Enhancement, GameState } from '../src/game/types';

function bestHand(game: GameState) {
  return handOptions(game.dice, game.consumed).filter(option => !option.consumed)
    .flatMap(option => option.combinations.map(dieIds => ({ hand: option.id, dieIds,
      score: handScore(game.dice, option.id, dieIds, game.handLevels[option.id]).score })))
    .sort((a, b) => b.score - a.score)[0];
}
async function ready(page: Page) { await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0); }
async function matchBoard(page: Page, game: GameState) {
  await ready(page);
  for (const [stat, value] of [['round', game.round], ['goal', game.target], ['score', game.score], ['gold', game.gold]] as const) {
    await expect(page.getByTestId(`stat-${stat}`).getByText(String(value), { exact: true })).toBeVisible();
  }
  if (game.phase === 'shop' || game.phase === 'flameReward') {
    if (game.phase === 'shop') await expect(page.getByText(new RegExp(`Round ${game.round} cleared.*\\+${game.lastRoundPayout?.total ?? 5} Gold`))).toBeVisible();
    await expect(page.getByTestId('stat-rerolls')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Reroll Selected/ })).toHaveCount(0);
  } else await expect(page.getByTestId('stat-rerolls').getByText(String(game.manualRerollsRemaining), { exact: true })).toBeVisible();
  for (const die of game.dice) await expect(page.getByRole('button', { name: new RegExp(`^Die ${die.id + 1}, face ${die.value},`) })).toBeVisible();
}
async function playBest(page: Page, game: GameState): Promise<GameState> {
  const choice = bestHand(game);
  if (!choice) {
    await page.getByRole('button', { name: /^Die 1,/ }).click();
    await page.getByRole('button', { name: 'Reroll Selected — 1', exact: true }).click();
    const next = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }).state;
    await matchBoard(page, next);
    return next;
  }
  await page.getByRole('button', { name: new RegExp(`^${HANDS[choice.hand].name} `) }).click();
  for (const die of game.dice) {
    const target = page.getByRole('button', { name: new RegExp(`^Die ${die.id + 1},`) });
    const selected = await target.getAttribute('aria-pressed') === 'true';
    if (selected !== choice.dieIds.includes(die.id)) await target.click();
  }
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  const next = dispatch(game, { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }).state;
  await matchBoard(page, next);
  return next;
}
function findShopSeed(required?: Enhancement) {
  for (let i = 0; i < 1000; i++) {
    const seed = `browser-${i}`;
    let game = newRun(seed).state;
    for (let step = 0; step < 12 && game.phase === 'round'; step++) {
      const choice = bestHand(game);
      game = dispatch(game, choice ? { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }
        : { type: 'MANUAL_REROLL', dieIds: [0] }).state;
    }
    if (game.phase === 'shop' && (!required || game.shop!.offers.some(offer => offer.enhancement === required))) return seed;
  }
  throw new Error('No suitable shop seed found');
}
function findTrainingSeed() {
  for (let i = 0; i < 1000; i++) {
    const seed = `training-browser-${i}`;
    let game = newRun(seed).state;
    for (let step = 0; step < 12 && game.phase === 'round'; step++) {
      const choice = bestHand(game);
      game = dispatch(game, choice ? { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }
        : { type: 'MANUAL_REROLL', dieIds: [0] }).state;
    }
    if (game.phase !== 'shop') continue;
    for (const offer of game.shop!.trainingOffers) {
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
function findStickyStackSeed() {
  for (let i = 0; i < 3000; i++) {
    const seed = `sticky-stack-${i}`;
    let game = newRun(seed).state;
    for (let step = 0; step < 12 && game.phase === 'round'; step++) {
      const choice = bestHand(game);
      game = dispatch(game, choice ? { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }
        : { type: 'MANUAL_REROLL', dieIds: [0] }).state;
    }
    if (game.phase !== 'shop') continue;
    const first = game.shop!.offers.find(offer => offer.enhancement === 'sticky');
    if (!first) continue;
    game = dispatch(game, { type: 'BUY', offerId: first.id, dieId: 0 }).state;
    game = dispatch(game, { type: 'REROLL_OFFERS' }).state;
    if (game.shop!.offers.some(offer => offer.enhancement === 'sticky')) return seed;
  }
  throw new Error('No shop seed found for a repeated Sticky purchase');
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
  await page.goto(`/?seed=${seed}&speed=instant`);
  await matchBoard(page, game);
  while (game.phase === 'round') game = await playBest(page, game);
  expect(game.phase).toBe('shop');
  return game;
}

test('scorecard keeps all fourteen categories visible with base stats and actionable states', async ({ page }) => {
  await page.goto('/?seed=persistent-scorecard&speed=instant');
  await ready(page);
  await expect(page.locator('[data-testid^="scorecard-row-"]')).toHaveCount(14);
  for (const hand of HAND_IDS) {
    const row = page.getByTestId(`scorecard-row-${hand}`);
    const stats = handStats(hand, 1);
    await expect(row).toBeVisible();
    await expect(row).toContainText(`Lv. ${stats.level}`);
    await expect(page.getByTestId(`scorecard-stats-${hand}`)).toHaveText(`${stats.basePips} · ×${stats.baseMultiplier}`);
    await expect(page.getByTestId(`scorecard-score-${hand}`)).toHaveText('—');
  }
  await expect(page.locator('[data-state="playable"]')).not.toHaveCount(0);
  await expect(page.locator('[data-state="unavailable"]')).not.toHaveCount(0);
  await expect(page.getByTestId('scorecard-effect-score')).toHaveText('0');
  await expect(page.getByTestId('scorecard-round-total')).toHaveText('0 / 50');

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
  await expect(page.getByTestId('stat-score').getByText('0', { exact: true })).toBeVisible();
});

test('compact HUD, Run Info and Help keep secondary information off the gameplay surface', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?seed=ui-overhaul&speed=instant');
  await ready(page);
  for (const stat of ['round', 'goal', 'score', 'gold', 'rerolls']) await expect(page.getByTestId(`stat-${stat}`)).toBeVisible();
  await expect(page.locator('[data-testid^="scorecard-row-"]')).toHaveCount(14);
  await expect(page.getByRole('button', { name: /^Die 5,/ })).toBeVisible();
  const playBox = await page.getByRole('button', { name: 'PLAY', exact: true }).boundingBox();
  expect(playBox && playBox.y + playBox.height).toBeLessThanOrEqual(768);

  await page.getByRole('button', { name: 'Run Info', exact: true }).click();
  const runInfo = page.getByRole('dialog', { name: 'Run Info' });
  await expect(runInfo).toBeVisible();
  await runInfo.getByRole('tab', { name: 'Debug' }).click();
  await expect(runInfo.getByLabel('Run seed')).toHaveValue('ui-overhaul');
  await expect(runInfo.getByRole('button', { name: 'Restart same seed' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'How to Play', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'How to Play' });
  await expect(help).toBeVisible();
  await help.getByRole('tab', { name: 'Enhancements' }).click();
  await expect(help.getByText('Jackpot', { exact: true })).toBeVisible();
  await expect(help.getByText(/held out of the winning hand/)).toBeVisible();
});

test('Hand Training purchase persists into scorecard and trained scoring playback', async ({ page }) => {
  const fixture = findTrainingSeed();
  let game = await reachShop(page, fixture.seed);
  const hand = fixture.hand;
  const level1 = handStats(hand, 1);
  const level2 = handStats(hand, 2);
  await expect(page.locator('[data-testid^="training-offer-"]')).toHaveCount(3);
  await expect(page.getByTestId(`training-pips-${hand}`)).toHaveText(`${level1.basePips} → ${level2.basePips} Pips`);
  await expect(page.getByTestId(`training-mult-${hand}`)).toHaveText(`×${level1.baseMultiplier} → ×${level2.baseMultiplier} Mult`);

  const goldBefore = game.gold;
  await page.getByTestId(`train-${hand}`).click();
  game = dispatch(game, { type: 'TRAIN_HAND', hand }).state;
  await matchBoard(page, game);
  expect(game.gold).toBe(goldBefore - CONFIG.handTrainingCost);
  expect(game.handLevels[hand]).toBe(2);
  await expect(page.getByTestId(`train-${hand}`)).toBeDisabled();
  await expect(page.getByTestId(`training-offer-${hand}`)).toContainText('Purchased');

  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await matchBoard(page, game);
  const row = page.getByTestId(`scorecard-row-${hand}`);
  await expect(row).toContainText(`Lv. 2`);
  await expect(page.getByTestId(`scorecard-stats-${hand}`)).toHaveText(`${level2.basePips} · ×${level2.baseMultiplier}`);

  await page.clock.install({ time: new Date('2026-09-18T12:00:00Z') });
  await page.getByText('NORMAL', { exact: true }).click();
  await row.click();
  const option = handOptions(game.dice, game.consumed).find(item => item.id === hand && !item.consumed)!;
  const scored = handScore(game.dice, hand, option.combinations[0], 2);
  expect(Number.isInteger(scored.rawScore)).toBe(false);
  await expect(page.getByText(`${scored.pips} pips × ${scored.multiplier} = ${scored.score} points`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  const result = dispatch(game, { type: 'PLAY', hand, dieIds: option.combinations[0] });
  const finalizedIndex = result.events.findIndex(event => event.type === 'HAND_SCORE_FINALIZED');
  for (let index = 0; index <= finalizedIndex; index++) {
    const event = result.events[index];
    await expect(page.getByText(`EVENT ${index + 1} / ${result.events.length}`, { exact: true })).toBeVisible();
    if (event.type === 'HAND_STARTED') {
      await expect(page.locator('.score-tick')).toHaveText(`${HANDS[hand].name} — LV. 2`);
      await expect(page.getByTestId('hand-pips')).toHaveText(String(level2.basePips));
      await expect(page.getByTestId('hand-multiplier')).toHaveText(`x${level2.baseMultiplier}`);
    }
    if (event.type === 'HAND_SCORE_FINALIZED') {
      await expect(page.getByTestId('hand-pips')).toHaveText(String(scored.pips));
      await expect(page.getByTestId('hand-multiplier')).toHaveText(`x${scored.multiplier}`);
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
  await expect(page.getByTestId('scorecard-round-total')).toHaveText(`${scored.score} / ${game.target}`);
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
  await page.getByTestId('offer-sticky').getByRole('button').click();
  const physicalFace = game.dice[0].value;
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  game = dispatch(game, { type: 'BUY', offerId: offer.id, dieId: 0 }).state;
  await matchBoard(page, game);
  await expect(page.getByTestId('offer-sticky').getByRole('button', { name: 'Purchased' })).toBeDisabled();
  expect(game.dice[0].faces[physicalFace - 1].enhancements.sticky).toBe(1);
  await page.getByRole('button', { name: 'Reroll Dice · 2 gold', exact: true }).click();
  game = dispatch(game, { type: 'REROLL_DICE' }).state;
  await matchBoard(page, game);
  await expect(page.getByRole('button', { name: 'Reroll Dice · 4 gold', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await matchBoard(page, game);
  for (let step = 0; step < 100 && game.phase !== 'lost'; step++) {
    if (game.phase === 'round') game = await playBest(page, game);
    else if (game.phase === 'shop') {
      await page.getByRole('button', { name: 'NEXT ROUND' }).click();
      game = dispatch(game, { type: 'NEXT_ROUND' }).state;
      await matchBoard(page, game);
    } else if (game.phase === 'flameReward') {
      if (game.flameReward!.acquired) {
        await page.getByRole('button', { name: 'CONTINUE TO SHOP', exact: false }).click();
        game = dispatch(game, { type: 'CONTINUE_FLAME_REWARD' }).state;
      } else {
        const offer = game.flameReward!.offers[0];
        const dieId = game.dice.find(die => !die.flame)?.id ?? 0;
        await page.getByTestId(`flame-offer-${offer.flame}`).getByRole('button', { name: 'Select Flame' }).click();
        await page.getByRole('button', { name: new RegExp(`^Die ${dieId + 1},`) }).click();
        game = dispatch(game, { type: 'CHOOSE_FLAME', offerId: offer.id, dieId }).state;
      }
      await matchBoard(page, game);
    } else throw new Error(`Unexpected phase: ${game.phase}`);
  }
  expect(game.phase).toBe('lost');
  await expect(page.getByRole('heading', { name: 'Run over' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('run-over.png'), fullPage: true });
  await page.getByRole('button', { name: 'Run Info', exact: true }).click();
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
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Run over');
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
  await page.getByRole('button', { name: 'Reroll Enhancements · 3 gold', exact: true }).click();
  game = dispatch(game, { type: 'REROLL_OFFERS' }).state;
  await matchBoard(page, game);
  await expect(page.locator('.offer')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Reroll Enhancements · 6 gold', exact: true })).toBeVisible();
  for (const item of game.shop!.offers) await expect(page.getByTestId(`offer-${item.enhancement}`).getByText(ENHANCEMENTS[item.enhancement].name, { exact: true })).toBeVisible();
});

test('stackable enhancement purchases show a single readable count badge', async ({ page }) => {
  let game = await reachShop(page, findStickyStackSeed());
  const startingGold = game.gold;
  const first = game.shop!.offers.find(offer => offer.enhancement === 'sticky')!;
  await page.getByTestId('offer-sticky').getByRole('button').click();
  const physical = page.getByRole('button', { name: /^Die 1,/ });
  await physical.click();
  game = dispatch(game, { type: 'BUY', offerId: first.id, dieId: 0 }).state;
  await matchBoard(page, game);

  await page.getByRole('button', { name: 'Reroll Enhancements · 3 gold', exact: true }).click();
  game = dispatch(game, { type: 'REROLL_OFFERS' }).state;
  await matchBoard(page, game);
  const second = game.shop!.offers.find(offer => offer.enhancement === 'sticky')!;
  await page.getByTestId('offer-sticky').getByRole('button').click();
  await physical.click();
  game = dispatch(game, { type: 'BUY', offerId: second.id, dieId: 0 }).state;
  await matchBoard(page, game);

  await expect(physical).toContainText('Sticky ×2');
  expect(game.dice[0].faces[game.dice[0].value - 1].enhancements.sticky).toBe(2);
  expect(game.gold).toBe(startingGold - 5); // two 1-Gold Sticky stacks and one 3-Gold offer reroll
  const face = game.dice[0].value;
  await page.getByRole('button', { name: `Scrap Sticky from D1 face ${face}`, exact: true }).click();
  game = dispatch(game, { type: 'SCRAP_ENHANCEMENT', dieId: 0, face, enhancement: 'sticky' }).state;
  await matchBoard(page, game);
  await expect(physical).not.toContainText('Sticky');
  expect(game.gold).toBe(startingGold - 5);
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
    await expect(page.getByRole('heading', { name: 'Run over' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear selection' }).click();
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
    await expect(fours).toHaveAccessibleName(/^Fours · Lv\. 1 7 Pips · ×1 /);
    await expect(page.getByText('11 pips × 1 = 11 points', { exact: true })).toBeVisible();
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
  await matchBoard(page, game);
  const choice = bestHand(game);
  await page.getByRole('button', { name: new RegExp(`^${HANDS[choice.hand].name} `) }).click();
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toBeVisible();
  await page.getByRole('button', { name: 'Skip playback' }).click();
  await matchBoard(page, dispatch(game, { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }).state);
});

test('purchased Jumping Bean visibly triggers and rerolls on the next initial gameplay roll', async ({ page }) => {
  let seed: string | null = null;
  for (let i = 0; i < 1500 && !seed; i++) {
    let candidate = newRun(`chain-${i}`).state;
    for (let step = 0; step < 12 && candidate.phase === 'round'; step++) {
      const choice = bestHand(candidate);
      candidate = dispatch(candidate, choice ? { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }
        : { type: 'MANUAL_REROLL', dieIds: [0] }).state;
    }
    if (candidate.phase !== 'shop') continue;
    const offer = candidate.shop!.offers.find(item => item.enhancement === 'jumpingBean');
    if (!offer) continue;
    candidate = dispatch(candidate, { type: 'BUY', offerId: offer.id, dieId: 0 }).state;
    const next = dispatch(candidate, { type: 'NEXT_ROUND' });
    if (next.events.some(event => event.enhancement === 'jumpingBean')) seed = candidate.seed;
  }
  expect(seed).not.toBeNull();
  let game = await reachShop(page, seed!);
  const offer = game.shop!.offers.find(item => item.enhancement === 'jumpingBean')!;
  await page.getByTestId('offer-jumpingBean').getByRole('button').click();
  await page.getByRole('button', { name: /^Die 1,/ }).click();
  game = dispatch(game, { type: 'BUY', offerId: offer.id, dieId: 0 }).state;
  await matchBoard(page, game);
  const next = dispatch(game, { type: 'NEXT_ROUND' });
  await page.clock.install({ time: new Date('2026-09-18T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-18T12:00:01Z'));
  await page.getByText('NORMAL', { exact: true }).click();
  await page.getByRole('button', { name: 'NEXT ROUND' }).click();
  // Observe the transient ability tick deterministically instead of hoping the
  // real-time assertion polling catches its 350 ms display window.
  const beanIndex = next.events.findIndex(event => event.type === 'ABILITY_TRIGGERED' && event.enhancement === 'jumpingBean');
  expect(beanIndex).toBeGreaterThanOrEqual(0);
  for (let index = 0; index <= beanIndex; index++) {
    await expect(page.getByText(`EVENT ${index + 1} / ${next.events.length}`, { exact: true })).toBeVisible();
    if (index < beanIndex) await page.clock.runFor(CONFIG.tickMs.normal);
  }
  await expect(page.locator('.resolution .score-tick')).toHaveText('JUMPING BEAN');
  await expect(page.locator('.ability-label').first()).toHaveText('JUMPING BEAN');
  await page.getByRole('button', { name: 'Skip playback' }).click();
  await matchBoard(page, next.state);
  await expect(page.getByTestId('scorecard-effect-score')).toHaveText(String(next.state.effectScore));
  await expect(page.getByTestId('scorecard-round-total')).toHaveText(`${next.state.score} / ${next.state.target}`);
  expect(next.state.stats.scoreBySource.jumpingBean).toBeGreaterThan(0);
  expect(next.events.filter(event => event.type === 'DIE_ROLLED' && event.dieIds?.includes(0)).length).toBeGreaterThan(1);
});

test('narrow browser remains usable without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?speed=instant');
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: /^Die 5,/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('round-narrow.png'), fullPage: true });
});
