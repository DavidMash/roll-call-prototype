import { describe, expect, it } from 'vitest';
import { ALL_BOSS_TYPES, bossGoalModifier } from './bosses';
import { chapterPosition } from './chapters';
import { CONFIG } from './config';
import { Decimal } from './scoreMath';
import {
  beautifyGoal, getChapterBaseGoal, getRawRoundGoal, getRoundGoalBreakdown, goalRoundingIncrement,
  getEncounterGoalBreakdown, LOCAL_ROUND_GOAL_MULTIPLIERS, MAX_COARSE_GOAL_DEVIATION, prettyRoundGoal, targetForRound,
} from './goals';

const EXPECTED_CHAPTERS = [
  [100n, 150n, 200n, 250n, 300n, 400n],
  [450n, 700n, 900n, 1_100n, 1_300n, 1_800n],
  [2_000n, 3_000n, 4_000n, 5_000n, 6_000n, 8_000n],
  [9_000n, 13_000n, 17_000n, 20_000n, 26_000n, 34_000n],
  [40_000n, 60_000n, 70_000n, 90_000n, 110_000n, 150_000n],
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
    expect(getChapterBaseGoal(1)).toBe('100');
    expect(CONFIG.targetGrowth ** 6).toBeCloseTo(4.398046511104, 12);
    for (let chapter = 2; chapter <= 40; chapter++) {
      expect(new Decimal(getChapterBaseGoal(chapter)).div(getChapterBaseGoal(chapter - 1)).toNumber())
        .toBeCloseTo(CONFIG.targetGrowth ** 6, 12);
      expect(new Decimal(getChapterBaseGoal(chapter))
        .div(String(100 * Math.pow(1.28, 6 * (chapter - 1)))).toNumber()).toBeCloseTo(1, 12);
    }
  });

  it('uses all six local multipliers before beautification', () => {
    expect(LOCAL_ROUND_GOAL_MULTIPLIERS).toEqual([1, 1.5, 2, 2.5, 3, 4]);
    for (let localRound = 1; localRound <= 6; localRound++) {
      expect(getRawRoundGoal(localRound))
        .toBe(new Decimal(getChapterBaseGoal(1)).times(LOCAL_ROUND_GOAL_MULTIPLIERS[localRound - 1]).toFixed());
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
      const differences = LOCAL_ROUND_GOAL_MULTIPLIERS.map((multiplier, index) =>
        new Decimal(multiplier).div(oldMultipliers[index]).minus(1).times(100).toNumber());
      expect(differences).toEqual(expectedDifferences);
    }
  });
});

