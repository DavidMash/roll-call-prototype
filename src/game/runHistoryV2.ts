import type {
  BossFaceMutation, BossType, ChallengeId, DiceRarity, DiceSlotRef, DieType, EngulfmentAssetRef, Flame, FlameInstanceId, GoldSource, GoldSpendSource, HandId, HandPlaySource,
  FlameSlotIndex, FlameStage, HexerFaceEffect, InfernoEvaluationState, Rarity, Rank, RunNodeType, ShopStage, SpecialOfferType,
  SpecialDieType, TemperSource, TemperSpendSource,
} from './types';
import type { RoundGoalBreakdown } from './goals';
import type { ExactDecimal, ExactScore } from './scoreMath';

export const RUN_HISTORY_V2_SCHEMA_VERSION = 26 as const;
export const RUN_HISTORY_V2_RULESET = 'dice-pips-hand-mult-v1' as const;

export interface RunHistoryV2Coverage {
  complete: boolean;
  firstRound: number;
  firstActionId: number;
  firstSeq: number;
}

export type FlameOrigin = 'ember' | 'bonfire' | 'charge' | 'boss' | 'special_offer' | 'external';
export type RollReason = 'initial_round' | 'warden_opening' | 'manual' | 'post_hand' | 'winning_settle'
  | 'jumping_bean_followup' | 'juggler' | 'magician_return' | 'dare_devil' | 'shop' | 'other';

export interface RunHistoryV2Envelope {
  seq: number;
  kind: RunHistoryV2Event['kind'];
  round: number;
  attempt: number;
  actionId: number;
  timelineId: number;
  parentSeq?: number;
}

export interface HistoryDieState {
  dieId: number;
  owner: 'player' | 'boss';
  rosterSlot: number | null;
  effects?: import('./types').DieEffectInstance[];
  encounterId?: string;
  physicalFace: Rank;
  face: Rank;
  pips: number;
  bossMutation: BossFaceMutation | null;
  encounterFaceEffect?: HexerFaceEffect;
  specialRuntime?: import('./types').DieRoundRuntime;
}

export interface PipsContribution {
  source: 'die_base' | 'special_die' | 'team_player';
  amount: number;
  occurrenceId?: string;
  dieId?: number;
  face?: Rank;
  role?: 'selected' | 'hitchhiker';
  sourceDieIds?: number[];
  effectType?: SpecialDieType;
}

export interface MultContribution {
  source: 'hand';
  factor: number;
  before: number;
  after: number;
  stacks?: number;
}

export interface XMultContribution {
  sourceId: Flame | 'charge' | BossType | SpecialOfferType | 'other';
  origin: FlameOrigin;
  factor: number;
  sourceInstanceId?: FlameInstanceId;
  dieId?: number;
  input?: number;
  diagnostics?: import('./types').FlameActivationDiagnostics;
  /** Counterfactual factors attributing a consumed shared Charge factor to its producing Flames. */
  chargeSources?: { flame: Flame; instanceId?: FlameInstanceId; origin?: Exclude<FlameOrigin, 'charge' | 'boss' | 'special_offer' | 'external'>;
    attributed?: number; factor: number }[];
}

export type HandSideEffect =
  | { type: 'gold'; source: GoldSource; amount: number; dieId?: number }
  | { type: 'double_time'; dieId: number; succeeded: boolean }
  | { type: 'special_die'; dieId: number; dieType: import('./types').SpecialDieType; effectInstanceId: string; detail: string;
      invocationBefore?: number; invocationAfter?: number }
  | { type: 'charge'; operation: 'gain' | 'consume_reset' | 'arm' | 'disarm'; before: number; after: number; source?: Flame }
  | { type: 'flame_activation'; flame: Flame; origin: FlameOrigin; dieId?: number; factor?: number }
  | { type: 'free_play'; dieId: number; rerollEventId: string; pipsMultiplier?: number }
  | { type: 'sustainable'; dieId: number; hand: HandId; chargesRemaining: number }
  | { type: 'conjoined'; dieId: number; hand: HandId }
  | { type: 'boss_state'; boss: BossType; change: string; amount?: number | ExactScore;
    hand?: HandId; hands?: HandId[]; dieIds?: number[]; state?: string };

