import { describe, expect, it } from 'vitest';
import { createDice } from './dice';
import { combinationsForHand, defaultCombination, HAND_IDS, isValidSelection, planQualification } from './hands';
import { createDieEffect, resetDieRoundState } from './specialDice';
import type { CollectibleDie, HandId, Rank } from './types';

function board(values: Rank[]): CollectibleDie[] {
  const dice = createDice();
  dice.forEach((die, index) => { die.value = values[index]; });
  return dice;
}

describe('hand detection', () => {
  it.each<[HandId, Rank[]]>([
    ['pair', [4, 4, 2, 5, 6]], ['twoPair', [2, 2, 5, 5, 6]],
    ['threeKind', [2, 2, 2, 5, 6]], ['fullHouse', [2, 2, 2, 5, 5]],
    ['fourKind', [3, 3, 3, 3, 6]], ['fiveKind', [6, 6, 6, 6, 6]],
    ['smallStraight', [1, 2, 3, 4, 6]], ['largeStraight', [2, 3, 4, 5, 6]],
  ])('finds a natural %s', (hand, values) => expect(defaultCombination(board(values), hand)).not.toBeNull());

  it('supports all fourteen categories and physical upper subsets', () => {
    const dice = board([2, 2, 2, 5, 6]);
    expect(HAND_IDS).toHaveLength(14);
    expect(combinationsForHand(dice, 'twos')).toEqual([[0, 1, 2], [0, 1], [0, 2], [1, 2], [0], [1], [2]]);
    expect(isValidSelection(dice, 'twos', [0, 2])).toBe(true);
    expect(isValidSelection(dice, 'twos', [0, 0])).toBe(false);
  });

  it('qualifies only through whole-die effects and never mutates a preview', () => {
    const dice = board([2, 3, 4, 5, 6]);
    dice[0].effects = [createDieEffect(dice[0].id, 'mirror')];
    const runtime = resetDieRoundState(dice);
    const before = structuredClone({ dice, runtime });
    const plan = planQualification(dice, 'pair', [0, 1], { roundState: runtime });
    expect(plan).toMatchObject({ legal: true, resourceClaims: [{ dieId: 0, effect: 'mirror', amount: 1 }] });
    expect({ dice, runtime }).toEqual(before);
  });
});
