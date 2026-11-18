import { CONFIG } from './config';
import { hashSeed, SeededRng } from './rng';
import { encounterHandIds, handIsStructurallyImpossible, handOptions, HAND_IDS,
  rightHand, RIGHT_HAND_IDS, leftHand, LEFT_HAND_IDS } from './hands';
import type { BigBossType, Board, BossRuntimeState, BossType, Die, HandId, MiniBossType, Rank } from './types';

export interface BossDefinition {
  name: string;
  shortRule: string;
  primary: string;
  secondary: string;
}

export const BOSSES: Record<BossType, BossDefinition> = {
  juggler: {
    name: 'THE JUGGLER',
    shortRule: 'After an Left hand, one extra random equipped die Rolls.',
    primary: '#2ED68F',
    secondary: '#86EFAC',
  },
  capitalReturn: {
    name: 'CAPITAL RETURN',
    shortRule: 'Lose 1 Gold whenever you play a Right hand.',
    primary: '#D97706',
    secondary: '#FBBF24',
  },
  neglected: {
    name: 'THE NEGLECTED',
    shortRule: 'Two of your least played hands are unavailable until 6 hands have been played.',
    primary: '#64748B',
    secondary: '#CBD5E1',
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
    shortRule: 'One die disappears until you play 3 called Left hands, but you have twice as many normal Manual Rerolls.',
    primary: '#7C3AED',
    secondary: '#C4B5FD',
  },
  mugger: {
    name: 'THE MUGGER',
    shortRule: 'One hidden Right hand will steal 5 Gold if played.',
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
    shortRule: 'The Warden locks away all but one of your dice. Each Hand you play sets another free.',
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
    shortRule: 'Extra large Goal. Played hands return after 6 other hands are played.',
    primary: '#F97316',
    secondary: '#FDBA74',
  },
  quickdraw: {
    name: 'QUICKDRAW',
    shortRule: 'The first Right hand scores normally. Later Right hands score ×0.25.',
    primary: '#EAB308',
    secondary: '#FDE047',
  },
  fly: {
    name: 'THE FLY',
    shortRule: 'Your played hands are weakened until you catch The Fly on the marked Right hand, but you have twice as many normal Manual Rerolls.',
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
    shortRule: "Infected faces suppress the die's special effects. Played faces become infected.",
    primary: '#DC2626',
    secondary: '#FB7185',
  },
  pendulum: {
    name: 'THE PENDULUM',
    shortRule: 'Alternate between the requested Left and Right sections. A wrong-section Play scores ×0.5.',
    primary: '#38BDF8',
    secondary: '#F0ABFC',
  },
};

export const BOSS_TYPES: BigBossType[] = ['magician', 'juggler', 'caller', 'warden', 'hexer', 'marathon', 'fly', 'snakeEyes', 'infected'];
export const MINI_BOSS_TYPES: MiniBossType[] = [
  'capitalReturn', 'neglected', 'tightrope', 'crawler', 'quickdraw', 'pendulum',
];
export const ALL_BOSS_TYPES: BossType[] = [...MINI_BOSS_TYPES, ...BOSS_TYPES];
export const CALLER_HAND_POOL: HandId[] = [
  'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
  'pair', 'twoPair', 'threeKind', 'smallStraight', 'fullHouse',
];
/** Encounter-managed IDs use a negative namespace and can never collide with collectible IDs. */
export const CURSED_DIE_ID = -1;

export const isMiniBossRound = (round: number) => round > 0 && round % 6 === 3;
export const isBigBossRound = (round: number) => round > 0 && round % 6 === 0;
export const isBossRound = (round: number) => isMiniBossRound(round) || isBigBossRound(round);
export const isMiniBossType = (type: BossType): type is MiniBossType => MINI_BOSS_TYPES.includes(type as MiniBossType);
export const isBigBossType = (type: BossType): type is BigBossType => BOSS_TYPES.includes(type as BigBossType);

