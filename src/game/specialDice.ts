import {
  IconBarbell, IconCirclesRelation, IconClockBolt, IconClockCog, IconClover, IconCoin, IconCopy,
  IconFlame, IconHourglassHigh, IconJumpRope, IconLink, IconMagnet, IconPalette, IconPlayerPlay,
  IconPlus, IconRecycle, IconRefresh, IconRoute, IconScale, IconShield, IconUser, IconUsersGroup, IconWand,
  type Icon,
} from '@tabler/icons-react';
import type {
  CollectibleDie, DiceRarity, DieEffectInstance, DieEffectInstanceId, DieEffectRoundRuntime,
  DieRoundRuntime, DieRoundState, SpecialDieType,
} from './types';
import type { RichText } from './richText';
import { specialDieVerboseDescription } from './effectDescriptions';

export interface SpecialDieDefinition {
  type: SpecialDieType;
  name: string;
  rarity: DiceRarity;
  purchasePrice: number;
  forgeBaseWeight: number;
  invocationScale: 'none' | 'level';
  activation: 'automatic' | 'onCommand' | 'qualification';
  icon: Icon;
  color: string;
  verboseDescription: (level: number) => RichText;
  shortDescription?: string;
}

const RARITY_ECONOMY: Record<DiceRarity, { price: number; weight: number }> = {
  common: { price: 10, weight: 2 },
  uncommon: { price: 20, weight: 3 },
  rare: { price: 30, weight: 5 },
  legendary: { price: 40, weight: 8 },
};

const definition = (type: SpecialDieType, name: string, rarity: DiceRarity, icon: Icon, color: string,
  invocationScale: SpecialDieDefinition['invocationScale'] = 'none',
  activation: SpecialDieDefinition['activation'] = 'automatic'): SpecialDieDefinition => ({
    type, name, rarity, icon, color, invocationScale, activation,
    purchasePrice: RARITY_ECONOMY[rarity].price,
    forgeBaseWeight: RARITY_ECONOMY[rarity].weight,
    verboseDescription: level => specialDieVerboseDescription(type, level),
  });

/** Authoritative metadata for all collectible special effects. */
export const SPECIAL_DICE: Record<SpecialDieType, SpecialDieDefinition> = {
  bonus: definition('bonus', 'Bonus', 'common', IconPlus, '#12b886'),
  workout: definition('workout', 'Workout', 'common', IconBarbell, '#ff922b'),
  vintage: definition('vintage', 'Vintage', 'common', IconHourglassHigh, '#d6a756'),
  golden: definition('golden', 'Golden', 'common', IconCoin, '#fcc419'),
  weighted: definition('weighted', 'Weighted', 'common', IconScale, '#74c0fc'),
  clockwork: definition('clockwork', 'Clockwork', 'common', IconClockCog, '#a5d8ff'),
  hitchhiker: definition('hitchhiker', 'Hitchhiker', 'uncommon', IconRoute, '#94d82d', 'level'),
  magnetic: definition('magnetic', 'Magnetic', 'uncommon', IconMagnet, '#22b8cf', 'level'),
  jackpot: definition('jackpot', 'Jackpot', 'uncommon', IconClover, '#69db7c'),
  chameleon: definition('chameleon', 'Chameleon', 'uncommon', IconPalette, '#e599f7', 'level', 'onCommand'),
  flywheel: definition('flywheel', 'Flywheel', 'uncommon', IconRefresh, '#4dabf7', 'level', 'onCommand'),
  teamPlayer: definition('teamPlayer', 'Team Player', 'rare', IconUsersGroup, '#63e6be'),
  loneWolf: definition('loneWolf', 'Lone Wolf', 'rare', IconUser, '#ffa8a8'),
  // Keep the stable `freePlay` key so existing dice and saves become Curtain Call without migration.
  freePlay: definition('freePlay', 'Curtain Call', 'rare', IconPlayerPlay, '#38d9a9'),
  tank: definition('tank', 'Tank', 'rare', IconShield, '#ff8787'),
  mirror: definition('mirror', 'Mirror', 'rare', IconCopy, '#b197fc', 'level', 'qualification'),
  missingLink: definition('missingLink', 'Missing Link', 'rare', IconLink, '#9775fa', 'level', 'qualification'),
  jumpingBean: definition('jumpingBean', 'Jumping Bean', 'rare', IconJumpRope, '#ff6b6b', 'level'),
  furnace: definition('furnace', 'Furnace', 'rare', IconFlame, '#ff6b35', 'none', 'onCommand'),
  sustainable: definition('sustainable', 'Sustainable', 'rare', IconRecycle, '#20c997', 'level'),
  doubleTime: definition('doubleTime', 'Double Time', 'legendary', IconClockBolt, '#91a7ff'),
  magic: definition('magic', 'Magic', 'legendary', IconWand, '#da77f2', 'level', 'onCommand'),
  conjoined: definition('conjoined', 'Conjoined', 'legendary', IconCirclesRelation, '#f783ac', 'level', 'qualification'),
};

export const SPECIAL_DIE_TYPES = Object.keys(SPECIAL_DICE) as SpecialDieType[];
export const isSpecialDieType = (value: unknown): value is SpecialDieType =>
  typeof value === 'string' && Object.hasOwn(SPECIAL_DICE, value);
export const isDieType = (value: unknown): value is SpecialDieType | 'normal' => value === 'normal' || isSpecialDieType(value);

