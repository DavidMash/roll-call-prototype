import type { Page } from '@playwright/test';
import { RUN_STORAGE_KEY, RUN_STORAGE_VERSION } from '../src/game/persistence';
import type { GameState } from '../src/game/types';

export async function installRunState(page: Page, state: GameState, speed: 'normal' | 'fast' | 'instant' = 'instant') {
  await page.goto('/');
  await page.evaluate(([key, version, saved]) => localStorage.setItem(key, JSON.stringify({ version, state: saved }, (_key, value) => typeof value === 'bigint' ? value.toString() : value)),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, state] as const);
  await page.goto(`/?seed=${encodeURIComponent(state.seed)}&speed=${speed}`);
}

export async function enterRun(page: Page) {
  const title = page.getByRole('heading', { name: 'ROLL CALL', exact: true });
  if (!await title.count()) return;
  const continueButton = page.getByRole('button', { name: /^Continue Chapter / });
  if (await continueButton.count()) await continueButton.click();
  else {
    const newRun = page.getByRole('button', { name: 'NEW RUN', exact: true });
    if (await newRun.count()) await newRun.click();
    else await page.getByRole('button', { name: 'SKIP TUTORIAL', exact: true }).click();
  }
  await title.waitFor({ state: 'detached' });
}

export async function openGameMenu(page: Page) {
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  return page.getByRole('dialog', { name: 'Menu' });
}

export async function setPlaybackSpeed(page: Page, speed: 'NORMAL' | 'FAST' | 'INSTANT') {
  const menu = await openGameMenu(page);
  await menu.getByText(speed, { exact: true }).click();
  await page.keyboard.press('Escape');
}

export async function setDiceDisplay(page: Page, display: 'NUMERALS' | 'PIPS') {
  const menu = await openGameMenu(page);
  await menu.getByText(display, { exact: true }).click();
  await page.keyboard.press('Escape');
}

export async function openMenuItem(page: Page, item: 'Run Info' | 'How to Play') {
  const menu = await openGameMenu(page);
  await menu.getByRole('button', { name: item, exact: true }).click();
}

export async function goToShopStage(page: Page, stage: 'dice' | 'training' | 'fireKeeping') {
  let testId = stage === 'fireKeeping' ? 'shop-stage-fire-keeping' : `shop-stage-${stage}`;
  let target = page.getByTestId(testId);
  if (!await target.count() && stage === 'fireKeeping') {
    testId = 'shop-stage-training';
    target = page.getByTestId(testId);
  }
  if (!await target.count()) return;
  if (await target.getAttribute('data-active') !== 'true') await target.click();
  await page.waitForFunction(id => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-active') === 'true', testId);
}
