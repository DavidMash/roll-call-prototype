import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { activeEncounterDice, BOSSES, bossTypeForRound, createBossRuntime, createCursedDie, unavailableEncounterHands } from '../src/game/bosses';
import { dispatch, newRun } from '../src/game/engine';
import { handOptions, HANDS, HAND_IDS, ultimateHands } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { BigBossType, GameState } from '../src/game/types';
import { RUN_STORAGE_KEY, RUN_STORAGE_VERSION } from '../src/game/persistence';
import { enterRun, setDiceDisplay, setPlaybackSpeed } from './uiHelpers';

const seedFor = (boss: BigBossType) => {
  for (let index = 0; index < 100; index++) {
    const seed = `boss-browser-${index}`;
    if (bossTypeForRound(seed, 6) === boss) return seed;
  }
  throw new Error(`No seed found for ${boss}`);
};
async function ready(page: Page) {
  await page.locator('main').waitFor();
  await enterRun(page);
  for (let barrier = 0; barrier < 2; barrier++) {
    await expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0);
    const bustContinue = page.getByTestId('run-action-row').getByRole('button', { name: 'Continue', exact: true });
    if (await bustContinue.count()) { await bustContinue.click(); continue; }
    const map = page.getByTestId('run-map-transition');
    if (await map.count()) {
      await page.getByTestId('run-action-row').getByRole('button', { name: 'Continue', exact: true }).evaluate(element => (element as HTMLElement).click());
      await expect(map).toHaveCount(0);
      continue;
    }
    break;
  }
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
    await page.getByTestId('manual-reroll').click();
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
  await page.getByRole('button', { name: /^(PLAY|LAST PLAY[?.])$/ }).click();
  const next = dispatch(game, { type: 'PLAY', hand: choice.hand, dieIds: choice.dieIds }).state;
  await ready(page);
  return next;
}
async function reachBossShop(page: Page, boss: BigBossType, seed = seedFor(boss)) {
  let game = newRun(seed).state;
  game.phase = 'shop';
  game.round = 5;
  game.currentNodeId = 'shop:before-round:6';
  game.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
  game.bossSchedule[6] = boss;
  await page.goto(`/?seed=${seed}&speed=instant`);
  await page.evaluate(([key, version, state]) => localStorage.setItem(key, JSON.stringify({ version, state })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, game] as const);
  await page.reload();
  await ready(page);
  return game;
}

