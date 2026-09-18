import { CONFIG } from './config';
import { activeFace, RANKS } from './dice';
import { stacks } from './enhancements';
import type { Die, HandId, HandOption, Rank } from './types';

export const HANDS: Record<HandId, { name: string; size?: number; rank?: Rank; groups?: readonly number[] }> = {
  ones: { name: 'Ones', rank: 1 }, twos: { name: 'Twos', rank: 2 }, threes: { name: 'Threes', rank: 3 },
  fours: { name: 'Fours', rank: 4 }, fives: { name: 'Fives', rank: 5 }, sixes: { name: 'Sixes', rank: 6 },
  pair: { name: 'Pair', size: 2, groups: [2] }, twoPair: { name: 'Two Pair', size: 4, groups: [2, 2] },
  threeKind: { name: 'Three of a Kind', size: 3, groups: [3] },
  smallStraight: { name: 'Small Straight', size: 4 },
  fullHouse: { name: 'Full House', size: 5, groups: [3, 2] },
  fourKind: { name: 'Four of a Kind', size: 4, groups: [4] },
  largeStraight: { name: 'Large Straight', size: 5 },
  fiveKind: { name: 'Five of a Kind', size: 5, groups: [5] },
};
export const HAND_IDS = Object.keys(HANDS) as HandId[];

function subsets<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...tail] = items;
  return [...subsets(tail, size - 1).map(rest => [head, ...rest]), ...subsets(tail, size)];
}

function straightValid(dice: Die[], size: number): boolean {
  const natural = dice.filter(die => !stacks(activeFace(die), 'missingLink')).map(die => die.value);
  if (new Set(natural).size !== natural.length) return false;
  return RANKS.slice(0, 7 - size).some(start => natural.every(rank => rank >= start && rank < start + size));
}
function matchingGroupsValid(dice: Die[], groups: readonly number[]): boolean {
  const natural = dice.filter(die => !stacks(activeFace(die), 'mirror')).map(die => die.value);
  // Distinct ranks own disjoint slots. Every Mirror fills exactly one remaining slot.
  function assign(group: number, ranks: Rank[]): boolean {
    if (group === groups.length) return natural.every(rank => ranks.includes(rank));
    return RANKS.some(rank => !ranks.includes(rank)
      && natural.filter(value => value === rank).length <= groups[group]
      && assign(group + 1, [...ranks, rank]));
  }
  return dice.length === groups.reduce((sum, size) => sum + size, 0) && assign(0, []);
}

export function combinationsForHand(dice: Die[], hand: HandId): number[][] {
  const rule = HANDS[hand];
  if (rule.rank) {
    const matching = dice.filter(die => die.value === rule.rank).map(die => die.id);
    // Largest first preserves the all-matching hand-first default.
    return Array.from({ length: matching.length }, (_, index) => subsets(matching, matching.length - index)).flat();
  }
  return subsets(dice, rule.size!).filter(set => {
    if (hand === 'smallStraight' || hand === 'largeStraight') return straightValid(set, rule.size!);
    return rule.groups ? matchingGroupsValid(set, rule.groups) : false;
  }).map(set => set.map(die => die.id));
}

export const sameDice = (a: number[], b: number[]) => a.length === b.length && a.every(id => b.includes(id));
export function handOptions(dice: Die[], consumed: HandId[], selected: number[] = []): HandOption[] {
  return HAND_IDS.map(id => ({ id, consumed: consumed.includes(id),
    combinations: combinationsForHand(dice, id).filter(set => selected.every(die => set.includes(die))),
  })).filter(option => option.combinations.length > 0);
}
export const hasPlayableHand = (dice: Die[], consumed: HandId[]) => handOptions(dice, consumed).some(option => !option.consumed);
export function defaultCombination(dice: Die[], hand: HandId, selected: number[] = []): number[] | null {
  const combinations = combinationsForHand(dice, hand);
  // A dice-first upper selection is already complete; do not expand it.
  if (HANDS[hand].rank && selected.length) return combinations.find(set => sameDice(set, selected)) ?? null;
  return combinations.find(set => selected.every(id => set.includes(id))) ?? null;
}
export function isValidSelection(dice: Die[], hand: HandId, selected: number[]): boolean {
  return new Set(selected).size === selected.length && combinationsForHand(dice, hand).some(set => sameDice(set, selected));
}
export const handMultiplier = (hand: HandId) => CONFIG.handMultipliers[hand];
