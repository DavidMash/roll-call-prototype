import type { Enhancement } from './types';

export const CONFIG = {
  diceCount: 5,
  baseTarget: 50,
  targetGrowth: 1.35,
  targetRounding: 5,
  startingGold: 0,
  manualRerollsPerRound: 3,
  roundRewardBase: 5,
  roundRewardGrowth: 1,
  diceRerollBase: 1,
  offerRerollBase: 3,
  rerollCostGrowth: 2,
  bonusPips: 10,
  multiplierIncrement: 0.5,
  standaloneMultiplier: 1,
  goldenGold: 1,
  jackpotGold: 3,
  workoutIncrement: 1,
  tickMs: { normal: 350, fast: 90, instant: 0 },
  resolutionEventCap: 10000,
  enhancementCosts: {
    bonus: 3, multiplier: 5, jumpingBean: 2, golden: 2, workout: 3,
    missingLink: 2, mirror: 2, magnetic: 3, sticky: 1, slippy: 1,
    sustainable: 5, hitchhiker: 2, weighted: 3, jackpot: 3,
  } satisfies Record<Enhancement, number>,
} as const;

export const targetForRound = (round: number) =>
  Math.round(CONFIG.baseTarget * CONFIG.targetGrowth ** (round - 1) / CONFIG.targetRounding) * CONFIG.targetRounding;
export const roundReward = (round: number) => CONFIG.roundRewardBase + (round - 1) * CONFIG.roundRewardGrowth;
export const diceRerollCost = (count: number) => CONFIG.diceRerollBase * CONFIG.rerollCostGrowth ** count;
export const offerRerollCost = (count: number) => CONFIG.offerRerollBase * CONFIG.rerollCostGrowth ** count;
