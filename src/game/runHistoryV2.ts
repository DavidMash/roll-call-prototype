import type {
  BossType, ChallengeId, Enhancement, Flame, GoldSource, GoldSpendSource, HandId, HandPlaySource,
  Rarity, Rank, RunNodeType, SpecialOfferType, WildfireResolved,
} from './types';

export const RUN_HISTORY_V2_SCHEMA_VERSION = 2 as const;
export const RUN_HISTORY_V2_RULESET = 'rarity-fetch-vintage-v1' as const;

export interface RunHistoryV2Coverage {
  complete: boolean;
  firstRound: number;
  firstActionId: number;
  firstSeq: number;
}

export type FlameOrigin = 'ember' | 'bonfire' | 'wildfire' | 'charge' | 'boss' | 'special_offer' | 'external';
export type RollReason = 'initial_round' | 'warden_opening' | 'manual' | 'post_hand' | 'winning_settle'
  | 'jumping_bean_followup' | 'juggler' | 'magician_return' | 'shop' | 'other';

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
  physicalFace: Rank;
  face: Rank;
  pips: number;
  enhancements: Partial<Record<Enhancement, number>>;
  flame: Flame | null;
}

export interface PipsContribution {
  source: 'hand_base' | 'die_base' | 'bonus' | 'lone_wolf' | 'teamwork' | 'hitchhiker';
  amount: number;
  dieId?: number;
  face?: Rank;
  role?: 'selected' | 'hitchhiker';
}

export interface MultContribution {
  source: 'hand_base' | 'tank';
  factor: number;
  before: number;
  after: number;
  dieId?: number;
  stacks?: number;
}

export interface XMultContribution {
  sourceId: Flame | 'charge' | BossType | SpecialOfferType | 'other';
  origin: FlameOrigin;
  factor: number;
  dieId?: number;
  input?: number;
}

export interface ProbabilityCheck {
  source: 'sticky' | 'hitchhiker' | 'personalTrainer' | 'doubleTime';
  stacks: number;
  chance: number;
  succeeded: boolean;
  dieIds: number[];
}

export type HandSideEffect =
  | { type: 'workout'; dieId: number; face: Rank; before: number; after: number; amount: number }
  | { type: 'personal_trainer'; dieId: number; hand: HandId; beforeLevel: number; afterLevel: number }
  | { type: 'gold'; source: GoldSource; amount: number; dieId?: number }
  | { type: 'vintage_growth'; dieId: number; face: Rank; before: number; after: number }
  | { type: 'double_time'; dieId: number; succeeded: boolean }
  | { type: 'charge'; operation: 'gain' | 'consume_reset' | 'arm' | 'disarm'; before: number; after: number; source?: Flame }
  | { type: 'flame_activation'; flame: Flame; origin: FlameOrigin; dieId?: number; factor?: number }
  | { type: 'enhancement'; enhancement: Enhancement; dieIds: number[]; amount?: number }
  | { type: 'boss_state'; boss: BossType; change: string; amount?: number };

export interface RunStartedEvent extends RunHistoryV2Envelope {
  kind: 'run_started';
  schemaVersion: typeof RUN_HISTORY_V2_SCHEMA_VERSION;
  ruleset: typeof RUN_HISTORY_V2_RULESET;
  seed: string;
  initialLives: number;
  initialGold: number;
  initialHandLevels: Record<HandId, number>;
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
  target: { normal: number; final: number };
  boss: BossType | null;
  lives: number;
  dice: HistoryDieState[];
}

export interface RollResult {
  dieId: number;
  beforePhysicalFace: Rank;
  afterPhysicalFace: Rank;
  beforeFace: Rank;
  afterFace: Rank;
  previousFaceExcluded: boolean;
  weighted: null | { sourceFace: Rank; stacks: number; destinationWeight: number };
  bump: null | { source: 'enhancement' | 'clockmaker' };
  magneticAnchorIds: number[];
}

export type RollEffect =
  | { type: 'charge'; source: Flame; before: number; after: number }
  | { type: 'flame_activation'; flame: Flame; origin: FlameOrigin; dieIds: number[] }
  | { type: 'boss'; boss: BossType; change: string; dieIds: number[] };

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
  hand: HandId;
  level: number;
  playSource: HandPlaySource;
  selectedDice: number[];
  scoringDice: (HistoryDieState & { role: 'selected' | 'hitchhiker' })[];
  consumed: boolean;
  score: {
    basePips: number;
    finalPips: number;
    baseMult: number;
    finalMult: number;
    finalXMult: number;
    bossFactor: number;
    raw: number;
    awarded: number;
    rounding: { mode: 'nearest_integer'; delta: number };
  };
  roundScore: { before: number; afterAward: number; after: number };
  pipsContributions: PipsContribution[];
  multContributions: MultContribution[];
  xMultContributions: XMultContribution[];
  checks: ProbabilityCheck[];
  sideEffects: HandSideEffect[];
}

