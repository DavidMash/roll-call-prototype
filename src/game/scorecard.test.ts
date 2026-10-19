import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { handStats, HAND_IDS, LOWER_HAND_IDS, relativeHandStrengthTiers, startingBasePips, UPPER_HAND_IDS } from './hands';
import { handScore } from './scoring';
import type { GameState, HandId, Rank } from './types';

const constant = (value = 0.99) => ({ next: () => value });
function sequence(...values: number[]) {
  let index = 0;
  return { next: () => values[index++] ?? 0.99 };
}
function board(values: Rank[]): GameState {
  const game = newRun('scorecard-domain', constant()).state;
  game.dice.forEach((die, index) => { die.value = values[index]; });
  game.target = 100000n;
  game.stats.rounds[0].target = game.target;
  return game;
}
const handTotal = (game: GameState) => Object.values(game.scoreByHand).reduce((sum, score) => sum + score, 0n);

describe('intrinsic hand stats', () => {
  it('derives the rebalanced Level 1 Base Pips for all fourteen hands', () => {
    expect(HAND_IDS).toHaveLength(14);
    expect(HAND_IDS.map(startingBasePips)).toEqual([7, 7, 7, 7, 7, 7, 8, 9, 10, 10, 12, 13, 13, 15]);
  });

  it.each<[HandId, Rank[], number[], bigint]>([
    ['ones', [1, 2, 3, 4, 5], [0], 8n],
    ['fours', [4, 4, 2, 3, 5], [0, 1], 15n],
    ['pair', [4, 4, 2, 3, 5], [0, 1], 24n],
    ['twoPair', [2, 2, 5, 5, 6], [0, 1, 2, 3], 46n],
    ['threeKind', [4, 4, 4, 2, 6], [0, 1, 2], 55n],
    ['smallStraight', [1, 2, 3, 4, 6], [0, 1, 2, 3], 50n],
    ['fullHouse', [2, 2, 2, 5, 5], [0, 1, 2, 3, 4], 98n],
    ['fourKind', [3, 3, 3, 3, 6], [0, 1, 2, 3], 100n],
    ['largeStraight', [1, 2, 3, 4, 5], [0, 1, 2, 3, 4], 112n],
    ['fiveKind', [6, 6, 6, 6, 6], [0, 1, 2, 3, 4], 225n],
  ])('%s includes Base Pips before its multiplier', (hand, values, dieIds, score) => {
    expect(handScore(board(values).dice, hand, dieIds).score).toBe(BigInt(score));
  });
});

describe('scorecard strength tiers', () => {
  it('uses authoritative Base Pips × Base Mult and compares Upper and Lower independently', () => {
    const levels = newRun('strength-sections').state.handLevels;
    levels.ones = 8;
    const upper = relativeHandStrengthTiers(levels, UPPER_HAND_IDS);
    const lower = relativeHandStrengthTiers(levels, LOWER_HAND_IDS);
    expect(handStats('ones', levels.ones).basePips * handStats('ones', levels.ones).baseMultiplier)
      .toBeGreaterThan(handStats('fiveKind', levels.fiveKind).basePips * handStats('fiveKind', levels.fiveKind).baseMultiplier);
    expect(upper.ones).toBe('strongest');
    expect(lower.fiveKind).toBe('strongest');
  });

  it('allows ties and recalculates tiers when current levels change', () => {
    const levels = newRun('strength-updates').state.handLevels;
    const tied = relativeHandStrengthTiers(levels, UPPER_HAND_IDS);
    expect(UPPER_HAND_IDS.every(hand => tied[hand] === 'strongest')).toBe(true);

    levels.ones = 2;
    const trained = relativeHandStrengthTiers(levels, UPPER_HAND_IDS);
    expect(trained.ones).toBe('strongest');
    expect(UPPER_HAND_IDS.filter(hand => hand !== 'ones').every(hand => trained[hand] === 'normal')).toBe(true);
  });
});

describe('authoritative current-round scorecard totals', () => {
  it('starts with blank hand totals and zero Effect Score', () => {
    const game = newRun('scorecard-initial', constant()).state;
    expect(game.scoreByHand).toEqual({});
    expect(game.effectScore).toBe(BigInt(0n));
    expect(game.score).toBe(BigInt(0n));
  });

  it('records a consumed hand under only its category', () => {
    const result = dispatch(board([4, 4, 2, 5, 6]), { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant());
    expect(result.state.scoreByHand).toEqual({ pair: 24n });
    expect(result.state.effectScore).toBe(BigInt(0n));
    expect(result.state.consumed).toContain('pair');
    expect(result.state.stats.rounds[0].scoreByHand).toEqual({ pair: 24n });
  });

  it('keeps categories separate and resets the round-local breakdown next round', () => {
    let game = board([4, 4, 2, 5, 6]);
    activeFace(game.dice[0]).enhancements.sticky = 1;
    activeFace(game.dice[1]).enhancements.sticky = 1;
    game = dispatch(game, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant()).state;
    game.dice.forEach((die, index) => { die.value = [1, 2, 3, 4, 6][index] as Rank; });
    game = dispatch(game, { type: 'PLAY', hand: 'smallStraight', dieIds: [0, 1, 2, 3] }, constant()).state;
    expect(game.scoreByHand).toEqual({ pair: 24n, smallStraight: 50n });
    game.phase = 'shop';
    game.shop = { stage: 'fireKeeping', offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    const next = dispatch(game, { type: 'NEXT_ROUND' }, constant()).state;
    expect(next.scoreByHand).toEqual({});
    expect(next.effectScore).toBe(BigInt(0n));
  });

  it('attributes Jumping Bean free-play score to its Upper category, not Effect Score', () => {
    const game = board([1, 2, 3, 4, 5]);
    game.dice[0].faces[5].enhancements.jumpingBean = 1;
    game.dice[0].faces[5].enhancements.sticky = 1;
    const result = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }, sequence(0.99, 0));
    expect(result.state.scoreByHand).toEqual({ sixes: 13n });
    expect(result.state.effectScore).toBe(BigInt(0n));
    expect(result.state.score).toBe(BigInt(13n));
    expect(handTotal(result.state) + result.state.effectScore).toBe(BigInt(result.state.score));
    expect(result.state.stats.rounds[0].effectScore).toBe(BigInt(0n));
  });
});
