import { describe, expect, it } from 'vitest';
import { scorecardCycleRelevantHands } from './bosses';
import { dispatch, newRun } from './engine';
import {
  ENGULFMENT_EVIDENCE_ROUNDS, ENGULFMENT_REQUIRED_MULTIPLIER, createInfernoEvaluation,
  evaluateEngulfmentOffering, ownedEngulfmentAssets, selectedOfferingFactor,
} from './engulfment';
import { Resolver } from './effects';
import {
  FLAME_SCALING, PROGRESSIVE_FLAME_SEQUENCES, assemblyLineMultiplier, benchWarmerMultiplier,
  blackHoleMultiplier, calculateMaxCharge, fatCatMultiplier, frankensteinMultiplier,
  gymBrosMultiplier, handFamilyFlameMultiplier, minigunMultiplier, oneShortMultiplier,
  placeFlameInstance, punchCardMultiplier, vineyardMultiplier,
} from './flames';
import type { GameState, HandId, RandomSource } from './types';
import { scorecardHandAnnotations } from './scorecardAnnotations';
import { summarizeRunHistoryV2 } from './runHistoryV2Summary';

const constant: RandomSource = { next: () => .99 };

function buildReadyOffering(): { state: GameState; cleanId: number; ultimateId: number; preservedId: number } {
  let state = newRun('selected-engulfment', constant).state;
  const clean = placeFlameInstance(state, 'cleanSweep', 100);
  const ultimate = placeFlameInstance(state, 'ultimate', 100, 1);
  const preserved = placeFlameInstance(state, 'momentum', 100, 2);
  state.dice.forEach(die => { die.value = 2; });
  const finalHand: HandId = 'fiveKind';
  state.consumed = scorecardCycleRelevantHands(state).filter(hand => hand !== finalHand);
  state.scorecardCycleConsumed = [...state.consumed];
  state.target = 1n;
  state.stats.rounds.at(-1)!.target = 1n;
  state = dispatch(state, { type: 'PLAY', hand: finalHand, dieIds: [0, 1, 2, 3, 4] }, constant).state;
  return { state, cleanId: clean.instanceId, ultimateId: ultimate.instanceId, preservedId: preserved.instanceId };
}

