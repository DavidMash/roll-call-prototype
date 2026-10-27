import { describe, expect, it } from 'vitest';
import { CONFIG, interestForGold, roundReward } from './config';
import { newRun } from './engine';

describe('prototype balance configuration', () => {
  it('keeps unrelated balance constants unchanged', () => {
    const { targetGrowth: _targetGrowth, baseTarget: _baseTarget, ...unchanged } = CONFIG;
    expect(unchanged).toEqual({
      diceCount: 5,
      targetRounding: 5,
      startingGold: 0,
      maxLives: 3,
      manualRerollsPerRound: 3,
      roundRewardBase: 5,
      interestInterval: 5,
      interestCap: 10,
      offerRerollBase: 3,
      rerollCostGrowth: 2,
      bonusPips: 4,
      workoutPipsPerScore: 2,
      tankPipsPerTrigger: 5,
      furnacePipsPerGoldPerLevel: 3,
      furnaceMaxGoldPerRound: 5,
      standaloneMultiplier: 1,
      goldenGold: 1,
      jackpotGold: 3,
      tickMs: { normal: 350, fast: 90, instant: 0 },
      scoringDieTickMs: { normal: 200, fast: 80, instant: 0 },
      resolutionEventCap: 1_000,
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

  it('keeps the Jackpot whole-die payout constant', () => {
    expect(CONFIG.jackpotGold).toBe(3);
  });
});
