import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { Resolver } from './effects';
import { dispatch, newRun } from './engine';
import { enhancementSellValue, ENHANCEMENTS, ENHANCEMENT_IDS } from './enhancements';
import { FLAMES, FLAME_IDS } from './flames';
import { HAND_IDS } from './hands';
import { OFFER_RARITY_WEIGHTS, rarityFirstSelection } from './rarity';
import { loadPersistedRun, savePersistedRun } from './persistence';
import { eligibleSpecialOfferTypes, SPECIAL_OFFERS, SPECIAL_OFFER_IDS, specialOfferEligible } from './specialOffers';
import type { GameState, RandomSource, Rank, Rarity, SpecialOfferType } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });
const sequence = (...values: number[]): RandomSource => {
  let index = 0;
  return { next: () => values[index++] ?? values.at(-1) ?? 0 };
};
function scoringState(values: Rank[] = [4, 4, 4, 2, 6]): GameState {
  const state = newRun('rarity-content-update', constant(.9)).state;
  state.target = 100000;
  state.stats.rounds[0].target = state.target;
  state.dice.forEach((die, index) => { die.value = values[index]; });
  return state;
}

describe('canonical rarity metadata', () => {
  it('assigns every Enhancement exactly the authored rarity', () => {
    expect(ENHANCEMENT_IDS).toHaveLength(15);
    expect(Object.fromEntries(ENHANCEMENT_IDS.map(id => [id, ENHANCEMENTS[id].rarity]))).toEqual({
      bonus: 'common', jumpingBean: 'rare', golden: 'common', workout: 'common', missingLink: 'rare',
      mirror: 'rare', magnetic: 'uncommon', sticky: 'uncommon', slippy: 'common', hitchhiker: 'uncommon',
      weighted: 'common', jackpot: 'uncommon', personalTrainer: 'rare', bump: 'common', vintage: 'common',
    });
  });

  it('assigns all 23 current Flames and contains only the three replacements', () => {
    expect(FLAME_IDS).toHaveLength(23);
    expect(FLAME_IDS).toEqual(expect.arrayContaining(['fatCat', 'vineyard', 'fetch']));
    expect(FLAME_IDS).not.toEqual(expect.arrayContaining(['dragonsHoard', 'moneyToBurn', 'wellTrained']));
    expect(Object.fromEntries(FLAME_IDS.map(id => [id, FLAMES[id].rarity]))).toEqual({
      ultimate: 'uncommon', minigun: 'common', hailMary: 'common', fullOfGrace: 'common', momentum: 'common',
      thirdRail: 'uncommon', jumpStart: 'uncommon', powerSurge: 'rare', speedDemon: 'rare', sixPack: 'rare',
      fluxCapacitor: 'rare', fatCat: 'uncommon', vineyard: 'uncommon', fetch: 'uncommon', targetPractice: 'rare',
      hotStreak: 'uncommon', lowball: 'common', straightShooter: 'uncommon', doubleDown: 'uncommon',
      threesCompany: 'uncommon', boxSet: 'uncommon', missingPair: 'common', oneShort: 'common',
    });
  });

  it('assigns all 15 Special Offers including Uncommon Semester and Cash Bonus', () => {
    expect(SPECIAL_OFFER_IDS).toHaveLength(15);
    expect(Object.fromEntries(SPECIAL_OFFER_IDS.map(id => [id, SPECIAL_OFFERS[id].rarity]))).toEqual({
      onTheHouse: 'uncommon', greatFairy: 'common', focus: 'common', timeTravel: 'rare', carePackage: 'common',
      silence: 'rare', sommelier: 'rare', taxEvasion: 'uncommon', fireKeeper: 'uncommon', cashBonus: 'uncommon',
      orangeTheory: 'common', powerball: 'common', bottledFairy: 'uncommon', badDream: 'rare', semester: 'uncommon',
    });
  });
});

describe('rarity-first generation', () => {
  const candidates: { id: string; rarity: Rarity }[] = [
    { id: 'c1', rarity: 'common' }, { id: 'c2', rarity: 'common' },
    { id: 'u1', rarity: 'uncommon' }, { id: 'u2', rarity: 'uncommon' },
    { id: 'r1', rarity: 'rare' }, { id: 'r2', rarity: 'rare' },
  ];

  it('keeps the three system weights centralized and exact', () => {
    expect(OFFER_RARITY_WEIGHTS).toEqual({
      enhancement: { common: 70, uncommon: 25, rare: 5 },
      flame: { common: 55, uncommon: 35, rare: 10 },
      specialOffer: { common: 55, uncommon: 35, rare: 10 },
    });
  });

  it('is deterministic, unique, and prevents a second Rare', () => {
    const generate = () => rarityFirstSelection(candidates, 3, item => item.rarity,
      OFFER_RARITY_WEIGHTS.flame, sequence(.99, 0, .99, 0, .99, 0));
    const first = generate();
    expect(generate()).toEqual(first);
    expect(new Set(first.map(item => item.id))).toHaveLength(3);
    expect(first.filter(item => item.rarity === 'rare')).toHaveLength(1);
  });

  it('renormalizes over eligible tiers and fills the set when Rare is unavailable', () => {
    const noRare = candidates.filter(item => item.rarity !== 'rare');
    const selected = rarityFirstSelection(noRare, 3, item => item.rarity,
      OFFER_RARITY_WEIGHTS.enhancement, sequence(.99, 0, .99, 0, .99, 0));
    expect(selected).toHaveLength(3);
    expect(selected.every(item => item.rarity !== 'rare')).toBe(true);
    expect(new Set(selected.map(item => item.id))).toHaveLength(3);
  });

  it('normal generators log complete generated sets with rarity', () => {
    const state = scoringState();
    state.phase = 'shop';
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    new Resolver(state, constant(.2)).freshOffers();
    expect(state.shop.offers).toHaveLength(3);
    expect(state.history.at(-1)).toMatchObject({ type: 'OFFERS_REFRESHED', offerSet: expect.any(Array) });
    expect(state.history.at(-1)?.message).toMatch(/^Enhancement offers: .+ \[(Common|Uncommon|Rare)\]/);
  });
});

