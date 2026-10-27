import { bossGoalModifier } from './bosses';
import { chapterPosition, ROUNDS_PER_CHAPTER } from './chapters';
import { CONFIG } from './config';
import { Decimal, decimalConstructorForDigits, type ExactDecimal, type ExactScore } from './scoreMath';
import type { BossType } from './types';

export const LOCAL_ROUND_GOAL_MULTIPLIERS = [1, 1.5, 2, 2.5, 3, 4] as const;
export const MAX_COARSE_GOAL_DEVIATION = 0.075;

export interface GoalBeautification {
  coarseCandidate: ExactScore;
  coarseDeviation: number;
  coarseAccepted: boolean;
  coarseCollision: boolean;
  fineFallback?: ExactScore;
  finalGoal: ExactScore;
}

export interface RoundGoalBreakdown extends GoalBeautification {
  chapter: number;
  chapterBase: ExactDecimal;
  localRound: number;
  localMultiplier: number;
  neutralRawGoal: ExactDecimal;
  bossModifier: number;
  postBossRawGoal: ExactDecimal;
}

export type BossForRound = (round: number) => BossType | null | undefined;
type GoalDecimalInput = Decimal.Value;

const positiveInteger = (value: number): number => Math.max(1, Math.floor(value));

function goalContext(chapter: number): typeof Decimal {
  const exponent = ROUNDS_PER_CHAPTER * (positiveInteger(chapter) - 1);
  const estimatedDigits = Math.max(3, Math.floor(2 + exponent * Math.log10(CONFIG.targetGrowth)) + 3);
  return decimalConstructorForDigits(estimatedDigits);
}

function standaloneContext(value: GoalDecimalInput): typeof Decimal {
  const text = String(value);
  const exponent = /e([+-]?\d+)$/i.exec(text)?.[1];
  const estimatedDigits = exponent ? Math.max(3, Number(exponent) + 3) : Math.max(3, text.replace(/\D/g, '').length + 3);
  return decimalConstructorForDigits(estimatedDigits);
}

function exactBossGoal(D: typeof Decimal, type: BossType | null | undefined, raw: InstanceType<typeof Decimal>) {
  if (type === 'marathon') return raw.times(3);
  if (type === 'quickdraw') return D.max(new D(CONFIG.targetRounding), raw.div(3));
  if (type === 'tightrope') return raw.times('0.5');
  return raw;
}

export function getChapterBaseGoal(chapter: number): ExactDecimal {
  const normalized = positiveInteger(chapter);
  const D = goalContext(normalized);
  return new D('100').times(new D('1.28').pow(ROUNDS_PER_CHAPTER * (normalized - 1))).toFixed();
}

export function getRawRoundGoal(globalRound: number): ExactDecimal {
  const { chapterNumber, chapterRound } = chapterPosition(globalRound);
  const D = goalContext(chapterNumber);
  return new D(getChapterBaseGoal(chapterNumber)).times(String(LOCAL_ROUND_GOAL_MULTIPLIERS[chapterRound - 1])).toFixed();
}

function magnitudeOf(raw: InstanceType<typeof Decimal>): number {
  return raw.e;
}

export function goalRoundingIncrement(rawGoal: GoalDecimalInput): ExactScore {
  const D = standaloneContext(rawGoal);
  const raw = new D(rawGoal);
  const magnitude = magnitudeOf(raw.abs().lt(1) ? new D(1) : raw.abs());
  if (magnitude < 3) return 25n;
  return 50n * 10n ** BigInt(magnitude - 3);
}

/** Magnitude-scaled fine rounding tuned to the established two-leading-digit targets. */
export function prettyRoundGoal(rawGoal: GoalDecimalInput): ExactScore {
  const D = standaloneContext(rawGoal);
  const raw = new D(rawGoal);
  const base = goalRoundingIncrement(rawGoal);
  const increment = raw.abs().lt(1_000) ? base : base * 2n;
  return BigInt(raw.div(increment.toString()).toDecimalPlaces(0, D.ROUND_HALF_UP).times(increment.toString()).toFixed(0));
}

export function coarseGoalCandidate(rawGoal: GoalDecimalInput): ExactScore {
  const D = standaloneContext(rawGoal);
  const raw = new D(rawGoal);
  const magnitude = new D(10).pow(magnitudeOf(raw));
  return BigInt(raw.div(magnitude).toDecimalPlaces(0, D.ROUND_HALF_UP).times(magnitude).toFixed(0));
}

