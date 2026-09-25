import { activeFace } from './dice';
import { LOWER_HAND_IDS, ultimateHands, UPPER_HAND_IDS } from './hands';
import type { ActiveFlame, Board, Die, Flame, GameState, HandId, XMultFactor } from './types';

export interface FlameDefinition {
  name: string;
  shortName: string;
  description: string;
  bonfireDescription: string;
  affectsXMult: boolean;
}
export const FLAMES: Record<Flame, FlameDefinition> = {
  ultimate: { name: 'Ultimate', shortName: 'ULT', affectsXMult: true, description: 'Scores in one of your three Ultimate Hands: multiplies XMult by ×1 to ×5.', bonfireDescription: 'Your three Ultimate Hands globally multiply XMult by ×5.' },
  minigun: { name: 'Minigun', shortName: 'MINI', affectsXMult: true, description: 'Scores in an Upper hand: multiplies XMult by ×1 to ×5.', bonfireDescription: 'Every Upper hand multiplies XMult by ×5.' },
  hailMary: { name: 'Hail Mary', shortName: 'HAIL', affectsXMult: true, description: 'Scores with 0 manual rerolls left: multiplies XMult by ×1 to ×5.', bonfireDescription: 'Every hand played with 0 rerolls multiplies XMult by ×5.' },
  charge: { name: 'Charge', shortName: 'CHG', affectsXMult: true, description: 'This die’s gameplay rolls grow its stored factor by up to +1; arm it to multiply a hand’s XMult.', bonfireDescription: 'Every gameplay die roll grows the global stored factor by +1.' },
  personalTrainer: { name: 'Personal Trainer', shortName: 'TRAIN', affectsXMult: false, description: 'When this die scores, its training chance rises twice as fast, capped at 75%.', bonfireDescription: 'Every played hand gets one 75% training check.' },
  dragonsHoard: { name: "Dragon's Hoard", shortName: 'HOARD', affectsXMult: true, description: 'When this die scores, held Gold and investment multiply XMult by up to ×5.', bonfireDescription: 'Every hand receives the held-Gold factor, capped at ×5.' },
  wellTrained: { name: 'Well Trained', shortName: 'WELL', affectsXMult: true, description: 'When this die scores, previous plays and investment multiply XMult by up to ×5.', bonfireDescription: 'Every hand receives its play-history factor, capped at ×5.' },
  targetPractice: { name: 'Target Practice', shortName: 'TARGET', affectsXMult: true, description: 'Scores in the round target: multiplies XMult by ×1 to ×9.', bonfireDescription: 'The round target globally multiplies XMult by ×9.' },
  hotStreak: { name: 'Hot Streak', shortName: 'STREAK', affectsXMult: true, description: 'Complete the Lower-hand sequence with this die; each charge adds up to +1 inside its multiplicative factor.', bonfireDescription: 'The sequence no longer requires a particular die; each charge adds +1 inside its factor.' },
  moneyToBurn: { name: 'Money to Burn', shortName: 'BURN', affectsXMult: true, description: 'When this die scores, normal-shop spend and investment multiply XMult by up to ×5.', bonfireDescription: 'Every hand receives the shop-spend factor, capped at ×5.' },
  lowball: { name: 'Lowball', shortName: 'LOW', affectsXMult: true, description: 'When this die scores, low printed values multiply XMult by up to ×5.', bonfireDescription: 'Every normal hand receives its printed-value factor, up to ×5.' },
  straightShooter: { name: 'Straight Shooter', shortName: 'STR8', affectsXMult: true, description: 'Scores in Small or Large Straight: multiplies XMult by ×1 to ×5.', bonfireDescription: 'Every Small or Large Straight multiplies XMult by ×5.' },
  doubleDown: { name: 'Double Down', shortName: 'DBL', affectsXMult: true, description: 'Scores in Pair or Two Pair: multiplies XMult by ×1 to ×5.', bonfireDescription: 'Every Pair and Two Pair multiplies XMult by ×5.' },
};
export const FLAME_IDS = Object.keys(FLAMES) as Flame[];
export const XMult_FLAME_IDS = FLAME_IDS.filter(flame => FLAMES[flame].affectsXMult);
export const HOT_STREAK_SEQUENCE: HandId[] = ['pair', 'twoPair', 'threeKind', 'smallStraight', 'fullHouse', 'fourKind', 'largeStraight', 'fiveKind'];
export const flameProgress = (investedGold: number) => Math.max(0, Math.min(100, investedGold)) / 100;
export const standardFlameMultiplier = (investedGold: number) => 1 + 4 * flameProgress(investedGold);
export const targetPracticeMultiplier = (investedGold: number) => 1 + 8 * flameProgress(investedGold);
export const trainerChance = (investedGold: number) => Math.min(0.75, 1.5 * flameProgress(investedGold));
export const chargeGainPerRoll = (investedGold: number) => flameProgress(investedGold);
export const dragonsHoardMultiplier = (investedGold: number, gold: number) => 1 + 4 * flameProgress(investedGold) * Math.min(Math.max(gold, 0) / 100, 1);
export const wellTrainedMultiplier = (investedGold: number, previousPlays: number) => Math.min(5, 1 + previousPlays * 0.2 * flameProgress(investedGold));
export const moneyToBurnMultiplier = (investedGold: number, lifetimeSpend: number) => 1 + 4 * flameProgress(investedGold) * Math.min(Math.max(lifetimeSpend, 0) / 100, 1);
export const hotStreakMultiplier = (investedGold: number, charges: number) => 1 + Math.max(0, charges) * flameProgress(investedGold);
export function lowballFullMultiplier(averageFace: number): number {
  if (averageFace <= 2) return 3;
  if (averageFace <= 3) return 2.5;
  if (averageFace <= 4) return 2;
  if (averageFace <= 5) return 1.5;
  return 1;
}
export const lowballMultiplier = (investedGold: number, averageFace: number) =>
  1 + 2 * (lowballFullMultiplier(averageFace) - 1) * flameProgress(investedGold);
