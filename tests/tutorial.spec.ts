import { expect, test } from '@playwright/test';
import { ONBOARDING_STORAGE_KEY, TUTORIAL_RUN_STORAGE_KEY } from '../src/tutorial/tutorialPersistence';
import { RUN_STORAGE_KEY } from '../src/game/persistence';
import { dispatchTutorial, newTutorialSession } from '../src/tutorial/scenario';
import type { Action, Flame, HandId, Rank } from '../src/game/types';
import type { TutorialSession } from '../src/tutorial/types';

test.beforeEach(async ({ page }) => {
  await page.goto('/?speed=instant');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

async function enterTutorial(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'PLAY TUTORIAL', exact: true }).click();
  const map = page.getByTestId('run-map-transition');
  await expect(map).toBeVisible();
  await map.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.driver-popover')).toBeVisible();
}

function act(session: TutorialSession, action: Action) {
  const result = dispatchTutorial(session, action);
  if (result.error) throw new Error(result.error);
  return result.session;
}

function shopOneSession() {
  let { session } = newTutorialSession();
  session = act(session, { type: 'MANUAL_REROLL', dieIds: [1] });
  session = act(session, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] });
  session = act(session, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] });
  session = act(session, { type: 'PLAY', hand: 'sixes', dieIds: [4] });
  session = act(session, { type: 'PLAY', hand: 'fives', dieIds: [3] });
  session = act(session, { type: 'PLAY', hand: 'smallStraight', dieIds: [0, 1, 2, 3] });
  session = act(session, { type: 'CONTINUE_ROUND_SUMMARY' });
  session.scenario.completedBeatIds.push('welcome', 'goal', 'scorecard', 'c1-r1-nice', 'c1-r1-pips-mult',
    'c1-r1-after-play', 'c1-r1-payout', 'c1-r1-payout-rerolls');
  return session;
}

async function resumeSession(page: import('@playwright/test').Page, session: TutorialSession) {
  await page.evaluate(([key, saved]) => localStorage.setItem(key, JSON.stringify({ version: 1, session: saved })),
    [TUTORIAL_RUN_STORAGE_KEY, session] as const);
  await page.reload();
  await page.getByRole('button', { name: 'CONTINUE TUTORIAL', exact: true }).click();
  await expect(page.locator('.driver-popover')).toBeVisible();
}

function chapterTwoSession(flame: Flame) {
  const { session } = newTutorialSession();
  const values: Rank[] = flame === 'straightShooter' ? [1, 2, 3, 4, 6] : [6, 6, 2, 4, 5];
  session.game.round = 7;
  session.game.phase = 'round';
  session.game.score = 0;
  session.game.target = 1000;
  session.game.consumed = [];
  session.game.boss = null;
  session.game.dice.forEach((die, index) => {
    die.value = values[index];
    die.flame = index === 0 ? { id: flame, investedGold: 0 } : null;
  });
  session.scenario.firstFlame = flame;
  session.scenario.firstFlameDieId = 0;
  session.scenario.completedBeatIds.push('chapter-2');
  return session;
}

