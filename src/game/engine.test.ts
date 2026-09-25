import { describe, expect, it, vi } from 'vitest';
import { CONFIG, diceRerollCost, offerRerollCost, targetForRound } from './config';
import { activeFace, rollDie, rollWeights } from './dice';
import { dispatch, newRun } from './engine';
import { enhancementCost, ENHANCEMENT_IDS } from './enhancements';
import { handOptions } from './hands';
import { hashSeed, SeededRng } from './rng';
import { handScore, standaloneScore } from './scoring';
import { exportRun } from './telemetry';
import type { Enhancement, GameState, HandId, RandomSource, Rank } from './types';

const constant = (value = 0.99): RandomSource => ({ next: () => value });
function sequence(...values: number[]): RandomSource {
  let i = 0;
  return { next: () => values[i++] ?? 0.99 };
}
function state(values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const result = newRun('unit-test', constant());
  const game = result.state;
  game.dice.forEach((die, index) => { die.value = values[index]; });
  game.target = 1000000;
  game.stats.rounds[0].target = game.target;
  return game;
}
function enhance(game: GameState, id: number, enhancement: Enhancement, count = 1, rank?: Rank) {
  const face = game.dice[id].faces[(rank ?? game.dice[id].value) - 1];
  face.enhancements[enhancement] = count;
  if (enhancement === 'vintage') face.vintageSellValue = 0;
}
const play = (game: GameState, hand: HandId = 'ones', dieIds = [0], rng = constant()) =>
  dispatch(game, { type: 'PLAY', hand, dieIds }, rng);
function shop(): GameState {
  const game = state();
  game.phase = 'shop';
  game.gold = 100;
  game.shop = { diceRerolls: 0, offerRerolls: 0, trainingOffers: [], offers: [
    { id: 0, enhancement: 'bonus', purchased: false },
    { id: 1, enhancement: 'sticky', purchased: false },
    { id: 2, enhancement: 'weighted', purchased: false },
  ] };
  game.nextOfferId = 3;
  return game;
}

describe('scoring, Bonus and trained hand Mult', () => {
  it('stacks Bonus while ordinary Mult remains the trained hand Base Mult', () => {
    const game = state([2, 2, 2, 4, 5]);
    enhance(game, 0, 'bonus', 2);
    expect(handScore(game.dice, 'threeKind', [0, 1, 2])).toEqual({ pips: 36, multiplier: 2.5, rawScore: 90, score: 90 });
    expect(standaloneScore(activeFace(game.dice[0]))).toEqual({ pips: 22, multiplier: 1, rawScore: 22, score: 22 });
    expect(play(game, 'threeKind', [0, 1, 2]).state.score).toBe(90);
  });
  it('rejects mixed upper-hand sets without mutation or RNG consumption', () => {
    const game = state([2, 2, 2, 4, 5]);
    const rng = { next: vi.fn(() => 0) };
    const result = play(game, 'twos', [0, 3], rng);
    expect(result.error).toBeTruthy();
    expect(result.state).toBe(game);
    expect(rng.next).not.toHaveBeenCalled();
  });
  it('does not mutate input states', () => {
    const game = state();
    const before = structuredClone(game);
    play(game);
    expect(game).toEqual(before);
  });
});

