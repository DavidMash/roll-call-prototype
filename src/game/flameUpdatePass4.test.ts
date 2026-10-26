import { describe, expect, it } from 'vitest';
import { Resolver } from './effects';
import { dispatch, newRun, normalizeGameState } from './engine';
import { FLAME_IDS, placeFlameInstance, progressiveSequenceMultiplier, PROGRESSIVE_FLAME_SEQUENCES } from './flames';
import { HAND_IDS } from './hands';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { compactGameStateForPersistence, RUN_STORAGE_VERSION } from './persistence';
import { summarizeRunHistoryV2 } from './runHistoryV2Summary';
import { createDieEffect } from './specialDice';
import type { Flame, GameState, HandId, RandomSource, Rank } from './types';
import type { RunHistoryV2Event } from './runHistoryV2';

const constant = (value = .8): RandomSource => ({ next: () => value });

function game(flame: Flame): GameState {
  const state = newRun(`pass-4-${flame}`, constant()).state;
  state.target = 10n ** 30n;
  state.stats.rounds.at(-1)!.target = state.target;
  placeFlameInstance(state, flame, 100);
  return state;
}

function faces(state: GameState, values: Rank[]): number[] {
  const dice = rosterDice(state);
  values.forEach((value, index) => { dice[index].value = value; });
  syncActiveDiceProjection(state);
  return values.map((_, index) => dice[index].id);
}

function lastFactor(state: GameState, flame: Flame): number | undefined {
  return state.stats.handScores.at(-1)?.xMultFactors.find(factor => factor.source === flame)?.value;
}

const TOP_PLAYS: Array<[HandId, Rank[]]> = [
  ['fiveKind', [5, 5, 5, 5, 5]], ['largeStraight', [1, 2, 3, 4, 5]],
  ['fourKind', [4, 4, 4, 4]], ['fullHouse', [3, 3, 3, 2, 2]],
  ['smallStraight', [1, 2, 3, 4]], ['threeKind', [3, 3, 3]],
  ['twoPair', [2, 2, 1, 1]], ['pair', [1, 1]],
];

describe('Flame Update Pass 4 catalog and curves', () => {
  it('adds exactly Top Down and Count Down with centralized step rewards', () => {
    expect(FLAME_IDS).toEqual(expect.arrayContaining(['topDown', 'countDown']));
    expect(PROGRESSIVE_FLAME_SEQUENCES.topDown.hands).toEqual(TOP_PLAYS.map(([hand]) => hand));
    expect(PROGRESSIVE_FLAME_SEQUENCES.countDown.hands).toEqual(['sixes', 'fives', 'fours', 'threes', 'twos', 'ones']);
    expect(PROGRESSIVE_FLAME_SEQUENCES.topDown.bonfireFactors).toEqual([3, 4, 5, 6, 7, 8, 10, 12]);
    expect(PROGRESSIVE_FLAME_SEQUENCES.countDown.bonfireFactors).toEqual([1.5, 2, 2.5, 3, 3.5, 4.5]);
    expect(PROGRESSIVE_FLAME_SEQUENCES.topDown.bonfireFactors.map((_, index) =>
      progressiveSequenceMultiplier('topDown', 100, index))).toEqual([3, 4, 5, 6, 7, 8, 10, 12]);
  });
});

