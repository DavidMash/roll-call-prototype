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
  unlockTier: number;
}
const definition = (name: string, symbol: string, description: string, purchasePrice: number, baseSellPrice: number,
  stackable: boolean, rarity: Rarity, unlockTier: number, maxStacks: number | null = null, maxFacesPerDie: number | null = null): EnhancementDefinition =>
  ({ name, symbol, description, purchasePrice, baseSellPrice, stackable, maxStacks, maxFacesPerDie, countsTowardFaceTypeLimit: true, rarity, unlockTier });

export const ENHANCEMENTS: Record<Enhancement, EnhancementDefinition> = {
  bonus: definition('Bonus', '+', `+${CONFIG.bonusPips} Pips when this face scores. Stack for more Pips.`, 3, 1, true, 'common', 0),
  golden: definition('Golden', '◆', `Gain +${CONFIG.goldenGold} Gold when this face scores. Stack up to three for more Gold.`, 2, 1, true, 'common', 0, 3),
  workout: definition('Workout', '▲', `After scoring, this face permanently gains +${CONFIG.workoutIncrement} Pip. Stack for faster growth.`, 3, 2, true, 'common', 0),
  vintage: definition('Vintage', 'V', 'Each time this face scores, its base sell value increases by 3 Gold, up to 30.', 3, 0, false, 'common', 0, 1),
  boomerang: definition('Boomerang', '↩', 'When rerolled from this face, it has a chance to return to this face.', 3, 1, true, 'uncommon', 0, 3),
  hitchhiker: definition('Hitchhiker', '↗', 'When left out of a hand, it may jump in and score anyway. Stack up to three to increase the odds.', 3, 1, true, 'uncommon', 1, 3),
  weighted: definition('Weighted', 'W', 'Makes the opposite face more likely to roll. Stack to increase the odds.', 3, 2, true, 'common', 1),
  bump: definition('Bump', '↑', 'While showing, this die’s next roll moves up one face.', 2, 1, false, 'common', 1, 1),
  magnetic: definition('Magnetic', 'M', 'While held, pulls rolling dice to their Magnetic faces once per Round.\nOne Magnetic face per die.', 3, 2, false, 'uncommon', 1, 1, 1),
  jackpot: definition('Jackpot', '★', `Gain +${CONFIG.jackpotGold} Gold if this face scores in the hand that clears the Round. Stack up to three for more Gold.`, 3, 1, true, 'uncommon', 1, 3),
  teamwork: definition('Teamwork', 'TW', 'Other scoring dice contribute their Pips again. Multiple Teamwork faces can each activate.', 3, 1, false, 'common', 2, 1),
  loneWolf: definition('Lone Wolf', 'LW', 'Gain up to ×4 Pips when fewer dice score. 1/2/3/4/5+ dice: ×4/×3/×2/×1.5/×1.', 3, 1, false, 'common', 2, 1),
  tank: definition('Tank', 'T', 'Multiply Mult when this face scores. ×1/×2/×3 stacks: Mult ×1.5/×2/×2.5. Multiple Tank faces each activate.', 8, 4, true, 'rare', 2, 3),
  freePlay: definition('Free Play', 'FP', 'If this face rerolls back to itself, score it as a free play.', 4, 2, false, 'uncommon', 2, 1),
  mirror: definition('Mirror', '◇', 'Counts as any matching face in group hands. Scores its own Pips.', 4, 1, false, 'rare', 3, 1),
  missingLink: definition('Missing Link', '∞', 'Counts as any face in a Straight. Scores its own Pips.', 4, 1, false, 'rare', 3, 1),
  doubleTime: definition('Double Time', 'II', 'Chance for this face to score twice. Stack up to three for a 50%/75%/87.5% chance.', 7, 3, true, 'rare', 3, 3),
  jumpingBean: definition('Jumping Bean', '●', 'When rolled, plays the matching Upper hand for free, then rerolls.\nOne Jumping Bean per die.', 5, 1, false, 'rare', 3, 1, 1),
  shifter: definition('Shifter', 'SH', 'When rolled to, this face temporarily changes its physical Pips to match the most common currently showing value.', 4, 2, false, 'uncommon', 4, 1),
  flywheel: definition('Flywheel', 'FW', 'This face can be rerolled for free once per stack each Round.', 4, 2, true, 'uncommon', 4, 3),
  holiday: definition('Holiday', 'H', 'Chance to triple the effect of Bonus Enhancements on this face.', 4, 2, true, 'uncommon', 4, 3),
  personalTrainer: definition('Personal Trainer', 'PT', 'When this face scores, it may train the hand. Your below-average hands are more likely to train.\nStack up to three to increase the odds.', 8, 4, true, 'rare', 4, 3),
  magic: definition('Magic', '✦', 'This face is rolled to when it would complete the highest-level available hand.', 8, 4, false, 'rare', 5, 1),
  conjoined: definition('Conjoined', 'CJ', 'This face counts as two of itself for hand qualification.', 8, 4, false, 'rare', 5, 1),
  furnace: definition('Furnace', 'FU', 'When scored, destroy all other Enhancements on this face. Furnace permanently gains ×0.25 Mult for each Enhancement stack destroyed.', 8, 4, false, 'rare', 5, 1),
  sustainable: definition('Sustainable', 'SU', 'When this face is scored, the hand is not consumed once per stack each Round.', 8, 4, true, 'rare', 5, 3),
  /** Historical parser compatibility only. Excluded from every active pool and UI list. */
  sticky: definition('Sticky', '■', 'May keep this die from rerolling after it scores. Stack up to three to increase the odds.', 3, 1, true, 'uncommon', 99, 3),
  slippy: definition('Slippy', '↻', 'Rerolls after you play a hand, even if this die did not score.', 2, 1, false, 'uncommon', 99, 1),
};
// Direct legacy lookup remains readable for old exports/tests, but these keys are invisible to all active enumeration.
Object.defineProperty(ENHANCEMENTS, 'sticky', { ...Object.getOwnPropertyDescriptor(ENHANCEMENTS, 'sticky')!, enumerable: false });
Object.defineProperty(ENHANCEMENTS, 'slippy', { ...Object.getOwnPropertyDescriptor(ENHANCEMENTS, 'slippy')!, enumerable: false });
export const ENHANCEMENT_IDS = (Object.keys(ENHANCEMENTS) as Enhancement[]).filter(id => id !== 'sticky' && id !== 'slippy');
export const isEnhancement = (value: unknown): value is Enhancement => typeof value === 'string' && (ENHANCEMENT_IDS as readonly string[]).includes(value);
export const enhancementLabel = (enhancement: Enhancement, uppercase = false) => {
  const definition = ENHANCEMENTS[enhancement];
  return `${definition.symbol} ${uppercase ? definition.name.toUpperCase() : definition.name}`;
};
const normalizedChapter = (chapter: number): number => Math.max(1, Math.floor(chapter));
export const maxEnhancementTypesPerFace = (chapter: number): number => Math.min(6, normalizedChapter(chapter));
export const highestUnlockedEnhancementTier = (chapter: number): number => Math.min(5, normalizedChapter(chapter) - 1);
export const enhancementsUnlockedInChapter = (chapter: number): Enhancement[] => {
  const normalized = normalizedChapter(chapter);
  if (normalized > 6) return [];
  return ENHANCEMENT_IDS.filter(id => ENHANCEMENTS[id].unlockTier === normalized - 1);
};
export const eligibleEnhancements = (chapter: number): Enhancement[] => ENHANCEMENT_IDS
  .filter(id => ENHANCEMENTS[id].unlockTier <= highestUnlockedEnhancementTier(chapter));
