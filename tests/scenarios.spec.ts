import { expect, test } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { scenarioById } from '../src/game/scenarios';
import { createInfernoEvaluation } from '../src/game/engulfment';
import { Resolver } from '../src/game/effects';
import { seedRunSession } from './uiHelpers';
import type { GameState } from '../src/game/types';
import type { RunHistoryV2Event } from '../src/game/runHistoryV2';

function scenarioDeal(state: GameState) {
  const flame = state.flameSlots.find(item => item !== null)!;
  for (let round = 1; round <= 3; round++) {
    state.historyV2.push({ kind: 'hand_scored', seq: state.nextHistorySeq++, round, attempt: 1,
      actionId: state.nextActionId++, timelineId: state.historyV2TimelineId, scorePackageId: `scenario:${round}`,
      rootPlayId: `scenario:${round}`, parentPlayId: null, hand: 'ones', level: 1, playSource: 'manual',
      selectedDice: [0], scoringDice: [], scoreOccurrences: [{ id: `score:${round}`, rootId: `score:${round}`,
        dieId: 0, cause: 'play_selection', originallySelected: true, playerSelected: true, additional: false,
        suppressedEffects: [] }], consumed: true, score: { infernoMultiplier: 1n, finalPips: 100, handMult: 1,
        finalMult: 1, finalXMult: 15, bossFactor: 1, raw: '1500', awarded: 1500n,
        rounding: { mode: 'nearest_integer', delta: '0' } }, roundScore: { before: 0n, afterAward: 1500n, after: 1500n },
      pipsContributions: [], resolvedDicePips: [], multContributions: [], xMultContributions: [{ sourceId: flame.type,
        origin: flame.stage, factor: 15, sourceInstanceId: flame.instanceId }], sideEffects: [] } as unknown as RunHistoryV2Event);
    state.historyV2.push({ kind: 'round_attempt_finished', seq: state.nextHistorySeq++, round, attempt: 1,
      actionId: state.nextActionId++, timelineId: state.historyV2TimelineId, outcome: 'cleared', score: 1500n,
      target: 1n, boss: null, livesBefore: 3, livesAfter: 3 } as RunHistoryV2Event);
  }
  return createInfernoEvaluation(state)!;
}