describe('Top Down', () => {
  it('advances once through the exact sequence and applies ×3 through ×12', () => {
    const state = game('topDown');
    const resolver = new Resolver(state, constant());
    const factors: number[] = [];
    for (const [hand, values] of TOP_PLAYS) {
      resolver.play(hand, faces(state, values));
      factors.push(lastFactor(state, 'topDown')!);
    }
    expect(factors).toEqual([3, 4, 5, 6, 7, 8, 10, 12]);
    expect(state.progressiveFlames.topDown).toBe(8);
  });

  it('ignores unrelated and early future Hands, then resets only a completed sequence on refresh', () => {
    const state = game('topDown');
    const resolver = new Resolver(state, constant());
    resolver.play('pair', faces(state, [2, 2]));
    resolver.play('ones', faces(state, [1]));
    expect(state.progressiveFlames.topDown).toBe(0);

    state.progressiveFlames.topDown = 7;
    state.consumed = HAND_IDS.filter(hand => hand !== 'pair');
    state.scorecardCycleConsumed = [...state.consumed];
    const refreshed = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: faces(state, [2, 2]) }, constant()).state;
    expect(refreshed.scorecardCycleConsumed).toEqual([]);
    expect(refreshed.progressiveFlames.topDown).toBe(0);
    expect(refreshed.historyV2).toContainEqual(expect.objectContaining({ kind: 'flame_sequence', flame: 'topDown',
      resetReason: 'scorecard_refresh' }));

    refreshed.progressiveFlames.topDown = 3;
    refreshed.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    refreshed.scorecardCycleConsumed = [...refreshed.consumed];
    const incomplete = dispatch(refreshed, { type: 'PLAY', hand: 'ones', dieIds: faces(refreshed, [1]) }, constant()).state;
    expect(incomplete.progressiveFlames.topDown).toBe(3);
  });
});

describe('Count Down', () => {
  it('accepts matching Upper Free Plays and advances exactly once per Play', () => {
    const state = game('countDown');
    const resolver = new Resolver(state, constant());
    const factors: number[] = [];
    for (const [index, hand] of PROGRESSIVE_FLAME_SEQUENCES.countDown.hands.entries()) {
      const rank = (6 - index) as Rank;
      resolver.play(hand, faces(state, [rank]), index === 2 ? 'jumpingBean' : 'manual');
      factors.push(lastFactor(state, 'countDown')!);
    }
    expect(factors).toEqual([1.5, 2, 2.5, 3, 3.5, 4.5]);
    expect(state.progressiveFlames.countDown).toBe(6);
    expect(state.historyV2.filter(event => event.kind === 'flame_sequence'
      && event.flame === 'countDown' && event.advanced)).toHaveLength(6);
  });

  it('does not double-advance for Double Time and resets a completed cycle on canonical refresh', () => {
    const state = game('countDown');
    const die = rosterDice(state)[0];
    die.effects = [createDieEffect(die.id, 'doubleTime', 8)];
    syncActiveDiceProjection(state);
    new Resolver(state, constant(.99)).play('sixes', faces(state, [6]));
    expect(state.progressiveFlames.countDown).toBe(1);

    state.progressiveFlames.countDown = 5;
    state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    state.scorecardCycleConsumed = [...state.consumed];
    const refreshed = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: faces(state, [1]) }, constant()).state;
    expect(refreshed.progressiveFlames.countDown).toBe(0);
  });

  it('persists progress, resets on Round/retry, and does not reset from Marathon cooldown state', () => {
    const state = game('countDown');
    state.progressiveFlames.countDown = 4;
    const restored = normalizeGameState(compactGameStateForPersistence(state));
    expect(restored.progressiveFlames.countDown).toBe(4);
    restored.progressiveFlames.countDown = 6;
    restored.boss = { type: 'marathon', cooldowns: { sixes: 1 } };
    new Resolver(restored, constant()).play('ones', faces(restored, [1]));
    expect(restored.progressiveFlames.countDown).toBe(6);
    restored.phase = 'shop';
    restored.shop = { stage: 'shop', offers: [], offerRerolls: 0, lifeRestores: 0 };
    new Resolver(restored, constant()).startRound();
    expect(restored.progressiveFlames.countDown).toBe(0);
    expect(RUN_STORAGE_VERSION).toBeGreaterThanOrEqual(26);
  });
});