describe('upper-hand subset resolution', () => {
  it.each([{ dieIds: [0] }, { dieIds: [1] }, { dieIds: [0, 1] }, { dieIds: [1, 2] }, { dieIds: [0, 1, 2] }])('scores only selected matching dice $dieIds', ({ dieIds }) => {
    const game = state([4, 4, 4, 2, 6]);
    enhance(game, 0, 'bonus');
    enhance(game, 1, 'bonus', 2);
    const expectedPips = 7 + dieIds.reduce((sum, id) => sum + [14, 24, 4][id], 0);
    const expectedMultiplier = 1;
    const result = play(game, 'fours', dieIds);
    expect(result.error).toBeUndefined();
    expect(result.state.score).toBe(Math.round(expectedPips * expectedMultiplier));
    expect(result.events.find(event => event.type === 'HAND_SCORE_FINALIZED')).toMatchObject({
      dieIds, pips: expectedPips, multiplier: expectedMultiplier,
      rawScore: expectedPips * expectedMultiplier, amount: Math.round(expectedPips * expectedMultiplier), source: 'hand',
    });
  });
  it('rerolls one duplicate, preserves the near-straight and consumes Fours', () => {
    const game = state([1, 2, 4, 4, 5]);
    const result = play(game, 'fours', [3], constant(0.4));
    expect(result.state.score).toBe(11);
    expect(result.events.filter(event => event.type === 'DIE_ROLLED').map(event => event.dieIds)).toEqual([[3]]);
    expect(result.state.dice.map(die => die.value)).toEqual([1, 2, 4, 3, 5]);
    expect(handOptions(result.state.dice, result.state.consumed).some(option => option.id === 'smallStraight')).toBe(true);
    expect(result.state.consumed).toContain('fours');
  });
  it('normal Golden and Workout activate only on selected matching faces', () => {
    const game = state([4, 4, 4, 2, 6]);
    for (const id of [0, 1, 2]) {
      enhance(game, id, 'golden', id + 1);
      enhance(game, id, 'workout', id + 1);
    }
    const result = play(game, 'fours', [1]);
    expect(result.state.score).toBe(11);
    expect(result.state.gold).toBe(2);
    expect(result.state.dice.slice(0, 3).map(die => die.faces[3].workoutPips)).toEqual([0, 2, 0]);
    expect(result.events.filter(event => event.enhancement === 'golden' || event.enhancement === 'workout').map(event => event.dieIds)).toEqual([[1]]);
  });
  it('an unselected matching Hitchhiker adds hand pips with Golden and Workout', () => {
    const game = state([4, 4, 4, 2, 6]);
    enhance(game, 0, 'hitchhiker');
    enhance(game, 1, 'hitchhiker');
    enhance(game, 1, 'golden');
    enhance(game, 1, 'workout');
    const result = play(game, 'fours', [0], sequence(0, 0.99));
    expect(result.state.stats.scoreBySource).toEqual({ hand: 15, hitchhiker: 0, jumpingBean: 0, boss: 0 });
    expect(result.state.stats.hitchhikerPipsContributed).toBe(4);
    expect(result.state.gold).toBe(1);
    expect(result.state.dice[1].faces[3].workoutPips).toBe(1);
    expect(result.state.stats.triggers.hitchhiker).toBe(1);
    expect(result.events.filter(event => event.type === 'DIE_ROLLED').map(event => event.dieIds)).toEqual([[0]]);
    expect(result.state.dice[1].value).toBe(4);
  });
  it('Sticky only suppresses the selected scored reroll; unselected Slippy still rerolls', () => {
    const game = state([4, 4, 4, 2, 6]);
    enhance(game, 0, 'sticky');
    enhance(game, 1, 'sticky');
    enhance(game, 1, 'slippy');
    const result = play(game, 'fours', [0], sequence(0, 0.99));
    expect(result.state.score).toBe(11);
    expect(result.state.dice.slice(0, 3).map(die => die.value)).toEqual([4, 6, 4]);
    expect(result.events.filter(event => event.enhancement === 'sticky').map(event => event.dieIds)).toEqual([[0]]);
    expect(result.events.filter(event => event.type === 'DICE_REROLL_STARTED').map(event => event.dieIds)).toEqual([[1]]);
  });
});

describe('Golden and Workout', () => {
  it('stack on hand scoring and increment after contribution before finalization', () => {
    const game = state();
    enhance(game, 0, 'golden', 2);
    enhance(game, 0, 'workout', 2);
    enhance(game, 0, 'sticky');
    const first = play(game, 'ones', [0], sequence(0, 0));
    expect(first.state.score).toBe(8);
    expect(first.state.gold).toBe(2);
    expect(first.state.dice[0].faces[0].workoutPips).toBe(2);
    expect(first.events.findIndex(e => e.type === 'WORKOUT_INCREMENTED')).toBeLessThan(first.events.findIndex(e => e.type === 'HAND_SCORE_FINALIZED'));
  });
  it('trigger through a Jumping Bean free Upper-hand play', () => {
    const game = state();
    enhance(game, 0, 'jumpingBean', 1, 6);
    enhance(game, 0, 'golden', 2, 6);
    enhance(game, 0, 'workout', 2, 6);
    enhance(game, 0, 'sticky', 1, 6);
    const result = play(game, 'ones', [0], sequence(0.99, 0));
    expect(result.state.score).toBe(21);
    expect(result.state.gold).toBe(2);
    expect(result.state.dice[0].faces[5].workoutPips).toBe(2);
    expect(result.state.stats.scoreBySource.jumpingBean).toBe(13);
    expect(result.state.scoreByHand.sixes).toBe(13);
    expect(result.state.effectScore).toBe(0);
  });
  it('trigger through Hitchhiker and preserve workouts across rounds', () => {
    const game = state();
    enhance(game, 4, 'hitchhiker');
    enhance(game, 4, 'golden', 2);
    enhance(game, 4, 'workout', 2);
    const result = play(game, 'ones', [0], constant(0));
    expect(result.state.score).toBe(13);
    expect(result.state.gold).toBe(2);
    expect(result.state.dice[4].faces[4].workoutPips).toBe(2);
    result.state.phase = 'shop';
    result.state.shop = shop().shop;
    const next = dispatch(result.state, { type: 'NEXT_ROUND' }, constant());
    expect(next.state.dice[4].faces[4].workoutPips).toBe(2);
    expect(next.state.gold).toBe(2);
    expect(next.state.consumed).toEqual([]);
  });
});

