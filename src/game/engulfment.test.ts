import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import {
  classifyInfernoTrend, classifyInfernoWeakness, createInfernoEvaluation, ENGULFMENT_REQUIRED_MULTIPLIER,
  engulfmentTrainingNormalization, evaluateEngulfmentOffering, infernoEvaluationDuration, infernoMultiplier,
  INFERNO_SUSPENSION_MESSAGE, maximumPossibleEngulfmentReadiness, ownedEngulfmentAssets, selectInfernoFeedback,
} from './engulfment';
import { HAND_IDS, LOWER_HAND_IDS, UPPER_HAND_IDS } from './hands';
import { captureRollbackState } from './rollback';
import { loadPersistedRun, savePersistedRun } from './persistence';
import { highestUnlockedEnhancementTier, maxEnhancementTypesPerFace } from './enhancements';
import type { Rank } from './types';
import type { GameState } from './types';
import type { HandScoredEvent, RoundAttemptFinishedEvent, XMultContribution } from './runHistoryV2';

function envelope(seq: number) {
  return { seq, round: 1, attempt: 1, actionId: seq, timelineId: 0 };
}

function scored(seq: number, contributions: XMultContribution[]): HandScoredEvent {
  const xMult = contributions.reduce((value, contribution) => value * contribution.factor, 1);
  const awarded = BigInt(100 * xMult);
  return {
    ...envelope(seq), kind: 'hand_scored', hand: 'ones', level: 1, playSource: 'manual',
    selectedDice: [0], scoringDice: [], consumed: true,
    score: { infernoMultiplier: 1n, basePips: 10, finalPips: 10, baseMult: 10, finalMult: 10,
      finalXMult: xMult, bossFactor: 1, raw: String(awarded), awarded,
      rounding: { mode: 'nearest_integer', delta: '0' } },
    roundScore: { before: 0n, afterAward: awarded, after: awarded },
    pipsContributions: [], multContributions: [], xMultContributions: contributions, checks: [], sideEffects: [],
  };
}

function cleared(seq: number): RoundAttemptFinishedEvent {
  return { ...envelope(seq), kind: 'round_attempt_finished', outcome: 'cleared', score: 10_000n,
    target: 100n, boss: null, livesBefore: 3, livesAfter: 3 };
}

function offeringState(): GameState {
  const state = newRun('inferno-evaluation', { next: () => .25 }).state;
  state.dice[0].flame = { id: 'vineyard', investedGold: 100 };
  state.bonfires = ['lowball'];
  state.flameInstanceIds = { vineyard: 3, lowball: 8 };
  state.nextFlameInstanceId = 9;
  state.historyV2.push(scored(100, [
    { sourceId: 'vineyard', origin: 'ember', factor: 25, sourceInstanceId: 3, dieId: 0 },
    { sourceId: 'lowball', origin: 'bonfire', factor: 5, sourceInstanceId: 8 },
  ]), cleared(101));
  return state;
}