export interface ShopOffersPresentedEvent extends RunHistoryV2Envelope {
  kind: 'shop_offers_presented';
  pool: 'enhancement' | 'flame' | 'special_offer';
  reason: 'initial' | 'reroll' | 'reward';
  offers: { id: number; contentId: Enhancement | Flame | SpecialOfferType; rarity: Rarity }[];
}

export type ShopTransaction =
  | { type: 'gold_earned'; source: GoldSource; amount: number }
  | { type: 'round_payout'; sources: Partial<Record<GoldSource, number>>; total: number }
  | { type: 'gold_spent'; source: GoldSpendSource; amount: number }
  | { type: 'enhancement_purchased'; enhancement: Enhancement; rarity: Rarity; dieId: number; face: Rank; cost: number }
  | { type: 'enhancement_sold'; enhancement: Enhancement; dieId: number; face: Rank; proceeds: number }
  | { type: 'training'; hand: HandId | 'all'; cost: number; fromLevel?: number; toLevel?: number }
  | { type: 'life_restored'; cost: number; livesBefore: number; livesAfter: number }
  | { type: 'special_offer_selected'; offer: SpecialOfferType; rarity: Rarity; hand?: HandId };

export interface ShopTransactionEvent extends RunHistoryV2Envelope {
  kind: 'shop_transaction';
  transaction: ShopTransaction;
}

export type FlameChange =
  | { type: 'acquired' | 'replaced'; flame: Flame; dieId: number; replaced?: Flame; rarity: Rarity }
  | { type: 'skipped' }
  | { type: 'stoked'; flame: Flame; dieId: number; amount: number; from: number; to: number }
  | { type: 'bonfire_created'; flame: Flame; dieId: number }
  | { type: 'wildfire_created'; flame: Flame; sacrificedFlame: Flame; contributionAverage: number; transferMultiplier: number; resolved: WildfireResolved }
  | { type: 'activated'; flame: Flame; origin: FlameOrigin; dieId?: number; factor?: number };

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
  dieIds: number[];
}

export interface HoodedChallengeChangedEvent extends RunHistoryV2Envelope {
  kind: 'hooded_challenge_changed';
  challengeId?: ChallengeId;
  change: 'issued' | 'completed' | 'rolled_back' | 'time_travel_reset' | 'returned'
    | 'recipient_selected' | 'sacrifice_selected' | 'wildfire_created' | 'walked_away';
  target?: number;
  recipientFlame?: Flame;
  sacrificedFlame?: Flame;
}

export interface BossStateChangedEvent extends RunHistoryV2Envelope {
  kind: 'boss_state_changed';
  boss: BossType;
  change: 'started' | 'cleared' | 'state' | 'warden_target' | 'warden_unlock' | 'face';
  hand?: HandId;
  dieIds: number[];
  amount?: number;
}

export interface ScorecardRefreshedEvent extends RunHistoryV2Envelope {
  kind: 'scorecard_refreshed';
  refreshedHands: HandId[];
}

export interface RoundAttemptFinishedEvent extends RunHistoryV2Envelope {
  kind: 'round_attempt_finished';
  outcome: 'cleared' | 'bust';
  score: number;
  target: number;
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
}

export interface RunFinishedEvent extends RunHistoryV2Envelope {
  kind: 'run_finished';
  outcome: 'lost' | 'completed';
  finalChapter: number;
  finalRound: number;
  finalBoss: BossType | null;
  score: number;
  target: number;
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
  | HandScoredEvent | ShopOffersPresentedEvent | ShopTransactionEvent | FlameChangedEvent | ChargeChangedEvent
  | HoodedChallengeChangedEvent | BossStateChangedEvent | ScorecardRefreshedEvent | RoundAttemptFinishedEvent
  | CheckpointRestoredEvent | RunFinishedEvent | ErrorEvent | MapTransitionV2Event;

type EnvelopeKeys = Exclude<keyof RunHistoryV2Envelope, 'kind'>;
export type RunHistoryV2EventInput = RunHistoryV2Event extends infer Event
  ? Event extends RunHistoryV2Event ? Omit<Event, EnvelopeKeys> & { parentSeq?: number } : never
  : never;
