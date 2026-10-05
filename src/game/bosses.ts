import { CONFIG } from './config';
import { hashSeed, SeededRng } from './rng';
import { handOptions, handStats, HANDS, HAND_IDS, LOWER_HAND_IDS, UPPER_HAND_IDS } from './hands';
import type { BigBossType, Board, BossRuntimeState, BossType, Die, HandId, HandLevels, MiniBossType, Rank } from './types';

export interface BossDefinition {
  name: string;
  shortRule: string;
  primary: string;
  secondary: string;
}

export const BOSSES: Record<BossType, BossDefinition> = {
  juggler: {
    name: 'THE JUGGLER',
    shortRule: 'After every hand, one random extra die rerolls.',
    primary: '#2ED68F',
    secondary: '#86EFAC',
  },
  capitalReturn: {
    name: 'CAPITAL RETURN',
    shortRule: 'Lose 1 Gold whenever you play a Lower hand.',
    primary: '#D97706',
    secondary: '#FBBF24',
  },
  neglected: {
    name: 'THE NEGLECTED',
    shortRule: 'Your 2 least-played hands are unavailable.',
    primary: '#64748B',
    secondary: '#CBD5E1',
  },
  clockmaker: {
    name: 'THE CLOCKMAKER',
    shortRule: 'Every roll gets Bumped up one face.',
    primary: '#0EA5E9',
    secondary: '#7DD3FC',
  },
  tightrope: {
    name: 'THE TIGHTROPE',
    shortRule: 'Start with 0 Rerolls. Goal is halved.',
    primary: '#EAB308',
    secondary: '#FEF08A',
  },
  crawler: {
    name: 'THE CRAWLER',
    shortRule: 'After every hand, only one scoring die rerolls.',
    primary: '#65A30D',
    secondary: '#BEF264',
  },
  magician: {
    name: 'THE MAGICIAN',
    shortRule: 'One die disappears until you play 3 called Upper hands.',
    primary: '#7C3AED',
    secondary: '#C4B5FD',
  },
  mugger: {
    name: 'THE MUGGER',
    shortRule: 'One hidden Lower hand will steal 5 Gold if played.',
    primary: '#BE123C',
    secondary: '#FDA4AF',
  },
  caller: {
    name: 'THE CALLER',
    shortRule: 'Play the called hand before it comes due or lose half your total score.',
    primary: '#A855F7',
    secondary: '#D946EF',
  },
  warden: {
    name: 'THE WARDEN',
    shortRule: 'Choose one die to start. Score enough to unlock the rest.',
    primary: '#06B6D4',
    secondary: '#14B8A6',
  },
  hexer: {
    name: 'THE HEXER',
    shortRule: 'A Cursed Die joins you and must be used in every hand.',
    primary: '#84CC16',
    secondary: '#D9F99D',
  },
  marathon: {
    name: 'THE MARATHON',
    shortRule: 'Extra large Goal. Played hands return after 7 other hands are played.',
    primary: '#F97316',
    secondary: '#FDBA74',
  },
  quickdraw: {
    name: 'QUICKDRAW',
    shortRule: 'Reduced Goal, but you can only play a single Lower hand.',
    primary: '#EAB308',
    secondary: '#FDE047',
  },
  fly: {
    name: 'THE FLY',
    shortRule: 'Your played hands are weakened until you catch The Fly on the marked Lower hand.',
    primary: '#92400E',
    secondary: '#D97706',
  },
  snakeEyes: {
    name: 'SNAKE EYES',
    shortRule: 'Scored faces turn into 1s.',
    primary: '#16A34A',
    secondary: '#4ADE80',
  },
  infected: {
    name: 'THE INFECTED',
    shortRule: 'Infected faces lose 3 Pips and their Enhancements. Played faces become infected.',
    primary: '#DC2626',
    secondary: '#FB7185',
  },
};