const miniBossesUnlockedIn = (chapter: number): readonly MiniBossType[] => chapter < 2
  ? ['capitalReturn', 'crawler', 'quickdraw', 'pendulum']
  : MINI_BOSS_TYPES;
const bossesUnlockedIn = (chapter: number): readonly BigBossType[] => chapter < 2
  ? ['magician', 'hexer', 'snakeEyes']
  : chapter < 3
    ? ['magician', 'hexer', 'snakeEyes', 'juggler', 'warden', 'caller', 'fly', 'infected']
    : BOSS_TYPES;

function encounterForChapter<T extends BossType>(seed: string, tier: 'mini' | 'big', throughChapter: number,
  unlocked: (chapter: number) => readonly T[]): T {
  const seen = new Set<T>();
  let previous: T | null = null;
  for (let chapter = 1; chapter <= throughChapter; chapter++) {
    const eligible = [...unlocked(chapter)];
    if (eligible.every(type => seen.has(type))) seen.clear();
    let candidates = eligible.filter(type => !seen.has(type));
    if (candidates.length > 1 && previous) candidates = candidates.filter(type => type !== previous);
    const rng = new SeededRng(hashSeed(`${seed}:${tier}-boss-pick:${chapter}`));
    previous = candidates[Math.floor(rng.next() * candidates.length)];
    seen.add(previous);
  }
  return previous!;
}

export function bossTypeForRound(seed: string, round: number): BossType | null {
  if (!isBossRound(round)) return null;
  const chapter = Math.ceil(round / 6);
  return isMiniBossRound(round)
    ? encounterForChapter(seed, 'mini', chapter, miniBossesUnlockedIn)
    : encounterForChapter(seed, 'big', chapter, bossesUnlockedIn);
}

export function bossSchedule(seed: string, throughRound = 60): Partial<Record<number, BossType>> {
  const schedule: Partial<Record<number, BossType>> = {};
  for (let round = 3; round <= throughRound; round += 3) schedule[round] = bossTypeForRound(seed, round)!;
  return schedule;
}

export const handIsPhysicallyAttainable = (hand: HandId, dieCount: number): boolean => {
  return !handIsStructurallyImpossible(hand, dieCount);
};

export function callerHandForRound(seed: string, round: number, dieCount: number = CONFIG.diceCount,
  availableHands: readonly HandId[] = CALLER_HAND_POOL): HandId {
  const rng = new SeededRng(hashSeed(`${seed}:boss:${round}:caller-hand`));
  const available = new Set(availableHands);
  const eligible = CALLER_HAND_POOL.filter(hand => available.has(hand) && handIsPhysicallyAttainable(hand, dieCount));
  if (!eligible.length) throw new Error('The Caller requires at least one available authored Hand.');
  return eligible[Math.floor(rng.next() * eligible.length)];
}

export function flyHandForRound(seed: string, round: number, dieCount: number = CONFIG.diceCount): HandId | null {
  const rng = new SeededRng(hashSeed(`${seed}:boss:${round}:fly-hand`));
  const eligible = RIGHT_HAND_IDS.filter(hand => handIsPhysicallyAttainable(hand, dieCount));
  return eligible.length ? eligible[Math.floor(rng.next() * eligible.length)] : null;
}

export function bossGoalModifier(type: BossType): number {
  return type === 'marathon' ? 3
    : type === 'quickdraw' ? 1 / 3
      : type === 'tightrope' ? 0.5
        : 1;
}

export interface BossRuntimeContext {
  handPlayCounts?: Record<HandId, number>;
  playerDieIds?: number[];
  eligibleHands?: HandId[];
}

function encounterRng(seed: string, round: number, type: BossType): SeededRng {
  return new SeededRng(hashSeed(`${seed}:mini-boss:${round}:${type}`));
}

