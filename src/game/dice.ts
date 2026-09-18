import { CONFIG } from './config';
import { stacks } from './enhancements';
import type { Die, Face, RandomSource, Rank } from './types';

export const RANKS: Rank[] = [1, 2, 3, 4, 5, 6];
export const activeFace = (die: Die): Face => die.faces[die.value - 1];
export const oppositeFace = (rank: Rank): Rank => (7 - rank) as Rank;
export const baseScoringPips = (face: Face) => face.rank + face.workoutPips;
export const scoringPips = (face: Face) => baseScoringPips(face) + stacks(face, 'bonus') * CONFIG.bonusPips;
export function createDice(): Die[] {
  return Array.from({ length: CONFIG.diceCount }, (_, id) => ({
    id, value: 1, faces: RANKS.map(rank => ({ rank, workoutPips: 0, sustainableUsedThisRound: false, enhancements: {} })),
  }));
}
export function rollWeights(die: Die): number[] {
  return RANKS.map(rank => stacks(die.faces[oppositeFace(rank) - 1], 'weighted') > 0 ? CONFIG.weightedFactor : 1);
}
export function rollDie(die: Die, rng: RandomSource): { value: Rank; weighted: boolean } {
  const weights = rollWeights(die);
  const random = rng.next();
  if (!Number.isFinite(random) || random < 0 || random >= 1) throw new Error('RNG must return a number in [0, 1).');
  let cursor = random * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    cursor -= weights[i];
    if (cursor < 0) return { value: RANKS[i], weighted: weights[i] > 1 };
  }
  return { value: 6, weighted: weights[5] > 1 };
}
