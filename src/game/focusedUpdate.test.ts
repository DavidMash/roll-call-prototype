import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { attachmentError, ENHANCEMENTS, ENHANCEMENT_IDS, enhancementCost, stacks } from './enhancements';
import { FLAME_IDS } from './flames';
import { handStats } from './hands';
import type { Enhancement, Flame, GameState, HandId, RandomSource, Rank } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });
function sequence(...values: number[]): RandomSource {
  let index = 0;
  return { next: () => values[index++] ?? 0 };
}
const upperByRank: Record<Rank, HandId> = {
  1: 'ones', 2: 'twos', 3: 'threes', 4: 'fours', 5: 'fives', 6: 'sixes',
};
function baseState(): GameState {
  const game = newRun('focused-update', constant(0.2)).state;
  game.dice.forEach((die, index) => { die.value = (index + 1) as Rank; });
  game.target = 1_000_000;
  game.stats.rounds[0].target = game.target;
  return game;
}
function add(game: GameState, dieId: number, enhancement: Enhancement, rank: Rank, count = 1) {
  game.dice[dieId].faces[rank - 1].enhancements[enhancement] = count;
}
function deterministicBean(rank: Rank, configure?: (game: GameState) => void, rng: RandomSource = constant(0)) {
  const game = baseState();
  const before = (rank === 1 ? 6 : rank - 1) as Rank;
  game.dice[0].value = before;
  add(game, 0, 'bump', before);
  add(game, 0, 'jumpingBean', rank);
  add(game, 0, 'sticky', rank);
  configure?.(game);
  return dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }, rng);
}

describe('focused enhancement roster and migration', () => {
  it('contains exactly the 13 requested enhancements and locks their prices', () => {
    expect(ENHANCEMENT_IDS).toEqual([
      'bonus', 'jumpingBean', 'golden', 'workout', 'missingLink', 'mirror', 'magnetic',
      'sticky', 'slippy', 'hitchhiker', 'weighted', 'jackpot', 'bump',
    ]);
    expect(Object.fromEntries(ENHANCEMENT_IDS.map(id => [id, enhancementCost(id)]))).toEqual({
      bonus: 3, jumpingBean: 2, golden: 2, workout: 3, missingLink: 2, mirror: 2,
      magnetic: 3, sticky: 1, slippy: 1, hitchhiker: 2, weighted: 3, jackpot: 3, bump: 2,
    });
    expect((CONFIG.enhancementCosts as Record<string, number | undefined>).multiplier).toBeUndefined();
  });

  it('uses authoritative stack metadata and rejects a fourth capped stack', () => {
    expect(ENHANCEMENTS.golden.maxStacks).toBe(3);
    expect(ENHANCEMENTS.jackpot.maxStacks).toBe(3);
    for (const enhancement of ['sticky', 'hitchhiker', 'golden', 'jackpot'] as const) {
      const face = baseState().dice[0].faces[0];
      face.enhancements[enhancement] = 3;
      expect(attachmentError(face, enhancement)).toContain('capped at 3');
    }
  });

  it.each(['golden', 'jackpot'] as const)('rejects a fourth %s purchase without spending Gold', enhancement => {
    const game = baseState();
    game.phase = 'shop';
    game.gold = 20;
    game.shop = { offers: [{ id: 1, enhancement, purchased: false }], trainingOffers: [], diceRerolls: 0, offerRerolls: 0 };
    activeFace(game.dice[0]).enhancements[enhancement] = 3;
    const result = dispatch(game, { type: 'BUY', offerId: 1, dieId: 0 });
    expect(result.error).toContain('capped at 3');
    expect(result.state.gold).toBe(20);
    expect(activeFace(result.state.dice[0]).enhancements[enhancement]).toBe(3);
  });

  it('filters a stale Multiplier offer so it cannot be purchased', () => {
    const game = baseState();
    game.phase = 'shop';
    game.gold = 20;
    game.shop = { offers: [{ id: 1, enhancement: 'multiplier' as Enhancement, purchased: false }], trainingOffers: [], diceRerolls: 0, offerRerolls: 0 };
    const result = dispatch(game, { type: 'BUY', offerId: 1, dieId: 0 });
    expect(result.error).toContain('available offer');
    expect(result.state.gold).toBe(20);
    expect(result.state.shop!.offers).toEqual([]);
  });

  it('removes stale Multiplier and Loose Cannon and clamps stale Golden/Jackpot stacks', () => {
    const game = baseState();
    const face = activeFace(game.dice[0]);
    (face.enhancements as Record<string, number>).multiplier = 99;
    face.enhancements.golden = 12;
    face.enhancements.jackpot = 8;
    game.dice[0].flame = { id: 'looseCannon' as Flame, investedGold: 100 };
    game.bonfires = ['looseCannon' as Flame];
    const result = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [1] }, constant(0.2));
    expect((result.state.dice[0].faces[0].enhancements as Record<string, number>).multiplier).toBeUndefined();
    expect(result.state.dice[0].faces[0].enhancements.golden).toBe(3);
    expect(result.state.dice[0].faces[0].enhancements.jackpot).toBe(3);
    expect(result.state.dice[0].flame).toBeNull();
    expect(result.state.bonfires).toEqual([]);
    expect(FLAME_IDS).toHaveLength(13);
  });
});

