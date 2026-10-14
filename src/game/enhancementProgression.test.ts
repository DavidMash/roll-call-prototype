import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { createCursedDie } from './bosses';
import { Resolver } from './effects';
import { dispatch, newRun, validateAction } from './engine';
import {
  canAttach, diminishingHalfChance, eligibleEnhancements, ENHANCEMENTS, ENHANCEMENT_IDS,
  enhancementsUnlockedAt, maxEnhancementTypesPerFace,
} from './enhancements';
import { combinationsForHand } from './hands';
import { HAND_IDS } from './hands';
import { loadPersistedRun, savePersistedRun } from './persistence';
import { hashSeed, SeededRng } from './rng';
import type { GameState, RandomSource, Rank } from './types';

const constant = (value: number): RandomSource => ({ next: () => value });
const sequence = (...values: number[]): RandomSource => {
  let index = 0;
  return { next: () => values[Math.min(index++, values.length - 1)] };
};
function game(): GameState {
  const state = newRun('enhancement-progression', constant(.2)).state;
  state.target = 10_000n;
  state.consumed = [];
  state.scorecardCycleConsumed = [];
  return state;
}
function values(state: GameState, next: Rank[]) {
  next.forEach((value, index) => { state.dice[index].value = value; });
}

describe('Inferno Enhancement progression', () => {
  it('uses the exact dynamic distinct-type capacity with a permanent six-type ceiling', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(maxEnhancementTypesPerFace)).toEqual([1, 2, 3, 4, 5, 6, 6, 6]);
    const face = game().dice[0].faces[0];
    face.enhancements.workout = 2;
    expect(canAttach(face, 'workout', 0)).toBe(true);
    expect(canAttach(face, 'golden', 0)).toBe(false);
    expect(canAttach(face, 'golden', 1)).toBe(true);
    delete face.enhancements.workout;
    expect(canAttach(face, 'golden', 0)).toBe(true);
  });

  it('exposes exactly 26 active Enhancements and the authored cumulative tier pools', () => {
    const tiers = [
      ['bonus', 'golden', 'workout', 'vintage', 'boomerang'],
      ['hitchhiker', 'weighted', 'bump', 'magnetic', 'jackpot'],
      ['teamwork', 'loneWolf', 'tank', 'freePlay'],
      ['mirror', 'missingLink', 'doubleTime', 'jumpingBean'],
      ['shifter', 'flywheel', 'holiday', 'personalTrainer'],
      ['magic', 'conjoined', 'furnace', 'sustainable'],
    ] as const;
    expect(ENHANCEMENT_IDS).toHaveLength(26);
    expect(ENHANCEMENT_IDS).not.toContain('sticky');
    expect(ENHANCEMENT_IDS).not.toContain('slippy');
    tiers.forEach((tier, level) => expect(enhancementsUnlockedAt(level)).toEqual(tier));
    tiers.forEach((_tier, level) => expect(eligibleEnhancements(level)).toEqual(tiers.slice(0, level + 1).flat()));
    expect(eligibleEnhancements(6)).toEqual(eligibleEnhancements(5));
  });

  it('keeps rarity independent and preserves Boomerang replacement economics', () => {
    expect(ENHANCEMENTS.boomerang).toMatchObject({ rarity: 'uncommon', purchasePrice: 3, baseSellPrice: 1, maxStacks: 3 });
    expect(['freePlay', 'shifter', 'flywheel', 'holiday'].map(id => ENHANCEMENTS[id as keyof typeof ENHANCEMENTS].purchasePrice)).toEqual([4, 4, 4, 4]);
    expect(['magic', 'conjoined', 'furnace', 'sustainable'].map(id => ENHANCEMENTS[id as keyof typeof ENHANCEMENTS].purchasePrice)).toEqual([8, 8, 8, 8]);
    expect([1, 2, 3].map(diminishingHalfChance)).toEqual([.5, .75, .875]);
  });

  it('filters every fresh and rerolled offer set to the current cumulative Inferno pool', () => {
    for (let level = 0; level <= 6; level++) {
      const state = game();
      state.engulfmentLevel = level;
      state.phase = 'shop';
      state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
      const resolver = new Resolver(state, new SeededRng(hashSeed(`offers-${level}`)));
      for (let refresh = 0; refresh < 20; refresh++) {
        resolver.freshOffers(refresh ? 'reroll' : 'initial');
        expect(state.shop.offers.every(offer => eligibleEnhancements(level).includes(offer.enhancement))).toBe(true);
      }
      const presented = [...state.historyV2].reverse().find(event => event.kind === 'shop_offers_presented');
      expect(presented?.kind === 'shop_offers_presented' ? presented.eligibleEnhancements : null)
        .toEqual(eligibleEnhancements(level));
    }
  });
});

