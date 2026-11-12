import { CONFIG } from './config';
import { createCollectibleDie } from './dice';
import { firstPurchaseSlot, setSlotValue } from './diceEconomy';
import { lowerBaselineLevel, upperBaselineLevel } from './hands';
import { randomIndex } from './rng';
import { createDieEffect } from './specialDice';
import type {
  CollectibleDie, GameState, HandId, InfernoPermanentUpgrades, InfernoRewardOffer,
  InfernoRewardOfferId, InfernoRewardRarity, InfernoRewardSelection, InfernoRewardState,
  RandomSource, SpecialDieType,
} from './types';

const offer = (id: InfernoRewardOfferId, name: string, category: InfernoRewardOffer['category'],
  rarity: InfernoRewardRarity, description: string): InfernoRewardOffer => ({ id, name, category, rarity, description });

export const INFERNO_REWARD_OFFERS: Record<InfernoRewardOfferId, InfernoRewardOffer> = {
  expandedRoster: offer('expandedRoster', 'Expanded Roster', 'upgrade', 'rare', 'Increase active Roster capacity from 5 to 6.'),
  expandedRoster2: offer('expandedRoster2', 'Expanded Roster II', 'upgrade', 'legendary', 'Increase active Roster capacity from 6 to 7.'),
  extraReroll: offer('extraReroll', 'Extra Reroll', 'upgrade', 'rare', 'Increase permanent Manual Rerolls from 3 to 4.'),
  extraReroll2: offer('extraReroll2', 'Extra Reroll II', 'upgrade', 'legendary', 'Increase permanent Manual Rerolls from 4 to 5.'),
  maxHeart: offer('maxHeart', 'Max Heart', 'upgrade', 'uncommon', 'Maximum Hearts +1 and immediately gain 1 Heart.'),
  maxHeart2: offer('maxHeart2', 'Max Heart II', 'upgrade', 'rare', 'Maximum Hearts +1 and immediately gain 1 Heart.'),
  higherInterest: offer('higherInterest', 'Higher Interest', 'upgrade', 'uncommon', 'Maximum Interest payout per Shop +5 Gold.'),
  higherInterest2: offer('higherInterest2', 'Higher Interest II', 'upgrade', 'rare', 'Maximum Interest payout per Shop +10 Gold more.'),
  freeShopReroll: offer('freeShopReroll', 'Free Shop Reroll', 'upgrade', 'uncommon', 'The first dice-offer reroll in each Shop is free.'),
  freeShopReroll2: offer('freeShopReroll2', 'Free Shop Reroll II', 'upgrade', 'rare', 'The first 2 dice-offer rerolls in each Shop are free.'),
  temperCapacity: offer('temperCapacity', 'Temper Capacity', 'upgrade', 'uncommon', 'Maximum Overkill Temper earned per Round +5 Temper.'),
  temperCapacity2: offer('temperCapacity2', 'Temper Capacity II', 'upgrade', 'rare', 'Maximum Overkill Temper earned per Round +10 Temper more.'),
  goldWindfall: offer('goldWindfall', 'Gold Windfall', 'resource', 'common', 'Immediately gain 100 Gold.'),
  temperWindfall: offer('temperWindfall', 'Temper Windfall', 'resource', 'common', 'Immediately gain 100 Temper.'),
  handOdds: offer('handOdds', 'New Hand: Odds', 'hand', 'uncommon', 'Unlock Odds at ×2 Mult. Score all eligible odd dice; at least 3 are required.'),
  handEvens: offer('handEvens', 'New Hand: Evens', 'hand', 'uncommon', 'Unlock Evens at ×2 Mult. Score all eligible even dice; at least 3 are required.'),
  handChance: offer('handChance', 'New Hand: Chance', 'hand', 'uncommon', 'Unlock Chance at ×1.5 Mult. It scores every active Roster die.'),
  handMiniStraight: offer('handMiniStraight', 'New Hand: Mini Straight', 'hand', 'uncommon', 'Unlock Mini Straight at ×2.5 Mult: any 3 consecutive faces.'),
  handOddStraight: offer('handOddStraight', 'New Hand: Odd Straight', 'hand', 'uncommon', 'Unlock Odd Straight at ×3 Mult: one each of 1, 3, and 5.'),
  handEvenStraight: offer('handEvenStraight', 'New Hand: Even Straight', 'hand', 'uncommon', 'Unlock Even Straight at ×3 Mult: one each of 2, 4, and 6.'),
  handThreePair: offer('handThreePair', 'New Hand: Three Pair', 'hand', 'rare', 'Unlock Three Pair at ×5 Mult: three distinct pairs.'),
  handWideStraight: offer('handWideStraight', 'New Hand: Wide Straight', 'hand', 'rare', 'Unlock Wide Straight at ×7 Mult: three consecutive pairs.'),
  handDoubleTriple: offer('handDoubleTriple', 'New Hand: Double Triple', 'hand', 'rare', 'Unlock Double Triple at ×7 Mult: two distinct Three-of-a-Kinds.'),
  handFullerHouse: offer('handFullerHouse', 'New Hand: Fuller House', 'hand', 'rare', 'Unlock Fuller House at ×8 Mult: four of one face and two of another.'),
  handXlStraight: offer('handXlStraight', 'New Hand: XL Straight', 'hand', 'legendary', 'Unlock XL Straight at ×10 Mult: 1, 2, 3, 4, 5, 6.'),
  handSixKind: offer('handSixKind', 'New Hand: Six of a Kind', 'hand', 'legendary', 'Unlock Six of a Kind at ×12 Mult: six matching faces.'),
  dieInvestor: offer('dieInvestor', 'New Die: The Investor', 'die', 'rare', 'Vintage II + Double Time III + Bonus II.'),
  dieMagicMirror: offer('dieMagicMirror', 'New Die: Magic Mirror', 'die', 'rare', 'Magic II + Mirror II + Bonus II.'),
  dieGroundAssault: offer('dieGroundAssault', 'New Die: Ground Assault', 'die', 'rare', 'Tank III + Flywheel III + Clockwork I.'),
  dieSustainableIndustry: offer('dieSustainableIndustry', 'New Die: Sustainable Industry', 'die', 'rare', 'Furnace II + Golden I + Sustainable I.'),
  dieGymRat: offer('dieGymRat', 'New Die: The Gym Rat', 'die', 'legendary', 'Workout VI + Double Time III.'),
  diePopcornMachine: offer('diePopcornMachine', 'New Die: The Popcorn Machine', 'die', 'legendary', 'Jumping Bean V + Flywheel II + Chameleon III.'),
};

