export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type BossType = 'caller' | 'warden' | 'hexer' | 'marathon' | 'quickdraw' | 'fly' | 'snakeEyes' | 'infected';
export type RunNodeType = 'normal_round' | 'boss_round' | 'shop' | 'flame_selection';
export type Enhancement =
  | 'bonus' | 'jumpingBean' | 'golden' | 'workout'
  | 'missingLink' | 'mirror' | 'magnetic' | 'sticky' | 'slippy'
  | 'hitchhiker' | 'weighted' | 'jackpot' | 'bump' | 'vintage';
export type Flame =
  | 'ultimate' | 'minigun' | 'hailMary' | 'charge' | 'personalTrainer'
  | 'dragonsHoard' | 'wellTrained' | 'targetPractice'
  | 'hotStreak' | 'moneyToBurn' | 'lowball' | 'straightShooter' | 'doubleDown';
export type HandId =
  | 'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes'
  | 'pair' | 'twoPair' | 'threeKind' | 'fullHouse' | 'fourKind' | 'fiveKind' | 'smallStraight' | 'largeStraight';
export type Phase = 'round' | 'roundSummary' | 'bust' | 'flameSelection' | 'shop' | 'lost' | 'error';
export type ScoreSource = 'hand' | 'jumpingBean' | 'hitchhiker' | 'boss';
export type HandPlaySource = 'manual' | 'jumpingBean';
export type GoldSource = 'golden' | 'jackpot' | 'enhancementSale' | 'roundBase' | 'unusedRerolls' | 'interest' | 'bossReward';
export type GoldSpendSource = 'enhancement' | 'shopDiceReroll' | 'enhancementReroll' | 'handTraining' | 'flameInvestment' | 'lifeRestore';
export type HandLevels = Record<HandId, number>;

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
}
export interface WardenBossState {
  type: 'warden';
  checkpoints: number[];
  activeDieIds: number[];
  startingDieId: number | null;
  reachedCheckpoints: number;
  pendingReinforcements: number;
}
export interface HexerBossState { type: 'hexer'; cursedDieId: number }
export interface MarathonBossState { type: 'marathon'; cooldowns: Partial<Record<HandId, number>> }
export interface QuickdrawBossState { type: 'quickdraw'; lowerShotUsed: boolean; playedLowerHand: HandId | null }
export interface FlyBossState { type: 'fly'; flyHand: HandId | null; caught: boolean; moves: number }
export interface SnakeEyesBossState { type: 'snakeEyes'; mutatedFaces: { dieId: number; physicalFace: Rank }[] }
export interface InfectedBossState { type: 'infected'; infectedFaces: { dieId: number; physicalFace: Rank }[] }
export type BossRuntimeState = CallerBossState | WardenBossState | HexerBossState | MarathonBossState
  | QuickdrawBossState | FlyBossState | SnakeEyesBossState | InfectedBossState;

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
  rawScore: number | null;
  finalScore: number | null;
}
export interface HandScoreRecord {
  round: number;
  hand: HandId;
  handLevel: number;
  dieIds: number[];
  basePips: number;
  baseMultiplier: number;
  pips: number;
  multiplier: number;
  xMult: number;
  bossFactor: number;
  xMultFactors: XMultFactor[];
  rawScore: number;
  score: number;
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
  vintageSellValue?: number;
  snakeEyed?: boolean;
  infected?: boolean;
}
export interface ActiveFlame { id: Flame; investedGold: number }
export interface StandaloneScoreRecord {
  round: number;
  dieId: number;
  pips: number;
  multiplier: number;
  xMult: number;
  xMultFactors: XMultFactor[];
  rawScore: number;
  score: number;
}
export interface Die { id: number; value: Rank; faces: Face[]; flame: ActiveFlame | null; owner: 'player' | 'boss' }
export interface Offer { id: number; enhancement: Enhancement; purchased: boolean }
export interface TrainingOffer { hand: HandId; purchased: boolean }
export interface Shop { offers: Offer[]; trainingOffers: TrainingOffer[]; diceRerolls: number; offerRerolls: number }
export interface FlameOffer { id: number; flame: Flame }
export interface FlameSelection { offers: FlameOffer[]; acquired: boolean }
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
  score: number;
  target: number;
  goldBefore: number;
  goldAfter: number;
  totalGoldEarned: number;
  sources: RoundSummaryGoldSources;
}
export interface Board {
  phase: Phase;
  round: number;
  target: number;
  score: number;
  gold: number;
  lives: number;
  livesPurchasedThisRun: number;
  roundAttemptNumber: number;
  bossSchedule: Partial<Record<number, BossType>>;
  boss: BossRuntimeState | null;
  currentNodeId: string;
  bust: BustSummary | null;
  flameTutorial: { pendingDieId: number | null; completed: boolean };
  manualRerollsRemaining: number;
  dice: Die[];
  bonfires: Flame[];
  chargeXMult: number;
  chargeArmed: boolean;
  hotStreakGoal: HandId | null;
  hotStreakCharges: number;
  lifetimeNormalShopGoldSpent: number;
  consumed: HandId[];
  scoreByHand: Partial<Record<HandId, number>>;
  effectScore: number;
  handLevels: HandLevels;
  handPlayCounts: Record<HandId, number>;
  targetPracticeHand: HandId | null;
  lastRoundPayout: RoundPayout | null;
  roundSummary: RoundSummary | null;
  shop: Shop | null;
  flameSelection: FlameSelection | null;
}
export interface RoundStats {
  round: number;
  attempt: number;
  target: number;
  firstCrossedScore: number | null;
  finalScore: number;
  clearMargin: number | null;
  cleared: boolean;
  lastHand: HandId | null;
  lastAction: 'PLAY' | 'MANUAL_REROLL' | 'JUMPING_BEAN' | null;
  manualRerollsGranted: number;
  manualRerollChargesSpent: number;
  manualRerollsRemainingAtClear: number | null;
  manualRerollActions: number;
  deadBoardRescues: number;
  scoreByHand: Partial<Record<HandId, number>>;
  effectScore: number;
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
  round: number; attempt: number; score: number; target: number; shortfall: number;
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
  wardenCheckpoints?: number[];
  wardenStartingDieId?: number | null;
  wardenActiveDiceAtEnd?: number;
}
export interface CallerEventRecord {
  round: number; attempt: number; calledHand: HandId; playsRemaining: number;
  satisfied: boolean; source: HandPlaySource; expired: boolean;
}
export interface WardenEventRecord {
  round: number; attempt: number; kind: 'starting_die' | 'checkpoint' | 'reinforcement';
  threshold?: number; dieId?: number; activeDice: number;
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
export interface TrainingPurchase { round: number; hand: HandId; fromLevel: number; toLevel: number; cost: number }
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
  score: number;
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
  handsPlayed: Partial<Record<HandId, number>>;
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
  flameSkips: number[];
  flameStokes: FlameStoke[];
  totalFlameInvestment: number;
  bonfiresCreated: { round: number; flame: Flame }[];
  flameTriggers: Partial<Record<Flame, number>>;
  xMultFactorsByFlame: Partial<Record<Flame, number[]>>;
  targetPracticeTargets: { round: number; hand: HandId }[];
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
  moneyToBurnMultipliers: number[];
  lowballAverages: number[];
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
  roundSummaries: RoundSummaryRecord[];
  goldEarned: number;
  goldBySource: Record<GoldSource, number>;
  goldSpent: number;
  goldSpentBySource: Record<GoldSpendSource, number>;
  triggers: Partial<Record<Enhancement, number>>;
  probabilityProcs: Record<'sticky' | 'hitchhiker', ProbabilityProcStats>;
  scoreBySource: Record<ScoreSource, number>;
  scoreByHand: Partial<Record<HandId, number>>;
  handScores: HandScoreRecord[];
  jumpingBeanFreePlays: JumpingBeanPlayRecord[];
  standaloneScores: StandaloneScoreRecord[];
  handBonusPips: number;
  hitchhikerPipsContributed: number;
  loss: null | { round: number; afterHand: HandId | null; afterAction: 'PLAY' | 'MANUAL_REROLL' | 'JUMPING_BEAN' | null;
    score: number; values: Rank[]; consumed: HandId[]; manualRerollsRemaining: number };
  actions: Action[];
  resolutionError: string | null;
}
export type EventType =
  | 'MAP_TRANSITION' | 'ROUND_STARTED' | 'BOSS_STARTED' | 'BOSS_CLEARED' | 'HAND_STARTED' | 'ABILITY_TRIGGERED' | 'ABILITY_CHECKED' | 'ABILITY_EVALUATED'
  | 'HAND_PIPS_CHANGED' | 'HAND_MULTIPLIER_CHANGED' | 'HITCHHIKER_ADDED_PIPS'
  | 'HAND_SCORE_FINALIZED' | 'STANDALONE_SCORE_CALCULATED' | 'SCORE_ROUNDING_AUDIT'
  | 'POST_HAND_REROLLS_SKIPPED' | 'SCORE_ADDED' | 'GOLD_ADDED' | 'WORKOUT_INCREMENTED'
  | 'DICE_REROLL_STARTED' | 'DIE_ROLLED' | 'DIE_FLIPPED' | 'HAND_CONSUMED' | 'ROUND_CLEARED'
  | 'ROUND_SUMMARY_SHOWN'
  | 'SHOP_OPENED' | 'OFFER_PURCHASED' | 'TRAINING_PURCHASED' | 'OFFERS_REFRESHED' | 'GOLD_SPENT'
  | 'FLAME_SELECTION_OPENED' | 'FLAME_OFFERS_REFRESHED' | 'FLAME_ACQUIRED' | 'FLAME_REPLACED'
  | 'FLAME_SKIPPED' | 'FLAME_INVESTED' | 'BONFIRE_CREATED' | 'FLAME_TRIGGERED' | 'HAND_XMULT_CHANGED'
  | 'TARGET_PRACTICE_SELECTED' | 'CHARGE_CHANGED' | 'CHARGE_ARMED' | 'HOT_STREAK_CHANGED'
  | 'ENHANCEMENT_SOLD' | 'VINTAGE_GROWN' | 'MAGNETIC_ATTRACTION' | 'BUMP_ROLL'
  | 'JUMPING_BEAN_FREE_PLAY' | 'JUMPING_BEAN_FOLLOWUP'
  | 'ROUND_BUST' | 'SHOP_REOPENED_AFTER_BUST' | 'ROUND_RETRY_STARTED' | 'LIFE_RESTORED' | 'FLAME_TUTORIAL_COMPLETED'
  | 'CALLER_CALLED' | 'CALLER_CHANGED' | 'WARDEN_CHECKPOINT' | 'WARDEN_REINFORCEMENT' | 'CURSED_DIE_ROLLED'
  | 'BOSS_HAND_CHANGED' | 'BOSS_FACE_CHANGED'
  | 'RUN_LOST' | 'RESOLUTION_ERROR' | 'MANUAL_REROLL_STARTED' | 'DEAD_BOARD' | 'DEAD_BOARD_RESCUED';
