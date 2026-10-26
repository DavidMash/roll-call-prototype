import { activeEncounterDice, requiredEncounterDieIds, unavailableEncounterHands } from './bosses';
import { encounterHandIds, handIsStructurallyImpossible, handOptions, isValidSelection, sameDice } from './hands';
import { canonicalPlayPreview } from './playPreview';
import type { Board, Die, HandId } from './types';
import { scoreCompare, type ExactScore } from './scoreMath';

export interface Selection { dieIds: number[]; hand: HandId | null; intent?: 'hand' | 'manual' }
export const emptySelection = (): Selection => ({ dieIds: [], hand: null });

const orderedIds = (dice: readonly Die[], ids: readonly number[]) => {
  const order = new Map(dice.map((die, index) => [die.id, index]));
  return [...ids].sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
};
const compareIds = (dice: readonly Die[], a: number[], b: number[]) => {
  const order = new Map(dice.map((die, index) => [die.id, index]));
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return (order.get(a[index]) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(b[index]) ?? Number.MAX_SAFE_INTEGER);
  }
  return a.length - b.length;
};

/** Every die that authoritative encounter/Charge rules require in a committed hand. */
export function requiredSelectionDieIds(board: Board): number[] {
  return orderedIds(board.dice, [...new Set(requiredEncounterDieIds(board))]);
}

function projectedCombinationScore(board: Board, hand: HandId, dieIds: number[], decisionMs = 0): ExactScore {
  return canonicalPlayPreview(board, hand, dieIds, decisionMs).score;
}

/**
 * Returns every authoritative physical-die combination for a hand. Availability comes from the board,
 * never the transient UI selection. Preferred manual dice are only an ordering hint.
 */
export function legalHandCombinations(
  board: Board,
  hand: HandId,
  preferredManualDieIds: number[] = [],
  decisionMs = 0,
): number[][] {
  if (board.phase !== 'round' || unavailableEncounterHands(board).includes(hand)) return [];
  const required = requiredSelectionDieIds(board);
  const preferred = new Set(preferredManualDieIds);
  const dice = activeEncounterDice(board);
  if (!encounterHandIds(board).includes(hand) || handIsStructurallyImpossible(hand, dice.length)) return [];
  const combinations = handOptions(dice, [], required, board.dieRoundState, encounterHandIds(board))
    .find(option => option.id === hand)?.combinations.map(ids => orderedIds(dice, ids)) ?? [];
  return combinations.sort((a, b) => {
    const aPreferred = preferred.size > 0 && [...preferred].every(id => a.includes(id));
    const bPreferred = preferred.size > 0 && [...preferred].every(id => b.includes(id));
    if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
    const scoreDifference = scoreCompare(projectedCombinationScore(board, hand, b, decisionMs),
      projectedCombinationScore(board, hand, a, decisionMs));
    return scoreDifference || compareIds(dice, a, b);
  });
}

export const boardHandAvailable = (board: Board, hand: HandId) => legalHandCombinations(board, hand).length > 0;

export function normalizeBoardSelection(board: Board, selection: Selection): Selection {
  const dice = activeEncounterDice(board);
  const active = new Set(dice.map(die => die.id));
  const dieIds = orderedIds(dice, selection.dieIds.filter(id => active.has(id)));
  const hand = selection.hand && legalHandCombinations(board, selection.hand)
    .some(combination => sameDice(combination, dieIds)) ? selection.hand : null;
  return { dieIds, hand, intent: selection.intent };
}

/** Scorecard -> dice selection, including deterministic repeated-click cycling. */
export function selectBoardHand(board: Board, selection: Selection, hand: HandId, decisionMs = 0): Selection {
  const manualPreference = selection.intent !== 'hand' ? selection.dieIds : [];
  const combinations = legalHandCombinations(board, hand, manualPreference, decisionMs);
  if (!combinations.length) return selection;
  if (selection.hand === hand && selection.intent === 'hand') {
    const current = combinations.findIndex(combination => sameDice(combination, selection.dieIds));
    if (current === combinations.length - 1) return emptySelection();
    const next = combinations[current < 0 ? 0 : current + 1];
    return { hand, dieIds: next, intent: 'hand' };
  }
  return { hand, dieIds: combinations[0], intent: 'hand' };
}

/** Dice -> scorecard selection. Exact, unique hands are inferred; ambiguity is left to the player. */
export function toggleBoardDie(board: Board, selection: Selection, id: number): Selection {
  const dieIds = selection.dieIds.includes(id)
    ? selection.dieIds.filter(dieId => dieId !== id)
    : orderedIds(activeEncounterDice(board), [...selection.dieIds, id]);
  if (!dieIds.length) return emptySelection();
  if (selection.hand && legalHandCombinations(board, selection.hand)
    .some(combination => sameDice(combination, dieIds))) {
    return { dieIds, hand: selection.hand, intent: 'manual' };
  }
  const completed = encounterHandIds(board).filter(hand => legalHandCombinations(board, hand)
    .some(combination => sameDice(combination, dieIds)));
  return { dieIds, hand: completed.length === 1 ? completed[0] : null, intent: 'manual' };
}

export function toggleDie(dice: Die[], consumed: HandId[], selection: Selection, id: number, requiredDieIds: number[] = []): Selection {
  const dieIds = selection.dieIds.includes(id) ? selection.dieIds.filter(die => die !== id) : orderedIds(dice, [...selection.dieIds, id]);
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
