import { createCollectibleDie } from './dice';
import { randomIndex } from './rng';
import { SPECIAL_DICE, SPECIAL_DIE_TYPES } from './specialDice';
import type { CollectibleDie, DiceInventory, DiceOffer, DiceRarity, DiceSlotRef, DieId, DieType, RandomSource } from './types';

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
export type SpecialDieType = Exclude<DieType, 'normal'>;

export function specialDieRarity(type: SpecialDieType): DiceRarity {
  const rarity = SPECIAL_DICE[type].rarity;
  if (!rarity) throw new Error('Normal dice do not have a Shop rarity.');
  return rarity;
}

export function diePurchasePrice(type: SpecialDieType): number {
  return DICE_PRICES[specialDieRarity(type)];
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
    SPECIAL_DIE_TYPES.filter((type): type is SpecialDieType => type !== 'normal' && SPECIAL_DICE[type].rarity === rarity)])) as Record<DiceRarity, SpecialDieType[]>;
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

export function dieSellBreakdown(die: CollectibleDie): { base: number; vintageAppreciation: number; total: number } {
  if (die.type === 'normal') return { base: 1, vintageAppreciation: 0, total: 1 };
  const base = Math.floor(diePurchasePrice(die.type) * die.level * .5);
  const vintageAppreciation = die.type === 'vintage' ? die.vintageAppreciation : 0;
  return { base, vintageAppreciation, total: base + vintageAppreciation };
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

export function canFuse(source: CollectibleDie, destination: CollectibleDie): boolean {
  return source.id !== destination.id && source.type !== 'normal' && source.type === destination.type;
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
      default: return `${level} Invocation${level === 1 ? '' : 's'}`;
    }
  };
  const labels: Partial<Record<SpecialDieType, string>> = {
    bonus: 'Scoring bonus', workout: 'Workout growth', vintage: 'Appreciation', golden: 'Gold cap per Round',
    clockwork: 'Clockwork Rolls', jackpot: 'Winning payout', teamPlayer: 'Other-die multiplier', loneWolf: 'Solo Scores',
    tank: 'Tank bonus', freePlay: 'Free Plays', doubleTime: 'Additional Scores', furnace: 'Furnace power',
  };
  return { label: labels[type] ?? 'Invocations', before: numeric(fromLevel), after: numeric(toLevel) };
}

export function dieEffectDescription(type: DieType, level: number): string {
  if (type === 'normal') return 'No special effect.';
  const uses = (count: number): string => count === 1 ? 'Once per Round.' : `${count} times per Round.`;
  const descriptions: Record<SpecialDieType, string> = {
    bonus: `Scores +${10 * level} Pips.`,
    workout: `After each Score, gains +${2 * level} Pips for the rest of the Round.`,
    vintage: `Each Score adds ${level} Gold to its sell value, up to +${90 * level} Gold.`,
    golden: `Earn 1 Gold when this die Scores, up to ${3 * level} Gold each Round.`,
    weighted: `Rolls its chosen face while uses remain. ${uses(level)}`,
    clockwork: `After its first Roll, its next ${3 * level} Rolls advance one face at a time.`,
    teamPlayer: `Other dice score ×${level + 1} Pips when this die is played with them.`,
    loneWolf: `When played alone, this die Scores ${level + 1} times.`,
    hitchhiker: `Automatically Scores in another hand. ${uses(level)}`,
    magnetic: `The next other die rolled matches this die. ${uses(level)}`,
    jackpot: `Earn +${3 * level} Gold when this die Scores in the hand that reaches the target.`,
    freePlay: `After a Roll, Free Play its Upper hand up to ${level} time${level === 1 ? '' : 's'} per face each Round.`,
    chameleon: `On Command, match the other dice’s majority face. ${uses(level)}`,
    flywheel: `On Command, Reroll this die for free. ${uses(level)}`,
    tank: `After its first Roll, its face stays fixed and each Score or attempted Reroll adds +${10 * level} Pips.`,
    mirror: `Use as a wild die for matching hands. ${uses(level)}`,
    missingLink: `Use as a wild die for Straights. ${uses(level)}`,
    doubleTime: `${fusionEffectSummary(type, level, level).before}.`,
    jumpingBean: `On Command, Free Play its Upper hand, then Reroll. ${uses(level)}`,
    furnace: `Feed Gold for +${3 * level} Pips each, up to +${15 * level} Pips.`,
    sustainable: `Keep a hand available after this die Scores in it. ${uses(level)}`,
    magic: `On Command, choose this die’s next Reroll. ${uses(level)}`,
    conjoined: `Count as one extra matching die when qualifying a hand. ${uses(level)}`,
  };
  return descriptions[type];
}