describe('Sticky and Slippy', () => {
  it('Sticky prevents the ordinary scored reroll', () => {
    const game = state();
    enhance(game, 0, 'sticky');
    const result = play(game, 'ones', [0], constant(0));
    expect(result.state.dice[0].value).toBe(1);
    expect(result.events.filter(e => e.type === 'DIE_ROLLED')).toHaveLength(0);
    expect(result.state.consumed).toContain('ones');
  });
  it('Slippy rerolls Sticky+Slippy and nonparticipating dice in one deduplicated batch', () => {
    const game = state();
    enhance(game, 0, 'sticky');
    enhance(game, 0, 'slippy');
    enhance(game, 1, 'slippy');
    const result = play(game);
    expect(result.events.filter(e => e.type === 'DICE_REROLL_STARTED').map(e => e.dieIds)).toEqual([[0, 1]]);
    expect(result.events.filter(e => e.type === 'DIE_ROLLED')).toHaveLength(2);
    expect(result.state.dice[0].value).toBe(6);
  });
  it('a normally rerolling Slippy participant only rolls once', () => {
    const game = state();
    enhance(game, 0, 'slippy');
    expect(play(game).events.filter(e => e.type === 'DIE_ROLLED')).toHaveLength(1);
  });
});

describe('Hitchhiker', () => {
  it('only nonparticipants add hand pips, without an extra reroll', () => {
    const game = state();
    enhance(game, 0, 'hitchhiker');
    enhance(game, 4, 'hitchhiker');
    const result = play(game, 'ones', [0], constant(0));
    expect(result.state.score).toBe(13);
    expect(result.state.stats.scoreBySource).toEqual({ hand: 13, jumpingBean: 0, hitchhiker: 0, boss: 0 });
    expect(result.state.stats.hitchhikerPipsContributed).toBe(5);
    expect(result.events.filter(e => e.type === 'DIE_ROLLED').map(e => e.dieIds)).toEqual([[0]]);
    expect(result.state.stats.triggers.hitchhiker).toBe(1);
  });
});

describe('Weighted', () => {
  it('keeps baseline weights uniform and stacks linearly at 1 + stacks', () => {
    const game = state();
    expect(rollWeights(game.dice[0])).toEqual([1, 1, 1, 1, 1, 1]);
    for (const [stackCount, expectedWeight] of [[1, 2], [2, 3], [3, 4]] as const) {
      enhance(game, 0, 'weighted', stackCount, 2);
      expect(rollWeights(game.dice[0])).toEqual([1, 1, 1, 1, expectedWeight, 1]);
    }
    expect(rollWeights(game.dice[0])[4]).not.toBe(8);
  });
  it.each([
    [1, 6], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1],
  ] as const)('maps source face %s to opposite target %s', (source, target) => {
    const game = state();
    enhance(game, 0, 'weighted', 1, source);
    expect(rollWeights(game.dice[0])[target - 1]).toBe(2);
    expect(rollWeights(game.dice[0]).filter(weight => weight > 1)).toEqual([2]);
  });
  it('weights opposite physical faces and supports different sources on the same die', () => {
    const game = state();
    enhance(game, 0, 'weighted', 1, 2);
    expect(rollWeights(game.dice[0])).toEqual([1, 1, 1, 1, 2, 1]);
    enhance(game, 0, 'weighted', 1, 1);
    expect(rollWeights(game.dice[0])).toEqual([1, 1, 1, 1, 2, 2]);
    expect(rollWeights(game.dice[1])).toEqual([1, 1, 1, 1, 1, 1]);
  });
  it('selects correctly at cumulative probability boundaries', () => {
    const game = state();
    enhance(game, 0, 'weighted', 1, 2);
    expect(rollDie(game.dice[0], constant(0.6))).toEqual({ value: 5, weighted: true });
    expect(rollDie(game.dice[0], constant(0.9))).toEqual({ value: 6, weighted: false });
  });
  it('has the expected seeded distribution over many rolls', () => {
    const game = state();
    enhance(game, 0, 'weighted', 1, 2);
    const rng = new SeededRng(hashSeed('distribution'));
    let fives = 0;
    for (let i = 0; i < 16000; i++) if (rollDie(game.dice[0], rng).value === 5) fives++;
    expect(fives / 16000).toBeGreaterThan(0.27);
    expect(fives / 16000).toBeLessThan(0.30);
  });
  it('shop uses identical weights and still emits feedback', () => {
    const game = shop();
    enhance(game, 0, 'weighted', 1, 2);
    const result = dispatch(game, { type: 'REROLL_DICE' }, constant(0.6));
    expect(result.state.dice[0].value).toBe(5);
    expect(result.events.filter(e => e.enhancement === 'weighted').map(e => e.dieIds)).toEqual([[0]]);
  });
});