const displayNumber = (value: number) => Number(value.toFixed(4));
type FlameDisplayContext = Pick<Board, 'gold' | 'lifetimeNormalShopGoldSpent'>;
export function flameEffectText(id: Flame, investedGold: number, board: FlameDisplayContext): string {
  switch (id) {
    case 'personalTrainer': return `${displayNumber(trainerChance(investedGold) * 100)}% training chance`;
    case 'charge': return `Stored factor +${displayNumber(chargeGainPerRoll(investedGold))} per gameplay roll`;
    case 'targetPractice': return `×${displayNumber(targetPracticeMultiplier(investedGold))} XMult on the round target`;
    case 'dragonsHoard': return `×${displayNumber(dragonsHoardMultiplier(investedGold, board.gold))} XMult at ${board.gold} held Gold`;
    case 'wellTrained': return `×(1 + ${displayNumber(0.2 * flameProgress(investedGold))} per previous play) XMult, cap ×5`;
    case 'hotStreak': return `×(1 + charges × ${displayNumber(flameProgress(investedGold))}) XMult`;
    case 'moneyToBurn': return `×${displayNumber(moneyToBurnMultiplier(investedGold, board.lifetimeNormalShopGoldSpent))} XMult at ${board.lifetimeNormalShopGoldSpent} shop Gold`;
    case 'lowball': return `×1–×${displayNumber(lowballMultiplier(investedGold, 2))} XMult from printed-face average`;
    default: return `×${displayNumber(standardFlameMultiplier(investedGold))} XMult when its condition is met`;
  }
}
export function flameFullEffectText(id: Flame): string {
  switch (id) {
    case 'personalTrainer': return '75% training chance';
    case 'charge': return 'Stored factor +1 per gameplay roll';
    case 'targetPractice': return '×9 XMult on the round target';
    case 'hotStreak': return '×(1 + charges) XMult';
    case 'dragonsHoard': return '×1–×5 XMult from held Gold';
    case 'wellTrained': return '×(1 + 0.2 per previous play) XMult, cap ×5';
    case 'moneyToBurn': return '×1–×5 XMult from normal-shop spend';
    case 'lowball': return '×1–×5 XMult from printed-face average';
    default: return '×5 XMult when its condition is met';
  }
}
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
  ultimateHands: HandId[];
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
    ultimateHands: ultimateHands(state.handLevels),
    targetPracticeHand: state.targetPracticeHand,
    hotStreakGoal: state.hotStreakGoal,
    hotStreakCharges: state.hotStreakCharges,
    chargeXMult: state.chargeXMult,
    chargeArmed: state.chargeArmed,
    lifetimeNormalShopGoldSpent: state.lifetimeNormalShopGoldSpent,
    bonfires: [...state.bonfires],
    dice: state.dice.map(die => ({ dieId: die.id, flame: activeFlameId(die.flame), investedGold: activeFlameInvestment(die.flame), faceValue: activeFace(die).rank })),
  };
}

const qualifies = (id: Flame, snapshot: HandStartSnapshot, hand: HandId) => {
  switch (id) {
    case 'ultimate': return snapshot.ultimateHands.includes(hand);
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
    case 'hotStreak': return hotStreakMultiplier(investedGold, snapshot.hotStreakCharges + 1);
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
export function handXMultContributions(snapshot: HandStartSnapshot, hand: HandId, _handLevel: number, scoringDieIds: number[]): XMultFactor[] {
  const scoring = new Set(scoringDieIds);
  const result: XMultFactor[] = [];
  if (snapshot.chargeArmed && snapshot.chargeXMult > 1) result.push({ source: 'charge', value: snapshot.chargeXMult, dieId: null, detail: 'armed stored Charge' });
  for (const id of snapshot.bonfires) {
    if (!FLAMES[id]?.affectsXMult || id === 'charge' || !qualifies(id, snapshot, hand)) continue;
    const value = factorValue(id, 100, snapshot, scoringDieIds);
    if (value > 1) {
      const context = factorInput(id, snapshot, scoringDieIds);
      result.push({ source: id, value, dieId: null, ...context, detail: `Bonfire${context.detail ? `; ${context.detail}` : ''}` });
    }
  }
  for (const die of snapshot.dice) {
    const id = die.flame;
    if (!id || !scoring.has(die.dieId) || !FLAMES[id].affectsXMult || id === 'charge' || !qualifies(id, snapshot, hand)) continue;
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