export const INFERNO_REWARD_IDS = Object.keys(INFERNO_REWARD_OFFERS) as InfernoRewardOfferId[];

export const INFERNO_HAND_BY_OFFER: Partial<Record<InfernoRewardOfferId, HandId>> = {
  handOdds: 'odds', handEvens: 'evens', handChance: 'chance', handMiniStraight: 'miniStraight',
  handOddStraight: 'oddStraight', handEvenStraight: 'evenStraight', handThreePair: 'threePair',
  handWideStraight: 'wideStraight', handDoubleTriple: 'doubleTriple', handFullerHouse: 'fullerHouse',
  handXlStraight: 'xlStraight', handSixKind: 'sixKind',
};

export const CURATED_DIE_BUILDS: Partial<Record<InfernoRewardOfferId, readonly [SpecialDieType, number][]>> = {
  dieInvestor: [['vintage', 2], ['doubleTime', 3], ['bonus', 2]],
  dieMagicMirror: [['magic', 2], ['mirror', 2], ['bonus', 2]],
  dieGroundAssault: [['tank', 3], ['flywheel', 3], ['clockwork', 1]],
  dieSustainableIndustry: [['furnace', 2], ['golden', 1], ['sustainable', 1]],
  dieGymRat: [['workout', 6], ['doubleTime', 3]],
  diePopcornMachine: [['jumpingBean', 5], ['flywheel', 2], ['chameleon', 3]],
};