test.describe('Scenarios mode', () => {
  test('browses the revised catalog and launches Extra Die with six authoritative roster dice', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 760 });
    await page.goto('/?speed=instant');
    await page.getByRole('button', { name: 'SCENARIOS', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'SCENARIOS', exact: true })).toBeVisible();
    await expect(page.locator('[data-testid^="scenario-card-"]')).toHaveCount(6);
    await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
    const scenarioPage = page.locator('.scenario-page-container');
    await expect.poll(() => scenarioPage.evaluate(element => ({
      vertical: element.scrollHeight > element.clientHeight,
      horizontal: element.scrollWidth > element.clientWidth,
    }))).toEqual({ vertical: true, horizontal: false });

    await expect(page.getByText('Loneliest Number')).toHaveCount(0);
    await expect(page.getByText('Chicken Salesman')).toHaveCount(0);
    await page.getByRole('button', { name: 'View Extra Die! Scenario' }).click();
    await expect(page.getByRole('heading', { name: 'Reach Engulfment' })).toBeVisible();
    await expect.poll(() => scenarioPage.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await scenarioPage.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.getByRole('button', { name: 'Start Extra Die!' })).toBeVisible();
    await expect(page.locator('.scenario-loadout-die')).toHaveCount(6);
    await expect(page.getByText('No starting Flames.')).toBeVisible();
    await page.getByRole('button', { name: /Inspect starting die 1/ }).click();
    const details = page.getByTestId('die-details-modal');
    await expect(details).toContainText('Basic');
    await expect(details).not.toContainText('Clockwork');
    await expect(details).not.toContainText('Bonus');
    await details.getByRole('button', { name: 'Close', exact: true }).click();

    await page.getByRole('button', { name: 'Start Extra Die!' }).click();
    await expect(page.getByTestId('stat-round')).toHaveAttribute('aria-label', 'Scenario Round 1');
    await expect(page.getByTestId('current-round-target')).toHaveText('TARGET2,000');
    await expect(page.getByTestId('round-goal-progress'))
      .toHaveAttribute('aria-valuetext', /2,000 points toward the Goal/);
    await expect(page.getByTestId('dice-dock').locator('.dice-row')).toHaveAttribute('data-dice-count', '6');
    await expect(page.getByTestId('stat-gold')).toHaveAttribute('aria-label', 'Gold 0');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByTestId('scorecard-row-threePair')).toBeVisible();
    await expect(page.getByTestId('scorecard-row-wideStraight')).toBeVisible();
  });

  test('keeps multi-effect dice intact and presents canonical Bribery details', async ({ page }) => {
    await page.goto('/?speed=instant');
    await page.getByRole('button', { name: 'SCENARIOS', exact: true }).click();
    await page.getByRole('button', { name: 'View Popcorn Scenario' }).click();
    await expect(page.locator('.scenario-loadout-die')).toHaveCount(5);
    await expect(page.locator('.scenario-loadout-die').first()).toContainText('Jumping Bean');
    await expect(page.locator('.scenario-loadout-die').first()).toContainText('Chameleon');
    await expect(page.locator('.scenario-loadout-die').first()).toContainText('Weighted');
    await page.getByRole('button', { name: 'BACK TO SCENARIOS' }).click();
    await page.getByRole('button', { name: 'View Money Bags Scenario' }).click();
    await expect(page.getByText('Bribery', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: /Inspect Bribery/ }).click();
    await expect(page.getByTestId('flame-details-modal')).toContainText('The first Bribe each Round costs 5 Gold');
    await expect(page.getByTestId('flame-details-modal')).toContainText('Added per Bribe: +1.6 XMult');
    await page.getByTestId('flame-details-modal').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Start Money Bags' }).click();
    const bribe = page.getByTestId('flame-action-bribery-direct');
    await expect(bribe).toHaveText('BRIBE 5G');
    await bribe.click();
    await expect(bribe).toHaveText('BRIBE 10G');
    await bribe.click();
    await expect(page.getByTestId('stat-gold')).toHaveAttribute('aria-label', 'Gold 0');
    await expect(bribe).toHaveText('BRIBE 15G');
    await expect(bribe).toBeDisabled();
    await expect(page.getByText('×4.2 ARMED · NEXT MANUAL PLAY')).toBeVisible();
  });

  test('persists terminal completion immediately without opening an Inferno Reward', async ({ page }) => {
    const state = newRun('scenario-complete-browser', { next: () => .5 }, { scenario: scenarioById('short-circuit')! }).state;
    const evaluation = scenarioDeal(state);
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
    await expect(page.getByTestId('inferno-reward-screen')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'CONTINUE RUN', exact: true })).toHaveCount(0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('roll-call:scenario-progress') ?? '{}'));
    expect(stored.completions['short-circuit']).toMatchObject({ completed: true, scenarioVersion: 1, completionCount: 1 });
    await page.reload();
    await page.getByRole('button', { name: 'SCENARIOS', exact: true }).click();
    await page.getByRole('button', { name: 'CONTINUE', exact: true }).click();
    await expect(page.getByTestId('scenario-complete-screen')).toContainText("You've completed Short Circuit.");
    await page.getByRole('button', { name: 'BACK TO SCENARIOS', exact: true }).click();
    await expect(page.getByTestId('scenario-card-short-circuit').getByLabel('Completed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'CONTINUE', exact: true })).toHaveCount(0);
  });

  test('House Rules renders the expanded five-die scorecard in canonical positions', async ({ page }) => {
    await page.goto('/?speed=instant');
    await page.getByRole('button', { name: 'SCENARIOS', exact: true }).click();
    await page.getByRole('button', { name: 'View House Rules Scenario' }).click();
    await expect(page.locator('.scenario-loadout-die')).toHaveCount(5);
    await expect(page.getByText('No starting Flames.')).toBeVisible();
    await page.getByRole('button', { name: /Inspect starting die 1/ }).click();
    await expect(page.getByTestId('die-details-modal')).toContainText('Basic');
    await page.getByTestId('die-details-modal').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Start House Rules' }).click();
    await expect(page.getByTestId('current-round-target')).toHaveText('TARGET2,000');
    await expect(page.getByTestId('round-goal-progress'))
      .toHaveAttribute('aria-valuetext', /2,000 points toward the Goal/);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByTestId('scorecard-row-odds')).toBeVisible();
    await expect(page.getByTestId('dice-dock').locator('.dice-row')).toHaveAttribute('data-dice-count', '5');
    await expect(page.getByTestId('stat-gold')).toHaveAttribute('aria-label', 'Gold 0');
    const upper = await page.locator('#scorecard-upper').locator('..').locator('[data-testid^="scorecard-row-"]')
      .evaluateAll(rows => rows.map(row => row.getAttribute('data-testid')));
    expect(upper).toEqual(['scorecard-row-ones', 'scorecard-row-twos', 'scorecard-row-threes', 'scorecard-row-fours',
      'scorecard-row-fives', 'scorecard-row-sixes', 'scorecard-row-odds', 'scorecard-row-evens', 'scorecard-row-chance']);
    const lower = await page.locator('#scorecard-lower').locator('..').locator('[data-testid^="scorecard-row-"]')
      .evaluateAll(rows => rows.map(row => row.getAttribute('data-testid')));
    expect(lower).toEqual(['scorecard-row-pair', 'scorecard-row-twoPair', 'scorecard-row-miniStraight',
      'scorecard-row-threeKind', 'scorecard-row-oddStraight', 'scorecard-row-evenStraight',
      'scorecard-row-smallStraight', 'scorecard-row-fullHouse', 'scorecard-row-fourKind',
      'scorecard-row-largeStraight', 'scorecard-row-fiveKind']);
  });
});