describe('Goal beautification', () => {
  it('accepts coarse rounding at and below 7.5 percent', () => {
    const exactThresholdRaw = 1_000 / (1 - MAX_COARSE_GOAL_DEVIATION);
    expect(beautifyGoal(659.7)).toMatchObject({ coarseCandidate: 700n, coarseAccepted: true, finalGoal: 700n });
    expect(beautifyGoal(exactThresholdRaw).coarseDeviation).toBeCloseTo(0.075, 12);
    expect(beautifyGoal(exactThresholdRaw).coarseAccepted).toBe(true);
  });

  it('rejects coarse rounding above 7.5 percent and uses the required fine fallback', () => {
    expect(beautifyGoal(1_000 / 0.9249).coarseAccepted).toBe(false);
    expect([1_099.5, 1_319.4, 1_759.2, 12_760, 25_521, 149_658]
      .map(raw => beautifyGoal(raw).finalGoal))
      .toEqual([1_100n, 1_300n, 1_800n, 13_000n, 26_000n, 150_000n]);
    expect([999, 1_000, 9_999, 10_000, 99_999, 100_000, 999_999, 1_000_000, 9_999_999,
      10_000_000, 99_999_999, 100_000_000, 999_999_999, 1_000_000_000, 9_999_999_999,
      10_000_000_000, 1_000_000_000_000].map(goalRoundingIncrement))
      .toEqual([25n, 50n, 50n, 500n, 500n, 5_000n, 5_000n, 50_000n, 50_000n,
        500_000n, 500_000n, 5_000_000n, 5_000_000n, 50_000_000n, 50_000_000n,
        500_000_000n, 50_000_000_000n]);
    expect([487.5, 1_792, 41_754, 972_786, 4_695_452, 22_664_052, 528_029_013,
      1_234_000_000_000].map(prettyRoundGoal))
      .toEqual([500n, 1_800n, 42_000n, 970_000n, 4_700_000n, 23_000_000n, 530_000_000n,
        1_200_000_000_000n]);
  });

  it('uses deterministic lookahead to reject coarse collisions on both adjacent Rounds', () => {
    const round36 = getRoundGoalBreakdown(36);
    const round37 = getRoundGoalBreakdown(37);
    expect(round36).toMatchObject({ coarseCandidate: 700_000n, coarseAccepted: false,
      coarseCollision: true, fineFallback: 660_000n, finalGoal: 660_000n });
    expect(round37).toMatchObject({ coarseCandidate: 700_000n, coarseAccepted: false,
      coarseCollision: true, fineFallback: 720_000n, finalGoal: 720_000n });
    expect(getRoundGoalBreakdown(36)).toEqual(round36);
    expect(getRoundGoalBreakdown(37)).toEqual(round37);
    expect(targetForRound(37, null, round => round === 36 ? 'marathon' : null)).toBe(700_000n);
    expect(beautifyGoal(101, [102])).toMatchObject({ coarseAccepted: false,
      coarseCollision: true, fineFallback: 100n, finalGoal: 100n });
  });
});

describe('Boss Goal modifiers', () => {
  it('preserves every existing modifier definition', () => {
    expect(Object.fromEntries(ALL_BOSS_TYPES.map(boss => [boss, bossGoalModifier(boss)]))).toEqual({
      juggler: 1, capitalReturn: 1, neglected: 1, tightrope: 0.5, crawler: 1,
      magician: 1, pendulum: 1, caller: 1, warden: 1, hexer: 1, marathon: 3, quickdraw: 1 / 3,
      fly: 1, snakeEyes: 1, infected: 1,
    });
  });

  it('applies Boss modification to the new raw Goal before beautification', () => {
    const marathon = getRoundGoalBreakdown(6, 'marathon');
    expect(marathon).toMatchObject({ neutralRawGoal: '400', bossModifier: 3, postBossRawGoal: '1200',
      coarseAccepted: false, fineFallback: 1_200n, finalGoal: 1_200n });
    const quickdraw = getRoundGoalBreakdown(6, 'quickdraw');
    expect(quickdraw.neutralRawGoal).toBe('400');
    expect(quickdraw.bossModifier).toBe(1 / 3);
    expect(new Decimal(quickdraw.postBossRawGoal).toNumber()).toBeCloseTo(400 / 3, 12);
    expect(quickdraw.finalGoal).toBe(BigInt(125n));
    const tightrope = getRoundGoalBreakdown(3, 'tightrope');
    expect(tightrope).toMatchObject({ neutralRawGoal: '200', bossModifier: 0.5,
      postBossRawGoal: '100', finalGoal: 100n });
  });

  it('gives neutral Bosses the normal R3/R6 target and retains meaningful special behavior', () => {
    for (const round of [3, 6, 9, 12, 57, 60]) {
      for (const boss of ALL_BOSS_TYPES.filter(type => bossGoalModifier(type) === 1))
        expect(targetForRound(round, boss)).toBe(targetForRound(round));
    }
    expect(targetForRound(6, 'marathon')).toBeGreaterThan(targetForRound(6));
    expect(targetForRound(6, 'quickdraw')).toBeLessThan(targetForRound(6));
    expect(targetForRound(3, 'tightrope')).toBeLessThan(targetForRound(3));
    expect(getRoundGoalBreakdown(6, 'quickdraw').postBossRawGoal).toBe('133.33333333333333333333333333333333333333333333333333333333333333333333333333333');
  });

  it('routes silenced Bosses through the authoritative neutral Goal calculation', () => {
    const round = 6;
    const neutral = getRoundGoalBreakdown(round);
    expect(getEncounterGoalBreakdown(round, 'marathon', false).finalGoal)
      .toBe(getRoundGoalBreakdown(round, 'marathon').finalGoal);
    for (const boss of ['marathon', 'tightrope', 'quickdraw'] as const)
      expect(getEncounterGoalBreakdown(round, boss, true)).toEqual(neutral);
    expect(getEncounterGoalBreakdown(round, null, true)).toEqual(neutral);
    expect(getEncounterGoalBreakdown(round, null, false)).toEqual(neutral);
  });
});