export interface RunStartedEvent extends RunHistoryV2Envelope {
  kind: 'run_started';
  schemaVersion: typeof RUN_HISTORY_V2_SCHEMA_VERSION;
  ruleset: typeof RUN_HISTORY_V2_RULESET;
  seed: string;
  initialLives: number;
  initialGold: number;
  initialHandLevels: Record<HandId, number>;
  runMode?: 'scenario';
  scenarioId?: string;
  scenarioVersion?: number;
  scenarioName?: string;
}

export interface ChapterStartedEvent extends RunHistoryV2Envelope {
  kind: 'chapter_started';
  chapter: number;
  miniBoss: BossType;
  boss: BossType;
}

export interface RoundAttemptStartedEvent extends RunHistoryV2Envelope {
  kind: 'round_attempt_started';
  chapter: number;
  chapterRound: number;
  retry: boolean;
  target: Omit<RoundGoalBreakdown, 'chapter' | 'localRound'>;
  boss: BossType | null;
  lives: number;
  dice: HistoryDieState[];
  flames?: Array<{ instanceId: FlameInstanceId; type: Flame; investedGold: number; stage: FlameStage }>;
}

export interface RollResult {
  dieId: number;
  beforePhysicalFace: Rank;
  afterPhysicalFace: Rank;
  beforeFace: Rank;
  afterFace: Rank;
  previousFaceExcluded: boolean;
  weighted: null | { sourceFace: Rank; stacks: number; destinationWeight: number;
    selectedNumber?: Exclude<Rank, 7>; matchingPhysicalFaces?: number };
  magneticAnchorIds: number[];
  controller: import('./resolution').RollController;
  controllerDieId?: number;
  locked?: boolean;
  intercepted?: boolean;
}

export type RollEffect =
  | { type: 'charge'; source: Flame; before: number; after: number }
  | { type: 'flame_activation'; flame: Flame; origin: FlameOrigin; dieIds: number[] }
  | { type: 'boss'; boss: BossType; change: string; dieIds: number[] }
  | { type: 'special_die'; dieId: number; dieType: import('./types').SpecialDieType; effectInstanceId: string; detail: string;
      invocationBefore?: number; invocationAfter?: number };

export interface RollBatchEvent extends RunHistoryV2Envelope {
  kind: 'roll_batch';
  reason: RollReason;
  context: 'gameplay' | 'settle' | 'warden_setup' | 'shop' | 'flame_selection';
  dieIds: number[];
  heldDieIds: number[];
  results: RollResult[];
  spend: null | { normalCharges: number; carePackageCharges: number; remaining: number };
  effects: RollEffect[];
}

export interface HandScoredEvent extends RunHistoryV2Envelope {
  kind: 'hand_scored';
  scorePackageId: string;
  rootPlayId: string;
  parentPlayId: string | null;
  hand: HandId;
  level: number;
  playSource: HandPlaySource;
  selectedDice: number[];
  scoringDice: (HistoryDieState & { role: 'selected' | 'hitchhiker' })[];
  scoreOccurrences: {
    id: string;
    rootId: string;
    dieId: number;
    cause: import('./resolution').ScoreOccurrenceCause;
    originallySelected: boolean;
    playerSelected: boolean;
    additional: boolean;
    suppressedEffects: import('./resolution').ScoreEffectSuppression[];
  }[];
  consumed: boolean;
  score: {
    infernoMultiplier?: ExactScore;
    finalPips: number;
    handMult: number;
    finalMult: number;
    finalXMult: number;
    bossFactor: number;
    raw: ExactDecimal;
    awarded: ExactScore;
    rounding: { mode: 'nearest_integer'; delta: ExactDecimal };
  };
  roundScore: { before: ExactScore; afterAward: ExactScore; after: ExactScore };
  pipsContributions: PipsContribution[];
  resolvedDicePips: import('./types').ResolvedDiePips[];
  multContributions: MultContribution[];
  xMultContributions: XMultContribution[];
  sideEffects: HandSideEffect[];
}

