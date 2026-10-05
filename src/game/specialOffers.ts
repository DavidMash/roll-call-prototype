import { stacks } from './enhancements';
import { HANDS } from './hands';
import type { GameState, HandId, Shop, SpecialOffer, SpecialOfferEffects, SpecialOfferType, TrainingOffer } from './types';

export const SPECIAL_OFFER_COLOR = '#2ED68F';

export const SPECIAL_OFFER_IDS: readonly SpecialOfferType[] = [
  'onTheHouse', 'greatFairy', 'focus', 'timeTravel', 'carePackage', 'silence', 'sommelier',
  'taxEvasion', 'fireKeeper', 'cashBonus', 'orangeTheory', 'powerball', 'bottledFairy', 'badDream',
];

export const SPECIAL_OFFERS: Record<SpecialOfferType, { name: string; description: string }> = {
  onTheHouse: { name: 'On The House', description: 'The next Shop’s initial displayed purchases are free.' },
  greatFairy: { name: 'Great Fairy', description: 'Restore all Lives. If already full, gain 15 Gold.' },
  focus: { name: 'Focus: [HAND]', description: 'Train [HAND] 4 times for free.' },
  timeTravel: { name: 'Time Travel', description: 'Go back 3 Rounds with your current build.' },
  carePackage: { name: 'Care Package', description: 'Gain 3 extra manual Rerolls that carry over until used.' },
  silence: { name: 'Silence', description: 'Disable the next Boss effect.' },
  sommelier: { name: 'Sommelier', description: 'Double the current sell value of all held Vintage faces.' },
  taxEvasion: { name: 'Tax Evasion', description: 'Earn double Interest for the next 3 Rounds.' },
  fireKeeper: { name: 'Fire Keeper', description: 'Stoke a random held Ember halfway to Bonfire.' },
  cashBonus: { name: 'Cash Bonus', description: 'For the next 3 Rounds, gain 1 Gold per Bonus stack whenever Bonus activates.' },
  orangeTheory: { name: 'Orange Theory', description: 'All Workout faces gain +5 Pips per Workout stack immediately.' },
  powerball: { name: 'Powerball', description: 'The first Jackpot triggered in the next 3 Rounds pays 50 Gold.' },
  bottledFairy: { name: 'Bottled Fairy', description: 'For the next 3 Rounds, your manual Rerolls refill once per Round if you would Bust.' },
  badDream: { name: 'Bad Dream', description: 'If your run ends in the next 3 Rounds, return here with 1 Life.' },
};

export const initialSpecialOfferEffects = (): SpecialOfferEffects => ({
  onTheHouse: false,
  carePackageRerolls: 0,
  silence: false,
  taxEvasionRounds: 0,
  cashBonusRounds: 0,
  powerballRounds: 0,
  powerballAvailable: false,
  bottledFairyRounds: 0,
  bottledFairyTriggeredThisRound: false,
  badDreamRounds: 0,
});

export function specialOfferEligible(state: Pick<GameState, 'dice'>, type: SpecialOfferType): boolean {
  if (type === 'fireKeeper') return state.dice.some(die => die.owner === 'player' && die.flame !== null && die.flame.investedGold < 100);
  if (type === 'orangeTheory') return state.dice.some(die => die.owner === 'player' && die.faces.some(face => stacks(face, 'workout') > 0));
  if (type === 'sommelier') return state.dice.some(die => die.owner === 'player' && die.faces.some(face => stacks(face, 'vintage') > 0));
  return true;
}

export const eligibleSpecialOfferTypes = (state: Pick<GameState, 'dice'>): SpecialOfferType[] =>
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

export const trainingOfferKey = (offer: TrainingOffer): string => offer.kind === 'team' ? 'team' : `hand:${offer.hand}`;
export const enhancementOfferIsFree = (shop: Shop, offerId: number): boolean => (shop.freeEnhancementOfferIds ?? []).includes(offerId);
export const trainingOfferIsFree = (shop: Shop, offer: TrainingOffer): boolean => (shop.freeTrainingOfferKeys ?? []).includes(trainingOfferKey(offer));

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
  if (effects.cashBonusRounds > 0) statuses.push(countedStatus('cashBonus', effects.cashBonusRounds, 'Round'));
  if (effects.powerballAvailable && effects.powerballRounds > 0) statuses.push({
    type: 'powerball',
    label: `Powerball · Ready · ${effects.powerballRounds} Round${effects.powerballRounds === 1 ? '' : 's'}`,
    description: SPECIAL_OFFERS.powerball.description,
  });
  if (effects.bottledFairyRounds > 0) statuses.push(countedStatus('bottledFairy', effects.bottledFairyRounds, 'Round'));
  if (effects.badDreamRounds > 0) statuses.push(countedStatus('badDream', effects.badDreamRounds, 'Round'));
  return statuses;
}

export function activeSpecialOfferStatuses(effects: SpecialOfferEffects): string[] {
  return activeSpecialOfferStatusItems(effects).map(status => status.label);
}
