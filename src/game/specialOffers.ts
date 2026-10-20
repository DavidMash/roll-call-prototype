import { HANDS } from './hands';
import { flameInstances } from './flames';
import type { GameState, HandId, Rarity, Shop, SpecialOffer, SpecialOfferEffects, SpecialOfferType } from './types';
import type { RichText } from './richText';
import { plainDescription, specialOfferCopy, specialOfferVerboseDescription } from './effectDescriptions';

export const SPECIAL_OFFER_COLOR = '#2ED68F';

export const SPECIAL_OFFER_IDS: readonly SpecialOfferType[] = [
  'onTheHouse', 'greatFairy', 'focus', 'timeTravel', 'carePackage', 'silence',
  'taxEvasion', 'fireKeeper', 'bottledFairy', 'badDream',
  'teamTraining',
];

export interface SpecialOfferDefinition {
  name: string;
  description: string;
  verboseDescription: RichText;
  shortDescription?: string;
  rarity: Rarity;
}
const offerDefinition = (type: SpecialOfferType, name: string, rarity: Rarity,
  shortDescription?: string): SpecialOfferDefinition => {
  const verboseDescription = specialOfferVerboseDescription(type);
  return { name, rarity, description: plainDescription(verboseDescription), verboseDescription,
    ...(shortDescription ? { shortDescription } : {}) };
};
export const SPECIAL_OFFERS: Record<SpecialOfferType, SpecialOfferDefinition> = {
  onTheHouse: offerDefinition('onTheHouse', 'On The House', 'uncommon'),
  greatFairy: offerDefinition('greatFairy', 'Great Fairy', 'common'),
  focus: offerDefinition('focus', 'Focus: [HAND]', 'common'),
  timeTravel: offerDefinition('timeTravel', 'Time Travel', 'rare'),
  carePackage: offerDefinition('carePackage', 'Care Package', 'common'),
  silence: offerDefinition('silence', 'Silence', 'rare'),
  taxEvasion: offerDefinition('taxEvasion', 'Tax Evasion', 'uncommon'),
  fireKeeper: offerDefinition('fireKeeper', 'Fire Keeper', 'uncommon'),
  bottledFairy: offerDefinition('bottledFairy', 'Bottled Fairy', 'uncommon'),
  badDream: offerDefinition('badDream', 'Bad Dream', 'rare'),
  teamTraining: offerDefinition('teamTraining', 'Team Training', 'uncommon'),
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

export const fireKeeperInvestment = (currentInvestment: number): number => {
  const current = Math.min(100, Math.max(0, Math.floor(currentInvestment)));
  return Math.min(100, current + Math.ceil((100 - current) / 2));
};

export function specialOfferName(offer: SpecialOffer): string {
  return offer.type === 'focus' && offer.hand ? `Focus: ${HANDS[offer.hand].name}` : SPECIAL_OFFERS[offer.type].name;
}

export function specialOfferDescription(offer: SpecialOffer): string {
  return plainDescription(specialOfferCopy(offer, offer.type === 'focus' && offer.hand ? HANDS[offer.hand].name : undefined));
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
    label: `Care Package · ${effects.carePackageRerolls} Manual Reroll${effects.carePackageRerolls === 1 ? '' : 's'} Left`,
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