export interface ShopVisitStartedEvent extends RunHistoryV2Envelope {
  kind: 'shop_visit_started';
  shopVisitId: number;
  reason: 'normal' | 'bust' | 'bad_dream';
  initialStage: ShopStage;
}

/** One whole-die activation, including On Command uses that occur outside a Play or Roll batch. */
export interface SpecialDieActivatedEvent extends RunHistoryV2Envelope {
  kind: 'special_die_activated';
  dieId: number;
  dieType: SpecialDieType;
  effectInstanceId: string;
  level: number;
  context: 'hand' | 'roll' | 'command' | 'other';
  effectCause: string;
  detail: string;
  invocationBefore?: number;
  invocationAfter?: number;
}

export interface ShopStageChangedEvent extends RunHistoryV2Envelope {
  kind: 'shop_stage_changed';
  shopVisitId: number;
  from: ShopStage;
  to: ShopStage;
}

export interface TrainingSessionStartedEvent extends RunHistoryV2Envelope {
  kind: 'training_session_started';
  shopVisitId: number;
  upperLevelsAtEntry: Record<import('./types').UpperHandId, number>;
  lowerLevelsAtEntry: Record<import('./types').LowerHandId, number>;
  upperBaseline: number;
  lowerBaseline: number;
}

export interface TeamTrainingAppliedEvent extends RunHistoryV2Envelope {
  kind: 'team_training_applied';
  offerId: number;
  levelsBefore: Record<HandId, number>;
  levelsAfter: Record<HandId, number>;
}

export interface ShopVisitCompletedEvent extends RunHistoryV2Envelope {
  kind: 'shop_visit_completed';
  shopVisitId: number;
  stage: Exclude<ShopStage, 'shop'>;
  progression: 'next_round' | 'retry_round' | 'next_chapter';
}

export interface EngulfmentOfferingTelemetry {
  asset: EngulfmentAssetRef;
}

export interface EngulfmentEvidenceRoundTelemetry {
  round: number;
  attempt: number;
  timelineId: number;
  handCount: number;
  multiplier: number;
}

export interface EngulfmentAttemptedEvent extends RunHistoryV2Envelope {
  kind: 'engulfment_attempted';
  shopVisitId: number;
  attemptNumber: 1;
  infernoLevelBefore: number;
  infernoLevelAfter: number;
  infernoMultiplierBefore: ExactScore;
  infernoMultiplierAfter: ExactScore;
  offerings: EngulfmentOfferingTelemetry[];
  evidenceRounds: EngulfmentEvidenceRoundTelemetry[];
  offeringMultiplier: number;
  requiredMultiplier: number;
  success: boolean;
  overqualification: number;
  upper: { levelsBefore: { hand: HandId; level: number }[]; average: number; unifiedLevel: number };
  lower: { levelsBefore: { hand: HandId; level: number }[]; average: number; unifiedLevel: number };
  flamesSnuffed: EngulfmentAssetRef[];
  questForfeited: boolean;
  forfeitedQuestId?: ChallengeId;
  returnedToShop: true;
}

export interface ShopOffersPresentedEvent extends RunHistoryV2Envelope {
  kind: 'shop_offers_presented';
  pool: 'dice' | 'flame' | 'special_offer';
  reason: 'initial' | 'reroll' | 'reward';
  /** Present for normal-Shop Dice impressions so transactions can be joined to one persistent visit. */
  shopVisitId?: number;
  offers: { id: number; contentId: DieType | Flame | SpecialOfferType; rarity: Rarity | DiceRarity; price?: number }[];
}