describe('Flame and Engulfment systems update', () => {
  it('uses the centralized direct-XMult rebalance and Count Down curve', () => {
    expect(minigunMultiplier(100, FLAME_SCALING.minigun.cappedStreak)).toBe(5);
    expect(handFamilyFlameMultiplier('doubleDown', 100)).toBe(7);
    expect(oneShortMultiplier(100)).toBe(6);
    expect(fatCatMultiplier(100, 5)).toBe(3);
    expect(vineyardMultiplier(100, 5)).toBe(3.5);
    expect(frankensteinMultiplier(100)).toBe(5);
    expect(benchWarmerMultiplier(100)).toBe(6);
    expect(punchCardMultiplier(100)).toBe(4);
    expect(blackHoleMultiplier(100, 4)).toBe(7);
    expect(assemblyLineMultiplier(100, 5)).toBe(3.5);
    expect(gymBrosMultiplier(100, 5)).toBe(3.5);
    expect(PROGRESSIVE_FLAME_SEQUENCES.countDown.bonfireFactors).toEqual([2, 3, 4, 6, 8, 12]);
  });

  it('uses pair-synergy Max Charge at partial and Bonfire investment', () => {
    const state = newRun('charge-cap-synergy', constant).state;
    placeFlameInstance(state, 'momentum', 75);
    placeFlameInstance(state, 'thirdRail', 75, 1);
    placeFlameInstance(state, 'jumpStart', 75, 2);
    expect(calculateMaxCharge(state)).toBe(15.0625);
    state.flameSlots[0]!.investedGold = 100;
    state.flameSlots[1]!.investedGold = 100;
    state.flameSlots[2]!.investedGold = 100;
    expect(calculateMaxCharge(state)).toBe(22);
  });

  it('records authoritative multiplicative Charge ordering and carries it into consumption replay', () => {
    let state = newRun('charge-history', constant).state;
    const momentum = placeFlameInstance(state, 'momentum', 100);
    state.target = 1_000_000n;
    state.stats.rounds.at(-1)!.target = state.target;
    state.dice[0].value = 1; state.dice[1].value = 2;
    state = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant).state;
    const growth = state.historyV2.find(event => event.kind === 'flame_charge_generated')!;
    expect(growth).toMatchObject({ flame: 'momentum', sourceInstanceId: momentum.instanceId, order: 1,
      factorRequested: 1.25, factorApplied: 1.25, maxCharge: 5, factorLostToCap: 0,
      before: 1, after: 1.25 });
    state = dispatch(state, { type: 'TOGGLE_CHARGE' }).state;
    state = dispatch(state, { type: 'PLAY', hand: 'twos', dieIds: [1] }, constant).state;
    const consumed = [...state.historyV2].reverse().find((event): event is Extract<typeof event, { kind: 'hand_scored' }> =>
      event.kind === 'hand_scored' && event.hand === 'twos')!;
    expect(consumed.xMultContributions.find(item => item.sourceId === 'charge')?.chargeReplay)
      .toMatchObject({ flames: [expect.objectContaining({ instanceId: momentum.instanceId, investedGold: 100 })],
        events: [expect.objectContaining({ sourceInstanceId: momentum.instanceId, factorRequested: 1.25 })] });
    const summary = summarizeRunHistoryV2(state.historyV2, state);
    expect(summary.experienced.charge).toMatchObject({ multiplicativeEvents: 2, consumptionSamples: 1,
      maximumChargeAtConsumption: 1.25 });
  });

  it('replays ordered multiplicative Charge and selected capacity counterfactually', () => {
    const event = { xMultContributions: [{
      sourceId: 'charge' as const, origin: 'charge' as const, factor: 12,
      chargeReplay: {
        flames: [
          { instanceId: 1, flame: 'momentum' as const, investedGold: 100 },
          { instanceId: 2, flame: 'thirdRail' as const, investedGold: 100 },
        ],
        events: [{ order: 1, sourceInstanceId: 2, sourceFlame: 'thirdRail' as const,
          factorRequested: 20, factorApplied: 12, before: 1, after: 12, maxCharge: 12, factorLostToCap: 8 }],
      },
    }] };
    // Momentum supplied no generator event, but removing its pair capacity lowers the replay cap from 12 to 5.
    expect(selectedOfferingFactor(event, new Set([1]))).toBe(2.4);
    expect(selectedOfferingFactor(event, new Set([2]))).toBe(12);
    expect(selectedOfferingFactor(event, new Set([1, 2]))).toBe(12);
  });

  it('evaluates the latest six clears, then lets the player snuff only a qualifying joint subset', () => {
    const { state: played, cleanId, ultimateId, preservedId } = buildReadyOffering();
    played.engulfmentLevel = 2;
    played.infernoMultiplier = 35n;
    expect(ENGULFMENT_EVIDENCE_ROUNDS).toBe(6);
    expect(ENGULFMENT_REQUIRED_MULTIPLIER).toBe(15);
    const evaluation = createInfernoEvaluation(played)!;
    expect(evaluation.effectiveValue).toBe(60);
    expect(evaluation.flames.find(item => item.asset.instanceId === cleanId)?.hiddenStrength).toBe(12);
    expect(evaluation.flames.find(item => item.asset.instanceId === ultimateId)?.hiddenStrength).toBe(5);
    expect(evaluation.selectedFlameInstanceIds).toEqual([]);

    played.infernoEvaluation = evaluation;
    played.phase = 'inferno';
    let state = dispatch(played, { type: 'TOGGLE_ENGULFMENT_FLAME', flameInstanceId: cleanId }).state;
    expect(state.infernoEvaluation?.selectedEffectiveValue).toBe(12);
    const rejected = dispatch(state, { type: 'ENGULF_NOW' });
    expect(rejected.error).toContain('enough joint effective power');
    expect(rejected.state).toBe(state);
    state = dispatch(state, { type: 'TOGGLE_ENGULFMENT_FLAME', flameInstanceId: ultimateId }).state;
    expect(state.infernoEvaluation).toMatchObject({ selectedEffectiveValue: 60, earnedInfernoFactor: 60,
      engulfmentCountAfter: 3, infernoMultiplierAfter: 2_100n });
    state = dispatch(state, { type: 'ENGULF_NOW' }).state;
    expect(state.engulfmentLevel).toBe(3);
    expect(state.infernoMultiplier).toBe(2_100n);
    expect(state.flameSlots.some(flame => flame?.instanceId === preservedId)).toBe(true);
    expect(state.flameSlots.some(flame => flame?.instanceId === cleanId || flame?.instanceId === ultimateId)).toBe(false);
    expect([...state.historyV2].reverse().find(event => event.kind === 'engulfment_attempted')).toMatchObject({ kind: 'engulfment_attempted',
      fullCollectionEffectivePower: 60, selectedEffectivePower: 60, earnedInfernoFactor: 60,
      selectedInstanceIds: [cleanId, ultimateId] });
  });

  it('excludes destroyed score before the last Burn It Down but retains later scoring evidence', () => {
    const state = newRun('retained-score-evidence', constant).state;
    const lowball = placeFlameInstance(state, 'lowball', 100);
    placeFlameInstance(state, 'burnItDown', 100, 1);
    state.target = 1_000_000n;
    state.stats.rounds.at(-1)!.target = state.target;
    state.dice[0].value = 1;
    new Resolver(state, constant).play('ones', [0]);
    new Resolver(state, constant).burnItDown();
    state.target = 1n;
    state.dice[1].value = 2;
    new Resolver(state, constant).play('twos', [1]);
    const asset = ownedEngulfmentAssets(state).find(item => item.instanceId === lowball.instanceId)!;
    const offering = evaluateEngulfmentOffering(state, [asset]);
    expect(offering.evidenceRounds).toHaveLength(1);
    expect(offering.evidenceRounds[0].handCount).toBe(1);
    expect(offering.offeringMultiplier).toBe(3.5);
  });

  it.each(['all_in_failure', 'double_or_nothing'] as const)(
    'excludes score packages removed by %s from effective-power evidence', reason => {
      const { state } = buildReadyOffering();
      const hand = state.historyV2.find(event => event.kind === 'hand_scored')!;
      const asset = ownedEngulfmentAssets(state).find(item => item.flame === 'cleanSweep')!;
      const lastSeq = Math.max(...state.historyV2.map(event => event.seq));
      state.historyV2.push({ kind: 'score_package_removed', seq: lastSeq + 1, round: hand.round,
        attempt: hand.attempt, actionId: hand.actionId, timelineId: hand.timelineId,
        packageId: hand.scorePackageId, reason, amount: hand.score.awarded,
        roundScoreBefore: hand.roundScore.after, roundScoreAfter: 0n });
      expect(evaluateEngulfmentOffering(state, [asset])).toMatchObject({ offeringMultiplier: 1,
        evidenceRounds: [expect.objectContaining({ handCount: 0, multiplier: 1 })] });
    },
  );

  it('advances Hot Streak on Free Plays that receive its factor, preventing repeat farming', () => {
    const state = newRun('hot-streak-free-play', constant).state;
    placeFlameInstance(state, 'hotStreak', 100);
    state.target = 1_000_000n;
    state.stats.rounds.at(-1)!.target = state.target;
    state.hotStreakGoal = 'pair';
    state.dice[0].value = 2; state.dice[1].value = 2;
    const resolver = new Resolver(state, constant);
    resolver.play('pair', [0, 1], 'jumpingBean');
    expect(state.hotStreakGoal).toBe('twoPair');
    expect(state.hotStreakCharges).toBe(1);
    resolver.play('pair', [0, 1], 'freePlay');
    expect(state.hotStreakCharges).toBe(1);
    const factors = state.stats.handScores.map(score => score.xMultFactors
      .find(factor => factor.source === 'hotStreak')?.value);
    expect(factors).toEqual([2, undefined]);
  });

  it('derives one authoritative scorecard annotation set from every Ultimate-referencing Flame', () => {
    const state = newRun('scorecard-annotations', constant).state;
    placeFlameInstance(state, 'potentialEnergy', 50);
    placeFlameInstance(state, 'targetPractice', 50, 1);
    placeFlameInstance(state, 'benchWarmer', 50, 2);
    state.targetPracticeHand = 'pair';
    const annotations = scorecardHandAnnotations(state);
    expect(annotations.fiveKind).toContainEqual(expect.objectContaining({ kind: 'ultimate' }));
    expect(annotations.pair).toContainEqual(expect.objectContaining({ kind: 'target', source: 'Target Practice' }));
    expect(annotations.ones).toContainEqual(expect.objectContaining({ kind: 'benchWarmer' }));
    expect(annotations.fiveKind?.filter(item => item.kind === 'ultimate')).toHaveLength(1);
  });
});