export function createBossRuntime(seed: string, round: number, type: BossType, context: BossRuntimeContext = {}): BossRuntimeState {
  switch (type) {
    case 'juggler': return { type };
    case 'capitalReturn': return { type };
    case 'neglected': {
      const eligible = context.eligibleHands ?? HAND_IDS;
      const counts = context.handPlayCounts ?? Object.fromEntries(eligible.map(hand => [hand, 0])) as Record<HandId, number>;
      const order = new Map<HandId, number>(eligible.map((hand, index) => [hand, index]));
      const restrictionCount = Math.min(2, Math.max(0, eligible.length - 1));
      return {
        type,
        neglectedHands: [...eligible].sort((a, b) => counts[a] - counts[b] || order.get(a)! - order.get(b)!).slice(0, restrictionCount),
        handsPlayed: 0,
        restored: false,
      };
    }
    case 'tightrope': return { type };
    case 'crawler': return { type };
    case 'pendulum': {
      const rng = encounterRng(seed, round, type);
      return { type, requestedSection: rng.next() < .5 ? 'left' : 'right', switches: 0 };
    }
    case 'magician': {
      const rng = encounterRng(seed, round, type);
      const dieIds = context.playerDieIds?.length ? [...context.playerDieIds]
        : Array.from({ length: CONFIG.diceCount }, (_, index) => index);
      const missingDieId = dieIds.length > 1 ? dieIds.splice(Math.floor(rng.next() * dieIds.length), 1)[0] : null;
      const left = (context.eligibleHands ?? LEFT_HAND_IDS).filter(leftHand);
      const calledHands = Array.from({ length: 3 }, () => left.splice(Math.floor(rng.next() * left.length), 1)[0]);
      return { type, missingDieId, calledHands, completedHands: [], returned: missingDieId === null };
    }
    case 'mugger': {
      const rng = encounterRng(seed, round, type);
      const right = (context.eligibleHands ?? RIGHT_HAND_IDS).filter(rightHand);
      return { type, hiddenHand: right[Math.floor(rng.next() * right.length)], revealedHand: null, spent: false };
    }
    case 'caller': return {
      type,
      calledHand: callerHandForRound(seed, round, context.playerDieIds?.length ?? CONFIG.diceCount,
        context.eligibleHands ?? CALLER_HAND_POOL),
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
      encounterDieIds: [...(context.playerDieIds ?? Array.from({ length: CONFIG.diceCount }, (_, index) => index))],
      activeDieIds: [],
      startingDieId: null,
    };
    case 'hexer': return { type, cursedDieId: CURSED_DIE_ID };
    case 'marathon': return { type, cooldowns: {} };
    case 'quickdraw': return { type, rightShotUsed: false, playedRightHand: null };
    case 'fly': {
      const rng = encounterRng(seed, round, type);
      const right = (context.eligibleHands ?? RIGHT_HAND_IDS).filter(hand => rightHand(hand)
        && handIsPhysicallyAttainable(hand, context.playerDieIds?.length ?? CONFIG.diceCount));
      return { type, flyHand: right.length ? right[Math.floor(rng.next() * right.length)] : null,
        caught: false, moves: 0, mercyActive: false };
    }
    case 'snakeEyes': return { type, mutatedFaces: [] };
    case 'infected': return { type, infectedFaces: [] };
  }
}

export function createCursedDie(): import('./types').EncounterDie {
  return {
    id: CURSED_DIE_ID,
    owner: 'boss',
    encounterId: 'hexer:cursed',
    value: 1,
    faces: [1, 2, 3, 4, 5, 6, 7].map(rank => ({ rank: rank as Rank })),
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
    for (const hand of Object.keys(state.boss.cooldowns) as HandId[])
      if ((state.boss.cooldowns[hand] ?? 0) > 0) unavailable.add(hand);
  }
  if (state.boss?.type === 'neglected' && !state.boss.restored)
    for (const hand of state.boss.neglectedHands) unavailable.add(hand);
  return [...unavailable];
}

export function bossHandAvailable(state: Pick<Board, 'boss' | 'consumed'> & { bossSilenced?: boolean }, hand: HandId): boolean {
  return !unavailableEncounterHands(state).includes(hand);
}

export type LastPlayDanger = 'none' | 'possible' | 'definite';

