import { describe, expect, it } from 'vitest';
import { CONFIG, roundReward, targetForRound } from './config';
import { newRun } from './engine';

describe('prototype balance progression', () => {
  it('uses a 50-point base, 1.35 growth, and targets rounded to five', () => {
    expect(CONFIG.baseTarget).toBe(50);
    expect(CONFIG.targetGrowth).toBe(1.35);
    expect(CONFIG.targetRounding).toBe(5);
    expect(Array.from({ length: 10 }, (_, index) => targetForRound(index + 1)))
      .toEqual([50, 70, 90, 125, 165, 225, 305, 410, 550, 745]);
  });

  it('continues using the same exponential formula in later rounds', () => {
    for (const round of [11, 15, 20, 30]) {
      expect(targetForRound(round)).toBe(Math.round(50 * 1.35 ** (round - 1) / 5) * 5);
      expect(targetForRound(round) % CONFIG.targetRounding).toBe(0);
    }
  });

  it('grants five gold for Round 1 and one more for each subsequent round', () => {
    expect(CONFIG.roundRewardBase).toBe(5);
    expect(CONFIG.roundRewardGrowth).toBe(1);
    expect(Array.from({ length: 8 }, (_, index) => roundReward(index + 1)))
      .toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(roundReward(20)).toBe(24);
  });

  it('still starts a run with zero gold', () => {
    expect(CONFIG.startingGold).toBe(0);
    const result = newRun('balance-start');
    expect(result.events[0].board.gold).toBe(0);
    expect(result.state.gold).toBe(0);
    expect(result.state.stats.goldEarned).toBe(0);
  });

  it('prices Jackpot at three gold and pays three gold per stack', () => {
    expect(CONFIG.enhancementCosts.jackpot).toBe(3);
    expect(CONFIG.jackpotGold).toBe(3);
  });
});
