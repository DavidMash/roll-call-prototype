import type { RollReason, RunHistoryV2Coverage, RunHistoryV2Event } from './runHistoryV2';
import type { DebugTraceState } from './debugTrace';
import type { ExactDecimal, ExactScore } from './scoreMath';

export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Rarity = 'common' | 'uncommon' | 'rare';
export type BigBossType = 'caller' | 'warden' | 'hexer' | 'marathon' | 'quickdraw' | 'fly' | 'snakeEyes' | 'infected';
export type MiniBossType = 'juggler' | 'capitalReturn' | 'neglected' | 'clockmaker'
  | 'tightrope' | 'crawler' | 'magician' | 'mugger';
export type BossType = BigBossType | MiniBossType;
export interface ChapterPlan {
  chapterNumber: number;
  miniBoss: MiniBossType;
  boss: BigBossType;
}
export type RunNodeType = 'normal_round' | 'mini_boss_round' | 'boss_round' | 'shop' | 'flame_selection' | 'special_offer';
export type Enhancement =
  | 'bonus' | 'jumpingBean' | 'golden' | 'workout'
  | 'missingLink' | 'mirror' | 'magnetic' | 'boomerang' | 'sticky' | 'slippy'
  | 'hitchhiker' | 'weighted' | 'jackpot' | 'personalTrainer' | 'bump' | 'vintage'
  | 'teamwork' | 'loneWolf' | 'doubleTime' | 'tank' | 'freePlay'
  | 'shifter' | 'flywheel' | 'holiday' | 'magic' | 'conjoined' | 'furnace' | 'sustainable';
export type Flame =
  | 'ultimate' | 'minigun' | 'hailMary' | 'fullOfGrace'
  | 'momentum' | 'thirdRail' | 'jumpStart' | 'powerSurge'
  | 'speedDemon' | 'sixPack' | 'fluxCapacitor'
  | 'fatCat' | 'vineyard' | 'fetch' | 'targetPractice'
  | 'hotStreak' | 'lowball' | 'straightShooter' | 'doubleDown'
  | 'threesCompany' | 'boxSet' | 'missingPair' | 'oneShort';
export type FlameInstanceId = number;
export type DieId = number;
export type DieType = 'normal';
export type HandId =
  | 'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes'
  | 'pair' | 'twoPair' | 'threeKind' | 'fullHouse' | 'fourKind' | 'fiveKind' | 'smallStraight' | 'largeStraight';
export type Phase = 'round' | 'roundSummary' | 'inferno' | 'bust' | 'flameSelection' | 'specialOffer' | 'shop' | 'lost' | 'error';
export type ScoreSource = 'hand' | 'jumpingBean' | 'hitchhiker' | 'boss';
export type HandPlaySource = 'manual' | 'jumpingBean' | 'freePlay';
export type GoldSource = 'golden' | 'jackpot' | 'enhancementSale' | 'roundBase' | 'unusedRerolls' | 'interest' | 'bossReward' | 'specialOffer' | 'cashBonus';
export type GoldSpendSource = 'enhancement' | 'shopDiceReroll' | 'enhancementReroll' | 'handTraining' | 'flameInvestment' | 'lifeRestore';
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
export interface FlyBossState { type: 'fly'; flyHand: HandId | null; caught: boolean; moves: number }
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
export interface ClockmakerBossState { type: 'clockmaker' }
export interface TightropeBossState { type: 'tightrope' }
export interface CrawlerBossState { type: 'crawler' }
export interface MagicianBossState {
  type: 'magician';
  missingDieId: number | null;
  hiddenFlame: ActiveFlame | null;
  calledHands: HandId[];
  completedHands: HandId[];
  returned: boolean;
}
export interface MuggerBossState { type: 'mugger'; hiddenHand: HandId; revealedHand: HandId | null; spent: boolean }
export type BossRuntimeState = CallerBossState | WardenBossState | HexerBossState | MarathonBossState
  | QuickdrawBossState | FlyBossState | SnakeEyesBossState | InfectedBossState
  | JugglerBossState | CapitalReturnBossState | NeglectedBossState | ClockmakerBossState
  | TightropeBossState | CrawlerBossState | MagicianBossState | MuggerBossState;

