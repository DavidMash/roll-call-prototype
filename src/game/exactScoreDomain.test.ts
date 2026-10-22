import { describe, expect, it } from 'vitest';
import { wardenUnlockCosts, wardenUnlockTarget } from './bosses';
import { dispatch, newRun, normalizeGameState } from './engine';
import { initialHandLevels } from './hands';
import { RUN_STORAGE_KEY, RUN_STORAGE_VERSION, loadPersistedRun, savePersistedRun } from './persistence';
import { captureRollbackState, restoreRollbackState } from './rollback';
import { exportRunHistoryV2 } from './runHistoryV2Export';
import { summarizeRunHistoryV2 } from './runHistoryV2Summary';
import { infernoMultiplier } from './scoring';
import { roundScoreToStep, stringifyExactJson, toExactJsonValue } from './scoreMath';
import type { GameState, RandomSource } from './types';
import type { HandScoredEvent, RunHistoryV2Event } from './runHistoryV2';

const constant: RandomSource = { next: () => .99 };
const HUGE_GOAL = 59_604_644_775_390_625n;

function historyHand(seq: number, hand: 'ones' | 'twos', awarded: bigint, before: bigint): HandScoredEvent {
  return { seq, kind: 'hand_scored', round: 1, attempt: 1, actionId: seq, timelineId: 0,
    hand, level: 1, playSource: 'manual', selectedDice: [0], scoringDice: [], scoreOccurrences: [], consumed: true,
    score: { infernoMultiplier: 1n, basePips: 1, finalPips: 1, baseMult: 1, finalMult: 1,
      finalXMult: 1, bossFactor: 1, raw: awarded.toString(), awarded, rounding: { mode: 'nearest_integer', delta: '0' } },
    roundScore: { before, afterAward: before + awarded, after: before + awarded },
    pipsContributions: [], multContributions: [], xMultContributions: [], sideEffects: [] };
}

function scoringBoundary(scoreBefore: bigint): GameState {
  const state = newRun(`exact-boundary-${scoreBefore}`, constant).state;
  state.target = HUGE_GOAL;
  state.score = scoreBefore;
  state.stats.rounds[0].target = HUGE_GOAL;
  state.stats.rounds[0].finalScore = scoreBefore;
  state.dice[0].value = 1;
  return state;
}

