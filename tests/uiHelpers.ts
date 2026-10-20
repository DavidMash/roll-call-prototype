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
  const active = async (testId: string) => {
    const target = page.getByTestId(testId);
    return await target.count() > 0 && (await target.getAttribute('data-active')) === 'true';
  };
  const waitForActive = (testId: string) => page.getByTestId(testId).waitFor({ state: 'visible' })
    .then(() => page.waitForFunction(id => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-active') === 'true', testId));
  if (stage === 'dice') {
    if (await active('shop-stage-fire-keeping')) {
      await page.getByTestId('shop-stage-back').click();
      await waitForActive('shop-stage-training');
    }
    if (await active('shop-stage-training')) {
      await page.getByTestId('shop-stage-back').click();
      await waitForActive('shop-stage-dice');
    }
    return;
  }
  if (await active('shop-stage-dice')) {
    await page.getByTestId('shop-stage-continue').click();
    await waitForActive('shop-stage-training');
  }
  if (stage === 'fireKeeping' && await active('shop-stage-training')) {
    // Shops without Flames end at Training, so there is no Fire Keeping step to enter.
    if (!await page.getByTestId('shop-stage-fire-keeping').count()) return;
    await page.getByTestId('shop-stage-continue').click();
    await waitForActive('shop-stage-fire-keeping');
  }
}