export const BOSS_TYPES: BigBossType[] = ['caller', 'warden', 'hexer', 'marathon', 'quickdraw', 'fly', 'snakeEyes', 'infected'];
export const MINI_BOSS_TYPES: MiniBossType[] = [
  'juggler', 'capitalReturn', 'neglected', 'clockmaker', 'tightrope', 'crawler', 'magician', 'mugger',
];
export const ALL_BOSS_TYPES: BossType[] = [...MINI_BOSS_TYPES, ...BOSS_TYPES];
export const CALLER_HAND_POOL: HandId[] = [
  'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
  'pair', 'twoPair', 'threeKind', 'smallStraight', 'fullHouse',
];
export const CURSED_DIE_ID = CONFIG.diceCount;

export const isMiniBossRound = (round: number) => round > 0 && round % 6 === 3;
export const isBigBossRound = (round: number) => round > 0 && round % 6 === 0;
export const isBossRound = (round: number) => isMiniBossRound(round) || isBigBossRound(round);
export const isMiniBossType = (type: BossType): type is MiniBossType => MINI_BOSS_TYPES.includes(type as MiniBossType);
export const isBigBossType = (type: BossType): type is BigBossType => BOSS_TYPES.includes(type as BigBossType);

function shuffledBag<T extends BossType>(seed: string, tier: 'mini' | 'big', types: readonly T[], bagIndex: number): T[] {
  const bag = [...types];
  const rng = new SeededRng(hashSeed(`${seed}:${tier}-boss-bag:${bagIndex}`));
  for (let index = bag.length - 1; index > 0; index--) {
    const swap = Math.floor(rng.next() * (index + 1));
    [bag[index], bag[swap]] = [bag[swap], bag[index]];
  }
  if (bagIndex > 0) {
    const previousLast = shuffledBag(seed, tier, types, bagIndex - 1).at(-1)!;
    if (bag[0] === previousLast) {
      const swap = bag.findIndex((boss, index) => index > 0 && boss !== previousLast);
      [bag[0], bag[swap]] = [bag[swap], bag[0]];
    }
  }
  return bag;
}

export function bossTypeForRound(seed: string, round: number): BossType | null {
  if (!isBossRound(round)) return null;
  if (isMiniBossRound(round)) {
    const encounterIndex = (round - 3) / 6;
    return shuffledBag(seed, 'mini', MINI_BOSS_TYPES, Math.floor(encounterIndex / MINI_BOSS_TYPES.length))[encounterIndex % MINI_BOSS_TYPES.length];
  }
  const encounterIndex = (round - 6) / 6;
  return shuffledBag(seed, 'big', BOSS_TYPES, Math.floor(encounterIndex / BOSS_TYPES.length))[encounterIndex % BOSS_TYPES.length];
}

export function bossSchedule(seed: string, throughRound = 60): Partial<Record<number, BossType>> {
  const schedule: Partial<Record<number, BossType>> = {};
  for (let round = 3; round <= throughRound; round += 3) schedule[round] = bossTypeForRound(seed, round)!;
  return schedule;
}

export function callerHandForRound(seed: string, round: number): HandId {
  const rng = new SeededRng(hashSeed(`${seed}:boss:${round}:caller-hand`));
  return CALLER_HAND_POOL[Math.floor(rng.next() * CALLER_HAND_POOL.length)];
}

export function flyHandForRound(seed: string, round: number): HandId {
  const rng = new SeededRng(hashSeed(`${seed}:boss:${round}:fly-hand`));
  return LOWER_HAND_IDS[Math.floor(rng.next() * LOWER_HAND_IDS.length)];
}

export function targetForBoss(type: BossType, normalTarget: number): number {
  if (type === 'marathon') return normalTarget * 3;
  if (type === 'quickdraw') return Math.max(CONFIG.targetRounding,
    Math.round(normalTarget / 3 / CONFIG.targetRounding) * CONFIG.targetRounding);
  if (type === 'tightrope') return normalTarget * .5;
  return normalTarget;
}

