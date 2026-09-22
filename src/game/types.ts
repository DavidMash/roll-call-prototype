export type Rank = 1 | 2 | 3 | 4 | 5 | 6;
export type Enhancement =
  | 'bonus' | 'jumpingBean' | 'golden' | 'workout'
  | 'missingLink' | 'mirror' | 'magnetic' | 'sticky' | 'slippy'
  | 'hitchhiker' | 'weighted' | 'jackpot' | 'bump';
export type Flame =
  | 'ultimate' | 'minigun' | 'hailMary' | 'charge' | 'personalTrainer'
  | 'dragonsHoard' | 'wellTrained' | 'targetPractice'
  | 'hotStreak' | 'moneyToBurn' | 'lowball' | 'straightShooter' | 'doubleDown';
export type HandId =
  | 'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes'
  | 'pair' | 'twoPair' | 'threeKind' | 'fullHouse' | 'fourKind' | 'fiveKind' | 'smallStraight' | 'largeStraight';
export type Phase = 'round' | 'flameReward' | 'shop' | 'lost' | 'error';
export type ScoreSource = 'hand' | 'jumpingBean' | 'hitchhiker';
export type HandPlaySource = 'manual' | 'jumpingBean';
export type GoldSource = 'golden' | 'jackpot' | 'roundBase' | 'unusedRerolls' | 'interest';
export type GoldSpendSource = 'enhancement' | 'shopDiceReroll' | 'enhancementReroll' | 'handTraining' | 'flameReroll' | 'flameInvestment';
export type HandLevels = Record<HandId, number>;

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
export interface Die { id: number; value: Rank; faces: Face[]; flame: ActiveFlame | null }
export interface Offer { id: number; enhancement: Enhancement; purchased: boolean }
export interface TrainingOffer { hand: HandId; purchased: boolean }
export interface Shop { offers: Offer[]; trainingOffers: TrainingOffer[]; diceRerolls: number; offerRerolls: number }
export interface FlameOffer { id: number; flame: Flame }
export interface FlameReward { offers: FlameOffer[]; offerRerolls: number; acquired: boolean }
export interface RoundPayout { base: number; unusedRerolls: number; interest: number; heldGoldSnapshot: number; total: number }
export interface Board {
  phase: Phase;
  round: number;
  target: number;
  score: number;
  gold: number;
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
  shop: Shop | null;
  flameReward: FlameReward | null;
}
export interface RoundStats {
  round: number;
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
export interface Purchase { round: number; enhancement: Enhancement; dieId: number; face: Rank; cost: number; stacksApplied?: number }
export interface ScrapRecord { round: number; enhancement: Enhancement; dieId: number; face: Rank; stacksRemoved: number }
export interface TrainingPurchase { round: number; hand: HandId; fromLevel: number; toLevel: number; cost: number }
export interface FlameAcquisition { round: number; dieId: number; flame: Flame; replaced: Flame | null }
export interface FlameDonation { round: number; dieId: number; flame: Flame; amount: number; total: number }
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
  scraps: ScrapRecord[];
  trainingPurchases: TrainingPurchase[];
  trainingPurchasesTotal: number;
  trainingGoldSpent: number;
  flameAcquisitions: FlameAcquisition[];
  flameSkips: number[];
  flameDonations: FlameDonation[];
  totalFlameInvestment: number;
  bonfiresCreated: { round: number; flame: Flame }[];
  flameOfferRerolls: number;
  flameRerollGoldSpent: number;
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
  | 'ROUND_STARTED' | 'HAND_STARTED' | 'ABILITY_TRIGGERED' | 'ABILITY_CHECKED' | 'ABILITY_EVALUATED'
  | 'HAND_PIPS_CHANGED' | 'HAND_MULTIPLIER_CHANGED' | 'HITCHHIKER_ADDED_PIPS'
  | 'HAND_SCORE_FINALIZED' | 'STANDALONE_SCORE_CALCULATED' | 'SCORE_ROUNDING_AUDIT'
  | 'POST_HAND_REROLLS_SKIPPED' | 'SCORE_ADDED' | 'GOLD_ADDED' | 'WORKOUT_INCREMENTED'
  | 'DICE_REROLL_STARTED' | 'DIE_ROLLED' | 'DIE_FLIPPED' | 'HAND_CONSUMED' | 'ROUND_CLEARED'
  | 'SHOP_OPENED' | 'OFFER_PURCHASED' | 'TRAINING_PURCHASED' | 'OFFERS_REFRESHED' | 'GOLD_SPENT'
  | 'FLAME_REWARD_OPENED' | 'FLAME_OFFERS_REFRESHED' | 'FLAME_ACQUIRED' | 'FLAME_REPLACED'
  | 'FLAME_SKIPPED' | 'FLAME_INVESTED' | 'BONFIRE_CREATED' | 'FLAME_TRIGGERED' | 'HAND_XMULT_CHANGED'
  | 'TARGET_PRACTICE_SELECTED' | 'CHARGE_CHANGED' | 'CHARGE_ARMED' | 'HOT_STREAK_CHANGED'
  | 'ENHANCEMENT_SCRAPPED' | 'MAGNETIC_ATTRACTION' | 'BUMP_ROLL'
  | 'JUMPING_BEAN_FREE_PLAY' | 'JUMPING_BEAN_FOLLOWUP'
  | 'RUN_LOST' | 'RESOLUTION_ERROR' | 'MANUAL_REROLL_STARTED' | 'DEAD_BOARD' | 'DEAD_BOARD_RESCUED';
export interface EventRecord {
  id: number;
  round: number;
  type: EventType;
  message: string;
  dieIds?: number[];
  enhancement?: Enhancement;
  flame?: Flame;
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
  probability?: { enhancement: 'sticky' | 'hitchhiker'; stacks: number; chance: number; succeeded: boolean };
  handScore?: HandScoreAccumulator;
}
export interface GameEvent extends EventRecord { board: Board }
export interface GameState extends Board {
  seed: string;
  rngState: number;
  nextOfferId: number;
  stats: RunStats;
  history: EventRecord[];
}
export type Action =
  | { type: 'PLAY'; hand: HandId; dieIds: number[] }
  | { type: 'MANUAL_REROLL'; dieIds: number[] }
  | { type: 'TOGGLE_CHARGE' }
  | { type: 'BUY'; offerId: number; dieId: number }
  | { type: 'SCRAP_ENHANCEMENT'; dieId: number; face: Rank; enhancement: Enhancement }
  | { type: 'TRAIN_HAND'; hand: HandId }
  | { type: 'CHOOSE_FLAME'; offerId: number; dieId: number }
  | { type: 'DONATE_FLAME'; dieId: number; amount: number }
  | { type: 'REROLL_FLAMES' }
  | { type: 'CONTINUE_FLAME_REWARD' }
  | { type: 'REROLL_DICE' }
  | { type: 'REROLL_OFFERS' }
  | { type: 'NEXT_ROUND' };
export interface Resolution { state: GameState; events: GameEvent[]; error?: string }
export interface RandomSource { next(): number }
export interface HandOption { id: HandId; combinations: number[][]; consumed: boolean }
