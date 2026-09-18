import { describe, expect, it } from 'vitest';
import { CONFIG, targetForRound } from './config';
import { createDice } from './dice';
import { combinationsForHand, defaultCombination, handOptions, HAND_IDS, isValidSelection } from './hands';
import { handScore } from './scoring';
import { canPlay, emptySelection, selectHand, toggleDie } from './selection';
import type { Die, Enhancement, HandId, Rank } from './types';

function board(values: Rank[], wilds: [number, Enhancement][] = []): Die[] {
  const dice = createDice();
  dice.forEach((die, index) => { die.value = values[index]; });
  wilds.forEach(([id, enhancement]) => { dice[id].faces[dice[id].value - 1].enhancements[enhancement] = 1; });
  return dice;
}

describe('hand detection', () => {
  it.each<[HandId, Rank]>([['ones', 1], ['twos', 2], ['threes', 3], ['fours', 4], ['fives', 5], ['sixes', 6]])('%s detects and scores its printed rank', (hand, rank) => {
    const dice = board([rank, rank, rank, rank, rank]);
    expect(combinationsForHand(dice, hand)).toHaveLength(31);
    expect(defaultCombination(dice, hand)).toEqual([0, 1, 2, 3, 4]);
    expect(handScore(dice, hand, [0, 1, 2, 3, 4]).score).toBe(10 + rank * 5);
  });
  it('upper hands allow every non-empty matching physical subset', () => {
    const dice = board([2, 2, 2, 5, 6]);
    expect(combinationsForHand(dice, 'twos')).toEqual([[0, 1, 2], [0, 1], [0, 2], [1, 2], [0], [1], [2]]);
    expect(isValidSelection(dice, 'twos', [1])).toBe(true);
    expect(isValidSelection(dice, 'twos', [0, 2])).toBe(true);
    expect(isValidSelection(dice, 'twos', [0, 1, 2])).toBe(true);
    expect(isValidSelection(dice, 'twos', [])).toBe(false);
    expect(combinationsForHand(dice, 'ones')).toEqual([]);
    expect(handScore(dice, 'twos', [0, 1, 2]).score).toBe(16);
  });
  it('rejects mixed upper selections, duplicate physical IDs and nonmatching wild faces', () => {
    const dice = board([4, 4, 2, 3, 5], [[2, 'mirror'], [2, 'missingLink']]);
    expect(isValidSelection(dice, 'fours', [0, 2])).toBe(false);
    expect(isValidSelection(dice, 'fours', [0, 0])).toBe(false);
    expect(defaultCombination(dice, 'fours', [0, 2])).toBeNull();
    expect(handOptions(dice, [], [0, 2]).some(option => option.id === 'fours')).toBe(false);
  });
  it.each<[HandId, Rank[], number]>([
    ['pair', [4, 4, 2, 5, 6], 27], ['twoPair', [2, 2, 5, 5, 6], 48],
    ['threeKind', [2, 2, 2, 5, 6], 40], ['fullHouse', [2, 2, 2, 5, 5], 91],
    ['fourKind', [3, 3, 3, 3, 6], 88], ['fiveKind', [6, 6, 6, 6, 6], 200],
    ['smallStraight', [1, 2, 3, 4, 6], 50], ['largeStraight', [2, 3, 4, 5, 6], 120],
  ])('%s scores only its required participants', (hand, values, score) => {
    const dice = board(values);
    const ids = defaultCombination(dice, hand)!;
    expect(ids).not.toBeNull();
    expect(handScore(dice, hand, ids).score).toBe(score);
  });
  it.each<[HandId, Rank[]]>([
    ['threeKind', [1, 1, 2, 2, 3]], ['fullHouse', [2, 2, 2, 2, 2]],
    ['fourKind', [1, 1, 1, 2, 3]], ['fiveKind', [1, 1, 1, 1, 2]],
    ['smallStraight', [1, 2, 2, 4, 6]], ['largeStraight', [1, 2, 3, 4, 6]],
  ])('rejects impossible %s', (hand, values) => expect(combinationsForHand(board(values), hand)).toEqual([]));
  it('has fourteen categories and no Chance', () => {
    expect(HAND_IDS).toHaveLength(14);
    expect(HAND_IDS).not.toContain('chance');
  });
  it('uses the centralized progression formula', () => {
    expect(Array.from({ length: 6 }, (_, i) => targetForRound(i + 1))).toEqual([50, 70, 90, 125, 165, 225]);
    expect(CONFIG.enhancementCosts).toHaveProperty('weighted', 3);
  });
});

