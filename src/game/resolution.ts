import type { RollReason } from './runHistoryV2';
import type { DieType, Face, HandId, HandPlaySource, Rank } from './types';

export type PlayCause = 'player' | 'free_play_effect' | 'jumping_bean';

/** A committed request to resolve one hand. This is deliberately distinct from its Score occurrences. */
export interface PlayIntent {
  id: string;
  scorePackageId: string;
  rootPlayId: string;
  parentPlayId: string | null;
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
  qualificationClaims: QualificationResourceClaim[];
  allIn: boolean;
  doubleOrNothingRedemption: boolean;
}

export type QualificationEffect = 'mirror' | 'missingLink' | 'conjoined' | 'hexerWild';

export interface QualificationEffectParticipation {
  dieId: number;
  face: Rank;
  effect: QualificationEffect;
  effectInstanceId?: string;
  virtualValue?: Rank;
  virtualDuplicateCount?: number;
}

/** Reserved for future Invocation-backed wildcards. Legacy qualification effects make no claims. */
export interface QualificationResourceClaim {
  dieId: number;
  effect: Exclude<QualificationEffect, 'hexerWild'>;
  effectInstanceId: string;
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
  claimOptions: QualificationResourceClaim[][];
  ambiguousClaims: boolean;
}

export type ScoreOccurrenceCause = 'play_selection' | 'hitchhiker' | 'double_time' | 'lone_wolf' | 'conjoined';
export type ScoreEffectSuppression = 'wholeDieDoubleTime';

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
  suppressedEffects: ScoreEffectSuppression[];
}

export type RollContext = 'gameplay' | 'settle' | 'wardenSetup' | 'shop' | 'flameSelection';
export type RollController = 'tank' | 'clockworkDie' | 'magicDie' | 'magneticDie'
  | 'hexerWeighted' | 'hexerClockwork' | 'rng';

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
  attracted: boolean;
  controller: RollController;
  origin: Face;
  controllerDieId?: number;
  locked?: boolean;
  intercepted?: boolean;
  specialDieType?: DieType;
  weightedBias?: { selectedNumber: Exclude<Rank, 7>; matchingPhysicalFaces: number; selectedFaceWeight: number };
  previousFaceExcluded?: boolean;
}

export function createPlayIntent(
  id: string,
  hand: HandId,
  dieIds: readonly number[],
  source: HandPlaySource,
  decisionMs: number | null,
  qualificationClaims: QualificationResourceClaim[] = [],
  lineage?: { scorePackageId: string; rootPlayId: string; parentPlayId: string | null;
    allIn?: boolean; doubleOrNothingRedemption?: boolean },
): PlayIntent {
  const selectedDieIds = [...dieIds];
  return {
    id,
    scorePackageId: lineage?.scorePackageId ?? id,
    rootPlayId: lineage?.rootPlayId ?? id,
    parentPlayId: lineage?.parentPlayId ?? null,
    hand,
    source,
    cause: source === 'manual' ? 'player' : source === 'jumpingBean' ? 'jumping_bean' : 'free_play_effect',
    selectedDieIds,
    originalSelectedDieIds: [...selectedDieIds],
    playerSelectedDieIds: source === 'manual' ? [...selectedDieIds] : [],
    decisionMs,
    qualificationClaims: structuredClone(qualificationClaims),
    allIn: lineage?.allIn === true,
    doubleOrNothingRedemption: lineage?.doubleOrNothingRedemption === true,
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
    effectGenerated: reason === 'jumping_bean_followup' || reason === 'magician_return' || reason === 'dare_devil',
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
