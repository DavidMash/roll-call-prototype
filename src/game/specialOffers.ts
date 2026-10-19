import { HANDS } from './hands';
import { flameInstances } from './flames';
import type { GameState, HandId, Rarity, Shop, SpecialOffer, SpecialOfferEffects, SpecialOfferType } from './types';

export const SPECIAL_OFFER_COLOR = '#2ED68F';

export const SPECIAL_OFFER_IDS: readonly SpecialOfferType[] = [
  'onTheHouse', 'greatFairy', 'focus', 'timeTravel', 'carePackage', 'silence',
  'taxEvasion', 'fireKeeper', 'bottledFairy', 'badDream',
  'teamTraining',
];

export interface SpecialOfferDefinition { name: string; description: string; rarity: Rarity }
export const SPECIAL_OFFERS: Record<SpecialOfferType, SpecialOfferDefinition> = {
  onTheHouse: { name: 'On The House', description: 'Your first Dice purchase and first individual Training purchase in the next Shop are free.', rarity: 'uncommon' },
  greatFairy: { name: 'Great Fairy', description: 'Restore all Lives. If already full, gain 15 Gold.', rarity: 'common' },
  focus: { name: 'Focus: [HAND]', description: 'Train [HAND] 4 times for free.', rarity: 'common' },
  timeTravel: { name: 'Time Travel', description: 'Replay this Chapter from Round 1 with your current build.', rarity: 'rare' },
  carePackage: { name: 'Care Package', description: 'Gain 3 extra manual Rerolls that carry over until used.', rarity: 'common' },
  silence: { name: 'Silence', description: 'Disable the next Boss effect.', rarity: 'rare' },
  taxEvasion: { name: 'Tax Evasion', description: 'Earn double Interest for the next 3 Rounds.', rarity: 'uncommon' },
  fireKeeper: { name: 'Fire Keeper', description: 'Stoke a random held Ember halfway to Bonfire.', rarity: 'uncommon' },
  bottledFairy: { name: 'Bottled Fairy', description: 'For the next 3 Rounds, your manual Rerolls refill once per Round if you would Bust.', rarity: 'uncommon' },
  badDream: { name: 'Bad Dream', description: 'If your run ends in the next 3 Rounds, return to the post-R3 Shop with your current build and 1 Life.', rarity: 'rare' },
  teamTraining: { name: 'Team Training', description: 'Increase every hand by +1 level.', rarity: 'uncommon' },
};

export const initialSpecialOfferEffects = (): SpecialOfferEffects => ({
  onTheHouse: false,
  carePackageRerolls: 0,
  silence: false,
  taxEvasionRounds: 0,
  bottledFairyRounds: 0,
  bottledFairyTriggeredThisRound: false,
  badDreamRounds: 0,
});

export function usableManualRerolls(state: Pick<GameState, 'manualRerollsRemaining' | 'specialOfferEffects'>): number {
  return state.manualRerollsRemaining + state.specialOfferEffects.carePackageRerolls;
}

/**
 * Special Offer state whose current value survives an ordinary Bust rollback.
 * The round checkpoint owns attempt-local state; these values represent
 * run-level consumables that have already been spent during the attempt.
 */
export type BustPersistentSpecialOfferState = Pick<SpecialOfferEffects,
  'carePackageRerolls' | 'bottledFairyTriggeredThisRound'>;

export function captureBustPersistentSpecialOfferState(
  effects: SpecialOfferEffects,
): BustPersistentSpecialOfferState {
  return {
    carePackageRerolls: effects.carePackageRerolls,
    bottledFairyTriggeredThisRound: effects.bottledFairyTriggeredThisRound,
  };
}

export function restoreSpecialOfferEffectsAfterBust(
  checkpoint: SpecialOfferEffects,
  persistent: BustPersistentSpecialOfferState,
): SpecialOfferEffects {
  return {
    ...checkpoint,
    carePackageRerolls: persistent.carePackageRerolls,
    bottledFairyTriggeredThisRound:
      checkpoint.bottledFairyTriggeredThisRound || persistent.bottledFairyTriggeredThisRound,
  };
}

export function specialOfferEligible(state: Pick<GameState, 'flameSlots'>, type: SpecialOfferType): boolean {
  if (type === 'fireKeeper') return flameInstances(state).some(flame => flame.stage === 'ember');
  return true;
}

export const eligibleSpecialOfferTypes = (state: Pick<GameState, 'flameSlots'>): SpecialOfferType[] =>
  SPECIAL_OFFER_IDS.filter(type => specialOfferEligible(state, type));

export function specialOfferName(offer: SpecialOffer): string {
  return offer.type === 'focus' && offer.hand ? `Focus: ${HANDS[offer.hand].name}` : SPECIAL_OFFERS[offer.type].name;
}

export function specialOfferDescription(offer: SpecialOffer): string {
  return offer.type === 'focus' && offer.hand
    ? `Train ${HANDS[offer.hand].name} 4 times for free.`
    : SPECIAL_OFFERS[offer.type].description;
}

export function focusOffer(id: number, hand: HandId): SpecialOffer {
  return { id, type: 'focus', hand };
}

export const dicePurchaseIsFree = (shop: Shop): boolean => shop.freeDicePurchaseAvailable === true;

export interface ActiveSpecialOfferStatus {
  type: SpecialOfferType;
  label: string;
  description: string;
}

const countedStatus = (type: SpecialOfferType, count: number, unit: 'Round' | 'Reroll'): ActiveSpecialOfferStatus => ({
  type,
  label: `${SPECIAL_OFFERS[type].name} · ${count} ${unit}${count === 1 ? '' : 's'}`,
  description: SPECIAL_OFFERS[type].description,
});

export function activeSpecialOfferStatusItems(effects: SpecialOfferEffects): ActiveSpecialOfferStatus[] {
  const statuses: ActiveSpecialOfferStatus[] = [];
  if (effects.onTheHouse) statuses.push({
    type: 'onTheHouse', label: 'On The House · Next Shop', description: SPECIAL_OFFERS.onTheHouse.description,
  });
  if (effects.carePackageRerolls > 0) statuses.push({
    type: 'carePackage',
    label: `Care Package · ${effects.carePackageRerolls} Reroll${effects.carePackageRerolls === 1 ? '' : 's'} Left`,
    description: SPECIAL_OFFERS.carePackage.description,
  });
  if (effects.silence) statuses.push({
    type: 'silence', label: 'Silence · Next Boss', description: SPECIAL_OFFERS.silence.description,
  });
  if (effects.taxEvasionRounds > 0) statuses.push(countedStatus('taxEvasion', effects.taxEvasionRounds, 'Round'));
  if (effects.bottledFairyRounds > 0) statuses.push(countedStatus('bottledFairy', effects.bottledFairyRounds, 'Round'));
  if (effects.badDreamRounds > 0) statuses.push(countedStatus('badDream', effects.badDreamRounds, 'Round'));
  return statuses;
}

export function activeSpecialOfferStatuses(effects: SpecialOfferEffects): string[] {
  return activeSpecialOfferStatusItems(effects).map(status => status.label);
}
