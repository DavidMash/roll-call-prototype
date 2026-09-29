import { CONFIG } from './config';
import type { Enhancement, Face } from './types';

export interface EnhancementDefinition {
  name: string;
  description: string;
  purchasePrice: number;
  baseSellPrice: number;
  stackable: boolean;
  maxStacks: number | null;
  countsTowardFaceTypeLimit: boolean;
}
const definition = (name: string, description: string, purchasePrice: number, baseSellPrice: number,
  stackable: boolean, maxStacks: number | null = null): EnhancementDefinition =>
  ({ name, description, purchasePrice, baseSellPrice, stackable, maxStacks, countsTowardFaceTypeLimit: true });

export const ENHANCEMENTS: Record<Enhancement, EnhancementDefinition> = {
  bonus: definition('Bonus', `+${CONFIG.bonusPips} Pips when this face scores.`, 3, 1, true),
  jumpingBean: definition('Jumping Bean', 'When rolled, plays the matching Upper hand for free, then rerolls.', 2, 1, false, 1),
  golden: definition('Golden', `Gain +${CONFIG.goldenGold} Gold when this face scores.`, 2, 1, true, 3),
  workout: definition('Workout', `After scoring, this face permanently gains +${CONFIG.workoutIncrement} Pip.`, 3, 2, true),
  missingLink: definition('Missing Link', 'Counts as any face in a Straight. Scores its own Pips.', 2, 1, false, 1),
  mirror: definition('Mirror', 'Counts as any matching face in group hands. Scores its own Pips.', 2, 1, false, 1),
  magnetic: definition('Magnetic', 'Once per Round, held Magnets pull rolling dice toward other Magnets.', 3, 2, false, 1),
  sticky: definition('Sticky', 'May keep this die from rerolling after it scores.', 2, 1, true, 3),
  slippy: definition('Slippy', 'Rerolls after you play a hand, even if this die did not score.', 2, 1, false, 1),
  hitchhiker: definition('Hitchhiker', 'When left out of a hand, it may jump in and score anyway.', 2, 1, true, 3),
  weighted: definition('Weighted', 'Makes the opposite face more likely to roll.', 3, 2, true),
  jackpot: definition('Jackpot', `Gain +${CONFIG.jackpotGold} Gold if this face scores in the hand that clears the Round.`, 3, 1, true, 3),
  bump: definition('Bump', 'While showing, this die’s next roll moves up one face.', 2, 1, false, 1),
  vintage: definition('Vintage', 'Each time this face scores, its sell value increases by 3 Gold.', 3, 0, false, 1),
};
export const ENHANCEMENT_IDS = Object.keys(ENHANCEMENTS) as Enhancement[];
export const isEnhancement = (value: unknown): value is Enhancement => typeof value === 'string' && Object.hasOwn(ENHANCEMENTS, value);
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
export const canAttach = (face: Face, enhancement: Enhancement) => attachmentError(face, enhancement) === null;
export const enhancementCost = (enhancement: Enhancement) => ENHANCEMENTS[enhancement].purchasePrice;
export const enhancementSellValue = (face: Face, enhancement: Enhancement) => enhancement === 'vintage'
  ? Math.max(0, Math.floor(face.vintageSellValue ?? 0))
  : stacks(face, enhancement) * ENHANCEMENTS[enhancement].baseSellPrice;
export const diminishingHalfChance = (stackCount: number) => stackCount <= 0 ? 0 : Math.min(1 - Number.EPSILON, 1 - 0.5 ** stackCount);