export const initialInfernoPermanentUpgrades = (): InfernoPermanentUpgrades => ({
  rosterCap: CONFIG.diceCount,
  manualRerolls: CONFIG.manualRerollsPerRound,
  maxLives: CONFIG.maxLives,
  interestCap: CONFIG.interestCap,
  freeShopRerolls: 0,
  overkillTemperCap: 5,
});

export const initialInfernoRewardState = (): InfernoRewardState => ({
  claimedOfferIds: [], deferredOffers: {}, screenCount: 0, pending: null,
  upgrades: initialInfernoPermanentUpgrades(), unlockedHands: [],
});

const claimed = (state: Pick<GameState, 'infernoRewards'>, id: InfernoRewardOfferId) =>
  state.infernoRewards.claimedOfferIds.includes(id);

export function infernoRewardEligible(state: Pick<GameState, 'infernoRewards'>, id: InfernoRewardOfferId): boolean {
  if (claimed(state, id)) return false;
  const cap = state.infernoRewards.upgrades.rosterCap;
  switch (id) {
    case 'expandedRoster': return cap === 5;
    case 'expandedRoster2': return claimed(state, 'expandedRoster') && cap === 6;
    case 'extraReroll': return state.infernoRewards.upgrades.manualRerolls === 3;
    case 'extraReroll2': return claimed(state, 'extraReroll') && state.infernoRewards.upgrades.manualRerolls === 4;
    case 'maxHeart2': return claimed(state, 'maxHeart');
    case 'higherInterest2': return claimed(state, 'higherInterest');
    case 'freeShopReroll2': return claimed(state, 'freeShopReroll');
    case 'temperCapacity2': return claimed(state, 'temperCapacity');
    case 'handThreePair': case 'handWideStraight': case 'handDoubleTriple': case 'handFullerHouse':
    case 'handXlStraight': case 'handSixKind': return cap >= 6;
    default: return true;
  }
}

export const INFERNO_RARITY_WEIGHTS: Readonly<Record<InfernoRewardRarity, number>> = {
  common: 45, uncommon: 35, rare: 15, legendary: 5,
};
const RARITY_ORDER: readonly InfernoRewardRarity[] = ['common', 'uncommon', 'rare', 'legendary'];

function rolledRarity(rng: RandomSource): InfernoRewardRarity {
  const roll = rng.next();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('RNG must return a number in [0, 1).');
  let cursor = roll * 100;
  for (const rarity of RARITY_ORDER) {
    cursor -= INFERNO_RARITY_WEIGHTS[rarity];
    if (cursor < 0) return rarity;
  }
  return 'legendary';
}

/** Lower tiers are exhausted before looking upward, exactly once per generated card. */
function fallbackRarities(rolled: InfernoRewardRarity): InfernoRewardRarity[] {
  const index = RARITY_ORDER.indexOf(rolled);
  return [rolled, ...[...RARITY_ORDER.slice(0, index)].reverse(), ...RARITY_ORDER.slice(index + 1)];
}

