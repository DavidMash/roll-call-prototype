export const CONFIG = {
  diceCount: 5,
  baseTarget: 50,
  targetGrowth: 1.35,
  targetRounding: 5,
  startingGold: 0,
  maxLives: 3,
  manualRerollsPerRound: 3,
  roundRewardBase: 5,
  bossRewardGold: 10,
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
  resolutionEventCap: 10000,
} as const;

export const targetForRound = (round: number) =>
  Math.round(CONFIG.baseTarget * CONFIG.targetGrowth ** (round - 1) / CONFIG.targetRounding) * CONFIG.targetRounding;
export const roundReward = (_round?: number) => CONFIG.roundRewardBase;
export const interestForGold = (heldGold: number) => Math.min(CONFIG.interestCap,
  Math.floor(Math.max(0, heldGold) / CONFIG.interestInterval));
export const diceRerollCost = (count: number) => CONFIG.diceRerollBase * CONFIG.rerollCostGrowth ** count;
export const offerRerollCost = (count: number) => CONFIG.offerRerollBase * CONFIG.rerollCostGrowth ** count;
function escalatingTrainingCost(base: number, purchases: number): number {
  if (!Number.isInteger(purchases) || purchases < 0) throw new Error('Training purchase count must be a non-negative integer.');
  return base * 2 ** purchases;
}
export const handTrainingCost = (purchases: number) => escalatingTrainingCost(CONFIG.handTrainingCost, purchases);
export const teamTrainingCost = (purchases: number) => escalatingTrainingCost(CONFIG.teamTrainingCost, purchases);
export function lifeRestoreCost(purchases: number): number {
  if (!Number.isInteger(purchases) || purchases < 0) throw new Error('Life restore count must be a non-negative integer.');
  const opening = [25, 40, 60, 90];
  if (purchases < opening.length) return opening[purchases];
  let price = opening.at(-1)!;
  let increment = 40;
  for (let index = 4; index <= purchases; index++) { price += increment; increment += 10; }
  return price;
}
