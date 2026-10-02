import { describe, expect, it } from 'vitest';
import {
  bossAnchorForBlock, CONFIG, interestForGold, prettyRoundTarget, roundReward,
  TARGET_BLOCK_GROWTH, TARGET_BLOCK_RATIOS, targetForRound, targetRoundingIncrement,
} from './config';
import { newRun } from './engine';
import { enhancementCost } from './enhancements';

describe('prototype balance progression', () => {
  it('starts at 75 / 125 / 150 and uses the centralized three-round cadence', () => {
    expect(CONFIG.baseTarget).toBe(75);
    expect(CONFIG.baseBossTarget).toBe(150);
    expect(CONFIG.targetGrowth).toBe(1.32);
    expect(CONFIG.targetBlockSize).toBe(3);
    expect(CONFIG.targetRounding).toBe(5);
    expect(TARGET_BLOCK_RATIOS).toEqual([1 / 2, 5 / 6, 1]);
    expect(Array.from({ length: 9 }, (_, index) => targetForRound(index + 1)))
      .toEqual([75, 125, 150, 175, 300, 350, 400, 675, 800]);
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

  it('keeps approximately 32% equivalent per-round growth between Boss anchors', () => {
    expect(TARGET_BLOCK_GROWTH).toBeCloseTo(2.299968, 12);
    const equivalentGrowth = (bossAnchorForBlock(10) / bossAnchorForBlock(9)) ** (1 / 3);
    expect(equivalentGrowth).toBeCloseTo(1.32, 2);
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
      expect(bossAnchorForBlock(block)).toBe(prettyRoundTarget(150 * (1.32 ** 3) ** block));
    }
    expect(bossAnchorForBlock(3)).toBe(1_800);
    expect(bossAnchorForBlock(3)).not.toBe(1_850); // recursively growing rounded 350 and 800 anchors would drift here
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
