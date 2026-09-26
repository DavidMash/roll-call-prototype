import type { Page } from '@playwright/test';

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