export function wardenNaturalHands(activeDice: number): HandId[] {
  return HAND_IDS.filter(hand => HANDS[hand].rank !== undefined || HANDS[hand].size! <= activeDice);
}

export function wardenIdealNaturalPips(hand: HandId, activeDice: number): number {
  const definition = HANDS[hand];
  if (definition.rank !== undefined) return definition.rank * activeDice;
  if (hand === 'smallStraight' || hand === 'largeStraight') {
    return Array.from({ length: definition.size! }, (_, index) => 6 - index)
      .reduce((sum, rank) => sum + rank, 0);
  }
  return [...definition.groups!].sort((a, b) => b - a)
    .reduce((sum, group, index) => sum + group * (6 - index), 0);
}

export function wardenBaselineCapacity(handLevels: HandLevels, consumed: HandId[], activeDice: number): number {
  const used = new Set(consumed);
  return wardenNaturalHands(activeDice).filter(hand => !used.has(hand)).reduce((capacity, hand) => {
    const stats = handStats(hand, handLevels[hand]);
    return capacity + Math.round((stats.basePips + wardenIdealNaturalPips(hand, activeDice)) * stats.baseMultiplier);
  }, 0);
}

const roundWardenCost = (score: number) =>
  Math.max(0, Math.round(score / CONFIG.targetRounding) * CONFIG.targetRounding);

export function wardenBaselineHandScore(handLevels: HandLevels, hand: HandId, activeDice: number): number {
  const stats = handStats(hand, handLevels[hand]);
  return Math.round((stats.basePips + wardenIdealNaturalPips(hand, activeDice)) * stats.baseMultiplier);
}

export function wardenUnlockCost(
  handLevels: HandLevels,
  consumed: HandId[],
  activeDice: number,
  previousUnlockCost = 0,
): number {
  const normalCost = roundWardenCost(wardenBaselineCapacity(handLevels, consumed, activeDice) * 0.5);
  if (activeDice === 1) {
    const weakestUpperCap = [...UPPER_HAND_IDS]
      .map(hand => wardenBaselineHandScore(handLevels, hand, 1))
      .sort((a, b) => a - b)
      .slice(0, 2)
      .reduce((sum, score) => sum + score, 0);
    const pairCap = wardenBaselineHandScore(handLevels, 'pair', 2) * 0.5;
    return roundWardenCost(Math.min(normalCost, weakestUpperCap, pairCap));
  }
  if (activeDice === 2) {
    const pairMaximum = roundWardenCost(wardenBaselineHandScore(handLevels, 'pair', 2));
    return Math.min(pairMaximum, Math.max(normalCost, previousUnlockCost * 2));
  }
  return normalCost;
}

export function wardenUnlockCosts(handLevels: HandLevels, consumed: HandId[], goal: number): number[] {
  const costs: number[] = [];
  for (let activeDice = 1; activeDice < CONFIG.diceCount; activeDice++) {
    costs.push(wardenUnlockCost(handLevels, consumed, activeDice, costs[0] ?? 0));
  }
  const cumulativeCost = costs.reduce((sum, cost) => sum + cost, 0);
  const halfwayGoal = roundWardenCost(goal * 0.5);
  if (cumulativeCost <= halfwayGoal) return costs;

  const scale = halfwayGoal / cumulativeCost;
  const scaled = costs.map(cost => roundWardenCost(cost * scale));
  scaled[0] = Math.max(CONFIG.targetRounding, scaled[0]);
  scaled[1] = Math.max(scaled[0] * 2, scaled[1]);
  scaled[2] = Math.max(scaled[1], scaled[2]);
  scaled[3] = halfwayGoal - scaled[0] - scaled[1] - scaled[2];
  return scaled;
}

export function wardenUnlockTarget(currentScore: number, handLevels: HandLevels, consumed: HandId[], activeDice: number): number {
  const cost = wardenUnlockCost(handLevels, consumed, activeDice);
  return Math.max(currentScore, Math.round((currentScore + cost) / CONFIG.targetRounding) * CONFIG.targetRounding);
}

