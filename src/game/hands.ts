import { activeFace, HAND_RANKS } from './dice';
import { stacks } from './enhancements';
import type { QualificationEffect, QualificationPlan } from './resolution';
import type { Die, HandId, HandLevels, HandOption, Rank } from './types';

export interface HandDefinition {
  name: string;
  // Level 1 multiplier. All current hand stats derive from this and hand level.
  baseMultiplier: number;
  size?: number;
  rank?: Rank;
  groups?: readonly number[];
}

export const HANDS: Record<HandId, HandDefinition> = {
  ones: { name: 'Ones', rank: 1, baseMultiplier: 1 },
  twos: { name: 'Twos', rank: 2, baseMultiplier: 1 },
  threes: { name: 'Threes', rank: 3, baseMultiplier: 1 },
  fours: { name: 'Fours', rank: 4, baseMultiplier: 1 },
  fives: { name: 'Fives', rank: 5, baseMultiplier: 1 },
  sixes: { name: 'Sixes', rank: 6, baseMultiplier: 1 },
  pair: { name: 'Pair', size: 2, groups: [2], baseMultiplier: 1.5 },
  twoPair: { name: 'Two Pair', size: 4, groups: [2, 2], baseMultiplier: 2 },
  threeKind: { name: 'Three of a Kind', size: 3, groups: [3], baseMultiplier: 2.5 },
  smallStraight: { name: 'Small Straight', size: 4, baseMultiplier: 2.5 },
  fullHouse: { name: 'Full House', size: 5, groups: [3, 2], baseMultiplier: 3.5 },
  fourKind: { name: 'Four of a Kind', size: 4, groups: [4], baseMultiplier: 4 },
  largeStraight: { name: 'Large Straight', size: 5, baseMultiplier: 4 },
  fiveKind: { name: 'Five of a Kind', size: 5, groups: [5], baseMultiplier: 5 },
};
export const HAND_IDS = Object.keys(HANDS) as HandId[];
export const UPPER_HAND_IDS = HAND_IDS.filter(id => HANDS[id].rank) as HandId[];
export const LOWER_HAND_IDS = HAND_IDS.filter(id => !HANDS[id].rank) as HandId[];
export const ULTIMATE_HAND_COUNT = 1;

export interface HandStats {
  level: number;
  basePips: number;
  baseMultiplier: number;
}
export const startingBasePips = (hand: HandId) => 5 + 2 * HANDS[hand].baseMultiplier;
export const roundToNearestHalf = (value: number) => Math.round(value * 2) / 2;
export const roundToNearestQuarter = (value: number) => Math.round(value * 4) / 4;
export const HAND_MULT_EXPONENT = 2.3;

function monotonicProgression(
  originalValue: number,
  level: number,
  minimumIncrease: number,
  roundedTarget: (level: number) => number,
): number {
  let value = originalValue;
  let previousIncrease = minimumIncrease;
  for (let currentLevel = 2; currentLevel <= level; currentLevel++) {
    const nextValue = Math.max(roundedTarget(currentLevel), value + previousIncrease);
    previousIncrease = nextValue - value;
    value = nextValue;
  }
  return value;
}

export function handStats(hand: HandId, level: number): HandStats {
  if (!Number.isInteger(level) || level < 1) throw new Error('Hand level must be a positive integer.');
  const originalBasePips = startingBasePips(hand);
  const originalBaseMultiplier = HANDS[hand].baseMultiplier;
  return {
    level,
    basePips: monotonicProgression(originalBasePips, level, 1,
      currentLevel => Math.round(originalBasePips * ((currentLevel + 2) / 3))),
    baseMultiplier: monotonicProgression(originalBaseMultiplier, level, 0.25,
      currentLevel => roundToNearestQuarter(originalBaseMultiplier * ((currentLevel + 5) / 6) ** HAND_MULT_EXPONENT)),
  };
}
export const trainedBaselineStrength = (hand: HandId, level: number) => {
  const stats = handStats(hand, level);
  return stats.basePips * stats.baseMultiplier;
};
export type HandStrengthTier = 'normal' | 'elevated' | 'strongest';

/**
 * Groups current authoritative Base Pips × Base Mult into a few relative tiers.
 * Call once per scorecard section so Upper and Lower hands are never compared.
 */
export function relativeHandStrengthTiers(
  handLevels: HandLevels,
  hands: readonly HandId[],
): Partial<Record<HandId, HandStrengthTier>> {
  const strengths = hands.map(hand => trainedBaselineStrength(hand, handLevels[hand]));
  const strongest = Math.max(0, ...strengths);
  return Object.fromEntries(hands.map((hand, index) => {
    const relativeStrength = strongest > 0 ? strengths[index] / strongest : 0;
    const tier: HandStrengthTier = relativeStrength >= .9 ? 'strongest'
      : relativeStrength >= .65 ? 'elevated' : 'normal';
    return [hand, tier];
  })) as Partial<Record<HandId, HandStrengthTier>>;
}
export function rankedHands(handLevels: HandLevels): HandId[] {
  return [...HAND_IDS].sort((a, b) => {
    const levelDifference = handLevels[b] - handLevels[a];
    if (levelDifference) return levelDifference;
    const strengthDifference = trainedBaselineStrength(b, handLevels[b]) - trainedBaselineStrength(a, handLevels[a]);
    if (strengthDifference) return strengthDifference;
    const aRank = HANDS[a].rank;
    const bRank = HANDS[b].rank;
    if (aRank && bRank && aRank !== bRank) return bRank - aRank;
    return HAND_IDS.indexOf(a) - HAND_IDS.indexOf(b);
  });
}
export const ultimateHands = (handLevels: HandLevels): HandId[] =>
  rankedHands(handLevels).slice(0, ULTIMATE_HAND_COUNT);
