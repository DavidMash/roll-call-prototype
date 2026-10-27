import { expect, test } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { scenarioById } from '../src/game/scenarios';
import { createInfernoEvaluation } from '../src/game/engulfment';
import { Resolver } from '../src/game/effects';
import { seedRunSession } from './uiHelpers';

test.describe('Scenarios mode', () => {
  test('browses loadouts, inspects canonical details, and launches a one-die Scenario', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 760 });
    await page.goto('/?speed=instant');
    await page.getByRole('button', { name: 'SCENARIOS', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'SCENARIOS', exact: true })).toBeVisible();
    await expect(page.locator('[data-testid^="scenario-card-"]')).toHaveCount(6);
    await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');

    await page.getByRole('button', { name: 'View Loneliest Number Scenario' }).click();
    await expect(page.getByRole('heading', { name: 'Reach Engulfment' })).toBeVisible();
    await expect(page.locator('.scenario-loadout-die')).toHaveCount(1);
    await page.getByRole('button', { name: /Inspect starting die 1/ }).click();
    const details = page.getByTestId('die-details-modal');
    await expect(details).toContainText('Lone Wolf');
    await expect(details).toContainText('Clockwork');
    await expect(details).toContainText('Flywheel');
    await details.getByRole('button', { name: 'Close', exact: true }).click();

    await page.getByRole('button', { name: 'Start Loneliest Number' }).click();
    await expect(page.getByTestId('stat-round')).toHaveAttribute('aria-label', 'Scenario Round 1');
    await expect(page.getByTestId('dice-dock').locator('.dice-row')).toHaveAttribute('data-dice-count', '1');
    await expect(page.getByTestId('stat-gold')).toHaveAttribute('aria-label', 'Gold 10');
  });

  test('keeps multi-effect dice intact and reports the unavailable Bribery request', async ({ page }) => {
    await page.goto('/?speed=instant');
    await page.getByRole('button', { name: 'SCENARIOS', exact: true }).click();
    await page.getByRole('button', { name: 'View Popcorn Scenario' }).click();
    await expect(page.locator('.scenario-loadout-die')).toHaveCount(5);
    await expect(page.locator('.scenario-loadout-die').first()).toContainText('Jumping Bean');
    await expect(page.locator('.scenario-loadout-die').first()).toContainText('Chameleon');
    await expect(page.locator('.scenario-loadout-die').first()).toContainText('Weighted');
    await page.getByRole('button', { name: 'BACK TO SCENARIOS' }).click();
    await page.getByRole('button', { name: 'View Money Bags Scenario' }).click();
    await expect(page.getByText(/Bribery is not present in the current canonical Flame registry/)).toBeVisible();
  });

  test('persists completion immediately and continues the same run after the one-time screen', async ({ page }) => {
    const state = newRun('scenario-complete-browser', { next: () => .5 }, { scenario: scenarioById('short-circuit')! }).state;
    const evaluation = createInfernoEvaluation(state)!;
    evaluation.success = true;
    evaluation.flamesSnuffed = [];
    evaluation.flamesPreserved = [];
    evaluation.infernoLevelAfter = 1;
    evaluation.infernoMultiplierAfter = 25n;
    state.infernoEvaluation = evaluation;
    state.phase = 'inferno';
    const resolver = new Resolver(state, { next: () => .5 });
    resolver.engulfNow();
    resolver.continueInfernoEvaluation();
    await page.goto('/?speed=instant');
    await seedRunSession(page, state, 'scenario');
    await page.reload();
    await page.getByRole('button', { name: 'SCENARIOS', exact: true }).click();
    await page.getByRole('button', { name: 'CONTINUE', exact: true }).click();
    await expect(page.getByTestId('scenario-complete-screen')).toContainText("You've completed Short Circuit.");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('roll-call:scenario-progress') ?? '{}'));
    expect(stored.completions['short-circuit']).toMatchObject({ completed: true, scenarioVersion: 1, completionCount: 1 });
    await page.getByRole('button', { name: 'BACK TO SCENARIOS', exact: true }).click();
    await expect(page.getByTestId('scenario-card-short-circuit').getByLabel('Completed')).toBeVisible();
    await page.getByRole('button', { name: 'CONTINUE', exact: true }).click();
    await expect(page.getByTestId('scenario-complete-screen')).toHaveCount(0);
    await expect(page.getByText('SHOP', { exact: true }).first()).toBeVisible();
  });
});
