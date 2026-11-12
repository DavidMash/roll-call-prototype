import { expect, test } from '@playwright/test';
import { createDieEffect } from '../src/game/specialDice';
import { createInfernoEvaluation } from '../src/game/engulfment';
import { enterRun, installRunState, readRunState } from './uiHelpers';
import { readyInfernoDeal } from './infernoFixtures';

async function storedState(page: import('@playwright/test').Page) {
  return (await readRunState(page))!;
}

for (const speed of ['normal', 'fast', 'instant'] as const) {
  test(`frozen Inferno Deal waits for TAKE THE DEAL or NOT YET at ${speed}`, async ({ page }) => {
    const state = readyInfernoDeal(`inferno-deal-${speed}`);
    const frozen = structuredClone(state.infernoEvaluation!);
    await installRunState(page, state, speed);
    await enterRun(page);
    const deal = page.getByTestId('inferno-deal');
    await expect(deal).toBeVisible();
    await expect(deal.getByRole('heading', { name: 'TAKE THE DEAL?', exact: true })).toBeVisible();
    await expect(deal).toContainText('Vineyard');
    await expect(deal).toContainText('Inferno ×1 → ×20');
    await expect(deal).toContainText('CHOOSE 1 INFERNO REWARDS');
    await expect(deal.getByRole('button', { name: 'TAKE THE DEAL', exact: true })).toBeVisible();
    await expect(deal.getByRole('button', { name: 'NOT YET', exact: true })).toBeVisible();
    await expect(deal).not.toContainText('Interest');
    await expect(deal).not.toContainText('Tier');
    await expect(deal).not.toContainText('Power Rating');
    await page.reload();
    await enterRun(page);
    expect((await storedState(page)).infernoEvaluation).toEqual(frozen);
    await page.getByRole('button', { name: 'NOT YET', exact: true }).click();
    const deferred = await storedState(page);
    expect(deferred.flameSlots[0]?.type).toBe('vineyard');
    expect(deferred.infernoEvaluation).toBeNull();
    expect(createInfernoEvaluation(deferred)).toBeNull();
  });
}

test('TAKE THE DEAL resolves the exact frozen Flame and die request', async ({ page }) => {
  const state = readyInfernoDeal('inferno-take-deal', 24);
  const die = state.diceInventory.instances[1];
  die.effects = [createDieEffect(die.id, 'magnetic', 2)];
  state.infernoEvaluation = createInfernoEvaluation(state)!;
  const requestedDieId = state.infernoEvaluation.requestedDieId!;
  const requestedSlot = state.diceInventory.roster.indexOf(requestedDieId);
  await installRunState(page, state, 'instant');
  await enterRun(page);
  const deal = page.getByTestId('inferno-deal');
  await expect(deal.getByTestId(`requested-die-${requestedDieId}`)).toContainText('Magnetic II');
  await deal.getByRole('button', { name: 'TAKE THE DEAL', exact: true }).click();
  const resolved = page.getByTestId('engulfment-success');
  await expect(resolved).toBeVisible();
  await expect(resolved).toContainText('Vineyard · GIVEN');
  const stored = await storedState(page);
  expect(stored.flameSlots[0]).toBeNull();
  expect(stored.diceInventory.instances[requestedDieId]).toBeUndefined();
  const replacementId = stored.diceInventory.roster[requestedSlot]!;
  expect(stored.diceInventory.instances[replacementId].effects.map(effect => [effect.type, effect.level]))
    .toEqual([['basic', 1]]);
});

test('Inferno Deal remains usable on a small screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await installRunState(page, readyInfernoDeal('inferno-mobile'), 'instant');
  await enterRun(page);
  const deal = page.getByTestId('inferno-deal');
  await expect(deal).toBeVisible();
  await expect(deal.getByRole('button', { name: 'TAKE THE DEAL' })).toBeVisible();
  await expect(deal.getByRole('button', { name: 'NOT YET' })).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
});