export const initialHandLevels = (): Record<HandId, number> =>
  Object.fromEntries(HAND_IDS.map(hand => [hand, 1])) as Record<HandId, number>;
export const initialHandPlayCounts = (): Record<HandId, number> =>
  Object.fromEntries(HAND_IDS.map(hand => [hand, 0])) as Record<HandId, number>;

function subsets<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...tail] = items;
  return [...subsets(tail, size - 1).map(rest => [head, ...rest]), ...subsets(tail, size)];
}

function straightValid(dice: Die[], size: number): boolean {
  const natural = dice.filter(die => !stacks(activeFace(die), 'missingLink')).map(die => activeFace(die).rank);
  if (new Set(natural).size !== natural.length) return false;
  return HAND_RANKS.slice(0, HAND_RANKS.length - size + 1).some(start => natural.every(rank => rank >= start && rank < start + size));
}
function matchingGroupsValid(dice: Die[], groups: readonly number[]): boolean {
  const qualificationFaces = dice.flatMap(die => {
    const face = activeFace(die);
    return Array.from({ length: stacks(face, 'conjoined') ? 2 : 1 }, () => face);
  });
  const natural = qualificationFaces.filter(face => !stacks(face, 'mirror')).map(face => face.rank);
  const mirrorCount = qualificationFaces.length - natural.length;
  // Distinct ranks own disjoint slots. Mirror qualification copies fill remaining slots.
  function assign(group: number, ranks: Rank[]): boolean {
    if (group === groups.length) {
      const naturalSlots = ranks.reduce((total, rank, index) => total + Math.min(groups[index], natural.filter(value => value === rank).length), 0);
      return natural.every(rank => ranks.includes(rank)) && naturalSlots + mirrorCount === groups.reduce((sum, size) => sum + size, 0);
    }
    return HAND_RANKS.some(rank => !ranks.includes(rank)
      && natural.filter(value => value === rank).length <= groups[group]
      && assign(group + 1, [...ranks, rank]));
  }
  return qualificationFaces.length === groups.reduce((sum, size) => sum + size, 0) && assign(0, []);
}

export function combinationsForHand(dice: Die[], hand: HandId): number[][] {
  const rule = HANDS[hand];
  if (rule.rank) {
    const matching = dice.filter(die => activeFace(die).rank === rule.rank).map(die => die.id);
    // Largest first preserves the all-matching hand-first default.
    return Array.from({ length: matching.length }, (_, index) => subsets(matching, matching.length - index)).flat();
  }
  const candidateSets = (hand === 'smallStraight' || hand === 'largeStraight')
    ? subsets(dice, rule.size!)
    : Array.from({ length: Math.min(rule.size!, dice.length) }, (_, index) => subsets(dice, index + 1)).flat();
  return candidateSets.filter(set => {
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
export const hasPlayableHand = (dice: Die[], consumed: HandId[], requiredDieIds: number[] = []) =>
  handOptions(dice, consumed, requiredDieIds).some(option => !option.consumed);
export function defaultCombination(dice: Die[], hand: HandId, selected: number[] = []): number[] | null {
  const combinations = combinationsForHand(dice, hand);
  // A dice-first upper selection is already complete; do not expand it.
  if (HANDS[hand].rank && selected.length) return combinations.find(set => sameDice(set, selected)) ?? null;
  return combinations.find(set => selected.every(id => set.includes(id))) ?? null;
}
export function isValidSelection(dice: Die[], hand: HandId, selected: number[]): boolean {
  return new Set(selected).size === selected.length && combinationsForHand(dice, hand).some(set => sameDice(set, selected));
}

/**
 * Purely plans qualification. Legacy wildcards are unlimited, so Stage 1 records their
 * participation but deliberately produces no resource claims to commit.
 */
export function planQualification(dice: Die[], hand: HandId, selected: readonly number[]): QualificationPlan {
  const requestedDieIds = [...selected];
  const legal = isValidSelection(dice, hand, requestedDieIds);
  const selectedDice = requestedDieIds.map(id => dice.find(die => die.id === id)).filter((die): die is Die => !!die);
  const effects = legal ? selectedDice.flatMap(die => {
    const face = activeFace(die);
    const participating: QualificationEffect[] = [];
    if ((hand === 'smallStraight' || hand === 'largeStraight') && stacks(face, 'missingLink')) participating.push('missingLink');
    if (HANDS[hand].groups && stacks(face, 'mirror')) participating.push('mirror');
    if (HANDS[hand].groups && stacks(face, 'conjoined')) participating.push('conjoined');
    return participating.map(effect => ({ dieId: die.id, face: face.rank, effect }));
  }) : [];
  return {
    hand,
    requestedDieIds,
    qualifyingDieIds: legal ? [...requestedDieIds] : [],
    legal,
    effects,
    resourceClaims: [],
  };
}
export const handMultiplier = (hand: HandId, level = 1) => handStats(hand, level).baseMultiplier;
