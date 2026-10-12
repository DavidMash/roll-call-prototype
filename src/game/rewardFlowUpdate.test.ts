import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun, validateAction } from './engine';
import { Resolver } from './effects';
import {
  eligibleFlameIds, flameEligible, FLAME_IDS, speedDemonMultiplier,
} from './flames';
import { bonfireMaximum, resolveWildfire, wildfireFactor } from './hoodedFigure';
import { loadPersistedRun, savePersistedRun } from './persistence';
import { eligibleSpecialOfferTypes, SPECIAL_OFFER_IDS, specialOfferEligible } from './specialOffers';
import type { Flame, GameState, RandomSource, SpecialOfferType } from './types';

const constant = (value = .25): RandomSource => ({ next: () => value });

function flameReward(flame: Flame = 'ultimate'): GameState {
  const state = newRun('reward-flow-flame', constant()).state;
  state.phase = 'flameSelection';
  state.shop = null;
  state.flameSelection = { offers: [{ id: 80, flame }], acquired: false };
  return state;
}

function specialReward(type: SpecialOfferType = 'carePackage'): GameState {
  const state = newRun(`reward-flow-${type}`, constant()).state;
  state.round = 3;
  state.phase = 'specialOffer';
  state.shop = null;
  state.specialOffer = { offers: [{ id: 90, type }], acquired: false };
  return state;
}

describe('atomic reward progression and guarded skipping', () => {
  it('does not advance on invalid Flame assignment and advances exactly once after successful mutation', () => {
    const state = flameReward();
    const invalid = dispatch(state, { type: 'CHOOSE_FLAME', offerId: 999, dieId: 0 }, constant());
    expect(invalid.error).toContain('available Flame');
    expect(invalid.state).toBe(state);

    const claimed = dispatch(state, { type: 'CHOOSE_FLAME', offerId: 80, dieId: 0 }, constant());
    expect(claimed.error).toBeUndefined();
    expect(claimed.state.phase).toBe('shop');
    expect(claimed.state.dice[0].flame).toEqual({ id: 'ultimate', investedGold: 0 });
    expect(claimed.events.filter(event => event.type === 'FLAME_ACQUIRED')).toHaveLength(1);
    expect(claimed.events.filter(event => event.type === 'SHOP_OPENED')).toHaveLength(1);
    expect(dispatch(claimed.state, { type: 'CHOOSE_FLAME', offerId: 80, dieId: 0 }, constant()).error)
      .toContain('Flame Selection');
  });

  it('completes replacement before advancing and records the replaced Flame once', () => {
    const state = flameReward('minigun');
    state.dice[2].flame = { id: 'ultimate', investedGold: 73 };
    const result = dispatch(state, { type: 'CHOOSE_FLAME', offerId: 80, dieId: 2 }, constant());
    expect(result.state.phase).toBe('shop');
    expect(result.state.dice[2].flame).toEqual({ id: 'minigun', investedGold: 0 });
    expect(result.state.stats.flameAcquisitions.at(-1)).toMatchObject({ flame: 'minigun', replaced: 'ultimate', dieId: 2 });
    expect(result.events.filter(event => event.type === 'FLAME_REPLACED')).toHaveLength(1);
  });

  it('claims a Special Offer and enters its destination atomically without double application', () => {
    const state = specialReward('greatFairy');
    state.lives = 3;
    const result = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 90 }, constant());
    expect(result.state.phase).toBe('shop');
    expect(result.state.gold).toBe(15);
    expect(result.events.filter(event => event.type === 'SPECIAL_OFFER_SELECTED')).toHaveLength(1);
    expect(result.events.filter(event => event.type === 'SHOP_OPENED')).toHaveLength(1);
    const repeated = dispatch(result.state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 90 }, constant());
    expect(repeated.error).toContain('Special Offer');
    expect(repeated.state.gold).toBe(15);
  });

  it('starts Time Travel immediately from the claim action', () => {
    const state = specialReward('timeTravel');
    state.round = 9;
    state.presentedChapters = [1, 2];
    const result = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 90 }, constant());
    expect(result.state).toMatchObject({ phase: 'round', round: 7, roundAttemptNumber: 1 });
    expect(result.state.chapterLifecycle[2]?.specialOfferConsumed).toBe(true);
    expect(result.state.historyV2).toContainEqual(expect.objectContaining({ kind: 'checkpoint_restored', reason: 'time_travel' }));
  });

  it('uses explicit skip actions, preserves cancellation as UI-only, and rejects stale skips', () => {
    const flame = dispatch(flameReward(), { type: 'SKIP_FLAME_SELECTION' }, constant());
    expect(flame.state.phase).toBe('shop');
    expect(flame.state.stats.flameAcquisitions).toHaveLength(0);
    expect(flame.state.historyV2).toContainEqual(expect.objectContaining({ kind: 'flame_changed', change: { type: 'skipped' } }));
    expect(dispatch(flame.state, { type: 'SKIP_FLAME_SELECTION' }, constant()).error).toContain('Flame Selection');

    const offer = dispatch(specialReward(), { type: 'SKIP_SPECIAL_OFFER' }, constant());
    expect(offer.state.phase).toBe('shop');
    expect(offer.state.chapterLifecycle[1]?.specialOfferConsumed).toBe(true);
    expect(offer.events.filter(event => event.type === 'SPECIAL_OFFER_SKIPPED')).toHaveLength(1);
    expect(offer.events.some(event => event.type === 'SPECIAL_OFFER_SELECTED')).toBe(false);
  });
});

