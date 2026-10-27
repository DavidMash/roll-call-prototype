import { activeFace, HAND_RANKS, wholeDieEffectSuppressed } from './dice';
import type { QualificationEffect, QualificationPlan } from './resolution';
import { effectOf, effectRuntime } from './specialDice';
import type { Die, DieRoundState, HandId, HandLevels, HandOption, Rank } from './types';

export interface HandDefinition {
  name: string;
  /** Level 1 Hand Mult. Dice are the sole source of scoring Pips. */
  startingMultiplier: number;
  size?: number;
  rank?: Rank;
  groups?: readonly number[];
}

export const HANDS: Record<HandId, HandDefinition> = {
  ones: { name: 'Ones', rank: 1, startingMultiplier: 1 },
  twos: { name: 'Twos', rank: 2, startingMultiplier: 1 },
  threes: { name: 'Threes', rank: 3, startingMultiplier: 1 },
  fours: { name: 'Fours', rank: 4, startingMultiplier: 1 },
  fives: { name: 'Fives', rank: 5, startingMultiplier: 1 },
  sixes: { name: 'Sixes', rank: 6, startingMultiplier: 1 },
  sevens: { name: 'Sevens', rank: 7, startingMultiplier: 1 },
  pair: { name: 'Pair', size: 2, groups: [2], startingMultiplier: 2 },
  twoPair: { name: 'Two Pair', size: 4, groups: [2, 2], startingMultiplier: 2 },
  threeKind: { name: 'Three of a Kind', size: 3, groups: [3], startingMultiplier: 3 },
  smallStraight: { name: 'Small Straight', size: 4, startingMultiplier: 4 },
  fullHouse: { name: 'Full House', size: 5, groups: [3, 2], startingMultiplier: 5 },
  fourKind: { name: 'Four of a Kind', size: 4, groups: [4], startingMultiplier: 6 },
  largeStraight: { name: 'Large Straight', size: 5, startingMultiplier: 7 },
  fiveKind: { name: 'Five of a Kind', size: 5, groups: [5], startingMultiplier: 8 },
};
/** Normal scorecard hands. Sevens is encounter-scoped and never leaks into Shops or other Rounds. */
export const HAND_IDS = (Object.keys(HANDS) as HandId[]).filter(id => id !== 'sevens');
export const UPPER_HAND_IDS = HAND_IDS.filter(id => HANDS[id].rank) as HandId[];
export const HEXER_HAND_IDS: HandId[] = [...HAND_IDS.slice(0, UPPER_HAND_IDS.length), 'sevens', ...HAND_IDS.slice(UPPER_HAND_IDS.length)];
export const LOWER_HAND_IDS = HAND_IDS.filter(id => !HANDS[id].rank) as HandId[];
export const ULTIMATE_HAND_COUNT = 1;

export interface HandStats {
  level: number;
  handMultiplier: number;
}
export const roundToNearestHalf = (value: number) => Math.round(value * 2) / 2;
export const roundToNearestQuarter = (value: number) => Math.round(value * 4) / 4;
export const HAND_MULT_EXPONENT = 3.3;

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
  const startingMultiplier = HANDS[hand].startingMultiplier;
  return {
    level,
    handMultiplier: monotonicProgression(startingMultiplier, level, 0.25,
      currentLevel => roundToNearestQuarter(startingMultiplier * ((currentLevel + 5) / 6) ** HAND_MULT_EXPONENT)),
  };
}
/**
 * Deterministic natural-scoring benchmark used only for presentation/ranking tie-breaks.
 * It never contributes Pips to an actual score and never inspects the current dice.
 */
export function naturalHandPipsBenchmark(hand: HandId): number {
  const rule = HANDS[hand];
  if (rule.rank) return rule.rank * 5;
  switch (hand) {
    case 'pair': return 12;
    case 'twoPair': return 22;
    case 'threeKind': return 18;
    case 'smallStraight': return 18;
    case 'fullHouse': return 28;
    case 'fourKind': return 24;
    case 'largeStraight': return 20;
    case 'fiveKind': return 30;
    default: return 0;
  }
}
export const trainedHandStrength = (hand: HandId, level: number) =>
  handStats(hand, level).handMultiplier * naturalHandPipsBenchmark(hand);
export type HandStrengthTier = 'normal' | 'elevated' | 'strongest';

/**
 * Groups current authoritative Hand Mult into a few relative tiers.
 * Call once per scorecard section so Upper and Lower hands are never compared.
 */