export const effectInstanceId = (dieId: number, type: SpecialDieType): DieEffectInstanceId => `${dieId}:${type}`;
export function createDieEffect(dieId: number, type: SpecialDieType, level = 1): DieEffectInstance {
  if (!Number.isSafeInteger(level) || level < 1) throw new Error('Effect level must be a positive integer.');
  return { id: effectInstanceId(dieId, type), type, level,
    persistent: { vintageAppreciation: 0, weightedFace: 6, jumpingBeanNumber: 1 } };
}
export const effectOf = (die: CollectibleDie, type: SpecialDieType): DieEffectInstance | undefined =>
  die.effects.find(effect => effect.type === type);
export const hasEffect = (die: CollectibleDie, type: SpecialDieType): boolean => !!effectOf(die, type);
export function requireEffect(die: CollectibleDie, type: SpecialDieType): DieEffectInstance {
  const effect = effectOf(die, type);
  if (!effect) throw new Error(`Die ${die.id} does not have ${type}.`);
  return effect;
}

export function initialEffectRoundRuntime(effect: DieEffectInstance): DieEffectRoundRuntime {
  return {
    effectId: effect.id,
    type: effect.type,
    invocationsRemaining: invocationCapacity(effect),
    goldenGoldEarned: 0,
    temporaryPips: 0,
    clockworkRolls: 0,
    furnaceUnits: 0,
    magicArmedFace: null,
    weightedFace: effect.persistent.weightedFace,
    jumpingBeanNumber: effect.persistent.jumpingBeanNumber,
  };
}
export function initialDieRoundRuntime(die: CollectibleDie): DieRoundRuntime {
  return { dieId: die.id, effects: Object.fromEntries(die.effects.map(effect => [effect.id, initialEffectRoundRuntime(effect)])) };
}
export function resetDieRoundState(dice: readonly CollectibleDie[]): DieRoundState {
  return Object.fromEntries(dice.map(die => [die.id, initialDieRoundRuntime(die)]));
}
export function effectRuntime(runtime: DieRoundRuntime | undefined, effect: DieEffectInstance | undefined): DieEffectRoundRuntime | undefined {
  return effect ? runtime?.effects[effect.id] : undefined;
}
export function runtimeFor(die: CollectibleDie, runtime: DieRoundRuntime | undefined,
  type: SpecialDieType): DieEffectRoundRuntime | undefined {
  return effectRuntime(runtime, effectOf(die, type));
}
export function invocationCapacity(effect: DieEffectInstance): number {
  if (effect.type === 'jumpingBean') return effect.level * 3;
  return SPECIAL_DICE[effect.type].invocationScale === 'level' ? effect.level : 0;
}

export function assertCollectibleDie(die: CollectibleDie): void {
  const seen = new Set<SpecialDieType>();
  for (const effect of die.effects) {
    if (!isSpecialDieType(effect.type)) throw new Error(`Collectible die ${die.id} has unknown effect ${String(effect.type)}.`);
    if (seen.has(effect.type)) throw new Error(`Collectible die ${die.id} contains duplicate ${effect.type} effects.`);
    seen.add(effect.type);
    if (!effect.id) throw new Error(`Collectible die ${die.id} has an effect without stable identity.`);
    if (!Number.isSafeInteger(effect.level) || effect.level < 1) throw new Error(`Effect ${effect.id} must have a positive integer level.`);
    if (!Number.isSafeInteger(effect.persistent.vintageAppreciation) || effect.persistent.vintageAppreciation < 0)
      throw new Error(`Effect ${effect.id} has invalid Vintage appreciation.`);
    if (effect.type === 'vintage' && effect.persistent.vintageAppreciation > 90 * effect.level)
      throw new Error(`Effect ${effect.id} exceeds its Vintage appreciation cap.`);
    if (effect.type !== 'vintage' && effect.persistent.vintageAppreciation !== 0)
      throw new Error(`Non-Vintage effect ${effect.id} cannot hold Vintage appreciation.`);
    if (![1, 2, 3, 4, 5, 6].includes(effect.persistent.weightedFace))
      throw new Error(`Effect ${effect.id} has invalid Weighted Number.`);
    if (![1, 2, 3, 4, 5, 6].includes(effect.persistent.jumpingBeanNumber))
      throw new Error(`Effect ${effect.id} has invalid Jumping Bean number.`);
  }
}

export function normalizeDieRoundRuntime(die: CollectibleDie, runtime: DieRoundRuntime | undefined): DieRoundRuntime {
  const normalized = initialDieRoundRuntime(die);
  if (!runtime || runtime.dieId !== die.id) return normalized;
  for (const effect of die.effects) {
    const existing = runtime.effects?.[effect.id];
    if (!existing || existing.type !== effect.type) continue;
    const target = structuredClone(existing);
    target.invocationsRemaining = Math.max(0, Math.floor(target.invocationsRemaining ?? 0));
    target.goldenGoldEarned = Math.max(0, Math.floor(target.goldenGoldEarned ?? 0));
    target.temporaryPips = Math.max(0, Math.floor(target.temporaryPips ?? 0));
    target.clockworkRolls = Math.max(0, Math.floor(target.clockworkRolls ?? 0));
    target.furnaceUnits = Math.max(0, Math.min(5, Math.floor(target.furnaceUnits ?? 0)));
    target.magicArmedFace = [1, 2, 3, 4, 5, 6].includes(target.magicArmedFace as number) ? target.magicArmedFace : null;
    target.weightedFace = [1, 2, 3, 4, 5, 6].includes(target.weightedFace as number)
      ? target.weightedFace : effect.persistent.weightedFace;
    target.jumpingBeanNumber = [1, 2, 3, 4, 5, 6].includes(target.jumpingBeanNumber as number)
      ? target.jumpingBeanNumber : effect.persistent.jumpingBeanNumber;
    // Old saves may contain Curtain Call's obsolete per-face Free Play counters.
    delete (target as unknown as Record<string, unknown>).freePlayUsesByFace;
    normalized.effects[effect.id] = target;
  }
  return normalized;
}
