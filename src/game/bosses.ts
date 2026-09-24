import { CONFIG, targetForRound } from './config';
import { hashSeed, SeededRng } from './rng';
import type { BossRuntimeState, BossType, Die, HandId, Rank } from './types';

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
    shortRule: 'Begin with D1; checkpoints release the rest in order.',
    primary: '#06B6D4',
    secondary: '#14B8A6',
  },
  hexer: {
    name: 'THE HEXER',
    shortRule: 'A seven-sided Cursed Die joins the battle and must be used in every hand.',
    primary: '#84CC16',
    secondary: '#D9F99D',
  },
};

export const BOSS_TYPES: BossType[] = ['caller', 'warden', 'hexer'];
export const CALLER_HAND_POOL: HandId[] = [
  'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
  'pair', 'twoPair', 'threeKind', 'smallStraight', 'fullHouse',
];
export const WARDEN_CHECKPOINT_FRACTIONS = [0.1, 0.25, 0.45, 0.7] as const;
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

export function wardenCheckpoints(target: number): number[] {
  return WARDEN_CHECKPOINT_FRACTIONS.map(fraction =>
    Math.max(CONFIG.targetRounding, Math.round(target * fraction / CONFIG.targetRounding) * CONFIG.targetRounding));
}

export function createBossRuntime(seed: string, round: number, type: BossType): BossRuntimeState {
  switch (type) {
    case 'caller': return {
      type,
      calledHand: callerHandForRound(seed, round),
      playsRemaining: 3,
      satisfied: false,
      satisfyingSource: null,
    };
    case 'warden': return {
      type,
      checkpoints: wardenCheckpoints(targetForRound(round)),
      activeDieIds: [],
      startingDieId: null,
      reachedCheckpoints: 0,
      pendingReinforcements: 0,
    };
    case 'hexer': return { type, cursedDieId: CURSED_DIE_ID };
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
      face(4, { missingLink: 1, mirror: 1, bump: 1 }),
      face(5, { workout: 5, mirror: 1, bump: 1 }),
      face(6, { workout: 10, mirror: 1, bump: 1 }),
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

export const isCursedDie = (die: Die | undefined): boolean => die?.owner === 'boss';