export function relativeHandStrengthTiers(
  handLevels: HandLevels,
  hands: readonly HandId[],
): Partial<Record<HandId, HandStrengthTier>> {
  const strengths = hands.map(hand => trainedHandStrength(hand, handLevels[hand]));
  const strongest = Math.max(0, ...strengths);
  return Object.fromEntries(hands.map((hand, index) => {
    const relativeStrength = strongest > 0 ? strengths[index] / strongest : 0;
    const tier: HandStrengthTier = relativeStrength >= .9 ? 'strongest'
      : relativeStrength >= .65 ? 'elevated' : 'normal';
    return [hand, tier];
  })) as Partial<Record<HandId, HandStrengthTier>>;
}
export function rankedHands(handLevels: HandLevels, hands: readonly HandId[] = HAND_IDS): HandId[] {
  return [...hands].sort((a, b) => {
    const levelDifference = handLevels[b] - handLevels[a];
    if (levelDifference) return levelDifference;
    const strengthDifference = trainedHandStrength(b, handLevels[b]) - trainedHandStrength(a, handLevels[a]);
    if (strengthDifference) return strengthDifference;
    const aRank = HANDS[a].rank;
    const bRank = HANDS[b].rank;
    if (aRank && bRank && aRank !== bRank) return bRank - aRank;
    return hands.indexOf(a) - hands.indexOf(b);
  });
}
export const ultimateHands = (handLevels: HandLevels): HandId[] =>
  rankedHands(handLevels).slice(0, ULTIMATE_HAND_COUNT);
export function rankedBenchWarmerHands(handLevels: HandLevels): HandId[] {
  return [...HAND_IDS].sort((a, b) => {
    const levelDifference = handLevels[a] - handLevels[b];
    if (levelDifference) return levelDifference;
    const strengthDifference = trainedHandStrength(a, handLevels[a]) - trainedHandStrength(b, handLevels[b]);
    if (strengthDifference) return strengthDifference;
    const aRank = HANDS[a].rank;
    const bRank = HANDS[b].rank;
    if (aRank && bRank && aRank !== bRank) return aRank - bRank;
    return HAND_IDS.indexOf(a) - HAND_IDS.indexOf(b);
  });
}
export const benchWarmerHand = (handLevels: HandLevels): HandId => rankedBenchWarmerHands(handLevels)[0];
export const initialHandLevels = (): Record<HandId, number> =>
  Object.fromEntries([...HAND_IDS, 'sevens'].map(hand => [hand, 1])) as Record<HandId, number>;
export const initialHandPlayCounts = (): Record<HandId, number> =>
  Object.fromEntries([...HAND_IDS, 'sevens'].map(hand => [hand, 0])) as Record<HandId, number>;

export const upperBaselineLevel = (levels: HandLevels): number =>
  Math.max(1, Math.round(UPPER_HAND_IDS.reduce((sum, hand) => sum + levels[hand], 0) / UPPER_HAND_IDS.length));

export const encounterHandIds = (state: { boss?: { type: string } | null; bossSilenced?: boolean }): HandId[] =>
  !state.bossSilenced && state.boss?.type === 'hexer' ? HEXER_HAND_IDS : HAND_IDS;

export const handIsStructurallyImpossible = (hand: HandId, activeDieCount: number): boolean => {
  const rule = HANDS[hand];
  return activeDieCount < (rule.rank !== undefined ? 1 : rule.size ?? 1);
};

function subsets<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...tail] = items;
  return [...subsets(tail, size - 1).map(rest => [head, ...rest]), ...subsets(tail, size)];
}

type QualificationClaim = { dieId: number; effect: Exclude<QualificationEffect, 'hexerWild'>; effectInstanceId: string };
const claimed = (claims: readonly QualificationClaim[], dieId: number, effect: QualificationEffect) =>
  claims.some(claim => claim.dieId === dieId && claim.effect === effect);

