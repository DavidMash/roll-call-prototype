import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import {
  ENGULFMENT_REQUIRED_FUEL, engulfmentAnimationProfile, engulfmentAvailable, engulfmentFuel,
  engulfmentHasQuestWarning, engulfmentImportance, engulfmentSucceeds, engulfmentTrainingNormalization, infernoMultiplier,
  recentFlameContributions, valueEngulfmentOffering,
} from './engulfment';
import { HAND_IDS, LOWER_HAND_IDS, UPPER_HAND_IDS } from './hands';
import { loadPersistedRun, RUN_STORAGE_KEY, RUN_STORAGE_VERSION, savePersistedRun } from './persistence';
import type { XMultContribution, RunHistoryV2Event } from './runHistoryV2';
import type { EngulfmentAssetRef, GameState, RandomSource } from './types';

const constant: RandomSource = { next: () => 0.99 };

function shopState(seed = 'engulfment'): GameState {
  const state = newRun(seed, constant).state;
  state.phase = 'shop';
  state.shop = { visitId: 1, engulfmentAttemptUsed: false, kind: 'between_rounds', exitUnlocked: true,
    offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
  state.nextShopVisitId = 2;
  return state;
}

function scored(seq: number, round: number, xMultContributions: XMultContribution[], awarded = 1000): RunHistoryV2Event {
  return { seq, kind: 'hand_scored', round, attempt: 1, actionId: seq, timelineId: 0,
    hand: 'ones', level: 1, playSource: 'manual', selectedDice: [0], scoringDice: [], consumed: true,
    score: { infernoMultiplier: 1, basePips: 10, finalPips: 10, baseMult: 10, finalMult: 10,
      finalXMult: 10, bossFactor: 1, raw: awarded, awarded, rounding: { mode: 'nearest_integer', delta: 0 } },
    roundScore: { before: 0, afterAward: awarded, after: awarded }, pipsContributions: [], multContributions: [],
    xMultContributions, checks: [], sideEffects: [] };
}

function cleared(seq: number, round: number, timelineId = 0): RunHistoryV2Event {
  return { seq, kind: 'round_attempt_finished', round, attempt: 1, actionId: seq, timelineId,
    outcome: 'cleared', score: 1000, target: 1, boss: null, livesBefore: 3, livesAfter: 3 };
}

describe('Engulfment Fuel', () => {
  it('normalizes importance and clamps at a 35% contribution share', () => {
    expect(engulfmentImportance(0, 100)).toBe(0);
    expect(engulfmentImportance(17.5, 100)).toBeCloseTo(0.5);
    expect(engulfmentImportance(35, 100)).toBe(1);
    expect(engulfmentImportance(80, 100)).toBe(1);
    expect(engulfmentImportance(10, 0)).toBe(0);
  });

  it('uses the exact hidden formulas for Embers, Bonfires, and Wildfires', () => {
    expect(engulfmentFuel('ember', 0, 0)).toBe(0);
    expect(engulfmentFuel('ember', 100, 0)).toBe(20);
    expect(engulfmentFuel('ember', 0, 1)).toBe(10);
    expect(engulfmentFuel('ember', 100, 1)).toBe(30);
    expect(engulfmentFuel('bonfire', 100, 0)).toBe(35);
    expect(engulfmentFuel('bonfire', 100, 1)).toBe(60);
    expect(engulfmentFuel('wildfire', 100, 0)).toBe(70);
    expect(engulfmentFuel('wildfire', 100, 1)).toBe(110);
    expect(engulfmentFuel('wildfire', 100, 0.75)).toBeGreaterThanOrEqual(100);
  });

  it('uses an invariant 100-Fuel threshold and discards overpayment', () => {
    expect(ENGULFMENT_REQUIRED_FUEL).toBe(100);
    expect(engulfmentSucceeds(99)).toBe(false);
    expect(engulfmentSucceeds(100)).toBe(true);
    expect(engulfmentSucceeds(150)).toBe(true);
    expect(3 * engulfmentFuel('bonfire', 100, 0)).toBeGreaterThan(100);
    expect(2 * engulfmentFuel('bonfire', 100, 0)).toBeLessThan(100);
    expect(2 * engulfmentFuel('bonfire', 100, 0.7)).toBeGreaterThanOrEqual(100);
    expect(engulfmentFuel('wildfire', 100, 0.6) + engulfmentFuel('ember', 100, 0.4)).toBeGreaterThanOrEqual(100);
  });

  it('uses only the last six canonical cleared rounds and attributes consumed Charge downstream', () => {
    const state = shopState('recent-contribution');
    state.bonfires = ['ultimate', 'momentum'];
    state.historyV2 = [];
    let seq = 0;
    for (let round = 1; round <= 7; round++) {
      state.historyV2.push(scored(seq++, round, round === 1
        ? [{ sourceId: 'ultimate', origin: 'bonfire', factor: 10 }]
        : [{ sourceId: 'charge', origin: 'charge', factor: 2, chargeSources: [{ flame: 'momentum', factor: 2 }] }]));
      state.historyV2.push(cleared(seq++, round));
    }
    const contributions = recentFlameContributions(state);
    expect(contributions.ultimate ?? 0).toBe(0);
    expect(contributions.momentum).toBe(3000);
    const values = valueEngulfmentOffering(state, [{ kind: 'bonfire', flame: 'ultimate' }, { kind: 'bonfire', flame: 'momentum' }]);
    expect(values[0]).toMatchObject({ recentContribution: 0, contributionShare: 0, importance: 0, fuel: 35 });
    expect(values[1]).toMatchObject({ recentContribution: 3000, contributionShare: 1, importance: 1, fuel: 60 });
  });

  it('ignores abandoned clears when deriving recent contribution', () => {
    const state = shopState('canonical-contribution');
    state.bonfires = ['ultimate', 'minigun'];
    state.historyV2 = [
      scored(0, 1, [{ sourceId: 'ultimate', origin: 'bonfire', factor: 10 }]), cleared(1, 1),
      { seq: 2, kind: 'checkpoint_restored', round: 1, attempt: 2, actionId: 2, timelineId: 1,
        reason: 'bust', fromTimelineId: 0, toTimelineId: 1, abandonedFromSeq: 0, abandonedThroughSeq: 1,
        canonicalRound: 1, canonicalAttempt: 2 },
      { ...scored(3, 1, [{ sourceId: 'minigun', origin: 'bonfire', factor: 2 }]), timelineId: 1, attempt: 2 },
      { ...cleared(4, 1, 1), attempt: 2 },
    ];
    expect(recentFlameContributions(state)).toMatchObject({ minigun: 500 });
    expect(recentFlameContributions(state).ultimate ?? 0).toBe(0);
  });

  it('drives a deterministic, monotonic non-numeric ritual profile', () => {
    const fuels = [30, 70, 99, 100, 130, 200];
    const profiles = fuels.map(engulfmentAnimationProfile);
    expect(profiles.map(profile => profile.strength)).toEqual(['very_weak', 'moderate', 'near', 'bare', 'strong', 'massive']);
    expect(profiles.map(profile => profile.peakPercent)).toEqual([30, 70, 99, 100, 100, 100]);
    expect(profiles.map(profile => profile.durationMs)).toEqual([...profiles].map(profile => profile.durationMs).sort((a, b) => b - a));
  });
});

describe('Engulfment availability and Shop visits', () => {
  it('requires a Shop plus at least one Bonfire or Wildfire, not only an Ember', () => {
    const state = shopState('availability');
    expect(engulfmentAvailable(state)).toBe(false);
    state.dice[0].flame = { id: 'ultimate', investedGold: 50 };
    expect(engulfmentAvailable(state)).toBe(false);
    state.bonfires = ['minigun'];
    expect(engulfmentAvailable(state)).toBe(true);
    state.bonfires = []; state.wildfires = [{ flame: 'minigun', sacrificedFlame: 'ultimate', sacrificedAverage: 1,
      transferMultiplier: 1, resolved: { kind: 'xMult', baseMax: 5, max: 5 } }];
    expect(engulfmentAvailable(state)).toBe(true);
    state.shop!.engulfmentAttemptUsed = true;
    expect(engulfmentAvailable(state)).toBe(false);
  });

  it('does not consume an attempt until commit, then blocks another attempt in the same visit', () => {
    const state = shopState('attempt-lifecycle');
    state.bonfires = ['ultimate', 'minigun'];
    expect(state.shop!.engulfmentAttemptUsed).toBe(false);
    const failed = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: [{ kind: 'bonfire', flame: 'ultimate' }] });
    expect(failed.error).toBeUndefined();
    expect(failed.state.shop!.engulfmentAttemptUsed).toBe(true);
    expect(dispatch(failed.state, { type: 'ATTEMPT_ENGULFMENT', assets: [] }).error).toMatch(/already been attempted/i);
  });

  it('warns only for the current Chapter\'s unfinished quest', () => {
    const state = shopState('quest-warning');
    expect(engulfmentHasQuestWarning(state)).toBe(false);
    state.hoodedFigure.active = { id: 'fiveAlive', issuedChapter: 1, target: 5,
      committed: { value: 0, keys: [], invalid: false, jackpotPaid: false },
      attempt: { value: 0, keys: [], invalid: false, jackpotPaid: false }, complete: false, dialogueLine: 'test' };
    expect(engulfmentHasQuestWarning(state)).toBe(true);
    state.hoodedFigure.active.complete = true;
    expect(engulfmentHasQuestWarning(state)).toBe(false);
    state.hoodedFigure.active.complete = false;
    state.hoodedFigure.active.issuedChapter = 2;
    expect(engulfmentHasQuestWarning(state)).toBe(false);
  });

  it('persists the current visit and attempt state, while genuine new and Bust-return visits refresh it', () => {
    const state = shopState('visit-persistence');
    state.bonfires = ['ultimate', 'minigun'];
    const failed = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: [] }).state;
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(savePersistedRun(storage, failed)).toBe(true);
    expect(JSON.parse(values.get(RUN_STORAGE_KEY)!).version).toBe(RUN_STORAGE_VERSION);
    const loaded = loadPersistedRun(storage, null)!;
    expect(loaded.shop).toMatchObject({ visitId: 1, engulfmentAttemptUsed: true });
    const resolver = new Resolver(loaded, constant);
    resolver.openShop();
    expect(loaded.shop).toMatchObject({ visitId: 2, engulfmentAttemptUsed: false });

    loaded.bonfires = ['ultimate', 'minigun'];
    loaded.phase = 'round';
    resolver.startRound();
    loaded.consumed = [...HAND_IDS]; loaded.manualRerollsRemaining = 0; loaded.score = 0; loaded.target = 1_000_000;
    resolver.evaluate();
    expect(loaded.phase).toBe('shop');
    expect(loaded.shop!.engulfmentAttemptUsed).toBe(false);
    expect(loaded.shop!.visitId).toBe(3);
  });
});