describe('Hot Streak lifecycle consistency', () => {
  it('reopens only a completed chain after canonical refresh and preserves incomplete progress', () => {
    const completed = game('hotStreak');
    completed.hotStreakGoal = null;
    completed.hotStreakCharges = 8;
    completed.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    completed.scorecardCycleConsumed = [...completed.consumed];
    const reset = dispatch(completed, { type: 'PLAY', hand: 'ones', dieIds: faces(completed, [1]) }, constant()).state;
    expect(reset.hotStreakGoal).toBe('pair');
    expect(reset.hotStreakCharges).toBe(0);

    reset.hotStreakGoal = 'fullHouse';
    reset.hotStreakCharges = 3;
    reset.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    reset.scorecardCycleConsumed = [...reset.consumed];
    const preserved = dispatch(reset, { type: 'PLAY', hand: 'ones', dieIds: faces(reset, [1]) }, constant()).state;
    expect(preserved.hotStreakGoal).toBe('fullHouse');
    expect(preserved.hotStreakCharges).toBe(3);
  });
});

describe('Flame balance summary telemetry', () => {
  it('reduces ownership, factors, Charge loss, streaks, wagers, and sequence completion', () => {
    const base = { actionId: 1, round: 1, attempt: 1, timelineId: 0, nodeId: 'r1', seq: 1 };
    const events = [
      { ...base, kind: 'round_attempt_started', chapter: 1, chapterRound: 1, retry: false,
        target: { baseGoal: 100n, bossMultiplier: 1, finalGoal: 100n }, boss: null, lives: 3, dice: [],
        flames: [{ instanceId: 1, type: 'minigun', investedGold: 100, stage: 'bonfire' },
          { instanceId: 2, type: 'lightningStrike', investedGold: 100, stage: 'bonfire' }] },
      { ...base, seq: 2, kind: 'flame_changed', change: { type: 'activated', flame: 'minigun', instanceId: 1,
        slot: 0, origin: 'ember', factor: 3, diagnostics: { upperStreak: 4 } } },
      { ...base, seq: 3, kind: 'flame_charge_generated', flame: 'lightningStrike', requested: 3, gained: 1,
        lostToCap: 2, before: 4, after: 5 },
      { ...base, seq: 4, kind: 'flame_action', flame: 'lightningStrike', action: { type: 'lightning_strike',
        dieId: 1, predictedFace: 6, actualFace: 6, hit: true, manualRerollSource: 'normal', chargeGained: 1 } },
      { ...base, seq: 5, kind: 'flame_sequence', flame: 'topDown', stepIndex: 7, requiredHandBefore: 'pair',
        playedHand: 'pair', advanced: true, factorApplied: 12, newRequiredHand: null, completed: true, playSource: 'manual' },
      { ...base, seq: 6, kind: 'double_or_nothing', phase: 'accepted', packageId: 'p1', hand: 'pair',
        packageScore: 50n, factor: 9, roundScore: 0n, target: 100n, scoreRemoved: 50n },
      { ...base, seq: 7, kind: 'all_in', phase: 'resolved', hand: 'pair', packageId: 'p2', factor: 12,
        packageScore: 40n, prePackageRoundScore: 0n, temporaryRoundScore: 40n, success: false, scoreRemoved: 40n },
    ] as unknown as RunHistoryV2Event[];
    const metrics = summarizeRunHistoryV2(events).experienced.flames;
    expect(metrics.minigun).toMatchObject({ activations: 1, roundsOwned: 1, activeRounds: 1,
      averageActivationsPerActiveRound: 1, maximumActivationsInOneRound: 1, averageAppliedFactor: 3,
      diagnostics: expect.objectContaining({ maxStreak: 4 }) });
    expect(metrics.lightningStrike).toMatchObject({ chargeRequested: 3, chargeGained: 1, chargeLostToCap: 2,
      diagnostics: expect.objectContaining({ lightningHits: 1, lightningMisses: 0 }) });
    expect(metrics.topDown?.diagnostics).toMatchObject({ sequenceAdvances: 1, sequenceCompletions: 1,
      maxSequenceProgress: 8 });
    expect(metrics.doubleOrNothing?.diagnostics.doubleOrNothingScoreSacrificed).toBe(50n);
    expect(metrics.allIn?.diagnostics).toMatchObject({ allInFailures: 1, allInScoreRemoved: 40n });
  });
});