describe('Shop entry progression lock', () => {
  it('blocks every exit action until the one timer-only unlock and does not block other interactions', () => {
    let state = dispatch(flameReward(), { type: 'SKIP_FLAME_SELECTION' }, constant()).state;
    expect(state.shop?.exitUnlocked).toBe(false);
    expect(validateAction(state, { type: 'NEXT_ROUND' })).toContain('one second');
    const offer = state.shop!.offers[0];
    state.gold = 100;
    expect(validateAction(state, { type: 'BUY', offerId: offer.id, dieId: 0 })).toBeNull();
    state = dispatch(state, { type: 'BUY', offerId: offer.id, dieId: 0 }, constant()).state;
    expect(state.shop?.exitUnlocked).toBe(false);
    state = dispatch(state, { type: 'UNLOCK_SHOP_EXIT' }, constant()).state;
    expect(validateAction(state, { type: 'NEXT_ROUND' })).toBeNull();
    expect(dispatch(state, { type: 'UNLOCK_SHOP_EXIT' }, constant()).error).toContain('already available');
  });

  it('starts a fresh lock for normal and post-Boss Shops and preserves a locked Shop through save/load', () => {
    const ordinary = newRun('shop-lock-normal', constant()).state;
    ordinary.phase = 'roundSummary';
    ordinary.roundSummary = { round: 1, encounterType: 'normal', bossType: null, score: 100, target: 100,
      goldBefore: 0, goldAfter: 8, totalGoldEarned: 8, sources: { baseRewardGold: 5, unusedRerollGold: 3,
        interestGold: 0, bossRewardGold: 0, goldenGold: 0, jackpotGold: 0, otherGold: 0 } };
    const opened = dispatch(ordinary, { type: 'CONTINUE_ROUND_SUMMARY' }, constant()).state;
    expect(opened.shop?.exitUnlocked).toBe(false);

    const boss = flameReward();
    boss.round = 6;
    const postBoss = dispatch(boss, { type: 'SKIP_FLAME_SELECTION' }, constant()).state;
    expect(postBoss.shop).toMatchObject({ kind: 'post_boss', exitUnlocked: false });
    expect(validateAction(postBoss, { type: 'NEXT_CHAPTER' })).toContain('one second');

    let saved = '';
    const storage = { getItem: () => saved || null, setItem: (_key: string, value: string) => { saved = value; } };
    expect(savePersistedRun(storage, postBoss)).toBe(true);
    const loaded = loadPersistedRun(storage, postBoss.seed)!;
    expect(loaded.shop?.exitUnlocked).toBe(false);
    expect(validateAction(loaded, { type: 'NEXT_CHAPTER' })).toContain('one second');
  });
});

