import { describe, expect, it } from 'vitest';
import { dispatch, newRun, normalizeGameState } from './engine';
import { Resolver } from './effects';
import {
  ENGULFMENT_EVIDENCE_ROUNDS, ENGULFMENT_REQUIRED_MULTIPLIER, engulfmentAnimationProfile,
  engulfmentAvailable, engulfmentHasQuestWarning, engulfmentSucceeds, engulfmentTrainingNormalization,
  evaluateEngulfmentOffering, infernoMultiplier, offeringHandObservation, ownedEngulfmentAssets,
  selectedOfferingFactor,
} from './engulfment';
import { HAND_IDS, LOWER_HAND_IDS, UPPER_HAND_IDS } from './hands';
import { loadPersistedRun, RUN_STORAGE_KEY, RUN_STORAGE_VERSION, savePersistedRun } from './persistence';
import type { HandScoredEvent, RunHistoryV2Event, XMultContribution } from './runHistoryV2';
import type { EngulfmentAssetRef, Flame, GameState, RandomSource } from './types';

const constant: RandomSource = { next: () => 0.99 };

function shopState(seed = 'engulfment', bonfires: Flame[] = ['ultimate']): GameState {
  const state = newRun(seed, constant).state;
  state.phase = 'shop';
  state.shop = { visitId: 1, engulfmentAttemptUsed: false, kind: 'between_rounds', exitUnlocked: true,
    offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
  state.nextShopVisitId = 2;
  state.bonfires = bonfires;
  return normalizeGameState(state);
}

function asset(state: GameState, flame: Flame): EngulfmentAssetRef {
  const result = ownedEngulfmentAssets(state).find(item => item.flame === flame);
  if (!result) throw new Error(`Missing owned ${flame}`);
  return result;
}

function direct(flame: Flame, instanceId: number, factor: number,
  origin: XMultContribution['origin'] = 'bonfire'): XMultContribution {
  return { sourceId: flame, sourceInstanceId: instanceId, origin, factor };
}

function scored(seq: number, round: number, counterfactual: number, contributions: XMultContribution[],
  playSource: HandScoredEvent['playSource'] = 'manual', attempt = 1, timelineId = 0): HandScoredEvent {
  const finalXMult = contributions.reduce((product, item) => product * item.factor, 1);
  const awarded = BigInt(Math.round(counterfactual * finalXMult));
  return { seq, kind: 'hand_scored', round, attempt, actionId: seq, timelineId,
    hand: 'ones', level: 1, playSource, selectedDice: [0], scoringDice: [], consumed: playSource === 'manual',
    score: { infernoMultiplier: 1n, basePips: counterfactual, finalPips: counterfactual, baseMult: 1, finalMult: 1,
      finalXMult, bossFactor: 1, raw: awarded.toString(), awarded, rounding: { mode: 'nearest_integer', delta: '0' } },
    roundScore: { before: 0n, afterAward: awarded, after: awarded }, pipsContributions: [], multContributions: [],
    xMultContributions: contributions, checks: [], sideEffects: [] };
}

function cleared(seq: number, round: number, attempt = 1, timelineId = 0): RunHistoryV2Event {
  return { seq, kind: 'round_attempt_finished', round, attempt, actionId: seq, timelineId,
    outcome: 'cleared', score: 1n, target: 1n, boss: null, livesBefore: 3, livesAfter: 3 };
}

function setRounds(state: GameState, hands: HandScoredEvent[][]): void {
  let seq = 0;
  state.historyV2 = [];
  hands.forEach((roundHands, index) => {
    const round = index + 1;
    for (const hand of roundHands) state.historyV2.push({ ...hand, seq: seq++, actionId: seq - 1, round });
    state.historyV2.push(cleared(seq++, round));
  });
}

describe('Engulfment score weighting and group counterfactual', () => {
  it('keeps counterfactual weighting exact above MAX_SAFE_INTEGER at the ×20 threshold', () => {
    const state = shopState('huge-counterfactual');
    const offered = asset(state, 'ultimate');
    const inferno = infernoMultiplier(12);
    const hand = scored(0, 1, 1, [direct('ultimate', offered.instanceId, 20)]);
    hand.score.infernoMultiplier = inferno;
    hand.score.raw = (inferno * 20n).toString();
    hand.score.awarded = inferno * 20n;
    hand.roundScore = { before: 0n, afterAward: inferno * 20n, after: inferno * 20n };
    setRounds(state, [[hand]]);
    const evaluation = evaluateEngulfmentOffering(state, [offered]);
    expect(offeringHandObservation(hand, new Set([offered.instanceId]))).toEqual({ factor: 20, weight: inferno });
    expect(evaluation.offeringMultiplier).toBe(20);
    expect(engulfmentSucceeds(evaluation.offeringMultiplier)).toBe(true);
  });

  it('weights a 1,000,000-point hand about 100× more than a 10,000-point hand', () => {
    const state = shopState('large-hand');
    const offered = asset(state, 'ultimate');
    const id = offered.instanceId;
    setRounds(state, [[
      scored(0, 1, 1_000_000, [direct('ultimate', id, 20)]),
      scored(1, 1, 10_000, []),
    ]]);
    const result = evaluateEngulfmentOffering(state, [offered]);
    expect(result.offeringMultiplier).toBeCloseTo((1_000_000 * 20 + 10_000) / 1_010_000, 10);
    expect(result.offeringMultiplier).toBeGreaterThan(19.8);
  });

  it('does not let repeated weak Jumping Bean plays overwhelm a major hand by activation count', () => {
    const state = shopState('bean-weighting');
    const offered = asset(state, 'ultimate');
    const id = offered.instanceId;
    const hands = [scored(0, 1, 1_000_000, [direct('ultimate', id, 20)])];
    for (let i = 0; i < 100; i++) hands.push(scored(i + 1, 1, 10, [], 'jumpingBean'));
    setRounds(state, [hands]);
    expect(evaluateEngulfmentOffering(state, [offered]).offeringMultiplier).toBeGreaterThan(19.98);
  });

  it('includes inactive important hands at ×1 and resolves an all-inactive offering to ×1', () => {
    const state = shopState('inactive-hands');
    const offered = asset(state, 'ultimate');
    setRounds(state, [[
      scored(0, 1, 10_000, [direct('ultimate', offered.instanceId, 20)]),
      scored(1, 1, 1_000_000, []),
    ]]);
    expect(evaluateEngulfmentOffering(state, [offered]).offeringMultiplier).toBeLessThan(1.2);
    setRounds(state, [[scored(0, 1, 1_000_000, [])]]);
    expect(evaluateEngulfmentOffering(state, [offered]).offeringMultiplier).toBe(1);
  });

  it('removes selected factors jointly while retaining an unoffered Flame', () => {
    const state = shopState('joint', ['ultimate', 'minigun', 'hailMary']);
    const a = asset(state, 'ultimate'); const b = asset(state, 'minigun'); const retained = asset(state, 'hailMary');
    const hand = scored(0, 1, 100, [
      direct('ultimate', a.instanceId, 5), direct('minigun', b.instanceId, 5), direct('hailMary', retained.instanceId, 10),
    ]);
    expect(selectedOfferingFactor(hand, new Set([a.instanceId, b.instanceId]))).toBe(25);
    expect(offeringHandObservation(hand, new Set([a.instanceId, b.instanceId]))).toEqual({ factor: 25, weight: 1000n });

    setRounds(state, [[hand, scored(1, 1, 100, [])]]);
    const group = evaluateEngulfmentOffering(state, [a, b]).offeringMultiplier;
    const standaloneProduct = evaluateEngulfmentOffering(state, [a]).offeringMultiplier
      * evaluateEngulfmentOffering(state, [b]).offeringMultiplier;
    expect(group).toBeCloseTo(22.818181818182);
    expect(group).not.toBeCloseTo(standaloneProduct);
  });
});

describe('Engulfment rolling canonical window', () => {
  it('score-weights hands within Rounds, equal-weights Rounds, and retains only the newest six clears', () => {
    const state = shopState('rolling-window');
    const offered = asset(state, 'ultimate');
    const factors = [100, 2, 4, 6, 8, 10, 12];
    setRounds(state, factors.map((factor, index) => [scored(index, index + 1, index === 6 ? 1_000_000_000 : 100,
      [direct('ultimate', offered.instanceId, factor)])]));
    const result = evaluateEngulfmentOffering(state, [offered]);
    expect(ENGULFMENT_EVIDENCE_ROUNDS).toBe(6);
    expect(result.evidenceRounds.map(round => round.round)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(result.evidenceRounds.map(round => round.multiplier)).toEqual([2, 4, 6, 8, 10, 12]);
    expect(result.offeringMultiplier).toBe(7);
  });

  it('excludes abandoned Bust/Time Travel evidence under canonical timeline semantics', () => {
    const state = shopState('canonical');
    const offered = asset(state, 'ultimate');
    state.historyV2 = [
      scored(0, 1, 100, [direct('ultimate', offered.instanceId, 100)]), cleared(1, 1),
      { seq: 2, kind: 'checkpoint_restored', round: 1, attempt: 2, actionId: 2, timelineId: 1,
        reason: 'time_travel', fromTimelineId: 0, toTimelineId: 1, abandonedFromSeq: 0, abandonedThroughSeq: 1,
        canonicalRound: 1, canonicalAttempt: 2 },
      scored(3, 1, 100, [direct('ultimate', offered.instanceId, 2)], 'manual', 2, 1),
      cleared(4, 1, 2, 1),
    ];
    const result = evaluateEngulfmentOffering(state, [offered]);
    expect(result.evidenceRounds).toHaveLength(1);
    expect(result.offeringMultiplier).toBe(2);
  });
});

describe('Flame instance lifecycle and status neutrality', () => {
  it('records an Ember direct multiplier with its current lifecycle identity', () => {
    const state = newRun('ember-history', constant).state;
    state.dice[0].flame = { id: 'minigun', investedGold: 50 };
    state.dice[0].value = 1;
    state.target = 999_999_999n;
    const resolver = new Resolver(state, constant);
    const instanceId = state.flameInstanceIds.minigun!;
    resolver.play('ones', [0]);
    const hand = [...state.historyV2].reverse().find(event => event.kind === 'hand_scored');
    expect(hand?.kind).toBe('hand_scored');
    if (hand?.kind !== 'hand_scored') throw new Error('Expected a scored hand.');
    expect(hand.xMultContributions).toContainEqual(expect.objectContaining({
      sourceId: 'minigun', sourceInstanceId: instanceId, origin: 'ember', factor: 3,
    }));
  });

  it('does not inherit evidence from an older instance of the same Flame type', () => {
    const state = shopState('fresh-instance');
    const current = asset(state, 'ultimate');
    setRounds(state, [[scored(0, 1, 100, [direct('ultimate', current.instanceId + 100, 50)])]]);
    expect(evaluateEngulfmentOffering(state, [current]).offeringMultiplier).toBe(1);
  });

  it('preserves one instance across Ember→Bonfire and keeps historical strengths as resolved', () => {
    let state = shopState('ember-bonfire', []);
    state.gold = 100;
    state.dice[0].flame = { id: 'ultimate', investedGold: 50 };
    state = normalizeGameState(state);
    const ember = asset(state, 'ultimate');
    state = dispatch(state, { type: 'STOKE_FLAME', dieId: 0, amount: 50 }, constant).state;
    const bonfire = asset(state, 'ultimate');
    expect(bonfire.kind).toBe('bonfire');
    expect(bonfire.instanceId).toBe(ember.instanceId);
    setRounds(state, [
      [scored(0, 1, 100, [direct('ultimate', ember.instanceId, 3, 'ember')])],
      [scored(1, 2, 100, [direct('ultimate', ember.instanceId, 5, 'bonfire')])],
    ]);
    expect(evaluateEngulfmentOffering(state, [bonfire]).offeringMultiplier).toBe(4);
  });

  it('gives a reacquired Flame a fresh identity and no evidence from its snuffed predecessor', () => {
    let state = shopState('reacquired-instance');
    const original = asset(state, 'ultimate');
    setRounds(state, [[scored(0, 1, 100, [direct('ultimate', original.instanceId, 20)])]]);
    state = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: [original] }, constant).state;
    expect(state.flameInstanceIds.ultimate).toBeUndefined();

    state.phase = 'flameSelection';
    state.shop = null;
    state.flameSelection = { offers: [{ id: 91, flame: 'ultimate' }], acquired: false };
    state = dispatch(state, { type: 'CHOOSE_FLAME', offerId: 91, dieId: 0 }, constant).state;
    const reacquired = asset(state, 'ultimate');
    expect(reacquired.instanceId).not.toBe(original.instanceId);
    expect(evaluateEngulfmentOffering(state, [reacquired]).offeringMultiplier).toBe(1);
  });

  it('preserves the recipient identity through Bonfire→Wildfire and retires the sacrifice identity', () => {
    let state = shopState('wildfire-lineage', ['ultimate', 'minigun']);
    const recipientId = asset(state, 'ultimate').instanceId;
    const sacrificeId = asset(state, 'minigun').instanceId;
    state.phase = 'hoodedFigure';
    state.shop = null;
    state.bonfireContributions.minigun = { roundCount: 1, factorSum: 5 };
    state.hoodedFigure.interaction = { kind: 'return', stage: 'confirm', lines: [], lineIndex: 0,
      recipient: 'ultimate', sacrifice: 'minigun' };
    state = dispatch(state, { type: 'CONFIRM_WILDFIRE' }, constant).state;
    expect(asset(state, 'ultimate')).toMatchObject({ kind: 'wildfire', instanceId: recipientId });
    expect(state.flameInstanceIds.minigun).toBeUndefined();
    expect(Object.values(state.flameInstanceIds)).not.toContain(sacrificeId);
    expect(state.historyV2.at(-1)).toMatchObject({ kind: 'flame_changed', change: {
      type: 'wildfire_created', instanceId: recipientId, sacrificedInstanceId: sacrificeId,
    } });
  });

  it('assigns no base value to Bonfire or Wildfire status and allows a proven Ember or Wildfire to qualify', () => {
    const state = shopState('status-neutral', ['ultimate']);
    state.dice[0].flame = { id: 'minigun', investedGold: 25 };
    state.wildfires = [{ flame: 'hailMary', sacrificedFlame: 'momentum', sacrificedAverage: 5,
      transferMultiplier: 6, resolved: { kind: 'xMult', baseMax: 5, max: 30 } }];
    const normalized = normalizeGameState(state);
    const bonfire = asset(normalized, 'ultimate'); const ember = asset(normalized, 'minigun'); const wildfire = asset(normalized, 'hailMary');
    setRounds(normalized, [[scored(0, 1, 100, [direct('minigun', ember.instanceId, 20, 'ember')])]]);
    expect(evaluateEngulfmentOffering(normalized, [bonfire]).offeringMultiplier).toBe(1);
    expect(evaluateEngulfmentOffering(normalized, [ember]).offeringMultiplier).toBe(20);
    setRounds(normalized, [[scored(0, 1, 100, [direct('hailMary', wildfire.instanceId, 25, 'wildfire')])]]);
    expect(evaluateEngulfmentOffering(normalized, [wildfire]).offeringMultiplier).toBe(25);
  });

  it('makes several weak Bonfires fail and several jointly strong Bonfires succeed', () => {
    const state = shopState('collective', ['ultimate', 'minigun', 'hailMary']);
    const assets = ownedEngulfmentAssets(state);
    setRounds(state, [[scored(0, 1, 100, assets.map(item => direct(item.flame, item.instanceId, 2)))]]);
    expect(evaluateEngulfmentOffering(state, assets).offeringMultiplier).toBe(8);
    setRounds(state, [[scored(0, 1, 100, assets.map(item => direct(item.flame, item.instanceId, 3)))]]);
    expect(evaluateEngulfmentOffering(state, assets).offeringMultiplier).toBe(27);
  });

  it('qualifies a mixed Ember, Bonfire, and Wildfire offering only through its joint resolved effect', () => {
    const state = shopState('mixed-status', ['ultimate']);
    state.dice[0].flame = { id: 'minigun', investedGold: 25 };
    state.wildfires = [{ flame: 'hailMary', sacrificedFlame: 'vineyard', sacrificedAverage: 4,
      transferMultiplier: 4.75, resolved: { kind: 'xMult', baseMax: 5, max: 24 } }];
    const normalized = normalizeGameState(state);
    const assets = ownedEngulfmentAssets(normalized);
    setRounds(normalized, [[scored(0, 1, 1, assets.map(item => direct(item.flame, item.instanceId, item.kind === 'ember' ? 2 : 4, item.kind)))]]);
    expect(evaluateEngulfmentOffering(normalized, assets).offeringMultiplier).toBe(32);
    expect(engulfmentSucceeds(evaluateEngulfmentOffering(normalized, assets).offeringMultiplier)).toBe(true);
  });
});

