import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { HAND_IDS } from './hands';
import { postBossRewardForRound, routeThrough } from './progression';
import { loadPersistedRun, savePersistedRun } from './persistence';
import { SPECIAL_OFFER_COLOR, SPECIAL_OFFERS, specialOfferEligible } from './specialOffers';
import { SCREEN_THEMES } from './screenThemes';
import type { GameState, HandId, RandomSource, RoundSummary, SpecialOfferType } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });

function offerState(type: SpecialOfferType, hand?: HandId): GameState {
  const state = newRun(`offer-${type}`, constant(.2)).state;
  state.phase = 'specialOffer';
  state.round = 6;
  state.shop = null;
  state.flameSelection = null;
  state.specialOffer = { offers: [{ id: 100, type, hand }], acquired: false };
  return state;
}

const choose = (type: SpecialOfferType, hand?: HandId, random: RandomSource = constant()) =>
  dispatch(offerState(type, hand), { type: 'CHOOSE_SPECIAL_OFFER', offerId: 100 }, random).state;

function summary(round: number): RoundSummary {
  return { round, encounterType: 'boss', bossType: 'caller', score: 1, target: 1, goldBefore: 0, goldAfter: 0,
    totalGoldEarned: 0, sources: { baseRewardGold: 0, unusedRerollGold: 0, interestGold: 0,
      bossRewardGold: 0, goldenGold: 0, jackpotGold: 0, otherGold: 0 } };
}

describe('alternating Special Offer progression', () => {
  it('alternates Flame Selection and Special Offer after successive Bosses', () => {
    expect([3, 6, 9, 12, 15, 18].map(postBossRewardForRound))
      .toEqual(['flame', 'specialOffer', 'flame', 'specialOffer', 'flame', 'specialOffer']);
    const route = routeThrough('offers-route', 12);
    expect(route.filter(node => node.type === 'flame_selection').map(node => node.round)).toEqual([3, 9]);
    expect(route.filter(node => node.type === 'special_offer').map(node => node.round)).toEqual([6, 12]);
    expect(SCREEN_THEMES.specialOffer.accent).toBe(SPECIAL_OFFER_COLOR);
  });

  it('generates three distinct seeded eligible offers and fixes a generated Focus hand', () => {
    const state = offerState('greatFairy');
    state.specialOffer = { offers: [], acquired: false };
    const resolver = new Resolver(state, constant(0));
    resolver.freshSpecialOffers();
    expect(state.specialOffer.offers).toHaveLength(3);
    expect(new Set(state.specialOffer.offers.map(offer => offer.type)).size).toBe(3);
    const focus = state.specialOffer.offers.find(offer => offer.type === 'focus');
    expect(focus?.hand).toBeDefined();
    const replay = offerState('greatFairy');
    replay.specialOffer = { offers: [], acquired: false };
    new Resolver(replay, constant(0)).freshSpecialOffers();
    expect(replay.specialOffer.offers).toEqual(state.specialOffer.offers);
  });

  it('centralizes no-effect eligibility checks', () => {
    const state = offerState('greatFairy');
    expect(specialOfferEligible(state, 'fireKeeper')).toBe(false);
    expect(specialOfferEligible(state, 'orangeTheory')).toBe(false);
    expect(specialOfferEligible(state, 'sommelier')).toBe(false);
    state.dice[0].flame = { id: 'ultimate', investedGold: 20 };
    state.dice[1].faces[0].enhancements.workout = 2;
    state.dice[2].faces[0].enhancements.vintage = 1;
    expect(specialOfferEligible(state, 'fireKeeper')).toBe(true);
    expect(specialOfferEligible(state, 'orangeTheory')).toBe(true);
    expect(specialOfferEligible(state, 'sommelier')).toBe(true);
  });
});