export function generateInfernoRewardSelection(state: Pick<GameState, 'infernoRewards'>,
  rng: RandomSource, claimCount = 1): InfernoRewardSelection {
  const screenNumber = state.infernoRewards.screenCount + 1;
  const unseen = INFERNO_REWARD_IDS.filter(id => infernoRewardEligible(state, id) && !state.infernoRewards.deferredOffers[id]);
  const recyclable = unseen.length < 6 ? INFERNO_REWARD_IDS.filter(id => {
    const deferred = state.infernoRewards.deferredOffers[id];
    return !!deferred && screenNumber - deferred.deferredAtScreen > 3 && infernoRewardEligible(state, id);
  }) : [];
  const remaining = [...unseen, ...recyclable];
  const selected: InfernoRewardOfferId[] = [];
  const categoryCounts = new Map<InfernoRewardOffer['category'], number>();
  let legendarySelected = false;
  while (selected.length < 3 && remaining.length) {
    const constrained = remaining.filter(id => {
      const definition = INFERNO_REWARD_OFFERS[id];
      return (categoryCounts.get(definition.category) ?? 0) < 2
        && !(definition.rarity === 'legendary' && legendarySelected);
    });
    if (!constrained.length) break;
    const rarity = fallbackRarities(rolledRarity(rng)).find(tier =>
      constrained.some(id => INFERNO_REWARD_OFFERS[id].rarity === tier));
    if (!rarity) break;
    const tier = constrained.filter(id => INFERNO_REWARD_OFFERS[id].rarity === rarity);
    const chosen = tier[randomIndex(rng, tier.length)];
    selected.push(chosen);
    remaining.splice(remaining.indexOf(chosen), 1);
    const definition = INFERNO_REWARD_OFFERS[chosen];
    categoryCounts.set(definition.category, (categoryCounts.get(definition.category) ?? 0) + 1);
    if (definition.rarity === 'legendary') legendarySelected = true;
  }
  return { screenNumber, offers: selected, recycledOfferIds: selected.filter(id => recyclable.includes(id)),
    makeRoomOfferId: null, claimCount: Math.max(1, Math.min(3, Math.floor(claimCount))), claimedOnScreen: [] };
}

export function createCuratedRewardDie(state: Pick<GameState, 'diceInventory'>, offerId: InfernoRewardOfferId): CollectibleDie {
  const build = CURATED_DIE_BUILDS[offerId];
  if (!build) throw new Error(`${offerId} is not a curated die reward.`);
  const die = createCollectibleDie(state.diceInventory.nextDieId++, 'normal');
  die.effects = build.map(([type, level]) => createDieEffect(die.id, type, level));
  return die;
}

export function placeCuratedRewardDie(state: Pick<GameState, 'diceInventory'>, die: CollectibleDie): boolean {
  const destination = firstPurchaseSlot(state.diceInventory);
  if (!destination) return false;
  state.diceInventory.instances[die.id] = die;
  setSlotValue(state.diceInventory, destination, die.id);
  return true;
}

export function unlockInfernoHand(state: Pick<GameState, 'infernoRewards' | 'handLevels' | 'handPlayCounts'>,
  hand: HandId): number {
  const upper = ['odds', 'evens', 'chance'].includes(hand);
  const baseline = upper ? upperBaselineLevel(state.handLevels, state.infernoRewards.unlockedHands)
    : lowerBaselineLevel(state.handLevels, state.infernoRewards.unlockedHands);
  state.handLevels[hand] = baseline;
  state.handPlayCounts[hand] = 0;
  if (!state.infernoRewards.unlockedHands.includes(hand)) state.infernoRewards.unlockedHands.push(hand);
  return baseline;
}

/** Applies structural reward state shared by normal claims and data-driven Scenario starts. */
export function applyStructuralInfernoReward(state: Pick<GameState,
  'infernoRewards' | 'handLevels' | 'handPlayCounts' | 'diceInventory'>,
offerId: InfernoRewardOfferId): string | null {
  const upgrades = state.infernoRewards.upgrades;
  if (offerId === 'expandedRoster' || offerId === 'expandedRoster2') {
    const capacity = offerId === 'expandedRoster' ? 6 : 7;
    upgrades.rosterCap = capacity;
    while (state.diceInventory.roster.length < capacity) state.diceInventory.roster.push(null);
    return `Roster capacity increased to ${capacity}.`;
  }
  const hand = INFERNO_HAND_BY_OFFER[offerId];
  if (!hand) return null;
  const baseline = unlockInfernoHand(state, hand);
  return `${hand} unlocked at the current ${['odds', 'evens', 'chance'].includes(hand) ? 'Upper' : 'Lower'} baseline, Level ${baseline}.`;
}