describe('Charge group attribution', () => {
  it('credits only consumed Charge and removes one or multiple selected source increments jointly', () => {
    const state = shopState('charge', ['momentum', 'powerSurge']);
    const momentum = asset(state, 'momentum'); const surge = asset(state, 'powerSurge');
    const consumed = scored(0, 1, 100, [{ sourceId: 'charge', origin: 'charge', factor: 4.5,
      chargeSources: [
        { flame: 'momentum', instanceId: momentum.instanceId, origin: 'bonfire', attributed: .5, factor: 4.5 / 4 },
        { flame: 'powerSurge', instanceId: surge.instanceId, origin: 'bonfire', attributed: 3, factor: 3 },
      ] }]);
    expect(selectedOfferingFactor(consumed, new Set([momentum.instanceId]))).toBeCloseTo(4.5 / 4);
    expect(selectedOfferingFactor(consumed, new Set([surge.instanceId]))).toBe(3);
    expect(selectedOfferingFactor(consumed, new Set([momentum.instanceId, surge.instanceId]))).toBe(4.5);
    setRounds(state, [[consumed]]);
    expect(evaluateEngulfmentOffering(state, [momentum, surge]).offeringMultiplier).toBeCloseTo(4.5);

    setRounds(state, [[scored(0, 1, 100, [])]]);
    expect(evaluateEngulfmentOffering(state, [momentum, surge]).offeringMultiplier).toBe(1);
  });

  it('does not credit clipped Charge absent from the authoritative attribution ledger', () => {
    const state = shopState('charge-clipped', ['momentum']);
    const momentum = asset(state, 'momentum');
    const hand = scored(0, 1, 100, [{ sourceId: 'charge', origin: 'charge', factor: 5,
      chargeSources: [{ flame: 'momentum', instanceId: momentum.instanceId, origin: 'bonfire', attributed: .2, factor: 5 / 4.8 }] }]);
    expect(selectedOfferingFactor(hand, new Set([momentum.instanceId]))).toBeCloseTo(5 / 4.8);
  });

  it('records consumed Charge against the generating instances in authoritative hand history', () => {
    const state = newRun('charge-history', constant).state;
    state.bonfires = ['momentum', 'powerSurge'];
    state.chargeXMult = 4.5;
    state.chargeArmed = true;
    state.chargeAttribution = { momentum: .5, powerSurge: 3 };
    state.target = 999_999_999n;
    state.dice.forEach((die, index) => { die.value = (index + 1) as 1 | 2 | 3 | 4 | 5; });
    const resolver = new Resolver(state, constant);
    const momentumId = state.flameInstanceIds.momentum!;
    const surgeId = state.flameInstanceIds.powerSurge!;
    resolver.play('ones', [0]);
    const hand = [...state.historyV2].reverse().find(event => event.kind === 'hand_scored');
    expect(hand?.kind).toBe('hand_scored');
    if (hand?.kind !== 'hand_scored') throw new Error('Expected a scored hand.');
    const charge = hand.xMultContributions.find(item => item.sourceId === 'charge');
    expect(charge?.chargeSources).toEqual([
      { flame: 'momentum', instanceId: momentumId, origin: 'bonfire', attributed: .5, factor: 4.5 / 4 },
      { flame: 'powerSurge', instanceId: surgeId, origin: 'bonfire', attributed: 3, factor: 3 },
    ]);
  });
});

