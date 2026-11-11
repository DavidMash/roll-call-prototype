import { encounterHandIds } from './hands';
import { hasLegalCombination, type Selection } from './selection';
import type { Board, HandId } from './types';

export interface ScorecardAvailability {
  playableHands: ReadonlySet<HandId>;
  hasExactHand: boolean;
}

export function deriveScorecardAvailability(board: Board, selection: Selection): ScorecardAvailability {
  const hands = encounterHandIds(board);
  const playableHands = new Set(hands.filter(hand => hasLegalCombination(board, hand)));
  const hasExactHand = selection.dieIds.length === 0
    || hands.some(hand => hasLegalCombination(board, hand, selection.dieIds));
  return { playableHands, hasExactHand };
}

/** Retains decision-support state while playback presents cloned historical Boards. */
export class ScorecardAvailabilityPlaybackGate {
  private latestInteractive: ScorecardAvailability | null = null;

  resolve(busy: boolean, deriveInteractive: () => ScorecardAvailability): ScorecardAvailability {
    if (!busy || !this.latestInteractive) this.latestInteractive = deriveInteractive();
    return this.latestInteractive;
  }
}
