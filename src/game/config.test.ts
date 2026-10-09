import { describe, expect, it } from 'vitest';
import {
  bossAnchorForBlock, CONFIG, interestForGold, prettyRoundTarget, roundReward,
  TARGET_BLOCK_GROWTH, TARGET_BLOCK_RATIOS, targetForRound, targetRoundingIncrement,
} from './config';
import { newRun } from './engine';
import { enhancementCost } from './enhancements';

describe('prototype balance progression', () => {
  it('starts at 100 / 175 / 200 and uses the centralized three-round cadence', () => {
    expect(CONFIG.baseTarget).toBe(100);
    expect(CONFIG.baseBossTarget).toBe(200);
    expect(CONFIG.targetGrowth).toBe(1.30);
    expect(CONFIG.targetBlockSize).toBe(3);
    expect(CONFIG.targetRounding).toBe(5);
    expect(TARGET_BLOCK_RATIOS).toEqual([1 / 2, 5 / 6, 1]);
    expect(Array.from({ length: 9 }, (_, index) => targetForRound(index + 1)))
      .toEqual([100, 175, 200, 225, 375, 450, 500, 825, 975]);
  });

  it('derives every block from one rounded Boss anchor at 1/2, 5/6, and 1', () => {
    for (let block = 0; block < 12; block++) {
      const anchor = bossAnchorForBlock(block);
      const firstRound = block * 3 + 1;
      expect(targetForRound(firstRound)).toBe(prettyRoundTarget(anchor / 2));
      expect(targetForRound(firstRound + 1)).toBe(prettyRoundTarget(anchor * 5 / 6));
      expect(targetForRound(firstRound + 2)).toBe(anchor);
    }
  });

  it('uses exactly 30% equivalent per-round growth between Boss anchors', () => {
    expect(TARGET_BLOCK_GROWTH).toBeCloseTo(2.197, 12);
    const equivalentGrowth = (bossAnchorForBlock(10) / bossAnchorForBlock(9)) ** (1 / 3);
    expect(equivalentGrowth).toBeCloseTo(1.30, 2);
  });

  it('follows the deterministic unmodified 30% smooth curve at later rounds', () => {
    const smoothBaseGoal = (round: number) =>
      Math.round(CONFIG.baseTarget * CONFIG.targetGrowth ** (round - 1));
    expect([1, 12, 24, 36, 42, 48, 60].map(smoothBaseGoal))
      .toEqual([100, 1_792, 41_754, 972_786, 4_695_452, 22_664_052, 528_029_013]);
  });

  it('pretty-rounds at multiple magnitudes with decade-scaled increments', () => {
    expect([999, 1_000, 9_999, 10_000, 99_999, 100_000, 1_000_000].map(targetRoundingIncrement))
      .toEqual([25, 50, 50, 500, 500, 5_000, 50_000]);
    expect([
      prettyRoundTarget(987), prettyRoundTarget(1_019), prettyRoundTarget(9_876),
      prettyRoundTarget(12_240), prettyRoundTarget(12_260), prettyRoundTarget(123_400),
    ]).toEqual([975, 1_000, 9_900, 12_000, 12_500, 125_000]);
  });

  it('calculates later Boss anchors from the unrounded base formula without accumulated drift', () => {
    for (const block of [1, 5, 10, 15, 20]) {
      expect(bossAnchorForBlock(block)).toBe(prettyRoundTarget(200 * (1.30 ** 3) ** block));
    }
    expect(bossAnchorForBlock(3)).toBe(2_100);
    expect(bossAnchorForBlock(3)).not.toBe(2_200); // recursively growing rounded anchors would drift here
  });

  it('keeps unrelated balance constants unchanged', () => {
    const { targetGrowth: _targetGrowth, ...unchanged } = CONFIG;
    expect(unchanged).toEqual({
      diceCount: 5,
      baseTarget: 100,
      baseBossTarget: 200,
      targetBlockSize: 3,
      targetRounding: 5,
      startingGold: 0,
      maxLives: 3,
      manualRerollsPerRound: 3,
      roundRewardBase: 5,
      infectedFacePipPenalty: 3,
      interestInterval: 5,
      interestCap: 10,
      diceRerollBase: 2,
      offerRerollBase: 3,
      handTrainingCost: 2,
      teamTrainingCost: 15,
      rerollCostGrowth: 2,
      bonusPips: 10,
      standaloneMultiplier: 1,
      goldenGold: 1,
      jackpotGold: 3,
      workoutIncrement: 1,
      tickMs: { normal: 350, fast: 90, instant: 0 },
      resolutionEventCap: 10_000,
    });
  });

  it('grants a flat five-gold base reward in every round', () => {
    expect(CONFIG.roundRewardBase).toBe(5);
    expect(Array.from({ length: 8 }, (_, index) => roundReward(index + 1)))
      .toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(roundReward(20)).toBe(5);
  });

  it('still starts a run with zero gold', () => {
    expect(CONFIG.startingGold).toBe(0);
    const result = newRun('balance-start');
    expect(result.events[0].board.gold).toBe(0);
    expect(result.state.gold).toBe(0);
    expect(result.state.stats.goldEarned).toBe(0);
  });

  it('pays one interest per five held Gold up to ten', () => {
    expect([0, 4, 5, 24, 25, 29, 30, 49, 50, 55, 1000].map(interestForGold))
      .toEqual([0, 0, 1, 4, 5, 5, 6, 9, 10, 10, 10]);
  });

  it('prices Jackpot at three gold and pays three gold per stack', () => {
    expect(enhancementCost('jackpot')).toBe(3);
    expect(CONFIG.jackpotGold).toBe(3);
  });
});