describe('Engulfment threshold, lifecycle, and consequences', () => {
  it('uses the exact hidden ×20 threshold without point, Chapter, count, or status requirements', () => {
    expect(ENGULFMENT_REQUIRED_MULTIPLIER).toBe(20);
    expect(engulfmentSucceeds(19.999999999)).toBe(false);
    expect(engulfmentSucceeds(20)).toBe(true);
    expect(engulfmentSucceeds(35)).toBe(true);
  });

  it('rejects a freshly promoted Bonfire with no evidence, preserving all build state except the Shop attempt', () => {
    const state = shopState('fresh-bonfire');
    const offered = asset(state, 'ultimate');
    const before = structuredClone(state);
    const result = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: [offered] }, constant);
    expect(result.state.engulfmentLevel).toBe(0);
    expect(result.state.bonfires).toEqual(before.bonfires);
    expect(result.state.flameInstanceIds).toEqual(before.flameInstanceIds);
    expect(result.state.gold).toBe(before.gold);
    expect(result.state.lives).toBe(before.lives);
    expect(result.state.shop!.engulfmentAttemptUsed).toBe(true);
    expect(result.state.historyV2.at(-1)).toMatchObject({ kind: 'engulfment_attempted', success: false,
      offeringMultiplier: 1, requiredMultiplier: 20, flamesSnuffed: [] });
  });

  it('snuffs a proven offering, unifies training, awards Inferno, and only forfeits an unfinished quest on success', () => {
    const state = shopState('success', ['ultimate', 'minigun']);
    const offered = asset(state, 'ultimate');
    setRounds(state, [[scored(0, 1, 100, [direct('ultimate', offered.instanceId, 20)])]]);
    UPPER_HAND_IDS.forEach((hand, index) => { state.handLevels[hand] = [13, 12, 14, 13, 10, 12][index]; });
    LOWER_HAND_IDS.forEach((hand, index) => { state.handLevels[hand] = index + 1; });
    state.hoodedFigure.active = { id: 'fiveAlive', issuedChapter: 1, target: 5,
      committed: { value: 1, keys: [], invalid: false, jackpotPaid: false },
      attempt: { value: 2, keys: [], invalid: false, jackpotPaid: false }, complete: false, dialogueLine: 'test' };
    const result = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: [offered] }, constant).state;
    expect(result.engulfmentLevel).toBe(1);
    expect(infernoMultiplier(result.engulfmentLevel)).toBe(25n);
    expect(result.bonfires).toEqual(['minigun']);
    expect(result.flameInstanceIds.ultimate).toBeUndefined();
    expect(UPPER_HAND_IDS.map(hand => result.handLevels[hand])).toEqual([12, 12, 12, 12, 12, 12]);
    expect(LOWER_HAND_IDS.map(hand => result.handLevels[hand])).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(result.hoodedFigure.active).toBeNull();
    expect(result.historyV2.at(-1)).toMatchObject({ kind: 'engulfment_attempted', success: true,
      offeringMultiplier: 20, requiredMultiplier: 20, infernoMultiplierBefore: 1n, infernoMultiplierAfter: 25n });
  });

  it('includes training bought earlier in the same Shop in the frozen averages', () => {
    let state = shopState('same-shop-training');
    const offered = asset(state, 'ultimate');
    setRounds(state, [[scored(0, 1, 100, [direct('ultimate', offered.instanceId, 20)])]]);
    state.gold = 100;
    state.handLevels.ones = 3;
    state.shop!.trainingOffers = [{ kind: 'hand', hand: 'ones', purchases: 0 }];
    state = dispatch(state, { type: 'TRAIN_HAND', hand: 'ones' }, constant).state;
    state = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: [asset(state, 'ultimate')] }, constant).state;
    expect(state.handLevels.ones).toBe(2);
    expect(UPPER_HAND_IDS.map(hand => state.handLevels[hand])).toEqual([2, 2, 2, 2, 2, 2]);
    expect(state.stats.trainingPurchasesTotal).toBe(1);
  });

  it('leaves an unoffered rewarded Wildfire and completed quest state untouched', () => {
    let state = shopState('rewarded-wildfire');
    state.wildfires = [{ flame: 'speedDemon', sacrificedFlame: 'momentum', sacrificedAverage: 5,
      transferMultiplier: 6, resolved: { kind: 'xMult', baseMax: 5, max: 30 } }];
    state.hoodedFigure.rewardedChapters = [1];
    state.hoodedFigure.active = null;
    state = normalizeGameState(state);
    const offered = asset(state, 'ultimate');
    setRounds(state, [[scored(0, 1, 100, [direct('ultimate', offered.instanceId, 20)])]]);
    const wildfireBefore = structuredClone(state.wildfires);
    state = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: [offered] }, constant).state;
    expect(state.wildfires).toEqual(wildfireBefore);
    expect(state.hoodedFigure.rewardedChapters).toEqual([1]);
    expect(state.historyV2.at(-1)).toMatchObject({ kind: 'engulfment_attempted', questForfeited: false });
  });

  it('does not reset evidence after success and permits another qualifying group in a later Shop', () => {
    let state = shopState('no-reset', ['ultimate', 'minigun']);
    const first = asset(state, 'ultimate'); const second = asset(state, 'minigun');
    setRounds(state, [[scored(0, 1, 100, [direct('ultimate', first.instanceId, 20), direct('minigun', second.instanceId, 20)])]]);
    state = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: [first] }, constant).state;
    new Resolver(state, constant).openShop();
    const remaining = asset(state, 'minigun');
    expect(evaluateEngulfmentOffering(state, [remaining]).offeringMultiplier).toBe(20);
    state = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: [remaining] }, constant).state;
    expect(state.engulfmentLevel).toBe(2);
  });

  it('preserves successful Engulfment consequences through Time Travel and Bad Dream rewinds', () => {
    let state = shopState('rewind-persistence');
    const offered = asset(state, 'ultimate');
    setRounds(state, [[scored(0, 1, 100, [direct('ultimate', offered.instanceId, 20)])]]);
    state.hoodedFigure.issuedChapters = [1];
    state.hoodedFigure.active = { id: 'fiveAlive', issuedChapter: 1, target: 5,
      committed: { value: 1, keys: [], invalid: false, jackpotPaid: false },
      attempt: { value: 2, keys: [], invalid: false, jackpotPaid: false }, complete: false, dialogueLine: 'test' };
    state = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: [offered] }, constant).state;
    const unified = structuredClone(state.handLevels);

    state.specialOffer = { offers: [{ id: 99, type: 'timeTravel' }], acquired: false };
    state.phase = 'specialOffer';
    state.shop = null;
    state.round = 4;
    state = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 99 }, constant).state;
    expect(state.engulfmentLevel).toBe(1);
    expect(state.bonfires).toEqual([]);
    expect(state.handLevels).toEqual(unified);
    expect(state.hoodedFigure.active).toBeNull();
    expect(state.hoodedFigure.forfeitedChapters).toEqual([1]);

    state.specialOfferEffects.badDreamRounds = 1;
    state.badDreamCheckpoint = { chapter: 1, hoodedChallenge: null };
    state.lives = 1;
    state.score = 0n;
    state.target = 1_000_000n;
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    new Resolver(state, constant).evaluate();
    expect(state.phase).toBe('shop');
    expect(state.engulfmentLevel).toBe(1);
    expect(state.bonfires).toEqual([]);
    expect(state.handLevels).toEqual(unified);
    expect(state.hoodedFigure.active).toBeNull();
    expect(state.hoodedFigure.forfeitedChapters).toEqual([1]);
    expect(state.shop!.engulfmentAttemptUsed).toBe(false);
  });

  it('keeps a successful Engulfment through a later ordinary Bust and grants a fresh Shop visit', () => {
    let state = shopState('post-engulfment-bust');
    const offered = asset(state, 'ultimate');
    setRounds(state, [[scored(0, 1, 100, [direct('ultimate', offered.instanceId, 20)])]]);
    state = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: [offered] }, constant).state;
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant).state;
    const unified = structuredClone(state.handLevels);
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    state.score = 0n;
    state.target = 1_000_000n;
    new Resolver(state, constant).evaluate();
    expect(state.phase).toBe('shop');
    expect(state.engulfmentLevel).toBe(1);
    expect(state.bonfires).toEqual([]);
    expect(state.handLevels).toEqual(unified);
    expect(state.shop).toMatchObject({ engulfmentAttemptUsed: false });
    expect(state.shop!.visitId).not.toBe(1);
  });

  it('persists instance and per-Shop attempt identity without refreshing on load', () => {
    const state = shopState('persistence');
    const offered = asset(state, 'ultimate');
    const failed = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: [offered] }).state;
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(savePersistedRun(storage, failed)).toBe(true);
    expect(JSON.parse(values.get(RUN_STORAGE_KEY)!).version).toBe(RUN_STORAGE_VERSION);
    const loaded = loadPersistedRun(storage, null)!;
    expect(loaded.shop).toMatchObject({ visitId: 1, engulfmentAttemptUsed: true });
    expect(loaded.flameInstanceIds).toEqual(failed.flameInstanceIds);
    expect(loaded.nextFlameInstanceId).toBe(failed.nextFlameInstanceId);
  });

  it('deterministically assigns lifecycle identities when migrating an older save', () => {
    const state = shopState('legacy-instance-migration', ['minigun', 'ultimate']);
    state.dice[0].flame = { id: 'hailMary', investedGold: 30 };
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    savePersistedRun(storage, normalizeGameState(state));
    const legacy = JSON.parse(values.get(RUN_STORAGE_KEY)!);
    legacy.version = 5;
    delete legacy.state.flameInstanceIds;
    delete legacy.state.nextFlameInstanceId;
    values.set(RUN_STORAGE_KEY, JSON.stringify(legacy));
    const first = loadPersistedRun(storage, null)!;
    const second = loadPersistedRun(storage, null)!;
    expect(first.flameInstanceIds).toEqual(second.flameInstanceIds);
    expect(Object.keys(first.flameInstanceIds).sort()).toEqual(['hailMary', 'minigun', 'ultimate']);
    expect(new Set(Object.values(first.flameInstanceIds)).size).toBe(3);
    expect(first.nextFlameInstanceId).toBeGreaterThan(Math.max(...Object.values(first.flameInstanceIds) as number[]));
  });

  it('keeps availability gated by Shop plus Bonfire/Wildfire, while allowing any owned status in the offering', () => {
    let state = shopState('availability', []);
    state.dice[0].flame = { id: 'ultimate', investedGold: 50 };
    state = normalizeGameState(state);
    expect(engulfmentAvailable(state)).toBe(false);
    state.bonfires = ['minigun'];
    state = normalizeGameState(state);
    expect(engulfmentAvailable(state)).toBe(true);
    expect(ownedEngulfmentAssets(state).map(item => item.kind)).toEqual(['ember', 'bonfire']);
  });

  it('preserves the quest warning and training normalization rules', () => {
    const state = shopState('quest');
    expect(engulfmentHasQuestWarning(state)).toBe(false);
    state.hoodedFigure.active = { id: 'fiveAlive', issuedChapter: 1, target: 5,
      committed: { value: 0, keys: [], invalid: false, jackpotPaid: false },
      attempt: { value: 0, keys: [], invalid: false, jackpotPaid: false }, complete: false, dialogueLine: 'test' };
    expect(engulfmentHasQuestWarning(state)).toBe(true);
    LOWER_HAND_IDS.forEach((hand, index) => { state.handLevels[hand] = index + 1; });
    expect(engulfmentTrainingNormalization(state.handLevels).lower.unifiedLevel).toBe(5);
  });

  it('drives a deterministic monotonic hidden ritual meter from multiplier/20', () => {
    const values = [1, 10, 19.9, 20, 25, 40].map(engulfmentAnimationProfile);
    expect(values.map(item => item.peakPercent)).toEqual([5, 50, 99, 100, 100, 100]);
    expect(values.map(item => item.success)).toEqual([false, false, false, true, true, true]);
    expect(values.map(item => item.strength)).toEqual(['very_weak', 'moderate', 'near', 'bare', 'strong', 'massive']);
    expect(values.map(item => item.durationMs)).toEqual([2100, 2700, 4000, 3800, 2300, 1400]);
  });
});

