export const CONFIG = {
  diceCount: 5,
  baseTarget: 100,
  targetGrowth: 1.28,
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
  rerollCostGrowth: 2,
  bonusPips: 10,
  standaloneMultiplier: 1,
  goldenGold: 1,
  jackpotGold: 3,
  tickMs: { normal: 350, fast: 90, instant: 0 },
  resolutionEventCap: 10000,
} as const;
export const roundReward = (_round?: number) => CONFIG.roundRewardBase;
export const MINI_BOSS_REWARD_GOLD = 15;
export const BOSS_REWARD_GOLD = 20;
export const bossRewardForEncounter = (miniBoss: boolean) =>
  miniBoss ? MINI_BOSS_REWARD_GOLD : BOSS_REWARD_GOLD;
export const interestForGold = (heldGold: number) => Math.min(CONFIG.interestCap,
  Math.floor(Math.max(0, heldGold) / CONFIG.interestInterval));
export const diceRerollCost = (count: number) => CONFIG.diceRerollBase * CONFIG.rerollCostGrowth ** count;
export const offerRerollCost = (count: number) => CONFIG.offerRerollBase * CONFIG.rerollCostGrowth ** count;
export function lifeRestoreCost(purchases: number): number {
  if (!Number.isInteger(purchases) || purchases < 0) throw new Error('Life restore count must be a non-negative integer.');
  const opening = [25, 40, 60, 90];
  if (purchases < opening.length) return opening[purchases];
  let price = opening.at(-1)!;
  let increment = 40;
  for (let index = 4; index <= purchases; index++) { price += increment; increment += 10; }
  return price;
}