export type ShopTransaction =
  | { type: 'gold_earned'; source: GoldSource; amount: number }
  | { type: 'round_payout'; sources: Partial<Record<GoldSource, number>>; total: number }
  | { type: 'gold_spent'; source: GoldSpendSource; amount: number }
  | { type: 'dice_purchased'; shopVisitId: number; offerId: number; dieId: number; dieType: SpecialDieType; level: number;
      rarity: DiceRarity; listedPrice: number; pricePaid: number; destination: DiceSlotRef }
  | { type: 'dice_sold'; dieId: number; effects: import('./types').DieEffectInstance[]; source: DiceSlotRef;
      componentSalvage: number; complexityPremium: number; vintageAppreciation: number; proceeds: number }
  | { type: 'dice_moved'; source: DiceSlotRef; destination: DiceSlotRef; sourceDieId: number; destinationDieId: number | null }
  | { type: 'dice_fused'; ingredientIds: [number, number]; resultId: number; destination: DiceSlotRef;
      effects: import('./types').DieEffectInstance[]; temperCost: string; forgeRating: string; operation: 'fusion' | 'forge' }
  | { type: 'dice_offers_rerolled'; cost: number; oldOfferIds: number[]; newOfferIds: number[]; rerollCount: number }
  | { type: 'training'; shopVisitId: number; hand: HandId; family: 'upper' | 'lower'; fromLevel: number; toLevel: number;
      frozenBaseline: number; relativeTier: number; normalPrice: number | null; cost: number;
      waivedByOnTheHouse: boolean; purchaseCount: number }
  | { type: 'life_restored'; cost: number; livesBefore: number; livesAfter: number }
  | { type: 'special_offer_selected'; offer: SpecialOfferType; rarity: Rarity; hand?: HandId };

export interface ShopTransactionEvent extends RunHistoryV2Envelope {
  kind: 'shop_transaction';
  transaction: ShopTransaction;
}

export type FlameChange =
  | { type: 'acquired' | 'replaced'; flame: Flame; instanceId: FlameInstanceId; slot: FlameSlotIndex;
      replaced?: { instanceId: FlameInstanceId; flame: Flame; stage: FlameStage; investedGold: number }; rarity: Rarity }
  | { type: 'skipped' }
  | { type: 'stoked'; flame: Flame; instanceId: FlameInstanceId; slot: FlameSlotIndex; amount: number; from: number; to: number }
  | { type: 'bonfire_created'; flame: Flame; instanceId: FlameInstanceId; slot: FlameSlotIndex }
  | { type: 'activated'; flame: Flame; instanceId: FlameInstanceId; slot: FlameSlotIndex; origin: FlameOrigin;
      factor?: number; diagnostics?: import('./types').FlameActivationDiagnostics };

export interface FlameChangedEvent extends RunHistoryV2Envelope {
  kind: 'flame_changed';
  change: FlameChange;
}

export interface ChargeChangedEvent extends RunHistoryV2Envelope {
  kind: 'charge_changed';
  operation: 'gain' | 'arm' | 'disarm' | 'consume_reset' | 'round_reset';
  before: number;
  after: number;
  source?: Flame;
  sourceInstanceId?: FlameInstanceId;
  dieIds: number[];
}

export interface BossStateChangedEvent extends RunHistoryV2Envelope {
  kind: 'boss_state_changed';
  boss: BossType;
  change: 'started' | 'cleared' | 'state' | 'warden_target' | 'warden_unlock' | 'face'
    | 'called' | 'target' | 'requested' | 'remained' | 'caught';
  hand?: HandId;
  hands?: HandId[];
  dieIds: number[];
  amount?: number | ExactScore;
  state?: string;
}

export interface FlameChargeGeneratedEvent extends RunHistoryV2Envelope {
  kind: 'flame_charge_generated';
  flame: Flame;
  requested: number;
  gained: number;
  lostToCap: number;
  before: number;
  after: number;
  diagnostics?: import('./types').FlameActivationDiagnostics;
}

export interface FlameRuntimeChangedEvent extends RunHistoryV2Envelope {
  kind: 'flame_runtime_changed';
  flame: Flame;
  change: 'sequence_stage' | 'streak_reset';
  hand?: HandId;
  from?: import('./types').HandFamilyFlameStage | number;
  to?: import('./types').HandFamilyFlameStage | number;
  reason: 'setup_play' | 'payoff_play' | 'scorecard_refresh' | 'marathon_reuse' | 'lower_play';
}