describe('physical subset choices and selection constraints', () => {
  it('upper hand-first selection defaults to all matches and stays playable after deselections', () => {
    const dice = board([4, 4, 4, 2, 6]);
    let selection = selectHand(dice, [], emptySelection(), 'fours');
    expect(selection).toEqual({ hand: 'fours', dieIds: [0, 1, 2] });
    expect(dice.map(die => die.value)).toEqual([4, 4, 4, 2, 6]);
    selection = toggleDie(dice, [], selection, 0);
    expect(selection).toEqual({ hand: 'fours', dieIds: [1, 2] });
    expect(canPlay(dice, [], selection)).toBe(true);
    selection = toggleDie(dice, [], selection, 1);
    expect(selection).toEqual({ hand: 'fours', dieIds: [2] });
    expect(canPlay(dice, [], selection)).toBe(true);
    selection = toggleDie(dice, [], selection, 2);
    expect(selection.dieIds).toEqual([]);
    expect(canPlay(dice, [], selection)).toBe(false);
  });
  it('dice-first upper subsets stay compatible and retain their inferred hand', () => {
    const dice = board([4, 4, 4, 2, 6]);
    let selection = emptySelection();
    for (const id of [0, 1, 2]) {
      selection = toggleDie(dice, [], selection, id);
      expect(selection.hand).toBe('fours');
      expect(handOptions(dice, [], selection.dieIds).some(option => option.id === 'fours')).toBe(true);
      expect(canPlay(dice, [], selection)).toBe(true);
    }
  });
  it('clicking the selected playable hand again clears the hand and every selected die', () => {
    const dice = board([4, 4, 4, 4, 1]);
    const selected = selectHand(dice, [], emptySelection(), 'threeKind');
    expect(selected).toEqual({ hand: 'threeKind', dieIds: [0, 1, 2] });
    expect(selectHand(dice, [], selected, 'threeKind')).toEqual(emptySelection());
  });
  it('consumed upper hands remain visible for matching subsets but cannot be played', () => {
    const dice = board([4, 4, 4, 2, 6]);
    for (const dieIds of [[], [1], [1, 2], [0, 1, 2]]) {
      const option = handOptions(dice, ['fours'], dieIds).find(item => item.id === 'fours');
      expect(option?.consumed).toBe(true);
      expect(canPlay(dice, ['fours'], { hand: 'fours', dieIds })).toBe(false);
    }
  });
  it('permits all three-of-four subsets with a deterministic default', () => {
    const dice = board([4, 4, 4, 4, 1]);
    expect(combinationsForHand(dice, 'threeKind')).toEqual([[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]);
    expect(defaultCombination(dice, 'threeKind')).toEqual([0, 1, 2]);
    expect(isValidSelection(dice, 'threeKind', [3, 1, 2])).toBe(true);
    expect(isValidSelection(dice, 'threeKind', [0, 0, 1])).toBe(false);
  });
  it('permits selecting four of five matching dice', () => {
    expect(combinationsForHand(board([5, 5, 5, 5, 5]), 'fourKind')).toHaveLength(5);
  });
  it('offers alternative straight runs and duplicate-rank subsets', () => {
    expect(combinationsForHand(board([1, 2, 3, 4, 5]), 'smallStraight')).toEqual([[0, 1, 2, 3], [1, 2, 3, 4]]);
    expect(combinationsForHand(board([1, 2, 3, 4, 4]), 'smallStraight')).toEqual([[0, 1, 2, 3], [0, 1, 2, 4]]);
  });
  it('partial selections constrain options without requiring a complete hand', () => {
    const dice = board([4, 4, 4, 4, 1]);
    expect(handOptions(dice, [], [3]).find(option => option.id === 'threeKind')!.combinations).toHaveLength(3);
    expect(handOptions(dice, [], [0, 4]).find(option => option.id === 'threeKind')).toBeUndefined();
    expect(handOptions(dice, ['fours']).find(option => option.id === 'fours')!.consumed).toBe(true);
  });
  it('hand selection completes dice, then dice selection can change the physical subset', () => {
    const dice = board([4, 4, 4, 4, 1]);
    let selection = selectHand(dice, [], emptySelection(), 'threeKind');
    expect(selection.dieIds).toEqual([0, 1, 2]);
    selection = toggleDie(dice, [], selection, 0);
    expect(canPlay(dice, [], selection)).toBe(false);
    selection = toggleDie(dice, [], selection, 3);
    expect(selection).toEqual({ dieIds: [1, 2, 3], hand: 'threeKind' });
    expect(canPlay(dice, [], selection)).toBe(true);
  });
  it('auto-selects the only completed hand and never auto-plays', () => {
    const dice = board([1, 2, 3, 4, 6]);
    const selection = toggleDie(dice, [], emptySelection(), 4);
    expect(selection.hand).toBe('sixes');
    expect(dice[4].value).toBe(6);
  });
});

describe('Missing Link', () => {
  it('fills one gap, retaining real scoring pips', () => {
    const dice = board([1, 2, 3, 6, 6], [[3, 'missingLink']]);
    expect(isValidSelection(dice, 'smallStraight', [0, 1, 2, 3])).toBe(true);
    expect(handScore(dice, 'smallStraight', [0, 1, 2, 3]).score).toBe(55);
  });
  it('fills multiple distinct gaps and permits a natural wild rank', () => {
    const dice = board([1, 2, 6, 6, 5], [[2, 'missingLink'], [3, 'missingLink']]);
    expect(isValidSelection(dice, 'largeStraight', [0, 1, 2, 3, 4])).toBe(true);
    expect(combinationsForHand(board([1, 2, 3, 4, 5], [[3, 'missingLink']]), 'largeStraight')).toHaveLength(1);
  });
  it('cannot reuse a wild or remove duplicated nonwild ranks', () => {
    expect(combinationsForHand(board([1, 1, 2, 6, 6], [[3, 'missingLink']]), 'smallStraight')).toEqual([]);
    expect(combinationsForHand(board([1, 2, 3, 6, 6], [[3, 'missingLink']]), 'largeStraight')).toEqual([]);
  });
  it('does not grant matching-rank or upper-hand wildness', () => {
    const dice = board([1, 1, 6, 4, 5], [[2, 'missingLink']]);
    expect(combinationsForHand(dice, 'threeKind')).toEqual([]);
    expect(combinationsForHand(dice, 'ones')).toEqual([[0, 1], [0], [1]]);
  });
});

describe('Mirror', () => {
  it.each<[HandId, Rank[], number[], number]>([
    ['threeKind', [2, 2, 6, 4, 5], [2], 50],
    ['fourKind', [2, 2, 6, 6, 5], [2, 3], 104],
    ['fiveKind', [2, 2, 6, 6, 6], [2, 3, 4], 160],
    ['fullHouse', [2, 2, 6, 5, 5], [2], 105],
  ])('qualifies %s and scores actual pips', (hand, values, wildIds, score) => {
    const dice = board(values, wildIds.map(id => [id, 'mirror']));
    const ids = defaultCombination(dice, hand)!;
    expect(ids).not.toBeNull();
    expect(handScore(dice, hand, ids).score).toBe(score);
  });
  it('full house requires two distinct ranks and respects the 3/2 capacities', () => {
    expect(combinationsForHand(board([2, 2, 2, 2, 6], [[4, 'mirror']]), 'fullHouse')).toEqual([]);
    expect(combinationsForHand(board([2, 2, 2, 6, 6], [[3, 'mirror'], [4, 'mirror']]), 'fullHouse')).toHaveLength(1);
    expect(combinationsForHand(board([1, 2, 3, 6, 6], [[3, 'mirror'], [4, 'mirror']]), 'fullHouse')).toEqual([]);
  });
  it('all-Mirror dice can be assigned to any kind or a distinct-rank full house', () => {
    const dice = board([6, 6, 6, 6, 6], [0, 1, 2, 3, 4].map(id => [id, 'mirror']));
    expect(combinationsForHand(dice, 'fiveKind')).toHaveLength(1);
    expect(combinationsForHand(dice, 'fullHouse')).toHaveLength(1);
  });
  it('does not grant straight or upper-hand wildness', () => {
    const dice = board([1, 2, 3, 6, 6], [[3, 'mirror']]);
    expect(combinationsForHand(dice, 'smallStraight')).toEqual([]);
    expect(combinationsForHand(dice, 'sixes')).toEqual([[3, 4], [3], [4]]);
  });
});
