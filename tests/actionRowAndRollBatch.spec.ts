import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dispatch, newRun } from '../src/game/engine';
import { RUN_STORAGE_KEY, RUN_STORAGE_VERSION } from '../src/game/persistence';
import type { GameState } from '../src/game/types';
import { enterRun } from './uiHelpers';

async function installRun(page: Page, state: GameState, speed: 'normal' | 'fast' | 'instant' = 'instant') {
  await page.goto(`/?seed=${state.seed}&speed=${speed}`);
  await page.evaluate(([key, version, saved]) => localStorage.setItem(key, JSON.stringify({ version, state: saved })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, state] as const);
  await page.reload();
  await page.locator('main').waitFor();
  await enterRun(page);
}

const die = (page: Page, id: number) => page.locator(`.die-slot[data-die-id="${id}"] .die`);

async function actionGeometry(page: Page) {
  return page.getByTestId('run-action-row').evaluate(element => {
    const row = element.getBoundingClientRect();
    const left = element.querySelector<HTMLElement>('.run-action-left')!.getBoundingClientRect();
    const right = element.querySelector<HTMLElement>('.run-action-right')!.getBoundingClientRect();
    return { rowLeft: row.left, rowRight: row.right, left: left.left, leftRight: left.right, right: right.left, rightRight: right.right };
  });
}

async function roundButtonGeometry(page: Page) {
  return page.getByTestId('run-action-row').evaluate(element => {
    const bounds = (selector: string) => {
      const box = element.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return { x: box.x, width: box.width };
    };
    return { reroll: bounds('.reroll-action'), play: bounds('.play-action') };
  });
}

test('shared action row keeps manipulation left and progression right on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const round = newRun('shared-action-row-round').state;
  await installRun(page, round);

  const roundLayout = await actionGeometry(page);
  expect(roundLayout.left - roundLayout.rowLeft).toBeLessThan(12);
  expect(roundLayout.rowRight - roundLayout.rightRight).toBeLessThan(12);
  expect(roundLayout.leftRight).toBeLessThanOrEqual(roundLayout.right);
  await expect(page.getByTestId('manual-reroll')).toBeDisabled();
  await expect(page.getByTestId('play-action')).toBeDisabled();

  const emptySelection = await roundButtonGeometry(page);
  await die(page, 0).click();
  await expect(page.getByTestId('manual-reroll').locator('.reroll-action-main')).toHaveText('REROLL');
  await expect(page.getByTestId('manual-reroll').locator('.reroll-action-resource')).toHaveText('1 DIE · 3 LEFT');
  const oneSelected = await roundButtonGeometry(page);
  for (const id of [1, 2, 3, 4]) await die(page, id).click();
  await expect(page.getByTestId('manual-reroll').locator('.reroll-action-resource')).toHaveText('5 DICE · 3 LEFT');
  const fiveSelected = await roundButtonGeometry(page);
  for (const geometry of [oneSelected, fiveSelected]) {
    expect(geometry.reroll.x).toBeCloseTo(emptySelection.reroll.x, 5);
    expect(geometry.reroll.width).toBeCloseTo(emptySelection.reroll.width, 5);
    expect(geometry.play.x).toBeCloseTo(emptySelection.play.x, 5);
    expect(geometry.play.width).toBeCloseTo(emptySelection.play.width, 5);
  }

  const shop = structuredClone(round);
  shop.phase = 'shop';
  shop.gold = 100;
  shop.shop = { kind: 'between_rounds', offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
  await installRun(page, shop);

  const row = page.getByTestId('run-action-row');
  await expect(page.getByTestId('shop-dice-controls')).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'REROLL ALL DICE FOR 2 GOLD', exact: true })).toHaveCount(1);
  await expect(row.getByRole('button', { name: 'NEXT ROUND', exact: true })).toBeVisible();
  const shopLayout = await actionGeometry(page);
  expect(shopLayout.left - shopLayout.rowLeft).toBeLessThan(12);
  expect(shopLayout.rowRight - shopLayout.rightRight).toBeLessThan(12);
  expect(shopLayout.leftRight).toBeLessThanOrEqual(shopLayout.right);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  shop.shop.kind = 'post_boss';
  await installRun(page, shop);
  await expect(row.getByRole('button', { name: 'NEXT CHAPTER', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'NEXT ROUND', exact: true })).toHaveCount(0);
  expect((await actionGeometry(page)).rowRight - (await actionGeometry(page)).rightRight).toBeLessThan(12);
});

for (const speed of ['normal', 'fast'] as const) {
  test(`${speed} multi-die reroll starts one simultaneous visual batch and settles together`, async ({ page }) => {
    const state = newRun(`simultaneous-${speed}`).state;
    await installRun(page, state, speed);
    const ids = [0, 2, 4];
    for (const id of ids) await die(page, id).click();
    const expected = dispatch(state, { type: 'MANUAL_REROLL', dieIds: ids }).state;
    await page.getByTestId('manual-reroll').click();

    await expect.poll(async () => page.locator('.die.rolling').evaluateAll(elements => elements.map(element =>
      Number(element.closest<HTMLElement>('.die-slot')!.dataset.dieId)))).toEqual(ids);
    const timing = await page.locator('.die.rolling').evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element);
      return [style.animationDelay, style.animationDuration];
    }));
    expect(new Set(timing.map(value => value.join('|'))).size).toBe(1);

    await expect(page.locator('.die.rolling')).toHaveCount(0);
    for (const id of ids) await expect(die(page, id)).toHaveAccessibleName(new RegExp(`^Die ${id + 1}, face ${expected.dice[id].value},`));
  });
}

test('Shop reroll-all batches all five dice and preserves price escalation', async ({ page }) => {
  const state = newRun('simultaneous-shop-reroll').state;
  state.phase = 'shop';
  state.gold = 100;
  state.shop = { kind: 'between_rounds', offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
  await installRun(page, state, 'normal');

  await page.getByTestId('shop-dice-reroll').click();
  await expect.poll(async () => page.locator('.die.rolling').count()).toBe(5);
  await expect(page.locator('.die.rolling')).toHaveCount(0);
  await expect(page.getByTestId('shop-dice-reroll')).toHaveAccessibleName('REROLL ALL DICE FOR 4 GOLD');
  await expect(page.getByTestId('stat-gold')).toContainText('98');
  await expect(page.getByTestId('shop-dice-controls')).toHaveCount(0);
});