describe('Fat Cat, Vineyard, and Fetch', () => {
  it.each([
    ['fatCat', 'golden'],
    ['fatCat', 'jackpot'],
    ['vineyard', 'vintage'],
  ] as const)('%s activates once from an actual scoring %s face and keeps the Ember die restriction', (flame, enhancement) => {
    const state = scoringState();
    state.dice[0].flame = { id: flame, investedGold: 100 };
    activeFace(state.dice[2]).enhancements[enhancement] = 1;
    let result = dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant(.9));
    expect(result.state.stats.handScores[0].xMultFactors.filter(factor => factor.source === flame)).toHaveLength(1);

    const absent = scoringState();
    absent.dice[0].flame = { id: flame, investedGold: 100 };
    activeFace(absent.dice[2]).enhancements[enhancement] = 1;
    result = dispatch(absent, { type: 'PLAY', hand: 'pair', dieIds: [1, 2] }, constant(.9));
    expect(result.state.stats.handScores[0].xMultFactors.some(factor => factor.source === flame)).toBe(false);
  });

  it('lets the replacement Flames remain conditional as global Bonfires', () => {
    const state = scoringState();
    state.bonfires = ['fatCat', 'vineyard'];
    activeFace(state.dice[1]).enhancements.golden = 1;
    activeFace(state.dice[2]).enhancements.vintage = 1;
    const result = dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant(.9));
    expect(result.state.stats.handScores[0].xMultFactors.map(factor => factor.source)).toEqual(['fatCat', 'vineyard']);
  });

  it('assigns Fetch deterministically to its Ember die, activates on the physical target, and moves to a different face', () => {
    const state = scoringState();
    state.phase = 'flameSelection';
    state.flameSelection = { offers: [{ id: 10, flame: 'fetch' }], acquired: false };
    const acquired = dispatch(state, { type: 'CHOOSE_FLAME', offerId: 10, dieId: 0 }, constant(.5)).state;
    expect(acquired.fetchTarget).toEqual({ dieId: 0, physicalFace: 4 });
    acquired.phase = 'round'; acquired.flameSelection = null; acquired.dice[0].value = 4;
    const result = dispatch(acquired, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant(0));
    expect(result.state.stats.handScores[0].xMultFactors).toContainEqual(expect.objectContaining({ source: 'fetch', value: 1 }));
    expect(result.state.fetchTarget?.dieId).toBe(0);
    expect(result.state.fetchTarget).not.toEqual({ dieId: 0, physicalFace: 4 });
  });

  it('keeps a Bonfire target global and excludes temporary dice from future targets', () => {
    const state = scoringState();
    state.bonfires = ['fetch'];
    state.fetchTarget = { dieId: 2, physicalFace: 4 };
    state.dice.push({ id: 99, owner: 'boss', value: 4, flame: null, faces: state.dice[0].faces.map(face => structuredClone(face)) });
    const result = dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant(.999));
    expect(result.state.stats.handScores[0].xMultFactors).toContainEqual(expect.objectContaining({ source: 'fetch', value: 5, dieId: null }));
    expect(result.state.fetchTarget?.dieId).toBeLessThan(5);
    expect(result.state.fetchTarget?.dieId).not.toBe(99);
  });
});

