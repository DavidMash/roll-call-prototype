import { rollWeights } from '../game/dice';
import { SeededRng } from '../game/rng';
import type { Die, RandomSource, Rank } from '../game/types';

/**
 * A roll source created for one authored gameplay event. The script is selected
 * by a semantic scenario key before resolution; it is never tied to a global
 * RNG call number. Any incidental calls fall through to the tutorial seed.
 */
export class EventAddressedRollSource implements RandomSource {
  private cursor = 0;
  readonly fallback: SeededRng;
  constructor(readonly values: number[], rngState: number) { this.fallback = new SeededRng(rngState); }
  next(): number { return this.cursor < this.values.length ? this.values[this.cursor++] : this.fallback.next(); }
}

export function randomValueForPhysicalFace(die: Die, target: Rank, excludedFace?: Rank): number {
  const weights = rollWeights(die, excludedFace);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const before = weights.slice(0, target - 1).reduce((sum, weight) => sum + weight, 0);
  const weight = weights[target - 1];
  if (!weight) throw new Error(`Tutorial roll cannot reach D${die.id + 1} physical face ${target}.`);
  return (before + weight / 2) / total;
}

export function scriptedRollSource(dice: Die[], targets: ReadonlyMap<number, Rank>, rngState: number,
  excludedStartingFaces = false): EventAddressedRollSource {
  const values = [...targets.entries()].sort(([a], [b]) => a - b).map(([dieId, target]) => {
    const die = dice.find(item => item.id === dieId);
    if (!die) throw new Error(`Tutorial roll references missing die ${dieId}.`);
    return randomValueForPhysicalFace(die, target, excludedStartingFaces ? die.value : undefined);
  });
  return new EventAddressedRollSource(values, rngState);
}

export const targetMap = (targets: readonly Rank[], dieIds?: readonly number[]) => new Map<number, Rank>(
  targets.map((target, index) => [dieIds?.[index] ?? index, target]),
);