export interface XMultFactor {
  source: Flame | 'charge';
  value: number;
  dieId: number | null;
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

export interface Face {
  rank: Rank;
  workoutPips: number;
  enhancements: Partial<Record<Enhancement, number>>;
  weightedTarget?: Rank;
  /** Base accrued Vintage value. Sommelier is applied separately at sale/display time. */
  vintageSellValue?: number;
  vintageSommelierBoosted?: boolean;
  snakeEyed?: boolean;
  infected?: boolean;
  snakeEyesOriginalRank?: Rank;
  magneticSourceUsed?: boolean;
  /** Original value while Shifter has temporarily changed this physical face. */
  shifterBaseRank?: Rank;
  /** Persistent per-instance Furnace factor. */
  furnaceMultiplier?: number;
  /** Round-local charges; persisted only to support mid-Round resume. */
  flywheelCharges?: number;
  sustainableCharges?: number;
}
export interface ActiveFlame { id: Flame; investedGold: number }
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
interface PhysicalDieState { id: DieId; value: Rank; faces: Face[]; flame: ActiveFlame | null }
export interface CollectibleDie extends PhysicalDieState {
  owner: 'player';
  type: DieType;
  level: number;
}
export interface EncounterDie extends PhysicalDieState {
  owner: 'boss';
  encounterId: string;
}
export type Die = CollectibleDie | EncounterDie;
export type RosterSlots = [DieId | null, DieId | null, DieId | null, DieId | null, DieId | null];
export interface DiceInventory {
  instances: Record<DieId, CollectibleDie>;
  roster: RosterSlots;
  storage: Array<DieId | null>;
  nextDieId: number;
  /** Chapter numbers whose one-time completion slot has already been granted. */
  storageAwardedChapters: number[];
}
export interface Offer { id: number; enhancement: Enhancement; purchased: boolean }
export interface HandTrainingOffer { kind: 'hand'; hand: HandId; purchases: number }
export interface TeamTrainingOffer { kind: 'team'; purchases: number }
export type TrainingOffer = HandTrainingOffer | TeamTrainingOffer;
export interface Shop {
  /** Monotonic identity for one semantic Shop visit, including Bust/Bad Dream returns. */
  visitId?: number;
  /** Lifecycle ownership; post-Boss Shops remain in the completed Chapter until NEXT_CHAPTER. */
  kind?: 'between_rounds' | 'post_boss';
  /** False only during the one-second progression lock for this concrete Shop entry. */
  exitUnlocked?: boolean;
  offers: Offer[];
  trainingOffers: TrainingOffer[];
  diceRerolls: number;
  offerRerolls: number;
  lifeRestores: number;
  freeEnhancementOfferIds?: number[];
  freeTrainingOfferKeys?: string[];
}
export interface FlameOffer { id: number; flame: Flame }
export interface FlameSelection { offers: FlameOffer[]; acquired: boolean }
export type SpecialOfferType = 'onTheHouse' | 'greatFairy' | 'focus' | 'timeTravel' | 'carePackage'
  | 'silence' | 'sommelier' | 'taxEvasion' | 'fireKeeper' | 'cashBonus' | 'orangeTheory'
  | 'powerball' | 'bottledFairy' | 'badDream' | 'semester';
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
  cashBonusRounds: number;
  powerballRounds: number;
  powerballAvailable: boolean;
  bottledFairyRounds: number;
  bottledFairyTriggeredThisRound: boolean;
  badDreamRounds: number;
  semesterShopsRemaining: number;
}

export type ChallengeId = 'fiveAlive' | 'theLongWay' | 'upperClass' | 'lowerClass' | 'varietyPack'
  | 'closeCall' | 'noTakebacks' | 'upperManagement' | 'rollCall' | 'lowProfile' | 'oppositesAttract'
  | 'beanSalad' | 'bonusRound' | 'goldRush' | 'agedToPerfection' | 'magneticPersonality'
  | 'jackpot' | 'getYourRepsIn' | 'fullyLoaded';
