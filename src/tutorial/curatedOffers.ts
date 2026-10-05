import type { Flame, GameState, HandId, SpecialOffer, SpecialOfferType } from '../game/types';
import type { TutorialScenarioState } from './types';

function nextId(state: GameState): number { return state.nextOfferId++; }

function replaceEnhancement(state: GameState, enhancement: import('../game/types').Enhancement, slot = 0): void {
  if (!state.shop || state.shop.offerRerolls > 0) return;
  const existing = state.shop.offers.find(offer => offer.enhancement === enhancement);
  if (existing) return;
  const target = state.shop.offers[Math.min(slot, Math.max(0, state.shop.offers.length - 1))];
  const id = target?.id ?? nextId(state);
  if (target) Object.assign(target, { enhancement, purchased: false });
  else state.shop.offers.push({ id, enhancement, purchased: false });
}

function replaceTraining(state: GameState, hand: HandId): void {
  if (!state.shop || state.shop.trainingOffers.some(offer => offer.kind === 'hand' && offer.hand === hand)) return;
  const target = state.shop.trainingOffers[0];
  const offer = { kind: 'hand' as const, hand, purchases: 0 };
  if (target) state.shop.trainingOffers[0] = offer;
  else state.shop.trainingOffers.push(offer);
}

function specialOffers(state: GameState, specs: readonly (SpecialOfferType | { type: 'focus'; hand: HandId })[]): SpecialOffer[] {
  return specs.map(spec => typeof spec === 'string'
    ? { id: nextId(state), type: spec }
    : { id: nextId(state), type: spec.type, hand: spec.hand });
}

function flameOffers(state: GameState, flames: readonly Flame[]) {
  return flames.map(flame => ({ id: nextId(state), flame }));
}

export function curateTutorialOffers(state: GameState, scenario: TutorialScenarioState): void {
  if (state.phase === 'shop' && state.shop) {
    // The Shop after a completed round retains that round number.
    if (state.round === 1) {
      replaceTraining(state, 'fullHouse');
      if (state.shop.offerRerolls === 0) {
        const ids = state.shop.offers.map(offer => offer.id);
        state.shop.offers = (['bonus', 'magnetic', 'jackpot'] as const)
          .map((enhancement, index) => ({ id: ids[index] ?? nextId(state), enhancement, purchased: false }));
      }
    }
    if (state.round === 3) replaceEnhancement(state, 'workout', 0);

    const shopAfterFirst = state.round >= 2 && state.round <= 11;
    const eligibleIndex = state.round - 2;
    if (shopAfterFirst && eligibleIndex % 2 === 0 && !scenario.vintagePurchased && state.shop.offerRerolls === 0) {
      replaceEnhancement(state, 'vintage', state.round === 3 ? 1 : 0);
    }
  }

  if (state.phase === 'specialOffer' && state.specialOffer && !state.specialOffer.acquired) {
    if (state.round === 3) state.specialOffer.offers = specialOffers(state, ['carePackage', { type: 'focus', hand: 'fullHouse' }, 'onTheHouse']);
    if (state.round === 9) state.specialOffer.offers = specialOffers(state, ['orangeTheory', 'cashBonus', 'fireKeeper']);
  }

  if (state.phase === 'flameSelection' && state.flameSelection && !state.flameSelection.acquired) {
    if (state.round === 6) state.flameSelection.offers = flameOffers(state, ['minigun', 'doubleDown', 'straightShooter']);
    if (state.round === 12) {
      const pools: Partial<Record<Flame, Flame[]>> = {
        doubleDown: ['missingPair', 'threesCompany', 'minigun'],
        straightShooter: ['oneShort', 'threesCompany', 'minigun'],
        minigun: ['threesCompany', 'missingPair', 'oneShort'],
      };
      state.flameSelection.offers = flameOffers(state, pools[scenario.firstFlame ?? 'minigun'] ?? pools.minigun!);
    }
  }
}
