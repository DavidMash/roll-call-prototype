import type { Enhancement, HandId } from './types';

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
  workoutIncrement: 1,
  weightedFactor: 3,
  tickMs: { normal: 350, fast: 90, instant: 0 },
  resolutionEventCap: 10000,
  enhancementCosts: {
    bonus: 3, multiplier: 5, jumpingBean: 2, golden: 2, workout: 3,
    missingLink: 2, mirror: 2, magnetic: 3, sticky: 1, slippy: 1,
    sustainable: 5, hitchhiker: 2, weighted: 3,
  } satisfies Record<Enhancement, number>,
  handMultipliers: {
    ones: 1, twos: 1, threes: 1, fours: 1, fives: 1, sixes: 1,
    pair: 1.5, twoPair: 2, threeKind: 2.5, smallStraight: 2.5,
    fullHouse: 3.5, fourKind: 4, largeStraight: 4, fiveKind: 5,
  } satisfies Record<HandId, number>,
} as const;

export const targetForRound = (round: number) =>
  Math.round(CONFIG.baseTarget * CONFIG.targetGrowth ** (round - 1) / CONFIG.targetRounding) * CONFIG.targetRounding;
export const roundReward = (round: number) => CONFIG.roundRewardBase + (round - 1) * CONFIG.roundRewardGrowth;
export const diceRerollCost = (count: number) => CONFIG.diceRerollBase * CONFIG.rerollCostGrowth ** count;
export const offerRerollCost = (count: number) => CONFIG.offerRerollBase * CONFIG.rerollCostGrowth ** count;
