import type { RollReason, RunHistoryV2Coverage, RunHistoryV2Event } from './runHistoryV2';
import type { DebugTraceState } from './debugTrace';
import type { ExactDecimal, ExactScore } from './scoreMath';

export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Rarity = 'common' | 'uncommon' | 'rare';
export type BigBossType = 'magician' | 'juggler' | 'caller' | 'warden' | 'hexer' | 'marathon' | 'fly' | 'snakeEyes' | 'infected';
export type MiniBossType = 'capitalReturn' | 'neglected'
  | 'tightrope' | 'crawler' | 'quickdraw' | 'pendulum';
/** Retained only so old history/save payloads can still be inspected. New runs never schedule Mugger. */
export type LegacyBossType = 'mugger';
export type BossType = BigBossType | MiniBossType | LegacyBossType;
export interface ChapterPlan {
  chapterNumber: number;
  miniBoss: MiniBossType;
  boss: BigBossType;
}
export type RunNodeType = 'normal_round' | 'mini_boss_round' | 'boss_round' | 'shop' | 'flame_selection' | 'special_offer';
export type Flame =
  | 'ultimate' | 'minigun' | 'hailMary' | 'fullOfGrace'
  | 'momentum' | 'thirdRail' | 'jumpStart' | 'powerSurge'
  | 'speedDemon' | 'sixPack' | 'fluxCapacitor'
  | 'fatCat' | 'vineyard' | 'fetch' | 'targetPractice'
  | 'hotStreak' | 'lowball' | 'straightShooter' | 'doubleDown'
  | 'threesCompany' | 'boxSet' | 'missingPair' | 'oneShort';
export type FlameInstanceId = number;
export type FlameStage = 'ember' | 'bonfire';
export type FlameSlotIndex = 0 | 1 | 2 | 3 | 4;
export interface FlameInstance {
  instanceId: FlameInstanceId;
  type: Flame;
  investedGold: number;
  stage: FlameStage;
}
export type FlameSlots = [FlameInstance | null, FlameInstance | null, FlameInstance | null, FlameInstance | null, FlameInstance | null];
export type DieId = number;
export type SpecialDieType =
  | 'basic' | 'bonus' | 'workout' | 'vintage' | 'golden'
  | 'hitchhiker' | 'weighted' | 'clockwork' | 'magnetic' | 'jackpot'
  | 'teamPlayer' | 'loneWolf' | 'tank' | 'freePlay'
  | 'mirror' | 'missingLink' | 'doubleTime' | 'jumpingBean'
  | 'chameleon' | 'flywheel' | 'magic' | 'conjoined' | 'furnace' | 'sustainable';
export type DieType = 'normal' | SpecialDieType;
export type DieEffectInstanceId = string;
export type DiceRarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export type HandId =
  | 'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes' | 'sevens'
  | 'pair' | 'twoPair' | 'threeKind' | 'fullHouse' | 'fourKind' | 'fiveKind' | 'smallStraight' | 'largeStraight';
export type UpperHandId = 'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes' | 'sevens';
export type LowerHandId = Exclude<HandId, UpperHandId>;
export type Phase = 'round' | 'roundSummary' | 'inferno' | 'bust' | 'flameSelection' | 'specialOffer' | 'shop' | 'lost' | 'error';
export type ScoreSource = 'hand' | 'curtainCall' | 'jumpingBean' | 'hitchhiker' | 'boss';
export type HandPlaySource = 'manual' | 'jumpingBean' | 'freePlay';
export type GoldSource = 'golden' | 'jackpot' | 'diceSale' | 'roundBase' | 'unusedRerolls' | 'interest' | 'bossReward' | 'specialOffer';
export type GoldSpendSource = 'dicePurchase' | 'diceOfferReroll' | 'handTraining' | 'flameInvestment' | 'lifeRestore' | 'furnace';
export type TemperSource = 'overkill' | 'boardRefresh' | 'miniBoss' | 'boss' | 'bonfire' | 'engulfment';
export type TemperSpendSource = 'fusion' | 'forge';
export type RoundTemperState = { overkill: number; boardRefresh: number; miniBoss: number; boss: number };
export type HandLevels = Record<HandId, number>;
export type HandFamilyFlameStage = 'setup' | 'payoff' | 'spent';

