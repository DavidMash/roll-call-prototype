import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { activeEncounterDice, bossTypeForRound, unavailableEncounterHands, wardenCheckpoints } from '../src/game/bosses';
import { dispatch, newRun } from '../src/game/engine';
import { handOptions, HANDS, HAND_IDS, ultimateHands } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { BossType, GameState } from '../src/game/types';

const seedFor = (boss: BossType) => {
  for (let index = 0; index < 100; index++) {
    const seed = `boss-browser-${index}`;
    if (bossTypeForRound(seed, 3) === boss) return seed;
  }
  throw new Error(`No seed found for ${boss}`);
};
async function ready(page: Page) {
  await page.locator('main').waitFor();
  for (let barrier = 0; barrier < 2; barrier++) {
    const bustContinue = page.locator('.bust-state').getByRole('button', { name: 'Continue', exact: true });
    if (await bustContinue.count()) { await bustContinue.click(); continue; }
    const map = page.getByTestId('run-map-transition');
    if (await map.count()) {
      await map.getByRole('button', { name: 'Continue', exact: true }).evaluate(element => (element as HTMLElement).click());
      continue;
    }
    break;
  }
  await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0);
}
function best(game: GameState) {
  const dice = activeEncounterDice(game);
  const callerHand = game.boss?.type === 'caller' && !game.boss.satisfied ? game.boss.calledHand : null;
  return handOptions(dice, unavailableEncounterHands(game)).filter(option => !option.consumed)
    .flatMap(option => option.combinations.map(dieIds => ({ hand: option.id, dieIds,
      score: handScore(dice, option.id, dieIds, game.handLevels[option.id]).score })))
    .filter(choice => game.boss?.type !== 'hexer' || choice.dieIds.includes(game.boss.cursedDieId))
    .sort((a, b) => (callerHand ? Number(b.hand === callerHand) - Number(a.hand === callerHand) : 0) || b.score - a.score)[0];
}
async function playOne(page: Page, game: GameState) {
  const choice = best(game);
  if (!choice) {
    const die = activeEncounterDice(game)[0];
    await page.getByRole('button', { name: new RegExp(`^${die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`},`) }).click();
    await page.getByRole('button', { name: /^Reroll Selected/ }).click();
    const next = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [die.id] }).state;
    await ready(page);
    return next;
  }
  const handRow = page.getByRole('button', { name: new RegExp(`^${HANDS[choice.hand].name} `) });
  await handRow.click();
  for (const die of activeEncounterDice(game)) {
    const button = page.getByRole('button', { name: new RegExp(`^${die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`},`) });
    const selected = await button.getAttribute('aria-pressed') === 'true';
    if (selected !== choice.dieIds.includes(die.id)) await button.click();
  }
  if (await handRow.getAttribute('aria-pressed') !== 'true') await handRow.click();
  await page.getByRole('button', { name: /^(PLAY|LAST PLAY)$/ }).click();
  const next = dispatch(game, { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }).state;
  await ready(page);
  return next;
}
async function reachBossShop(page: Page, boss: BossType, seed = seedFor(boss)) {
  let game = newRun(seed).state;
  await page.goto(`/?seed=${seed}&speed=instant`);
  await ready(page);
  while (!(game.phase === 'shop' && game.round === 2)) {
    if (game.phase === 'round') game = await playOne(page, game);
    else if (game.phase === 'roundSummary') {
      await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
      game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
      await ready(page);
    }
    else if (game.phase === 'shop') {
      await page.getByRole('button', { name: game.bust ? `RETRY ROUND ${game.round}` : 'NEXT ROUND', exact: true }).click();
      game = dispatch(game, game.bust ? { type: 'RETRY_ROUND' } : { type: 'NEXT_ROUND' }).state;
      await ready(page);
    } else throw new Error(`Unexpected phase ${game.phase}`);
  }
  return game;
}