describe('new qualification and scoring Enhancements', () => {
  it('uses Conjoined phantom copies only for group qualification', () => {
    const state = game();
    values(state, [4, 4, 3, 3, 6]);
    activeFace(state.dice[0]).enhancements.conjoined = 1;
    expect(combinationsForHand(state.dice, 'pair')).toContainEqual([0]);
    expect(combinationsForHand(state.dice, 'threeKind')).toContainEqual([0, 1]);
    expect(combinationsForHand(state.dice, 'fullHouse')).toContainEqual([0, 1, 2, 3]);
    expect(combinationsForHand(state.dice, 'smallStraight')).not.toContainEqual([0]);
    const result = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0] }, constant(.2));
    const hand = result.state.historyV2.find(event => event.kind === 'hand_scored' && event.hand === 'pair');
    expect(hand?.kind === 'hand_scored' ? hand.scoringDice.map(die => die.dieId) : null).toEqual([0]);
  });

  it('Holiday triples only Bonus contribution on a successful activation', () => {
    const state = game();
    values(state, [1, 2, 3, 4, 5]);
    activeFace(state.dice[0]).enhancements = { bonus: 1, holiday: 1 };
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, sequence(.49, .2));
    expect(result.state.stats.handScores.at(-1)).toMatchObject({ basePips: 7, pips: 38, bonusPips: 30 });
    expect(result.state.stats.probabilityProcs.holiday).toMatchObject({ checks: 1, successes: 1 });
    const history = result.state.historyV2.find(event => event.kind === 'hand_scored' && event.hand === 'ones');
    expect(history?.kind === 'hand_scored' ? history.sideEffects : []).toContainEqual({
      type: 'holiday', dieId: 0, baseBonusPips: 10, finalBonusPips: 30, succeeded: true,
    });
  });

  it('Furnace burns stacks before they activate and applies its updated persistent Mult immediately', () => {
    const state = game();
    values(state, [1, 2, 3, 4, 5]);
    const face = activeFace(state.dice[0]);
    face.enhancements = { furnace: 1, bonus: 2, golden: 1 };
    face.furnaceMultiplier = 1;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.2));
    const live = result.state.dice[0].faces[0];
    expect(live.enhancements).toEqual({ furnace: 1 });
    expect(live.furnaceMultiplier).toBe(1.75);
    expect(result.state.gold).toBe(state.gold);
    expect(result.state.stats.handScores.at(-1)).toMatchObject({ pips: 8, multiplier: 1.75 });
  });

  it('persists accumulated Furnace power through the current save schema', () => {
    const state = game();
    activeFace(state.dice[0]).enhancements.furnace = 1;
    activeFace(state.dice[0]).furnaceMultiplier = 2.5;
    let saved: string | null = null;
    const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
    expect(savePersistedRun(storage, state)).toBe(true);
    expect(activeFace(loadPersistedRun(storage, state.seed)!.dice[0]).furnaceMultiplier).toBe(2.5);
  });

  it('Sustainable deterministically spends one charge and preserves a consumable hand', () => {
    const state = game();
    values(state, [1, 2, 3, 4, 5]);
    const face = activeFace(state.dice[0]);
    face.enhancements.sustainable = 2;
    face.sustainableCharges = 2;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.2));
    expect(result.state.consumed).not.toContain('ones');
    expect(result.state.dice[0].faces[0].sustainableCharges).toBe(1);
    expect(result.state.historyV2.find(event => event.kind === 'hand_scored' && event.hand === 'ones'))
      .toMatchObject({ consumed: false });
  });

  it('spends at most one stable Sustainable charge, never on free play, and resets only at round start', () => {
    const state = game();
    values(state, [1, 1, 3, 4, 5]);
    for (const id of [0, 1]) {
      activeFace(state.dice[id]).enhancements.sustainable = 2;
      activeFace(state.dice[id]).sustainableCharges = 2;
    }
    const paid = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(.2)).state;
    expect([0, 1].map(id => paid.dice[id].faces[0].sustainableCharges)).toEqual([1, 2]);
    expect(paid.consumed).not.toContain('pair');

    const free = game();
    const freeFace = activeFace(free.dice[0]);
    freeFace.enhancements.sustainable = 3;
    freeFace.sustainableCharges = 2;
    new Resolver(free, constant(.2)).play('ones', [0], 'freePlay');
    expect(freeFace.sustainableCharges).toBe(2);

    const refreshed = game();
    values(refreshed, [1, 2, 3, 4, 5]);
    refreshed.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    refreshed.scorecardCycleConsumed = [...refreshed.consumed];
    const refreshPhysical = refreshed.dice[4].value;
    const refreshFace = activeFace(refreshed.dice[4]);
    refreshFace.enhancements.sustainable = 2;
    refreshFace.sustainableCharges = 1;
    const afterRefresh = dispatch(refreshed, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.2)).state;
    expect(afterRefresh.consumed).toEqual([]);
    const persistedRefreshFace = afterRefresh.dice[4].faces[refreshPhysical - 1];
    expect(persistedRefreshFace.sustainableCharges).toBe(1);

    persistedRefreshFace.sustainableCharges = 0;
    new Resolver(afterRefresh, constant(.2)).startRound();
    expect(persistedRefreshFace.sustainableCharges).toBe(2);
  });
});

