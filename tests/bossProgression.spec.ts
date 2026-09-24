import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { activeEncounterDice, bossTypeForRound, wardenCheckpoints } from '../src/game/bosses';
import { dispatch, newRun } from '../src/game/engine';
import { handOptions, HANDS } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { BossType, GameState } from '../src/game/types';

const seedFor = (boss: BossType) => {
  for (let index = 0; index < 100; index++) {
    const seed = `boss-browser-${index}`;
    if (bossTypeForRound(seed, 3) === boss) return seed;
  }
  throw new Error(`No seed found for ${boss}`);
};
const ready = async (page: Page) => expect(page.getByText(/^EVENT \d+ \/ \d+$/)).toHaveCount(0);
function best(game: GameState) {
  const dice = activeEncounterDice(game);
  const callerHand = game.boss?.type === 'caller' && !game.boss.satisfied ? game.boss.calledHand : null;
  return handOptions(dice, game.consumed).filter(option => !option.consumed)
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

test('local route transition appears, can be skipped, and honors reduced motion', async ({ page }) => {
  await page.goto('/?seed=map-browser&speed=normal');
  const map = page.getByTestId('run-map-transition');
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute('data-destination', 'round:1');
  await expect(map.locator('[aria-current="step"]')).toContainText('R1');
  await page.waitForTimeout(1100);
  await expect(map).toBeVisible();
  await map.getByRole('button', { name: 'Skip', exact: true }).click();
  await ready(page);
  await expect(map).toHaveCount(0);
  await expect(page.getByTestId('stat-round')).toContainText('1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const started = Date.now();
  await page.goto('/?seed=map-reduced&speed=normal');
  await expect(page.getByTestId('run-map-transition')).toHaveCount(0, { timeout: 800 });
  expect(Date.now() - started).toBeLessThan(1000);
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

test('Warden preview stays concise and encounter starts with only centered D1', async ({ page }) => {
  let game = await reachBossShop(page, 'warden');
  const preview = page.getByTestId('boss-preview');
  await expect(preview).toContainText('Begin with D1; checkpoints release the rest in order.');
  await expect(preview).not.toContainText('10%');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await ready(page);
  await expect(page.getByTestId('boss-panel')).toContainText('ACTIVE · D1');
  await expect(page.getByRole('button', { name: /^Die 1,/ })).toBeVisible();
  for (const id of [2, 3, 4, 5]) await expect(page.getByRole('button', { name: new RegExp(`^Die ${id},`) })).toHaveCount(0);
  await expect(page.locator('.die.ineligible')).toHaveCount(0);
  const rowBox = await page.locator('.gameplay-dock .dice-row').boundingBox();
  const dieBox = await page.getByRole('button', { name: /^Die 1,/ }).boundingBox();
  expect(Math.abs((rowBox!.x + rowBox!.width / 2) - (dieBox!.x + dieBox!.width / 2))).toBeLessThan(2);
  expect(game.boss).toMatchObject({ type: 'warden', startingDieId: 0, activeDieIds: [0] });
});

test('Warden checkpoints auto-release D2 onward without interrupting hand selection', async ({ page }) => {
  let game = await reachBossShop(page, 'warden');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await ready(page);

  const first = best(game)!;
  expect(first.score).toBeGreaterThanOrEqual(wardenCheckpoints(game.target)[0]);
  game = await playOne(page, game);
  if (game.boss?.type !== 'warden') throw new Error('Warden fixture failed');
  expect(game.boss.pendingReinforcements).toBe(0);
  expect(game.boss.activeDieIds.slice(0, 2)).toEqual([0, 1]);
  await expect(page.getByRole('button', { name: /^Die 2,/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Die 3,/ })).toHaveCount(0);
  const rowBox = await page.locator('.gameplay-dock .dice-row').boundingBox();
  const d1Box = await page.getByRole('button', { name: /^Die 1,/ }).boundingBox();
  const d2Box = await page.getByRole('button', { name: /^Die 2,/ }).boundingBox();
  expect(Math.abs((rowBox!.x + rowBox!.width / 2) - (d1Box!.x + (d2Box!.x + d2Box!.width - d1Box!.x) / 2))).toBeLessThan(2);

  const second = best(game)!;
  const handRow = page.getByRole('button', { name: new RegExp(`^${HANDS[second.hand].name} `) });
  await handRow.click();
  await expect(handRow).toHaveAttribute('aria-pressed', 'true');
  for (const dieId of second.dieIds) {
    await expect(page.getByRole('button', { name: new RegExp(`^Die ${dieId + 1},`) })).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeEnabled();
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
  await expect(page.getByRole('button', { name: /^Cursed Die, face/ })).toBeVisible();
  await expect(page.locator('.die.cursed-die')).toHaveCount(1);
  await expect(page.getByTestId('hexer-rule')).toHaveText('CURSE: Include the Cursed Die whenever you play a hand.');
  const dice = page.locator('.gameplay-dock .die');
  await expect(dice).toHaveCount(6);
  const boxes = await dice.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
  expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(2);
  expect(game.dice).toHaveLength(6);
});

test('Hexer face 7 renders seven pips without Mirror and remains selectable', async ({ page }) => {
  let game = await reachBossShop(page, 'hexer', 'boss-browser-33');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  game = dispatch(game, { type: 'NEXT_ROUND' }).state;
  await ready(page);
  const cursed = game.dice.find(die => die.owner === 'boss')!;
  expect(cursed.value).toBe(7);
  const button = page.getByRole('button', { name: /^Cursed Die, face 7,/ });
  await expect(button.locator('.pip-face')).toHaveAttribute('aria-label', 'Cursed Die showing 7');
  await expect(button.locator('.pip')).toHaveCount(7);
  await expect(button).not.toContainText('Mirror');
  await expect(button).toContainText('B+5');
  await expect(button).toContainText('Jackpot');
  await expect(button).toContainText('Sticky');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
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
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('main').getByText('FLAME SELECTION', { exact: true })).toBeVisible();
});
