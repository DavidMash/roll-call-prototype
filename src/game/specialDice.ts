import {
  IconBarbell, IconCirclesRelation, IconClockBolt, IconClockCog, IconClover, IconCoin, IconCopy,
  IconFlame, IconHexagon, IconHourglassHigh, IconJumpRope, IconLink, IconMagnet, IconPalette, IconPlayerPlay,
  IconPlus, IconRecycle, IconRefresh, IconRoute, IconScale, IconShield, IconUser, IconUsersGroup, IconWand,
  type Icon,
} from '@tabler/icons-react';
import type {
  CollectibleDie, DiceRarity, DieEffectInstance, DieEffectInstanceId, DieEffectRoundRuntime,
  DieRoundRuntime, DieRoundState, SpecialDieType,
} from './types';
import type { RichText } from './richText';
import { specialDieVerboseDescription } from './effectDescriptions';
import { CONFIG } from './config';

export interface SpecialDieDefinition {
  type: SpecialDieType;
  name: string;
  rarity: DiceRarity;
  purchasePrice: number;
  componentSalvage: number;
  forgeBaseWeight: number;
  invocationScale: 'none' | 'level';
  activation: 'automatic' | 'onCommand' | 'qualification';
  icon: Icon;
  color: string;
  verboseDescription: (level: number) => RichText;
  shortDescription?: string;
}

const definition = (type: SpecialDieType, name: string, rarity: DiceRarity, icon: Icon, color: string,
  economy: Pick<SpecialDieDefinition, 'purchasePrice' | 'componentSalvage' | 'forgeBaseWeight'>,
  invocationScale: SpecialDieDefinition['invocationScale'] = 'none',
  activation: SpecialDieDefinition['activation'] = 'automatic'): SpecialDieDefinition => ({
    type, name, rarity, icon, color, invocationScale, activation, ...economy,
    verboseDescription: level => specialDieVerboseDescription(type, level),
  });

const economy = (purchasePrice: number, componentSalvage: number, forgeBaseWeight: number) =>
  ({ purchasePrice, componentSalvage, forgeBaseWeight });

/** Authoritative metadata for all collectible special effects. */
export const SPECIAL_DICE: Record<SpecialDieType, SpecialDieDefinition> = {
  basic: definition('basic', 'Basic', 'common', IconHexagon, '#adb5bd', economy(2, 1, 1)),
  bonus: definition('bonus', 'Bonus', 'common', IconPlus, '#12b886', economy(10, 5, 2)),
  workout: definition('workout', 'Workout', 'common', IconBarbell, '#ff922b', economy(10, 5, 2)),
  vintage: definition('vintage', 'Vintage', 'common', IconHourglassHigh, '#d6a756', economy(15, 5, 2)),
  golden: definition('golden', 'Golden', 'common', IconCoin, '#fcc419', economy(15, 5, 2)),
  weighted: definition('weighted', 'Weighted', 'common', IconScale, '#74c0fc', economy(10, 5, 2)),
  clockwork: definition('clockwork', 'Clockwork', 'common', IconClockCog, '#a5d8ff', economy(15, 5, 2)),
  hitchhiker: definition('hitchhiker', 'Hitchhiker', 'uncommon', IconRoute, '#94d82d', economy(20, 10, 3), 'level'),
  magnetic: definition('magnetic', 'Magnetic', 'uncommon', IconMagnet, '#22b8cf', economy(20, 10, 3), 'level'),
  jackpot: definition('jackpot', 'Jackpot', 'uncommon', IconClover, '#69db7c', economy(15, 10, 3)),
  chameleon: definition('chameleon', 'Chameleon', 'rare', IconPalette, '#e599f7', economy(30, 10, 3), 'level', 'onCommand'),
  flywheel: definition('flywheel', 'Flywheel', 'uncommon', IconRefresh, '#4dabf7', economy(10, 5, 3), 'level', 'onCommand'),
  teamPlayer: definition('teamPlayer', 'Team Player', 'rare', IconUsersGroup, '#63e6be', economy(30, 15, 5)),
  loneWolf: definition('loneWolf', 'Lone Wolf', 'rare', IconUser, '#ffa8a8', economy(30, 15, 5)),
  // Keep the stable `freePlay` key so existing dice and saves become Curtain Call without migration.
  freePlay: definition('freePlay', 'Curtain Call', 'rare', IconPlayerPlay, '#38d9a9', economy(30, 15, 5)),
  tank: definition('tank', 'Tank', 'rare', IconShield, '#ff8787', economy(30, 15, 5)),
  mirror: definition('mirror', 'Mirror', 'rare', IconCopy, '#b197fc', economy(20, 15, 5), 'level', 'qualification'),
  missingLink: definition('missingLink', 'Missing Link', 'rare', IconLink, '#9775fa', economy(20, 15, 5), 'level', 'qualification'),
  jumpingBean: definition('jumpingBean', 'Jumping Bean', 'rare', IconJumpRope, '#ff6b6b', economy(30, 15, 5), 'level'),
  furnace: definition('furnace', 'Furnace', 'rare', IconFlame, '#ff6b35', economy(30, 15, 5), 'none', 'onCommand'),
  sustainable: definition('sustainable', 'Sustainable', 'rare', IconRecycle, '#20c997', economy(30, 15, 5), 'level'),
  doubleTime: definition('doubleTime', 'Double Time', 'legendary', IconClockBolt, '#91a7ff', economy(40, 20, 8)),
  magic: definition('magic', 'Magic', 'legendary', IconWand, '#da77f2', economy(40, 20, 8), 'level', 'onCommand'),
  conjoined: definition('conjoined', 'Conjoined', 'legendary', IconCirclesRelation, '#f783ac', economy(40, 20, 8), 'level', 'qualification'),
};

export const SPECIAL_DIE_TYPES = Object.keys(SPECIAL_DICE) as SpecialDieType[];
/** Forge-only components are registered for rendering and persistence but never generated as Shop offers. */
export const SHOP_SPECIAL_DIE_TYPES = SPECIAL_DIE_TYPES.filter(type => type !== 'basic');
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
    furnaceGoldFed: 0,
    furnacePips: 0,
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
    target.furnaceGoldFed = Math.max(0, Math.min(CONFIG.furnaceMaxGoldPerRound, Math.floor(target.furnaceGoldFed ?? 0)));
    target.furnacePips = Math.max(0, Math.floor(target.furnacePips ?? 0));
    delete (target as unknown as Record<string, unknown>).furnaceUnits;
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