describe('long-run Goal stability', () => {
  it('keeps representative deep Chapter Goals as deterministic exact integers', () => {
    const samples = [21, 22, 23, 32, 100, 500].map(chapter => {
      const round = (chapter - 1) * 6 + 1;
      const breakdown = getRoundGoalBreakdown(round);
      return { chapter, chapterBase: breakdown.chapterBase, neutralRawGoal: breakdown.neutralRawGoal,
        finalGoal: breakdown.finalGoal.toString() };
    });
    expect(samples.map(({ chapter, finalGoal }) => ({ chapter, finalGoal }))).toEqual([
      { chapter: 21, finalGoal: '730000000000000' },
      { chapter: 22, finalGoal: '3200000000000000' },
      { chapter: 23, finalGoal: '14000000000000000' },
      { chapter: 32, finalGoal: '9000000000000000000000' },
      { chapter: 100, finalGoal: '500000000000000000000000000000000000000000000000000000000000000000' },
      { chapter: 500, finalGoal: `1${'0'.repeat(323)}` },
    ]);
    expect(samples.every(sample => /^\d+(?:\.\d+)?$/.test(sample.chapterBase) && /^\d+$/.test(sample.finalGoal))).toBe(true);
  });

  it('preserves huge beautification collision and Boss-modifier behavior', () => {
    const zeros = '0'.repeat(40);
    const collision = beautifyGoal(`101${zeros}`, [`102${zeros}`]);
    expect(collision.coarseCollision).toBe(true);
    expect(collision.coarseAccepted).toBe(false);
    expect(collision.finalGoal % goalRoundingIncrement(`101${zeros}`)).toBe(0n);
    const round = (100 - 1) * 6 + 6;
    expect(getRoundGoalBreakdown(round, 'marathon').finalGoal).toBeGreaterThan(getRoundGoalBreakdown(round).finalGoal);
    expect(getRoundGoalBreakdown(round, 'quickdraw').finalGoal).toBeLessThan(getRoundGoalBreakdown(round).finalGoal);
    expect(getRoundGoalBreakdown(round, 'tightrope').finalGoal).toBeLessThan(getRoundGoalBreakdown(round).finalGoal);
  });

  it('is positive, finite, integral, and deterministic through late supported Chapters', () => {
    for (const chapter of [1, 10, 25, 50, 100]) {
      for (let localRound = 1; localRound <= 6; localRound++) {
        const round = (chapter - 1) * 6 + localRound;
        const first = getRoundGoalBreakdown(round);
        const second = getRoundGoalBreakdown(round);
        expect(second).toEqual(first);
        expect(new Decimal(first.neutralRawGoal).isFinite()).toBe(true);
        expect(new Decimal(first.neutralRawGoal).gt(0)).toBe(true);
        expect(first.finalGoal).toBeGreaterThan(0n);
      }
    }
  });

  it('continues magnitude-scaled fine rounding beyond billions', () => {
    for (const raw of [1.49658e9, 1.49658e12, 1.49658e20, 1.49658e40]) {
      const rounded = prettyRoundGoal(raw);
      expect(rounded).toBeGreaterThan(0n);
      expect(rounded % goalRoundingIncrement(raw)).toBe(0n);
    }
  });
});