describe('Magnetic and roll ordering', () => {
  it('a held Magnetic face attracts a rolled die to its Magnetic face', () => {
    const game = state([1, 2, 3, 4, 6]);
    enhance(game, 4, 'magnetic', 1, 6);
    enhance(game, 0, 'magnetic', 1, 3);
    const result = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0.99));
    expect(result.state.dice[0].value).toBe(3);
    expect(result.state.stats.magneticAnchorBatches).toBe(1);
    expect(result.state.stats.magneticAttractions).toBe(1);
  });
  it('an anchor included in the roll batch does not attract', () => {
    const game = state([1, 2, 3, 4, 6]);
    enhance(game, 4, 'magnetic', 1, 6);
    enhance(game, 0, 'magnetic', 1, 3);
    const result = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0, 4] }, constant(0.99));
    expect(result.state.stats.magneticAttractions).toBe(0);
    expect(result.state.dice[0].value).toBe(6);
  });
  it.each([[0.1, 2], [0.9, 5]] as const)('seed-selects among multiple Magnetic destinations (%s)', (random, expected) => {
    const game = state([1, 2, 3, 4, 6]);
    enhance(game, 4, 'magnetic', 1, 6);
    enhance(game, 0, 'magnetic', 1, 2);
    enhance(game, 0, 'magnetic', 1, 5);
    expect(dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(random)).state.dice[0].value).toBe(expected);
  });
  it('Bump takes priority over a held Magnetic anchor', () => {
    const game = state([1, 2, 3, 4, 6]);
    enhance(game, 4, 'magnetic', 1, 6);
    enhance(game, 0, 'bump', 1, 1);
    enhance(game, 0, 'magnetic', 1, 5);
    const result = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0.99));
    expect(result.state.dice[0].value).toBe(2);
    expect(result.state.stats.bumpControlledRolls).toBe(1);
    expect(result.state.stats.magneticAttractions).toBe(0);
  });
});

