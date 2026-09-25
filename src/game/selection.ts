import { handOptions, isValidSelection, sameDice } from './hands';
import type { Die, HandId } from './types';

export interface Selection { dieIds: number[]; hand: HandId | null }
export const emptySelection = (): Selection => ({ dieIds: [], hand: null });

export function toggleDie(dice: Die[], consumed: HandId[], selection: Selection, id: number, requiredDieIds: number[] = []): Selection {
  const dieIds = selection.dieIds.includes(id) ? selection.dieIds.filter(die => die !== id) : [...selection.dieIds, id].sort((a, b) => a - b);
  const options = handOptions(dice, consumed, dieIds).filter(option => !option.consumed
    && option.combinations.some(set => requiredDieIds.every(required => set.includes(required))));
  const completed = options.filter(option => option.combinations.some(set => sameDice(set, dieIds)));
  const retained = selection.hand && options.some(option => option.id === selection.hand) ? selection.hand : null;
  // Keep the chosen hand while editing a compatible subset, including incomplete lower hands.
  return { dieIds, hand: retained ?? (completed.length === 1 ? completed[0].id : null) };
}
export function selectHand(dice: Die[], consumed: HandId[], selection: Selection, hand: HandId, requiredDieIds: number[] = []): Selection {
  if (selection.hand === hand) return emptySelection();
  if (consumed.includes(hand)) return selection;
  const combinations = handOptions(dice, consumed, selection.dieIds).find(option => option.id === hand)?.combinations ?? [];
  const dieIds = combinations.find(set => requiredDieIds.every(required => set.includes(required)))
    ?? handOptions(dice, consumed).find(option => option.id === hand)?.combinations
      .find(set => requiredDieIds.every(required => set.includes(required)))
    ?? null;
  return dieIds ? { dieIds, hand } : selection;
}
export const canPlay = (dice: Die[], consumed: HandId[], selection: Selection, requiredDieIds: number[] = []) =>
  selection.hand !== null && !consumed.includes(selection.hand) && requiredDieIds.every(id => selection.dieIds.includes(id))
    && isValidSelection(dice, selection.hand, selection.dieIds);
