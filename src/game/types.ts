export type Rank = 1 | 2 | 3 | 4 | 5 | 6;
export type Enhancement =
  | 'bonus' | 'multiplier' | 'jumpingBean' | 'golden' | 'workout'
  | 'missingLink' | 'mirror' | 'magnetic' | 'sticky' | 'slippy'
  | 'sustainable' | 'hitchhiker' | 'weighted' | 'jackpot';
export type HandId =
  | 'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes'
  | 'pair' | 'twoPair' | 'threeKind' | 'fullHouse' | 'fourKind' | 'fiveKind' | 'smallStraight' | 'largeStraight';
export type Phase = 'round' | 'shop' | 'lost' | 'error';
// Hitchhiker remains a legacy telemetry key; new scores belong to the selected hand.
export type ScoreSource = 'hand' | 'jumpingBean' | 'hitchhiker';
export type GoldSource = 'golden' | 'jackpot' | 'roundClear';

export interface HandScoreAccumulator {
  hand: HandId;
  dieIds: number[];
  basePips: number;
  baseMultiplier: number;
  currentPips: number;
  currentMultiplier: number;
  bonusPips: number;
  hitchhikerPips: number;
  finalScore: number | null;
}
export interface HandScoreRecord {
  round: number;
  hand: HandId;
  dieIds: number[];
  basePips: number;
  baseMultiplier: number;
  pips: number;
  multiplier: number;
  score: number;
  bonusPips: number;
  hitchhikerPips: number;
}

export interface Face {
  rank: Rank;
  workoutPips: number;
  enhancements: Partial<Record<Enhancement, number>>;
}
export interface Die { id: number; value: Rank; faces: Face[] }
export interface Offer { id: number; enhancement: Enhancement; purchased: boolean }
export interface Shop { offers: Offer[]; diceRerolls: number; offerRerolls: number }
export interface Board {
  phase: Phase;
  round: number;
  target: number;
  score: number;
  gold: number;
  manualRerollsRemaining: number;
  dice: Die[];
  consumed: HandId[];
  scoreByHand: Partial<Record<HandId, number>>;
  effectScore: number;
  shop: Shop | null;
}
export interface RoundStats {
  round: number;
  target: number;
  firstCrossedScore: number | null;
  finalScore: number;
  clearMargin: number | null;
  cleared: boolean;
  lastHand: HandId | null;
  lastAction: 'PLAY' | 'MANUAL_REROLL' | null;
  manualRerollsGranted: number;
  manualRerollChargesSpent: number;
  manualRerollsRemainingAtClear: number | null;
  manualRerollActions: number;
  deadBoardRescues: number;
  scoreByHand: Partial<Record<HandId, number>>;
  effectScore: number;
}
export interface ManualRerollStats {
  round: number;
  dieIds: number[];
  charges: number;
  remaining: number;
  startedDeadBoard: boolean;
  rescuedDeadBoard: boolean;
}
export interface Purchase { round: number; enhancement: Enhancement; dieId: number; face: Rank; cost: number }
export interface ProbabilityProcStats {
  checks: number;
  successes: number;
  failures: number;
  stacksAtCheck: number[];
}
export interface RunStats {
  seed: string;
  roundReached: number;
  rounds: RoundStats[];
  handsPlayed: Partial<Record<HandId, number>>;
  purchases: Purchase[];
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
  triggers: Partial<Record<Enhancement, number>>;
  probabilityProcs: Record<'sticky' | 'sustainable', ProbabilityProcStats>;
  scoreBySource: Record<ScoreSource, number>;
  scoreByHand: Partial<Record<HandId, number>>;
  handScores: HandScoreRecord[];
  handBonusPips: number;
  hitchhikerPipsContributed: number;
  loss: null | { round: number; afterHand: HandId | null; afterAction: 'PLAY' | 'MANUAL_REROLL' | null;
    score: number; values: Rank[]; consumed: HandId[]; manualRerollsRemaining: number };
  actions: Action[];
  resolutionError: string | null;
}
export type EventType =
  | 'ROUND_STARTED' | 'HAND_STARTED' | 'ABILITY_TRIGGERED' | 'ABILITY_CHECKED' | 'ABILITY_EVALUATED'
  | 'HAND_PIPS_CHANGED' | 'HAND_MULTIPLIER_CHANGED' | 'HITCHHIKER_ADDED_PIPS'
  | 'HAND_SCORE_FINALIZED' | 'STANDALONE_SCORE_CALCULATED'
  | 'POST_HAND_REROLLS_SKIPPED'
  | 'SCORE_ADDED' | 'GOLD_ADDED' | 'WORKOUT_INCREMENTED' | 'DICE_REROLL_STARTED'
  | 'DIE_ROLLED' | 'DIE_FLIPPED' | 'HAND_CONSUMED' | 'ROUND_CLEARED'
  | 'SHOP_OPENED' | 'OFFER_PURCHASED' | 'OFFERS_REFRESHED' | 'GOLD_SPENT'
  | 'RUN_LOST' | 'RESOLUTION_ERROR' | 'MANUAL_REROLL_STARTED' | 'DEAD_BOARD' | 'DEAD_BOARD_RESCUED';
export interface EventRecord {
  id: number;
  round: number;
  type: EventType;
  message: string;
  dieIds?: number[];
  enhancement?: Enhancement;
  hand?: HandId;
  pips?: number;
  multiplier?: number;
  amount?: number;
  source?: ScoreSource;
  goldSource?: GoldSource;
  face?: Rank;
  probability?: { enhancement: 'sticky' | 'sustainable'; stacks: number; chance: number; succeeded: boolean };
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
  | { type: 'BUY'; offerId: number; dieId: number }
  | { type: 'REROLL_DICE' }
  | { type: 'REROLL_OFFERS' }
  | { type: 'NEXT_ROUND' };
export interface Resolution { state: GameState; events: GameEvent[]; error?: string }
export interface RandomSource { next(): number }
export interface HandOption { id: HandId; combinations: number[][]; consumed: boolean }