describe('Jumping Bean free Upper-hand domain path', () => {
  it.each([1, 2, 3, 4, 5, 6] as Rank[])('maps face %s to its one-die Upper free play', rank => {
    const hand = upperByRank[rank];
    const result = deterministicBean(rank);
    expect(result.state.scoreByHand).toEqual({ [hand]: 7 + rank });
    expect(result.state.score).toBe(7 + rank);
    expect(result.state.effectScore).toBe(0);
    expect(result.state.stats.scoreBySource.jumpingBean).toBe(7 + rank);
    expect(result.state.stats.standaloneScores).toEqual([]);
    expect(result.state.stats.handScores[0]).toMatchObject({ hand, dieIds: [0], basePips: 7,
      baseMultiplier: 1, multiplier: 1, playSource: 'jumpingBean', consumedHand: false });
    expect(result.state.consumed).not.toContain(hand);
  });

  it('works after normal availability is consumed and leaves it consumed without adding another entry', () => {
    const result = deterministicBean(4, game => { game.consumed = ['fours']; });
    expect(result.error).toBeUndefined();
    expect(result.state.scoreByHand.fours).toBe(11);
    expect(result.state.consumed).toEqual(['fours']);
    expect(result.events.find(event => event.type === 'JUMPING_BEAN_FREE_PLAY')).toMatchObject({
      hand: 'fours', dieIds: [0], playSource: 'jumpingBean', handConsumed: false,
    });
  });

  it('uses trained Base Pips and Base Mult and increments history afterward', () => {
    const result = deterministicBean(5, game => {
      game.handLevels.fives = 4;
      game.handPlayCounts.fives = 7;
    });
    const stats = handStats('fives', 4);
    expect(result.state.stats.handScores[0]).toMatchObject({
      handLevel: 4, basePips: stats.basePips, baseMultiplier: stats.baseMultiplier,
      pips: stats.basePips + 5, multiplier: stats.baseMultiplier,
    });
    expect(result.state.handPlayCounts.fives).toBe(8);
    expect(result.state.stats.jumpingBeanFreePlays[0]).toMatchObject({
      previousPlayCount: 7, handPlayCountAfter: 8, consumedHand: false,
    });
  });

  it('uses only the triggering die despite other matching dice and never checks Hitchhiker or Slippy', () => {
    const result = deterministicBean(4, game => {
      game.dice[1].value = 4;
      game.dice[2].value = 4;
      add(game, 3, 'hitchhiker', game.dice[3].value);
      add(game, 4, 'slippy', game.dice[4].value);
    });
    expect(result.state.stats.handScores[0].dieIds).toEqual([0]);
    expect(result.state.stats.probabilityProcs.hitchhiker.checks).toBe(0);
    expect(result.state.stats.triggers.slippy).toBeUndefined();
    expect(result.events.filter(event => event.type === 'DICE_REROLL_STARTED').map(event => event.dieIds)).toEqual([[0]]);
  });
});

