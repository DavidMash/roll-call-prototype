import { activeFace } from './dice';
import { lastPlayDanger } from './bosses';
import { LOWER_HAND_IDS, ultimateHands, UPPER_HAND_IDS } from './hands';
import { finalizeScore, handScore } from './scoring';
import type { ActiveFlame, Board, Die, Flame, GameState, HandId, XMultFactor } from './types';

export interface FlameDefinition {
  name: string;
  shortName: string;
  description: string;
  bonfireDescription: string;
  affectsXMult: boolean;
}
const GLOBAL_BONFIRE = 'This Flame now works globally.';
export const FLAMES: Record<Flame, FlameDefinition> = {
  ultimate: { name: 'Ultimate', shortName: 'ULT', affectsXMult: true, description: 'Your highest level hand gains up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  minigun: { name: 'Minigun', shortName: 'MINI', affectsXMult: true, description: 'Upper hands gain up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  hailMary: { name: 'Hail Mary', shortName: 'HAIL', affectsXMult: true, description: 'Hands played with no Rerolls left gain up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  fullOfGrace: { name: 'Full of Grace', shortName: 'GRACE', affectsXMult: true, description: 'Last Play gains up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  charge: { name: 'Charge', shortName: 'CHG', affectsXMult: true, description: 'Scoring dice build Charge. Arm it for up to ×5 XMult.', bonfireDescription: 'This Flame now works globally. Arm Charge for any hand.' },
  personalTrainer: { name: 'Personal Trainer', shortName: 'TRAIN', affectsXMult: false, description: 'When this die scores, it may train the hand. Up to 75% chance.', bonfireDescription: 'This Flame now works globally. Every played hand may train.' },
  dragonsHoard: { name: 'Dragon’s Hoard', shortName: 'HOARD', affectsXMult: true, description: 'Holding more Gold earns up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  wellTrained: { name: 'Well Trained', shortName: 'WELL', affectsXMult: true, description: 'Hands you play often gain up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  targetPractice: { name: 'Target Practice', shortName: 'TARGET', affectsXMult: true, description: 'Hit your Target for up to ×9 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  hotStreak: { name: 'Hot Streak', shortName: 'STREAK', affectsXMult: true, description: 'Chain Lower hands in order to build XMult, up to ×9.', bonfireDescription: GLOBAL_BONFIRE },
  moneyToBurn: { name: 'Money to Burn', shortName: 'BURN', affectsXMult: true, description: 'Spending Gold in Shops earns up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  lowball: { name: 'Lowball', shortName: 'LOW', affectsXMult: true, description: 'Low face values earn up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  straightShooter: { name: 'Straight Shooter', shortName: 'STR8', affectsXMult: true, description: 'Straights gain up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  doubleDown: { name: 'Double Down', shortName: 'DBL', affectsXMult: true, description: 'Pair and Two Pair gain up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
};
export const FLAME_IDS = Object.keys(FLAMES) as Flame[];
export const XMult_FLAME_IDS = FLAME_IDS.filter(flame => FLAMES[flame].affectsXMult);
export const HOT_STREAK_SEQUENCE: HandId[] = ['pair', 'twoPair', 'threeKind', 'smallStraight', 'fullHouse', 'fourKind', 'largeStraight', 'fiveKind'];
export const flameProgress = (investedGold: number) => Math.max(0, Math.min(100, investedGold)) / 100;
export const standardFlameMultiplier = (investedGold: number) => 1 + 4 * flameProgress(investedGold);
export const targetPracticeMultiplier = (investedGold: number) => 1 + 8 * flameProgress(investedGold);
export const trainerChance = (investedGold: number) => 0.75 * flameProgress(investedGold);
export const chargeGainPerScoringDie = (investedGold: number) => 0.5 * flameProgress(investedGold);
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
    case 'personalTrainer': return `${displayNumber(trainerChance(investedGold) * 100)}% chance to train the hand.`;
    case 'charge': return `Scoring dice build +${displayNumber(chargeGainPerScoringDie(investedGold))} Charge.`;
    case 'targetPractice': return `Target gains ×${displayNumber(targetPracticeMultiplier(investedGold))} XMult.`;
    case 'dragonsHoard': return `${board.gold} held Gold currently grants ×${displayNumber(dragonsHoardMultiplier(investedGold, board.gold))} XMult.`;
    case 'wellTrained': return 'Frequently played hands build toward ×5 XMult.';
    case 'hotStreak': return `A full Lower-hand chain reaches ×${displayNumber(hotStreakMultiplier(investedGold, HOT_STREAK_SEQUENCE.length))} XMult.`;
    case 'moneyToBurn': return `${board.lifetimeNormalShopGoldSpent} Gold spent in Shops currently grants ×${displayNumber(moneyToBurnMultiplier(investedGold, board.lifetimeNormalShopGoldSpent))} XMult.`;
    case 'lowball': return `Low Faces gain up to ×${displayNumber(lowballMultiplier(investedGold, 2))} XMult.`;
    default: return `The condition grants ×${displayNumber(standardFlameMultiplier(investedGold))} XMult.`;
  }
}
export function flameFullEffectText(id: Flame): string {
  return FLAMES[id].bonfireDescription;
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
  score: number;
  target: number;
  gold: number;
  manualRerollsRemaining: number;
  previousPlays: number;
  ultimateHands: HandId[];
  targetPracticeHand: HandId | null;
  hotStreakGoal: HandId | null;
  hotStreakCharges: number;
  chargeXMult: number;
  chargeArmed: boolean;
  lastPlayDanger: import('./bosses').LastPlayDanger;
  selectedBasePips: number;
  selectedBaseMultiplier: number;
  selectedDieIds: number[];
  bossFactor: number;
  lifetimeNormalShopGoldSpent: number;
  bonfires: Flame[];
  dice: { dieId: number; flame: Flame | null; investedGold: number; faceValue: number }[];
}

export function captureHandStart(state: Pick<GameState, 'score' | 'target' | 'gold' | 'manualRerollsRemaining' | 'handPlayCounts' | 'handLevels' | 'targetPracticeHand' | 'hotStreakGoal' | 'hotStreakCharges' | 'chargeXMult' | 'chargeArmed' | 'bonfires' | 'dice' | 'lifetimeNormalShopGoldSpent' | 'boss' | 'consumed'>, hand: HandId, selectedDieIds: number[]): HandStartSnapshot {
  const selectedScore = handScore(state.dice, hand, selectedDieIds, state.handLevels[hand]);
  return {
    score: state.score,
    target: state.target,
    gold: state.gold,
    manualRerollsRemaining: state.manualRerollsRemaining,
    previousPlays: state.handPlayCounts[hand],
    ultimateHands: ultimateHands(state.handLevels),
    targetPracticeHand: state.targetPracticeHand,
    hotStreakGoal: state.hotStreakGoal,
    hotStreakCharges: state.hotStreakCharges,
    chargeXMult: state.chargeXMult,
    chargeArmed: state.chargeArmed,
    lastPlayDanger: lastPlayDanger(state, hand),
    selectedBasePips: selectedScore.pips,
    selectedBaseMultiplier: selectedScore.multiplier,
    selectedDieIds: [...selectedDieIds],
    bossFactor: state.boss?.type === 'fly' && !state.boss.caught && hand !== state.boss.flyHand ? .5 : 1,
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
    case 'fullOfGrace': return snapshot.lastPlayDanger !== 'none';
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
function contributions(snapshot: HandStartSnapshot, hand: HandId, scoringDieIds: number[], includeFullOfGrace: boolean): XMultFactor[] {
  const scoring = new Set(scoringDieIds);
  const result: XMultFactor[] = [];
  if (snapshot.chargeArmed && snapshot.chargeXMult > 1) result.push({ source: 'charge', value: snapshot.chargeXMult, dieId: null, detail: 'armed stored Charge' });
  for (const id of snapshot.bonfires) {
    if (!FLAMES[id]?.affectsXMult || id === 'charge' || (!includeFullOfGrace && id === 'fullOfGrace') || !qualifies(id, snapshot, hand)) continue;
    const value = factorValue(id, 100, snapshot, scoringDieIds);
    if (value > 1) {
      const context = factorInput(id, snapshot, scoringDieIds);
      result.push({ source: id, value, dieId: null, ...context, detail: `Bonfire${context.detail ? `; ${context.detail}` : ''}` });
    }
  }
  for (const die of snapshot.dice) {
    const id = die.flame;
    if (!id || !scoring.has(die.dieId) || !FLAMES[id].affectsXMult || id === 'charge'
      || (!includeFullOfGrace && id === 'fullOfGrace') || !qualifies(id, snapshot, hand)) continue;
    const value = factorValue(id, die.investedGold, snapshot, scoringDieIds);
    if (value > 1) result.push({ source: id, value, dieId: die.dieId, ...factorInput(id, snapshot, scoringDieIds) });
  }
  return result;
}
export function handXMultContributions(snapshot: HandStartSnapshot, hand: HandId, _handLevel: number, scoringDieIds: number[]): XMultFactor[] {
  const guaranteedFactors = contributions(snapshot, hand, snapshot.selectedDieIds, false);
  const xMult = composeXMult(guaranteedFactors);
  const guaranteed = snapshot.score + finalizeScore(snapshot.selectedBasePips, snapshot.selectedBaseMultiplier,
    xMult * snapshot.bossFactor).finalScore >= snapshot.target;
  return contributions(snapshot, hand, scoringDieIds, !guaranteed);
}
export function isGuaranteedWinningPlay(snapshot: HandStartSnapshot, hand: HandId): boolean {
  const xMult = composeXMult(contributions(snapshot, hand, snapshot.selectedDieIds, false));
  return snapshot.score + finalizeScore(snapshot.selectedBasePips, snapshot.selectedBaseMultiplier,
    xMult * snapshot.bossFactor).finalScore >= snapshot.target;
}
export const composeXMult = (factors: readonly (number | XMultFactor)[]) =>
  Number(factors.map(item => typeof item === 'number' ? item : item.value).sort((a, b) => a - b)
    .reduce((product, value) => product * value, 1).toFixed(12));
export const ownedFlameIds = (state: Pick<GameState, 'dice' | 'bonfires'>) => new Set<Flame>([
  ...state.bonfires,
  ...state.dice.map(die => activeFlameId(die.flame)).filter((id): id is Flame => id !== null),
]);
export const lowerHand = (hand: HandId) => LOWER_HAND_IDS.includes(hand);