export interface RunNode {
  id: string;
  type: RunNodeType;
  round: number;
  boss?: BossType;
}
export interface CallerBossState {
  type: 'caller';
  calledHand: HandId;
  playsRemaining: number;
  satisfied: boolean;
  satisfyingSource: HandPlaySource | null;
  callsCompleted?: number;
  callsMissed?: number;
  manualHandsPlayed?: number;
  callDeadline?: number;
}
export interface WardenBossState {
  type: 'warden';
  /** The equipped player dice that belong to this encounter, in Roster order. */
  encounterDieIds: number[];
  activeDieIds: number[];
  startingDieId: number | null;
  nextUnlockTarget: ExactScore | null;
  unlockCosts: ExactScore[];
  unlockTargets: ExactScore[];
  pendingReinforcements: number;
}
export interface HexerBossState { type: 'hexer'; cursedDieId: number }
export interface MarathonBossState { type: 'marathon'; cooldowns: Partial<Record<HandId, number>> }
export interface QuickdrawBossState { type: 'quickdraw'; lowerShotUsed: boolean; playedLowerHand: HandId | null }
export interface PendulumBossState { type: 'pendulum'; requestedSection: 'upper' | 'lower'; switches: number }
export interface FlyBossState { type: 'fly'; flyHand: HandId | null; caught: boolean; moves: number; mercyActive?: boolean }
export interface SnakeEyesBossState { type: 'snakeEyes'; mutatedFaces: { dieId: number; physicalFace: Rank }[] }
export interface InfectedBossState { type: 'infected'; infectedFaces: { dieId: number; physicalFace: Rank }[] }
export interface JugglerBossState { type: 'juggler' }
export interface CapitalReturnBossState { type: 'capitalReturn' }
export interface NeglectedBossState {
  type: 'neglected';
  neglectedHands: HandId[];
  handsPlayed: number;
  restored: boolean;
}
export interface TightropeBossState { type: 'tightrope' }
export interface CrawlerBossState { type: 'crawler' }
export interface MagicianBossState {
  type: 'magician';
  missingDieId: number | null;
  calledHands: HandId[];
  completedHands: HandId[];
  returned: boolean;
}
export interface MuggerBossState { type: 'mugger'; hiddenHand: HandId; revealedHand: HandId | null; spent: boolean }
export type BossRuntimeState = CallerBossState | WardenBossState | HexerBossState | MarathonBossState
  | QuickdrawBossState | FlyBossState | SnakeEyesBossState | InfectedBossState
  | JugglerBossState | CapitalReturnBossState | NeglectedBossState
  | TightropeBossState | CrawlerBossState | MagicianBossState | MuggerBossState | PendulumBossState;

export interface XMultFactor {
  source: Flame | 'charge';
  value: number;
  dieId: number | null;
  flameInstanceId?: FlameInstanceId;
  detail?: string;
  input?: number;
}
export interface HandScoreAccumulator {
  hand: HandId;
  handLevel: number;
  infernoMultiplier: ExactScore;
  dieIds: number[];
  basePips: number;
  baseMultiplier: number;
  currentPips: number;
  currentMultiplier: number;
  xMultFactors: XMultFactor[];
  currentXMult: number;
  bossFactor: number;
  bonusPips: number;
  hitchhikerPips: number;
  rawScore: ExactDecimal | null;
  finalScore: ExactScore | null;
}
export interface HandScoreRecord {
  round: number;
  hand: HandId;
  handLevel: number;
  infernoMultiplier: ExactScore;
  dieIds: number[];
  basePips: number;
  baseMultiplier: number;
  pips: number;
  multiplier: number;
  xMult: number;
  bossFactor: number;
  xMultFactors: XMultFactor[];
  rawScore: ExactDecimal;
  score: ExactScore;
  bonusPips: number;
  hitchhikerPips: number;
  playSource: HandPlaySource;
  consumedHand: boolean;
}

export type BossFaceMutation =
  | { kind: 'snakeEyes'; originalRank: Rank }
  | { kind: 'infected' };

export interface PhysicalFace {
  rank: Rank;
  bossMutation?: BossFaceMutation;
}

/** Hexer-only authored face rules, separate from collectible whole-die effects. */
export type HexerFaceEffect =
  | { kind: 'goldenWeighted'; target: Exclude<Rank, 7> }
  | { kind: 'wild' }
  | { kind: 'wildWorkout'; growthPips: number }
  | { kind: 'workoutClockwork'; growthPips: number }
  | { kind: 'wildBonus'; bonusPips: number };

export interface HexerFace extends PhysicalFace {
  hexerEffect: HexerFaceEffect;
  temporaryPips: number;
}