describe('Jumping Bean effects and Flames', () => {
  it('applies Bonus, capped Golden, and future-only Workout growth', () => {
    const result = deterministicBean(3, game => {
      add(game, 0, 'bonus', 3, 2);
      add(game, 0, 'golden', 3, 20);
      add(game, 0, 'workout', 3, 2);
    });
    expect(result.state.stats.handScores[0]).toMatchObject({ pips: 30, score: 30, bonusPips: 20 });
    expect(result.state.stats.goldBySource.golden).toBe(3);
    expect(result.state.dice[0].faces[2].workoutPips).toBe(2);
    expect(stacks(result.state.dice[0].faces[2], 'golden')).toBe(3);
  });

  it('lets capped Golden pay again on repeated Bean scoring events', () => {
    const game = baseState();
    game.dice[0].value = 1;
    add(game, 0, 'jumpingBean', 6);
    add(game, 0, 'golden', 6, 3);
    add(game, 0, 'sticky', 6);
    const result = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }, sequence(0.99, 0.99, 0.99, 0));
    expect(result.state.scoreByHand.sixes).toBe(26);
    expect(result.state.stats.goldBySource.golden).toBe(6);
    expect(result.state.stats.triggers.golden).toBe(2);
  });

  it.each([
    { flame: 'ultimate' as const, rank: 4 as Rank, expected: 5 },
    { flame: 'minigun' as const, rank: 4 as Rank, expected: 5 },
    { flame: 'hailMary' as const, rank: 4 as Rank, expected: 5, zeroRerolls: true },
    { flame: 'dragonsHoard' as const, rank: 4 as Rank, expected: 5, gold: 100 },
    { flame: 'wellTrained' as const, rank: 4 as Rank, expected: 3, previous: 10 },
    { flame: 'moneyToBurn' as const, rank: 4 as Rank, expected: 5, spend: 100 },
    { flame: 'lowball' as const, rank: 2 as Rank, expected: 5 },
  ])('$flame applies as a normal hand-based factor', testCase => {
    const result = deterministicBean(testCase.rank, game => {
      game.dice[0].flame = { id: testCase.flame, investedGold: 100 };
      if (testCase.zeroRerolls) game.manualRerollsRemaining = 1;
      if (testCase.gold) game.gold = testCase.gold;
      if (testCase.previous) game.handPlayCounts[upperByRank[testCase.rank]] = testCase.previous;
      if (testCase.spend) game.lifetimeNormalShopGoldSpent = testCase.spend;
    });
    expect(result.state.stats.handScores[0].xMult).toBe(testCase.expected);
    expect(result.state.stats.handScores[0].score).toBe((7 + testCase.rank) * testCase.expected);
  });

  it('allows Personal Trainer after finalization and reads Well Trained history before increment', () => {
    const trainer = deterministicBean(5, game => {
      game.dice[0].flame = { id: 'personalTrainer', investedGold: 100 };
    }, constant(0));
    expect(trainer.state.stats.handScores[0]).toMatchObject({ handLevel: 1, score: 12 });
    expect(trainer.state.handLevels.fives).toBe(2);
    expect(trainer.state.handPlayCounts.fives).toBe(1);
    expect(trainer.state.stats.jumpingBeanFreePlays[0].personalTrainerSucceeded).toBe(true);

    const well = deterministicBean(5, game => {
      game.dice[0].flame = { id: 'wellTrained', investedGold: 100 };
      game.handPlayCounts.fives = 10;
    });
    expect(well.state.stats.handScores[0].xMult).toBe(3);
    expect(well.state.handPlayCounts.fives).toBe(11);
  });

  it('does not activate Lower-only Flames or change Hot Streak', () => {
    for (const flame of ['targetPractice', 'straightShooter', 'doubleDown', 'hotStreak'] as Flame[]) {
      const result = deterministicBean(4, game => {
        game.bonfires = [flame];
        game.targetPracticeHand = 'pair';
        game.hotStreakGoal = 'pair';
        game.hotStreakCharges = 2;
      });
      expect(result.state.stats.handScores[0].xMultFactors.some(factor => factor.source === flame)).toBe(false);
      expect(result.state.hotStreakGoal).toBe('pair');
      expect(result.state.hotStreakCharges).toBe(2);
    }
  });

  it('never consumes armed Charge while qualifying rolls still build its meter', () => {
    const result = deterministicBean(4, game => {
      game.bonfires = ['charge'];
      game.chargeXMult = 3;
      game.chargeArmed = true;
    });
    expect(result.state.stats.handScores[0].xMultFactors.some(factor => factor.source === 'charge')).toBe(false);
    expect(result.state.chargeArmed).toBe(true);
    expect(result.state.chargeXMult).toBe(4);
    expect(result.state.stats.chargeConsumed).toBe(0);
  });
});

describe('Jumping Bean movement and deterministic chains', () => {
  it('records Sticky blocking the one follow-up reroll', () => {
    const result = deterministicBean(6);
    expect(result.state.dice[0].value).toBe(6);
    expect(result.state.stats.jumpingBeanFreePlays[0]).toMatchObject({
      stickyPreventedReroll: true, followupRerolled: false, roundCleared: false,
    });
  });

  it('lets Bump control the real follow-up roll', () => {
    const game = baseState();
    game.dice[0].value = 1;
    add(game, 0, 'jumpingBean', 5);
    add(game, 0, 'bump', 5);
    const result = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }, sequence(0.7));
    expect(result.state.scoreByHand.fives).toBe(12);
    expect(result.state.dice[0].value).toBe(6);
    expect(result.state.stats.bumpControlledRolls).toBe(1);
    expect(result.state.stats.jumpingBeanFreePlays[0].followupRerolled).toBe(true);
  });

  it('passes through the unchanged held-anchor Magnetic pipeline', () => {
    const game = baseState();
    game.dice[0].value = 1;
    game.dice[1].value = 4;
    add(game, 1, 'magnetic', 4);
    add(game, 0, 'magnetic', 6);
    add(game, 0, 'jumpingBean', 6);
    add(game, 0, 'sticky', 6);
    const result = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0));
    expect(result.state.stats.magneticAttractions).toBe(1);
    expect(result.state.scoreByHand.sixes).toBe(13);
    expect(result.state.dice[0].value).toBe(6);
  });

  it('chains into another Bean and increments each matching history once', () => {
    const game = baseState();
    game.dice[0].value = 1;
    add(game, 0, 'jumpingBean', 5);
    add(game, 0, 'jumpingBean', 6);
    add(game, 0, 'sticky', 6);
    const action = { type: 'MANUAL_REROLL' as const, dieIds: [0] };
    const rngValues = [0.7, 0.99, 0];
    const first = dispatch(game, action, sequence(...rngValues));
    const second = dispatch(game, action, sequence(...rngValues));
    expect(first).toEqual(second);
    expect(first.state.scoreByHand).toEqual({ fives: 12, sixes: 13 });
    expect(first.state.handPlayCounts).toMatchObject({ fives: 1, sixes: 1 });
    expect(first.state.stats.jumpingBeanFreePlays).toHaveLength(2);
  });
});
