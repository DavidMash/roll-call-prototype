import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { handStats, HAND_IDS, LOWER_HAND_IDS, relativeHandStrengthTiers, UPPER_HAND_IDS } from './hands';
import { handScore } from './scoring';
import type { GameState, HandId, Rank } from './types';
import { createDieEffect, resetDieRoundState } from './specialDice';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { Resolver } from './effects';

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
  it('derives the clean Level 1 Mult ladder for all fourteen hands', () => {
    expect(HAND_IDS).toHaveLength(14);
    expect(HAND_IDS.map(hand => handStats(hand, 1).handMultiplier)).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8]);
  });

  it.each<[HandId, Rank[], number[], bigint]>([
    ['ones', [1, 2, 3, 4, 5], [0], 1n],
    ['fours', [4, 4, 2, 3, 5], [0, 1], 8n],
    ['pair', [4, 4, 2, 3, 5], [0, 1], 16n],
    ['twoPair', [2, 2, 5, 5, 6], [0, 1, 2, 3], 28n],
    ['threeKind', [4, 4, 4, 2, 6], [0, 1, 2], 36n],
    ['smallStraight', [1, 2, 3, 4, 6], [0, 1, 2, 3], 40n],
    ['fullHouse', [2, 2, 2, 5, 5], [0, 1, 2, 3, 4], 80n],
    ['fourKind', [3, 3, 3, 3, 6], [0, 1, 2, 3], 72n],
    ['largeStraight', [1, 2, 3, 4, 5], [0, 1, 2, 3, 4], 105n],
    ['fiveKind', [6, 6, 6, 6, 6], [0, 1, 2, 3, 4], 240n],
  ])('%s scores only resolved die Pips through its Hand Mult', (hand, values, dieIds, score) => {
    expect(handScore(board(values).dice, hand, dieIds).score).toBe(BigInt(score));
  });
});

describe('scorecard strength tiers', () => {
  it('uses authoritative Hand Mult and compares Upper and Lower independently', () => {
    const levels = newRun('strength-sections').state.handLevels;
    levels.ones = 8;
    const upper = relativeHandStrengthTiers(levels, UPPER_HAND_IDS);
    const lower = relativeHandStrengthTiers(levels, LOWER_HAND_IDS);
    expect(handStats('ones', levels.ones).handMultiplier)
      .toBeGreaterThan(handStats('fiveKind', levels.fiveKind).handMultiplier);
    expect(upper.ones).toBe('strongest');
    expect(lower.fiveKind).toBe('strongest');
  });

  it('allows ties and recalculates tiers when current levels change', () => {
    const levels = newRun('strength-updates').state.handLevels;
    const tied = relativeHandStrengthTiers(levels, UPPER_HAND_IDS);
    expect(tied.sixes).toBe('strongest');
    expect(tied.ones).toBe('normal');

    levels.ones = 10;
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
    expect(result.state.scoreByHand).toEqual({ pair: 16n });
    expect(result.state.effectScore).toBe(BigInt(0n));
    expect(result.state.consumed).toContain('pair');
    expect(result.state.stats.rounds[0].scoreByHand).toEqual({ pair: 16n });
  });

  it('keeps categories separate and resets the round-local breakdown next round', () => {
    let game = board([4, 4, 2, 5, 6]);
    game = dispatch(game, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant()).state;
    game.dice.forEach((die, index) => { die.value = [1, 2, 3, 4, 6][index] as Rank; });
    game = dispatch(game, { type: 'PLAY', hand: 'smallStraight', dieIds: [0, 1, 2, 3] }, constant()).state;
    expect(game.scoreByHand).toEqual({ pair: 16n, smallStraight: 40n });
    game.phase = 'shop';
    game.shop = { stage: 'flames', offers: [], offerRerolls: 0, lifeRestores: 0 };
    const next = dispatch(game, { type: 'NEXT_ROUND' }, constant()).state;
    expect(next.scoreByHand).toEqual({});
    expect(next.effectScore).toBe(BigInt(0n));
  });

  it('attributes Jumping Bean free-play score to its Upper category, not Effect Score', () => {
    const game = board([1, 2, 3, 4, 5]);
    rosterDice(game)[0].effects = [createDieEffect(rosterDice(game)[0].id, 'jumpingBean')];
    syncActiveDiceProjection(game);
    game.dieRoundState = resetDieRoundState(rosterDice(game));
    rosterDice(game)[0].effects[0].persistent.jumpingBeanNumber = 6;
    const resolver = new Resolver(game, sequence(0.99, 0));
    resolver.rollBatch([0], 'Jumping Bean trigger test', 'gameplay');
    resolver.drain();
    expect(game.scoreByHand).toEqual({ sixes: 6n });
    expect(game.effectScore).toBe(BigInt(0n));
    expect(game.score).toBe(BigInt(6n));
    expect(handTotal(game) + game.effectScore).toBe(BigInt(game.score));
    expect(game.stats.rounds[0].effectScore).toBe(BigInt(0n));
  });
});