describe('Engulfment state transition', () => {
  it('failure changes only attempt state and telemetry', () => {
    const state = shopState('failure');
    state.bonfires = ['ultimate', 'minigun'];
    state.dice[0].flame = { id: 'hailMary', investedGold: 40 };
    state.handLevels.ones = 9;
    state.hoodedFigure.active = { id: 'fiveAlive', issuedChapter: 1, target: 5,
      committed: { value: 1, keys: [], invalid: false, jackpotPaid: false },
      attempt: { value: 2, keys: [], invalid: false, jackpotPaid: false }, complete: false, dialogueLine: 'test' };
    const before = structuredClone(state);
    const result = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: [
      { kind: 'bonfire', flame: 'ultimate' }, { kind: 'bonfire', flame: 'minigun' },
    ] });
    expect(result.state.shop!.engulfmentAttemptUsed).toBe(true);
    expect(result.state.engulfmentLevel).toBe(0);
    expect(result.state.bonfires).toEqual(before.bonfires);
    expect(result.state.dice).toEqual(before.dice);
    expect(result.state.handLevels).toEqual(before.handLevels);
    expect(result.state.hoodedFigure.active).toEqual(before.hoodedFigure.active);
    expect(result.state.gold).toBe(before.gold);
    expect(result.state.lives).toBe(before.lives);
    const event = result.state.historyV2.at(-1);
    expect(event).toMatchObject({ kind: 'engulfment_attempted', success: false, totalOfferedFuel: 70,
      requiredFuel: 100, flamesSnuffed: [], questForfeited: false, returnedToShop: true });
  });

  it('success snuffs only selected assets, increments Inferno once, unifies levels, and forfeits an unfinished quest', () => {
    const state = shopState('success');
    state.gold = 77; state.lives = 2;
    state.bonfires = ['ultimate', 'speedDemon'];
    state.wildfires = [{ flame: 'minigun', sacrificedFlame: 'hailMary', sacrificedAverage: 1,
      transferMultiplier: 1, resolved: { kind: 'xMult', baseMax: 5, max: 5 } }];
    state.dice[0].flame = { id: 'momentum', investedGold: 0 };
    const upper = [13, 12, 14, 13, 10, 12];
    UPPER_HAND_IDS.forEach((hand, index) => { state.handLevels[hand] = upper[index]; });
    LOWER_HAND_IDS.forEach((hand, index) => { state.handLevels[hand] = index + 1; });
    state.handPlayCounts.ones = 19;
    state.dice[1].faces[0].enhancements.workout = 1;
    state.dice[1].faces[0].workoutPips = 7;
    state.hoodedFigure.issuedChapters = [1];
    state.hoodedFigure.active = { id: 'fiveAlive', issuedChapter: 1, target: 5,
      committed: { value: 1, keys: [], invalid: false, jackpotPaid: false },
      attempt: { value: 2, keys: [], invalid: false, jackpotPaid: false }, complete: false, dialogueLine: 'test' };
    const assets: EngulfmentAssetRef[] = [
      { kind: 'ember', flame: 'momentum', dieId: 0 },
      { kind: 'bonfire', flame: 'ultimate' },
      { kind: 'wildfire', flame: 'minigun' },
    ];
    const result = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets });
    expect(result.error).toBeUndefined();
    const next = result.state;
    expect(next.engulfmentLevel).toBe(1);
    expect(infernoMultiplier(next.engulfmentLevel)).toBe(25);
    expect(next.dice[0].flame).toBeNull();
    expect(next.bonfires).toEqual(['speedDemon']);
    expect(next.wildfires).toEqual([]);
    expect(UPPER_HAND_IDS.map(hand => next.handLevels[hand])).toEqual([12, 12, 12, 12, 12, 12]);
    expect(LOWER_HAND_IDS.map(hand => next.handLevels[hand])).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(next.handPlayCounts.ones).toBe(19);
    expect(next.dice[1].faces[0]).toMatchObject({ workoutPips: 7, enhancements: { workout: 1 } });
    expect(next.hoodedFigure.active).toBeNull();
    expect(next.hoodedFigure.forfeitedChapters).toContain(1);
    expect(next.gold).toBe(77); expect(next.lives).toBe(2);
    expect(next.shop).toMatchObject({ visitId: 1, engulfmentAttemptUsed: true });
    expect(dispatch(next, { type: 'ATTEMPT_ENGULFMENT', assets: [] }).error).toMatch(/already been attempted/i);
    const event = next.historyV2.at(-1);
    expect(event).toMatchObject({ kind: 'engulfment_attempted', success: true, infernoLevelBefore: 0,
      infernoLevelAfter: 1, infernoMultiplierBefore: 1, infernoMultiplierAfter: 25,
      totalOfferedFuel: 105, overpayment: 5, questForfeited: true, forfeitedQuestId: 'fiveAlive', returnedToShop: true });
  });

  it('normalizes exactly six Upper and eight Lower hands with nearest-integer rounding', () => {
    const state = shopState('normalization');
    UPPER_HAND_IDS.forEach((hand, index) => { state.handLevels[hand] = [13, 12, 14, 13, 10, 12][index]; });
    LOWER_HAND_IDS.forEach((hand, index) => { state.handLevels[hand] = index + 1; });
    const result = engulfmentTrainingNormalization(state.handLevels);
    expect(result.upper.levelsBefore).toHaveLength(6);
    expect(result.upper.average).toBeCloseTo(12.333333);
    expect(result.upper.unifiedLevel).toBe(12);
    expect(result.lower.levelsBefore).toHaveLength(8);
    expect(result.lower.average).toBe(4.5);
    expect(result.lower.unifiedLevel).toBe(5);
  });

  it('includes training bought earlier in the same Shop in the frozen averages', () => {
    const state = shopState('same-shop-training');
    state.gold = 100;
    state.bonfires = ['ultimate', 'minigun', 'hailMary'];
    state.handLevels.ones = 3;
    state.shop!.trainingOffers = [{ kind: 'hand', hand: 'ones', purchases: 0 }];
    const trained = dispatch(state, { type: 'TRAIN_HAND', hand: 'ones' }).state;
    const result = dispatch(trained, { type: 'ATTEMPT_ENGULFMENT', assets: trained.bonfires
      .map(flame => ({ kind: 'bonfire' as const, flame })) }).state;
    expect(result.handLevels.ones).toBe(2);
    expect(UPPER_HAND_IDS.map(hand => result.handLevels[hand])).toEqual([2, 2, 2, 2, 2, 2]);
    expect(result.stats.trainingPurchasesTotal).toBe(1);
  });

  it('leaves a previously rewarded Wildfire and completed quest untouched unless selected', () => {
    const state = shopState('rewarded-quest');
    state.bonfires = ['ultimate', 'minigun', 'hailMary'];
    state.wildfires = [{ flame: 'speedDemon', sacrificedFlame: 'momentum', sacrificedAverage: 1,
      transferMultiplier: 1, resolved: { kind: 'xMult', baseMax: 5, max: 5 } }];
    state.hoodedFigure.rewardedChapters = [1];
    state.hoodedFigure.active = null;
    const result = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: state.bonfires
      .map(flame => ({ kind: 'bonfire' as const, flame })) }).state;
    expect(result.wildfires).toEqual(state.wildfires);
    expect(result.hoodedFigure.rewardedChapters).toEqual([1]);
    expect(result.historyV2.at(-1)).toMatchObject({ kind: 'engulfment_attempted', questForfeited: false });
  });

  it('preserves successful Engulfment through Bust, Time Travel, and Bad Dream progression rewinds', () => {
    const state = shopState('rewinds');
    state.bonfires = ['ultimate', 'minigun', 'hailMary'];
    state.hoodedFigure.issuedChapters = [1];
    state.hoodedFigure.active = { id: 'fiveAlive', issuedChapter: 1, target: 5,
      committed: { value: 1, keys: [], invalid: false, jackpotPaid: false },
      attempt: { value: 2, keys: [], invalid: false, jackpotPaid: false }, complete: false, dialogueLine: 'test' };
    let current = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: state.bonfires.map(flame => ({ kind: 'bonfire' as const, flame })) }).state;
    const unified = structuredClone(current.handLevels);
    expect(current.hoodedFigure.active).toBeNull();
    expect(current.hoodedFigure.forfeitedChapters).toEqual([1]);

    current.specialOffer = { offers: [{ id: 99, type: 'timeTravel' }], acquired: false };
    current.phase = 'specialOffer'; current.round = 4;
    current = dispatch(current, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 99 }).state;
    expect(current.engulfmentLevel).toBe(1);
    expect(current.bonfires).toEqual([]);
    expect(current.handLevels).toEqual(unified);
    expect(current.hoodedFigure.active).toBeNull();
    expect(current.hoodedFigure.forfeitedChapters).toEqual([1]);

    current.specialOfferEffects.badDreamRounds = 1;
    current.badDreamCheckpoint = { chapter: 1, hoodedChallenge: null };
    current.lives = 1; current.score = 0; current.target = 1_000_000; current.consumed = [...HAND_IDS]; current.manualRerollsRemaining = 0;
    new Resolver(current, constant).evaluate();
    expect(current.phase).toBe('shop');
    expect(current.engulfmentLevel).toBe(1);
    expect(current.bonfires).toEqual([]);
    expect(current.handLevels).toEqual(unified);
    expect(current.hoodedFigure.active).toBeNull();
    expect(current.hoodedFigure.forfeitedChapters).toEqual([1]);
    expect(current.shop!.engulfmentAttemptUsed).toBe(false);
  });

  it('keeps a successful Shop Engulfment after a later ordinary Bust and grants a fresh visit', () => {
    const state = shopState('post-engulfment-bust');
    state.bonfires = ['ultimate', 'minigun', 'hailMary'];
    let current = dispatch(state, { type: 'ATTEMPT_ENGULFMENT', assets: state.bonfires
      .map(flame => ({ kind: 'bonfire' as const, flame })) }).state;
    current = dispatch(current, { type: 'NEXT_ROUND' }, constant).state;
    const unified = structuredClone(current.handLevels);
    current.consumed = [...HAND_IDS]; current.manualRerollsRemaining = 0; current.score = 0; current.target = 1_000_000;
    new Resolver(current, constant).evaluate();
    expect(current.phase).toBe('shop');
    expect(current.engulfmentLevel).toBe(1);
    expect(current.bonfires).toEqual([]);
    expect(current.handLevels).toEqual(unified);
    expect(current.shop!.engulfmentAttemptUsed).toBe(false);
    expect(current.shop!.visitId).not.toBe(1);
  });
});