export interface BossRuntimeContext {
  handPlayCounts?: Record<HandId, number>;
  playerDieIds?: number[];
}

function miniBossRng(seed: string, round: number, type: MiniBossType): SeededRng {
  return new SeededRng(hashSeed(`${seed}:mini-boss:${round}:${type}`));
}

export function createBossRuntime(seed: string, round: number, type: BossType, context: BossRuntimeContext = {}): BossRuntimeState {
  switch (type) {
    case 'juggler': return { type };
    case 'capitalReturn': return { type };
    case 'neglected': {
      const counts = context.handPlayCounts ?? Object.fromEntries(HAND_IDS.map(hand => [hand, 0])) as Record<HandId, number>;
      const order = new Map(HAND_IDS.map((hand, index) => [hand, index]));
      return { type, neglectedHands: [...HAND_IDS].sort((a, b) => counts[a] - counts[b] || order.get(a)! - order.get(b)!).slice(0, 2) };
    }
    case 'clockmaker': return { type };
    case 'tightrope': return { type };
    case 'crawler': return { type };
    case 'magician': {
      const rng = miniBossRng(seed, round, type);
      const dieIds = context.playerDieIds?.length ? [...context.playerDieIds].sort((a, b) => a - b)
        : Array.from({ length: CONFIG.diceCount }, (_, index) => index);
      const missingDieId = dieIds.splice(Math.floor(rng.next() * dieIds.length), 1)[0];
      const upper = [...UPPER_HAND_IDS];
      const calledHands = Array.from({ length: 3 }, () => upper.splice(Math.floor(rng.next() * upper.length), 1)[0]);
      return { type, missingDieId, hiddenFlame: null, calledHands, completedHands: [], returned: false };
    }
    case 'mugger': {
      const rng = miniBossRng(seed, round, type);
      return { type, hiddenHand: LOWER_HAND_IDS[Math.floor(rng.next() * LOWER_HAND_IDS.length)], revealedHand: null, spent: false };
    }
    case 'caller': return {
      type,
      calledHand: callerHandForRound(seed, round),
      playsRemaining: 3,
      satisfied: false,
      satisfyingSource: null,
      callsCompleted: 0,
      callsMissed: 0,
      manualHandsPlayed: 0,
      callDeadline: 3,
    };
    case 'warden': return {
      type,
      activeDieIds: [],
      startingDieId: null,
      nextUnlockTarget: null,
      unlockCosts: [],
      unlockTargets: [],
      pendingReinforcements: 1,
    };
    case 'hexer': return { type, cursedDieId: CURSED_DIE_ID };
    case 'marathon': return { type, cooldowns: {} };
    case 'quickdraw': return { type, lowerShotUsed: false, playedLowerHand: null };
    case 'fly': return { type, flyHand: flyHandForRound(seed, round), caught: false, moves: 0 };
    case 'snakeEyes': return { type, mutatedFaces: [] };
    case 'infected': return { type, infectedFaces: [] };
  }
}

const face = (rank: Rank, enhancements: Die['faces'][number]['enhancements'], weightedTarget?: Rank) =>
  ({ rank, workoutPips: 0, enhancements, ...(weightedTarget ? { weightedTarget } : {}) });

export function createCursedDie(): Die {
  return {
    id: CURSED_DIE_ID,
    owner: 'boss',
    value: 1,
    flame: null,
    faces: [
      face(1, { golden: 1, weighted: 1 }, 6),
      face(2, { golden: 1, weighted: 1 }, 5),
      face(3, { golden: 1, weighted: 1 }, 4),
      face(4, { missingLink: 1, mirror: 1 }),
      face(5, { workout: 5, mirror: 1 }),
      face(6, { workout: 10, bump: 1 }),
      face(7, { bonus: 5, mirror: 1 }),
    ],
  };
}