describe('exact score gameplay boundaries', () => {
  it('distinguishes Goal - 1, Goal, and Goal + 1 far above MAX_SAFE_INTEGER', () => {
    const below = dispatch(scoringBoundary(HUGE_GOAL - 9n), { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant).state;
    expect(below.score).toBe(HUGE_GOAL - 1n);
    expect(below.phase).toBe('round');

    const equal = dispatch(scoringBoundary(HUGE_GOAL - 8n), { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant).state;
    expect(equal.score).toBe(HUGE_GOAL);
    expect(equal.phase).toBe('roundSummary');
    expect(equal.stats.rounds[0]).toMatchObject({ firstCrossedScore: HUGE_GOAL, finalScore: HUGE_GOAL, clearMargin: 0n });

    const above = dispatch(scoringBoundary(HUGE_GOAL - 7n), { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant).state;
    expect(above.score).toBe(HUGE_GOAL + 1n);
    expect(above.phase).toBe('roundSummary');
    expect(above.stats.rounds[0].clearMargin).toBe(1n);
  });

  it('records an exact huge Bust score and shortfall before rollback', () => {
    const state = scoringBoundary(HUGE_GOAL - 9n);
    state.manualRerollsRemaining = 0;
    state.specialOfferEffects.carePackageRerolls = 0;
    state.consumed = Object.keys(state.handLevels).filter(hand => hand !== 'ones') as (keyof typeof state.handLevels)[];
    state.scorecardCycleConsumed = [];
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant).state;
    expect(result.bust).toMatchObject({ score: HUGE_GOAL - 1n, target: HUGE_GOAL, shortfall: 1n });
  });

  it('halves an odd huge Caller score with exact positive Math.round semantics', () => {
    const initial = 9_007_199_254_740_993n;
    const state = scoringBoundary(initial);
    state.target = 10n ** 40n;
    state.stats.rounds[0].target = state.target;
    state.boss = { type: 'caller', calledHand: 'twos', playsRemaining: 1, satisfied: false,
      satisfyingSource: null, callsCompleted: 0, callsMissed: 0, manualHandsPlayed: 2, callDeadline: 3 };
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant).state;
    expect(result.score).toBe((initial + 8n + 1n) / 2n);
  });

});

describe('exact score state, Warden, and attribution', () => {
  it('keeps Warden target addition and nearest-five behavior exact at huge scores', () => {
    const levels = initialHandLevels();
    const current = HUGE_GOAL + 3n;
    const cost = wardenUnlockCosts(levels, [], 10n ** 40n)[0];
    expect(wardenUnlockTarget(current, levels, [], 1)).toBe(roundScoreToStep(current + cost, 5n));
    expect(wardenUnlockCosts(levels, [], 10n ** 40n)).toEqual([10n, 25n, 85n, 205n]);
  });

  it('round-trips exact rollback state without number coercion', () => {
    const state = scoringBoundary(HUGE_GOAL - 1n);
    state.scoreByHand.ones = HUGE_GOAL - 2n;
    state.effectScore = 1n;
    const rollback = captureRollbackState(state);
    state.score = 0n; state.target = 1n; state.scoreByHand = {}; state.effectScore = 0n;
    restoreRollbackState(state, rollback);
    expect(state.score).toBe(HUGE_GOAL - 1n);
    expect(state.target).toBe(HUGE_GOAL);
    expect(state.scoreByHand.ones).toBe(HUGE_GOAL - 2n);
    expect(state.effectScore).toBe(1n);
  });

  it('does not collapse history maxima or totals that differ by one above MAX_SAFE_INTEGER', () => {
    const lower = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    const higher = lower + 1n;
    const events: RunHistoryV2Event[] = [historyHand(0, 'ones', lower, 0n), historyHand(1, 'twos', higher, lower),
      { seq: 2, kind: 'round_attempt_finished', round: 1, attempt: 1, actionId: 2, timelineId: 0,
        outcome: 'cleared', score: lower + higher, target: 1n, boss: null, livesBefore: 3, livesAfter: 3 }];
    const summary = summarizeRunHistoryV2(events);
    expect(summary.experienced.largestHand).toMatchObject({ hand: 'twos', score: higher });
    expect(summary.experienced.highestRoundScore).toBe(lower + higher);
    expect(summary.experienced.scoreByHand).toEqual({ ones: lower, twos: higher });
    expect(summary.experienced.largestHandShare.samples).toBe(1);
  });
});

describe('exact score persistence and structured history', () => {
  const storage = () => {
    const values = new Map<string, string>();
    return { values, getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
  };

  it('persists exact score-domain integers as strings and restores them as bigint', () => {
    const state = scoringBoundary(HUGE_GOAL - 1n);
    state.engulfmentLevel = 12;
    state.scoreByHand.ones = HUGE_GOAL - 2n;
    state.stats.scoreBySource.hand = HUGE_GOAL - 1n;
    state.boss = { type: 'warden', encounterDieIds: [0, 1, 2, 3, 4], activeDieIds: [0], startingDieId: 0, nextUnlockTarget: HUGE_GOAL,
      unlockCosts: [HUGE_GOAL], unlockTargets: [HUGE_GOAL], pendingReinforcements: 0 };
    const store = storage();
    expect(savePersistedRun(store, state)).toBe(true);
    const raw = store.values.get(RUN_STORAGE_KEY)!;
    expect(raw).toContain('"score":"59604644775390624"');
    expect(raw).toContain('"target":"59604644775390625"');
    expect(raw).not.toContain('"target":59604644775390625');
    const loaded = loadPersistedRun(store, state.seed)!;
    expect(loaded.score).toBe(HUGE_GOAL - 1n);
    expect(loaded.target).toBe(HUGE_GOAL);
    expect(loaded.boss?.type === 'warden' ? loaded.boss.nextUnlockTarget : null).toBe(HUGE_GOAL);
    expect(infernoMultiplier(loaded.engulfmentLevel)).toBe(HUGE_GOAL);
  });

  it('exports structured history with strings while retaining exact runtime integers', () => {
    const state = scoringBoundary(HUGE_GOAL - 8n);
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant).state;
    const runtime = result.historyV2.find(event => event.kind === 'hand_scored');
    expect(runtime?.kind === 'hand_scored' ? runtime.roundScore.after : null).toBe(HUGE_GOAL);
    const exported = exportRunHistoryV2(result);
    const hand = exported.events.find(event => event.kind === 'hand_scored') as unknown as {
      score: { awarded: string }; roundScore: { before: string; after: string };
    };
    expect(hand.score.awarded).toBe('8');
    expect(hand.roundScore).toEqual({ before: (HUGE_GOAL - 8n).toString(), afterAward: HUGE_GOAL.toString(), after: HUGE_GOAL.toString() });
    expect(stringifyExactJson(exported)).toContain(`"after":"${HUGE_GOAL}"`);
  });

  it('normalizes safe numbers exactly, preserves unsafe score approximations, and recomputes unsafe current Goals', () => {
    const state = newRun('legacy-exact-migration', constant).state;
    state.round = 200;
    const legacy = toExactJsonValue(state) as unknown as Record<string, unknown>;
    legacy.score = Number('59604644775390625');
    legacy.target = Number('59604644775390625');
    legacy.effectScore = 42;
    const store = storage();
    store.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: RUN_STORAGE_VERSION, state: legacy }));
    const loaded = loadPersistedRun(store, state.seed)!;
    expect(loaded.score).toBe(59_604_644_775_390_620n);
    expect(loaded.effectScore).toBe(42n);
    expect(loaded.target).not.toBe(59_604_644_775_390_620n);
    expect(typeof loaded.target).toBe('bigint');
  });

  it('normalizes exact decimal strings at every active-state boundary', () => {
    const state = toExactJsonValue(scoringBoundary(HUGE_GOAL - 1n)) as unknown as GameState;
    const normalized = normalizeGameState(state);
    expect(normalized.score).toBe(HUGE_GOAL - 1n);
    expect(normalized.target).toBe(HUGE_GOAL);
  });

  it('re-derives recognizable legacy Inferno powers instead of preserving their lost low digits', () => {
    const state = newRun('legacy-inferno-history', constant).state;
    const legacyInferno = Number('59604644775390625');
    state.stats.handScores.push({ round: 1, hand: 'ones', handLevel: 1, infernoMultiplier: legacyInferno as unknown as bigint,
      dieIds: [0], basePips: 1, baseMultiplier: 1, pips: 1, multiplier: 1, xMult: 1, bossFactor: 1,
      xMultFactors: [], rawScore: '1', score: 1n, bonusPips: 0, hitchhikerPips: 0,
      playSource: 'manual', consumedHand: true });
    const hand = historyHand(1, 'ones', 1n, 0n);
    hand.score.infernoMultiplier = legacyInferno as unknown as bigint;
    state.historyV2.push(hand);
    const normalized = normalizeGameState(state);
    expect(normalized.stats.handScores[0].infernoMultiplier).toBe(HUGE_GOAL);
    const historicalHand = normalized.historyV2.find(event => event.kind === 'hand_scored');
    expect(historicalHand?.kind === 'hand_scored'
      ? historicalHand.score.infernoMultiplier : null).toBe(HUGE_GOAL);
  });
});
