import { expect, test } from '@playwright/test';
import { createInfernoEvaluation, infernoEvaluationDuration } from '../src/game/engulfment';
import { newRun } from '../src/game/engine';
import type { GameState } from '../src/game/types';
import { enterRun, installRunState } from './uiHelpers';
import { RUN_STORAGE_KEY } from '../src/game/persistence';
import { placeFlameInstance } from '../src/game/flames';

const REVEAL_PAUSE_MS = 180;

function infernoState(seed: string, success: boolean): GameState {
  const state = newRun(seed).state;
  placeFlameInstance(state, 'vineyard');
  const evaluation = createInfernoEvaluation(state)!;
  if (success) {
    evaluation.success = true;
    evaluation.effectiveValue = 25;
    evaluation.readiness = 1;
    evaluation.previousReadiness = .62;
    evaluation.suspendAfterContinue = false;
    evaluation.currentCollectionTheoreticallySufficient = true;
    evaluation.feedbackMessage = null;
    evaluation.feedbackMessageId = null;
    evaluation.flamesSnuffed = [structuredClone(evaluation.flames[0].asset)];
    evaluation.flamesPreserved = [];
    evaluation.selectedEffectiveValue = 25;
    evaluation.consumedFinalFlame = true;
    evaluation.infernoLevelAfter = 1;
    evaluation.infernoMultiplierAfter = 25n;
  } else {
    evaluation.previousReadiness = .41;
  }
  state.phase = 'inferno';
  state.infernoEvaluation = evaluation;
  state.infernoProgress.previousReadiness = evaluation.readiness;
  return state;
}

async function storedState(page: import('@playwright/test').Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, RUN_STORAGE_KEY);
}

for (const speed of ['normal', 'fast', 'instant'] as const) {
  test(`failed Inferno uses fixed timing and waits for CONTINUE at ${speed}`, async ({ page }) => {
    const state = infernoState(`inferno-failure-${speed}`, false);
    await installRunState(page, state, speed);
    const now = new Date('2026-10-14T12:00:00Z');
    await page.clock.install({ time: now });
    await page.clock.pauseAt(now);
    await enterRun(page);

    const duration = infernoEvaluationDuration(state.infernoEvaluation!.effectiveValue);
    await expect(page.getByTestId('inferno-evaluation')).toBeVisible();
    await expect(page.getByTestId('inferno-meter-fill')).toHaveAttribute('data-start-percent', '41');
    await expect(page.getByTestId('inferno-meter-fill')).toHaveAttribute('data-end-percent', '4');
    await page.clock.runFor(Math.floor(duration / 2));
    await expect(page.getByTestId('inferno-feedback')).toHaveCount(0);
    await page.clock.runFor(Math.ceil(duration / 2) + REVEAL_PAUSE_MS);
    const feedback = page.getByTestId('inferno-feedback');
    await expect(feedback).toBeVisible();
    await expect(feedback.getByRole('button', { name: 'CONTINUE', exact: true })).toBeVisible();
    await page.clock.runFor(60_000);
    await expect(feedback).toBeVisible();
    await feedback.getByRole('button', { name: 'CONTINUE', exact: true }).click();
    await expect(feedback).toHaveCount(0);
    expect((await storedState(page)).infernoProgress.previousReadiness).toBe(.04);
  });

  test(`ready Inferno waits for an explicit decision at ${speed}`, async ({ page }) => {
    const state = infernoState(`inferno-success-${speed}`, true);
    await installRunState(page, state, speed);
    const now = new Date('2026-10-14T12:00:00Z');
    await page.clock.install({ time: now });
    await page.clock.pauseAt(now);
    await enterRun(page);

    const duration = infernoEvaluationDuration(state.infernoEvaluation!.effectiveValue);
    await expect(page.getByTestId('inferno-meter-fill')).toHaveAttribute('data-start-percent', '62');
    await expect(page.getByTestId('inferno-meter-fill')).toHaveAttribute('data-end-percent', '100');
    await page.clock.runFor(Math.floor(duration / 2));
    await expect(page.getByTestId('inferno-ready')).toHaveCount(0);
    await page.clock.runFor(Math.ceil(duration / 2) + REVEAL_PAUSE_MS);
    const ready = page.getByTestId('inferno-ready');
    await expect(ready).toBeVisible();
    await expect(ready.getByRole('heading', { name: 'INFERNO I IS READY', exact: true })).toBeVisible();
    await expect(ready).toContainText('Inferno ×1 → ×25');
    await expect(ready.getByText('Vineyard', { exact: true })).toBeVisible();
    await expect(ready.getByText(/EMBER · SLOT 1 · 0 \/ 100 GOLD/)).toBeVisible();
    await expect(ready).toContainText('Successful Engulfment: +25 Temper');
    await expect(ready.getByRole('button', { name: 'ENGULF NOW', exact: true })).toBeVisible();
    await expect(ready.getByRole('button', { name: 'NOT YET', exact: true })).toBeVisible();
    const before = await storedState(page);
    expect(before.engulfmentLevel).toBe(0);
    expect(before.flameSlots[0].type).toBe('vineyard');
    await ready.getByRole('button', { name: 'NOT YET', exact: true }).click();
    await page.clock.runFor(10_000);
    await expect(ready).toHaveCount(0);
    const deferred = await storedState(page);
    expect(deferred.engulfmentLevel).toBe(0);
    expect(deferred.flameSlots[0].type).toBe('vineyard');
    expect(deferred.infernoProgress.previousReadiness).toBe(1);
  });
}

test('ENGULF NOW resolves the exact displayed offering and resets the persistent meter', async ({ page }) => {
  const state = infernoState('inferno-engulf-now', true);
  state.handLevels.ones = 7;
  await installRunState(page, state, 'instant');
  const now = new Date('2026-10-14T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  await enterRun(page);
  await page.clock.runFor(infernoEvaluationDuration(25) + REVEAL_PAUSE_MS);
  const ready = page.getByTestId('inferno-ready');
  await ready.getByRole('button', { name: 'ENGULF NOW', exact: true }).click();
  const resolved = page.getByTestId('engulfment-success');
  await expect(resolved).toBeVisible();
  await expect(resolved).toContainText('Vineyard · SNUFFED');
  await expect(resolved).toContainText('+25 TEMPER');
  await expect.poll(async () => (await storedState(page)).engulfmentLevel).toBe(1);
  const stored = await storedState(page);
  expect(stored.engulfmentLevel).toBe(1);
  expect(stored.flameSlots[0]).toBeNull();
  expect(stored.infernoProgress.previousReadiness).toBe(0);
  expect(stored.infernoEvaluation.engulfed).toBe(true);
});