export interface FlameSequenceEvent extends RunHistoryV2Envelope {
  kind: 'flame_sequence';
  flame: 'hotStreak' | 'topDown' | 'countDown';
  stepIndex: number;
  requiredHandBefore: HandId | null;
  playedHand: HandId | null;
  advanced: boolean;
  factorApplied?: number;
  newRequiredHand: HandId | null;
  completed: boolean;
  resetReason?: 'scorecard_refresh';
  playSource?: HandPlaySource;
}

export type FlameActionDetail =
  | { type: 'burn_it_down'; scoreSacrificed: ExactScore; target: ExactScore; fraction: number;
      chargeBefore: number; chargeRequested: number; chargeGained: number; useCount: number }
  | { type: 'grease_the_engine'; cost: number; goldBefore: number; goldAfter: number; useCount: number;
      chargeRequested: number; chargeGained: number }
  | { type: 'lightning_strike'; dieId: number; predictedFace: Rank; actualFace: Rank; hit: boolean;
      manualRerollSource: 'normal' | 'carePackage'; chargeGained: number }
  | { type: 'hot_potato_play'; targetBefore: number; played: boolean; streak: number;
      chargeRequested: number; chargeGained: number; targetAfter: number | null }
  | { type: 'dare_activated'; dareCount: number; dieIds: number[]; storedFactor: number }
  | { type: 'dare_payoff'; dareCount: number; hand: HandId; factor: number }
  | { type: 'bribe_purchased'; cost: number; ordinal: number; increment: number; pendingCount: number; pendingFactor: number;
      goldBefore: number; goldAfter: number }
  | { type: 'bribery_consumed'; hand: HandId; pendingCount: number; factor: number }
  | { type: 'bribery_round_reset'; purchasedCount: number; pendingCount: number };

export interface FlameActionEvent extends RunHistoryV2Envelope {
  kind: 'flame_action';
  flame: Flame;
  action: FlameActionDetail;
}

export interface ScorePackageCompletedEvent extends RunHistoryV2Envelope {
  kind: 'score_package_completed';
  packageId: string;
  rootPlayId: string;
  hand: HandId;
  initiatingSource: HandPlaySource;
  score: ExactScore;
  playIds: string[];
  allIn: boolean;
  doubleOrNothingRedemption: boolean;
}

export interface ScorePackageRemovedEvent extends RunHistoryV2Envelope {
  kind: 'score_package_removed';
  packageId: string;
  reason: 'double_or_nothing' | 'all_in_failure';
  amount: ExactScore;
  roundScoreBefore: ExactScore;
  roundScoreAfter: ExactScore;
}

export interface DoubleOrNothingEvent extends RunHistoryV2Envelope {
  kind: 'double_or_nothing';
  phase: 'offered' | 'accepted' | 'expired' | 'ignored' | 'redeemed';
  packageId: string;
  hand: HandId;
  packageScore: ExactScore;
  factor: number;
  roundScore: ExactScore;
  target: ExactScore;
  handReopened?: boolean;
  scoreRemoved?: ExactScore;
  clearedRound?: boolean;
  playsToRedemption?: number;
}

export interface AllInEvent extends RunHistoryV2Envelope {
  kind: 'all_in';
  phase: 'armed' | 'resolved';
  hand?: HandId;
  packageId?: string;
  factor: number;
  packageScore?: ExactScore;
  prePackageRoundScore?: ExactScore;
  temporaryRoundScore?: ExactScore;
  success?: boolean;
  scoreRemoved?: ExactScore;
}

export interface UltimateTargetsChangedEvent extends RunHistoryV2Envelope {
  kind: 'ultimate_targets_changed';
  targets: HandId[];
  reason: 'acquired' | 'training' | 'focus' | 'team_training' | 'engulfment' | 'round_start' | 'retry';
}

export interface BenchWarmerTargetChangedEvent extends RunHistoryV2Envelope {
  kind: 'bench_warmer_target_changed';
  target: HandId;
  reason: UltimateTargetsChangedEvent['reason'];
}

export interface TemperChangedEvent extends RunHistoryV2Envelope {
  kind: 'temper_changed';
  operation: 'earned' | 'spent';
  source: TemperSource | TemperSpendSource;
  amount: number;
  balance: number;
  shopVisitId: number | null;
}