test('local route transition auto-continues after its visible themed three-second countdown and honors reduced motion', async ({ page }) => {
  await page.goto('/?seed=map-browser&speed=normal');
  await enterRun(page);
  const map = page.getByTestId('run-map-transition');
  await expect(map).toBeVisible();
  expect(await map.evaluate(element => getComputedStyle(element).animationName)).toContain('map-screen-in');
  await expect(map).toHaveAttribute('data-destination', 'round:1');
  const destination = map.locator('[aria-current="step"]');
  await expect(destination).toContainText('R1');
  await expect(map.getByText('R1', { exact: true })).toHaveCount(1);
  await expect(map.locator('.run-map-node')).toHaveCount(12);
  await expect(map.locator('.map-node-placeholder')).toHaveCount(0);
  const continueButton = page.getByTestId('run-action-row').getByRole('button', { name: 'Continue', exact: true });
  await expect(continueButton.locator('.map-continue-countdown')).toHaveText('3');
  const initialButtonWidth = await continueButton.evaluate(element => (element as HTMLElement).offsetWidth);
  const initialBadgeWidth = await continueButton.locator('.map-continue-countdown').evaluate(element => (element as HTMLElement).offsetWidth);
  await expect(continueButton.getByText('CONTINUE', { exact: true })).toBeVisible();
  const fillStyle = await page.getByTestId('run-action-row').locator('.map-continue-fill').evaluate(element => {
    const style = getComputedStyle(element);
    return { animationDuration: style.animationDuration, animationName: style.animationName, backgroundColor: style.backgroundColor };
  });
  expect(fillStyle).toMatchObject({ animationDuration: '3s', animationName: 'map-continue-fill' });
  expect(fillStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  await page.waitForTimeout(1500);
  const trackBox = await map.locator('.run-map-track').boundingBox();
  const nodeBox = await destination.boundingBox();
  expect(nodeBox!.y).toBeGreaterThanOrEqual(trackBox!.y);
  expect(nodeBox!.y + nodeBox!.height).toBeLessThanOrEqual(trackBox!.y + trackBox!.height);
  expect(nodeBox!.x).toBeGreaterThanOrEqual(trackBox!.x);
  expect(nodeBox!.x + nodeBox!.width).toBeLessThanOrEqual(trackBox!.x + trackBox!.width);
  await expect(map).toBeVisible();
  await expect(continueButton.locator('.map-continue-countdown')).toHaveText('2');
  const updatedButtonWidth = await continueButton.evaluate(element => (element as HTMLElement).offsetWidth);
  const updatedBadgeWidth = await continueButton.locator('.map-continue-countdown').evaluate(element => (element as HTMLElement).offsetWidth);
  expect(updatedButtonWidth).toBe(initialButtonWidth);
  expect(updatedBadgeWidth).toBe(initialBadgeWidth);
  await expect(continueButton.locator('.map-continue-countdown')).toHaveText('1', { timeout: 1500 });
  await expect(continueButton).not.toContainText('0');
  await expect(map).toHaveCount(0, { timeout: 2000 });
  await expect(page.getByTestId('stat-round')).toContainText('1');

  await page.goto('/?seed=map-manual&speed=normal');
  await enterRun(page);
  const manualMap = page.getByTestId('run-map-transition');
  await page.getByTestId('run-action-row').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(manualMap).toHaveClass(/map-exiting/);
  expect(await manualMap.evaluate(element => getComputedStyle(element).animationName)).toBe('map-screen-out');
  await expect(manualMap).toBeVisible();
  await expect(manualMap).toHaveCount(0, { timeout: 1000 });
  await page.waitForTimeout(3100);
  await expect(page.getByTestId('stat-round')).toContainText('1');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?seed=map-reduced&speed=normal');
  await enterRun(page);
  const reducedMap = page.getByTestId('run-map-transition');
  const reducedContinue = page.getByTestId('run-action-row').getByRole('button', { name: 'Continue', exact: true });
  await expect(reducedMap).toBeVisible();
  expect(await reducedMap.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  expect(await reducedMap.locator('[data-pulse="true"] .run-map-node').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await expect(reducedContinue.locator('.map-continue-countdown')).toHaveText('3');
  const reducedAnimation = await page.getByTestId('run-action-row').locator('.map-continue-fill')
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
  await expect(preview).toContainText('Play the called hand before it comes due or lose half your total score.');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  const bossMap = page.getByTestId('run-map-transition');
  await expect(bossMap.locator('[aria-current="step"] .node-label')).toHaveText('THE CALLER');
  await expect(bossMap.locator('[aria-current="step"]')).not.toContainText('BOSS');
  await ready(page);
  if (game.boss?.type !== 'caller') throw new Error('Caller fixture failed');
  await expect(page.getByTestId('boss-panel')).toContainText(HANDS[game.boss.calledHand].name);
  await expect(page.getByTestId('boss-status-caller')).toHaveText(`· ${HANDS[game.boss.calledHand].name} · 3 plays left`);
  await expect(page.getByTestId('boss-hud-label')).toHaveCount(0);
  await expect(page.locator('[data-screen-theme="caller"]')).toBeVisible();
  await expect(page.getByTestId('live-score-panel')).toHaveCSS('position', 'sticky');
});

for (const testCase of [
  { type: 'marathon', name: 'THE MARATHON', preview: 'Extra large Goal. Played hands return after 7 other hands are played.', hud: 'Hands return after 7 plays' },
  { type: 'quickdraw', name: 'QUICKDRAW', preview: 'Reduced Goal, but you can only play a single Lower hand.', hud: '1 Lower shot available' },
  { type: 'fly', name: 'THE FLY', preview: 'Your played hands are weakened until you catch The Fly on the marked Lower hand.', hud: 'Catch:' },
  { type: 'snakeEyes', name: 'SNAKE EYES', preview: 'Scored faces turn into 1s.', hud: 'Scored faces become 1s' },
  { type: 'infected', name: 'THE INFECTED', preview: 'Infected faces lose 3 Pips and their Enhancements. Played faces become infected.', hud: 'infected face' },
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

test('every boss uses a readable compact mobile status without displacing core gameplay', async ({ page }) => {
  const seed = 'mobile-boss-layout';
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto(`/?seed=${seed}&speed=instant`);
  for (const [type, expected] of [
    ['warden', '2 of 5 dice unlocked'],
    ['caller', '3 plays left'],
    ['fly', 'Catch:'],
    ['marathon', 'Hands return after 7 plays'],
    ['quickdraw', 'Lower shot spent'],
    ['hexer', 'Cursed Die required'],
    ['snakeEyes', 'Scored faces become 1s'],
    ['infected', '2 infected faces'],
  ] as const) {
    const game = newRun(seed).state;
    game.round = 3;
    game.target = 410;
    game.boss = createBossRuntime(seed, game.round, type);
    if (game.boss.type === 'warden') Object.assign(game.boss, { activeDieIds: [0, 1], nextUnlockTarget: 410, pendingReinforcements: 0 });
    if (game.boss.type === 'marathon') game.boss.cooldowns.pair = 5;
    if (game.boss.type === 'quickdraw') Object.assign(game.boss, { lowerShotUsed: true, playedLowerHand: 'fullHouse' });
    if (game.boss.type === 'snakeEyes') game.boss.mutatedFaces = [{ dieId: 0, physicalFace: 1 }, { dieId: 1, physicalFace: 2 }];
    if (game.boss.type === 'infected') game.boss.infectedFaces = [{ dieId: 0, physicalFace: 1 }, { dieId: 1, physicalFace: 2 }];
    if (type === 'hexer') game.dice.push(createCursedDie());
    await page.evaluate(([key, version, state]) => localStorage.setItem(key, JSON.stringify({ version, state })),
      [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, game] as const);
    await page.reload();
    await ready(page);

    const compact = page.locator('.boss-compact-row');
    await expect(compact).toBeVisible();
    await expect(compact).toContainText(expected);
    await expect(page.locator('.boss-full-details')).toHaveCount(0);
    const fits = await page.evaluate(() => {
      const root = document.documentElement;
      const rows = [...document.querySelectorAll<HTMLElement>('[data-testid^="scorecard-row-"]')];
      const dock = document.querySelector<HTMLElement>('.gameplay-dock')!.getBoundingClientRect();
      return root.scrollWidth <= innerWidth && root.scrollHeight <= innerHeight
        && rows.length === 14 && rows.every(row => row.getBoundingClientRect().bottom <= innerHeight)
        && dock.bottom <= innerHeight;
    });
    expect(fits).toBe(true);
  }
});

test('desktop boss HUD stays concise and does not repeat the full rule', async ({ page }) => {
  const seed = 'desktop-boss-layout';
  const game = newRun(seed).state;
  game.round = 3;
  game.boss = createBossRuntime(seed, game.round, 'caller');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`/?seed=${seed}&speed=instant`);
  await page.evaluate(([key, version, state]) => localStorage.setItem(key, JSON.stringify({ version, state })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, game] as const);
  await page.reload();
  await ready(page);

  await expect(page.locator('.boss-compact-row')).toBeVisible();
  await expect(page.getByTestId('boss-panel')).toContainText('plays left');
  await expect(page.getByTestId('boss-panel')).not.toContainText(BOSSES.caller.shortRule);
});

test('Boss information stays pinned right and opens the shared accessible modal', async ({ page }) => {
  const seed = 'boss-info-layout';
  const game = newRun(seed).state;
  game.round = 6;
  game.boss = createBossRuntime(seed, game.round, 'caller');
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`/?seed=${seed}&speed=instant`);
  await page.evaluate(([key, version, state]) => localStorage.setItem(key, JSON.stringify({ version, state })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, game] as const);
  await page.reload();
  await ready(page);

  const panel = page.getByTestId('boss-panel');
  const info = panel.getByRole('button', { name: 'Boss information' });
  await expect(info.locator('.info-circle-icon')).toBeVisible();
  const alignment = await panel.evaluate(element => {
    const panelRect = element.getBoundingClientRect();
    const copy = element.querySelector<HTMLElement>('.boss-bar-copy')!;
    const buttonRect = element.querySelector<HTMLElement>('.boss-info-button')!.getBoundingClientRect();
    const copyStyle = getComputedStyle(copy);
    return { rightGap: panelRect.right - buttonRect.right,
      overflowHandled: copyStyle.overflow === 'hidden' && copyStyle.textOverflow === 'ellipsis',
      buttonInside: buttonRect.right <= panelRect.right && buttonRect.left >= panelRect.left };
  });
  expect(alignment.rightGap).toBeLessThan(12);
  expect(alignment.buttonInside).toBe(true);
  expect(alignment.overflowHandled).toBe(true);

  await info.focus();
  await page.keyboard.press('Enter');
  const modal = page.getByRole('dialog', { name: /BOSS · THE CALLER/ });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText(BOSSES.caller.shortRule);
  await expect(modal).toContainText('Current call:');
  const modalLayer = await modal.evaluate(element => Number.parseInt(getComputedStyle(element.closest('.mantine-Modal-root')!).zIndex || '0', 10));
  expect(modalLayer).toBeGreaterThan(30);
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(info).toBeFocused();
});

test('score resolution owns the layer above a stationary Boss bar', async ({ page }) => {
  const seed = 'boss-score-layer';
  const game = newRun(seed).state;
  game.round = 6;
  game.target = 1_000_000;
  game.boss = createBossRuntime(seed, game.round, 'caller');
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto(`/?seed=${seed}&speed=normal`);
  await page.evaluate(([key, version, state]) => localStorage.setItem(key, JSON.stringify({ version, state })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, game] as const);
  await page.reload();
  await ready(page);

  const boss = page.getByTestId('boss-panel');
  const before = await boss.boundingBox();
  const choice = best(game)!;
  const hand = page.getByTestId(`scorecard-row-${choice.hand}`);
  await hand.click();
  await page.getByRole('button', { name: /^(PLAY|LAST PLAY[?.])$/ }).click();
  const score = page.locator('.live-score-panel:has(.is-score-resolution)');
  await expect(score).toBeVisible();
  const layers = await page.evaluate(() => {
    const score = document.querySelector<HTMLElement>('.live-score-panel:has(.is-score-resolution)')!;
    const overlay = score.querySelector<HTMLElement>('.is-score-resolution')!;
    const boss = document.querySelector<HTMLElement>('[data-testid="boss-panel"]')!;
    const scoreRect = overlay.getBoundingClientRect();
    const bossRect = boss.getBoundingClientRect();
    const x = Math.max(scoreRect.left, bossRect.left) + 8;
    const y = Math.max(scoreRect.top, bossRect.top) + 4;
    return {
      scoreZ: Number.parseInt(getComputedStyle(score).zIndex, 10),
      bossZ: Number.parseInt(getComputedStyle(boss).zIndex, 10),
      overlap: Math.min(scoreRect.bottom, bossRect.bottom) > Math.max(scoreRect.top, bossRect.top),
      scoreOwnsOverlap: !!document.elementFromPoint(x, y)?.closest('.live-score-panel'),
    };
  });
  expect(layers.scoreZ).toBeGreaterThan(layers.bossZ);
  expect(layers.overlap).toBe(true);
  expect(layers.scoreOwnsOverlap).toBe(true);
  const during = await boss.boundingBox();
  expect(during?.x).toBeCloseTo(before!.x, 1);
  expect(during?.y).toBeCloseTo(before!.y, 1);
  expect(during?.width).toBeCloseTo(before!.width, 1);
});

test('scorecard Ultimate badges require the Flame or Bonfire and match the domain ranking', async ({ page }) => {
  const seed = 'ultimate-scorecard-badges';
  const game = newRun(seed).state;
  await page.goto(`/?seed=${seed}&speed=instant`);
  await ready(page);
  await expect(page.locator('[data-testid^="ultimate-badge-"]')).toHaveCount(0);

  game.handLevels.ones = 2;
  game.dice[0].flame = { id: 'ultimate', investedGold: 50 };
  const expected = ultimateHands(game.handLevels);
  await page.evaluate(([key, version, saved]) => localStorage.setItem(key, JSON.stringify({ version, state: saved })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, game] as const);
  await page.reload();
  await ready(page);
  await expect(page.locator('[data-testid^="ultimate-badge-"]')).toHaveCount(1);
  for (const hand of HAND_IDS) await expect(page.getByTestId(`ultimate-badge-${hand}`)).toHaveCount(expected.includes(hand) ? 1 : 0);
  await page.getByTestId('ultimate-badge-ones').hover();
  await expect(page.getByText('Your highest level hand.')).toBeVisible();

  game.dice[0].flame = null;
  game.bonfires.push('ultimate');
  await page.evaluate(([key, version, saved]) => localStorage.setItem(key, JSON.stringify({ version, state: saved })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, game] as const);
  await page.reload();
  await ready(page);
  await expect(page.locator('[data-testid^="ultimate-badge-"]')).toHaveCount(1);
  for (const hand of HAND_IDS) await expect(page.getByTestId(`ultimate-badge-${hand}`)).toHaveCount(expected.includes(hand) ? 1 : 0);
});

test('Warden rolls all dice locked and lets the player choose the first die without rerolling', async ({ page }) => {
  let game = await reachBossShop(page, 'warden');
  const preview = page.getByTestId('boss-preview');
  await expect(preview).toContainText('Choose one die to start. Score enough to unlock the rest.');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await ready(page);
  const panel = page.getByTestId('boss-panel');
  await expect(panel).toContainText('Choose a die to unlock');
  await expect(panel.getByTestId('warden-next-target')).toHaveCount(0);
  await expect(panel.locator('[role="progressbar"]')).toHaveCount(0);
  await expect(panel.locator('.mantine-Badge-root')).toHaveCount(0);
  if (game.boss?.type !== 'warden') throw new Error('Warden fixture failed');
  await expect(page.locator('.gameplay-dock .die')).toHaveCount(5);
  await expect(page.locator('.gameplay-dock .die.warden-locked')).toHaveCount(5);
  for (const id of [1, 2, 3, 4, 5]) {
    const die = page.getByRole('button', { name: new RegExp(`^Die ${id}, face .* locked, selectable to unlock$`) });
    await expect(die).toBeVisible();
    await expect(die).toBeEnabled();
    await expect(die).toHaveAttribute('aria-pressed', 'false');
    await expect(die.locator('.die-lock-overlay')).toContainText('SELECT');
    await expect(die.locator('.die-number')).toBeVisible();
    expect(await die.evaluate(element => {
      const lock = element.querySelector('.die-lock-overlay')!.getBoundingClientRect();
      const value = element.querySelector('.die-number')!.getBoundingClientRect();
      return lock.right <= value.left || lock.left >= value.right || lock.bottom <= value.top || lock.top >= value.bottom;
    })).toBe(true);
    await expect(die.locator('..').locator('.die-flame-zone')).toHaveCount(1);
    await expect(die.locator('..').locator('.die-enhancement-strip')).toHaveCount(1);
  }
  const face = game.dice[4].value;
  await page.getByRole('button', { name: /^Die 5, face .* locked, selectable to unlock$/ }).click();
  await page.getByRole('button', { name: 'UNLOCK DIE', exact: true }).click();
  game = dispatch(game, { type: 'UNLOCK_WARDEN_DIE', dieId: 4 }).state;
  await ready(page);
  expect(game.dice[4].value).toBe(face);
  expect(game.boss).toMatchObject({ type: 'warden', startingDieId: 4, activeDieIds: [4] });
  if (game.boss?.type !== 'warden') throw new Error('Warden fixture failed');
  const firstTarget = game.boss.nextUnlockTarget!;
  expect(firstTarget).toBe(game.boss.unlockCosts[0]);
  await expect(panel.getByTestId('boss-status-warden')).toHaveText('· 1 of 5 dice unlocked');
  await expect(panel.locator('.mantine-Badge-root')).toHaveCount(0);
  await expect(page.locator('.gameplay-dock .die.warden-locked')).toHaveCount(4);
  for (const id of [1, 2, 3, 4]) {
    const locked = page.getByRole('button', { name: new RegExp(`^Die ${id}, face .* locked until ${firstTarget} points$`) });
    await expect(locked).toBeDisabled();
    await expect(locked.locator('.die-lock-overlay')).toContainText(`${firstTarget} PTS`);
  }
});

test('Warden target pauses play and updates the shared lock target after the chosen unlock', async ({ page }) => {
  let game = await reachBossShop(page, 'warden');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await ready(page);

  await page.getByRole('button', { name: /^Die 4, face .* locked, selectable to unlock$/ }).click();
  await page.getByRole('button', { name: 'UNLOCK DIE', exact: true }).click();
  game = dispatch(game, { type: 'UNLOCK_WARDEN_DIE', dieId: 3 }).state;
  await ready(page);

  const frozenTarget = game.boss?.type === 'warden' ? game.boss.nextUnlockTarget! : 0;
  for (let plays = 0; game.boss?.type === 'warden' && game.boss.pendingReinforcements === 0 && plays < 6; plays++) {
    game = await playOne(page, game);
  }
  if (game.boss?.type !== 'warden') throw new Error('Warden fixture failed');
  expect(game.boss.pendingReinforcements).toBe(1);
  expect(game.boss.activeDieIds).toEqual([3]);
  expect(game.boss.nextUnlockTarget).toBe(frozenTarget);
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toHaveCount(0);
  const threshold = game.boss.nextUnlockTarget!;
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
  const secondThreshold = game.boss.nextUnlockTarget!;
  expect(secondThreshold).toBe(game.boss.unlockCosts[0] + game.boss.unlockCosts[1]);
  expect(secondThreshold).not.toBe(threshold);
  await expect(page.getByTestId('boss-status-warden')).toHaveText('· 2 of 5 dice unlocked');
  await expect(page.locator('.gameplay-dock .die.warden-locked')).toHaveCount(3);
  for (const id of [1, 3, 5]) {
    const locked = page.getByRole('button', { name: new RegExp(`^Die ${id}, face .* locked until ${secondThreshold} points$`) });
    await expect(locked).toBeDisabled();
  }
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeVisible();
});

test('Hexer preview keeps its faces secret and encounter fits all six dice on one row', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  let game = await reachBossShop(page, 'hexer');
  const preview = page.getByTestId('boss-preview');
  await expect(preview).toContainText('THE HEXER');
  await expect(preview).toContainText('A Cursed Die joins you and must be used in every hand.');
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
  await expect(page.getByRole('button', { name: 'Clear selection' })).toHaveCount(0);

  const legalHands = new Set(handOptions(activeEncounterDice(game), game.consumed, [cursed.id]).map(option => option.id));
  for (const hand of HAND_IDS) {
    await expect(page.getByTestId(`scorecard-row-${hand}`)).toHaveAttribute('data-state', legalHands.has(hand) ? 'playable' : 'unavailable');
  }

  const playerButton = page.getByRole('button', { name: /^Die 1,/ });
  await playerButton.click();
  await playerButton.click();
  await expect(cursedButton).toHaveAttribute('aria-pressed', 'false');
  await expect(playerButton).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.die.cursed-die')).toHaveCount(1);
  await expect(page.getByTestId('boss-status-hexer')).toHaveText('· Cursed Die required');
  const dice = page.locator('.gameplay-dock .die');
  await expect(dice).toHaveCount(6);
  const boxes = await dice.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
  expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(game.dice).toHaveLength(6);
});

test('Hexer face 7 renders seven pips with Bonus and Mirror and remains freely selectable', async ({ page }) => {
  let game = await reachBossShop(page, 'hexer');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await ready(page);
  let cursed = game.dice.find(die => die.owner === 'boss')!;
  cursed.value = 7;
  await page.evaluate(([key, version, saved]) => localStorage.setItem(key, JSON.stringify({ version, state: saved })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, game] as const);
  await page.reload();
  await ready(page);
  await setDiceDisplay(page, 'PIPS');
  game = structuredClone(game);
  cursed = game.dice.find(die => die.owner === 'boss')!;
  expect(cursed.value).toBe(7);
  const button = page.getByRole('button', { name: /^Cursed Die, face 7,/ });
  const slot = page.getByTestId('cursed-die-slot');
  await expect(button.locator('.pip-face')).toHaveAttribute('aria-label', 'Cursed Die showing 7');
  await expect(button.locator('.pip')).toHaveCount(7);
  await expect(slot.getByRole('button', { name: /View Enhancements on Cursed Die face 7/ })).toHaveAccessibleName(/Bonus ×5, Mirror ×1/);
  await expect(slot.locator('.enhancement-mirror')).toHaveCount(1);
  await expect(slot.locator('.enhancement-bonus')).toHaveAttribute('title', 'Bonus ×5');
  await expect(slot.locator('.enhancement-jackpot')).toHaveCount(0);
  await expect(slot.locator('.enhancement-sticky')).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).toHaveAttribute('aria-disabled', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});

test('Boss clear shows its Boss Reward summary and transitions directly to Flame Selection', async ({ page }) => {
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
  await expect(page.getByTestId('summary-gold-breakdown')).toContainText('+11');
  await expect(page.getByText('Flame Bonus')).toHaveCount(0);
  await expect(page.locator('[data-screen-theme="hexer"]')).toBeVisible();

  await setPlaybackSpeed(page, 'NORMAL');
  await page.getByRole('button', { name: 'CONTINUE', exact: false }).click();
  await expect(page.getByTestId('run-map-transition')).toHaveCount(0);
  await expect(page.getByRole('main').getByText('FLAME SELECTION', { exact: true })).toBeVisible();
});
