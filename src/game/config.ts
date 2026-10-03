export const CONFIG = {
  diceCount: 5,
  baseTarget: 100,
  baseBossTarget: 200,
  targetGrowth: 1.32,
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
  resolutionEventCap: 10000,
} as const;

export const TARGET_BLOCK_RATIOS = [1 / 2, 5 / 6, 1] as const;
export const TARGET_BLOCK_GROWTH = CONFIG.targetGrowth ** CONFIG.targetBlockSize;

export function targetRoundingIncrement(rawTarget: number): number {
  const magnitude = Math.floor(Math.log10(Math.max(1, Math.abs(rawTarget))));
  return magnitude < 3 ? 25 : 50 * 10 ** (magnitude - 3);
}

export function prettyRoundTarget(rawTarget: number): number {
  const increment = targetRoundingIncrement(rawTarget);
  return Math.round(rawTarget / increment) * increment;
}

export function bossAnchorForBlock(block: number): number {
  const blockIndex = Math.max(0, Math.floor(block));
  return prettyRoundTarget(CONFIG.baseBossTarget * TARGET_BLOCK_GROWTH ** blockIndex);
}

export function targetForRound(round: number): number {
  const roundIndex = Math.max(0, Math.floor(round) - 1);
  const block = Math.floor(roundIndex / CONFIG.targetBlockSize);
  const position = roundIndex % CONFIG.targetBlockSize;
  return prettyRoundTarget(bossAnchorForBlock(block) * TARGET_BLOCK_RATIOS[position]);
}
export const roundReward = (_round?: number) => CONFIG.roundRewardBase;
export const bossRewardForRound = (round: number) => 9 + round / 3;
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
