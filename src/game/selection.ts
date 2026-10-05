import { activeEncounterDice, requiredEncounterDieIds, unavailableEncounterHands } from './bosses';
import {
  activeFlameId, captureHandStart, composeXMult, handXMultContributions, hasChargeBonfire, isChargeFlame,
} from './flames';
import { handOptions, HAND_IDS, isValidSelection, sameDice } from './hands';
import { finalizeScore, handScore } from './scoring';
import type { Board, Die, HandId } from './types';

export interface Selection { dieIds: number[]; hand: HandId | null; intent?: 'hand' | 'manual' }
export const emptySelection = (): Selection => ({ dieIds: [], hand: null });

const sortedIds = (ids: number[]) => [...ids].sort((a, b) => a - b);
const compareIds = (a: number[], b: number[]) => {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
};

/** Every die that authoritative encounter/Charge rules require in a committed hand. */
export function requiredSelectionDieIds(board: Board): number[] {
  const required = requiredEncounterDieIds(board);
  if (board.chargeArmed && !hasChargeBonfire(board)) {
    required.push(...board.dice.filter(die => isChargeFlame(activeFlameId(die.flame))).map(die => die.id));
  }
  return [...new Set(required)].sort((a, b) => a - b);
}

function projectedCombinationScore(board: Board, hand: HandId, dieIds: number[], decisionMs = 0): number {
  const dice = activeEncounterDice(board);
  const base = handScore(dice, hand, dieIds, board.handLevels[hand]);
  const snapshot = captureHandStart(board, hand, dieIds, decisionMs);
  const xMult = composeXMult(handXMultContributions(snapshot, hand, board.handLevels[hand], dieIds));
  return finalizeScore(base.pips, base.multiplier, xMult * snapshot.bossFactor).finalScore;
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
  const combinations = handOptions(activeEncounterDice(board), [], required)
    .find(option => option.id === hand)?.combinations.map(sortedIds) ?? [];
  return combinations.sort((a, b) => {
    const aPreferred = preferred.size > 0 && [...preferred].every(id => a.includes(id));
    const bPreferred = preferred.size > 0 && [...preferred].every(id => b.includes(id));
    if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
    const scoreDifference = projectedCombinationScore(board, hand, b, decisionMs)
      - projectedCombinationScore(board, hand, a, decisionMs);
    return scoreDifference || compareIds(a, b);
  });
}

export const boardHandAvailable = (board: Board, hand: HandId) => legalHandCombinations(board, hand).length > 0;

export function normalizeBoardSelection(board: Board, selection: Selection): Selection {
  const active = new Set(activeEncounterDice(board).map(die => die.id));
  const dieIds = sortedIds(selection.dieIds.filter(id => active.has(id)));
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
    : sortedIds([...selection.dieIds, id]);
  if (!dieIds.length) return emptySelection();
  if (selection.hand && legalHandCombinations(board, selection.hand)
    .some(combination => sameDice(combination, dieIds))) {
    return { dieIds, hand: selection.hand, intent: 'manual' };
  }
  const completed = HAND_IDS.filter(hand => legalHandCombinations(board, hand)
    .some(combination => sameDice(combination, dieIds)));
  return { dieIds, hand: completed.length === 1 ? completed[0] : null, intent: 'manual' };
}

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
