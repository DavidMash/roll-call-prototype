import { CONFIG } from './config';
import { stacks } from './enhancements';
import type { Die, Face, RandomSource, Rank } from './types';

export const RANKS: Rank[] = [1, 2, 3, 4, 5, 6];
export const HAND_RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7];
export const activeFace = (die: Die): Face => die.faces[die.value - 1];
export const oppositeFace = (rank: Rank): Rank => {
  if (rank === 7) throw new Error('The Cursed 7 has no ordinary opposite face.');
  return (7 - rank) as Rank;
};
export const baseScoringPips = (face: Face) => face.rank + face.workoutPips;
export const scoringPips = (face: Face) => baseScoringPips(face) + stacks(face, 'bonus') * CONFIG.bonusPips;
export function createDice(): Die[] {
  return Array.from({ length: CONFIG.diceCount }, (_, id) => ({
    id, value: 1, flame: null, owner: 'player' as const,
    faces: RANKS.map(rank => ({ rank, workoutPips: 0, enhancements: {} })),
  }));
}
export const rollWeights = (die: Die): number[] => die.owner === 'boss'
  ? die.faces.map(destination => 1 + die.faces.reduce((weight, source) =>
    weight + (source.weightedTarget === destination.rank ? stacks(source, 'weighted') : 0), 0))
  : RANKS.map(rank => 1 + stacks(die.faces[oppositeFace(rank) - 1], 'weighted'));
export const weightedSourceFace = (die: Die, destination: Rank): Face | undefined => die.owner === 'boss'
  ? die.faces.find(face => face.weightedTarget === destination && stacks(face, 'weighted'))
  : die.faces[oppositeFace(destination) - 1];
export function rollDie(die: Die, rng: RandomSource): { value: Rank; weighted: boolean } {
  if (stacks(activeFace(die), 'bump')) {
    if (die.owner === 'boss') return { value: Math.min(7, die.value + 1) as Rank, weighted: false };
    return { value: (die.value === 6 ? 1 : die.value + 1) as Rank, weighted: false };
  }
  const weights = rollWeights(die);
  const random = rng.next();
  if (!Number.isFinite(random) || random < 0 || random >= 1) throw new Error('RNG must return a number in [0, 1).');
  let cursor = random * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    cursor -= weights[i];
    if (cursor < 0) return { value: die.faces[i].rank, weighted: weights[i] > 1 };
  }
  return { value: die.faces.at(-1)!.rank, weighted: weights.at(-1)! > 1 };
}
