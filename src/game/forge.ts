import type { CollectibleDie, DieEffectInstance, SpecialDieType } from './types';
import { SPECIAL_DICE, effectOf } from './specialDice';

export type ForgeOperationKind = 'fusion' | 'forge';
export interface ForgePreview {
  kind: ForgeOperationKind;
  effects: DieEffectInstance[];
  rating: bigint;
  cost: bigint;
  sellValue: number;
}

export function effectForgeWeight(effect: DieEffectInstance): bigint {
  return BigInt(SPECIAL_DICE[effect.type].forgeBaseWeight + effect.level - 1);
}

export function dieForgeRatingFromEffects(effects: readonly DieEffectInstance[]): bigint {
  return effects.reduce((rating, effect) => rating * effectForgeWeight(effect), 1n);
}

export function dieForgeRating(die: CollectibleDie): bigint {
  return dieForgeRatingFromEffects(die.effects);
}

const contained = (left: readonly DieEffectInstance[], right: readonly DieEffectInstance[]): boolean => {
  const rightTypes = new Set(right.map(effect => effect.type));
  return left.every(effect => rightTypes.has(effect.type));
};

export function classifyForge(a: CollectibleDie, b: CollectibleDie): ForgeOperationKind {
  return contained(a.effects, b.effects) || contained(b.effects, a.effects) ? 'fusion' : 'forge';
}

/** Destination order and matching instance identity survive; source-only effects append in source order. */
export function mergedEffects(destination: CollectibleDie, source: CollectibleDie): DieEffectInstance[] {
  const result = destination.effects.map(effect => structuredClone(effect));
  for (const incoming of source.effects) {
    const existing = result.find(effect => effect.type === incoming.type);
    if (!existing) {
      result.push(structuredClone(incoming));
      continue;
    }
    existing.level += incoming.level;
    if (existing.type === 'vintage') {
      existing.persistent.vintageAppreciation = Math.min(90 * existing.level,
        existing.persistent.vintageAppreciation + incoming.persistent.vintageAppreciation);
    }
    // Destination Weighted configuration deliberately wins for matching effects.
  }
  return result;
}

export function fusionCost(effects: readonly DieEffectInstance[]): bigint {
  return effects.reduce((sum, effect) => sum + BigInt(effect.level), 0n);
}

export function trueForgeCost(a: CollectibleDie, b: CollectibleDie): bigint {
  return dieForgeRating(a) * dieForgeRating(b);
}

function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error('Cannot take the square root of a negative Forge Rating.');
  if (value < 2n) return value;
  let x = 1n << (BigInt(value.toString(2).length) + 1n) / 2n;
  let y = (x + value / x) / 2n;
  while (y < x) { x = y; y = (x + value / x) / 2n; }
  return x;
}

const safeNumber = (value: bigint): number => value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);

export function dieSellBreakdown(die: CollectibleDie): {
  componentSalvage: number;
  complexityPremium: number;
  vintageAppreciation: number;
  total: number;
} {
  if (!die.effects.length) return { componentSalvage: 1, complexityPremium: 0, vintageAppreciation: 0, total: 1 };
  const component = die.effects.reduce((sum, effect) =>
    sum + BigInt((SPECIAL_DICE[effect.type].purchasePrice / 2) * effect.level), 0n);
  // floor(4 * sqrt(rating)) is exactly floor(sqrt(16 * rating)); computing it
  // this way avoids losing the fractional portion before multiplication.
  const premium = die.effects.length < 2 ? 0n : integerSqrt(16n * dieForgeRating(die));
  const vintage = BigInt(effectOf(die, 'vintage')?.persistent.vintageAppreciation ?? 0);
  return {
    componentSalvage: safeNumber(component),
    complexityPremium: safeNumber(premium),
    vintageAppreciation: safeNumber(vintage),
    total: safeNumber(component + premium + vintage),
  };
}

export function previewForge(destination: CollectibleDie, source: CollectibleDie): ForgePreview {
  const effects = mergedEffects(destination, source);
  const kind = classifyForge(destination, source);
  const cost = kind === 'fusion' ? fusionCost(effects) : trueForgeCost(destination, source);
  const result = { ...structuredClone(destination), effects };
  return { kind, effects, rating: dieForgeRatingFromEffects(effects), cost, sellValue: dieSellBreakdown(result).total };
}

export const formatForgeValue = (value: bigint): string => value.toLocaleString('en-US');

export function effectSet(die: CollectibleDie): Set<SpecialDieType> {
  return new Set(die.effects.map(effect => effect.type));
}