describe('Inferno scoring layer', () => {
  function scoreAt(level: number, doubleTime = false) {
    const state = newRun(`inferno-score-${level}-${doubleTime}`, constant).state;
    state.engulfmentLevel = level; state.target = 1_000_000;
    state.dice[0].value = 1;
    if (doubleTime) state.dice[0].faces[0].enhancements.doubleTime = 1;
    return dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, doubleTime ? { next: () => 0 } : constant).state;
  }

  it('keeps ×1 identical and applies ×25/×625 once at authoritative final rounding', () => {
    const base = scoreAt(0);
    const one = scoreAt(1);
    const two = scoreAt(2);
    expect(one.score).toBe(base.score * 25);
    expect(two.score).toBe(base.score * 625);
    expect(one.stats.handScores[0].infernoMultiplier).toBe(25);
    expect(two.historyV2.find(event => event.kind === 'hand_scored')).toMatchObject({ score: { infernoMultiplier: 625 } });
  });

  it('flows through Jumping Bean, Hitchhiker, and Double Time without multiplying economy or build values', () => {
    const bean = newRun('inferno-bean', constant).state;
    bean.engulfmentLevel = 1; bean.target = 1_000_000; bean.dice[0].value = 1;
    const resolver = new Resolver(bean, constant);
    resolver.play('ones', [0], 'jumpingBean');
    expect(bean.stats.handScores.at(-1)).toMatchObject({ playSource: 'jumpingBean', infernoMultiplier: 25 });

    const baseDouble = scoreAt(0, true);
    const infernoDouble = scoreAt(1, true);
    expect(infernoDouble.score).toBe(baseDouble.score * 25);

    const hitchhikerAt = (level: number) => {
      const state = newRun(`inferno-hitchhiker-${level}`, constant).state;
      state.engulfmentLevel = level; state.target = 1_000_000; state.dice[0].value = 1; state.dice[1].value = 2;
      state.dice[1].faces[1].enhancements.hitchhiker = 1;
      return dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, { next: () => 0 }).state;
    };
    expect(hitchhikerAt(1).score).toBe(hitchhikerAt(0).score * 25);

    const economyAt = (level: number) => {
      const state = newRun(`inferno-economy-${level}`, constant).state;
      state.engulfmentLevel = level; state.target = 1; state.stats.rounds[0].target = 1; state.dice[0].value = 1;
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
    const scoreAgainstFly = (level: number) => {
      const state = newRun(`inferno-fly-${level}`, constant).state;
      state.engulfmentLevel = level; state.target = 1_000_000; state.dice[0].value = 1;
      state.boss = { type: 'fly', flyHand: 'pair', caught: false, moves: 0 };
      return dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant).state.stats.handScores[0];
    };
    const base = scoreAgainstFly(0);
    const inferno = scoreAgainstFly(1);
    expect(base.bossFactor).toBe(0.5);
    expect(inferno.bossFactor).toBe(0.5);
    expect(inferno.score).toBe(base.score * 25);
  });
});
