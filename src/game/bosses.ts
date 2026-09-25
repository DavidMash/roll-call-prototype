import { CONFIG } from './config';
import { hashSeed, SeededRng } from './rng';
import { handStats, HANDS, HAND_IDS, LOWER_HAND_IDS } from './hands';
import type { Board, BossRuntimeState, BossType, Die, HandId, HandLevels, Rank } from './types';

export interface BossDefinition {
  name: string;
  shortRule: string;
  primary: string;
  secondary: string;
}

export const BOSSES: Record<BossType, BossDefinition> = {
  caller: {
    name: 'THE CALLER',
    shortRule: 'Answer the called hand within three plays.',
    primary: '#A855F7',
    secondary: '#D946EF',
  },
  warden: {
    name: 'THE WARDEN',
    shortRule: 'All five dice roll locked; choose one now, then earn each next unlock.',
    primary: '#06B6D4',
    secondary: '#14B8A6',
  },
  hexer: {
    name: 'THE HEXER',
    shortRule: 'A seven-sided Cursed Die joins the battle and must be used in every hand.',
    primary: '#84CC16',
    secondary: '#D9F99D',
  },
  marathon: {
    name: 'THE MARATHON',
    shortRule: '3× TARGET · Hands recharge after 7 manual plays.',
    primary: '#F97316',
    secondary: '#FDBA74',
  },
  quickdraw: {
    name: 'QUICKDRAW',
    shortRule: '⅓ TARGET · Only one Lower hand may be used.',
    primary: '#EAB308',
    secondary: '#FDE047',
  },
  fly: {
    name: 'THE FLY',
    shortRule: 'Hands score ×0.5 until you catch the moving Fly.',
    primary: '#92400E',
    secondary: '#D97706',
  },
  snakeEyes: {
    name: 'SNAKE EYES',
    shortRule: 'Scoring gradually turns your physical faces into 1s.',
    primary: '#16A34A',
    secondary: '#4ADE80',
  },
  infected: {
    name: 'THE INFECTED',
    shortRule: 'Infected faces spread, lose their enhancements, and contribute 3 fewer Pips (minimum 0).',
    primary: '#DC2626',
    secondary: '#FB7185',
  },
};

export const BOSS_TYPES: BossType[] = ['caller', 'warden', 'hexer', 'marathon', 'quickdraw', 'fly', 'snakeEyes', 'infected'];
export const CALLER_HAND_POOL: HandId[] = [
  'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
  'pair', 'twoPair', 'threeKind', 'smallStraight', 'fullHouse',
];
export const CURSED_DIE_ID = CONFIG.diceCount;

export const isBossRound = (round: number) => round > 0 && round % 3 === 0;

function shuffledBag(seed: string, bagIndex: number): BossType[] {
  const bag = [...BOSS_TYPES];
  const rng = new SeededRng(hashSeed(`${seed}:boss-bag:${bagIndex}`));
  for (let index = bag.length - 1; index > 0; index--) {
    const swap = Math.floor(rng.next() * (index + 1));
    [bag[index], bag[swap]] = [bag[swap], bag[index]];
  }
  if (bagIndex > 0) {
    const previousLast = shuffledBag(seed, bagIndex - 1).at(-1)!;
    if (bag[0] === previousLast) {
      const swap = bag.findIndex((boss, index) => index > 0 && boss !== previousLast);
      [bag[0], bag[swap]] = [bag[swap], bag[0]];
    }
  }
  return bag;
}

export function bossTypeForRound(seed: string, round: number): BossType | null {
  if (!isBossRound(round)) return null;
  const encounterIndex = round / 3 - 1;
  return shuffledBag(seed, Math.floor(encounterIndex / BOSS_TYPES.length))[encounterIndex % BOSS_TYPES.length];
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

export function wardenUnlockTarget(currentScore: number, handLevels: HandLevels, consumed: HandId[], activeDice: number): number {
  const rawTarget = currentScore + wardenBaselineCapacity(handLevels, consumed, activeDice) * 0.5;
  return Math.max(currentScore, Math.round(rawTarget / CONFIG.targetRounding) * CONFIG.targetRounding);
}

export function createBossRuntime(seed: string, round: number, type: BossType): BossRuntimeState {
  switch (type) {
    case 'caller': return {
      type,
      calledHand: callerHandForRound(seed, round),
      playsRemaining: 3,
      satisfied: false,
      satisfyingSource: null,
      callsCompleted: 0,
      callsMissed: 0,
    };
    case 'warden': return {
      type,
      activeDieIds: [],
      startingDieId: null,
      nextUnlockTarget: null,
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
      face(1, { golden: 1, jumpingBean: 1, weighted: 1 }, 6),
      face(2, { bonus: 1, jumpingBean: 1, weighted: 1 }, 5),
      face(3, { workout: 1, jumpingBean: 1, weighted: 1 }, 4),
      face(4, { workout: 5, bump: 1 }),
      face(5, { workout: 10, bump: 1 }),
      face(6, { workout: 20, bump: 1 }),
      face(7, { bonus: 5, jackpot: 1, sticky: 1 }),
    ],
  };
}

export function activeEncounterDice(state: { dice: Die[]; boss: BossRuntimeState | null }): Die[] {
  if (state.boss?.type !== 'warden') return state.dice;
  const active = new Set(state.boss.activeDieIds);
  return state.dice.filter(die => active.has(die.id));
}

export function requiredEncounterDieIds(state: { boss: BossRuntimeState | null }): number[] {
  return state.boss?.type === 'hexer' ? [state.boss.cursedDieId] : [];
}

export function unavailableEncounterHands(state: Pick<Board, 'boss' | 'consumed'>): HandId[] {
  const unavailable = new Set(state.consumed);
  if (state.boss?.type === 'marathon') {
    for (const hand of HAND_IDS) if ((state.boss.cooldowns[hand] ?? 0) > 0) unavailable.add(hand);
  }
  if (state.boss?.type === 'quickdraw' && state.boss.lowerShotUsed) {
    for (const hand of LOWER_HAND_IDS) unavailable.add(hand);
  }
  return [...unavailable];
}

export function bossHandAvailable(state: Pick<Board, 'boss' | 'consumed'>, hand: HandId): boolean {
  return !unavailableEncounterHands(state).includes(hand);
}

export function cleanupTemporaryBossFaces(dice: Die[]): void {
  for (const die of dice.filter(item => item.owner === 'player')) die.faces.forEach((face, index) => {
    if (face.snakeEyed) face.rank = (index + 1) as Rank;
    delete face.snakeEyed;
    delete face.infected;
  });
}

export const isCursedDie = (die: Die | undefined): boolean => die?.owner === 'boss';