describe('build-aware reward eligibility', () => {
  it('audits every Special Offer and gates only mechanics that need an existing component', () => {
    const state = specialReward();
    const restricted = new Set<SpecialOfferType>(['fireKeeper', 'sommelier', 'cashBonus', 'orangeTheory', 'powerball']);
    for (const type of SPECIAL_OFFER_IDS) expect(specialOfferEligible(state, type)).toBe(!restricted.has(type));

    state.dice[0].flame = { id: 'ultimate', investedGold: 20 };
    state.dice[0].faces[1].enhancements.bonus = 1;
    state.dice[1].faces[2].enhancements.workout = 1;
    state.dice[2].faces[3].enhancements.jackpot = 1;
    state.dice[3].faces[4].enhancements.vintage = 1;
    for (const type of restricted) expect(specialOfferEligible(state, type)).toBe(true);
    expect(eligibleSpecialOfferTypes(state)).toEqual(SPECIAL_OFFER_IDS);
  });

  it('audits every Flame, accepts one qualifying conditional face, and enforces actual multi-source mechanics', () => {
    const state = flameReward();
    const restricted = new Set<Flame>(['fluxCapacitor', 'fatCat', 'vineyard']);
    for (const id of FLAME_IDS) expect(flameEligible(state, id)).toBe(!restricted.has(id));

    state.dice[0].faces[5].enhancements.golden = 1;
    state.dice[1].faces[4].enhancements.vintage = 1;
    expect(flameEligible(state, 'fatCat')).toBe(true);
    expect(flameEligible(state, 'vineyard')).toBe(true);
    // Power Surge supplies its own Max Charge capacity, so it can function without another generator.
    expect(flameEligible(state, 'powerSurge')).toBe(true);
    state.dice[3].faces[0].enhancements.magnetic = 1;
    expect(flameEligible(state, 'fluxCapacitor')).toBe(false);
    state.dice[4].faces[0].enhancements.magnetic = 1;
    expect(flameEligible(state, 'fluxCapacitor')).toBe(true);
  });

  it('filters before deterministic selection, leaves presented sets stable, and permits sparse valid Flame sets', () => {
    const make = () => {
      const state = flameReward();
      state.flameSelection = { offers: [], acquired: false };
      new Resolver(state, constant(.42)).freshFlameOffers();
      return state;
    };
    const first = make();
    expect(make().flameSelection?.offers).toEqual(first.flameSelection?.offers);
    expect(first.flameSelection?.offers.some(offer => ['fluxCapacitor', 'fatCat', 'vineyard'].includes(offer.flame))).toBe(false);
    const presented = structuredClone(first.flameSelection!.offers);
    activeFace(first.dice[0]).enhancements.vintage = 1;
    expect(first.flameSelection!.offers).toEqual(presented);

    const sparse = flameReward();
    sparse.bonfires = FLAME_IDS.filter(id => id !== 'minigun' && id !== 'vineyard');
    sparse.flameSelection = { offers: [], acquired: false };
    new Resolver(sparse, constant(0)).freshFlameOffers();
    expect(sparse.flameSelection.offers.map(offer => offer.flame)).toEqual(['minigun']);
    expect(new Set(sparse.flameSelection.offers.map(offer => offer.flame)).size).toBe(1);
    expect(eligibleFlameIds(sparse)).not.toContain('vineyard');
  });

  it('reevaluates prerequisites only for newly generated sets', () => {
    const state = specialReward();
    state.specialOffer = { offers: [], acquired: false };
    state.dice[0].faces[0].enhancements.bonus = 1;
    expect(specialOfferEligible(state, 'cashBonus')).toBe(true);
    new Resolver(state, constant(.2)).freshSpecialOffers();
    const prior = structuredClone(state.specialOffer.offers);
    delete state.dice[0].faces[0].enhancements.bonus;
    expect(state.specialOffer.offers).toEqual(prior);
    expect(specialOfferEligible(state, 'cashBonus')).toBe(false);
    new Resolver(state, constant(.2)).freshSpecialOffers();
    expect(state.specialOffer.offers.some(offer => offer.type === 'cashBonus')).toBe(false);
  });
});

describe('Speed Demon ×5 migration', () => {
  it('keeps Ember/Bonfire scaling and migrates saved Wildfires to the new ordinary base without clamping amplification', () => {
    expect(speedDemonMultiplier(0, 0)).toBe(1);
    expect(speedDemonMultiplier(50, 0)).toBe(3);
    expect(speedDemonMultiplier(100, 0)).toBe(5);
    expect(speedDemonMultiplier(100, 5500)).toBe(3);
    expect(speedDemonMultiplier(100, 10000)).toBe(1);
    expect(bonfireMaximum('speedDemon')).toBe(5);
    expect(resolveWildfire('speedDemon', 6)).toEqual({ kind: 'xMult', baseMax: 5, max: 30 });

    const state = newRun('speed-save-migration', constant()).state;
    state.dice[0].flame = { id: 'speedDemon', investedGold: 50 };
    state.wildfires = [{ flame: 'speedDemon', sacrificedFlame: 'vineyard', sacrificedAverage: 5,
      transferMultiplier: 6, resolved: { kind: 'xMult', baseMax: 9, max: 54 } }];
    let saved = '';
    const storage = { getItem: () => saved || null, setItem: (_key: string, value: string) => { saved = value; } };
    expect(savePersistedRun(storage, state)).toBe(true);
    const loaded = loadPersistedRun(storage, state.seed)!;
    expect(loaded.dice[0].flame).toEqual({ id: 'speedDemon', investedGold: 50 });
    expect(loaded.wildfires[0].resolved).toEqual({ kind: 'xMult', baseMax: 5, max: 30 });
    expect(wildfireFactor(loaded.wildfires[0], speedDemonMultiplier(100, 0))).toBe(30);
  });
});