describe('Vintage, Sommelier, Cash Bonus, and Semester', () => {
  function offerState(type: SpecialOfferType): GameState {
    const state = scoringState();
    state.phase = 'specialOffer';
    state.specialOffer = { offers: [{ id: 1, type }], acquired: false };
    return state;
  }

  it('caps Vintage base at 30 while Sommelier persistently doubles actual value without stacking', () => {
    let state = scoringState([1, 2, 3, 4, 5]);
    const face = activeFace(state.dice[0]);
    face.enhancements.vintage = 1;
    face.vintageSellValue = 27;
    const resolver = new Resolver(state, constant());
    resolver.whenScored(0, structuredClone(face), 'ones', 'manual', 'selected');
    resolver.whenScored(0, structuredClone(face), 'ones', 'manual', 'selected');
    expect(face.vintageSellValue).toBe(30);
    expect(enhancementSellValue(face, 'vintage')).toBe(30);

    state.phase = 'specialOffer'; state.specialOffer = { offers: [{ id: 1, type: 'sommelier' }], acquired: false };
    state = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 1 }).state;
    expect(face.vintageSommelierBoosted).toBeUndefined();
    const boosted = activeFace(state.dice[0]);
    expect(boosted.vintageSommelierBoosted).toBe(true);
    expect(enhancementSellValue(boosted, 'vintage')).toBe(60);
    expect(specialOfferEligible(state, 'sommelier')).toBe(false);
  });

  it('lets boosted Vintage keep growing its capped base, sells actual value, and leaves later Vintage unboosted', () => {
    let state = offerState('sommelier');
    const held = state.dice[0].faces[0];
    held.enhancements.vintage = 1;
    held.vintageSellValue = 12;
    state = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 1 }).state;
    const boosted = state.dice[0].faces[0];
    state.dice[0].value = 1;
    new Resolver(state, constant()).whenScored(0, structuredClone(boosted), 'ones', 'manual', 'selected');
    expect(boosted.vintageSellValue).toBe(15);
    expect(enhancementSellValue(boosted, 'vintage')).toBe(30);

    const later = state.dice[1].faces[0];
    later.enhancements.vintage = 1;
    later.vintageSellValue = 3;
    expect(later.vintageSommelierBoosted).toBeUndefined();
    state.phase = 'shop';
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    const goldBefore = state.gold;
    state = dispatch(state, { type: 'SELL_ENHANCEMENT', dieId: 0, face: 1, enhancement: 'vintage' }).state;
    expect(state.gold - goldBefore).toBe(30);
  });

  it('Cash Bonus pays 3 Gold per activated stack', () => {
    const state = scoringState([1, 1, 3, 4, 5]);
    state.specialOfferEffects.cashBonusRounds = 3;
    activeFace(state.dice[0]).enhancements.bonus = 2;
    activeFace(state.dice[1]).enhancements.bonus = 1;
    const before = state.gold;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0, 1] }, constant(.9));
    expect(result.state.gold - before).toBe(9);
    expect(result.state.stats.goldBySource.cashBonus).toBe(9);
  });

  it('guarantees exactly one Team Training in the next three newly opened Shops', () => {
    let state = offerState('semester');
    state = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 1 }, constant(0)).state;
    expect(state.specialOfferEffects.semesterShopsRemaining).toBe(3);
    expect(eligibleSpecialOfferTypes(state)).not.toContain('semester');
    state = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant(0)).state;
    expect(state.shop?.trainingOffers.filter(offer => offer.kind === 'team')).toHaveLength(1);
    expect(state.specialOfferEffects.semesterShopsRemaining).toBe(2);
    for (const remaining of [1, 0]) {
      new Resolver(state, constant(0)).openShop();
      expect(state.shop?.trainingOffers.filter(offer => offer.kind === 'team')).toHaveLength(1);
      expect(state.specialOfferEffects.semesterShopsRemaining).toBe(remaining);
    }
    new Resolver(state, constant(0)).openShop();
    expect(state.shop?.trainingOffers.some(offer => offer.kind === 'team')).toBe(false);
  });

  it('restoring the same Bust checkpoint does not consume another Semester Shop', () => {
    let state = offerState('semester');
    state = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 1 }, constant(0)).state;
    state = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant(0)).state;
    expect(state.specialOfferEffects.semesterShopsRemaining).toBe(2);
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant(.9)).state;
    state.manualRerollsRemaining = 0;
    state.consumed = [...HAND_IDS];
    new Resolver(state, constant(.9)).evaluate();
    expect(state.phase).toBe('shop');
    expect(state.specialOfferEffects.semesterShopsRemaining).toBe(2);
    expect(state.shop?.trainingOffers.filter(offer => offer.kind === 'team')).toHaveLength(1);
  });

  it('save/resume preserves Fetch, Semester, and Sommelier state without consuming or rerolling it', () => {
    const state = scoringState();
    state.dice[0].flame = { id: 'fetch', investedGold: 40 };
    state.fetchTarget = { dieId: 0, physicalFace: 3 };
    state.specialOfferEffects.semesterShopsRemaining = 2;
    state.dice[1].faces[1].enhancements.vintage = 1;
    state.dice[1].faces[1].vintageSellValue = 12;
    state.dice[1].faces[1].vintageSommelierBoosted = true;
    let serialized = '';
    const storage = { getItem: () => serialized || null, setItem: (_key: string, value: string) => { serialized = value; } };
    expect(savePersistedRun(storage, state)).toBe(true);
    const loaded = loadPersistedRun(storage, state.seed)!;
    expect(loaded.fetchTarget).toEqual({ dieId: 0, physicalFace: 3 });
    expect(loaded.specialOfferEffects.semesterShopsRemaining).toBe(2);
    expect(loaded.dice[1].faces[1]).toMatchObject({ vintageSellValue: 12, vintageSommelierBoosted: true });
    expect(enhancementSellValue(loaded.dice[1].faces[1], 'vintage')).toBe(24);
  });
});
