import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { activeFace } from '../src/game/dice';
import { newRun } from '../src/game/engine';
import { RUN_STORAGE_KEY, RUN_STORAGE_VERSION } from '../src/game/persistence';
import type { GameState, Rank } from '../src/game/types';
import { enterRun } from './uiHelpers';

function selectionState(seed: string, values: Rank[]): GameState {
  const state = newRun(seed, { next: () => 0 }).state;
  state.target = 1_000_000;
  state.stats.rounds[0].target = state.target;
  state.dice.forEach((die, index) => { die.value = values[index]; });
  return state;
}

async function install(page: Page, state: GameState) {
  await page.goto(`/?seed=${state.seed}&speed=instant`);
  await page.evaluate(([key, version, saved]) => localStorage.setItem(key, JSON.stringify({ version, state: saved })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, state] as const);
  await page.reload();
  await enterRun(page);
}

const selectedDieIds = (page: Page) => page.locator('.die[aria-pressed="true"]').evaluateAll(elements => elements
  .map(element => Number(element.closest<HTMLElement>('[data-die-id]')?.dataset.dieId))
  .sort((a, b) => a - b));

test('scorecard availability comes from the board and switching hands replaces hand-owned dice', async ({ page }) => {
  await install(page, selectionState('board-availability-ui', [1, 2, 3, 4, 4]));
  const straight = page.getByTestId('scorecard-row-smallStraight');
  const pair = page.getByTestId('scorecard-row-pair');

  await straight.click();
  await expect(straight).toHaveAttribute('aria-pressed', 'true');
  await expect(pair).toBeEnabled();
  await expect(pair).toHaveAttribute('data-state', 'playable');
  expect(await selectedDieIds(page)).toEqual([0, 1, 2, 3]);

  await pair.click();
  await expect(pair).toHaveAttribute('aria-pressed', 'true');
  await expect(straight).toBeEnabled();
  await expect(straight).toHaveAttribute('data-state', 'playable');
  expect(await selectedDieIds(page)).toEqual([3, 4]);
});

test('repeated hand clicks cycle deterministic physical combinations, update preview, then deselect', async ({ page }) => {
  const state = selectionState('pair-cycle-ui', [4, 4, 4, 2, 6]);
  activeFace(state.dice[1]).enhancements.bonus = 1;
  await install(page, state);
  const pair = page.getByTestId('scorecard-row-pair');

  await pair.click();
  expect(await selectedDieIds(page)).toEqual([0, 1]);
  const firstPreview = await page.getByRole('button', { name: /Play Pair for/ }).getAttribute('aria-label');

  await pair.click();
  expect(await selectedDieIds(page)).toEqual([1, 2]);
  await pair.click();
  expect(await selectedDieIds(page)).toEqual([0, 2]);
  const finalPreview = await page.getByRole('button', { name: /Play Pair for/ }).getAttribute('aria-label');
  expect(firstPreview).not.toBe(finalPreview);

  await pair.click();
  await expect(pair).toHaveAttribute('aria-pressed', 'false');
  expect(await selectedDieIds(page)).toEqual([]);
});
