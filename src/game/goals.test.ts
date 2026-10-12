import { describe, expect, it } from 'vitest';
import { ALL_BOSS_TYPES, applyBossGoalModifier, bossGoalModifier } from './bosses';
import { chapterPosition } from './chapters';
import { CONFIG } from './config';
import {
  beautifyGoal, getChapterBaseGoal, getRawRoundGoal, getRoundGoalBreakdown, goalRoundingIncrement,
  LOCAL_ROUND_GOAL_MULTIPLIERS, MAX_COARSE_GOAL_DEVIATION, prettyRoundGoal, targetForRound,
} from './goals';

const EXPECTED_CHAPTERS = [
  [100, 150, 200, 250, 300, 400],
  [450, 700, 900, 1_100, 1_300, 1_800],
  [2_000, 3_000, 4_000, 5_000, 6_000, 8_000],
  [9_000, 13_000, 17_000, 20_000, 26_000, 34_000],
  [40_000, 60_000, 70_000, 90_000, 110_000, 150_000],
] as const;

describe('Chapter Goal curve', () => {
  it('derives Chapter and local Round positions at every boundary', () => {
    expect([1, 3, 6, 7, 12, 13, 60].map(chapterPosition)).toEqual([
      { chapterNumber: 1, chapterRound: 1 },
      { chapterNumber: 1, chapterRound: 3 },
      { chapterNumber: 1, chapterRound: 6 },
      { chapterNumber: 2, chapterRound: 1 },
      { chapterNumber: 2, chapterRound: 6 },
      { chapterNumber: 3, chapterRound: 1 },
      { chapterNumber: 10, chapterRound: 6 },
    ]);
  });

  it('starts at exactly 100 and grows each Chapter by 1.28^6 without accumulated rounding', () => {
    expect(CONFIG.baseTarget).toBe(100);
    expect(CONFIG.targetGrowth).toBe(1.28);
    expect(getChapterBaseGoal(1)).toBe(100);
    expect(CONFIG.targetGrowth ** 6).toBeCloseTo(4.398046511104, 12);
    for (let chapter = 2; chapter <= 40; chapter++) {
      expect(getChapterBaseGoal(chapter) / getChapterBaseGoal(chapter - 1))
        .toBeCloseTo(CONFIG.targetGrowth ** 6, 12);
      expect(getChapterBaseGoal(chapter))
        .toBeCloseTo(100 * Math.pow(1.28, 6 * (chapter - 1)), 8);
    }
  });

  it('uses all six local multipliers before beautification', () => {
    expect(LOCAL_ROUND_GOAL_MULTIPLIERS).toEqual([1, 1.5, 2, 2.5, 3, 4]);
    for (let localRound = 1; localRound <= 6; localRound++) {
      expect(getRawRoundGoal(localRound))
        .toBe(getChapterBaseGoal(1) * LOCAL_ROUND_GOAL_MULTIPLIERS[localRound - 1]);
    }
  });

  it('matches the exact neutral targets for Chapters 1 through 5', () => {
    expect(EXPECTED_CHAPTERS.map((_, chapterIndex) =>
      Array.from({ length: 6 }, (_, localIndex) => targetForRound(chapterIndex * 6 + localIndex + 1))))
      .toEqual(EXPECTED_CHAPTERS);
  });

  it('keeps the intended pre-rounding structural differences from the replaced curve', () => {
    const oldMultipliers = [1, 5 / 3, 2, 1.28 ** 3, (5 / 3) * 1.28 ** 3, 2 * 1.28 ** 3];
    const expectedDifferences = [
      expect.closeTo(0, 10),
      expect.closeTo(-10, 10),
      expect.closeTo(0, 10),
      expect.closeTo(19.20928955078125, 10),
      expect.closeTo(-14.1693115234375, 10),
      expect.closeTo(-4.632568359375, 10),
    ];
    for (let chapter = 1; chapter <= 10; chapter++) {
      const chapterBase = getChapterBaseGoal(chapter);
      const differences = LOCAL_ROUND_GOAL_MULTIPLIERS.map((multiplier, index) =>
        ((chapterBase * multiplier) / (chapterBase * oldMultipliers[index]) - 1) * 100);
      expect(differences).toEqual(expectedDifferences);
    }
  });
});