function provisionalBeautifiedGoal(rawGoal: GoalDecimalInput): ExactScore {
  const D = standaloneContext(rawGoal);
  const raw = new D(rawGoal);
  const coarse = coarseGoalCandidate(rawGoal);
  const deviation = new D(coarse.toString()).minus(raw).abs().div(raw);
  return deviation.lte('0.075') ? coarse : prettyRoundGoal(rawGoal);
}

/** Neighbor comparisons remain order-independent and operate on exact candidates. */
export function beautifyGoal(rawGoal: GoalDecimalInput, adjacentRawGoals: readonly GoalDecimalInput[] = []): GoalBeautification {
  const D = standaloneContext(rawGoal);
  const raw = new D(rawGoal);
  if (!raw.isFinite() || raw.lte(0)) throw new Error('A raw Goal must be a positive finite decimal.');
  const coarseCandidate = coarseGoalCandidate(rawGoal);
  const deviation = new D(coarseCandidate.toString()).minus(raw).abs().div(raw);
  const withinTolerance = deviation.lte('0.075');
  const coarseCollision = withinTolerance && adjacentRawGoals.some(adjacent => {
    const adjacentDecimal = new D(adjacent);
    return !adjacentDecimal.eq(raw) && provisionalBeautifiedGoal(adjacent) === coarseCandidate;
  });
  const coarseAccepted = withinTolerance && !coarseCollision;
  const fineFallback = coarseAccepted ? undefined : prettyRoundGoal(rawGoal);
  return {
    coarseCandidate,
    coarseDeviation: Number(deviation.toSignificantDigits(16).toString()),
    coarseAccepted,
    coarseCollision,
    fineFallback,
    finalGoal: coarseAccepted ? coarseCandidate : fineFallback!,
  };
}

function postBossRawGoal(round: number, boss: BossType | null | undefined): ExactDecimal {
  const { chapterNumber } = chapterPosition(round);
  const D = goalContext(chapterNumber);
  return exactBossGoal(D, boss, new D(getRawRoundGoal(round))).toFixed();
}

export function getRoundGoalBreakdown(globalRound: number, boss: BossType | null = null,
  bossForRound: BossForRound = () => null): RoundGoalBreakdown {
  const round = positiveInteger(globalRound);
  const { chapterNumber, chapterRound } = chapterPosition(round);
  const D = goalContext(chapterNumber);
  const chapterBase = getChapterBaseGoal(chapterNumber);
  const localMultiplier = LOCAL_ROUND_GOAL_MULTIPLIERS[chapterRound - 1];
  const neutralRawGoal = new D(chapterBase).times(String(localMultiplier)).toFixed();
  const postBossRawGoalValue = exactBossGoal(D, boss, new D(neutralRawGoal)).toFixed();
  const adjacentRawGoals = [
    ...(round > 1 ? [postBossRawGoal(round - 1, bossForRound(round - 1))] : []),
    postBossRawGoal(round + 1, bossForRound(round + 1)),
  ];
  return {
    chapter: chapterNumber,
    chapterBase,
    localRound: chapterRound,
    localMultiplier,
    neutralRawGoal,
    bossModifier: boss ? bossGoalModifier(boss) : 1,
    postBossRawGoal: postBossRawGoalValue,
    ...beautifyGoal(postBossRawGoalValue, adjacentRawGoals),
  };
}

/**
 * Selects the authoritative Goal for an encounter. Silence does not undo a
 * Boss modifier after the fact: it routes the encounter through the same
 * neutral Goal calculation (including neutral adjacent-round beautification)
 * used when no Boss is present.
 */
export function getEncounterGoalBreakdown(globalRound: number, boss: BossType | null,
  bossSilenced: boolean, bossForRound: BossForRound = () => null): RoundGoalBreakdown {
  return bossSilenced
    ? getRoundGoalBreakdown(globalRound)
    : getRoundGoalBreakdown(globalRound, boss, bossForRound);
}

export function targetForRound(globalRound: number, boss: BossType | null = null,
  bossForRound?: BossForRound): ExactScore {
  return getRoundGoalBreakdown(globalRound, boss, bossForRound).finalGoal;
}

/** Maps the displayed run Round onto the canonical Goal track. Normal runs use offset 0. */
export const goalProgressionRound = (round: number, offset = 0): number =>
  Math.max(1, Math.floor(round) + Math.max(0, Math.floor(offset)));