test('local route transition auto-continues after its visible themed three-second countdown and honors reduced motion', async ({ page }) => {
  await page.goto('/?seed=map-browser&speed=normal');
  const map = page.getByTestId('run-map-transition');
  await expect(map).toBeVisible();
  expect(await map.evaluate(element => getComputedStyle(element).animationName)).toContain('map-screen-in');
  await expect(map).toHaveAttribute('data-destination', 'round:1');
  const destination = map.locator('[aria-current="step"]');
  await expect(destination).toContainText('Round 1');
  await expect(map.getByText('Round 1', { exact: true })).toHaveCount(2);
  const trackBox = await map.locator('.run-map-track').boundingBox();
  const nodeBox = await destination.boundingBox();
  expect(nodeBox!.y).toBeGreaterThanOrEqual(trackBox!.y);
  expect(nodeBox!.y + nodeBox!.height).toBeLessThanOrEqual(trackBox!.y + trackBox!.height);
  const continueButton = map.getByRole('button', { name: 'Continue', exact: true });
  await expect(continueButton.locator('.map-continue-countdown')).toHaveText('3');
  const fillStyle = await map.locator('.map-continue-fill').evaluate(element => {
    const style = getComputedStyle(element);
    return { animationDuration: style.animationDuration, animationName: style.animationName, backgroundColor: style.backgroundColor };
  });
  expect(fillStyle).toMatchObject({ animationDuration: '3s', animationName: 'map-continue-fill' });
  expect(fillStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  await page.waitForTimeout(1100);
  await expect(map).toBeVisible();
  await expect(continueButton.locator('.map-continue-countdown')).toHaveText('2');
  await expect(map).toHaveCount(0, { timeout: 3000 });
  await expect(page.getByTestId('stat-round')).toContainText('1');

  await page.goto('/?seed=map-manual&speed=normal');
  const manualMap = page.getByTestId('run-map-transition');
  await manualMap.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(manualMap).toHaveClass(/map-exiting/);
  expect(await manualMap.evaluate(element => getComputedStyle(element).animationName)).toBe('map-screen-out');
  await expect(manualMap).toBeVisible();
  await expect(manualMap).toHaveCount(0, { timeout: 1000 });
  await page.waitForTimeout(3100);
  await expect(page.getByTestId('stat-round')).toContainText('1');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?seed=map-reduced&speed=normal');
  const reducedMap = page.getByTestId('run-map-transition');
  await expect(reducedMap).toBeVisible();
  expect(await reducedMap.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await expect(reducedMap.locator('.map-continue-countdown')).toHaveText('3');
  const reducedAnimation = await reducedMap.locator('.map-continue-fill')
    .evaluate(element => getComputedStyle(element).animationName);
  expect(reducedAnimation).toBe('none');
  await page.waitForTimeout(250);
  await expect(reducedMap).toBeVisible();
  await expect(reducedMap).toHaveCount(0, { timeout: 3250 });
});

test('Caller preview hides the call, then encounter reveals it and its counter', async ({ page }) => {
  let game = await reachBossShop(page, 'caller');
  const preview = page.getByTestId('boss-preview');
  await expect(preview).toContainText('THE CALLER');
  await expect(preview).toContainText('Answer the called hand within three plays.');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await ready(page);
  if (game.boss?.type !== 'caller') throw new Error('Caller fixture failed');
  await expect(page.getByTestId('boss-panel')).toContainText(HANDS[game.boss.calledHand].name);
  await expect(page.getByTestId('boss-panel')).toContainText('3 PLAYS LEFT');
  await expect(page.getByTestId('boss-hud-label')).toHaveText('THE CALLER');
  await expect(page.locator('[data-screen-theme="caller"]')).toBeVisible();
  await expect(page.getByTestId('live-score-panel')).toHaveCSS('position', 'sticky');
});

for (const testCase of [
  { type: 'marathon', name: 'THE MARATHON', preview: '3× TARGET · Hands recharge after 7 manual plays.', hud: '3× TARGET' },
  { type: 'quickdraw', name: 'QUICKDRAW', preview: '⅓ TARGET · Only one Lower hand may be used.', hud: '1 SHOT AVAILABLE' },
  { type: 'fly', name: 'THE FLY', preview: 'Hands score ×0.5 until you catch the moving Fly.', hud: 'FLY LOOSE · ×0.5' },
  { type: 'snakeEyes', name: 'SNAKE EYES', preview: 'Scoring gradually turns your physical faces into 1s.', hud: 'SNAKE-EYED' },
  { type: 'infected', name: 'THE INFECTED', preview: 'Infected faces spread when other dice roll and lose their enhancements.', hud: 'INFECTED FACES' },
] as const) {
  test(`${testCase.name} preview, HUD, and theme use the boss architecture`, async ({ page }) => {
    let game = await reachBossShop(page, testCase.type);
    await expect(page.getByTestId('boss-preview')).toContainText(testCase.preview);
    await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
    game = dispatch(game, { type: 'NEXT_ROUND' }).state;
    await ready(page);
    await expect(page.getByTestId('boss-panel')).toContainText(testCase.name);
    await expect(page.getByTestId('boss-panel')).toContainText(testCase.hud);
    await expect(page.locator(`[data-screen-theme="${testCase.type}"]`)).toBeVisible();
  });
}

test('scorecard Ultimate badges require the Flame or Bonfire and match the domain ranking', async ({ page }) => {
  const seed = 'ultimate-scorecard-badges';
  const game = newRun(seed).state;
  await page.goto(`/?seed=${seed}&speed=instant`);
  await ready(page);
  await expect(page.locator('[data-testid^="ultimate-badge-"]')).toHaveCount(0);

  game.handLevels.ones = 2;
  game.dice[0].flame = { id: 'ultimate', investedGold: 50 };
  const expected = ultimateHands(game.handLevels);
  await page.evaluate(saved => localStorage.setItem('roll-call:active-run', JSON.stringify({ version: 1, state: saved })), game);
  await page.reload();
  await ready(page);
  await expect(page.locator('[data-testid^="ultimate-badge-"]')).toHaveCount(3);
  for (const hand of HAND_IDS) await expect(page.getByTestId(`ultimate-badge-${hand}`)).toHaveCount(expected.includes(hand) ? 1 : 0);
  await page.getByTestId('ultimate-badge-ones').hover();
  await expect(page.getByText('One of your three highest-ranked hands. Hand level ranks first, then trained scoring strength.')).toBeVisible();

  game.dice[0].flame = null;
  game.bonfires.push('ultimate');
  await page.evaluate(saved => localStorage.setItem('roll-call:active-run', JSON.stringify({ version: 1, state: saved })), game);
  await page.reload();
  await ready(page);
  await expect(page.locator('[data-testid^="ultimate-badge-"]')).toHaveCount(3);
  for (const hand of HAND_IDS) await expect(page.getByTestId(`ultimate-badge-${hand}`)).toHaveCount(expected.includes(hand) ? 1 : 0);
});

test('Warden rolls all dice locked and lets the player choose the first die without rerolling', async ({ page }) => {
  let game = await reachBossShop(page, 'warden');
  const preview = page.getByTestId('boss-preview');
  await expect(preview).toContainText('All five dice roll locked; choose one now and one at each checkpoint.');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await ready(page);
  await expect(page.getByTestId('boss-panel')).toContainText('CHOOSE YOUR FIRST DIE');
  if (game.boss?.type !== 'warden') throw new Error('Warden fixture failed');
  await expect(page.locator('.gameplay-dock .die')).toHaveCount(5);
  await expect(page.locator('.gameplay-dock .die.warden-locked')).toHaveCount(5);
  for (const id of [1, 2, 3, 4, 5]) {
    const die = page.getByRole('button', { name: new RegExp(`^Die ${id}, face .* locked, selectable to unlock$`) });
    await expect(die).toBeVisible();
    await expect(die).toBeEnabled();
    await expect(die).toHaveAttribute('aria-pressed', 'false');
    await expect(die.locator('.die-lock-overlay')).toContainText('SELECT');
  }
  const face = game.dice[4].value;
  await page.getByRole('button', { name: /^Die 5, face .* locked, selectable to unlock$/ }).click();
  await page.getByRole('button', { name: 'UNLOCK DIE', exact: true }).click();
  game = dispatch(game, { type: 'UNLOCK_WARDEN_DIE', dieId: 4 }).state;
  await ready(page);
  expect(game.dice[4].value).toBe(face);
  expect(game.boss).toMatchObject({ type: 'warden', startingDieId: 4, activeDieIds: [4] });
  if (game.boss?.type !== 'warden') throw new Error('Warden fixture failed');
  const firstCheckpoint = game.boss.checkpoints[0];
  await expect(page.locator('.gameplay-dock .die.warden-locked')).toHaveCount(4);
  for (const id of [1, 2, 3, 4]) {
    const locked = page.getByRole('button', { name: new RegExp(`^Die ${id}, face .* locked until ${firstCheckpoint} points$`) });
    await expect(locked).toBeDisabled();
    await expect(locked.locator('.die-lock-overlay')).toContainText(`${firstCheckpoint} PTS`);
  }
});

test('Warden checkpoint pauses play and lets the player choose any remaining die', async ({ page }) => {
  let game = await reachBossShop(page, 'warden');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await ready(page);

  await page.getByRole('button', { name: /^Die 4, face .* locked, selectable to unlock$/ }).click();
  await page.getByRole('button', { name: 'UNLOCK DIE', exact: true }).click();
  game = dispatch(game, { type: 'UNLOCK_WARDEN_DIE', dieId: 3 }).state;
  await ready(page);

  const first = best(game)!;
  expect(first.score).toBeGreaterThanOrEqual(wardenCheckpoints(game.target)[0]);
  game = await playOne(page, game);
  if (game.boss?.type !== 'warden') throw new Error('Warden fixture failed');
  expect(game.boss.pendingReinforcements).toBe(1);
  expect(game.boss.activeDieIds).toEqual([3]);
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toHaveCount(0);
  const threshold = game.boss.checkpoints[0];
  for (const id of [1, 2, 3, 5]) {
    const locked = page.getByRole('button', { name: new RegExp(`^Die ${id}, face .* locked until ${threshold} points, selectable to unlock$`) });
    await expect(locked).toBeEnabled();
    await expect(locked.locator('.die-lock-overlay')).toContainText(`${threshold} PTS`);
  }
  const face = game.dice[1].value;
  await page.getByRole('button', { name: new RegExp(`^Die 2, face .* locked until ${threshold} points, selectable to unlock$`) }).click();
  await page.getByRole('button', { name: 'UNLOCK DIE', exact: true }).click();
  game = dispatch(game, { type: 'UNLOCK_WARDEN_DIE', dieId: 1 }).state;
  await ready(page);
  expect(game.dice[1].value).toBe(face);
  if (game.boss?.type !== 'warden') throw new Error('Warden fixture failed');
  expect(game.boss.activeDieIds).toEqual([3, 1]);
  const secondThreshold = game.boss.checkpoints[1];
  await expect(page.locator('.gameplay-dock .die.warden-locked')).toHaveCount(3);
  for (const id of [1, 3, 5]) {
    const locked = page.getByRole('button', { name: new RegExp(`^Die ${id}, face .* locked until ${secondThreshold} points$`) });
    await expect(locked).toBeDisabled();
  }
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeVisible();
});

test('Hexer preview keeps its faces secret and encounter fits all six dice on one row', async ({ page }) => {
  let game = await reachBossShop(page, 'hexer');
  const preview = page.getByTestId('boss-preview');
  await expect(preview).toContainText('THE HEXER');
  await expect(preview).toContainText('A seven-sided Cursed Die joins the battle and must be used in every hand.');
  await expect(preview).not.toContainText('Weighted');
  await expect(preview).not.toContainText('Jackpot');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await ready(page);
  const cursed = game.dice.find(die => die.owner === 'boss')!;
  const cursedButton = page.getByRole('button', { name: /^Cursed Die, face/ });
  await expect(cursedButton).toBeVisible();
  await expect(cursedButton).toHaveAttribute('aria-pressed', 'false');
  await expect(cursedButton).toHaveAttribute('aria-disabled', 'false');
  await expect(page.getByRole('button', { name: 'Clear selection' })).toBeDisabled();

  const legalHands = new Set(handOptions(activeEncounterDice(game), game.consumed, [cursed.id]).map(option => option.id));
  for (const hand of HAND_IDS) {
    await expect(page.getByTestId(`scorecard-row-${hand}`)).toHaveAttribute('data-state', legalHands.has(hand) ? 'playable' : 'unavailable');
  }

  const playerButton = page.getByRole('button', { name: /^Die 1,/ });
  await playerButton.click();
  await expect(page.getByRole('button', { name: 'Clear selection' })).toBeEnabled();
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(cursedButton).toHaveAttribute('aria-pressed', 'false');
  await expect(playerButton).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.die.cursed-die')).toHaveCount(1);
  await expect(page.getByTestId('hexer-rule')).toHaveText('CURSE: Include the Cursed Die whenever you play a hand.');
  const dice = page.locator('.gameplay-dock .die');
  await expect(dice).toHaveCount(6);
  const boxes = await dice.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
  expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(2);
  expect(game.dice).toHaveLength(6);
});

test('Hexer face 7 renders seven pips without Mirror and remains freely selectable', async ({ page }) => {
  let game = await reachBossShop(page, 'hexer');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await ready(page);
  let cursed = game.dice.find(die => die.owner === 'boss')!;
  cursed.value = 7;
  await page.evaluate(saved => localStorage.setItem('roll-call:active-run', JSON.stringify({ version: 1, state: saved })), game);
  await page.reload();
  await ready(page);
  game = structuredClone(game);
  cursed = game.dice.find(die => die.owner === 'boss')!;
  expect(cursed.value).toBe(7);
  const button = page.getByRole('button', { name: /^Cursed Die, face 7,/ });
  await expect(button.locator('.pip-face')).toHaveAttribute('aria-label', 'Cursed Die showing 7');
  await expect(button.locator('.pip')).toHaveCount(7);
  await expect(button).not.toContainText('Mirror');
  await expect(button).toContainText('B+5');
  await expect(button).toContainText('Jackpot');
  await expect(button).toContainText('Sticky');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).toHaveAttribute('aria-disabled', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});

test('Boss clear shows +10 Boss Reward summary before the Flame Selection map', async ({ page }) => {
  let game = await reachBossShop(page, 'hexer');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await ready(page);
  for (let step = 0; step < 120 && game.phase !== 'roundSummary'; step++) {
    if (game.phase === 'round') game = await playOne(page, game);
    else if (game.phase === 'shop' && game.bust) {
      await page.getByRole('button', { name: `RETRY ROUND ${game.round}`, exact: true }).click();
      game = dispatch(game, { type: 'RETRY_ROUND' }).state;
      await ready(page);
    } else throw new Error(`Unexpected Boss clear phase ${game.phase}`);
  }
  expect(game.phase).toBe('roundSummary');
  await expect(page.getByRole('heading', { name: 'BOSS DEFEATED' })).toBeVisible();
  await expect(page.getByTestId('summary-gold-breakdown')).toContainText('Boss Reward');
  await expect(page.getByTestId('summary-gold-breakdown')).toContainText('+10');
  await expect(page.getByText('Flame Bonus')).toHaveCount(0);
  await expect(page.locator('[data-screen-theme="hexer"]')).toBeVisible();

  await page.getByText('NORMAL', { exact: true }).click();
  await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
  await expect(page.getByTestId('run-map-transition')).toHaveAttribute('data-destination', `flame:after-round:${game.round}`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('main').getByText('FLAME SELECTION', { exact: true })).toBeVisible();
});
