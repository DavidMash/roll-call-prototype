import { HAND_IDS, LOWER_HAND_IDS, UPPER_HAND_IDS } from './hands';
import type { ActiveFlame, Die, Flame, GameState, HandId, XMultFactor } from './types';

export interface FlameDefinition {
  name: string;
  shortName: string;
  description: string;
  bonfireDescription: string;
  affectsXMult: boolean;
}
export const FLAMES: Record<Flame, FlameDefinition> = {
  ultimate: { name: 'Ultimate', shortName: 'ULT', affectsXMult: true, description: 'Scores in a highest-level hand: scale XMult from ×1 to ×3.', bonfireDescription: 'Every highest-level hand receives ×3.' },
  minigun: { name: 'Minigun', shortName: 'MINI', affectsXMult: true, description: 'Scores in an Upper hand: scale XMult from ×1 to ×3.', bonfireDescription: 'Every Upper hand receives ×3.' },
  hailMary: { name: 'Hail Mary', shortName: 'HAIL', affectsXMult: true, description: 'Scores with 0 manual rerolls left: scale XMult from ×1 to ×3.', bonfireDescription: 'Every hand played with 0 rerolls receives ×3.' },
  charge: { name: 'Charge', shortName: 'CHG', affectsXMult: true, description: 'This die’s gameplay rolls store up to +0.5 XMult each; arm it for a hand.', bonfireDescription: 'Every gameplay die roll adds +0.5 to the global meter.' },
  personalTrainer: { name: 'Personal Trainer', shortName: 'TRAIN', affectsXMult: false, description: 'When this die scores, up to a 75% chance to train the hand after scoring.', bonfireDescription: 'Every played hand gets one 75% training check.' },
  dragonsHoard: { name: "Dragon's Hoard", shortName: 'HOARD', affectsXMult: true, description: 'When this die scores, held Gold and investment scale XMult up to ×3.', bonfireDescription: 'Every hand receives the held-Gold factor, capped at ×3.' },
  wellTrained: { name: 'Well Trained', shortName: 'WELL', affectsXMult: true, description: 'When this die scores, previous plays scale XMult up to ×3.', bonfireDescription: 'Every hand receives its play-history factor, capped at ×3.' },
  targetPractice: { name: 'Target Practice', shortName: 'TARGET', affectsXMult: true, description: 'Scores in the round target: scale XMult from ×1 to ×5.', bonfireDescription: 'The round target globally receives ×5.' },
  hotStreak: { name: 'Hot Streak', shortName: 'STREAK', affectsXMult: true, description: 'Complete the Lower-hand sequence with this die to build a per-round chain.', bonfireDescription: 'The Lower-hand sequence no longer requires a particular die.' },
  moneyToBurn: { name: 'Money to Burn', shortName: 'BURN', affectsXMult: true, description: 'When this die scores, lifetime normal-shop spend scales XMult up to ×3.', bonfireDescription: 'Every hand receives the shop-spend factor.' },
  lowball: { name: 'Lowball', shortName: 'LOW', affectsXMult: true, description: 'When this die scores, low printed values average into up to ×3.', bonfireDescription: 'Every normal hand receives its printed-value tier.' },
  straightShooter: { name: 'Straight Shooter', shortName: 'STR8', affectsXMult: true, description: 'Scores in Small or Large Straight: scale XMult from ×1 to ×3.', bonfireDescription: 'Every Small or Large Straight receives ×3.' },
  doubleDown: { name: 'Double Down', shortName: 'DBL', affectsXMult: true, description: 'Scores in Pair or Two Pair: scale XMult from ×1 to ×3.', bonfireDescription: 'Every Pair and Two Pair receives ×3.' },
};
export const FLAME_IDS = Object.keys(FLAMES) as Flame[];
export const XMult_FLAME_IDS = FLAME_IDS.filter(flame => FLAMES[flame].affectsXMult);
export const HOT_STREAK_SEQUENCE: HandId[] = ['pair', 'twoPair', 'threeKind', 'smallStraight', 'fullHouse', 'fourKind', 'largeStraight', 'fiveKind'];
export const flameProgress = (investedGold: number) => Math.max(0, Math.min(100, investedGold)) / 100;
export const standardFlameMultiplier = (investedGold: number) => 1 + 2 * flameProgress(investedGold);
export const targetPracticeMultiplier = (investedGold: number) => 1 + 4 * flameProgress(investedGold);
export const trainerChance = (investedGold: number) => 0.75 * flameProgress(investedGold);
export const chargeGainPerRoll = (investedGold: number) => 0.5 * flameProgress(investedGold);
export const dragonsHoardMultiplier = (investedGold: number, gold: number) => 1 + 2 * flameProgress(investedGold) * Math.min(Math.max(gold, 0) / 100, 1);
export const wellTrainedMultiplier = (investedGold: number, previousPlays: number) => Math.min(3, 1 + previousPlays * 0.1 * flameProgress(investedGold));
export const moneyToBurnMultiplier = (investedGold: number, lifetimeSpend: number) => 1 + 2 * flameProgress(investedGold) * Math.min(Math.max(lifetimeSpend, 0) / 100, 1);
export function lowballFullMultiplier(averageFace: number): number {
  if (averageFace <= 2) return 3;
  if (averageFace <= 3) return 2.5;
  if (averageFace <= 4) return 2;
  if (averageFace <= 5) return 1.5;
  return 1;
}
export const lowballMultiplier = (investedGold: number, averageFace: number) =>
  1 + (lowballFullMultiplier(averageFace) - 1) * flameProgress(investedGold);
