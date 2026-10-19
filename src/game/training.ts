import { HAND_IDS, LOWER_HAND_IDS, UPPER_HAND_IDS } from './hands';
import type {
  FrozenTrainingSession, HandId, HandLevels, LowerHandId, UpperHandId,
} from './types';

export type TrainingFamily = 'upper' | 'lower';

const familySnapshot = <T extends HandId>(levels: HandLevels, hands: readonly T[]): Record<T, number> =>
  Object.fromEntries(hands.map(hand => [hand, levels[hand]])) as Record<T, number>;

/** JavaScript's integer Math.round is deterministic for the positive integer levels used by Training. */
export function roundedTrainingBaseline(levels: Readonly<Record<string, number>>): number {
  const values = Object.values(levels);
  if (!values.length) throw new Error('A Training family must contain at least one hand.');
  return Math.round(values.reduce((sum, level) => sum + level, 0) / values.length);
}

export function createTrainingSession(levels: HandLevels, freeTrainingAvailable = false): FrozenTrainingSession {
  const upperLevelsAtEntry = familySnapshot(levels, UPPER_HAND_IDS as readonly UpperHandId[]);
  const lowerLevelsAtEntry = familySnapshot(levels, LOWER_HAND_IDS as readonly LowerHandId[]);
  return {
    upperLevelsAtEntry,
    lowerLevelsAtEntry,
    upperBaseline: roundedTrainingBaseline(upperLevelsAtEntry),
    lowerBaseline: roundedTrainingBaseline(lowerLevelsAtEntry),
    purchasesByHand: Object.fromEntries(HAND_IDS.map(hand => [hand, 0])) as Record<HandId, number>,
    freeTrainingAvailable,
  };
}

export function trainingFamily(hand: HandId): TrainingFamily {
  return UPPER_HAND_IDS.includes(hand) ? 'upper' : 'lower';
}

export function trainingBaseline(session: FrozenTrainingSession, hand: HandId): number {
  return trainingFamily(hand) === 'upper' ? session.upperBaseline : session.lowerBaseline;
}

export interface TrainingQuote {
  hand: HandId;
  family: TrainingFamily;
  currentLevel: number;
  frozenBaseline: number;
  relativeTier: number;
  /** null means the theoretical price exceeds the safe integer Gold domain. */
  normalPrice: number | null;
  actualPrice: number | null;
  waivedByOnTheHouse: boolean;
  purchaseCount: number;
}

export function quoteTraining(session: FrozenTrainingSession, levels: HandLevels, hand: HandId): TrainingQuote {
  const currentLevel = levels[hand];
  const frozenBaseline = trainingBaseline(session, hand);
  const relativeTier = Math.max(0, currentLevel - frozenBaseline);
  // 2 * 2^51 is safe; the next tier is greater than Number.MAX_SAFE_INTEGER.
  const normalPrice = relativeTier > 51 ? null : 2 * 2 ** relativeTier;
  const waivedByOnTheHouse = session.freeTrainingAvailable;
  return {
    hand,
    family: trainingFamily(hand),
    currentLevel,
    frozenBaseline,
    relativeTier,
    normalPrice,
    actualPrice: waivedByOnTheHouse ? 0 : normalPrice,
    waivedByOnTheHouse,
    purchaseCount: session.purchasesByHand[hand] ?? 0,
  };
}