export interface EventRecord {
  id: number;
  round: number;
  type: EventType;
  message: string;
  dieIds?: number[];
  enhancement?: Enhancement;
  flame?: Flame;
  boss?: BossType;
  fromNode?: string | null;
  toNode?: string;
  nodeType?: RunNodeType;
  direction?: 'forward' | 'backward';
  hand?: HandId;
  playSource?: HandPlaySource;
  handConsumed?: boolean;
  pips?: number;
  multiplier?: number;
  xMult?: number;
  xMultFactor?: XMultFactor;
  rawScore?: number;
  amount?: number;
  source?: ScoreSource;
  goldSource?: GoldSource;
  goldSpendSource?: GoldSpendSource;
  face?: Rank;
  rollSource?: 'manual_reroll' | 'automatic';
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
  probability?: { enhancement: 'sticky' | 'hitchhiker'; stacks: number; chance: number; succeeded: boolean };
  handScore?: HandScoreAccumulator;
}
export interface GameEvent extends EventRecord { board: Board }
export interface BustSummary {
  round: number;
  attempt: number;
  score: number;
  target: number;
  shortfall: number;
  livesBefore: number;
  livesAfter: number;
}
export interface GameStateBase extends Board {
  seed: string;
  rngState: number;
  nextOfferId: number;
  stats: RunStats;
  history: EventRecord[];
}
export interface GameState extends GameStateBase { roundCheckpoint: GameStateBase | null }
export type Action =
  | { type: 'PLAY'; hand: HandId; dieIds: number[] }
  | { type: 'MANUAL_REROLL'; dieIds: number[] }
  | { type: 'UNLOCK_WARDEN_DIE'; dieId: number }
  | { type: 'TOGGLE_CHARGE' }
  | { type: 'BUY'; offerId: number; dieId: number }
  | { type: 'SELL_ENHANCEMENT'; dieId: number; face: Rank; enhancement: Enhancement }
  | { type: 'TRAIN_HAND'; hand: HandId }
  | { type: 'CHOOSE_FLAME'; offerId: number; dieId: number }
  | { type: 'STOKE_FLAME'; dieId: number; amount: number }
  | { type: 'CONTINUE_ROUND_SUMMARY' }
  | { type: 'CONTINUE_FLAME_SELECTION' }
  | { type: 'RESTORE_LIFE' }
  | { type: 'DISMISS_FLAME_TUTORIAL' }
  | { type: 'RETRY_ROUND' }
  | { type: 'REROLL_DICE' }
  | { type: 'REROLL_OFFERS' }
  | { type: 'NEXT_ROUND' };
export interface Resolution { state: GameState; events: GameEvent[]; error?: string }
export interface RandomSource { next(): number }
export interface HandOption { id: HandId; combinations: number[][]; consumed: boolean }