export const isFlame = (value: unknown): value is Flame => typeof value === 'string' && Object.hasOwn(FLAMES, value);
export const activeFlameId = (flame: ActiveFlame | null | unknown): Flame | null => {
  if (!flame) return null;
  if (typeof flame === 'object' && 'id' in flame && isFlame((flame as { id: unknown }).id)) return (flame as ActiveFlame).id;
  return isFlame(flame) ? flame : null;
};
export const activeFlameInvestment = (flame: ActiveFlame | null | unknown) =>
  typeof flame === 'object' && flame !== null && 'investedGold' in flame && Number.isFinite((flame as ActiveFlame).investedGold)
    ? Math.max(0, Math.min(100, (flame as ActiveFlame).investedGold)) : 0;
export const hasOwnedFlame = (state: Pick<GameState, 'dice' | 'bonfires'>, id: Flame) =>
  state.bonfires.includes(id) || state.dice.some(die => activeFlameId(die.flame) === id);
export const hasXMultFlame = (dice: Die[], bonfires: Flame[] = []) =>
  bonfires.some(id => FLAMES[id]?.affectsXMult) || dice.some(die => {
    const id = activeFlameId(die.flame);
    return id !== null && FLAMES[id].affectsXMult;
  });

export interface HandStartSnapshot {
  gold: number;
  manualRerollsRemaining: number;
  previousPlays: number;
  highestHandLevel: number;
  targetPracticeHand: HandId | null;
  hotStreakGoal: HandId | null;
  hotStreakCharges: number;
  chargeXMult: number;
  chargeArmed: boolean;
  lifetimeNormalShopGoldSpent: number;
  bonfires: Flame[];
  dice: { dieId: number; flame: Flame | null; investedGold: number; faceValue: number }[];
}

export function captureHandStart(state: Pick<GameState, 'gold' | 'manualRerollsRemaining' | 'handPlayCounts' | 'handLevels' | 'targetPracticeHand' | 'hotStreakGoal' | 'hotStreakCharges' | 'chargeXMult' | 'chargeArmed' | 'bonfires' | 'dice' | 'lifetimeNormalShopGoldSpent'>, hand: HandId): HandStartSnapshot {
  return {
    gold: state.gold,
    manualRerollsRemaining: state.manualRerollsRemaining,
    previousPlays: state.handPlayCounts[hand],
    highestHandLevel: Math.max(...HAND_IDS.map(id => state.handLevels[id])),
    targetPracticeHand: state.targetPracticeHand,
    hotStreakGoal: state.hotStreakGoal,
    hotStreakCharges: state.hotStreakCharges,
    chargeXMult: state.chargeXMult,
    chargeArmed: state.chargeArmed,
    lifetimeNormalShopGoldSpent: state.lifetimeNormalShopGoldSpent,
    bonfires: [...state.bonfires],
    dice: state.dice.map(die => ({ dieId: die.id, flame: activeFlameId(die.flame), investedGold: activeFlameInvestment(die.flame), faceValue: die.value })),
  };
}