describe('automatic Inferno evaluation', () => {
  it('skips evaluation when no Flames are owned', () => {
    expect(ownedEngulfmentAssets(newRun('no-flames').state)).toEqual([]);
    expect(createInfernoEvaluation(newRun('no-flames').state)).toBeNull();
  });

  it('preserves the contribution-v2 counterfactual evaluator and threshold', () => {
    const state = offeringState();
    const assets = ownedEngulfmentAssets(state);
    expect(evaluateEngulfmentOffering(state, assets).offeringMultiplier).toBe(125);
    expect(evaluateEngulfmentOffering(state, [assets[0]]).offeringMultiplier).toBe(25);
    expect(evaluateEngulfmentOffering(state, [assets[1]]).offeringMultiplier).toBe(5);
    expect(ENGULFMENT_REQUIRED_MULTIPLIER).toBe(20);
  });

  it('snuffs the shortest successful strongest-first prefix and preserves the rest', () => {
    const evaluation = createInfernoEvaluation(offeringState())!;
    expect(evaluation.success).toBe(true);
    expect(evaluation.strongestFirst.map(asset => asset.instanceId)).toEqual([3, 8]);
    expect(evaluation.prefixEvaluations).toEqual([{ flameInstanceIds: [3], effectiveValue: 25, success: true }]);
    expect(evaluation.flamesSnuffed.map(asset => asset.instanceId)).toEqual([3]);
    expect(evaluation.flamesPreserved.map(asset => asset.instanceId)).toEqual([8]);
    expect(evaluation.infernoMultiplierAfter).toBe(25n);
  });

  it('uses stable instance IDs as the singleton-strength tie breaker', () => {
    const state = offeringState();
    const hand = state.historyV2.find(event => event.kind === 'hand_scored')! as HandScoredEvent;
    hand.xMultContributions[1].factor = 25;
    hand.score.finalXMult = 625;
    hand.score.awarded = 62_500n;
    hand.score.raw = '62500';
    const evaluation = createInfernoEvaluation(state)!;
    expect(evaluation.strongestFirst.map(asset => asset.instanceId)).toEqual([3, 8]);
  });

  it('uses the 0.05 trend dead zone and deterministic non-repeating feedback', () => {
    expect(classifyInfernoTrend(.5, null)).toBe('first');
    expect(classifyInfernoTrend(.54, .50)).toBe('stable');
    expect(classifyInfernoTrend(.55, .50)).toBe('improving');
    expect(classifyInfernoTrend(.44, .50)).toBe('worsening');
    const first = selectInfernoFeedback('seed', 1, 'quantity', 'first', 'none', []);
    const second = selectInfernoFeedback('seed', 1, 'quantity', 'first', 'none', [first.id]);
    expect(second.id).not.toBe(first.id);
    expect(selectInfernoFeedback('seed', 1, 'quantity', 'first', 'none', [])).toEqual(first);
    expect(selectInfernoFeedback('seed', 2, 'close', 'improving', 'contribution_improved', []).id.startsWith('close-')).toBe(true);
    expect(selectInfernoFeedback('seed', 2, 'close', 'worsening', 'contribution_declined', []).id.startsWith('worsening-')).toBe(true);
  });

  it('runs automatically after payout, freezes the result, and gates the next reward flow', () => {
    const state = offeringState();
    state.round = 13;
    for (const event of state.historyV2) if (event.kind === 'hand_scored' || event.kind === 'round_attempt_finished') event.round = 13;
    state.historyV2 = state.historyV2.filter(event => event.kind !== 'round_attempt_finished');
    state.score = state.target;
    state.stats.rounds[0].finalScore = state.score;
    const resolver = new Resolver(state, { next: () => .25 });
    resolver.evaluate();

    expect(state.phase).toBe('roundSummary');
    expect(state.infernoEvaluation?.success).toBe(true);
    expect(state.engulfmentLevel).toBe(1);
    expect(maxEnhancementTypesPerFace(3)).toBe(3);
    expect(highestUnlockedEnhancementTier(3)).toBe(2);
    expect(state.dice[0].flame).toBeNull();
    expect(state.bonfires).toEqual(['lowball']);
    const clearedIndex = state.historyV2.findIndex(event => event.kind === 'round_attempt_finished' && event.outcome === 'cleared');
    const payoutIndex = state.historyV2.findIndex(event => event.kind === 'shop_transaction'
      && event.transaction.type === 'round_payout');
    const evaluationIndex = state.historyV2.findIndex(event => event.kind === 'inferno_evaluated');
    expect(clearedIndex).toBeLessThan(payoutIndex);
    expect(payoutIndex).toBeLessThan(evaluationIndex);
    expect(state.historyV2[evaluationIndex]).not.toHaveProperty('enhancementProgression');

    const frozen = structuredClone(state.infernoEvaluation);
    resolver.continueRoundSummary();
    expect(state.phase).toBe('inferno');
    expect(state.infernoEvaluation).toEqual(frozen);
    resolver.continueInfernoEvaluation();
    expect(state.phase).toBe('shop');
    expect(state.infernoEvaluation).toBeNull();
  });

  it('does not gate post-Round flow or emit an evaluation when the collection is empty', () => {
    const state = newRun('zero-flame-clear', { next: () => .25 }).state;
    state.score = state.target;
    state.stats.rounds[0].finalScore = state.score;
    const resolver = new Resolver(state, { next: () => .25 });
    resolver.evaluate();
    expect(state.infernoEvaluation).toBeNull();
    expect(state.historyV2.some(event => event.kind === 'inferno_evaluated')).toBe(false);
    resolver.continueRoundSummary();
    expect(state.phase).toBe('shop');
  });

  it('stops evaluating after a success consumes the final Flame', () => {
    const state = offeringState();
    state.bonfires = [];
    delete state.flameInstanceIds.lowball;
    const hand = state.historyV2.find(event => event.kind === 'hand_scored')! as HandScoredEvent;
    hand.xMultContributions = hand.xMultContributions.filter(item => item.sourceId !== 'lowball');
    hand.score.finalXMult = 25;
    hand.score.awarded = 2_500n;
    hand.score.raw = '2500';
    state.historyV2 = state.historyV2.filter(event => event.kind !== 'round_attempt_finished');
    state.score = state.target;
    const resolver = new Resolver(state, { next: () => .25 });
    resolver.evaluate();
    expect(state.infernoEvaluation?.consumedFinalFlame).toBe(true);
    expect(ownedEngulfmentAssets(state)).toEqual([]);
    expect(state.historyV2.filter(event => event.kind === 'inferno_evaluated')).toHaveLength(1);

    state.infernoEvaluation = null;
    state.phase = 'round';
    state.score = state.target;
    resolver.evaluate();
    expect(state.infernoEvaluation).toBeNull();
    expect(state.historyV2.filter(event => event.kind === 'inferno_evaluated')).toHaveLength(1);
  });

  it('evaluates Embers at every investment and Bonfires without a status gate', () => {
    for (const investment of [0, 40, 100]) {
      const state = newRun(`ember-${investment}`).state;
      state.dice[0].flame = { id: 'vineyard', investedGold: investment };
      state.flameInstanceIds.vineyard = 1;
      expect(ownedEngulfmentAssets(state)).toEqual([
        { kind: 'ember', flame: 'vineyard', instanceId: 1, dieId: 0 },
      ]);
      expect(createInfernoEvaluation(state)).not.toBeNull();
    }
    const bonfire = newRun('bonfire').state;
    bonfire.bonfires = ['vineyard'];
    bonfire.flameInstanceIds.vineyard = 2;
    expect(ownedEngulfmentAssets(bonfire)).toEqual([
      { kind: 'bonfire', flame: 'vineyard', instanceId: 2 },
    ]);
  });

  it('fails without mutating Flames, Inferno, or hand levels and selects one hint', () => {
    const state = newRun('inferno-failure').state;
    state.dice[0].flame = { id: 'vineyard', investedGold: 20 };
    state.flameInstanceIds.vineyard = 1;
    state.handLevels.ones = 7;
    const beforeLevels = structuredClone(state.handLevels);
    const evaluation = createInfernoEvaluation(state)!;
    expect(evaluation.success).toBe(false);
    expect(evaluation.feedbackMessage).toBeTruthy();
    expect(evaluation.feedbackMessage?.includes('\n')).toBe(false);
    expect(state.dice[0].flame).toEqual({ id: 'vineyard', investedGold: 20 });
    expect(state.engulfmentLevel).toBe(0);
    expect(state.handLevels).toEqual(beforeLevels);
  });

  it('uses the authoritative non-additive upper bound to distinguish possible and impossible collections', () => {
    const possible = newRun('possible-collection').state;
    possible.dice[0].flame = { id: 'vineyard', investedGold: 0 };
    possible.dice[1].flame = { id: 'fatCat', investedGold: 0 };
    possible.flameInstanceIds = { vineyard: 1, fatCat: 2 };
    const possibleEvaluation = createInfernoEvaluation(possible)!;
    expect(maximumPossibleEngulfmentReadiness(possible)).toBe(25);
    expect(possibleEvaluation).toMatchObject({ success: false, maximumPossibleReadiness: 25,
      currentCollectionTheoreticallySufficient: true, suspendAfterContinue: false });
    expect(possibleEvaluation.feedbackMessage).not.toBe(INFERNO_SUSPENSION_MESSAGE);

    const impossible = newRun('impossible-collection').state;
    impossible.dice[0].flame = { id: 'vineyard', investedGold: 0 };
    impossible.flameInstanceIds = { vineyard: 1 };
    const impossibleEvaluation = createInfernoEvaluation(impossible)!;
    expect(maximumPossibleEngulfmentReadiness(impossible)).toBe(5);
    expect(impossibleEvaluation).toMatchObject({ success: false, maximumPossibleReadiness: 5,
      currentCollectionTheoreticallySufficient: false, suspendAfterContinue: true,
      feedbackMessage: INFERNO_SUSPENSION_MESSAGE });

    const mutuallyExclusive = newRun('mutually-exclusive-collection').state;
    mutuallyExclusive.dice[0].flame = { id: 'missingPair', investedGold: 0 };
    mutuallyExclusive.dice[1].flame = { id: 'oneShort', investedGold: 0 };
    mutuallyExclusive.flameInstanceIds = { missingPair: 1, oneShort: 2 };
    expect(maximumPossibleEngulfmentReadiness(mutuallyExclusive)).toBe(5);

    const successful = createInfernoEvaluation(offeringState())!;
    expect(successful.success).toBe(true);
    expect(successful.suspendAfterContinue).toBe(false);
  });

  it('suspends only after CONTINUE and remains dormant until a new Flame instance is acquired', () => {
    const state = newRun('suspension-lifecycle').state;
    state.dice[0].flame = { id: 'vineyard', investedGold: 0 };
    state.flameInstanceIds = { vineyard: 1 };
    state.score = state.target;
    const resolver = new Resolver(state, { next: () => .25 });
    resolver.evaluate();
    expect(state.infernoEvaluation?.feedbackMessage).toBe(INFERNO_SUSPENSION_MESSAGE);
    expect(state.infernoEvaluationSuspendedUntilNewFlame).toBe(false);
    resolver.continueRoundSummary();
    expect(state.phase).toBe('inferno');
    resolver.continueInfernoEvaluation();
    expect(state.infernoEvaluationSuspendedUntilNewFlame).toBe(true);
    expect(state.historyV2.at(-1)).toMatchObject({ kind: 'shop_offers_presented' });
    expect(state.historyV2.some(event => event.kind === 'inferno_suspension_changed'
      && event.suspended && event.reason === 'collection_insufficient')).toBe(true);

    state.phase = 'round';
    state.shop = null;
    state.score = state.target;
    resolver.evaluate();
    expect(state.infernoEvaluation).toBeNull();

    state.phase = 'flameSelection';
    state.flameSelection = { acquired: false, offers: [{ id: 77, flame: 'lowball' }] };
    const acquired = dispatch(state, { type: 'CHOOSE_FLAME', offerId: 77, dieId: 1 }).state;
    expect(acquired.infernoEvaluationSuspendedUntilNewFlame).toBe(false);
    expect(acquired.infernoEvaluation).toBeNull();
    expect(acquired.historyV2.some(event => event.kind === 'inferno_suspension_changed'
      && !event.suspended && event.reason === 'new_flame_acquired' && event.flame === 'lowball')).toBe(true);

    acquired.phase = 'round';
    acquired.shop = null;
    acquired.score = acquired.target;
    new Resolver(acquired, { next: () => .25 }).evaluate();
    expect(acquired.infernoEvaluation).not.toBeNull();
  });

  it('does not reactivate suspension for stoking, Bonfire conversion, save/load, or Bust rollback', () => {
    let state = newRun('suspension-persistence').state;
    state.phase = 'shop';
    state.shop = { visitId: 1, kind: 'between_rounds', exitUnlocked: true, offers: [], trainingOffers: [],
      diceRerolls: 0, offerRerolls: 0, lifeRestores: 0, freeEnhancementOfferIds: [], freeTrainingOfferKeys: [] };
    state.gold = 10;
    state.dice[0].flame = { id: 'vineyard', investedGold: 98 };
    state.flameInstanceIds = { vineyard: 1 };
    state.infernoEvaluationSuspendedUntilNewFlame = true;
    state = dispatch(state, { type: 'STOKE_FLAME', dieId: 0, amount: 1 }).state;
    expect(state.infernoEvaluationSuspendedUntilNewFlame).toBe(true);
    state = dispatch(state, { type: 'STOKE_FLAME', dieId: 0, amount: 1 }).state;
    expect(state.bonfires).toContain('vineyard');
    expect(state.infernoEvaluationSuspendedUntilNewFlame).toBe(true);

    let raw: string | null = null;
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
    expect(savePersistedRun(storage, state)).toBe(true);
    const loaded = loadPersistedRun(storage, state.seed)!;
    expect(loaded.infernoEvaluationSuspendedUntilNewFlame).toBe(true);

    loaded.phase = 'round';
    loaded.shop = null;
    loaded.roundCheckpoint = captureRollbackState(loaded);
    loaded.target = 1_000_000n;
    loaded.stats.rounds[0].target = loaded.target;
    loaded.dice.forEach((die, index) => { die.value = ([1, 2, 2, 3, 4] as Rank[])[index]; });
    loaded.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    loaded.manualRerollsRemaining = 0;
    const busted = dispatch(loaded, { type: 'PLAY', hand: 'ones', dieIds: [0] }, { next: () => .25 }).state;
    expect(busted.infernoEvaluationSuspendedUntilNewFlame).toBe(true);
  });

  it('classifies quantity, investment, utilization, and close weaknesses', () => {
    const state = offeringState();
    const assets = ownedEngulfmentAssets(state);
    expect(classifyInfernoWeakness([assets[0]], .2, state)).toBe('quantity');
    state.dice[0].flame = { id: 'vineyard', investedGold: 10 };
    expect(classifyInfernoWeakness(assets, .2, state)).toBe('investment');
    state.dice[0].flame = { id: 'vineyard', investedGold: 100 };
    expect(classifyInfernoWeakness(assets, .2, state)).toBe('utilization');
    expect(classifyInfernoWeakness(assets, .8, state)).toBe('close');
  });

  it('keeps message flavor outside gameplay RNG and honors recent action categories', () => {
    const state = offeringState();
    state.infernoProgress.recentAction = 'flame_acquired';
    const before = state.rngState;
    const evaluation = createInfernoEvaluation(state)!;
    expect(state.rngState).toBe(before);
    expect(evaluation.success).toBe(true);
    const acquired = selectInfernoFeedback('action', 2, 'quantity', 'improving', 'flame_acquired', []);
    const invested = selectInfernoFeedback('action', 2, 'investment', 'improving', 'flame_invested', []);
    const contribution = selectInfernoFeedback('action', 2, 'utilization', 'improving', 'contribution_improved', []);
    expect(acquired.id.startsWith('acquired-')).toBe(true);
    expect(invested.id.startsWith('invested-')).toBe(true);
    expect(contribution.id.startsWith('contribution-')).toBe(true);
  });

  it('preserves ×25 Inferno progression and deterministic section unification', () => {
    expect([0, 1, 2, 3, 4].map(infernoMultiplier)).toEqual([1n, 25n, 625n, 15_625n, 390_625n]);
    const state = newRun('normalization').state;
    UPPER_HAND_IDS.forEach((hand, index) => { state.handLevels[hand] = index + 1; });
    LOWER_HAND_IDS.forEach((hand, index) => { state.handLevels[hand] = index + 1; });
    const normalization = engulfmentTrainingNormalization(state.handLevels);
    expect(normalization.upper.unifiedLevel).toBe(4);
    expect(normalization.lower.unifiedLevel).toBe(5);
    expect(normalization.upper.levelsBefore).toHaveLength(6);
    expect(normalization.lower.levelsBefore).toHaveLength(8);
  });

  it('routes R3 through Special Offers and R6 through Flame Selection only after Inferno', () => {
    for (const [round, expected] of [[3, 'specialOffer'], [6, 'flameSelection']] as const) {
      const state = newRun(`reward-${round}`).state;
      state.round = round;
      state.phase = 'inferno';
      state.roundSummary = { round, encounterType: 'boss', bossType: round === 3 ? 'clockmaker' : 'caller',
        score: 100n, target: 100n, goldBefore: 0, goldAfter: 0, totalGoldEarned: 0,
        sources: { baseRewardGold: 0, unusedRerollGold: 0, interestGold: 0, bossRewardGold: 0,
          goldenGold: 0, jackpotGold: 0, otherGold: 0 } };
      state.dice[0].flame = { id: 'vineyard', investedGold: 0 };
      state.flameInstanceIds.vineyard = 1;
      state.infernoEvaluation = createInfernoEvaluation(state);
      new Resolver(state, { next: () => .25 }).continueInfernoEvaluation();
      expect(state.phase).toBe(expected);
      if (round === 6) expect(state.flameSelection?.acquired).toBe(false);
    }
  });

  it('uses one fixed ceremony duration independent of gameplay playback speed', () => {
    for (const _speed of ['normal', 'fast', 'instant'] as const) {
      expect(infernoEvaluationDuration(5)).toBe(2100);
      expect(infernoEvaluationDuration(25)).toBe(2300);
    }
    expect(infernoEvaluationDuration(25)).toBeGreaterThan(infernoEvaluationDuration(5));
  });

  it('does not evaluate a Bust and preserves prior Inferno build state through rollback', () => {
    const state = newRun('bust-after-inferno', { next: () => .25 }).state;
    state.engulfmentLevel = 2;
    state.bonfires = ['lowball'];
    state.flameInstanceIds.lowball = 1;
    state.roundCheckpoint = captureRollbackState(state);
    state.target = 1_000_000n;
    state.stats.rounds[0].target = state.target;
    state.dice.forEach((die, index) => { die.value = ([1, 2, 2, 3, 4] as Rank[])[index]; });
    state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    state.manualRerollsRemaining = 0;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, { next: () => .25 }).state;
    expect(result.phase).toBe('shop');
    expect(result.bust).not.toBeNull();
    expect(result.engulfmentLevel).toBe(2);
    expect(result.bonfires).toEqual(['lowball']);
    expect(result.historyV2.some(event => event.kind === 'inferno_evaluated')).toBe(false);
  });
});