function relativeLuminance(color: string): number {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  if (channels.length !== 3) throw new Error(`Unsupported color: ${color}`);
  const [red, green, blue] = channels.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(first: string, second: string): number {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

async function expectPopoverAndTargetSeparated(page: import('@playwright/test').Page, targetSelector: string) {
  await page.waitForTimeout(450);
  const target = page.locator(targetSelector);
  const popover = page.locator('.driver-popover');
  const [targetBox, popoverBox] = await Promise.all([target.boundingBox(), popover.boundingBox()]);
  expect(targetBox).not.toBeNull();
  expect(popoverBox).not.toBeNull();
  const horizontalOverlap = Math.max(0, Math.min(targetBox!.x + targetBox!.width, popoverBox!.x + popoverBox!.width)
    - Math.max(targetBox!.x, popoverBox!.x));
  const verticalOverlap = Math.max(0, Math.min(targetBox!.y + targetBox!.height, popoverBox!.y + popoverBox!.height)
    - Math.max(targetBox!.y, popoverBox!.y));
  expect(horizontalOverlap * verticalOverlap).toBe(0);
  const viewport = page.viewportSize()!;
  expect(popoverBox!.x).toBeGreaterThanOrEqual(0);
  expect(popoverBox!.y).toBeGreaterThanOrEqual(0);
  expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(viewport.width);
  expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(viewport.height);
}

test('onboarding prioritizes an isolated tutorial and resumes it after refresh', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'PLAY TUTORIAL', exact: true })).toBeVisible();
  await expect(page.getByText('Learn the basics in a guided run.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'SKIP TUTORIAL', exact: true })).toBeVisible();
  await expect(page.getByTestId('dice-dock')).toHaveCount(0);

  await enterTutorial(page);
  await expect(page.locator('.driver-popover')).toContainText('WELCOME TO ROLL CALL');
  await page.getByRole('button', { name: 'GOT IT', exact: true }).click();
  await expect(page.locator('.driver-popover')).toContainText('THE GOAL');
  expect(await page.evaluate(key => localStorage.getItem(key), TUTORIAL_RUN_STORAGE_KEY)).not.toBeNull();
  expect(await page.evaluate(key => localStorage.getItem(key), RUN_STORAGE_KEY)).toBeNull();

  await page.reload();
  await expect(page.getByRole('button', { name: 'CONTINUE TUTORIAL', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'CONTINUE TUTORIAL', exact: true }).click();
  await expect(page.locator('.driver-popover')).toContainText('THE GOAL');
});

test('tutorial acknowledgement action uses the high-contrast mint treatment and remains keyboard usable', async ({ page }) => {
  await enterTutorial(page);
  const action = page.getByRole('button', { name: 'GOT IT', exact: true });
  await expect(action).toBeFocused();
  const normal = await action.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color, outlineWidth: style.outlineWidth };
  });
  expect(normal.background).toBe('rgb(99, 230, 190)');
  expect(normal.color).toBe('rgb(20, 20, 20)');
  expect(contrastRatio(normal.background, normal.color)).toBeGreaterThanOrEqual(7);
  expect(Number.parseFloat(normal.outlineWidth)).toBeGreaterThanOrEqual(3);

  await action.hover();
  await expect.poll(() => action.evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe('rgb(150, 242, 215)');
  await action.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.driver-popover-title')).toHaveText('THE GOAL');
});

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 667 },
]) {
  test(`Goal tutorial precisely targets the visible score without overlap on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await enterTutorial(page);
    await page.getByRole('button', { name: 'GOT IT', exact: true }).click();
    await expect(page.locator('.driver-popover-title')).toHaveText('THE GOAL');
    const goal = page.locator('[data-tutorial="goal"]');
    await expect(goal).toHaveAttribute('data-testid', 'round-score-progress');
    await expect(goal).toHaveClass(/driver-active-element/);
    await expect(page.getByTestId('round-goal-progress')).not.toHaveAttribute('data-tutorial');
    await expect(page.locator('.driver-popover-arrow')).toBeVisible();
    if (viewport.name === 'desktop') {
      await expect(page.locator('.driver-popover-arrow')).toHaveClass(/driver-popover-arrow-side-right/);
    }
    await expectPopoverAndTargetSeparated(page, '[data-tutorial="goal"]');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('scorecard tutorial keeps its accented, unobscured spotlight', async ({ page }) => {
  await enterTutorial(page);
  await page.getByRole('button', { name: 'GOT IT', exact: true }).click();
  await page.getByRole('button', { name: 'GOT IT', exact: true }).click();
  await expect(page.locator('.driver-popover-title')).toHaveText('YOUR SCORECARD');
  const scorecard = page.locator('[data-tutorial="scorecard"]');
  await expect(scorecard).toHaveClass(/driver-active-element/);
  expect(await scorecard.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
  await expectPopoverAndTargetSeparated(page, '[data-tutorial="scorecard"]');
});

test('required reroll step advances only through the real game action', async ({ page }) => {
  await enterTutorial(page);
  for (const title of ['WELCOME TO ROLL CALL', 'THE GOAL', 'YOUR SCORECARD']) {
    await expect(page.locator('.driver-popover')).toContainText(title);
    await page.getByRole('button', { name: 'GOT IT', exact: true }).click();
  }
  await expect(page.locator('.driver-popover')).toContainText('SELECT THIS DIE');
  await expect(page.locator('.driver-popover').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Die 2, face 2,/ })).toBeFocused();
  await expect(page.getByRole('button', { name: /^Die 1, face 1,/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toHaveAttribute('tabindex', '-1');

  await page.getByRole('button', { name: /^Die 1, face 1,/ }).evaluate((element: HTMLButtonElement) => element.click());
  await expect(page.getByRole('button', { name: /^Die 1, face 1,/ })).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await expect(page.locator('.driver-popover')).toContainText('SELECT THIS DIE');
  await expect(page.getByText('Action unavailable')).toHaveCount(0);

  await page.getByRole('button', { name: /^Die 2, face 2,/ }).click();
  await expect(page.locator('.driver-popover')).toContainText('NOW REROLL IT');
  await expect(page.getByTestId('manual-reroll')).toBeFocused();
  await expect(page.getByRole('button', { name: /^Die 2, face 2,/ })).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('manual-reroll').click();
  await expect(page.locator('.driver-popover')).toContainText('NICE');
  await expect(page.getByRole('button', { name: /^Die 2, face 1,/ })).toBeVisible();
});

test('Three of a Kind uses separate highlights and gates PLAY until selection is ready', async ({ page }) => {
  await enterTutorial(page);
  for (let index = 0; index < 3; index++) await page.getByRole('button', { name: 'GOT IT', exact: true }).click();
  await page.getByRole('button', { name: /^Die 2, face 2,/ }).click();
  await page.getByTestId('manual-reroll').click();
  await page.getByRole('button', { name: 'GOT IT', exact: true }).click();
  await page.getByRole('button', { name: 'GOT IT', exact: true }).click();

  await expect(page.locator('.driver-popover-title')).toHaveText('THREE OF A KIND');
  const regions = page.getByTestId('tutorial-highlight-region');
  await expect(regions).toHaveCount(4);
  await expect(page.getByTestId('scorecard-row-threeKind')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('play-action')).toHaveAttribute('aria-disabled', 'true');
  const widths = await regions.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
  expect(Math.max(...widths)).toBeLessThan(page.viewportSize()!.width * 0.8);

  await page.getByTestId('scorecard-row-threeKind').click();
  await expect(page.locator('.driver-popover-title')).toHaveText('SCORING');
  await expect(page.getByTestId('play-action')).toBeFocused();
  await expect(page.getByTestId('play-action')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('scorecard-row-threeKind')).toHaveAttribute('aria-disabled', 'true');
});

test('Shop Training and Bonus placement expose only the current atomic action', async ({ page }) => {
  const session = shopOneSession();
  session.scenario.completedBeatIds.push('shop1-training');
  await resumeSession(page, session);

  const unrelatedTraining = page.locator('[data-tutorial^="training-"]:not([data-tutorial="training-fullHouse"]) .training-action').first();
  await expect(page.locator('[data-tutorial="training-fullHouse"] .training-action')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(unrelatedTraining).toHaveAttribute('aria-disabled', 'true');
  const goldBefore = await page.getByTestId('stat-gold').textContent();
  await unrelatedTraining.evaluate((element: HTMLButtonElement) => element.click());
  await expect(page.getByTestId('stat-gold')).toHaveText(goldBefore!);
  await page.locator('[data-tutorial="training-fullHouse"] .training-action').click();

  for (const title of ['FULL HOUSE · LV. 2', 'ENHANCEMENTS', 'BONUS']) {
    await expect(page.locator('.driver-popover')).toContainText(title);
    await page.getByRole('button', { name: 'GOT IT', exact: true }).click();
  }
  await expect(page.locator('.driver-popover-title')).toHaveText('BUY BONUS');
  await expect(page.locator('[data-tutorial="enhancement-bonus"] .offer-action')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-tutorial^="enhancement-"]:not([data-tutorial="enhancement-bonus"]) .offer-action').first()).toHaveAttribute('aria-disabled', 'true');
  await page.locator('[data-tutorial="enhancement-bonus"] .offer-action').click();
  await expect(page.locator('.driver-popover-title')).toHaveText('PLACE BONUS');
  await expect(page.locator('[data-tutorial="enhancement-bonus"] .offer-action')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-tutorial="die-2"] .die')).not.toHaveAttribute('aria-disabled', 'true');
  await page.locator('[data-tutorial="die-2"] .die').click();
  await expect(page.locator('.driver-popover')).toContainText('physical face');
});

test('Workout purchase and placement use separate guided targets', async ({ page }) => {
  const session = shopOneSession();
  session.game.round = 3;
  session.game.gold = 20;
  session.game.shop!.offers[0] = { ...session.game.shop!.offers[0], enhancement: 'workout', purchased: false };
  session.game.dice[0].value = 2;
  session.scenario.workoutDieId = 0;
  session.scenario.completedBeatIds.push('shop-r4-workout-info');
  await resumeSession(page, session);

  await expect(page.locator('.driver-popover-title')).toHaveText('BUY WORKOUT');
  await page.locator('[data-tutorial="enhancement-workout"] .offer-action').click();
  await expect(page.locator('.driver-popover-title')).toHaveText('PLACE WORKOUT');
  await expect(page.locator('[data-tutorial="die-1"] .die')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-tutorial="die-2"] .die')).toHaveAttribute('aria-disabled', 'true');
  await page.locator('[data-tutorial="die-1"] .die').click();
  await expect(page.locator('.driver-popover')).toHaveCount(0);
  await expect(page.locator('[data-tutorial="die-1"] .die')).not.toHaveAttribute('data-tutorial-gated');
});

test('first Stoke moves focus from the Flame cap into the modal controls', async ({ page }) => {
  const session = shopOneSession();
  session.game.round = 6;
  session.game.gold = 20;
  session.game.dice[0].flame = { id: 'doubleDown', investedGold: 0 };
  session.scenario.firstFlame = 'doubleDown';
  session.scenario.firstFlameDieId = 0;
  session.scenario.completedBeatIds.push('flame-basics', 'flame-xmult', 'flame-ember');
  await resumeSession(page, session);

  await expect(page.locator('[data-tutorial="flame-cap"]')).toBeFocused();
  await page.locator('[data-tutorial="flame-cap"]').click();
  await expect(page.locator('.driver-popover-title')).toHaveText('STOKE');
  const controls = page.getByTestId('stoke-flame-controls');
  await expect(controls.getByRole('button', { name: '+1', exact: true })).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Double Down' }).locator('button').first()).toHaveAttribute('aria-disabled', 'true');
  await controls.getByRole('button', { name: '+1', exact: true }).click();
  await expectPopoverAndTargetSeparated(page, '[data-tutorial="stoke"]');
  await controls.getByRole('button', { name: 'STOKE 1 GOLD', exact: true }).click();
  await expect(page.locator('.driver-popover')).toHaveCount(0);
  const close = page.getByRole('dialog', { name: 'Double Down' }).locator('button').first();
  await expect(close).not.toHaveAttribute('aria-disabled', 'true');
  await close.click();
  await expect(page.locator('.driver-popover-title')).toHaveText('BONFIRES');
});

for (const branch of [
  { flame: 'doubleDown' as const, setup: 'pair' as const, payoff: 'twoPair' as const },
  { flame: 'straightShooter' as const, setup: 'smallStraight' as const, payoff: 'largeStraight' as const },
  { flame: 'minigun' as const, setup: null, payoff: 'sixes' as const },
]) {
  test(`${branch.flame} Chapter 2 branch gates setup and payoff interactions`, async ({ page }) => {
    const session = chapterTwoSession(branch.flame);
    await resumeSession(page, session);
    const firstHand: HandId = branch.setup ?? branch.payoff;
    const firstRow = page.getByTestId(`scorecard-row-${firstHand}`);
    await expect(firstRow).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('[data-tutorial="die-1"] .die')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('[data-tutorial="die-3"] .die')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('tutorial-highlight-region')).toHaveCount(2);
    await firstRow.click();
    await expect(page.getByTestId('play-action')).toBeFocused();
    await expect(firstRow).toHaveAttribute('aria-disabled', 'true');

    if (branch.setup) {
      await page.getByTestId('play-action').click();
      const payoffRow = page.getByTestId(`scorecard-row-${branch.payoff}`);
      await expect(payoffRow).not.toHaveAttribute('aria-disabled', 'true');
      await expect(page.locator('[data-tutorial="die-1"] .die')).not.toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByTestId('play-action')).toHaveAttribute('aria-disabled', 'true');
    }
  });
}

test('normal runs never install tutorial interaction gating', async ({ page }) => {
  await page.getByRole('button', { name: 'SKIP TUTORIAL', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open menu', exact: true })).not.toHaveAttribute('data-tutorial-gated');
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
});

test('normal and tutorial saves coexist and Skip Tutorial does not complete onboarding', async ({ page }) => {
  await enterTutorial(page);
  for (let index = 0; index < 3; index++) await page.getByRole('button', { name: 'GOT IT', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'CONTINUE TUTORIAL', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'SKIP TUTORIAL', exact: true }).click();
  await expect(page.getByTestId('dice-dock')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), TUTORIAL_RUN_STORAGE_KEY)).not.toBeNull();
  expect(await page.evaluate(key => localStorage.getItem(key), RUN_STORAGE_KEY)).not.toBeNull();
  const metadata = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).metadata, ONBOARDING_STORAGE_KEY);
  expect(metadata.tutorialCompleted).toBe(false);
});

test('a split required step safely resumes from authoritative state after refresh', async ({ page }) => {
  await enterTutorial(page);
  for (let index = 0; index < 3; index++) await page.getByRole('button', { name: 'GOT IT', exact: true }).click();
  await page.getByRole('button', { name: /^Die 2, face 2,/ }).click();
  await expect(page.locator('.driver-popover-title')).toHaveText('NOW REROLL IT');
  await page.reload();
  await page.getByRole('button', { name: 'CONTINUE TUTORIAL', exact: true }).click();
  await expect(page.locator('.driver-popover-title')).toHaveText('SELECT THIS DIE');
  await expect(page.getByRole('button', { name: /^Die 2, face 2,/ })).toBeFocused();
});

test('a disappearing required target releases the gate and skips the impossible requirement', async ({ page }) => {
  await enterTutorial(page);
  for (let index = 0; index < 3; index++) await page.getByRole('button', { name: 'GOT IT', exact: true }).click();
  await page.locator('[data-tutorial="die-2"] .die').evaluate(element => element.remove());
  await expect(page.locator('.driver-popover-title')).toHaveText('NICE');
  await expect(page.getByRole('button', { name: 'Open menu', exact: true })).not.toHaveAttribute('data-tutorial-gated');
});

test('tutorial overlay remains within a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await enterTutorial(page);
  const box = await page.locator('.driver-popover').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  for (let index = 0; index < 3; index++) await page.getByRole('button', { name: 'GOT IT', exact: true }).click();
  await expect(page.locator('.driver-popover-title')).toHaveText('SELECT THIS DIE');
  await expectPopoverAndTargetSeparated(page, '[data-tutorial="die-2"] .die');
  await page.locator('[data-tutorial="die-2"] .die').click();
  await expect(page.locator('.driver-popover-title')).toHaveText('NOW REROLL IT');
  await expect(page.getByTestId('tutorial-highlight-region')).toHaveCount(2);
  await expectPopoverAndTargetSeparated(page, '[data-tutorial="reroll-button"]');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