export interface InfernoEvaluatedEvent extends RunHistoryV2Envelope {
  kind: 'inferno_evaluated';
  evaluation: InfernoEvaluationState;
}

export interface InfernoSuspensionChangedEvent extends RunHistoryV2Envelope {
  kind: 'inferno_suspension_changed';
  suspended: boolean;
  reason: 'collection_insufficient' | 'new_flame_acquired';
  flame?: Flame;
  instanceId?: FlameInstanceId;
}

export interface ScorecardRefreshedEvent extends RunHistoryV2Envelope {
  kind: 'scorecard_refreshed';
  refreshedHands: HandId[];
}

export interface RoundAttemptFinishedEvent extends RunHistoryV2Envelope {
  kind: 'round_attempt_finished';
  outcome: 'cleared' | 'bust';
  score: ExactScore;
  target: ExactScore;
  boss: BossType | null;
  livesBefore: number;
  livesAfter: number;
}

export interface CheckpointRestoredEvent extends RunHistoryV2Envelope {
  kind: 'checkpoint_restored';
  reason: 'bust' | 'bad_dream' | 'time_travel';
  fromTimelineId: number;
  toTimelineId: number;
  abandonedFromSeq: number;
  abandonedThroughSeq: number;
  canonicalRound: number;
  canonicalAttempt: number;
  /** Persistent build/economy events retained across a progression-only relocation. */
  retainedSeqs?: number[];
  relocation?: 'chapter_start' | 'post_r3_shop';
  /** Declares that relocation changed progression only; the live build remains authoritative. */
  preservedState?: 'current_build';
  /** Canonical copies of persistent side effects from otherwise rewound hand events. */
  retainedHandSideEffects?: { sourceSeq: number; sideEffects: HandSideEffect[] }[];
  /** Persistent Care Package spending from otherwise rewound roll events. */
  retainedCarePackageSpends?: { sourceSeq: number; charges: number }[];
}

export interface RunFinishedEvent extends RunHistoryV2Envelope {
  kind: 'run_finished';
  outcome: 'lost' | 'completed';
  finalChapter: number;
  finalRound: number;
  finalBoss: BossType | null;
  score: ExactScore;
  target: ExactScore;
  finalHandLevels: Record<HandId, number>;
}

export interface ErrorEvent extends RunHistoryV2Envelope {
  kind: 'error';
  code: 'resolution_error';
  detail: string;
}

export interface MapTransitionV2Event extends RunHistoryV2Envelope {
  kind: 'map_transition';
  fromNode: string | null;
  toNode: string;
  nodeType: RunNodeType;
  direction: 'forward' | 'backward';
}

export type RunHistoryV2Event = RunStartedEvent | ChapterStartedEvent | RoundAttemptStartedEvent | RollBatchEvent
  | HandScoredEvent | SpecialDieActivatedEvent | ShopVisitStartedEvent | ShopStageChangedEvent | TrainingSessionStartedEvent | TeamTrainingAppliedEvent | ShopVisitCompletedEvent
  | ShopOffersPresentedEvent | ShopTransactionEvent | TemperChangedEvent | FlameChangedEvent | ChargeChangedEvent | FlameChargeGeneratedEvent
  | EngulfmentAttemptedEvent | InfernoEvaluatedEvent | InfernoSuspensionChangedEvent
  | BossStateChangedEvent | UltimateTargetsChangedEvent | BenchWarmerTargetChangedEvent | FlameRuntimeChangedEvent | FlameSequenceEvent | ScorecardRefreshedEvent | RoundAttemptFinishedEvent
  | FlameActionEvent
  | ScorePackageCompletedEvent | ScorePackageRemovedEvent | DoubleOrNothingEvent | AllInEvent
  | CheckpointRestoredEvent | RunFinishedEvent | ErrorEvent | MapTransitionV2Event;

type EnvelopeKeys = Exclude<keyof RunHistoryV2Envelope, 'kind'>;
export type RunHistoryV2EventInput = RunHistoryV2Event extends infer Event
  ? Event extends RunHistoryV2Event ? Omit<Event, EnvelopeKeys> & { parentSeq?: number } : never
  : never;