describe('Goal beautification', () => {
  it('accepts coarse rounding at and below 7.5 percent', () => {
    const exactThresholdRaw = 1_000 / (1 - MAX_COARSE_GOAL_DEVIATION);
    expect(beautifyGoal(659.7)).toMatchObject({ coarseCandidate: 700, coarseAccepted: true, finalGoal: 700 });
    expect(beautifyGoal(exactThresholdRaw).coarseDeviation).toBeCloseTo(0.075, 12);
    expect(beautifyGoal(exactThresholdRaw).coarseAccepted).toBe(true);
  });

  it('rejects coarse rounding above 7.5 percent and uses the required fine fallback', () => {
    expect(beautifyGoal(1_000 / 0.9249).coarseAccepted).toBe(false);
    expect([1_099.5, 1_319.4, 1_759.2, 12_760, 25_521, 149_658]
      .map(raw => beautifyGoal(raw).finalGoal))
      .toEqual([1_100, 1_300, 1_800, 13_000, 26_000, 150_000]);
    expect([999, 1_000, 9_999, 10_000, 99_999, 100_000, 999_999, 1_000_000, 9_999_999,
      10_000_000, 99_999_999, 100_000_000, 999_999_999, 1_000_000_000, 9_999_999_999,
      10_000_000_000, 1_000_000_000_000].map(goalRoundingIncrement))
      .toEqual([25, 50, 50, 500, 500, 5_000, 5_000, 50_000, 50_000,
        500_000, 500_000, 5_000_000, 5_000_000, 50_000_000, 50_000_000,
        500_000_000, 50_000_000_000]);
    expect([487.5, 1_792, 41_754, 972_786, 4_695_452, 22_664_052, 528_029_013,
      1_234_000_000_000].map(prettyRoundGoal))
      .toEqual([500, 1_800, 42_000, 970_000, 4_700_000, 23_000_000, 530_000_000,
        1_200_000_000_000]);
  });

  it('uses deterministic lookahead to reject coarse collisions on both adjacent Rounds', () => {
    const round36 = getRoundGoalBreakdown(36);
    const round37 = getRoundGoalBreakdown(37);
    expect(round36).toMatchObject({ coarseCandidate: 700_000, coarseAccepted: false,
      coarseCollision: true, fineFallback: 660_000, finalGoal: 660_000 });
    expect(round37).toMatchObject({ coarseCandidate: 700_000, coarseAccepted: false,
      coarseCollision: true, fineFallback: 720_000, finalGoal: 720_000 });
    expect(getRoundGoalBreakdown(36)).toEqual(round36);
    expect(getRoundGoalBreakdown(37)).toEqual(round37);
    expect(targetForRound(37, null, round => round === 36 ? 'marathon' : null)).toBe(700_000);
    expect(beautifyGoal(101, [102])).toMatchObject({ coarseAccepted: false,
      coarseCollision: true, fineFallback: 100, finalGoal: 100 });
  });
});

describe('Boss Goal modifiers', () => {
  it('preserves every existing modifier definition', () => {
    expect(Object.fromEntries(ALL_BOSS_TYPES.map(boss => [boss, bossGoalModifier(boss)]))).toEqual({
      juggler: 1, capitalReturn: 1, neglected: 1, clockmaker: 1, tightrope: 0.5, crawler: 1,
      magician: 1, mugger: 1, caller: 1, warden: 1, hexer: 1, marathon: 3, quickdraw: 1 / 3,
      fly: 1, snakeEyes: 1, infected: 1,
    });
  });

  it('applies Boss modification to the new raw Goal before beautification', () => {
    const marathon = getRoundGoalBreakdown(6, 'marathon');
    expect(marathon).toMatchObject({ neutralRawGoal: 400, bossModifier: 3, postBossRawGoal: 1_200,
      coarseAccepted: false, fineFallback: 1_200, finalGoal: 1_200 });
    const quickdraw = getRoundGoalBreakdown(6, 'quickdraw');
    expect(quickdraw.neutralRawGoal).toBe(400);
    expect(quickdraw.bossModifier).toBe(1 / 3);
    expect(quickdraw.postBossRawGoal).toBeCloseTo(400 / 3, 12);
    expect(quickdraw.finalGoal).toBe(125);
    const tightrope = getRoundGoalBreakdown(3, 'tightrope');
    expect(tightrope).toMatchObject({ neutralRawGoal: 200, bossModifier: 0.5,
      postBossRawGoal: 100, finalGoal: 100 });
  });

  it('gives neutral Bosses the normal R3/R6 target and retains meaningful special behavior', () => {
    for (const round of [3, 6, 9, 12, 57, 60]) {
      for (const boss of ALL_BOSS_TYPES.filter(type => bossGoalModifier(type) === 1))
        expect(targetForRound(round, boss)).toBe(targetForRound(round));
    }
    expect(targetForRound(6, 'marathon')).toBeGreaterThan(targetForRound(6));
    expect(targetForRound(6, 'quickdraw')).toBeLessThan(targetForRound(6));
    expect(targetForRound(3, 'tightrope')).toBeLessThan(targetForRound(3));
    expect(applyBossGoalModifier('quickdraw', 3)).toBe(CONFIG.targetRounding);
  });
});

describe('long-run Goal stability', () => {
  it('is positive, finite, integral, and deterministic through late supported Chapters', () => {
    for (const chapter of [1, 10, 25, 50, 100]) {
      for (let localRound = 1; localRound <= 6; localRound++) {
        const round = (chapter - 1) * 6 + localRound;
        const first = getRoundGoalBreakdown(round);
        const second = getRoundGoalBreakdown(round);
        expect(second).toEqual(first);
        expect(Number.isFinite(first.neutralRawGoal)).toBe(true);
        expect(Number.isFinite(first.finalGoal)).toBe(true);
        expect(first.neutralRawGoal).toBeGreaterThan(0);
        expect(first.finalGoal).toBeGreaterThan(0);
        expect(Number.isInteger(first.finalGoal)).toBe(true);
      }
    }
  });

  it('continues magnitude-scaled fine rounding beyond billions', () => {
    for (const raw of [1.49658e9, 1.49658e12, 1.49658e20, 1.49658e40]) {
      const rounded = prettyRoundGoal(raw);
      expect(Number.isFinite(rounded)).toBe(true);
      expect(rounded).toBeGreaterThan(0);
      expect(rounded / goalRoundingIncrement(raw)).toBeCloseTo(Math.round(raw / goalRoundingIncrement(raw)), 8);
    }
  });
});