export type Face = PhysicalFace | HexerFace;
export interface StandaloneScoreRecord {
  round: number;
  dieId: number;
  pips: number;
  multiplier: number;
  xMult: number;
  xMultFactors: XMultFactor[];
  rawScore: ExactDecimal;
  score: ExactScore;
}
export interface CollectibleDie {
  id: DieId;
  value: Rank;
  faces: PhysicalFace[];
  owner: 'player';
  /** Ordered for stable presentation only. Gameplay resolves effects by explicit phases. */
  effects: DieEffectInstance[];
}
export interface DieEffectPersistentState {
  /** Persistent value added to this die's future sale price by Vintage. */
  vintageAppreciation: number;
  /** Persistent player configuration for Weighted's selected number. */
  weightedFace: Exclude<Rank, 7>;
  /** Persistent player configuration for Jumping Bean's selected number. */
  jumpingBeanNumber: Exclude<Rank, 7>;
}
export interface DieEffectInstance {
  id: DieEffectInstanceId;
  type: SpecialDieType;
  level: number;
  persistent: DieEffectPersistentState;
}
export interface EncounterDie {
  id: DieId;
  value: Rank;
  faces: PhysicalFace[];
  owner: 'boss';
  encounterId: string;
}
export type Die = CollectibleDie | EncounterDie;
export type RosterSlots = [DieId | null, DieId | null, DieId | null, DieId | null, DieId | null];
export type StorageSlots = [DieId | null, DieId | null, DieId | null, DieId | null, DieId | null];
export interface DiceInventory {
  instances: Record<DieId, CollectibleDie>;
  roster: RosterSlots;
  storage: StorageSlots;
  nextDieId: number;
}
/** Authoritative resources that exist only for one Round attempt. */
export interface DieEffectRoundRuntime {
  effectId: DieEffectInstanceId;
  type: SpecialDieType;
  invocationsRemaining: number;
  goldenGoldEarned: number;
  temporaryPips: number;
  clockworkRolls: number;
  furnaceUnits: number;
  magicArmedFace: Exclude<Rank, 7> | null;
  weightedFace: Exclude<Rank, 7>;
  jumpingBeanNumber: Exclude<Rank, 7>;
}
export interface DieRoundRuntime {
  dieId: DieId;
  effects: Record<DieEffectInstanceId, DieEffectRoundRuntime>;
}
export type DieRoundState = Record<DieId, DieRoundRuntime>;
export interface DiceOffer {
  id: number;
  dieType: Exclude<DieType, 'normal'>;
  rarity: DiceRarity;
  price: number;
  purchased: boolean;
}
export type DiceSlotRef = { area: 'roster' | 'storage'; index: number };
export type ShopStage = 'shop' | 'forge' | 'train' | 'flames';
export interface ForgeSelection { dieAId: DieId | null; dieBId: DieId | null }
export interface FrozenTrainingSession {
  upperLevelsAtEntry: Record<UpperHandId, number>;
  lowerLevelsAtEntry: Record<LowerHandId, number>;
  upperBaseline: number;
  lowerBaseline: number;
  purchasesByHand: Record<HandId, number>;
  /** On The House: the first individual Training purchase in this visit costs no Gold. */
  freeTrainingAvailable: boolean;
}
export interface Shop {
  /** Monotonic identity for one semantic Shop visit, including Bust/Bad Dream returns. */
  visitId?: number;
  /** The authoritative section of this persistent Shop visit currently being viewed. */
  stage?: ShopStage;
  /** Lifecycle ownership; post-Boss Shops remain in the completed Chapter until NEXT_CHAPTER. */
  kind?: 'between_rounds' | 'post_boss';
  /** False only during the one-second progression lock for this concrete Shop entry. */
  exitUnlocked?: boolean;
  offers: DiceOffer[];
  /** Frozen when this semantic Shop visit is created and retained through navigation/Bust restoration. */
  trainingSession?: FrozenTrainingSession;
  offerRerolls: number;
  lifeRestores: number;
  /** On The House: the first collectible-die purchase in this visit costs no Gold. */
  freeDicePurchaseAvailable?: boolean;
  /** Persisted within a semantic Shop visit so tab navigation/reload does not lose Forge work. */
  forgeSelection?: ForgeSelection;
}
export interface FlameOffer { id: number; flame: Flame }
export interface FlameSelection { offers: FlameOffer[]; acquired: boolean }
export type SpecialOfferType = 'onTheHouse' | 'greatFairy' | 'focus' | 'timeTravel' | 'carePackage'
  | 'silence' | 'taxEvasion' | 'fireKeeper' | 'bottledFairy' | 'badDream' | 'teamTraining';
export interface SpecialOffer { id: number; type: SpecialOfferType; hand?: HandId }
export interface SpecialOfferSelection { offers: SpecialOffer[]; acquired: boolean; chosen?: SpecialOffer }
export interface ChapterLifecycleState {
  /** The post-R3 reward for this Chapter has already been selected. */
  specialOfferConsumed: boolean;
}
export interface SpecialOfferEffects {
  onTheHouse: boolean;
  carePackageRerolls: number;
  silence: boolean;
  taxEvasionRounds: number;
  bottledFairyRounds: number;
  bottledFairyTriggeredThisRound: boolean;
  badDreamRounds: number;
}

