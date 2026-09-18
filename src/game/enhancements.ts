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
  sticky: { name: 'Sticky', description: 'Stay after scoring or Jumping Bean. Slippy can still reroll this die.', stackable: false },
  slippy: { name: 'Slippy', description: 'Reroll this die after a played hand if the round continues, even if it did not score.', stackable: false },
  sustainable: { name: 'Sustainable', description: 'Once per physical face per round, preserve a hand this face participates in, then become spent. If several are available, only the lowest-index die spends its charge. Resets next round.', stackable: false },
  hitchhiker: { name: 'Hitchhiker', description: 'When not selected, add this face’s scoring pips to the active hand before multiplication. Its own Multiplier does not apply.', stackable: false },
  weighted: { name: 'Weighted', description: `The opposite face is ${CONFIG.weightedFactor}× as likely to roll, including in the shop.`, stackable: false },
};
export const ENHANCEMENT_IDS = Object.keys(ENHANCEMENTS) as Enhancement[];
export const stacks = (face: Face, enhancement: Enhancement) => face.enhancements[enhancement] ?? 0;
export const canAttach = (face: Face, enhancement: Enhancement) =>
  ENHANCEMENTS[enhancement].stackable || stacks(face, enhancement) === 0;
export const enhancementCost = (enhancement: Enhancement) => CONFIG.enhancementCosts[enhancement];
