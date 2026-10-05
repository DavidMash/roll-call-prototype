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