function straightValid(dice: Die[], size: number, claims: readonly QualificationClaim[] = []): boolean {
  const natural = dice.filter(die => !claimed(claims, die.id, 'missingLink'))
    .map(die => activeFace(die).rank);
  if (new Set(natural).size !== natural.length) return false;
  return dice.length === size && HAND_RANKS.slice(0, HAND_RANKS.length - size + 1)
    .some(start => natural.every(rank => rank >= start && rank < start + size));
}
function matchingVirtualValues(dice: Die[], groups: readonly number[], claims: readonly QualificationClaim[] = []): Map<number, Rank> | null {
  const total = dice.reduce((sum, die) => sum + (claimed(claims, die.id, 'conjoined') ? 2 : 1), 0);
  if (total !== groups.reduce((sum, size) => sum + size, 0)) return null;
  const fixed = dice.filter(die => !claimed(claims, die.id, 'mirror'));
  const variables = dice.filter(die => claimed(claims, die.id, 'mirror'));
  const assignments = new Map<number, Rank>();
  function assignVariables(index: number, ranks: Rank[], counts: number[]): boolean {
    if (index === variables.length) return counts.every((count, i) => count === groups[i]);
    const die = variables[index];
    const copies = claimed(claims, die.id, 'conjoined') ? 2 : 1;
    for (let group = 0; group < ranks.length; group++) if (counts[group] + copies <= groups[group]) {
      counts[group] += copies; assignments.set(die.id, ranks[group]);
      if (assignVariables(index + 1, ranks, counts)) return true;
      counts[group] -= copies; assignments.delete(die.id);
    }
    return false;
  }
  function assignGroups(group: number, ranks: Rank[]): boolean {
    if (group === groups.length) {
      const counts = ranks.map(rank => fixed.reduce((sum, die) => sum
        + (activeFace(die).rank === rank ? (claimed(claims, die.id, 'conjoined') ? 2 : 1) : 0), 0));
      if (fixed.some(die => !ranks.includes(activeFace(die).rank)) || counts.some((count, i) => count > groups[i])) return false;
      return assignVariables(0, ranks, counts);
    }
    return HAND_RANKS.some(rank => !ranks.includes(rank) && assignGroups(group + 1, [...ranks, rank]));
  }
  return assignGroups(0, []) ? assignments : null;
}
const matchingGroupsValid = (dice: Die[], groups: readonly number[], claims: readonly QualificationClaim[] = []) =>
  matchingVirtualValues(dice, groups, claims) !== null;

export function combinationsForHand(dice: Die[], hand: HandId, roundState?: DieRoundState): number[][] {
  const rule = HANDS[hand];
  if (rule.rank) {
    const matching = dice.filter(die => activeFace(die).rank === rule.rank).map(die => die.id);
    // Largest first preserves the all-matching hand-first default.
    return Array.from({ length: matching.length }, (_, index) => subsets(matching, matching.length - index)).flat();
  }
  const candidateSets = (hand === 'smallStraight' || hand === 'largeStraight')
    ? subsets(dice, rule.size!)
    : Array.from({ length: Math.min(rule.size!, dice.length) }, (_, index) => subsets(dice, index + 1)).flat();
  return candidateSets.filter(set => planQualification(set, hand, set.map(die => die.id), { roundState }).legal)
    .map(set => set.map(die => die.id));
}

export const sameDice = (a: number[], b: number[]) => a.length === b.length && a.every(id => b.includes(id));
export function handOptions(dice: Die[], consumed: HandId[], selected: number[] = [], roundState?: DieRoundState,
  handIds: readonly HandId[] = HAND_IDS): HandOption[] {
  return handIds.map(id => ({ id, consumed: consumed.includes(id),
    combinations: combinationsForHand(dice, id, roundState).filter(set => selected.every(die => set.includes(die))),
  })).filter(option => option.combinations.length > 0);
}
export const hasPlayableHand = (dice: Die[], consumed: HandId[], requiredDieIds: number[] = [], roundState?: DieRoundState) =>
  handOptions(dice, consumed, requiredDieIds, roundState).some(option => !option.consumed);
export function defaultCombination(dice: Die[], hand: HandId, selected: number[] = [], roundState?: DieRoundState): number[] | null {
  const combinations = combinationsForHand(dice, hand, roundState);
  // A dice-first upper selection is already complete; do not expand it.
  if (HANDS[hand].rank && selected.length) return combinations.find(set => sameDice(set, selected)) ?? null;
  return combinations.find(set => selected.every(id => set.includes(id))) ?? null;
}
export function isValidSelection(dice: Die[], hand: HandId, selected: number[], roundState?: DieRoundState): boolean {
  return new Set(selected).size === selected.length && combinationsForHand(dice, hand, roundState).some(set => sameDice(set, selected));
}

/**
 * Purely plans qualification. Hexer face rules do not spend resources, so their participation
 * is recorded without mutating state. Whole-die claims are consumed only after commit.
 */
export interface QualificationPlanningOptions {
  roundState?: DieRoundState;
  claims?: readonly (Omit<QualificationClaim, 'effectInstanceId'> & { effectInstanceId?: string })[];
}

function claimKey(claim: QualificationClaim): string { return `${claim.dieId}:${claim.effect}:${claim.effectInstanceId}`; }
function claimSets(claims: QualificationClaim[]): QualificationClaim[][] {
  return claims.reduce<QualificationClaim[][]>((sets, claim) => [...sets, ...sets.map(set => [...set, claim])], [[]]);
}

