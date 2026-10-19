import type { RollReason } from './runHistoryV2';
import type { Enhancement, Face, HandId, HandPlaySource, Rank } from './types';

export type PlayCause = 'player' | 'free_play_effect' | 'jumping_bean';

/** A committed request to resolve one hand. This is deliberately distinct from its Score occurrences. */
export interface PlayIntent {
  id: string;
  hand: HandId;
  source: HandPlaySource;
  cause: PlayCause;
  /** Dice committed to the hand before Hitchhiker or any future additional scorer is considered. */
  selectedDieIds: number[];
  /** The original committed selection, retained even if later effects add scorers. */
  originalSelectedDieIds: number[];
  /** Empty for generated plays; future selection-sensitive effects can key off this explicitly. */
  playerSelectedDieIds: number[];
  decisionMs: number | null;
}

export type QualificationEffect = 'mirror' | 'missingLink' | 'conjoined';

export interface QualificationEffectParticipation {
  dieId: number;
  face: Rank;
  effect: QualificationEffect;
}

/** Reserved for future Invocation-backed wildcards. Legacy qualification effects make no claims. */
export interface QualificationResourceClaim {
  dieId: number;
  effect: QualificationEffect;
  resource: 'invocation';
  amount: number;
}

/** Pure qualification output. Producing this plan must never mutate authoritative game state. */
export interface QualificationPlan {
  hand: HandId;
  requestedDieIds: number[];
  qualifyingDieIds: number[];
  legal: boolean;
  effects: QualificationEffectParticipation[];
  resourceClaims: QualificationResourceClaim[];
}

export type ScoreOccurrenceCause = 'play_selection' | 'hitchhiker' | 'double_time';

/** One genuine scoring activation by one die within a Play. */
export interface ScoreOccurrence {
  id: string;
  rootId: string;
  playId: string;
  hand: HandId;
  playSource: HandPlaySource;
  dieId: number;
  face: Face;
  role: 'selected' | 'hitchhiker';
  cause: ScoreOccurrenceCause;
  originallySelected: boolean;
  playerSelected: boolean;
  additional: boolean;
  /** Only named effects are suppressed; all other Score-triggered behavior still resolves. */
  suppressedEffects: Enhancement[];
}

export type RollContext = 'gameplay' | 'settle' | 'wardenSetup' | 'shop' | 'flameSelection';
export type RollController = 'clockmaker' | 'bump' | 'magnetic' | 'magic' | 'boomerang' | 'rng';

export interface RollBatchIntent {
  id: string;
  dieIds: number[];
  reason: RollReason;
  reasonText: string;
  context: RollContext;
  initialRoundRoll: boolean;
  reroll: boolean;
  manual: boolean;
  postPlay: boolean;
  effectGenerated: boolean;
}

/** One die's request to Roll, retaining its batch and semantic cause. */
export interface RollIntent {
  batchId: string;
  dieId: number;
  reason: RollReason;
  context: RollContext;
  initialRoundRoll: boolean;
  reroll: boolean;
  manual: boolean;
  postPlay: boolean;
  effectGenerated: boolean;
  excludeStartingFace: boolean;
}

/** Result arbitration output, before the exposed face is installed and landing reactions run. */
export interface RollResolution {
  intent: RollIntent;
  dieId: number;
  before: Rank;
  beforePhysical: Rank;
  physicalFace: Rank;
  value: Rank;
  weighted: boolean;
  bumped: boolean;
  actualBump: boolean;
  clockmakerBump: boolean;
  attracted: boolean;
  controller: RollController;
  origin: Face;
  magicHand: HandId | null;
  previousFaceExcluded?: boolean;
}

export function createPlayIntent(
  id: string,
  hand: HandId,
  dieIds: readonly number[],
  source: HandPlaySource,
  decisionMs: number | null,
): PlayIntent {
  const selectedDieIds = [...dieIds].sort((a, b) => a - b);
  return {
    id,
    hand,
    source,
    cause: source === 'manual' ? 'player' : source === 'jumpingBean' ? 'jumping_bean' : 'free_play_effect',
    selectedDieIds,
    originalSelectedDieIds: [...selectedDieIds],
    playerSelectedDieIds: source === 'manual' ? [...selectedDieIds] : [],
    decisionMs,
  };
}

export function createRollBatchIntent(
  id: string,
  dieIds: readonly number[],
  reasonText: string,
  context: RollContext,
  reason: RollReason,
): RollBatchIntent {
  const initialRoundRoll = reason === 'initial_round' || reason === 'warden_opening';
  return {
    id,
    dieIds: [...dieIds],
    reason,
    reasonText,
    context,
    initialRoundRoll,
    reroll: !initialRoundRoll,
    manual: reason === 'manual',
    postPlay: reason === 'post_hand' || reason === 'winning_settle' || reason === 'juggler',
    effectGenerated: reason === 'jumping_bean_followup' || reason === 'magician_return',
  };
}

export const createRollIntent = (batch: RollBatchIntent, dieId: number): RollIntent => ({
  batchId: batch.id,
  dieId,
  reason: batch.reason,
  context: batch.context,
  initialRoundRoll: batch.initialRoundRoll,
  reroll: batch.reroll,
  manual: batch.manual,
  postPlay: batch.postPlay,
  effectGenerated: batch.effectGenerated,
  excludeStartingFace: batch.manual,
});