export const stacks = (face: Face, enhancement: Enhancement) => {
  if (face.infected) return 0;
  const raw = Math.max(0, Math.floor(face.enhancements[enhancement] ?? 0));
  const cap = ENHANCEMENTS[enhancement].maxStacks;
  return cap === null ? raw : Math.min(raw, cap);
};
export const faceEnhancementTypes = (face: Face) => ENHANCEMENT_IDS.filter(id => stacks(face, id) > 0 && ENHANCEMENTS[id].countsTowardFaceTypeLimit);
export function attachmentError(face: Face, enhancement: Enhancement, chapter = 1): string | null {
  const metadata = ENHANCEMENTS[enhancement];
  const current = stacks(face, enhancement);
  if (!metadata.stackable && current > 0) return `${metadata.name} is already on this Face.`;
  if (metadata.maxStacks !== null && current >= metadata.maxStacks) return `${metadata.name} is capped at ${metadata.maxStacks} stacks.`;
  if (current === 0 && metadata.countsTowardFaceTypeLimit && faceEnhancementTypes(face).length >= maxEnhancementTypesPerFace(chapter)) {
    return `This Face is full. Sell an Enhancement before adding ${metadata.name}.`;
  }
  return null;
}
export function placementError(die: Pick<Die, 'faces'>, face: Face, enhancement: Enhancement, chapter = 1): string | null {
  const faceError = attachmentError(face, enhancement, chapter);
  if (faceError) return faceError;
  const limit = ENHANCEMENTS[enhancement].maxFacesPerDie;
  if (limit !== null && die.faces.filter(candidate => (candidate.enhancements[enhancement] ?? 0) > 0).length >= limit) {
    return `${ENHANCEMENTS[enhancement].name} is limited to ${limit === 1 ? 'one Face' : `${limit} Faces`} per Die.`;
  }
  return null;
}
export const canAttach = (face: Face, enhancement: Enhancement, chapter = 1) => attachmentError(face, enhancement, chapter) === null;
export const canPlace = (die: Pick<Die, 'faces'>, face: Face, enhancement: Enhancement, chapter = 1) => placementError(die, face, enhancement, chapter) === null;
export const furnaceMultiplier = (face: Face): number => Math.max(1, face.furnaceMultiplier ?? 1);
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
export const loneWolfPipsFactor = (scoringDice: number): number => scoringDice <= 1 ? 4
  : scoringDice === 2 ? 3 : scoringDice === 3 ? 2 : scoringDice === 4 ? 1.5 : 1;
export const tankMultiplierFactor = (stackCount: number): number => 1 + 0.5 * Math.min(3, Math.max(0, Math.floor(stackCount)));
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