export type ChallengeId = 'fiveAlive' | 'theLongWay' | 'upperClass' | 'lowerClass' | 'varietyPack'
  | 'closeCall' | 'noTakebacks' | 'upperManagement' | 'rollCall' | 'lowProfile' | 'oppositesAttract'
  | 'beanSalad' | 'bonusRound' | 'goldRush' | 'agedToPerfection' | 'magneticPersonality'
  | 'jackpot' | 'getYourRepsIn' | 'fullyLoaded';
export interface BadDreamCheckpoint {
  chapter: number;
}
export type InfernoTrend = 'first' | 'improving' | 'worsening' | 'stable';
export type InfernoWeakness = 'quantity' | 'investment' | 'utilization' | 'close';
export type InfernoRecentAction = 'flame_acquired' | 'flame_invested' | 'bonfire_created' | 'flame_removed'
  | 'contribution_improved' | 'contribution_declined' | 'none';
export interface InfernoProgressState {
  evaluationIndex: number;
  previousReadiness: number | null;
  recentMessageIds: string[];
  recentAction: InfernoRecentAction;
}
export interface InfernoFlameDiagnostic {
  asset: EngulfmentAssetRef;
  status: 'ember' | 'bonfire';
  investment: number;
  hiddenStrength: number;
}
export interface InfernoPrefixEvaluation {
  flameInstanceIds: FlameInstanceId[];
  effectiveValue: number;
  success: boolean;
}
export interface InfernoEvaluationState {
  evaluationIndex: number;
  round: number;
  chapter: number;
  flames: InfernoFlameDiagnostic[];
  evidenceRounds: { round: number; attempt: number; timelineId: number; handCount: number; multiplier: number }[];
  effectiveValue: number;
  threshold: number;
  readiness: number;
  /** Diagnostic upper bound expressed in the evaluator's multiplier units. */
  maximumPossibleReadiness: number;
  currentCollectionTheoreticallySufficient: boolean;
  suspendAfterContinue: boolean;
  previousReadiness: number | null;
  trend: InfernoTrend;
  weakness: InfernoWeakness;
  recentAction: InfernoRecentAction;
  feedbackMessageId: string | null;
  feedbackMessage: string | null;
  /** True only after the player accepts this frozen ready evaluation. */
  engulfed: boolean;
  success: boolean;
  strongestFirst: EngulfmentAssetRef[];
  prefixEvaluations: InfernoPrefixEvaluation[];
  flamesSnuffed: EngulfmentAssetRef[];
  flamesPreserved: EngulfmentAssetRef[];
  selectedEffectiveValue: number | null;
  infernoLevelBefore: number;
  infernoLevelAfter: number;
  infernoMultiplierBefore: ExactScore;
  infernoMultiplierAfter: ExactScore;
  upper: { levelsBefore: { hand: HandId; level: number }[]; average: number; unifiedLevel: number };
  lower: { levelsBefore: { hand: HandId; level: number }[]; average: number; unifiedLevel: number };
  consumedFinalFlame: boolean;
}
export interface RoundPayout {
  baseGold: number;
  unusedRerollGold: number;
  interestGold: number;
  bossRewardGold: number;
  heldGoldSnapshot: number;
  totalRoundRewardGold: number;
}
export interface RoundSummaryGoldSources {
  baseRewardGold: number;
  unusedRerollGold: number;
  interestGold: number;
  bossRewardGold: number;
  goldenGold: number;
  jackpotGold: number;
  otherGold: number;
}
export interface RoundSummary {
  round: number;
  encounterType: 'normal' | 'boss';
  bossType: BossType | null;
  score: ExactScore;
  target: ExactScore;
  goldBefore: number;
  goldAfter: number;
  totalGoldEarned: number;
  sources: RoundSummaryGoldSources;
  temper: {
    overkill: number;
    boardRefresh: number;
    miniBoss: number;
    boss: number;
    total: number;
  };
}
export interface Board {
  phase: Phase;
  round: number;
  target: ExactScore;
  score: ExactScore;
  gold: number;
  temper: number;
  /** Permanently enabled after the first positive Temper award in this run. */
  forgeUnlocked: boolean;
  /** Attempt-local Temper; restored with the Round checkpoint and committed to telemetry only on clear. */
  roundTemper: RoundTemperState;
  lives: number;
  /** Permanent in-run prestige level. Its multiplier is always derived as 25^level. */
  engulfmentLevel: number;
  /** Allocates semantic Shop visit identities; included in build-state rollback snapshots. */
  nextShopVisitId: number;
  /** Allocates stable identities for individual Flame lifecycles. */
  nextFlameInstanceId: number;
  roundAttemptNumber: number;
  bossSchedule: Partial<Record<number, BossType>>;
  chapterPlans: Partial<Record<number, ChapterPlan>>;
  presentedChapters: number[];
  chapterLifecycle: Partial<Record<number, ChapterLifecycleState>>;
  boss: BossRuntimeState | null;
  bossSilenced: boolean;
  currentNodeId: string;
  bust: BustSummary | null;
  /** Playback-only terminal dice. Never used as authoritative gameplay state. */
  bustPresentationDice: Die[] | null;
  flameTutorial: { pendingFlameInstanceId: FlameInstanceId | null; completed: boolean };
  manualRerollsRemaining: number;
  specialOfferEffects: SpecialOfferEffects;
  /**
   * Active encounter reference projection in Roster order. Player entries alias the
   * authoritative inventory instances; array membership and order never establish ownership.
   */
  dice: Die[];
  /** Round-attempt resources for equipped collectible dice, keyed by stable die ID. */
  dieRoundState: DieRoundState;
  /** The sole authoritative live Flame inventory. Slots never compact implicitly. */
  flameSlots: FlameSlots;
  /** Charge gained by each stable Flame instance. */
  chargeAttribution: Partial<Record<FlameInstanceId, number>>;
  infernoProgress: InfernoProgressState;
  infernoEvaluation: InfernoEvaluationState | null;
  infernoEvaluationSuspendedUntilNewFlame: boolean;
  chargeXMult: number;
  maxCharge: number;
  chargeArmed: boolean;
  decisionId: number;
  sixPackXMult: number;
  sixPackUpperHandsPlayed: number;
  hotStreakGoal: HandId | null;
  hotStreakCharges: number;
  handFamilyFlameStages: Partial<Record<Flame, HandFamilyFlameStage>>;
  lifetimeNormalShopGoldSpent: number;
  consumed: HandId[];
  /** Hands normally consumed since the current Round's last scorecard refresh. */
  scorecardCycleConsumed: HandId[];
  scoreByHand: Partial<Record<HandId, ExactScore>>;
  effectScore: ExactScore;
  handLevels: HandLevels;
  handPlayCounts: Record<HandId, number>;
  targetPracticeHand: HandId | null;
  fetchTarget: { dieId: number; physicalFace: Rank } | null;
  lastRoundPayout: RoundPayout | null;
  roundSummary: RoundSummary | null;
  shop: Shop | null;
  flameSelection: FlameSelection | null;
  specialOffer: SpecialOfferSelection | null;
}
export interface RoundStats {
  round: number;
  attempt: number;
  target: ExactScore;
  firstCrossedScore: ExactScore | null;
  finalScore: ExactScore;
  clearMargin: ExactScore | null;
  cleared: boolean;
  lastHand: HandId | null;
  lastAction: 'PLAY' | 'MANUAL_REROLL' | 'JUMPING_BEAN' | null;
  manualRerollsGranted: number;
  manualRerollChargesSpent: number;
  manualRerollsRemainingAtClear: number | null;
  manualRerollActions: number;
  deadBoardRescues: number;
  scoreByHand: Partial<Record<HandId, ExactScore>>;
  effectScore: ExactScore;
  goldBefore: number;
  goldBySourceBefore: Record<GoldSource, number>;
  payout: RoundPayout | null;
}
export interface ManualRerollStats {
  round: number;
  dieIds: number[];
  charges: number;
  remaining: number;
  startedDeadBoard: boolean;
  rescuedDeadBoard: boolean;
}
export interface RoundSummaryRecord extends RoundSummary {
  shown: boolean;
}
export interface BustRecord {
  round: number; attempt: number; score: ExactScore; target: ExactScore; shortfall: ExactScore;
  livesBefore: number; livesAfter: number; checkpointRestored: boolean; returnedToShop: boolean;
  retryStarted: boolean; runEndedNoLives: boolean;
}
export interface MapTransitionRecord {
  fromNode: string | null;
  toNode: string;
  nodeType: RunNodeType;
  round: number;
  boss?: BossType;
  direction: 'forward' | 'backward';
}
export interface BossEncounterRecord {
  boss: BossType;
  round: number;
  attempt: number;
  started: boolean;
  cleared: boolean;
  busted: boolean;
  calledHand?: HandId;
  callerManualPlays?: number;
  callerSatisfied?: boolean;
  callerSatisfyingSource?: HandPlaySource | null;
  wardenUnlockTargets?: ExactScore[];
  wardenStartingDieId?: number | null;
  wardenActiveDiceAtEnd?: number;
}
export interface CallerEventRecord {
  round: number; attempt: number; calledHand: HandId; playsRemaining: number;
  satisfied: boolean; source: HandPlaySource; expired: boolean;
}
export interface WardenEventRecord {
  round: number; attempt: number; kind: 'starting_die' | 'target' | 'reinforcement';
  threshold?: ExactScore; dieId?: number; activeDice: number;
}
export interface HexerEventRecord {
  round: number; attempt: number;
  kind: 'roll' | 'manual_reroll' | 'hand' | 'jumping_bean' | 'workout' | 'seven';
  face?: Rank; hand?: HandId; amount?: number;
}
export interface LifeRestorePurchase {
  round: number; purchaseNumber: number; cost: number; goldBefore: number; goldAfter: number;
  livesBefore: number; livesAfter: number; lifetimeSpendBefore: number; lifetimeSpendAfter: number;
}
export interface TrainingPurchase {
  round: number;
  hand: HandId | 'all';
  fromLevel?: number;
  toLevel?: number;
  cost: number;
  shopVisitId?: number;
  family?: 'upper' | 'lower';
  frozenBaseline?: number;
  relativeTier?: number;
  normalPrice?: number | null;
  waivedByOnTheHouse?: boolean;
  purchaseCount?: number;
}
export interface FlameAcquisition {
  round: number; slot: FlameSlotIndex; instanceId: FlameInstanceId; flame: Flame;
  replaced: { instanceId: FlameInstanceId; flame: Flame; stage: FlameStage; investedGold: number } | null;
}
export type FlameStokeSource = 'flame_selection' | 'shop';
export interface FlameStoke {
  round: number;
  slot: FlameSlotIndex;
  instanceId: FlameInstanceId;
  flame: Flame;
  amount: number;
  from: number;
  total: number;
  source: FlameStokeSource;
}
export interface JumpingBeanPlayRecord {
  round: number;
  dieId: number;
  face: Rank;
  hand: HandId;
  handLevel: number;
  basePips: number;
  baseMultiplier: number;
  score: ExactScore;
  xMultFactors: XMultFactor[];
  previousPlayCount: number;
  handPlayCountAfter: number;
  consumedHand: false;
  followupRerolled: boolean;
  roundCleared: boolean;
  jackpotPayout: number;
}
export interface TemperTransaction {
  round: number;
  shopVisitId: number | null;
  kind: 'earned' | 'spent';
  source: TemperSource | TemperSpendSource;
  amount: number;
  balance: number;
}
export interface RunStats {
  seed: string;
  roundReached: number;
  rounds: RoundStats[];
  busts: BustRecord[];
  mapTransitions: MapTransitionRecord[];
  bossEncounters: BossEncounterRecord[];
  callerEvents: CallerEventRecord[];
  wardenEvents: WardenEventRecord[];
  hexerEvents: HexerEventRecord[];
  lifeRestores: LifeRestorePurchase[];
  trainingPurchases: TrainingPurchase[];
  trainingPurchasesTotal: number;
  trainingGoldSpent: number;
  flameAcquisitions: FlameAcquisition[];
  flameStokes: FlameStoke[];
  totalFlameInvestment: number;
  flameTriggers: Partial<Record<Flame, number>>;
  chargeGained: number;
  chargeArmed: number;
  chargeConsumed: number;
  chargeResets: number;
  hotStreakCharges: number;
  hotStreakSkippedHands: { round: number; hand: HandId }[];
  lifetimeNormalShopGoldSpent: number;
  diceOfferRerolls: number;
  manualRerollActions: number;
  manualDiceRerolled: number;
  manualRerolls: ManualRerollStats[];
  deadBoardRescues: number;
  goldEarned: number;
  goldBySource: Record<GoldSource, number>;
  goldSpent: number;
  goldSpentBySource: Record<GoldSpendSource, number>;
  temperEarned: number;
  temperSpent: number;
  temperBySource: Record<TemperSource, number>;
  temperSpentBySource: Record<TemperSpendSource, number>;
  temperTransactions: TemperTransaction[];
  fusions: number;
  forges: number;
  highestEffectCount: number;
  highestForgeRating: string;
  mostValuableDieSold: number;
  scoreBySource: Record<ScoreSource, ExactScore>;
  handScores: HandScoreRecord[];
  jumpingBeanFreePlays: JumpingBeanPlayRecord[];
  standaloneScores: StandaloneScoreRecord[];
  handBonusPips: number;
  hitchhikerPipsContributed: number;
  loss: null | { round: number; afterHand: HandId | null; afterAction: 'PLAY' | 'MANUAL_REROLL' | 'JUMPING_BEAN' | null;
    score: ExactScore; values: Rank[]; consumed: HandId[]; manualRerollsRemaining: number };
  resolutionError: string | null;
}
export type EventType =
  | 'CHAPTER_STARTED' | 'MAP_TRANSITION' | 'ROUND_STARTED' | 'BOSS_STARTED' | 'BOSS_CLEARED' | 'HAND_STARTED' | 'ABILITY_EVALUATED'
  | 'HAND_PIPS_CHANGED' | 'HAND_MULTIPLIER_CHANGED' | 'HITCHHIKER_ADDED_PIPS'
  | 'HAND_SCORE_FINALIZED' | 'STANDALONE_SCORE_CALCULATED' | 'SCORE_ROUNDING_AUDIT'
  | 'SCORE_ADDED' | 'GOLD_ADDED'
  | 'DICE_REROLL_STARTED' | 'DIE_ROLLED' | 'DIE_FLIPPED' | 'HAND_CONSUMED' | 'SCORECARD_REFRESHED' | 'ROUND_CLEARED'
  | 'ROUND_SUMMARY_SHOWN'
  | 'SHOP_OPENED' | 'TRAINING_PURCHASED' | 'OFFERS_REFRESHED' | 'GOLD_SPENT'
  | 'FLAME_SELECTION_OPENED' | 'FLAME_OFFERS_REFRESHED' | 'FLAME_ACQUIRED' | 'FLAME_REPLACED'
  | 'SPECIAL_OFFER_OPENED' | 'SPECIAL_OFFER_SELECTED' | 'SPECIAL_EFFECT_TRIGGERED'
  | 'SPECIAL_OFFER_SKIPPED'
  | 'FLAME_SKIPPED' | 'FLAME_INVESTED' | 'BONFIRE_CREATED' | 'FLAME_TRIGGERED' | 'HAND_XMULT_CHANGED'
  | 'TARGET_PRACTICE_SELECTED' | 'CHARGE_CHANGED' | 'CHARGE_ARMED' | 'HOT_STREAK_CHANGED'
  | 'SPEED_DEMON_REVEALED' | 'SIX_PACK_CHANGED'
  | 'FETCH_TARGET_CHANGED'
  | 'JUMPING_BEAN_FREE_PLAY' | 'JUMPING_BEAN_FOLLOWUP'
  | 'ROUND_BUST' | 'SHOP_REOPENED_AFTER_BUST' | 'ROUND_RETRY_STARTED' | 'LIFE_RESTORED' | 'FLAME_TUTORIAL_COMPLETED'
  | 'CALLER_CALLED' | 'CALLER_CHANGED' | 'WARDEN_UNLOCK_TARGET' | 'WARDEN_REINFORCEMENT' | 'CURSED_DIE_ROLLED'
  | 'BOSS_HAND_CHANGED' | 'BOSS_FACE_CHANGED'
  | 'RUN_LOST' | 'RESOLUTION_ERROR' | 'MANUAL_REROLL_STARTED' | 'DEAD_BOARD' | 'DEAD_BOARD_RESCUED'
  | 'TUTORIAL_SAFEGUARD' | 'INFERNO_EVALUATED' | 'SPECIAL_DIE_EFFECT' | 'TEMPER_CHANGED' | 'DICE_FORGED';