export function currentlyPlayableManualHands(state: Pick<Board, 'boss' | 'consumed' | 'dice' | 'dieRoundState'> & { bossSilenced?: boolean }): HandId[] {
  const dice = activeEncounterDice(state);
  const required = requiredEncounterDieIds(state);
  const unavailable = unavailableEncounterHands(state);
  return handOptions(dice, unavailable, required, state.dieRoundState, encounterHandIds(state))
    .filter(option => !option.consumed && !handIsStructurallyImpossible(option.id, dice.length))
    .map(option => option.id);
}

/** The canonical dice that may currently participate in a Play, after encounter availability rules. */
export const availablePlayableDice = activeEncounterDice;

/** The exact Hand set used by ordinary scorecard-cycle refresh eligibility. */
export function scorecardCycleRelevantHands(state: Pick<Board, 'boss' | 'bossSilenced' | 'dice'>): HandId[] {
  const encounterLocks = !state.bossSilenced && state.boss?.type === 'neglected' && !state.boss.restored
    ? state.boss.neglectedHands : [];
  const activeDice = activeEncounterDice(state);
  return encounterHandIds(state).filter(hand => !handIsStructurallyImpossible(hand, activeDice.length)
    && !encounterLocks.includes(hand));
}

export function wouldCompleteScorecardCycle(
  state: Pick<Board, 'boss' | 'bossSilenced' | 'dice' | 'scorecardCycleConsumed'>,
  hand: HandId,
  consumesHand: boolean,
): boolean {
  if (!consumesHand || state.boss?.type === 'marathon') return false;
  const cycle = new Set(state.scorecardCycleConsumed);
  cycle.add(hand);
  // The sixth Neglected Play restores its locked Hands before the post-Play refresh check.
  const neglectedWillRestore = !state.bossSilenced && state.boss?.type === 'neglected'
    && !state.boss.restored && state.boss.handsPlayed >= 5;
  const relevant = neglectedWillRestore
    ? encounterHandIds(state).filter(id => !handIsStructurallyImpossible(id, activeEncounterDice(state).length))
    : scorecardCycleRelevantHands(state);
  return relevant.length > 0 && relevant.every(id => cycle.has(id));
}

export function lastPlayDanger(
  state: Pick<Board, 'boss' | 'consumed' | 'dice' | 'dieRoundState'> & { bossSilenced?: boolean },
  hand: HandId,
  selectedDieIds: readonly number[] = [],
): LastPlayDanger {
  const dice = activeEncounterDice(state);
  const unavailable = unavailableEncounterHands(state);
  const options = handOptions(dice, unavailable, requiredEncounterDieIds(state), state.dieRoundState, encounterHandIds(state))
    .filter(option => !option.consumed && !handIsStructurallyImpossible(option.id, dice.length));
  if (!options.some(option => option.id === hand)) return 'none';
  if (options.length === 1) return 'definite';
  if (!selectedDieIds.length) return 'none';

  const rolling = new Set(selectedDieIds);
  const alternatives = options.filter(option => option.id !== hand);
  return alternatives.length > 0 && alternatives.every(option =>
    option.combinations.every(combination => combination.some(dieId => rolling.has(dieId))))
    ? 'possible' : 'none';
}

export const isLastPlay = (state: Pick<Board, 'boss' | 'consumed' | 'dice' | 'dieRoundState'> & { bossSilenced?: boolean }, hand: HandId,
  selectedDieIds: readonly number[] = []) => lastPlayDanger(state, hand, selectedDieIds) !== 'none';

export function cleanupTemporaryBossFaces(dice: Die[]): void {
  for (const die of dice.filter(item => item.owner === 'player')) die.faces.forEach((face, index) => {
    if (face.bossMutation?.kind === 'snakeEyes') face.rank = face.bossMutation.originalRank ?? (index + 1) as Rank;
    delete face.bossMutation;
  });
}

export const isCursedDie = (die: Die | undefined): boolean => die?.owner === 'boss';
