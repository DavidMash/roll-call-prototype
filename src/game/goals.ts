import { applyBossGoalModifier, bossGoalModifier } from './bosses';
import { chapterPosition, ROUNDS_PER_CHAPTER } from './chapters';
import { CONFIG } from './config';
import type { BossType } from './types';

export const LOCAL_ROUND_GOAL_MULTIPLIERS = [1, 1.5, 2, 2.5, 3, 4] as const;
export const MAX_COARSE_GOAL_DEVIATION = 0.075;

export interface GoalBeautification {
  coarseCandidate: number;
  coarseDeviation: number;
  coarseAccepted: boolean;
  coarseCollision: boolean;
  fineFallback?: number;
  finalGoal: number;
}

export interface RoundGoalBreakdown extends GoalBeautification {
  chapter: number;
  chapterBase: number;
  localRound: number;
  localMultiplier: number;
  neutralRawGoal: number;
  bossModifier: number;
  postBossRawGoal: number;
}

export type BossForRound = (round: number) => BossType | null | undefined;

const positiveInteger = (value: number): number => Math.max(1, Math.floor(value));

export function getChapterBaseGoal(chapter: number): number {
  const chapterIndex = positiveInteger(chapter) - 1;
  return CONFIG.baseTarget * Math.pow(CONFIG.targetGrowth, ROUNDS_PER_CHAPTER * chapterIndex);
}

export function getRawRoundGoal(globalRound: number): number {
  const { chapterNumber, chapterRound } = chapterPosition(globalRound);
  return getChapterBaseGoal(chapterNumber) * LOCAL_ROUND_GOAL_MULTIPLIERS[chapterRound - 1];
}

export function goalRoundingIncrement(rawGoal: number): number {
  const magnitude = Math.floor(Math.log10(Math.max(1, Math.abs(rawGoal))));
  return magnitude < 3 ? 25 : 50 * 10 ** (magnitude - 3);
}

/** Magnitude-scaled fine rounding tuned to the required two-leading-digit targets. */
export function prettyRoundGoal(rawGoal: number): number {
  // Below 1,000 the established 25-point grid remains useful. Above it,
  // snapping to every second grid line preserves the intended two-leading-
  // digit targets (1,759.2 -> 1,800; 25,521 -> 26,000).
  const baseIncrement = goalRoundingIncrement(rawGoal);
  const increment = Math.abs(rawGoal) < 1_000 ? baseIncrement : baseIncrement * 2;
  return Math.round(rawGoal / increment) * increment;
}

export function coarseGoalCandidate(rawGoal: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(rawGoal));
  return Math.round(rawGoal / magnitude) * magnitude;
}

function provisionalBeautifiedGoal(rawGoal: number): number {
  const coarseCandidate = coarseGoalCandidate(rawGoal);
  const deviation = Math.abs(coarseCandidate - rawGoal) / rawGoal;
  return deviation <= MAX_COARSE_GOAL_DEVIATION ? coarseCandidate : prettyRoundGoal(rawGoal);
}

/**
 * Beautifies a fully modified raw Goal. Neighbor comparisons use their
 * tolerance-only provisional values, so every Round gets the same result
 * regardless of generation order.
 */
export function beautifyGoal(rawGoal: number, adjacentRawGoals: readonly number[] = []): GoalBeautification {
  if (!Number.isFinite(rawGoal) || rawGoal <= 0) throw new Error('A raw Goal must be a positive finite number.');
  const coarseCandidate = coarseGoalCandidate(rawGoal);
  const coarseDeviation = Math.abs(coarseCandidate - rawGoal) / rawGoal;
  const withinTolerance = coarseDeviation <= MAX_COARSE_GOAL_DEVIATION;
  const coarseCollision = withinTolerance && adjacentRawGoals.some(adjacentRawGoal =>
    adjacentRawGoal !== rawGoal && provisionalBeautifiedGoal(adjacentRawGoal) === coarseCandidate);
  const coarseAccepted = withinTolerance && !coarseCollision;
  const fineFallback = coarseAccepted ? undefined : prettyRoundGoal(rawGoal);
  return {
    coarseCandidate, coarseDeviation, coarseAccepted, coarseCollision, fineFallback,
    finalGoal: coarseAccepted ? coarseCandidate : fineFallback!,
  };
}

function postBossRawGoal(round: number, boss: BossType | null | undefined): number {
  const neutralRawGoal = getRawRoundGoal(round);
  return boss ? applyBossGoalModifier(boss, neutralRawGoal) : neutralRawGoal;
}

export function getRoundGoalBreakdown(globalRound: number, boss: BossType | null = null,
  bossForRound: BossForRound = () => null): RoundGoalBreakdown {
  const round = positiveInteger(globalRound);
  const { chapterNumber, chapterRound } = chapterPosition(round);
  const chapterBase = getChapterBaseGoal(chapterNumber);
  const localMultiplier = LOCAL_ROUND_GOAL_MULTIPLIERS[chapterRound - 1];
  const neutralRawGoal = chapterBase * localMultiplier;
  const bossModifier = boss ? bossGoalModifier(boss) : 1;
  const postBossRawGoalValue = boss ? applyBossGoalModifier(boss, neutralRawGoal) : neutralRawGoal;
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
    bossModifier,
    postBossRawGoal: postBossRawGoalValue,
    ...beautifyGoal(postBossRawGoalValue, adjacentRawGoals),
  };
}

export function targetForRound(globalRound: number, boss: BossType | null = null,
  bossForRound?: BossForRound): number {
  return getRoundGoalBreakdown(globalRound, boss, bossForRound).finalGoal;
}
