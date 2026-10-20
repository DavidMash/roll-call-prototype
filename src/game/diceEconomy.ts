import { createCollectibleDie } from './dice';
import { randomIndex } from './rng';
import { SPECIAL_DICE, SPECIAL_DIE_TYPES } from './specialDice';
import type { CollectibleDie, DiceInventory, DiceOffer, DiceRarity, DiceSlotRef, DieId, RandomSource, SpecialDieType } from './types';
export type { SpecialDieType } from './types';
import { plainDescription, specialDieVerboseDescription } from './effectDescriptions';
export { dieSellBreakdown } from './forge';

export const DICE_OFFER_COUNT = 3;
export const DICE_RARITY_WEIGHTS: Readonly<Record<DiceRarity, number>> = {
  common: 55,
  uncommon: 30,
  rare: 13,
  legendary: 2,
};
export const DICE_PRICES: Readonly<Record<DiceRarity, number>> = {
  common: 10,
  uncommon: 20,
  rare: 30,
  legendary: 40,
};
export const DICE_RARITY_ORDER: readonly DiceRarity[] = ['common', 'uncommon', 'rare', 'legendary'];
export function specialDieRarity(type: SpecialDieType): DiceRarity {
  return SPECIAL_DICE[type].rarity;
}

export function diePurchasePrice(type: SpecialDieType): number {
  return SPECIAL_DICE[type].purchasePrice;
}

function chooseRarity(rng: RandomSource): DiceRarity {
  const total = DICE_RARITY_ORDER.reduce((sum, rarity) => sum + DICE_RARITY_WEIGHTS[rarity], 0);
  const roll = rng.next();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('RNG must return a number in [0, 1).');
  let cursor = roll * total;
  for (const rarity of DICE_RARITY_ORDER) {
    cursor -= DICE_RARITY_WEIGHTS[rarity];
    if (cursor < 0) return rarity;
  }
  return 'legendary';
}

/** Rarity-first, with replacement. Duplicate die types are deliberately possible. */
export function generateDiceOfferTypes(rng: RandomSource, count = DICE_OFFER_COUNT): SpecialDieType[] {
  const pools = Object.fromEntries(DICE_RARITY_ORDER.map(rarity => [rarity,
    SPECIAL_DIE_TYPES.filter(type => SPECIAL_DICE[type].rarity === rarity)])) as Record<DiceRarity, SpecialDieType[]>;
  return Array.from({ length: count }, () => {
    const rarity = chooseRarity(rng);
    return pools[rarity][randomIndex(rng, pools[rarity].length)];
  });
}

export function createDiceOffers(rng: RandomSource, allocateId: () => number): DiceOffer[] {
  return generateDiceOfferTypes(rng).map(dieType => ({
    id: allocateId(), dieType, rarity: specialDieRarity(dieType), price: diePurchasePrice(dieType), purchased: false,
  }));
}

export function slotValue(inventory: DiceInventory, slot: DiceSlotRef): DieId | null | undefined {
  return slot.area === 'roster' ? inventory.roster[slot.index] : inventory.storage[slot.index];
}

export function slotExists(inventory: DiceInventory, slot: DiceSlotRef): boolean {
  return Number.isInteger(slot.index) && slot.index >= 0
    && slot.index < (slot.area === 'roster' ? inventory.roster.length : inventory.storage.length);
}

export function setSlotValue(inventory: DiceInventory, slot: DiceSlotRef, value: DieId | null): void {
  if (!slotExists(inventory, slot)) throw new Error(`Unknown ${slot.area} slot ${slot.index}.`);
  if (slot.area === 'roster') inventory.roster[slot.index] = value;
  else inventory.storage[slot.index] = value;
}

export function firstPurchaseSlot(inventory: DiceInventory): DiceSlotRef | null {
  const roster = inventory.roster.findIndex(id => id === null);
  if (roster >= 0) return { area: 'roster', index: roster };
  const storage = inventory.storage.findIndex(id => id === null);
  return storage < 0 ? null : { area: 'storage', index: storage };
}

export function purchaseDie(inventory: DiceInventory, type: SpecialDieType): { die: CollectibleDie; slot: DiceSlotRef } {
  const slot = firstPurchaseSlot(inventory);
  if (!slot) throw new Error('Collection is full.');
  const die = createCollectibleDie(inventory.nextDieId++, type, 1);
  inventory.instances[die.id] = die;
  setSlotValue(inventory, slot, die.id);
  return { die, slot };
}

export function fusionEffectSummary(type: SpecialDieType, fromLevel: number, toLevel: number): { label: string; before: string; after: string } {
  const numeric = (level: number): string => {
    switch (type) {
      case 'bonus': return `+${10 * level} Pips`;
      case 'workout': return `+${2 * level} Pips per Score`;
      case 'vintage': return `+${level} Gold per Score, max +${90 * level}`;
      case 'golden': return `${3 * level} Gold/Round`;
      case 'clockwork': return `${3 * level} controlled Rerolls`;
      case 'jackpot': return `+${3 * level} Gold`;
      case 'teamPlayer': return `×${level + 1}`;
      case 'loneWolf': return `${level + 1} Scores`;
      case 'tank': return `+${10 * level} Pips`;
      case 'freePlay': return `${level} use${level === 1 ? '' : 's'} per face`;
      case 'doubleTime': {
        const guaranteed = Math.floor(level / 4);
        const remainder = level % 4;
        const base = guaranteed ? `Always Scores ${guaranteed + 1} times` : `${remainder * 25}% chance to Score twice`;
        return guaranteed && remainder ? `${base} + ${remainder * 25}% chance to Score ${guaranteed + 2} times` : base;
      }
      case 'furnace': return `+${3 * level} Pips/Gold, max +${15 * level}`;
      default: return `${level} Use${level === 1 ? '' : 's'} per Round`;
    }
  };
  const labels: Partial<Record<SpecialDieType, string>> = {
    bonus: 'Scoring bonus', workout: 'Workout growth', vintage: 'Appreciation', golden: 'Gold cap per Round',
    clockwork: 'Clockwork Rolls', jackpot: 'Winning payout', teamPlayer: 'Other-die multiplier', loneWolf: 'Solo Scores',
    tank: 'Tank bonus', freePlay: 'Free Plays', doubleTime: 'Additional Scores', furnace: 'Furnace power',
  };
  return { label: labels[type] ?? 'Uses per Round', before: numeric(fromLevel), after: numeric(toLevel) };
}

export function dieEffectDescription(type: SpecialDieType, level: number): string {
  return plainDescription(specialDieVerboseDescription(type, level));
}
