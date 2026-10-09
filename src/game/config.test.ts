import { describe, expect, it } from 'vitest';
import {
  baseTargetForRound, bossAnchorForBlock, CONFIG, interestForGold, prettyRoundTarget,
  rawBossAnchorForBlock, rawTargetForRound, roundReward, TARGET_BLOCK_GROWTH,
  TARGET_BLOCK_RATIOS, targetForRound, targetRoundingIncrement,
} from './config';
import { targetForBoss } from './bosses';
import { newRun } from './engine';
import { enhancementCost } from './enhancements';

describe('prototype balance progression', () => {
  it('starts at 100 / 175 / 200 and uses the centralized three-round cadence', () => {
    expect(CONFIG.baseTarget).toBe(100);
    expect(CONFIG.baseBossTarget).toBe(200);
    expect(CONFIG.targetGrowth).toBe(1.28);
    expect(CONFIG.targetBlockSize).toBe(3);
    expect(CONFIG.targetRounding).toBe(5);
    expect(newRun('target-r1').state.target).toBe(100);
    expect(TARGET_BLOCK_RATIOS).toEqual([1 / 2, 5 / 6, 1]);
    expect(Array.from({ length: 9 }, (_, index) => targetForRound(index + 1)))
      .toEqual([100, 175, 200, 200, 350, 425, 450, 725, 875]);
  });

  it('derives every block from one raw Boss anchor at 1/2, 5/6, and 1', () => {
    for (let block = 0; block < 12; block++) {
      const rawAnchor = rawBossAnchorForBlock(block);
      const firstRound = block * 3 + 1;
      expect(rawTargetForRound(firstRound)).toBeCloseTo(rawAnchor / 2, 9);
      expect(rawTargetForRound(firstRound + 1)).toBeCloseTo(rawAnchor * 5 / 6, 9);
      expect(rawTargetForRound(firstRound + 2)).toBeCloseTo(rawAnchor, 9);
      expect(targetForRound(firstRound)).toBe(prettyRoundTarget(rawAnchor / 2));
      expect(targetForRound(firstRound + 1)).toBe(prettyRoundTarget(rawAnchor * 5 / 6));
      expect(targetForRound(firstRound + 2)).toBe(bossAnchorForBlock(block));
    }
  });

  it('uses exactly 28% equivalent per-round growth between unrounded Boss anchors', () => {
    expect(TARGET_BLOCK_GROWTH).toBeCloseTo(2.097152, 12);
    const equivalentGrowth = (rawBossAnchorForBlock(10) / rawBossAnchorForBlock(9)) ** (1 / 3);
    expect(equivalentGrowth).toBeCloseTo(1.28, 12);
  });

  it('follows the deterministic unmodified 28% smooth curve before shaping and rounding', () => {
    for (const [round, expected] of [[1, 100], [12, 1_511.1572745182868], [24, 29_230.03274661807],
      [36, 565_391.0607290835], [42, 2_486_616.1820489354], [48, 10_936_253.62391507],
      [60, 211_537_910.01287982]] as const)
      expect(baseTargetForRound(round)).toBeCloseTo(expected, 8);
  });

  it('pretty-rounds every magnitude band and continues the pattern into trillions', () => {
    expect([999, 1_000, 9_999, 10_000, 99_999, 100_000, 999_999, 1_000_000, 9_999_999,
      10_000_000, 99_999_999, 100_000_000, 999_999_999, 1_000_000_000, 9_999_999_999,
      10_000_000_000, 1_000_000_000_000].map(targetRoundingIncrement))
      .toEqual([25, 50, 50, 500, 500, 5_000, 5_000, 50_000, 50_000,
        500_000, 500_000, 5_000_000, 5_000_000, 50_000_000, 50_000_000,
        500_000_000, 50_000_000_000]);
    expect([487.5, 1_792, 41_754, 972_786, 4_695_452, 22_664_052, 528_029_013,
      1_234_000_000_000].map(prettyRoundTarget))
      .toEqual([500, 1_800, 42_000, 975_000, 4_700_000, 22_500_000, 530_000_000,
        1_250_000_000_000]);
  });

  it('calculates later Boss anchors from the unrounded base formula without accumulated drift', () => {
    for (const block of [1, 5, 10, 15, 20]) {
      expect(bossAnchorForBlock(block)).toBe(prettyRoundTarget(200 * (1.28 ** 3) ** block));
    }
    expect(bossAnchorForBlock(3)).toBe(1_850);
    expect(bossAnchorForBlock(3)).not.toBe(1_875); // recursively growing rounded anchors would drift here
  });

  it('applies local and Boss shaping before the single authoritative pretty rounding step', () => {
    const rawLocal = rawTargetForRound(6);
    expect(rawLocal).toBeCloseTo(419.4304, 10);
    expect(targetForRound(6)).toBe(425);
    expect(targetForBoss('marathon', rawLocal)).toBe(1_250);
    expect(targetForBoss('tightrope', rawLocal)).toBe(200);
    expect(targetForBoss('tightrope', targetForRound(6))).toBe(225);
  });

  it('never exposes decimal authoritative targets for normal or Boss encounters', () => {
    for (let round = 1; round <= 180; round++) {
      expect(Number.isInteger(targetForRound(round))).toBe(true);
      for (const boss of ['marathon', 'quickdraw', 'tightrope', 'caller', 'warden'] as const)
        expect(Number.isInteger(targetForBoss(boss, rawTargetForRound(round)))).toBe(true);
    }
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
