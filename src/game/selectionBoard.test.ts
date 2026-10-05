import { describe, expect, it } from 'vitest';
import { createCursedDie } from './bosses';
import { activeFace } from './dice';
import { newRun } from './engine';
import {
  boardHandAvailable, emptySelection, legalHandCombinations, selectBoardHand, toggleBoardDie,
} from './selection';
import type { Selection } from './selection';
import type { GameState, Rank } from './types';

function game(values: Rank[]): GameState {
  const state = newRun('board-selection', { next: () => 0 }).state;
  state.target = 1_000_000;
  state.stats.rounds[0].target = state.target;
  state.dice.forEach((die, index) => { die.value = values[index]; });
  return state;
}

describe('board-based hand availability and scorecard cycling', () => {
  it('keeps every board-playable hand available while another combination is selected', () => {
    const state = game([1, 2, 3, 4, 4]);
    const straight = selectBoardHand(state, emptySelection(), 'smallStraight');
    expect(straight).toMatchObject({ hand: 'smallStraight', dieIds: [0, 1, 2, 3], intent: 'hand' });
    expect(boardHandAvailable(state, 'pair')).toBe(true);
    const pair = selectBoardHand(state, straight, 'pair');
    expect(pair).toMatchObject({ hand: 'pair', dieIds: [3, 4], intent: 'hand' });
    expect(boardHandAvailable(state, 'smallStraight')).toBe(true);
  });

  it('prefers highest projected score, then cycles every Pair combination and deselects', () => {
    const state = game([4, 4, 4, 2, 6]);
    activeFace(state.dice[1]).enhancements.bonus = 1;
    expect(legalHandCombinations(state, 'pair')).toEqual([[0, 1], [1, 2], [0, 2]]);
    let selection = selectBoardHand(state, emptySelection(), 'pair');
    expect(selection.dieIds).toEqual([0, 1]);
    selection = selectBoardHand(state, selection, 'pair');
    expect(selection.dieIds).toEqual([1, 2]);
    selection = selectBoardHand(state, selection, 'pair');
    expect(selection.dieIds).toEqual([0, 2]);
    expect(selectBoardHand(state, selection, 'pair')).toEqual(emptySelection());
  });

  it('prioritizes compatible manual dice before projected score', () => {
    const state = game([4, 4, 4, 2, 6]);
    activeFace(state.dice[1]).enhancements.bonus = 1;
    const manual = { hand: null, dieIds: [2], intent: 'manual' as const };
    expect(selectBoardHand(state, manual, 'pair').dieIds).toEqual([1, 2]);
  });

  it('cycles both natural Small Straight organizations deterministically', () => {
    const state = game([1, 2, 3, 4, 5]);
    let selection = selectBoardHand(state, emptySelection(), 'smallStraight');
    expect(selection.dieIds).toEqual([1, 2, 3, 4]);
    selection = selectBoardHand(state, selection, 'smallStraight');
    expect(selection.dieIds).toEqual([0, 1, 2, 3]);
    expect(selectBoardHand(state, selection, 'smallStraight')).toEqual(emptySelection());
  });

  it('cycles evaluator-qualified Missing Link organizations', () => {
    const state = game([1, 2, 3, 6, 6]);
    activeFace(state.dice[3]).enhancements.missingLink = 1;
    activeFace(state.dice[4]).enhancements.missingLink = 1;
    const combinations = legalHandCombinations(state, 'smallStraight');
    expect(combinations).toContainEqual([0, 1, 2, 3]);
    expect(combinations).toContainEqual([0, 1, 2, 4]);
    expect(legalHandCombinations(state, 'smallStraight')).toEqual(combinations);
  });
});

describe('manual dice -> hand selection', () => {
  it('infers one exact hand, preserves a valid current hand, and leaves ambiguity unresolved', () => {
    const state = game([2, 2, 4, 5, 6]);
    const sixes = toggleBoardDie(state, emptySelection(), 4);
    expect(sixes).toMatchObject({ dieIds: [4], hand: 'sixes', intent: 'manual' });

    let twos = selectBoardHand(state, emptySelection(), 'twos');
    twos = toggleBoardDie(state, twos, 0);
    expect(twos).toMatchObject({ dieIds: [1], hand: 'twos', intent: 'manual' });

    let ambiguous: Selection = { dieIds: [0], hand: null, intent: 'manual' };
    ambiguous = toggleBoardDie(state, ambiguous, 1);
    expect(ambiguous).toMatchObject({ dieIds: [0, 1], hand: null, intent: 'manual' });
  });

  it('keeps an invalid manual die set while clearing its hand', () => {
    const state = game([1, 2, 3, 4, 6]);
    let selection = toggleBoardDie(state, emptySelection(), 0);
    selection = toggleBoardDie(state, selection, 4);
    expect(selection).toMatchObject({ dieIds: [0, 4], hand: null, intent: 'manual' });
  });
});

describe('encounter-aware combinations', () => {
  it('requires the Hexer Cursed Die in every offered combination', () => {
    const state = game([4, 4, 1, 2, 3]);
    const cursed = createCursedDie();
    cursed.value = 4;
    state.dice.push(cursed);
    state.boss = { type: 'hexer', cursedDieId: cursed.id };
    expect(legalHandCombinations(state, 'pair').every(ids => ids.includes(cursed.id))).toBe(true);
  });

  it('excludes Warden-locked dice and preserves Neglected, Marathon, and Quickdraw restrictions', () => {
    const warden = game([4, 4, 4, 2, 6]);
    warden.boss = { type: 'warden', activeDieIds: [0, 1], startingDieId: 0, nextUnlockTarget: null,
      unlockCosts: [], unlockTargets: [], pendingReinforcements: 0 };
    expect(legalHandCombinations(warden, 'pair')).toEqual([[0, 1]]);

    const neglected = game([4, 4, 1, 2, 3]);
    neglected.boss = { type: 'neglected', neglectedHands: ['pair', 'ones'] };
    expect(boardHandAvailable(neglected, 'pair')).toBe(false);

    const marathon = game([4, 4, 1, 2, 3]);
    marathon.boss = { type: 'marathon', cooldowns: { pair: 2 } };
    expect(boardHandAvailable(marathon, 'pair')).toBe(false);

    const quickdraw = game([4, 4, 1, 2, 3]);
    quickdraw.boss = { type: 'quickdraw', lowerShotUsed: true, playedLowerHand: 'pair' };
    expect(boardHandAvailable(quickdraw, 'pair')).toBe(false);
    expect(boardHandAvailable(quickdraw, 'fours')).toBe(true);
  });
});