describe('immediate and Shop Special Offers', () => {
  it('On The House makes only initial displayed purchases free once', () => {
    let state = choose('onTheHouse');
    state = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant()).state;
    expect(state.shop?.freeEnhancementOfferIds).toHaveLength(3);
    expect(state.shop?.freeTrainingOfferKeys).toHaveLength(3);
    const enhancement = state.shop!.offers[0];
    state = dispatch(state, { type: 'BUY', offerId: enhancement.id, dieId: 0 }, constant()).state;
    expect(state.stats.purchases.at(-1)?.cost).toBe(0);
    const training = state.shop!.trainingOffers[0];
    state = dispatch(state, training.kind === 'team' ? { type: 'TRAIN_ALL_HANDS' } : { type: 'TRAIN_HAND', hand: training.hand }, constant()).state;
    expect(state.stats.trainingPurchases.at(-1)?.cost).toBe(0);
    state.gold = 100;
    state = dispatch(state, training.kind === 'team' ? { type: 'TRAIN_ALL_HANDS' } : { type: 'TRAIN_HAND', hand: training.hand }, constant()).state;
    expect(state.stats.trainingPurchases.at(-1)?.cost).toBe(training.kind === 'team' ? 30 : 4);
    const initialFreeIds = [...(state.shop!.freeEnhancementOfferIds ?? [])];
    state = dispatch(state, { type: 'REROLL_OFFERS' }, constant()).state;
    expect(state.shop!.offers.every(offer => !initialFreeIds.includes(offer.id))).toBe(true);
    expect(state.shop!.offers.every(offer => !(state.shop!.freeEnhancementOfferIds ?? []).includes(offer.id))).toBe(true);
  });

  it('Great Fairy restores Lives or grants 15 Gold at full Lives', () => {
    const hurt = offerState('greatFairy');
    hurt.lives = 1;
    expect(dispatch(hurt, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 100 }).state.lives).toBe(3);
    const full = choose('greatFairy');
    expect(full.gold).toBe(15);
    expect(full.stats.goldBySource.specialOffer).toBe(15);
  });

  it('Focus grants exactly four fixed hand levels without training spend', () => {
    const state = choose('focus', 'fullHouse');
    expect(state.handLevels.fullHouse).toBe(5);
    expect(state.stats.trainingPurchases).toEqual([]);
    expect(state.stats.trainingGoldSpent).toBe(0);
    expect(state.specialOffer?.chosen?.hand).toBe('fullHouse');
  });

  it('Sommelier, Orange Theory, and Fire Keeper update every applicable held face deterministically', () => {
    const wine = offerState('sommelier');
    wine.dice[0].faces[0].enhancements.vintage = 1;
    wine.dice[0].faces[0].vintageSellValue = 9;
    expect(dispatch(wine, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 100 }).state.dice[0].faces[0].vintageSellValue).toBe(18);

    const workout = offerState('orangeTheory');
    workout.dice[0].faces[0].enhancements.workout = 3;
    workout.dice[1].faces[1].enhancements.workout = 1;
    const trained = dispatch(workout, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 100 }).state;
    expect(trained.dice[0].faces[0].workoutPips).toBe(15);
    expect(trained.dice[1].faces[1].workoutPips).toBe(5);

    for (const [from, to] of [[20, 60], [60, 80], [90, 95]] as const) {
      const ember = offerState('fireKeeper');
      ember.dice[0].flame = { id: 'ultimate', investedGold: from };
      const stoked = dispatch(ember, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 100 }, constant(0)).state;
      expect(stoked.dice[0].flame?.investedGold).toBe(to);
    }
  });
});

