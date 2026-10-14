import { expect, test } from '@playwright/test';
import { createInfernoEvaluation, infernoEvaluationDuration } from '../src/game/engulfment';
import { newRun } from '../src/game/engine';
import type { GameState } from '../src/game/types';
import { enterRun, installRunState } from './uiHelpers';

const REVEAL_PAUSE_MS = 180;

function infernoState(seed: string, success: boolean): GameState {
  const state = newRun(seed).state;
  state.dice[0].flame = { id: 'vineyard', investedGold: 0 };
  state.flameInstanceIds = { vineyard: 1 };
  const evaluation = createInfernoEvaluation(state)!;
  if (success) {
    evaluation.success = true;
    evaluation.effectiveValue = 20;
    evaluation.readiness = 1;
    evaluation.suspendAfterContinue = false;
    evaluation.currentCollectionTheoreticallySufficient = true;
    evaluation.feedbackMessage = null;
    evaluation.feedbackMessageId = null;
  }
  state.phase = 'inferno';
  state.infernoEvaluation = evaluation;
  return state;
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
  });

  test(`successful Inferno uses the same fixed ceremony timing at ${speed}`, async ({ page }) => {
    const state = infernoState(`inferno-success-${speed}`, true);
    await installRunState(page, state, speed);
    const now = new Date('2026-10-14T12:00:00Z');
    await page.clock.install({ time: now });
    await page.clock.pauseAt(now);
    await enterRun(page);

    const duration = infernoEvaluationDuration(state.infernoEvaluation!.effectiveValue);
    await page.clock.runFor(Math.floor(duration / 2));
    await expect(page.getByTestId('engulfment-success')).toHaveCount(0);
    await page.clock.runFor(Math.ceil(duration / 2) + REVEAL_PAUSE_MS);
    await expect(page.getByTestId('engulfment-success')).toBeVisible();
  });
}