describe('Inferno scoring regression', () => {
  function scoreAt(level: number, doubleTime = false) {
    const state = newRun(`inferno-score-${level}-${doubleTime}`, constant).state;
    state.engulfmentLevel = level;
    state.target = 1_000_000n;
    state.dice[0].value = 1;
    if (doubleTime) state.dice[0].faces[0].enhancements.doubleTime = 1;
    return dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, doubleTime ? { next: () => 0 } : constant).state;
  }

  it('keeps ×1 identical and applies ×25/×625 once at authoritative final rounding', () => {
    const base = scoreAt(0);
    const one = scoreAt(1);
    const two = scoreAt(2);
    expect(one.score).toBe(BigInt(base.score * 25n));
    expect(two.score).toBe(BigInt(base.score * 625n));
    expect(one.stats.handScores[0].infernoMultiplier).toBe(BigInt(25n));
    expect(two.historyV2.find(event => event.kind === 'hand_scored')).toMatchObject({ score: { infernoMultiplier: 625n } });
    expect(infernoMultiplier(2)).toBe(625n);
  });

  it('flows through Jumping Bean, Hitchhiker, and Double Time without multiplying economy or build values', () => {
    const bean = newRun('inferno-bean', constant).state;
    bean.engulfmentLevel = 1;
    bean.target = 1_000_000n;
    bean.dice[0].value = 1;
    new Resolver(bean, constant).play('ones', [0], 'jumpingBean');
    expect(bean.stats.handScores.at(-1)).toMatchObject({ playSource: 'jumpingBean', infernoMultiplier: 25n });

    expect(scoreAt(1, true).score).toBe(BigInt(scoreAt(0, true).score * 25n));
    const hitchhikerAt = (level: number) => {
      const state = newRun(`inferno-hitchhiker-${level}`, constant).state;
      state.engulfmentLevel = level;
      state.target = 1_000_000n;
      state.dice[0].value = 1;
      state.dice[1].value = 2;
      state.dice[1].faces[1].enhancements.hitchhiker = 1;
      return dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, { next: () => 0 }).state;
    };
    expect(hitchhikerAt(1).score).toBe(BigInt(hitchhikerAt(0).score * 25n));

    const economyAt = (level: number) => {
      const state = newRun(`inferno-economy-${level}`, constant).state;
      state.engulfmentLevel = level;
      state.target = 1n;
      state.stats.rounds[0].target = 1n;
      state.dice[0].value = 1;
      state.dice[0].faces[0].enhancements = { golden: 1, jackpot: 1, vintage: 1 };
      state.dice[1].flame = { id: 'momentum', investedGold: 40 };
      state.handLevels.twos = 7;
      return dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant).state;
    };
    const baseEconomy = economyAt(0);
    const infernoEconomy = economyAt(1);
    expect(infernoEconomy.stats.goldBySource).toMatchObject({ golden: 1, jackpot: 3 });
    expect(infernoEconomy.gold).toBe(baseEconomy.gold);
    expect(infernoEconomy.dice[0].faces[0].vintageSellValue).toBe(baseEconomy.dice[0].faces[0].vintageSellValue);
    expect(infernoEconomy.dice[1].flame).toEqual(baseEconomy.dice[1].flame);
    expect(infernoEconomy.handLevels.twos).toBe(baseEconomy.handLevels.twos);
    expect(infernoEconomy.chargeXMult).toBe(baseEconomy.chargeXMult);
  });

  it('composes with the existing Boss factor without changing Boss mechanics', () => {
    const againstFly = (level: number) => {
      const state = newRun(`inferno-fly-${level}`, constant).state;
      state.engulfmentLevel = level;
      state.target = 1_000_000n;
      state.dice[0].value = 1;
      state.boss = { type: 'fly', flyHand: 'pair', caught: false, moves: 0 };
      return dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant).state.stats.handScores[0];
    };
    const base = againstFly(0);
    const inferno = againstFly(1);
    expect(base.bossFactor).toBe(.5);
    expect(inferno.bossFactor).toBe(.5);
    expect(inferno.score).toBe(BigInt(base.score * 25n));
  });
});