export interface EventRecord {
  id: number;
  round: number;
  type: EventType;
  message: string;
  dieIds?: number[];
  flame?: Flame;
  boss?: BossType;
  hands?: HandId[];
  bossState?: string;
  fromNode?: string | null;
  toNode?: string;
  nodeType?: RunNodeType;
  direction?: 'forward' | 'backward';
  chapterNumber?: number;
  chapterMiniBoss?: MiniBossType;
  chapterBoss?: BigBossType;
  hand?: HandId;
  playSource?: HandPlaySource;
  handConsumed?: boolean;
  pips?: number;
  multiplier?: number;
  xMult?: number;
  xMultFactor?: XMultFactor;
  rawScore?: ExactDecimal;
  amount?: number | ExactScore;
  source?: ScoreSource;
  goldSource?: GoldSource;
  goldSpendSource?: GoldSpendSource;
  rarity?: DiceRarity;
  dieType?: DieType;
  dieLevel?: number;
  effectInstanceId?: DieEffectInstanceId;
  temperSource?: TemperSource;
  temperSpendSource?: TemperSpendSource;
  temperBalance?: number;
  invocationBefore?: number;
  invocationAfter?: number;
  effectCause?: string;
  offerSet?: { name: string; rarity: DiceRarity }[];
  face?: Rank;
  rollSource?: 'manual_reroll' | 'automatic';
  rollReason?: RollReason;
  previousFace?: Rank;
  resultFace?: Rank;
  sameFaceExcluded?: boolean;
  roundSummary?: RoundSummary;
  encounterType?: 'normal' | 'boss';
  goldBefore?: number;
  goldAfter?: number;
  goldEarnedTotal?: number;
  baseRewardGold?: number;
  unusedRerollGold?: number;
  interestGold?: number;
  bossRewardGold?: number;
  goldenGold?: number;
  jackpotGold?: number;
  decisionMs?: number;
  terminalDice?: { dieId: number; physicalFace: Rank; face: Rank; pips: number }[];
  bustPresentationUsedFrozenDice?: boolean;
  handScore?: HandScoreAccumulator;
}
export interface GameEvent extends EventRecord { board: Board }
export interface BustSummary {
  round: number;
  attempt: number;
  score: ExactScore;
  target: ExactScore;
  shortfall: ExactScore;
  livesBefore: number;
  livesAfter: number;
}
export interface GameStateBase extends Board {
  /** Authoritative owned-die collection. Board.dice is only the active encounter reference projection. */
  diceInventory: DiceInventory;
  /** Temporary, non-owned dice created by the current encounter. */
  encounterDice: EncounterDie[];
  seed: string;
  rngState: number;
  nextOfferId: number;
  nextPlaybackEventId: number;
  stats: RunStats;
  actionJournal: Action[];
  history: EventRecord[];
  historyV2: RunHistoryV2Event[];
  historyV2TimelineId: number;
  historyV2Coverage: RunHistoryV2Coverage;
  debugTrace: DebugTraceState;
}
export interface RollbackState {
  board: Board;
  diceInventory: DiceInventory;
  encounterDice: EncounterDie[];
  rngState: number;
  nextOfferId: number;
}
export interface GameState extends GameStateBase {
  roundCheckpoint: RollbackState | null;
  badDreamCheckpoint: BadDreamCheckpoint | null;
}
export interface EngulfmentAssetRef {
  kind: FlameStage;
  flame: Flame;
  instanceId: FlameInstanceId;
  slot: FlameSlotIndex;
}
export type Action =
  | { type: 'PLAY'; hand: HandId; dieIds: number[]; decisionMs?: number;
      qualificationClaims?: { dieId: DieId; effect: 'mirror' | 'missingLink' | 'conjoined'; effectInstanceId?: string }[] }
  | { type: 'MANUAL_REROLL'; dieIds: number[] }
  | { type: 'INVOKE_CHAMELEON'; dieId: DieId }
  | { type: 'INVOKE_FLYWHEEL'; dieId: DieId }
  | { type: 'ARM_MAGIC'; dieId: DieId; face: Exclude<Rank, 7> }
  | { type: 'DISARM_MAGIC'; dieId: DieId }
  | { type: 'FEED_FURNACE'; dieId: DieId; amount: number }
  | { type: 'SET_DIE_EFFECT_NUMBER'; dieId: DieId; effect: 'weighted' | 'jumpingBean'; number: Exclude<Rank, 7> }
  | { type: 'UNLOCK_WARDEN_DIE'; dieId: number }
  | { type: 'TOGGLE_CHARGE'; hand?: HandId | null; dieIds?: number[] }
  | { type: 'BUY_DIE'; offerId: number }
  | { type: 'MOVE_DIE'; source: DiceSlotRef; destination: DiceSlotRef;
      expectedSourceDieId: DieId; expectedDestinationDieId: DieId | null }
  | { type: 'SET_FORGE_INGREDIENT'; socket: 'A' | 'B'; dieId: DieId | null }
  | { type: 'CONFIRM_FORGE'; destination?: DiceSlotRef }
  | { type: 'SELL_DIE'; slot: DiceSlotRef; expectedDieId: DieId }
  | { type: 'TRAIN_HAND'; hand: HandId }
  | { type: 'CHOOSE_FLAME'; offerId: number; replaceSlot?: FlameSlotIndex }
  | { type: 'STOKE_FLAME'; flameInstanceId: FlameInstanceId; amount: number }
  | { type: 'CONTINUE_ROUND_SUMMARY' }
  | { type: 'CONTINUE_INFERNO_EVALUATION' }
  | { type: 'ENGULF_NOW' }
  | { type: 'NOT_YET' }
  | { type: 'CONTINUE_FLAME_SELECTION' }
  | { type: 'SKIP_FLAME_SELECTION' }
  | { type: 'CHOOSE_SPECIAL_OFFER'; offerId: number }
  | { type: 'CONTINUE_SPECIAL_OFFER' }
  | { type: 'SKIP_SPECIAL_OFFER' }
  | { type: 'RESTORE_LIFE' }
  | { type: 'DISMISS_FLAME_TUTORIAL' }
  | { type: 'RETRY_ROUND' }
  | { type: 'RETREAT' }
  | { type: 'REROLL_OFFERS' }
  | { type: 'SET_SHOP_STAGE'; stage: ShopStage }
  | { type: 'UNLOCK_SHOP_EXIT' }
  | { type: 'NEXT_CHAPTER' }
  | { type: 'NEXT_ROUND' };
export interface Resolution { state: GameState; events: GameEvent[]; error?: string }
export interface RandomSource { next(): number }
export interface HandOption { id: HandId; combinations: number[][]; consumed: boolean }
