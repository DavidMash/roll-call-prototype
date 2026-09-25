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
  bonus: definition('Bonus', `+${CONFIG.bonusPips} scoring pips each time this face scores.`, 3, 1, true),
  jumpingBean: definition('Jumping Bean', 'When rolled, free-play the matching Upper hand using this die, then reroll it. The free play does not use up that hand.', 2, 1, false, 1),
  golden: definition('Golden', `+${CONFIG.goldenGold} gold per stack whenever this face scores. Stacks cap at 3.`, 2, 1, true, 3),
  workout: definition('Workout', `After scoring, this face permanently gains +${CONFIG.workoutIncrement} scoring pip.`, 3, 2, true),
  missingLink: definition('Missing Link', 'Wild rank for straights. Scores its actual pips.', 2, 1, false, 1),
  mirror: definition('Mirror', 'Wild matching rank for Pair, Two Pair, kind hands, and Full House. Scores actual pips.', 2, 1, false, 1),
  magnetic: definition('Magnetic', 'A held Magnetic face attracts rerolled dice to one of their Magnetic faces. Bump takes priority.', 3, 2, false, 1),
  sticky: definition('Sticky', '50% chance to prevent a scoring or Jumping Bean reroll. Stacks cap at 3 (87.5%).', 2, 1, true, 3),
  slippy: definition('Slippy', 'Reroll this die after a played hand if the round continues, even if it did not score.', 2, 1, false, 1),
  hitchhiker: definition('Hitchhiker', 'When held out of a played hand, may join as a scoring die. Stacks cap at 3 (87.5%).', 2, 1, true, 3),
  weighted: definition('Weighted', 'Adds +1 roll weight to this face\'s opposite side per stack, including in the shop.', 3, 2, true),
  jackpot: definition('Jackpot', `Gain ${CONFIG.jackpotGold} gold per stack when this face scores in the round-clearing hand. Stacks cap at 3.`, 3, 1, true, 3),
  bump: definition('Bump', 'While showing, this die\'s next actual roll advances one face (6 wraps to 1).', 2, 1, false, 1),
  vintage: definition('Vintage', 'Whenever this face scores in a hand, its sell value increases by 3 Gold.', 3, 0, false, 1),
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
  if (!metadata.stackable && current > 0) return `${metadata.name} is already on this physical face.`;
  if (metadata.maxStacks !== null && current >= metadata.maxStacks) return `${metadata.name} is capped at ${metadata.maxStacks} stacks.`;
  if (current === 0 && metadata.countsTowardFaceTypeLimit && faceEnhancementTypes(face).length >= FACE_TYPE_LIMIT) {
    return `This face already has ${FACE_TYPE_LIMIT} enhancement types. Sell one before adding ${metadata.name}.`;
  }
  return null;
}
export const canAttach = (face: Face, enhancement: Enhancement) => attachmentError(face, enhancement) === null;
export const enhancementCost = (enhancement: Enhancement) => ENHANCEMENTS[enhancement].purchasePrice;
export const enhancementSellValue = (face: Face, enhancement: Enhancement) => enhancement === 'vintage'
  ? Math.max(0, Math.floor(face.vintageSellValue ?? 0))
  : stacks(face, enhancement) * ENHANCEMENTS[enhancement].baseSellPrice;
export const diminishingHalfChance = (stackCount: number) => stackCount <= 0 ? 0 : Math.min(1 - Number.EPSILON, 1 - 0.5 ** stackCount);
