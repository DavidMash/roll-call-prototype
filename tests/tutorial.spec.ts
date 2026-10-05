import { expect, test } from '@playwright/test';
import { ONBOARDING_STORAGE_KEY, TUTORIAL_RUN_STORAGE_KEY } from '../src/tutorial/tutorialPersistence';
import { RUN_STORAGE_KEY } from '../src/game/persistence';

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
  await expect(page.locator('.driver-popover')).toContainText("LET'S IMPROVE THIS ROLL");
  await expect(page.locator('.driver-popover').getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: /^Die 2, face 2,/ }).click();
  await page.getByTestId('manual-reroll').click();
  await expect(page.locator('.driver-popover')).toContainText('NICE');
  await expect(page.getByRole('button', { name: /^Die 2, face 1,/ })).toBeVisible();
});

test('normal and tutorial saves coexist and Skip Tutorial does not complete onboarding', async ({ page }) => {
  await enterTutorial(page);
  for (let index = 0; index < 3; index++) await page.getByRole('button', { name: 'GOT IT', exact: true }).click();
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Return to Title', exact: true }).click();
  await expect(page.getByRole('button', { name: 'CONTINUE TUTORIAL', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'SKIP TUTORIAL', exact: true }).click();
  await expect(page.getByTestId('dice-dock')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), TUTORIAL_RUN_STORAGE_KEY)).not.toBeNull();
  expect(await page.evaluate(key => localStorage.getItem(key), RUN_STORAGE_KEY)).not.toBeNull();
  const metadata = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).metadata, ONBOARDING_STORAGE_KEY);
  expect(metadata.tutorialCompleted).toBe(false);
});

test('tutorial overlay remains within a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await enterTutorial(page);
  const box = await page.locator('.driver-popover').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
