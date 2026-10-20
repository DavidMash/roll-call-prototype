import { CONFIG } from './config';
import type { CollectibleDie, DiceInventory, Die, DieType, Face, HexerFace, PhysicalFace, RandomSource, Rank } from './types';
import { rosterTuple, storageTuple, STORAGE_SLOT_COUNT } from './inventory';
import { createDieEffect } from './specialDice';

export const RANKS: Rank[] = [1, 2, 3, 4, 5, 6];
export const HAND_RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7];
export const activeFace = (die: Die): Face => die.faces[die.value - 1];
export const isHexerFace = (face: Face): face is HexerFace => 'hexerEffect' in face;
export const isInfectedFace = (face: Face): boolean => face.bossMutation?.kind === 'infected';
export const isSnakeEyesFace = (face: Face): boolean => face.bossMutation?.kind === 'snakeEyes';
/** Infected suppresses the whole-die effect only while that physical face is exposed. */
export const wholeDieEffectSuppressed = (die: Die): boolean => die.owner === 'player' && isInfectedFace(activeFace(die));
export const oppositeFace = (rank: Rank): Rank => {
  if (rank === 7) throw new Error('The Cursed 7 has no ordinary opposite face.');
  return (7 - rank) as Rank;
};
export const baseScoringPips = (face: Face) => Math.max(0,
  face.rank + (isHexerFace(face) ? face.temporaryPips : 0) - (isInfectedFace(face) ? CONFIG.infectedFacePipPenalty : 0));
export const scoringPips = (face: Face) => baseScoringPips(face)
  + (isHexerFace(face) && face.hexerEffect.kind === 'wildBonus' ? face.hexerEffect.bonusPips : 0);
export function createCollectibleDie(id: number, type: DieType = 'normal', level = 1): CollectibleDie {
  if (!Number.isSafeInteger(level) || level < 1 || (type === 'normal' && level !== 1))
    throw new Error('Collectible die level must be a positive integer; Normal dice remain level 1.');
  return {
    id, value: 1, owner: 'player', effects: type === 'normal' ? [] : [createDieEffect(id, type, level)],
    faces: RANKS.map(rank => ({ rank } satisfies PhysicalFace)),
  };
}
/** Convenience factory for rules/tests that operate on a standalone active Roster. */
export function createDice(): CollectibleDie[] {
  return Array.from({ length: CONFIG.diceCount }, (_, id) => createCollectibleDie(id));
}
export function createDiceInventory(): DiceInventory {
  const dice = createDice();
  return {
    instances: Object.fromEntries(dice.map(die => [die.id, die])),
    roster: rosterTuple(dice.map(die => die.id)),
    storage: storageTuple(Array.from({ length: STORAGE_SLOT_COUNT }, () => null)),
    nextDieId: dice.length,
  };
}
export const rollWeights = (die: Die, excludedFace?: Rank): number[] => (die.owner === 'boss'
  ? die.faces.map(destination => 1 + die.faces.reduce((weight, source) =>
    weight + (source.hexerEffect.kind === 'goldenWeighted' && source.hexerEffect.target === destination.rank ? 1 : 0), 0))
  : RANKS.map(() => 1))
  .map((weight, index) => index + 1 === excludedFace ? 0 : weight);
export const weightedSourceFace = (die: Die, destination: Rank): Face | undefined => die.owner === 'boss'
  ? die.faces.find(face => face.hexerEffect.kind === 'goldenWeighted' && face.hexerEffect.target === destination)
  : undefined;
export function rollPhysicalDie(die: Die, rng: RandomSource, excludedFace?: Rank): { physicalFace: Rank; value: Rank; weighted: boolean } {
  const weights = rollWeights(die, excludedFace);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) throw new Error('A die roll must have at least one eligible face.');
  const random = rng.next();
  if (!Number.isFinite(random) || random < 0 || random >= 1) throw new Error('RNG must return a number in [0, 1).');
  let cursor = random * totalWeight;
  for (let i = 0; i < weights.length; i++) {
    cursor -= weights[i];
    if (cursor < 0) return { physicalFace: (i + 1) as Rank, value: die.faces[i].rank, weighted: weights[i] > 1 };
  }
  return { physicalFace: die.faces.length as Rank, value: die.faces.at(-1)!.rank, weighted: weights.at(-1)! > 1 };
}
export function rollDie(die: Die, rng: RandomSource, excludedFace?: Rank): { value: Rank; weighted: boolean } {
  const { value, weighted } = rollPhysicalDie(die, rng, excludedFace);
  return { value, weighted };
}
