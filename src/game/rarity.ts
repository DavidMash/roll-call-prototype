import { randomIndex } from './rng';
import type { RandomSource, Rarity } from './types';

export const RARITIES: Record<Rarity, { label: string; className: string }> = {
  common: { label: 'Common', className: 'rarity-common' },
  uncommon: { label: 'Uncommon', className: 'rarity-uncommon' },
  rare: { label: 'Rare', className: 'rarity-rare' },
};

export type OfferRaritySystem = 'enhancement' | 'flame' | 'specialOffer';
export type RarityWeights = Readonly<Record<Rarity, number>>;

export const OFFER_RARITY_WEIGHTS: Readonly<Record<OfferRaritySystem, RarityWeights>> = {
  enhancement: { common: 50, uncommon: 35, rare: 15 },
  flame: { common: 50, uncommon: 35, rare: 15 },
  specialOffer: { common: 50, uncommon: 35, rare: 15 },
};

const RARITY_ORDER: readonly Rarity[] = ['common', 'uncommon', 'rare'];

/** Rarity-first deterministic selection with unique candidates and at most one Rare. */
export function rarityFirstSelection<T>(
  candidates: readonly T[],
  count: number,
  rarityOf: (candidate: T) => Rarity,
  weights: RarityWeights,
  rng: RandomSource,
): T[] {
  const remaining = [...candidates];
  const selected: T[] = [];
  let rareSelected = false;
  while (selected.length < count && remaining.length > 0) {
    const available = RARITY_ORDER.filter(rarity => !((rarity === 'rare' && rareSelected))
      && remaining.some(candidate => rarityOf(candidate) === rarity));
    if (!available.length) break;
    const total = available.reduce((sum, rarity) => sum + Math.max(0, weights[rarity]), 0);
    const roll = rng.next();
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('RNG must return a number in [0, 1).');
    let cursor = roll * total;
    let rarity = available.at(-1)!;
    for (const candidateRarity of available) {
      cursor -= Math.max(0, weights[candidateRarity]);
      if (cursor < 0) { rarity = candidateRarity; break; }
    }
    const tierCandidates = remaining.filter(candidate => rarityOf(candidate) === rarity);
    const chosen = tierCandidates[randomIndex(rng, tierCandidates.length)];
    selected.push(chosen);
    remaining.splice(remaining.indexOf(chosen), 1);
    if (rarity === 'rare') rareSelected = true;
  }
  return selected;
}

export const rarityLabel = (rarity: Rarity) => RARITIES[rarity].label;
export const rarityClassName = (rarity: Rarity) => RARITIES[rarity].className;
