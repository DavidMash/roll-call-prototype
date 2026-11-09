import { availableHandIds, benchWarmerHand, ultimateHands } from './hands';
import { HAND_FAMILY_FLAME_IDS, HAND_FAMILY_FLAMES, hasOwnedFlame, PROGRESSIVE_FLAME_SEQUENCES } from './flames';
import type { Board, HandId } from './types';

export type ScorecardAnnotationKind = 'ultimate' | 'target' | 'benchWarmer' | 'next' | 'setup' | 'payoff';
export interface ScorecardAnnotation {
  kind: ScorecardAnnotationKind;
  label: string;
  source: string;
}

/** Flames whose trigger text directly references the authoritative Ultimate hand identity. */
export const ULTIMATE_REFERENCING_FLAMES = [
  'ultimate', 'powerSurge', 'potentialEnergy', 'casual', 'dareDevil',
] as const;

export function scorecardHandAnnotations(board: Board): Partial<Record<HandId, ScorecardAnnotation[]>> {
  const result: Partial<Record<HandId, ScorecardAnnotation[]>> = {};
  const add = (hand: HandId, annotation: ScorecardAnnotation) => {
    (result[hand] ??= []).push(annotation);
  };
  if (ULTIMATE_REFERENCING_FLAMES.some(flame => hasOwnedFlame(board, flame))) {
    for (const hand of ultimateHands(board.handLevels, availableHandIds(board))) add(hand,
      { kind: 'ultimate', label: 'ULTIMATE', source: 'Ultimate-referencing Flame' });
  }
  // The stored target is authoritative while score playback is still resolving;
  // Flame removal clears it once the resolver reaches its cleanup boundary.
  if (board.targetPracticeHand) add(board.targetPracticeHand,
    { kind: 'target', label: 'TARGET', source: 'Target Practice' });
  if (hasOwnedFlame(board, 'benchWarmer')) add(benchWarmerHand(board.handLevels, availableHandIds(board)),
    { kind: 'benchWarmer', label: 'BENCH WARMER', source: 'Bench Warmer' });
  if (hasOwnedFlame(board, 'hotStreak') && board.hotStreakGoal) add(board.hotStreakGoal,
    { kind: 'next', label: 'NEXT', source: 'Hot Streak' });
  for (const flame of ['topDown', 'countDown'] as const) if (hasOwnedFlame(board, flame)) {
    const hand = PROGRESSIVE_FLAME_SEQUENCES[flame].hands[board.progressiveFlames[flame]];
    if (hand) add(hand, { kind: 'next', label: 'NEXT', source: flame === 'topDown' ? 'Top Down' : 'Count Down' });
  }
  for (const flame of HAND_FAMILY_FLAME_IDS) if (hasOwnedFlame(board, flame)) {
    const stage = board.handFamilyFlameStages[flame] ?? 'setup';
    if (stage === 'setup') add(HAND_FAMILY_FLAMES[flame].setup,
      { kind: 'setup', label: 'SETUP', source: flame });
    if (stage === 'payoff') add(HAND_FAMILY_FLAMES[flame].payoff,
      { kind: 'payoff', label: 'PAYOFF', source: flame });
  }
  return result;
}