/** Historical Run History V2 parsing only. New gameplay never creates Wildfires. */
export type WildfireResolved =
  | { kind: 'xMult'; baseMax: number; max: number }
  | { kind: 'charge'; gain?: number; ratio?: number; coefficient?: number; maxCharge: number };
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
}
export interface Board {
  phase: Phase;
  round: number;
  target: ExactScore;
  score: ExactScore;
  gold: number;
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
  flameTutorial: { pendingDieId: number | null; completed: boolean };
  manualRerollsRemaining: number;
  specialOfferEffects: SpecialOfferEffects;
  /** Legacy save-migration input; current runs use chapterLifecycle. */
  suppressedPostBossRewardRounds: number[];
  /** Derived active encounter projection in Roster order; never collection authority. */
  dice: Die[];
  bonfires: Flame[];
  /** Current owned instance for each Flame type, preserved across Ember/Bonfire progression. */
  flameInstanceIds: Partial<Record<Flame, FlameInstanceId>>;
  chargeAttribution: Partial<Record<Flame, number>>;
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
export interface Purchase { round: number; enhancement: Enhancement; dieId: number; face: Rank; cost: number; stacksApplied?: number }
export interface EnhancementSale {
  round: number; enhancement: Enhancement; dieId: number; face: Rank; stacksSold: number;
  baseSellPrice: number; totalProceeds: number; goldBefore: number; goldAfter: number;
  vintageSellValue?: number;
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
  kind: 'roll' | 'manual_reroll' | 'hand' | 'jumping_bean' | 'workout' | 'seven' | 'jackpot' | 'sticky';
  face?: Rank; hand?: HandId; amount?: number;
}
export interface LifeRestorePurchase {
  round: number; purchaseNumber: number; cost: number; goldBefore: number; goldAfter: number;
  livesBefore: number; livesAfter: number; lifetimeSpendBefore: number; lifetimeSpendAfter: number;
}
export interface VintageGrowthRecord {
  round: number; attempt: number; dieId: number; face: Rank; hand: HandId; playSource: HandPlaySource;
  participation: 'selected' | 'hitchhiker'; from: number; to: number;
}
export interface TrainingPurchase {
  round: number;
  hand: HandId | 'all';
  fromLevel?: number;
  toLevel?: number;
  cost: number;
}
export interface FlameAcquisition { round: number; dieId: number; flame: Flame; replaced: Flame | null }
export type FlameStokeSource = 'flame_selection' | 'shop';
export interface FlameStoke {
  round: number;
  dieId: number;
  flame: Flame;
  amount: number;
  from: number;
  total: number;
  source: FlameStokeSource;
}
export interface ProbabilityProcStats { checks: number; successes: number; failures: number; stacksAtCheck: number[] }
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
  stickyPreventedReroll: boolean;
  followupRerolled: boolean;
  roundCleared: boolean;
  jackpotPayout: number;
  personalTrainerSucceeded: boolean | null;
}
export interface RunStats {
  seed: string;
  roundReached: number;
  rounds: RoundStats[];
  purchases: Purchase[];
  sales: EnhancementSale[];
  busts: BustRecord[];
  mapTransitions: MapTransitionRecord[];
  bossEncounters: BossEncounterRecord[];
  callerEvents: CallerEventRecord[];
  wardenEvents: WardenEventRecord[];
  hexerEvents: HexerEventRecord[];
  lifeRestores: LifeRestorePurchase[];
  vintageGrowth: VintageGrowthRecord[];
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
  personalTrainerAttempts: number;
  personalTrainerSuccesses: number;
  personalTrainerLevelsGranted: number;
  hotStreakCharges: number;
  hotStreakSkippedHands: { round: number; hand: HandId }[];
  lifetimeNormalShopGoldSpent: number;
  magneticAnchorBatches: number;
  magneticAttractions: number;
  bumpControlledRolls: number;
  enhancedFaces: string[];
  enhancementShopRerolls: number;
  shopDiceRerolls: number;
  manualRerollActions: number;
  manualDiceRerolled: number;
  manualRerolls: ManualRerollStats[];
  deadBoardRescues: number;
  goldEarned: number;
  goldBySource: Record<GoldSource, number>;
  goldSpent: number;
  goldSpentBySource: Record<GoldSpendSource, number>;
  triggers: Partial<Record<Enhancement, number>>;
  probabilityProcs: Record<'boomerang' | 'holiday' | 'hitchhiker' | 'personalTrainer' | 'doubleTime' | 'sticky', ProbabilityProcStats>;
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
  | 'CHAPTER_STARTED' | 'MAP_TRANSITION' | 'ROUND_STARTED' | 'BOSS_STARTED' | 'BOSS_CLEARED' | 'HAND_STARTED' | 'ABILITY_TRIGGERED' | 'ABILITY_CHECKED' | 'ABILITY_EVALUATED'
  | 'HAND_PIPS_CHANGED' | 'HAND_MULTIPLIER_CHANGED' | 'HITCHHIKER_ADDED_PIPS'
  | 'HAND_SCORE_FINALIZED' | 'STANDALONE_SCORE_CALCULATED' | 'SCORE_ROUNDING_AUDIT'
  | 'SCORE_ADDED' | 'GOLD_ADDED' | 'WORKOUT_INCREMENTED'
  | 'DICE_REROLL_STARTED' | 'DIE_ROLLED' | 'DIE_FLIPPED' | 'HAND_CONSUMED' | 'SCORECARD_REFRESHED' | 'ROUND_CLEARED'
  | 'ROUND_SUMMARY_SHOWN'
  | 'SHOP_OPENED' | 'OFFER_PURCHASED' | 'TRAINING_PURCHASED' | 'OFFERS_REFRESHED' | 'GOLD_SPENT'
  | 'FLAME_SELECTION_OPENED' | 'FLAME_OFFERS_REFRESHED' | 'FLAME_ACQUIRED' | 'FLAME_REPLACED'
  | 'SPECIAL_OFFER_OPENED' | 'SPECIAL_OFFER_SELECTED' | 'SPECIAL_EFFECT_TRIGGERED'
  | 'SPECIAL_OFFER_SKIPPED'
  | 'FLAME_SKIPPED' | 'FLAME_INVESTED' | 'BONFIRE_CREATED' | 'FLAME_TRIGGERED' | 'HAND_XMULT_CHANGED'
  | 'TARGET_PRACTICE_SELECTED' | 'CHARGE_CHANGED' | 'CHARGE_ARMED' | 'HOT_STREAK_CHANGED'
  | 'SPEED_DEMON_REVEALED' | 'SIX_PACK_CHANGED'
  | 'FETCH_TARGET_CHANGED'
  | 'ENHANCEMENT_SOLD' | 'VINTAGE_GROWN' | 'MAGNETIC_ATTRACTION' | 'BUMP_ROLL'
  | 'JUMPING_BEAN_FREE_PLAY' | 'JUMPING_BEAN_FOLLOWUP'
  | 'ROUND_BUST' | 'SHOP_REOPENED_AFTER_BUST' | 'ROUND_RETRY_STARTED' | 'LIFE_RESTORED' | 'FLAME_TUTORIAL_COMPLETED'
  | 'CALLER_CALLED' | 'CALLER_CHANGED' | 'WARDEN_UNLOCK_TARGET' | 'WARDEN_REINFORCEMENT' | 'CURSED_DIE_ROLLED'
  | 'BOSS_HAND_CHANGED' | 'BOSS_FACE_CHANGED'
  | 'RUN_LOST' | 'RESOLUTION_ERROR' | 'MANUAL_REROLL_STARTED' | 'DEAD_BOARD' | 'DEAD_BOARD_RESCUED'
  | 'TUTORIAL_SAFEGUARD' | 'INFERNO_EVALUATED';
export interface EventRecord {
  id: number;
  round: number;
  type: EventType;
  message: string;
  dieIds?: number[];
  enhancement?: Enhancement;
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
  enhancementCapacityBefore?: number;
  enhancementCapacityAfter?: number;
  newlyUnlockedEnhancements?: Enhancement[];
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
  rarity?: Rarity;
  offerSet?: { name: string; rarity: Rarity }[];
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
  probability?: { enhancement: 'boomerang' | 'holiday' | 'hitchhiker' | 'personalTrainer' | 'doubleTime' | 'sticky'; stacks: number; chance: number; succeeded: boolean };
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
  /** Authoritative owned-die collection. Board.dice is only the active encounter projection. */
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
export type EngulfmentAssetRef =
  | { kind: 'ember'; flame: Flame; instanceId: FlameInstanceId; dieId: number }
  | { kind: 'bonfire'; flame: Flame; instanceId: FlameInstanceId };
export type Action =
  | { type: 'PLAY'; hand: HandId; dieIds: number[]; decisionMs?: number }
  | { type: 'MANUAL_REROLL'; dieIds: number[] }
  | { type: 'UNLOCK_WARDEN_DIE'; dieId: number }
  | { type: 'TOGGLE_CHARGE'; hand?: HandId | null; dieIds?: number[] }
  | { type: 'BUY'; offerId: number; dieId: number }
  | { type: 'SELL_ENHANCEMENT'; dieId: number; face: Rank; enhancement: Enhancement }
  | { type: 'TRAIN_HAND'; hand: HandId }
  | { type: 'TRAIN_ALL_HANDS' }
  | { type: 'CHOOSE_FLAME'; offerId: number; dieId: number }
  | { type: 'STOKE_FLAME'; dieId: number; amount: number }
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
  | { type: 'REROLL_DICE' }
  | { type: 'REROLL_OFFERS' }
  | { type: 'UNLOCK_SHOP_EXIT' }
  | { type: 'NEXT_CHAPTER' }
  | { type: 'NEXT_ROUND' };
export interface Resolution { state: GameState; events: GameEvent[]; error?: string }
export interface RandomSource { next(): number }
export interface HandOption { id: HandId; combinations: number[][]; consumed: boolean }