export function planQualification(dice: Die[], hand: HandId, selected: readonly number[],
  options: QualificationPlanningOptions = {}): QualificationPlan {
  const requestedDieIds = [...selected];
  const selectedDice = requestedDieIds.map(id => dice.find(die => die.id === id)).filter((die): die is Die => !!die);
  const validShape = new Set(requestedDieIds).size === requestedDieIds.length && selectedDice.length === requestedDieIds.length;
  const rule = HANDS[hand];
  const candidates: QualificationClaim[] = selectedDice.flatMap<QualificationClaim>(die => {
    if (die.owner !== 'player' || wholeDieEffectSuppressed(die)) return [];
    const available = (effect: ReturnType<typeof effectOf>) => !!effect
      && (!options.roundState || (effectRuntime(options.roundState[die.id], effect)?.invocationsRemaining ?? 0) > 0);
    const claims: QualificationClaim[] = [];
    const missing = effectOf(die, 'missingLink');
    const mirror = effectOf(die, 'mirror');
    const conjoined = effectOf(die, 'conjoined');
    if ((hand === 'smallStraight' || hand === 'largeStraight') && available(missing))
      claims.push({ dieId: die.id, effect: 'missingLink', effectInstanceId: missing!.id });
    if (rule.groups && available(mirror)) claims.push({ dieId: die.id, effect: 'mirror', effectInstanceId: mirror!.id });
    if ((rule.groups || rule.rank) && available(conjoined))
      claims.push({ dieId: die.id, effect: 'conjoined', effectInstanceId: conjoined!.id });
    return claims;
  });
  const validWith = (claims: QualificationClaim[]) => {
    if (!validShape) return false;
    if (rule.rank) return selectedDice.length > 0 && selectedDice.every(die => activeFace(die).rank === rule.rank);
    if (hand === 'smallStraight' || hand === 'largeStraight') return straightValid(selectedDice, rule.size!, claims);
    return !!rule.groups && matchingGroupsValid(selectedDice, rule.groups, claims);
  };
  const validSets = claimSets(candidates).filter(validWith);
  const minimumClaims = validSets.length ? Math.min(...validSets.map(set => set.length)) : Number.POSITIVE_INFINITY;
  let claimOptions = validSets.filter(set => set.length === minimumClaims)
    .map(set => set.map(claim => ({ ...claim, resource: 'invocation' as const, amount: 1 })));
  // Upper Hands already qualify naturally. Claim one available Conjoined effect anyway so
  // the same committed resource can create its second genuine Score occurrence. Multiple
  // eligible Conjoined dice remain an explicit player choice rather than spending all Uses.
  if (rule.rank && validWith([])) {
    const conjoined = candidates.filter(claim => claim.effect === 'conjoined');
    if (conjoined.length) claimOptions = conjoined.map(claim => [{ ...claim, resource: 'invocation' as const, amount: 1 }]);
  }
  const requestedClaims = options.claims?.map(claim => ({ ...claim,
    effectInstanceId: claim.effectInstanceId ?? candidates.find(candidate => candidate.dieId === claim.dieId && candidate.effect === claim.effect)?.effectInstanceId ?? '',
    resource: 'invocation' as const, amount: 1 })) ?? [];
  const requestedKey = requestedClaims.map(claimKey).sort().join('|');
  const chosen = requestedClaims.length
    ? claimOptions.find(option => option.map(claimKey).sort().join('|') === requestedKey)
    : claimOptions.length === 1 ? claimOptions[0] : undefined;
  const legal = claimOptions.length > 0 && (!requestedClaims.length || !!chosen);
  const virtualValues = legal && rule.groups ? matchingVirtualValues(selectedDice, rule.groups, chosen ?? []) : null;
  const effects = legal ? selectedDice.flatMap(die => {
    const face = activeFace(die);
    const participating: QualificationEffect[] = [];
    return participating.map(effect => ({ dieId: die.id, face: face.rank, effect }));
  }).concat((chosen ?? []).map(claim => ({ dieId: claim.dieId,
    face: activeFace(selectedDice.find(die => die.id === claim.dieId)!).rank, effect: claim.effect,
    effectInstanceId: claim.effectInstanceId,
    ...(claim.effect === 'mirror' && virtualValues?.has(claim.dieId) ? { virtualValue: virtualValues.get(claim.dieId) } : {}),
    ...(claim.effect === 'conjoined' ? { virtualDuplicateCount: 1,
      ...(virtualValues?.has(claim.dieId) ? { virtualValue: virtualValues.get(claim.dieId) } : {}) } : {}),
  }))) : [];
  return {
    hand,
    requestedDieIds,
    qualifyingDieIds: legal ? [...requestedDieIds] : [],
    legal,
    effects,
    resourceClaims: chosen ?? [],
    claimOptions,
    ambiguousClaims: claimOptions.length > 1 && !requestedClaims.length,
  };
}
export const handMultiplier = (hand: HandId, level = 1) => handStats(hand, level).handMultiplier;
