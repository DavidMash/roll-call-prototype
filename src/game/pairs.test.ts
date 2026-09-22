import { describe, expect, it } from 'vitest';
import { activeFace, createDice } from './dice';
import { dispatch, newRun } from './engine';
import { combinationsForHand, defaultCombination, HAND_IDS, handOptions, hasPlayableHand, isValidSelection, HANDS } from './hands';
import { handScore } from './scoring';
import { canPlay, emptySelection, selectHand, toggleDie } from './selection';
import type { Die, Enhancement, GameState, Rank } from './types';

const rng = () => ({ next: () => 0.99 });
function dice(values: Rank[], mirrors: number[] = []): Die[] {
  const board = createDice();
  board.forEach((die, index) => { die.value = values[index]; });
  mirrors.forEach(id => { activeFace(board[id]).enhancements.mirror = 1; });
  return board;
}
function game(values: Rank[]): GameState {
  const state = newRun('pair-test', rng()).state;
  state.dice = dice(values);
  state.target = 100000;
  state.stats.rounds[0].target = state.target;
  return state;
}
function enhance(state: GameState, id: number, enhancement: Enhancement, count = 1) {
  activeFace(state.dice[id]).enhancements[enhancement] = count;
}

describe('Pair and Two Pair qualification', () => {
  it('finds every two-die physical pair in three or four matching dice', () => {
    expect(combinationsForHand(dice([4, 4, 4, 2, 6]), 'pair')).toEqual([[0, 1], [0, 2], [1, 2]]);
    expect(combinationsForHand(dice([4, 4, 4, 4, 6]), 'pair'))
      .toEqual([[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]);
  });
  it('requires exactly two distinct matching physical dice', () => {
    const board = dice([4, 4, 4, 2, 6]);
    expect(isValidSelection(board, 'pair', [0, 1])).toBe(true);
    for (const ids of [[], [0], [0, 0], [0, 3], [0, 1, 2]]) expect(isValidSelection(board, 'pair', ids)).toBe(false);
  });
  it('allows natural plus Mirror and uses actual physical pips', () => {
    const board = dice([3, 6, 4, 2, 5], [1]);
    expect(isValidSelection(board, 'pair', [0, 1])).toBe(true);
    expect(handScore(board, 'pair', [0, 1])).toEqual({ pips: 17, multiplier: 1.5, rawScore: 25.5, score: 26 });
    expect(isValidSelection(board, 'pair', [0, 2])).toBe(false);
    expect(isValidSelection(board, 'pair', [0, 1, 2])).toBe(false);
  });
  it('finds alternative four-die Two Pair subsets when one rank has an extra duplicate', () => {
    const board = dice([2, 2, 4, 4, 4]);
    expect(combinationsForHand(board, 'twoPair')).toEqual([[0, 1, 2, 3], [0, 1, 2, 4], [0, 1, 3, 4]]);
    expect(isValidSelection(board, 'twoPair', [0, 1, 3, 4])).toBe(true);
    expect(isValidSelection(board, 'twoPair', [0, 1, 2])).toBe(false);
    expect(isValidSelection(board, 'twoPair', [0, 1, 2, 3, 4])).toBe(false);
    expect(isValidSelection(board, 'twoPair', [0, 1, 2, 2])).toBe(false);
    expect(combinationsForHand(dice([4, 4, 4, 4, 6]), 'twoPair')).toEqual([]);
  });
  it('uses one Mirror for one missing pair slot and preserves its scoring pips', () => {
    const board = dice([3, 6, 5, 5, 2], [1]);
    expect(isValidSelection(board, 'twoPair', [0, 1, 2, 3])).toBe(true);
    expect(handScore(board, 'twoPair', [0, 1, 2, 3])).toEqual({ pips: 28, multiplier: 2, rawScore: 56, score: 56 });
    expect(isValidSelection(dice([3, 4, 5, 6, 2], [3]), 'twoPair', [0, 1, 2, 3])).toBe(false);
    expect(isValidSelection(dice([3, 3, 3, 6, 2], [3]), 'twoPair', [0, 1, 2, 3])).toBe(false);
  });
  it('assigns multiple Mirrors to separate slots, including two distinct all-wild pairs', () => {
    const board = dice([3, 4, 6, 6, 2], [2, 3]);
    expect(isValidSelection(board, 'twoPair', [0, 1, 2, 3])).toBe(true);
    expect(handScore(board, 'twoPair', [0, 1, 2, 3]).pips).toBe(28);
    expect(isValidSelection(dice([6, 6, 6, 6, 2], [0, 1, 2, 3]), 'twoPair', [0, 1, 2, 3])).toBe(true);
  });
  it('keeps Missing Link straight-specific', () => {
    const board = dice([3, 6, 5, 5, 2]);
    activeFace(board[1]).enhancements.missingLink = 1;
    expect(isValidSelection(board, 'pair', [0, 1])).toBe(false);
    expect(isValidSelection(board, 'twoPair', [0, 1, 2, 3])).toBe(false);
  });
  it('uses the complete centralized lower multiplier table', () => {
    expect(HANDS).toMatchObject({ pair: { baseMultiplier: 1.5 }, twoPair: { baseMultiplier: 2 },
      threeKind: { baseMultiplier: 2.5 }, smallStraight: { baseMultiplier: 2.5 },
      fullHouse: { baseMultiplier: 3.5 }, fourKind: { baseMultiplier: 4 },
      largeStraight: { baseMultiplier: 4 }, fiveKind: { baseMultiplier: 5 } });
    for (const upper of ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const) {
      expect(HANDS[upper].baseMultiplier).toBe(1);
    }
  });
});

describe('bidirectional Pair selection', () => {
  it.each([
    { hand: 'pair' as const, values: [4, 4, 4, 2, 6] as Rank[], initial: [0, 1], remove: 0, add: 2, final: [1, 2] },
    { hand: 'twoPair' as const, values: [2, 2, 4, 4, 4] as Rank[], initial: [0, 1, 2, 3], remove: 2, add: 4, final: [0, 1, 3, 4] },
  ])('$hand chooses a stable default and preserves the hand during physical substitutions', testCase => {
    const board = dice(testCase.values);
    expect(defaultCombination(board, testCase.hand)).toEqual(testCase.initial);
    let selection = selectHand(board, [], emptySelection(), testCase.hand);
    selection = toggleDie(board, [], selection, testCase.remove);
    expect(selection.hand).toBe(testCase.hand);
    expect(canPlay(board, [], selection)).toBe(false);
    selection = toggleDie(board, [], selection, testCase.add);
    expect(selection).toEqual({ hand: testCase.hand, dieIds: testCase.final });
    expect(canPlay(board, [], selection)).toBe(true);
    expect(board.map(die => die.value)).toEqual(testCase.values);
  });
  it('keeps Pair compatible with dice-first upper ambiguity and preserves the chosen physical subset', () => {
    const board = dice([2, 2, 4, 5, 6]);
    let selection = toggleDie(board, [], emptySelection(), 0);
    selection = toggleDie(board, [], selection, 1);
    expect(handOptions(board, [], selection.dieIds).map(option => option.id)).toContain('pair');
    expect(handOptions(board, [], selection.dieIds).map(option => option.id)).toContain('twos');
    selection = selectHand(board, [], selection, 'pair');
    expect(selection).toEqual({ hand: 'pair', dieIds: [0, 1] });
    expect(canPlay(board, [], selection)).toBe(true);
  });
  it('auto-selects completed Two Pair without resolving it', () => {
    const board = dice([2, 2, 4, 4, 6]);
    let selection = emptySelection();
    for (const id of [0, 1, 2, 3]) selection = toggleDie(board, [], selection, id);
    expect(selection).toEqual({ hand: 'twoPair', dieIds: [0, 1, 2, 3] });
    expect(canPlay(board, [], selection)).toBe(true);
    expect(board.map(die => die.value)).toEqual([2, 2, 4, 4, 6]);
  });
  it.each([
    { hand: 'pair' as const, values: [4, 4, 4, 2, 6] as Rank[] },
    { hand: 'twoPair' as const, values: [2, 2, 4, 4, 6] as Rank[] },
  ])('shows consumed $hand and prevents its selection/play', ({ hand, values }) => {
    const board = dice(values);
    expect(handOptions(board, [hand]).find(option => option.id === hand)?.consumed).toBe(true);
    expect(selectHand(board, [hand], emptySelection(), hand)).toEqual(emptySelection());
    expect(canPlay(board, [hand], { hand, dieIds: defaultCombination(board, hand)! })).toBe(false);
  });
});

describe('Pair resolution and loss integration', () => {
  it('scores Pair Bonus through trained Base Mult in one common accumulator', () => {
    const state = game([4, 4, 4, 2, 6]);
    enhance(state, 0, 'bonus');
    const result = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, rng());
    expect(result.state.score).toBe(39);
    expect(result.events.filter(event => event.type === 'SCORE_ADDED')).toHaveLength(1);
    expect(result.state.stats.handScores[0]).toMatchObject({ hand: 'pair', handLevel: 1, basePips: 8, pips: 26, multiplier: 1.5, score: 39 });
    expect(result.events.filter(event => event.type === 'DIE_ROLLED').map(event => event.dieIds)).toEqual([[0], [1]]);
    expect(result.state.dice[2].value).toBe(4);
  });
  it.each([
    { hand: 'pair' as const, values: [4, 4, 4, 2, 6] as Rank[], ids: [0, 1], score: 24 },
    { hand: 'twoPair' as const, values: [2, 2, 5, 5, 6] as Rank[], ids: [0, 1, 2, 3], score: 46 },
  ])('consumes $hand once and restores it for the next round', ({ hand, values, ids, score }) => {
    const state = game(values);
    state.target = score;
    const result = dispatch(state, { type: 'PLAY', hand, dieIds: ids }, { next: () => 0 });
    expect(result.state.consumed).toContain(hand);
    expect(result.events.filter(event => event.type === 'HAND_CONSUMED')).toHaveLength(1);
    expect(result.state.stats.handsPlayed[hand]).toBe(1);
    expect(result.state.stats.scoreByHand[hand]).toBe(score);
    const rolls = [0.2, 0.2, 0.6, 0.6, 0.99];
    let index = 0;
    const next = dispatch(result.state, { type: 'NEXT_ROUND' }, { next: () => rolls[index++] ?? 0.99 });
    expect(next.state.consumed).toEqual([]);
    expect(handOptions(next.state.dice, next.state.consumed).find(option => option.id === hand)?.consumed).toBe(false);
    expect(next.state.manualRerollsRemaining).toBe(3);
  });
  it.each([
    { hand: 'pair' as const, values: [4, 4, 4, 2, 6] as Rank[], ids: [0, 1], pips: 44, mult: 1.5, score: 66, rerolls: [1, 4] },
    { hand: 'twoPair' as const, values: [2, 2, 5, 5, 6] as Rank[], ids: [0, 1, 2, 3], pips: 51, mult: 2, score: 102, rerolls: [1, 2, 3, 4] },
  ])('$hand shares all participation and scoring enhancement rules', ({ hand, values, ids, pips, mult, score, rerolls }) => {
    const state = game(values);
    for (const enhancement of ['bonus', 'golden', 'workout', 'sticky'] as Enhancement[]) enhance(state, 0, enhancement);
    for (const enhancement of ['hitchhiker', 'bonus', 'golden', 'workout', 'slippy'] as Enhancement[]) enhance(state, 4, enhancement);
    activeFace(state.dice[4]).workoutPips = 2;
    const result = dispatch(state, { type: 'PLAY', hand, dieIds: ids }, { next: () => 0 });
    expect(result.state.score).toBe(score);
    expect(result.state.gold).toBe(2);
    expect(result.state.consumed).toContain(hand);
    expect(result.state.dice[0].faces[values[0] - 1].workoutPips).toBe(1);
    expect(result.state.dice[4].faces[5].workoutPips).toBe(3);
    expect(result.state.stats.handScores[0]).toMatchObject({ hand, pips, multiplier: mult, score, hitchhikerPips: 18 });
    expect(result.events.filter(event => event.type === 'DICE_REROLL_STARTED').map(event => event.dieIds)).toEqual([rerolls]);
    expect(result.state.manualRerollsRemaining).toBe(3);
  });
  it.each(['pair', 'twoPair'] as const)('%s alone prevents loss, but its consumed category does not', hand => {
    for (const available of [true, false]) {
      const state = game([2, 2, 4, 4, 1]);
      state.manualRerollsRemaining = 0;
      state.consumed = HAND_IDS.filter(id => id !== 'ones' && !(available && id === hand));
      const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [4] }, rng());
      expect(hasPlayableHand(result.state.dice, result.state.consumed)).toBe(available);
      expect(result.state.phase).toBe(available ? 'round' : 'lost');
    }
  });
  it('keeps a board with consumed pairs alive while manual rerolls remain', () => {
    const state = game([2, 2, 4, 4, 1]);
    state.consumed = HAND_IDS.filter(id => id !== 'ones');
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [4] }, rng());
    expect(result.state.phase).toBe('round');
    expect(result.events.at(-1)!.type).toBe('DEAD_BOARD');
    expect(result.state.manualRerollsRemaining).toBe(3);
  });
});
