import { bossTypeForRound, isBigBossType, isMiniBossType } from './bosses';
import type { BigBossType, BossType, ChapterPlan, MiniBossType } from './types';

export const ROUNDS_PER_CHAPTER = 6;

export interface ChapterPosition {
  chapterNumber: number;
  chapterRound: number;
}

interface ChapterPlanningState {
  seed: string;
  bossSchedule: Partial<Record<number, BossType>>;
  chapterPlans: Partial<Record<number, ChapterPlan>>;
}

const positiveInteger = (value: number): number => Math.max(1, Math.floor(value));

export function chapterPosition(globalRound: number): ChapterPosition {
  const round = positiveInteger(globalRound);
  return {
    chapterNumber: Math.floor((round - 1) / ROUNDS_PER_CHAPTER) + 1,
    chapterRound: ((round - 1) % ROUNDS_PER_CHAPTER) + 1,
  };
}

export const chapterNumberForRound = (globalRound: number): number => chapterPosition(globalRound).chapterNumber;
export const chapterRoundForRound = (globalRound: number): number => chapterPosition(globalRound).chapterRound;
export const firstRoundOfChapter = (chapterNumber: number): number => (positiveInteger(chapterNumber) - 1) * ROUNDS_PER_CHAPTER + 1;

export function chapterEncounterRounds(chapterNumber: number): { miniBossRound: number; bossRound: number } {
  const firstRound = firstRoundOfChapter(chapterNumber);
  return { miniBossRound: firstRound + 2, bossRound: firstRound + 5 };
}

export function chapterLabel(globalRound: number): string {
  const { chapterNumber, chapterRound } = chapterPosition(globalRound);
  return `C${chapterNumber} R${chapterRound}`;
}

export function fullChapterLabels(globalRound: number): { chapter: string; round: string } {
  const { chapterNumber, chapterRound } = chapterPosition(globalRound);
  return { chapter: `CHAPTER ${chapterNumber}`, round: `ROUND ${chapterRound}` };
}

/**
 * Materializes both encounters together when a Chapter is first entered. The
 * existing deterministic tier-specific bags remain the source of selection.
 */
export function ensureChapterPlan(state: ChapterPlanningState, chapterNumber: number): ChapterPlan {
  const chapter = positiveInteger(chapterNumber);
  const existing = state.chapterPlans[chapter];
  if (existing) return existing;

  const { miniBossRound, bossRound } = chapterEncounterRounds(chapter);
  const scheduledMiniBoss = state.bossSchedule[miniBossRound];
  const scheduledBoss = state.bossSchedule[bossRound];
  const selectedMiniBoss = isMiniBossType(scheduledMiniBoss as BossType)
    ? scheduledMiniBoss as MiniBossType
    : bossTypeForRound(state.seed, miniBossRound) as MiniBossType;
  const selectedBoss = isBigBossType(scheduledBoss as BossType)
    ? scheduledBoss as BigBossType
    : bossTypeForRound(state.seed, bossRound) as BigBossType;
  const plan: ChapterPlan = { chapterNumber: chapter, miniBoss: selectedMiniBoss, boss: selectedBoss };
  state.chapterPlans[chapter] = plan;
  state.bossSchedule[miniBossRound] ??= selectedMiniBoss;
  state.bossSchedule[bossRound] ??= selectedBoss;
  return plan;
}
