import { CONFIG } from './config';
import type { Enhancement, Face } from './types';

export const ENHANCEMENTS: Record<Enhancement, { name: string; description: string; stackable: boolean }> = {
  bonus: { name: 'Bonus', description: `+${CONFIG.bonusPips} scoring pips each time this face scores.`, stackable: true },
  multiplier: { name: 'Multiplier', description: `+${CONFIG.multiplierIncrement} to a hand this die participates in; also applies to its standalone Jumping Bean scoring.`, stackable: true },
  jumpingBean: { name: 'Jumping Bean', description: 'When rolled, score this face, then reroll this die. Can chain.', stackable: false },
  golden: { name: 'Golden', description: `+${CONFIG.goldenGold} gold whenever this face scores.`, stackable: true },
  workout: { name: 'Workout', description: `After scoring, this face permanently gains +${CONFIG.workoutIncrement} scoring pip.`, stackable: true },
  missingLink: { name: 'Missing Link', description: 'Wild rank for straights. Scores its actual pips.', stackable: false },
  mirror: { name: 'Mirror', description: 'Wild matching rank for Pair, Two Pair, kind hands, and Full House. Scores actual pips.', stackable: false },
  magnetic: { name: 'Magnetic', description: 'When rolled, flip every magnetic die to a random magnetic face.', stackable: false },
  sticky: { name: 'Sticky', description: '50% chance to prevent a scoring or Jumping Bean reroll. Additional stacks have diminishing returns. Manual and Slippy rerolls are unaffected.', stackable: true },
  slippy: { name: 'Slippy', description: 'Reroll this die after a played hand if the round continues, even if it did not score.', stackable: false },
  sustainable: { name: 'Sustainable', description: '50% chance to preserve a hand this face participates in. Stacks across all selected participants combine with diminishing returns.', stackable: true },
  hitchhiker: { name: 'Hitchhiker', description: 'When not selected, add this face’s scoring pips to the active hand before multiplication. Its own Multiplier does not apply.', stackable: false },
  weighted: { name: 'Weighted', description: 'Adds +1 roll weight to this face\'s opposite side per stack, including in the shop.', stackable: true },
};
export const ENHANCEMENT_IDS = Object.keys(ENHANCEMENTS) as Enhancement[];
export const stacks = (face: Face, enhancement: Enhancement) => face.enhancements[enhancement] ?? 0;
export const canAttach = (face: Face, enhancement: Enhancement) =>
  ENHANCEMENTS[enhancement].stackable || stacks(face, enhancement) === 0;
export const enhancementCost = (enhancement: Enhancement) => CONFIG.enhancementCosts[enhancement];
export const diminishingHalfChance = (stackCount: number) => stackCount <= 0
  ? 0
  : Math.min(1 - Number.EPSILON, 1 - 0.5 ** stackCount);
