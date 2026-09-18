import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { HANDS, HAND_IDS } from './hands';
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
  game.target = 100000;
  game.stats.rounds[0].target = game.target;
  return game;
}
const handTotal = (game: GameState) => Object.values(game.scoreByHand).reduce((sum, score) => sum + score, 0);

describe('intrinsic hand stats', () => {
  it('gives all fourteen hand definitions 10 Base Pips', () => {
    expect(HAND_IDS).toHaveLength(14);
    expect(HAND_IDS.map(hand => HANDS[hand].basePips)).toEqual(Array(14).fill(10));
  });

  it.each<[HandId, Rank[], number[], number]>([
    ['ones', [1, 2, 3, 4, 5], [0], 11],
    ['fours', [4, 4, 2, 3, 5], [0, 1], 18],
    ['pair', [4, 4, 2, 3, 5], [0, 1], 27],
    ['twoPair', [2, 2, 5, 5, 6], [0, 1, 2, 3], 48],
    ['threeKind', [4, 4, 4, 2, 6], [0, 1, 2], 55],
    ['smallStraight', [1, 2, 3, 4, 6], [0, 1, 2, 3], 50],
    ['fullHouse', [2, 2, 2, 5, 5], [0, 1, 2, 3, 4], 91],
    ['fourKind', [3, 3, 3, 3, 6], [0, 1, 2, 3], 88],
    ['largeStraight', [1, 2, 3, 4, 5], [0, 1, 2, 3, 4], 100],
    ['fiveKind', [6, 6, 6, 6, 6], [0, 1, 2, 3, 4], 200],
  ])('%s includes Base Pips before its multiplier', (hand, values, dieIds, score) => {
    expect(handScore(board(values).dice, hand, dieIds).score).toBe(score);
  });
});

describe('authoritative current-round scorecard totals', () => {
  it('starts with blank hand totals and zero Effect Score', () => {
    const game = newRun('scorecard-initial', constant()).state;
    expect(game.scoreByHand).toEqual({});
    expect(game.effectScore).toBe(0);
    expect(game.score).toBe(0);
  });

  it('records a consumed hand under only its category', () => {
    const result = dispatch(board([4, 4, 2, 5, 6]), { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant());
    expect(result.state.scoreByHand).toEqual({ pair: 27 });
    expect(result.state.effectScore).toBe(0);
    expect(result.state.consumed).toContain('pair');
    expect(result.state.stats.rounds[0].scoreByHand).toEqual({ pair: 27 });
  });

  it('adds Sustainable replays to the same category instead of overwriting it', () => {
    const game = board([4, 4, 2, 5, 6]);
    for (const enhancement of ['sticky', 'sustainable', 'workout'] as const) activeFace(game.dice[0]).enhancements[enhancement] = 1;
    activeFace(game.dice[1]).enhancements.sticky = 1;
    const first = dispatch(game, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(0));
    expect(first.state.scoreByHand.pair).toBe(27);
    expect(first.state.consumed).not.toContain('pair');
    const second = dispatch(first.state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant());
    expect(second.state.scoreByHand.pair).toBe(55.5);
    expect(second.state.consumed).toContain('pair');
  });

  it('keeps categories separate and resets the round-local breakdown next round', () => {
    let game = board([4, 4, 2, 5, 6]);
    activeFace(game.dice[0]).enhancements.sticky = 1;
    activeFace(game.dice[1]).enhancements.sticky = 1;
    game = dispatch(game, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant()).state;
    game.dice.forEach((die, index) => { die.value = [1, 2, 3, 4, 6][index] as Rank; });
    game = dispatch(game, { type: 'PLAY', hand: 'smallStraight', dieIds: [0, 1, 2, 3] }, constant()).state;
    expect(game.scoreByHand).toEqual({ pair: 27, smallStraight: 50 });
    game.phase = 'shop';
    game.shop = { offers: [], diceRerolls: 0, offerRerolls: 0 };
    const next = dispatch(game, { type: 'NEXT_ROUND' }, constant()).state;
    expect(next.scoreByHand).toEqual({});
    expect(next.effectScore).toBe(0);
  });

  it('attributes standalone Jumping Bean score only to Effect Score and reconciles the round total', () => {
    const game = board([1, 2, 3, 4, 5]);
    game.dice[0].faces[5].enhancements.jumpingBean = 1;
    game.dice[0].faces[5].enhancements.sticky = 1;
    const result = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }, sequence(0.99, 0));
    expect(result.state.scoreByHand).toEqual({});
    expect(result.state.effectScore).toBe(6);
    expect(result.state.score).toBe(6);
    expect(handTotal(result.state) + result.state.effectScore).toBe(result.state.score);
    expect(result.state.stats.rounds[0].effectScore).toBe(6);
  });
});
