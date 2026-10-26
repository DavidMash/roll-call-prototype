import { expect, test } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { placeFlameInstance } from '../src/game/flames';
import { enterRun, installRunState } from './uiHelpers';

const constant = { next: () => .8 };

test('Top Down and Count Down show compact, readable progression at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const state = newRun('flame-pass-4-ui', constant).state;
  placeFlameInstance(state, 'topDown', 100);
  placeFlameInstance(state, 'countDown', 100);
  state.progressiveFlames.topDown = 3;
  state.progressiveFlames.countDown = 3;
  await installRunState(page, state);
  await enterRun(page);

  await expect(page.getByTestId('topDown-progress')).toContainText('Next: Full House · 3/8');
  await expect(page.getByTestId('countDown-progress')).toContainText('Next: Threes · 3/6');
  await expect(page.getByRole('button', { name: /Full House.*Top Down next Hand/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Threes.*Count Down next Hand/ })).toBeVisible();

  await page.getByTestId('active-flame-1').click();
  await expect(page.getByTestId('flame-details-modal')).toContainText('Next: Full House · 3/8 · ×6');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
