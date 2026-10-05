import type { Page } from '@playwright/test';

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