export function activeEncounterDice(state: { dice: Die[]; boss: BossRuntimeState | null; bossSilenced?: boolean }): Die[] {
  if (state.bossSilenced || !state.boss) return state.dice;
  if (state.boss.type === 'warden') {
    const active = new Set(state.boss.activeDieIds);
    return state.dice.filter(die => active.has(die.id));
  }
  if (state.boss.type === 'magician' && !state.boss.returned) {
    const missingDieId = state.boss.missingDieId;
    return state.dice.filter(die => die.id !== missingDieId);
  }
  return state.dice;
}

export function requiredEncounterDieIds(state: { boss: BossRuntimeState | null; bossSilenced?: boolean }): number[] {
  return !state.bossSilenced && state.boss?.type === 'hexer' ? [state.boss.cursedDieId] : [];
}

export function unavailableEncounterHands(state: Pick<Board, 'boss' | 'consumed'> & { bossSilenced?: boolean }): HandId[] {
  const unavailable = new Set(state.consumed);
  if (state.bossSilenced) return [...unavailable];
  if (state.boss?.type === 'marathon') {
    for (const hand of HAND_IDS) if ((state.boss.cooldowns[hand] ?? 0) > 0) unavailable.add(hand);
  }
  if (state.boss?.type === 'quickdraw' && state.boss.lowerShotUsed) {
    for (const hand of LOWER_HAND_IDS) unavailable.add(hand);
  }
  if (state.boss?.type === 'neglected') for (const hand of state.boss.neglectedHands) unavailable.add(hand);
  return [...unavailable];
}

export function bossHandAvailable(state: Pick<Board, 'boss' | 'consumed'> & { bossSilenced?: boolean }, hand: HandId): boolean {
  return !unavailableEncounterHands(state).includes(hand);
}

export type LastPlayDanger = 'none' | 'possible' | 'definite';

export function lastPlayDanger(state: Pick<Board, 'boss' | 'consumed' | 'dice' | 'manualRerollsRemaining'> & { bossSilenced?: boolean }, hand: HandId): LastPlayDanger {
  if (state.manualRerollsRemaining !== 0) return 'none';
  const required = requiredEncounterDieIds(state);
  const playable = handOptions(activeEncounterDice(state), unavailableEncounterHands(state), required)
    .filter(option => !option.consumed);
  if (playable.length !== 1 || playable[0].id !== hand) return 'none';

  const unavailableAfter = new Set(unavailableEncounterHands(state));
  if (state.boss?.type === 'marathon') {
    for (const id of HAND_IDS) {
      const remaining = state.boss.cooldowns[id] ?? 0;
      if (remaining <= 1) unavailableAfter.delete(id);
    }
    unavailableAfter.add(hand);
  } else {
    unavailableAfter.add(hand);
    if (state.boss?.type === 'quickdraw' && LOWER_HAND_IDS.includes(hand)) {
      for (const id of LOWER_HAND_IDS) unavailableAfter.add(id);
    }
  }
  return HAND_IDS.every(id => unavailableAfter.has(id)) ? 'definite' : 'possible';
}

export const isLastPlay = (state: Pick<Board, 'boss' | 'consumed' | 'dice' | 'manualRerollsRemaining'> & { bossSilenced?: boolean }, hand: HandId) =>
  lastPlayDanger(state, hand) !== 'none';

export function cleanupTemporaryBossFaces(dice: Die[]): void {
  for (const die of dice.filter(item => item.owner === 'player')) die.faces.forEach((face, index) => {
    if (face.snakeEyed) face.rank = face.snakeEyesOriginalRank ?? (index + 1) as Rank;
    delete face.snakeEyed;
    delete face.snakeEyesOriginalRank;
    delete face.infected;
    delete face.magneticSourceUsed;
  });
}

export const isCursedDie = (die: Die | undefined): boolean => die?.owner === 'boss';
