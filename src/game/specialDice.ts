import type { CollectibleDie, DiceRarity, DieRoundRuntime, DieRoundState, DieType, Rank } from './types';
import type { RichText } from './richText';
import { specialDieVerboseDescription } from './effectDescriptions';

export interface SpecialDieDefinition {
  type: DieType;
  name: string;
  rarity: DiceRarity | null;
  invocationScale: 'none' | 'level';
  activation: 'none' | 'automatic' | 'onCommand' | 'qualification';
  verboseDescription: (level: number) => RichText;
  shortDescription?: string;
}

const definition = (type: DieType, name: string, rarity: DiceRarity | null,
  invocationScale: SpecialDieDefinition['invocationScale'] = 'none',
  activation: SpecialDieDefinition['activation'] = 'automatic'): SpecialDieDefinition =>
  ({ type, name, rarity, invocationScale, activation, verboseDescription: level => specialDieVerboseDescription(type, level) });

/** Typed V1 registry. It is metadata only; authoritative behavior lives at concrete resolution boundaries. */
export const SPECIAL_DICE: Record<DieType, SpecialDieDefinition> = {
  normal: definition('normal', 'Normal', null, 'none', 'none'),
  bonus: definition('bonus', 'Bonus', 'common'),
  workout: definition('workout', 'Workout', 'common'),
  vintage: definition('vintage', 'Vintage', 'common'),
  golden: definition('golden', 'Golden', 'common'),
  weighted: definition('weighted', 'Weighted', 'common', 'level'),
  clockwork: definition('clockwork', 'Clockwork', 'common'),
  teamPlayer: definition('teamPlayer', 'Team Player', 'common'),
  loneWolf: definition('loneWolf', 'Lone Wolf', 'common'),
  hitchhiker: definition('hitchhiker', 'Hitchhiker', 'uncommon', 'level'),
  magnetic: definition('magnetic', 'Magnetic', 'uncommon', 'level'),
  jackpot: definition('jackpot', 'Jackpot', 'uncommon'),
  freePlay: definition('freePlay', 'Free Play', 'uncommon'),
  chameleon: definition('chameleon', 'Chameleon', 'uncommon', 'level', 'onCommand'),
  flywheel: definition('flywheel', 'Flywheel', 'uncommon', 'level', 'onCommand'),
  tank: definition('tank', 'Tank', 'rare'),
  mirror: definition('mirror', 'Mirror', 'rare', 'level', 'qualification'),
  missingLink: definition('missingLink', 'Missing Link', 'rare', 'level', 'qualification'),
  doubleTime: definition('doubleTime', 'Double Time', 'rare'),
  jumpingBean: definition('jumpingBean', 'Jumping Bean', 'rare', 'level', 'onCommand'),
  furnace: definition('furnace', 'Furnace', 'rare', 'none', 'onCommand'),
  sustainable: definition('sustainable', 'Sustainable', 'rare', 'level'),
  magic: definition('magic', 'Magic', 'legendary', 'level', 'onCommand'),
  conjoined: definition('conjoined', 'Conjoined', 'legendary', 'level', 'qualification'),
};

export const SPECIAL_DIE_TYPES = Object.keys(SPECIAL_DICE) as DieType[];
export const isDieType = (value: unknown): value is DieType =>
  typeof value === 'string' && Object.hasOwn(SPECIAL_DICE, value);

const faceUses = (): Record<Exclude<Rank, 7>, number> => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });

export function initialDieRoundRuntime(die: CollectibleDie): DieRoundRuntime {
  const definition = SPECIAL_DICE[die.type];
  return {
    dieId: die.id,
    type: die.type,
    invocationsRemaining: definition.invocationScale === 'level' ? die.level : 0,
    goldenGoldEarned: 0,
    temporaryPips: 0,
    clockworkRolls: 0,
    freePlayUsesByFace: faceUses(),
    furnaceUnits: 0,
    magicArmedFace: null,
    weightedFace: die.weightedFace,
  };
}

export function resetDieRoundState(dice: readonly CollectibleDie[]): DieRoundState {
  return Object.fromEntries(dice.map(die => [die.id, initialDieRoundRuntime(die)]));
}

export function invocationCapacity(die: CollectibleDie): number {
  return SPECIAL_DICE[die.type].invocationScale === 'level' ? die.level : 0;
}

export function assertCollectibleDie(die: CollectibleDie): void {
  if (!isDieType(die.type)) throw new Error(`Collectible die ${die.id} has unknown type ${String(die.type)}.`);
  if (!Number.isSafeInteger(die.level) || die.level < 1) throw new Error(`Collectible die ${die.id} must have a positive integer level.`);
  if (die.type === 'normal' && die.level !== 1) throw new Error(`Normal die ${die.id} must remain level 1.`);
  if (!Number.isSafeInteger(die.vintageAppreciation) || die.vintageAppreciation < 0)
    throw new Error(`Collectible die ${die.id} has invalid Vintage appreciation.`);
  if (die.type === 'vintage' && die.vintageAppreciation > 90 * die.level)
    throw new Error(`Collectible die ${die.id} exceeds its Vintage appreciation cap.`);
  if (die.type !== 'vintage' && die.vintageAppreciation !== 0)
    throw new Error(`Non-Vintage die ${die.id} cannot hold Vintage appreciation.`);
  if (![1, 2, 3, 4, 5, 6].includes(die.weightedFace)) throw new Error(`Collectible die ${die.id} has invalid Weighted face.`);
}

export function normalizeDieRoundRuntime(die: CollectibleDie, runtime: DieRoundRuntime | undefined): DieRoundRuntime {
  if (!runtime || runtime.dieId !== die.id || runtime.type !== die.type) return initialDieRoundRuntime(die);
  const normalized = structuredClone(runtime);
  normalized.invocationsRemaining = Math.max(0, Math.floor(normalized.invocationsRemaining ?? 0));
  normalized.goldenGoldEarned = Math.max(0, Math.floor(normalized.goldenGoldEarned ?? 0));
  normalized.temporaryPips = Math.max(0, Math.floor(normalized.temporaryPips ?? 0));
  normalized.clockworkRolls = Math.max(0, Math.floor(normalized.clockworkRolls ?? 0));
  normalized.furnaceUnits = Math.max(0, Math.min(5, Math.floor(normalized.furnaceUnits ?? 0)));
  normalized.magicArmedFace = [1, 2, 3, 4, 5, 6].includes(normalized.magicArmedFace as number)
    ? normalized.magicArmedFace : null;
  normalized.weightedFace = [1, 2, 3, 4, 5, 6].includes(normalized.weightedFace as number)
    ? normalized.weightedFace : die.weightedFace;
  normalized.freePlayUsesByFace = { ...faceUses(), ...(normalized.freePlayUsesByFace ?? {}) };
  for (const rank of [1, 2, 3, 4, 5, 6] as const)
    normalized.freePlayUsesByFace[rank] = Math.max(0, Math.floor(normalized.freePlayUsesByFace[rank] ?? 0));
  return normalized;
}