describe('Jumping Bean', () => {
  it('free-plays the matching Upper hand, preserves availability, then chains', () => {
    const game = state();
    enhance(game, 0, 'jumpingBean', 1, 6);
    const result = play(game, 'ones', [0], sequence(0.99, 0.99, 0));
    expect(result.state.score).toBe(34);
    expect(result.state.dice[0].value).toBe(1);
    expect(result.state.stats.triggers.jumpingBean).toBe(2);
    expect(result.events.filter(e => e.type === 'DIE_ROLLED')).toHaveLength(3);
    expect(result.state.scoreByHand.sixes).toBe(26);
    expect(result.state.consumed).not.toContain('sixes');
    expect(result.state.handPlayCounts.sixes).toBe(2);
  });
  it('Sticky stops automatic rerolls', () => {
    const game = state();
    enhance(game, 0, 'jumpingBean', 1, 6);
    enhance(game, 0, 'sticky', 1, 6);
    const result = play(game, 'ones', [0], sequence(0.99, 0));
    expect(result.state.score).toBe(21);
    expect(result.state.dice[0].value).toBe(6);
    expect(result.events.filter(e => e.type === 'DIE_ROLLED')).toHaveLength(1);
  });
  it('new rerolls can trigger Weighted and another Bean without self-anchoring Magnetic', () => {
    const game = state();
    enhance(game, 0, 'jumpingBean', 1, 6);
    enhance(game, 0, 'jumpingBean', 1, 5);
    enhance(game, 0, 'weighted', 1, 2);
    enhance(game, 0, 'magnetic', 1, 5);
    enhance(game, 0, 'sticky', 1, 5);
    const result = play(game, 'ones', [0], sequence(0.99, 0.6, 0, 0));
    expect(result.state.score).toBe(33);
    expect(result.state.stats.triggers).toMatchObject({ jumpingBean: 2, weighted: 1 });
    expect(result.state.stats.magneticAttractions).toBe(0);
  });
  it('safety cap produces a clear diagnostic stop instead of a browser lock', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const game = state();
      enhance(game, 0, 'jumpingBean', 1, 6);
      const result = play(game);
      expect(result.state.phase).toBe('error');
      expect(result.events).toHaveLength(CONFIG.resolutionEventCap + 1);
      expect(result.state.stats.resolutionError).toContain('infinite ability chain');
      expect(spy).toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});

describe('round boundaries and losing', () => {
  it('awards flat base, unused-reroll Gold, and capped interest before the shop', () => {
    let game = newRun('balance-flow', constant()).state;
    game.bossSchedule = {};
    let earned = 0;
    for (let round = 1; round <= 4; round++) {
      const result = play(game, 'fiveKind', [0, 1, 2, 3, 4]);
      expect(result.error).toBeUndefined();
      const held = earned;
      const bossReward = 0;
      const expectedPayout = 5 + 3 + Math.min(10, Math.floor(held / 5)) + bossReward;
      earned += expectedPayout;
      expect(result.state.phase).toBe('roundSummary');
      expect(result.state.gold).toBe(earned);
      expect(result.state.stats.goldEarned).toBe(earned);
      expect(result.state.stats.goldSpent).toBe(0);
      expect(result.state.stats.rounds.at(-1)).toMatchObject({
        round, target: targetForRound(round), firstCrossedScore: 225,
        finalScore: 225, clearMargin: 225 - targetForRound(round), cleared: true,
      });
      expect(result.state.lastRoundPayout).toEqual({ baseGold: 5, unusedRerollGold: 3,
        interestGold: Math.min(10, Math.floor(held / 5)), bossRewardGold: bossReward,
        heldGoldSnapshot: held, totalRoundRewardGold: expectedPayout });
      const rewards = result.events.filter(event => event.type === 'GOLD_ADDED');
      const rewardIndex = result.events.indexOf(rewards[0]);
      expect(result.events.findIndex(event => event.type === 'ROUND_CLEARED')).toBeLessThan(rewardIndex);
      expect(result.events.some(event => event.type === 'SHOP_OPENED' || event.type === 'FLAME_SELECTION_OPENED')).toBe(false);
      expect(play(result.state, 'fiveKind', [0, 1, 2, 3, 4]).state).toBe(result.state);
      const progressed = dispatch(result.state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant());
      expect(progressed.events.some(event => event.type === 'MAP_TRANSITION')).toBe(true);
      const postReward = progressed.state;
      expect(postReward.phase).toBe('shop');
      const next = dispatch(postReward, { type: 'NEXT_ROUND' }, constant());
      expect(next.state.phase).toBe('round');
      expect(next.state.round).toBe(round + 1);
      expect(next.state.target).toBe(targetForRound(round + 1));
      expect(next.state.gold).toBe(earned);
      expect(next.state.stats.goldEarned).toBe(earned);
      expect(next.events.some(event => event.type === 'GOLD_ADDED')).toBe(false);
      game = next.state;
    }
    const data = exportRun(game);
    expect(data.roundReached).toBe(5);
    expect(data.rounds.map(round => round.target)).toEqual([50, 70, 90, 125, 165]);
    expect(data.goldEarned).toBe(41);
    expect(data.goldSpent).toBe(0);
  });
  it('keeps Golden income separate from the updated baseline reward', () => {
    const game = newRun('balance-golden', constant()).state;
    enhance(game, 0, 'golden', 2);
    const result = play(game, 'fiveKind', [0, 1, 2, 3, 4]);
    const goldenIncome = 2 * CONFIG.goldenGold;
    expect(result.state.phase).toBe('roundSummary');
    expect(result.state.gold).toBe(10);
    expect(result.state.stats.goldEarned).toBe(10);
    expect(result.events.filter(event => event.type === 'GOLD_ADDED').map(event => ({
      amount: event.amount, dieIds: event.dieIds,
    }))).toEqual([
      { amount: goldenIncome, dieIds: [0] },
      { amount: 5, dieIds: undefined },
      { amount: 3, dieIds: undefined },
    ]);
    expect(result.state.stats.triggers.golden).toBe(1);
  });
  it('stops a Jumping Bean follow-up chain immediately after its free hand clears', () => {
    const game = state();
    game.target = 20;
    enhance(game, 0, 'jumpingBean', 1, 6);
    enhance(game, 0, 'golden', 1, 6);
    const result = play(game, 'ones', [0], sequence(0.99, 0.99, 0));
    expect(result.state.phase).toBe('roundSummary');
    expect(result.state.score).toBe(21);
    expect(result.state.gold).toBe(9);
    expect(result.state.stats.rounds[0]).toMatchObject({ firstCrossedScore: 21, finalScore: 21, clearMargin: 1, cleared: true });
    expect(result.events.findIndex(e => e.type === 'HAND_CONSUMED')).toBeLessThan(result.events.findIndex(e => e.type === 'ROUND_CLEARED'));
    expect(result.state.stats.triggers.jumpingBean).toBe(1);
    const shopState = dispatch(result.state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant()).state;
    expect(shopState.shop!.offers).toHaveLength(3);
    expect(new Set(shopState.shop!.offers.map(o => o.enhancement)).size).toBe(3);
  });
  it('initial-roll effects can clear a round after the complete chain', () => {
    const game = shop();
    enhance(game, 0, 'jumpingBean', 1, 6);
    enhance(game, 0, 'bonus', 10, 6);
    const result = dispatch(game, { type: 'NEXT_ROUND' }, sequence(0.99, 0, 0, 0, 0, 0));
    expect(result.state.round).toBe(2);
    expect(result.state.phase).toBe('roundSummary');
    expect(result.state.score).toBe(113);
    expect(result.state.gold).toBe(118);
    expect(result.state.consumed).toEqual([]);
    expect(result.state.stats.rounds.at(-1)!.firstCrossedScore).toBe(113);
  });
  it('valid consumed hands do not prevent loss on the complete board', () => {
    const game = state([1, 2, 2, 4, 5]);
    game.manualRerollsRemaining = 0;
    game.lives = 1;
    game.consumed = ['twos', 'threes', 'fours', 'fives', 'sixes', 'pair', 'twoPair'];
    const result = play(game);
    expect(result.state.phase).toBe('lost');
    expect(result.state.stats.loss).toMatchObject({ afterHand: 'ones', values: [6, 2, 2, 4, 5] });
    expect(result.events.at(-1)!.type).toBe('RUN_LOST');
  });
  it('a remaining lower hand keeps the player alive when all upper categories are consumed', () => {
    const game = state([1, 2, 3, 4, 5]);
    game.consumed = ['twos', 'threes', 'fours', 'fives', 'sixes'];
    expect(play(game, 'ones', [0], constant(0)).state.phase).toBe('round');
  });
  it('clearance takes precedence over no available hand', () => {
    const game = state([1, 2, 2, 4, 5]);
    game.target = 1;
    game.consumed = ['twos', 'threes', 'fours', 'fives', 'sixes', 'pair', 'twoPair'];
    expect(play(game).state.phase).toBe('roundSummary');
  });
});

describe('shop', () => {
  it('applies the purchase only to the exact exposed physical face, without refilling', () => {
    const game = shop();
    const result = dispatch(game, { type: 'BUY', offerId: 0, dieId: 2 });
    expect(result.state.gold).toBe(97);
    expect(result.state.dice[2].faces[2].enhancements.bonus).toBe(1);
    expect(result.state.dice[1].faces[2].enhancements.bonus).toBeUndefined();
    expect(result.state.dice[2].faces[3].enhancements.bonus).toBeUndefined();
    expect(result.state.shop!.offers[0].purchased).toBe(true);
    expect(result.state.shop!.offers).toHaveLength(3);
    expect(result.state.stats.enhancedFaces).toEqual(['D3:3']);
  });
  it('rejects insufficient gold and repurchase without spending', () => {
    const game = shop();
    game.gold = 2;
    expect(dispatch(game, { type: 'BUY', offerId: 0, dieId: 2 }).state).toBe(game);
    game.gold = 100;
    const bought = dispatch(game, { type: 'BUY', offerId: 0, dieId: 2 }).state;
    expect(dispatch(bought, { type: 'BUY', offerId: 0, dieId: 2 }).state).toBe(bought);
  });
  it.each(ENHANCEMENT_IDS.filter(id => !['bonus', 'golden', 'workout', 'sticky', 'weighted', 'jackpot', 'hitchhiker'].includes(id)))('rejects redundant %s without charging', enhancement => {
    const game = shop();
    game.shop!.offers[0].enhancement = enhancement;
    enhance(game, 0, enhancement);
    const result = dispatch(game, { type: 'BUY', offerId: 0, dieId: 0 });
    expect(result.error).toContain('already');
    expect(result.state).toBe(game);
    expect(game.gold).toBe(100);
  });
  it.each<Enhancement>(['bonus', 'golden', 'workout', 'sticky', 'weighted', 'jackpot', 'hitchhiker'])('allows stacking %s', enhancement => {
    const game = shop();
    game.shop!.offers[0].enhancement = enhancement;
    enhance(game, 0, enhancement);
    expect(dispatch(game, { type: 'BUY', offerId: 0, dieId: 0 }).state.dice[0].faces[0].enhancements[enhancement]).toBe(2);
  });
  it.each<Enhancement>(['sticky', 'golden', 'weighted', 'jackpot'])('charges normally for repeated %s purchases on one physical face', enhancement => {
    let game = shop();
    game.shop!.offers[0].enhancement = enhancement;
    game.shop!.offers[1].enhancement = enhancement;
    enhance(game, 0, enhancement);
    const startingGold = game.gold;
    game = dispatch(game, { type: 'BUY', offerId: 0, dieId: 0 }).state;
    game = dispatch(game, { type: 'BUY', offerId: 1, dieId: 0 }).state;
    expect(game.dice[0].faces[0].enhancements[enhancement]).toBe(3);
    expect(game.gold).toBe(startingGold - 2 * enhancementCost(enhancement));
    expect(game.stats.purchases.filter(purchase => purchase.enhancement === enhancement)).toHaveLength(2);
  });
  it('shop reroll prices double, track spend, and prevent unaffordable rerolls', () => {
    let game = shop();
    game = dispatch(game, { type: 'REROLL_DICE' }, constant()).state;
    game = dispatch(game, { type: 'REROLL_DICE' }, constant()).state;
    game = dispatch(game, { type: 'REROLL_OFFERS' }, constant()).state;
    game = dispatch(game, { type: 'REROLL_OFFERS' }, constant()).state;
    expect(game.gold).toBe(85);
    expect(game.stats.goldSpent).toBe(15);
    expect(diceRerollCost(game.shop!.diceRerolls)).toBe(8);
    expect(offerRerollCost(game.shop!.offerRerolls)).toBe(12);
    expect(game.stats.shopDiceRerolls).toBe(2);
    expect(game.stats.enhancementShopRerolls).toBe(2);
    game.gold = 0;
    expect(dispatch(game, { type: 'REROLL_DICE' }).error).toBeTruthy();
    expect(dispatch(game, { type: 'REROLL_OFFERS' }).error).toBeTruthy();
  });
  it('resets costs for the next shop', () => {
    const game = shop();
    game.shop!.diceRerolls = 4;
    game.shop!.offerRerolls = 3;
    enhance(game, 0, 'jumpingBean', 1, 6);
    enhance(game, 0, 'bonus', 10, 6);
    enhance(game, 0, 'sticky', 1, 6);
    const result = dispatch(game, { type: 'NEXT_ROUND' }, sequence(0.99, 0.99, 0.99, 0.99, 0.99, 0));
    expect(result.state.phase).toBe('roundSummary');
    const continued = dispatch(result.state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant()).state;
    expect(continued.shop).toMatchObject({ diceRerolls: 0, offerRerolls: 0 });
  });
  it('all abilities except Weighted are inert during shop rolls', () => {
    const game = shop();
    for (const enhancement of ENHANCEMENT_IDS) enhance(game, 0, enhancement, 1, 6);
    enhance(game, 0, 'weighted', 1, 1);
    const result = dispatch(game, { type: 'REROLL_DICE' }, constant());
    expect(result.state.score).toBe(0);
    expect(result.state.gold).toBe(98);
    expect(result.state.dice[0].faces[5].workoutPips).toBe(0);
    expect(result.state.stats.triggers).toEqual({ weighted: 1 });
    expect(result.events.filter(e => e.type === 'DIE_ROLLED')).toHaveLength(5);
  });
});

describe('reproducibility and end-to-end domain flow', () => {
  it('same seed and action sequence reproduce the entire state and trace', () => {
    let a = newRun('reproduce').state;
    let b = newRun('reproduce').state;
    for (let step = 0; step < 40; step++) {
      expect(a).toEqual(b);
      if (a.phase === 'round') {
        const option = handOptions(a.dice, a.consumed).find(item => !item.consumed);
        const action = option ? { type: 'PLAY' as const, hand: option.id, dieIds: option.combinations[0] }
          : { type: 'MANUAL_REROLL' as const, dieIds: [0] };
        const ar = dispatch(a, action), br = dispatch(b, action);
        expect(ar.events).toEqual(br.events);
        a = ar.state; b = br.state;
        } else if (a.phase === 'roundSummary') {
          a = dispatch(a, { type: 'CONTINUE_ROUND_SUMMARY' }).state; b = dispatch(b, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
        } else if (a.phase === 'flameSelection') {
          const action = a.flameSelection!.acquired
            ? { type: 'CONTINUE_FLAME_SELECTION' as const }
            : { type: 'CHOOSE_FLAME' as const, offerId: a.flameSelection!.offers[0].id, dieId: 0 };
          a = dispatch(a, action).state; b = dispatch(b, action).state;
        } else if (a.phase === 'shop') {
        const action = a.bust ? { type: 'RETRY_ROUND' as const } : { type: 'NEXT_ROUND' as const };
        a = dispatch(a, action).state; b = dispatch(b, action).state;
      } else break;
    }
    expect(exportRun(a).seed).toBe('reproduce');
    expect(exportRun(a).actions.length).toBeGreaterThan(0);
  });
  it('audits playable runs from initial rolls through shops, purchases, next rounds and loss', () => {
    let clears = 0, losses = 0, purchases = 0;
    for (let seed = 0; seed < 20; seed++) {
      let game = newRun(`audit-${seed}`).state;
      game.bossSchedule = {};
      for (let step = 0; step < 200 && game.phase !== 'lost'; step++) {
        if (game.phase === 'round') {
          const options = handOptions(game.dice, game.consumed).filter(option => !option.consumed);
          const choices = options.flatMap(option => option.combinations.map(ids => ({ hand: option.id, ids,
            score: handScore(game.dice, option.id, ids).score })));
          choices.sort((a, b) => b.score - a.score);
          if (choices.length) game = dispatch(game, { type: 'PLAY', hand: choices[0].hand, dieIds: choices[0].ids }).state;
          else {
            expect(game.manualRerollsRemaining).toBeGreaterThan(0);
            game = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }).state;
          }
        } else if (game.phase === 'roundSummary') {
          game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
        } else if (game.phase === 'flameSelection') {
          game = game.flameSelection!.acquired
            ? dispatch(game, { type: 'CONTINUE_FLAME_SELECTION' }).state
            : dispatch(game, { type: 'CHOOSE_FLAME', offerId: game.flameSelection!.offers[0].id, dieId: seed % 5 }).state;
        } else if (game.phase === 'shop') {
          if (game.bust) { game = dispatch(game, { type: 'RETRY_ROUND' }).state; continue; }
          clears++;
          for (const offer of game.shop!.offers) {
            const bought = dispatch(game, { type: 'BUY', offerId: offer.id, dieId: 0 });
            if (!bought.error) { game = bought.state; purchases++; }
          }
          game = dispatch(game, { type: 'NEXT_ROUND' }).state;
        } else throw new Error(`Unexpected ${game.phase}`);
      }
      if (game.phase === 'lost') losses++;
      expect(game.stats.scoreBySource.hand + game.stats.scoreBySource.jumpingBean + game.stats.scoreBySource.hitchhiker + game.stats.scoreBySource.boss)
        .toBe(game.stats.rounds.reduce((sum, round) => sum + round.finalScore, 0));
    }
    expect(clears).toBeGreaterThan(0);
    expect(purchases).toBeGreaterThan(0);
    expect(losses).toBe(20);
  }, 30000);
});