const qualifies = (id: Flame, snapshot: HandStartSnapshot, hand: HandId, handLevel: number) => {
  switch (id) {
    case 'ultimate': return handLevel === snapshot.highestHandLevel;
    case 'minigun': return UPPER_HAND_IDS.includes(hand);
    case 'hailMary': return snapshot.manualRerollsRemaining === 0;
    case 'targetPractice': return hand === snapshot.targetPracticeHand;
    case 'straightShooter': return hand === 'smallStraight' || hand === 'largeStraight';
    case 'doubleDown': return hand === 'pair' || hand === 'twoPair';
    case 'hotStreak': return hand === snapshot.hotStreakGoal;
    default: return true;
  }
};
function factorValue(id: Flame, investedGold: number, snapshot: HandStartSnapshot, scoringDieIds: number[]): number {
  switch (id) {
    case 'targetPractice': return targetPracticeMultiplier(investedGold);
    case 'dragonsHoard': return dragonsHoardMultiplier(investedGold, snapshot.gold);
    case 'wellTrained': return wellTrainedMultiplier(investedGold, snapshot.previousPlays);
    case 'moneyToBurn': return moneyToBurnMultiplier(investedGold, snapshot.lifetimeNormalShopGoldSpent);
    case 'lowball': {
      const scorers = snapshot.dice.filter(die => scoringDieIds.includes(die.dieId));
      const average = scorers.reduce((sum, die) => sum + die.faceValue, 0) / Math.max(1, scorers.length);
      return lowballMultiplier(investedGold, average);
    }
    case 'hotStreak': return 1 + (snapshot.hotStreakCharges + 1) * 0.5 * flameProgress(investedGold);
    default: return standardFlameMultiplier(investedGold);
  }
}
function factorInput(id: Flame, snapshot: HandStartSnapshot, scoringDieIds: number[]): { input?: number; detail?: string } {
  if (id === 'dragonsHoard') return { input: snapshot.gold, detail: `${snapshot.gold} held Gold at hand start` };
  if (id === 'wellTrained') return { input: snapshot.previousPlays, detail: `${snapshot.previousPlays} previous plays` };
  if (id === 'moneyToBurn') return { input: snapshot.lifetimeNormalShopGoldSpent, detail: `${snapshot.lifetimeNormalShopGoldSpent} lifetime normal-shop Gold spent` };
  if (id === 'lowball') {
    const scorers = snapshot.dice.filter(die => scoringDieIds.includes(die.dieId));
    const average = scorers.reduce((sum, die) => sum + die.faceValue, 0) / Math.max(1, scorers.length);
    const formattedAverage = Number(average.toFixed(4));
    return { input: formattedAverage, detail: `${formattedAverage} average printed face` };
  }
  if (id === 'hotStreak') return { input: snapshot.hotStreakCharges + 1, detail: `successful sequence charge ${snapshot.hotStreakCharges + 1}` };
  return {};
}
export function handXMultContributions(snapshot: HandStartSnapshot, hand: HandId, handLevel: number, scoringDieIds: number[]): XMultFactor[] {
  const scoring = new Set(scoringDieIds);
  const result: XMultFactor[] = [];
  if (snapshot.chargeArmed && snapshot.chargeXMult > 1) result.push({ source: 'charge', value: snapshot.chargeXMult, dieId: null, detail: 'armed stored Charge' });
  for (const id of snapshot.bonfires) {
    if (!FLAMES[id]?.affectsXMult || id === 'charge' || !qualifies(id, snapshot, hand, handLevel)) continue;
    const value = factorValue(id, 100, snapshot, scoringDieIds);
    if (value > 1) {
      const context = factorInput(id, snapshot, scoringDieIds);
      result.push({ source: id, value, dieId: null, ...context, detail: `Bonfire${context.detail ? `; ${context.detail}` : ''}` });
    }
  }
  for (const die of snapshot.dice) {
    const id = die.flame;
    if (!id || !scoring.has(die.dieId) || !FLAMES[id].affectsXMult || id === 'charge' || !qualifies(id, snapshot, hand, handLevel)) continue;
    const value = factorValue(id, die.investedGold, snapshot, scoringDieIds);
    if (value > 1) result.push({ source: id, value, dieId: die.dieId, ...factorInput(id, snapshot, scoringDieIds) });
  }
  return result;
}
export const composeXMult = (factors: readonly (number | XMultFactor)[]) =>
  Number(factors.map(item => typeof item === 'number' ? item : item.value).sort((a, b) => a - b)
    .reduce((product, value) => product * value, 1).toFixed(12));
export const ownedFlameIds = (state: Pick<GameState, 'dice' | 'bonfires'>) => new Set<Flame>([
  ...state.bonfires,
  ...state.dice.map(die => activeFlameId(die.flame)).filter((id): id is Flame => id !== null),
]);
export const lowerHand = (hand: HandId) => LOWER_HAND_IDS.includes(hand);
