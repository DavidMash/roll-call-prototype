import type { CollectibleDie, DiceInventory, DieEffectInstance, SpecialDieType } from './types';
import { SPECIAL_DICE, createDieEffect, effectOf } from './specialDice';

export type ForgeOperationKind = 'fusion' | 'forge';
export interface ForgePreview {
  kind: ForgeOperationKind;
  effects: DieEffectInstance[];
  rating: bigint;
  cost: bigint;
  sellValue: number;
}

export const forgeRevealEligible = (inventory: DiceInventory, temper: number): boolean => temper > 0
  && Object.values(inventory.instances).filter(die => die.effects.length > 0).length >= 2;

export function effectForgeWeight(effect: DieEffectInstance): bigint {
  return BigInt(SPECIAL_DICE[effect.type].forgeBaseWeight + effect.level - 1);
}

export function dieForgeRatingFromEffects(effects: readonly DieEffectInstance[]): bigint {
  return effects.reduce((rating, effect) => rating * effectForgeWeight(effect), 1n);
}

export function dieForgeRating(die: CollectibleDie): bigint {
  return dieForgeRatingFromEffects(die.effects);
}

/** An untouched Normal die contributes one explicit Basic level only once it is forged. */
function forgeEffects(die: CollectibleDie): DieEffectInstance[] {
  if (die.effects.length) return die.effects;
  return [createDieEffect(die.id, 'basic')];
}

const contained = (left: readonly DieEffectInstance[], right: readonly DieEffectInstance[]): boolean => {
  const rightTypes = new Set(right.map(effect => effect.type));
  return left.every(effect => rightTypes.has(effect.type));
};

export function classifyForge(a: CollectibleDie, b: CollectibleDie): ForgeOperationKind {
  const aEffects = forgeEffects(a), bEffects = forgeEffects(b);
  return contained(aEffects, bEffects) || contained(bEffects, aEffects) ? 'fusion' : 'forge';
}

/** Ingredient order is player-facing irrelevant; the lower stable die ID supplies deterministic presentation/configuration. */
export function mergedEffects(a: CollectibleDie, b: CollectibleDie): DieEffectInstance[] {
  const [destination, source] = a.id <= b.id ? [a, b] : [b, a];
  const result = forgeEffects(destination).map(effect => structuredClone(effect));
  for (const incoming of forgeEffects(source)) {
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
    // The lower stable die ID supplies any matching effect configuration.
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
    sum + BigInt(SPECIAL_DICE[effect.type].componentSalvage * effect.level), 0n);
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

export function previewForge(a: CollectibleDie, b: CollectibleDie): ForgePreview {
  const effects = mergedEffects(a, b);
  const kind = classifyForge(a, b);
  const cost = kind === 'fusion' ? fusionCost(effects) : trueForgeCost(a, b);
  const result = { ...structuredClone(a.id <= b.id ? a : b), effects };
  return { kind, effects, rating: dieForgeRatingFromEffects(effects), cost, sellValue: dieSellBreakdown(result).total };
}

export const formatForgeValue = (value: bigint): string => value.toLocaleString('en-US');

export function effectSet(die: CollectibleDie): Set<SpecialDieType> {
  return new Set(die.effects.map(effect => effect.type));
}