describe('new roll Enhancements', () => {
  it('keeps Boomerang and physical-face Free Play on non-manual rerolls', () => {
    const state = game();
    values(state, [1, 2, 3, 4, 5]);
    activeFace(state.dice[0]).enhancements = { boomerang: 1, freePlay: 1 };
    const resolver = new Resolver(state, constant(.49));
    resolver.rollBatch([0], 'Post-hand reroll', 'gameplay', false, 'post_hand');
    resolver.drain();
    expect(state.dice[0].value).toBe(1);
    expect(state.score).toBeGreaterThan(0n);
    expect(state.consumed).not.toContain('ones');
    const roll = [...state.historyV2].reverse().find(event => event.kind === 'roll_batch' && event.reason === 'post_hand');
    expect(roll?.kind === 'roll_batch' && roll.results[0].controller).toBe('boomerang');
    expect(state.historyV2.filter(event => event.kind === 'hand_scored' && event.playSource === 'freePlay')).toHaveLength(1);
  });

  it('manual rerolls ignore Boomerang and Free Play and spend one RNG draw on a different face', () => {
    const state = game();
    values(state, [1, 2, 3, 4, 5]);
    activeFace(state.dice[0]).enhancements = { boomerang: 3, freePlay: 1 };
    let draws = 0;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, { next: () => { draws++; return .5; } });
    expect(result.state.dice[0].value).toBe(4);
    expect(draws).toBe(1);
    expect(result.state.stats.probabilityProcs.boomerang.checks).toBe(0);
    expect(result.state.score).toBe(0n);
    expect(result.state.historyV2.filter(event => event.kind === 'hand_scored' && event.playSource === 'freePlay')).toHaveLength(0);
    const roll = [...result.state.historyV2].reverse().find(event => event.kind === 'roll_batch' && event.reason === 'manual');
    expect(roll?.kind === 'roll_batch' ? roll.results[0] : null)
      .toMatchObject({ controller: 'rng', beforePhysicalFace: 1, afterPhysicalFace: 4, previousFaceExcluded: true });
  });

  it('Flywheel pays per die before normal rerolls', () => {
    const state = game();
    state.manualRerollsRemaining = 0;
    values(state, [1, 2, 3, 4, 5]);
    const face = activeFace(state.dice[0]);
    face.enhancements.flywheel = 2;
    face.flywheelCharges = 2;
    expect(validateAction(state, { type: 'MANUAL_REROLL', dieIds: [0] })).toBeNull();
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(.9));
    expect(result.state.dice[0].faces[0].flywheelCharges).toBe(1);
    expect(result.state.dice[0].value).not.toBe(1);
    expect(result.state.manualRerollsRemaining).toBe(0);
    const roll = [...result.state.historyV2].reverse().find(event => event.kind === 'roll_batch' && event.reason === 'manual');
    expect(roll?.kind === 'roll_batch' && roll.results[0].flywheel).toEqual({ chargeConsumed: true, chargesRemaining: 1 });
  });

  it('charges mixed multi-die manual rerolls independently', () => {
    const state = game();
    state.manualRerollsRemaining = 1;
    values(state, [1, 2, 3, 4, 5]);
    activeFace(state.dice[0]).enhancements.flywheel = 1;
    activeFace(state.dice[0]).flywheelCharges = 1;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1] }, constant(.8));
    expect(result.error).toBeUndefined();
    expect(result.state.manualRerollsRemaining).toBe(0);
    expect(activeFace(result.state.dice[0]).flywheelCharges ?? 0).toBe(0);
  });

  it('uses Clockmaker, Bump, Magnetic, Magic, then RNG for manual rerolls', () => {
    const roll = (state: GameState) => {
      new Resolver(state, constant(.1)).rollBatch([0], 'precedence', 'gameplay', true, 'manual');
      const event = [...state.historyV2].reverse().find(item => item.kind === 'roll_batch');
      return event?.kind === 'roll_batch' ? event.results[0].controller : null;
    };
    const configured = () => {
      const state = game();
      values(state, [1, 3, 3, 5, 6]);
      activeFace(state.dice[0]).enhancements = { bump: 1, boomerang: 3 };
      state.dice[0].faces[1].enhancements.magic = 1;
      state.dice[0].faces[3].enhancements.magnetic = 1;
      activeFace(state.dice[1]).enhancements.magnetic = 1;
      return state;
    };
    const clockmaker = configured();
    clockmaker.boss = { type: 'clockmaker' };
    expect(roll(clockmaker)).toBe('clockmaker');
    const bump = configured();
    expect(roll(bump)).toBe('bump');
    const magnetic = configured();
    delete activeFace(magnetic.dice[0]).enhancements.bump;
    expect(roll(magnetic)).toBe('magnetic');
    const magic = configured();
    delete activeFace(magic.dice[0]).enhancements.bump;
    delete activeFace(magic.dice[1]).enhancements.magnetic;
    expect(roll(magic)).toBe('magic');
    const boomerang = configured();
    delete activeFace(boomerang.dice[0]).enhancements.bump;
    delete activeFace(boomerang.dice[1]).enhancements.magnetic;
    delete boomerang.dice[0].faces[1].enhancements.magic;
    expect(roll(boomerang)).toBe('rng');
    const rng = configured();
    activeFace(rng.dice[0]).enhancements = {};
    delete activeFace(rng.dice[1]).enhancements.magnetic;
    delete rng.dice[0].faces[1].enhancements.magic;
    expect(roll(rng)).toBe('rng');
  });

  it('falls through same-origin Bump, Magnetic, and Magic manual destinations', () => {
    const bumped = game();
    const cursed = createCursedDie();
    cursed.value = 7;
    activeFace(cursed).enhancements.bump = 1;
    bumped.dice.push(cursed);
    new Resolver(bumped, constant(0)).rollBatch([cursed.id], 'manual Bump fallback', 'gameplay', true, 'manual');
    const bumpRoll = [...bumped.historyV2].reverse().find(event => event.kind === 'roll_batch');
    expect(cursed.value).not.toBe(7);
    expect(bumpRoll?.kind === 'roll_batch' ? bumpRoll.results[0] : null)
      .toMatchObject({ controller: 'rng', beforePhysicalFace: 7, previousFaceExcluded: true });

    const magnetic = game();
    values(magnetic, [1, 3, 3, 5, 6]);
    activeFace(magnetic.dice[1]).enhancements.magnetic = 1;
    magnetic.dice[0].faces[0].enhancements.magnetic = 1;
    magnetic.dice[0].faces[3].enhancements.magnetic = 1;
    new Resolver(magnetic, constant(0)).rollBatch([0], 'manual Magnetic exclusion', 'gameplay', true, 'manual');
    const magneticRoll = [...magnetic.historyV2].reverse().find(event => event.kind === 'roll_batch');
    expect(magnetic.dice[0].value).toBe(4);
    expect(magneticRoll?.kind === 'roll_batch' ? magneticRoll.results[0].controller : null).toBe('magnetic');

    const magic = game();
    values(magic, [1, 2, 2, 4, 5]);
    magic.handLevels.ones = 100;
    activeFace(magic.dice[0]).enhancements.magic = 1;
    magic.dice[0].faces[1].enhancements.magic = 1;
    new Resolver(magic, constant(0)).rollBatch([0], 'manual Magic fallback', 'gameplay', true, 'manual');
    const magicRoll = [...magic.historyV2].reverse().find(event => event.kind === 'roll_batch');
    expect(magic.dice[0].value).toBe(2);
    expect(magicRoll?.kind === 'roll_batch' ? magicRoll.results[0] : null)
      .toMatchObject({ controller: 'magic', beforePhysicalFace: 1, afterPhysicalFace: 2,
        previousFaceExcluded: true, magicHand: 'threeKind' });
  });

  it('Magic uses authoritative group qualification and deterministic ranking', () => {
    const state = game();
    values(state, [1, 2, 2, 5, 6]);
    state.dice[0].faces[1].enhancements.magic = 1;
    state.dice[0].faces[5].enhancements.magic = 1;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(.4));
    expect(result.state.dice[0].value).toBe(2);
    const roll = [...result.state.historyV2].reverse().find(event => event.kind === 'roll_batch' && event.reason === 'manual');
    expect(roll?.kind === 'roll_batch' && roll.results[0]).toMatchObject({ controller: 'magic', magicHand: 'threeKind' });
  });

  it('Magic accounts for wildcard qualification and simultaneous rolls share the pre-roll board', () => {
    const mirror = game();
    values(mirror, [1, 6, 2, 4, 5]);
    mirror.handLevels.threeKind = 50;
    activeFace(mirror.dice[1]).enhancements.mirror = 1;
    mirror.dice[0].faces[1].enhancements.magic = 1;
    new Resolver(mirror, constant(.2)).rollBatch([0], 'mirror magic', 'gameplay', true, 'manual');
    const mirrorRoll = [...mirror.historyV2].reverse().find(event => event.kind === 'roll_batch');
    expect(mirrorRoll?.kind === 'roll_batch' ? mirrorRoll.results[0].magicHand : null).toBe('threeKind');

    const missing = game();
    values(missing, [6, 1, 2, 3, 6]);
    missing.handLevels.largeStraight = 50;
    activeFace(missing.dice[4]).enhancements.missingLink = 1;
    missing.dice[0].faces[4].enhancements.magic = 1;
    new Resolver(missing, constant(.2)).rollBatch([0], 'missing-link magic', 'gameplay', true, 'manual');
    const missingRoll = [...missing.historyV2].reverse().find(event => event.kind === 'roll_batch');
    expect(missingRoll?.kind === 'roll_batch' ? missingRoll.results[0].magicHand : null).toBe('largeStraight');

    const simultaneous = game();
    values(simultaneous, [1, 1, 1, 2, 3]);
    simultaneous.handLevels.pair = 100;
    simultaneous.dice[0].faces[5].enhancements.magic = 1;
    simultaneous.dice[1].faces[5].enhancements.magic = 1;
    new Resolver(simultaneous, constant(.2)).rollBatch([0, 1], 'simultaneous magic', 'gameplay', true, 'manual');
    const batch = [...simultaneous.historyV2].reverse().find(event => event.kind === 'roll_batch');
    expect(batch?.kind === 'roll_batch' ? batch.results.map(result => result.magicHand) : null).toEqual(['sixes', 'sixes']);
  });

  it('Shifter commits landings first, excludes itself, and resolves high ties', () => {
    const state = game();
    values(state, [6, 3, 3, 6, 6]);
    state.dice[0].faces[0].enhancements.shifter = 1;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0));
    expect(result.state.dice[0].value).toBe(1);
    expect(result.state.dice[0].faces[0]).toMatchObject({ rank: 6, shifterBaseRank: 1 });
    const roll = [...result.state.historyV2].reverse().find(event => event.kind === 'roll_batch' && event.reason === 'manual');
    expect(roll?.kind === 'roll_batch' && roll.results[0].shifter).toEqual({ from: 1, to: 6 });
  });

  it('simultaneous Shifters use one post-landing snapshot and reset their base ranks next Round', () => {
    const state = game();
    values(state, [6, 6, 2, 5, 5]);
    state.dice[0].faces[0].enhancements.shifter = 1;
    state.dice[1].faces[0].enhancements.shifter = 1;
    new Resolver(state, constant(0)).rollBatch([0, 1], 'simultaneous shifters', 'gameplay', false, 'manual');
    expect([0, 1].map(id => activeFace(state.dice[id]).rank)).toEqual([5, 5]);
    new Resolver(state, constant(.2)).startRound();
    expect([state.dice[0].faces[0].rank, state.dice[1].faces[0].rank]).toEqual([1, 1]);
  });
});
