import { CONFIG } from './config';
import type { Die, Enhancement, Face, Rarity } from './types';

export interface EnhancementDefinition {
  name: string;
  symbol: string;
  description: string;
  purchasePrice: number;
  baseSellPrice: number;
  stackable: boolean;
  maxStacks: number | null;
  maxFacesPerDie: number | null;
  countsTowardFaceTypeLimit: boolean;
  rarity: Rarity;
}
const definition = (name: string, symbol: string, description: string, purchasePrice: number, baseSellPrice: number,
  stackable: boolean, rarity: Rarity, maxStacks: number | null = null, maxFacesPerDie: number | null = null): EnhancementDefinition =>
  ({ name, symbol, description, purchasePrice, baseSellPrice, stackable, maxStacks, maxFacesPerDie, countsTowardFaceTypeLimit: true, rarity });

export const ENHANCEMENTS: Record<Enhancement, EnhancementDefinition> = {
  bonus: definition('Bonus', '+', `+${CONFIG.bonusPips} Pips when this face scores. Stack for more Pips.`, 3, 1, true, 'common'),
  jumpingBean: definition('Jumping Bean', '●', 'When rolled, plays the matching Upper hand for free, then rerolls.\nOne Jumping Bean per die.', 2, 1, false, 'rare', 1, 1),
  golden: definition('Golden', '◆', `Gain +${CONFIG.goldenGold} Gold when this face scores. Stack up to three for more Gold.`, 2, 1, true, 'common', 3),
  workout: definition('Workout', '▲', `After scoring, this face permanently gains +${CONFIG.workoutIncrement} Pip. Stack for faster growth.`, 3, 2, true, 'common'),
  missingLink: definition('Missing Link', '∞', 'Counts as any face in a Straight. Scores its own Pips.', 2, 1, false, 'rare', 1),
  mirror: definition('Mirror', '◇', 'Counts as any matching face in group hands. Scores its own Pips.', 2, 1, false, 'rare', 1),
  magnetic: definition('Magnetic', 'M', 'While held, pulls rolling dice to their Magnetic faces once per Round.\nOne Magnetic face per die.', 3, 2, false, 'uncommon', 1, 1),
  sticky: definition('Sticky', '■', 'May keep this die from rerolling after it scores. Stack up to three to increase the odds.', 2, 1, true, 'uncommon', 3),
  slippy: definition('Slippy', '↻', 'Rerolls after you play a hand, even if this die did not score.', 2, 1, false, 'common', 1),
  hitchhiker: definition('Hitchhiker', '↗', 'When left out of a hand, it may jump in and score anyway. Stack up to three to increase the odds.', 2, 1, true, 'uncommon', 3),
  weighted: definition('Weighted', 'W', 'Makes the opposite face more likely to roll. Stack to increase the odds.', 3, 2, true, 'common'),
  jackpot: definition('Jackpot', '★', `Gain +${CONFIG.jackpotGold} Gold if this face scores in the hand that clears the Round. Stack up to three for more Gold.`, 3, 1, true, 'uncommon', 3),
  personalTrainer: definition('Personal Trainer', 'PT', 'When this face scores, it may train the hand. Your below-average hands are more likely to train.\nStack up to three to increase the odds.', 8, 4, true, 'rare', 3),
  bump: definition('Bump', '↑', 'While showing, this die’s next roll moves up one face.', 2, 1, false, 'common', 1),
  vintage: definition('Vintage', 'V', 'Each time this face scores, its base sell value increases by 3 Gold, up to 30.', 3, 0, false, 'common', 1),
};
export const ENHANCEMENT_IDS = Object.keys(ENHANCEMENTS) as Enhancement[];
export const isEnhancement = (value: unknown): value is Enhancement => typeof value === 'string' && Object.hasOwn(ENHANCEMENTS, value);
export const enhancementLabel = (enhancement: Enhancement, uppercase = false) => {
  const definition = ENHANCEMENTS[enhancement];
  return `${definition.symbol} ${uppercase ? definition.name.toUpperCase() : definition.name}`;
};
export const FACE_TYPE_LIMIT = 3;
export const stacks = (face: Face, enhancement: Enhancement) => {
  if (face.infected) return 0;
  const raw = Math.max(0, Math.floor(face.enhancements[enhancement] ?? 0));
  const cap = ENHANCEMENTS[enhancement].maxStacks;
  return cap === null ? raw : Math.min(raw, cap);
};
export const faceEnhancementTypes = (face: Face) => ENHANCEMENT_IDS.filter(id => stacks(face, id) > 0 && ENHANCEMENTS[id].countsTowardFaceTypeLimit);
export function attachmentError(face: Face, enhancement: Enhancement): string | null {
  const metadata = ENHANCEMENTS[enhancement];
  const current = stacks(face, enhancement);
  if (!metadata.stackable && current > 0) return `${metadata.name} is already on this Face.`;
  if (metadata.maxStacks !== null && current >= metadata.maxStacks) return `${metadata.name} is capped at ${metadata.maxStacks} stacks.`;
  if (current === 0 && metadata.countsTowardFaceTypeLimit && faceEnhancementTypes(face).length >= FACE_TYPE_LIMIT) {
    return `This Face is full. Sell an Enhancement before adding ${metadata.name}.`;
  }
  return null;
}
export function placementError(die: Pick<Die, 'faces'>, face: Face, enhancement: Enhancement): string | null {
  const faceError = attachmentError(face, enhancement);
  if (faceError) return faceError;
  const limit = ENHANCEMENTS[enhancement].maxFacesPerDie;
  if (limit !== null && die.faces.filter(candidate => (candidate.enhancements[enhancement] ?? 0) > 0).length >= limit) {
    return `${ENHANCEMENTS[enhancement].name} is limited to ${limit === 1 ? 'one Face' : `${limit} Faces`} per Die.`;
  }
  return null;
}
export const canAttach = (face: Face, enhancement: Enhancement) => attachmentError(face, enhancement) === null;
export const canPlace = (die: Pick<Die, 'faces'>, face: Face, enhancement: Enhancement) => placementError(die, face, enhancement) === null;
/** A pull needs a held Magnetic source plus a different Magnetic-bearing die that can roll without Bump winning. */
export const magneticPullCapable = (dice: readonly Pick<Die, 'owner' | 'faces'>[]) => {
  const magneticDice = dice.filter(die => die.owner === 'player'
    && die.faces.some(face => stacks(face, 'magnetic') > 0));
  return magneticDice.length >= 2 && magneticDice.some(die => die.faces.some(face => stacks(face, 'bump') === 0));
};
export const enhancementCost = (enhancement: Enhancement) => ENHANCEMENTS[enhancement].purchasePrice;
export const VINTAGE_BASE_SELL_CAP = 30;
export const vintageBaseSellValue = (face: Face) => Math.min(VINTAGE_BASE_SELL_CAP, Math.max(0, Math.floor(face.vintageSellValue ?? 0)));
export const enhancementSellValue = (face: Face, enhancement: Enhancement) => enhancement === 'vintage'
  ? vintageBaseSellValue(face) * (face.vintageSommelierBoosted ? 2 : 1)
  : stacks(face, enhancement) * ENHANCEMENTS[enhancement].baseSellPrice;
export const diminishingHalfChance = (stackCount: number) => stackCount <= 0 ? 0 : Math.min(1 - Number.EPSILON, 1 - 0.5 ** stackCount);
export function personalTrainerChance(stackCount: number, handLevel: number, allHandLevels: readonly number[]): number {
  const baseChance = diminishingHalfChance(stackCount);
  if (baseChance === 0 || allHandLevels.length === 0) return baseChance;
  const lowestLevel = Math.min(...allHandLevels);
  const averageLevel = allHandLevels.reduce((sum, level) => sum + level, 0) / allHandLevels.length;
  const span = averageLevel - lowestLevel;
  if (span <= 0) return baseChance;
  const position = (handLevel - lowestLevel) / span;
  const scaledChance = position <= 1
    ? baseChance * 0.75 ** position
    : baseChance * 0.75 * 0.5 ** (position - 1);
  return Math.min(baseChance, Math.max(0.01, scaledChance));
}