describe('temporary Special Offers', () => {
  it('Care Package spends normal Rerolls first and keeps reserve charges persistent', () => {
    let state = choose('carePackage');
    state.phase = 'round';
    state.manualRerollsRemaining = 1;
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1] }, constant(.4)).state;
    expect(state.manualRerollsRemaining).toBe(0);
    expect(state.specialOfferEffects.carePackageRerolls).toBe(2);
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [2] }, constant(.4)).state;
    expect(state.specialOfferEffects.carePackageRerolls).toBe(1);
  });

  it('Cash Bonus pays one Gold per Bonus stack for each scoring face', () => {
    const state = choose('cashBonus');
    state.phase = 'round';
    const first = structuredClone(activeFace(state.dice[0]));
    first.enhancements.bonus = 3;
    const second = structuredClone(activeFace(state.dice[1]));
    second.enhancements.bonus = 1;
    const resolver = new Resolver(state, constant());
    resolver.whenScored(0, first, 'ones', 'manual', 'selected');
    resolver.whenScored(1, second, 'ones', 'manual', 'selected');
    expect(state.gold).toBe(4);
    expect(state.stats.goldBySource.cashBonus).toBe(4);
  });

  it('Tax Evasion doubles only Interest and expires by completed encounter', () => {
    const state = choose('taxEvasion');
    state.phase = 'round';
    state.gold = 10;
    state.score = state.target;
    state.stats.rounds.at(-1)!.goldBefore = 10;
    new Resolver(state, constant()).evaluate();
    expect(state.lastRoundPayout?.interestGold).toBe(4);
    expect(state.lastRoundPayout?.baseGold).toBe(5);
    expect(state.specialOfferEffects.taxEvasionRounds).toBe(2);
  });

  it('Powerball replaces only the first Jackpot activation with 50 Gold and otherwise expires', () => {
    const state = choose('powerball');
    state.phase = 'round';
    activeFace(state.dice[0]).enhancements.jackpot = 3;
    activeFace(state.dice[1]).enhancements.jackpot = 1;
    const resolver = new Resolver(state, constant());
    expect(resolver.resolveJackpot([0, 1])).toBe(53);
    expect(state.specialOfferEffects.powerballAvailable).toBe(false);

    const expiring = choose('powerball');
    expiring.phase = 'round';
    for (let index = 0; index < 3; index++) {
      expiring.score = expiring.target;
      expiring.roundSummary = null;
      expiring.phase = 'round';
      new Resolver(expiring, constant()).evaluate();
    }
    expect(expiring.specialOfferEffects.powerballRounds).toBe(0);
    expect(expiring.specialOfferEffects.powerballAvailable).toBe(false);
  });

  it('Bottled Fairy refills once per Round only after reserve Rerolls are exhausted', () => {
    const state = choose('bottledFairy');
    state.phase = 'round';
    state.target = 1_000_000;
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    state.specialOfferEffects.carePackageRerolls = 1;
    const resolver = new Resolver(state, constant());
    resolver.evaluate();
    expect(state.manualRerollsRemaining).toBe(0);
    state.specialOfferEffects.carePackageRerolls = 0;
    resolver.evaluate();
    expect(state.manualRerollsRemaining).toBe(3);
    expect(state.specialOfferEffects.bottledFairyTriggeredThisRound).toBe(true);
    state.manualRerollsRemaining = 0;
    resolver.evaluate();
    expect(state.phase).toBe('shop');
  });

  it('Silence is consumed at Boss start and disables the mechanic while preserving its Goal', () => {
    let state = choose('silence');
    state = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant()).state;
    state.round = 8;
    state.bossSchedule[9] = 'hexer';
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant(.3)).state;
    expect(state.boss?.type).toBe('hexer');
    expect(state.bossSilenced).toBe(true);
    expect(state.specialOfferEffects.silence).toBe(false);
    expect(state.dice.every(die => die.owner === 'player')).toBe(true);
    expect(state.target).toBeGreaterThan(0);
  });

  it('expires every unconsumed three-Round effect after three completed encounters', () => {
    const state = choose('cashBonus');
    state.specialOfferEffects.taxEvasionRounds = 3;
    state.specialOfferEffects.bottledFairyRounds = 3;
    state.specialOfferEffects.badDreamRounds = 3;
    const clone = structuredClone(state);
    const { roundCheckpoint: _round, badDreamCheckpoint: _dream, ...base } = clone;
    state.badDreamCheckpoint = base;
    for (let index = 0; index < 3; index++) {
      state.phase = 'round';
      state.roundSummary = null;
      state.score = state.target;
      new Resolver(state, constant()).evaluate();
    }
    expect(state.specialOfferEffects).toMatchObject({ cashBonusRounds: 0, taxEvasionRounds: 0,
      bottledFairyRounds: 0, badDreamRounds: 0 });
    expect(state.badDreamCheckpoint).toBeNull();
  });
});

describe('replay and checkpoint Special Offers', () => {
  it('Time Travel replays the completed block and suppresses the repeated Boss post-reward', () => {
    let state = choose('timeTravel');
    expect(state.round).toBe(3);
    expect(state.suppressedPostBossRewardRounds).toEqual([6]);
    state = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant()).state;
    expect(state.currentNodeId).toBe('shop:before-round:4');
    state.round = 6;
    state.phase = 'roundSummary';
    state.shop = null;
    state.roundSummary = summary(6);
    state = dispatch(state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant()).state;
    expect(state.phase).toBe('shop');
    expect(state.suppressedPostBossRewardRounds).toEqual([]);
  });

  it('Bad Dream restores its exact seeded checkpoint once with 1 Life', () => {
    let state = choose('badDream');
    const checkpoint = structuredClone(state.badDreamCheckpoint!);
    expect(checkpoint.phase).toBe('specialOffer');
    state = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant()).state;
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant(.4)).state;
    state.lives = 1;
    state.target = 1_000_000;
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 1;
    state.specialOfferEffects.carePackageRerolls = 0;
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(.4)).state;
    expect(state.phase).toBe('specialOffer');
    expect(state.lives).toBe(1);
    expect(state.rngState).toBe(checkpoint.rngState);
    expect(state.handLevels).toEqual(checkpoint.handLevels);
    expect(state.gold).toBe(checkpoint.gold);
    expect(state.badDreamCheckpoint).toBeNull();
    expect(state.specialOfferEffects.badDreamRounds).toBe(0);
    expect(state.specialOffer?.chosen?.type).toBe('badDream');
  });

  it('persists an active Bad Dream checkpoint as part of the run', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const state = choose('badDream');
    expect(savePersistedRun(storage, state)).toBe(true);
    const loaded = loadPersistedRun(storage, state.seed);
    expect(loaded?.badDreamCheckpoint).toEqual(state.badDreamCheckpoint);
    expect(loaded?.specialOfferEffects.badDreamRounds).toBe(3);
  });

  it('keeps the canonical player-facing descriptions exact', () => {
    expect(SPECIAL_OFFERS.onTheHouse.description).toBe('The next Shop’s initial displayed purchases are free.');
    expect(SPECIAL_OFFERS.badDream.description).toBe('If your run ends in the next 3 Rounds, return here with 1 Life.');
  });
});
