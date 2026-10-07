import type { Selection } from '../game/selection';
import type { Action, Flame, GameState, HandId, Rank } from '../game/types';

export const TUTORIAL_VERSION = 1 as const;
export const TUTORIAL_SEED = 'roll-call-tutorial-v1';

export type TutorialLessonId =
  | 'interest' | 'bust' | 'selling' | 'care-package' | 'persistent-effect'
  | 'bonfire' | 'later-boss' | 'bonus-trigger' | 'workout-trigger' | 'safeguard';

export interface TutorialFaceBinding {
  dieId: number;
  faceRank: Rank;
}

export interface TutorialRankPlan {
  singletonDieId: number;
  singletonRank: Rank;
  upperHand: HandId;
  pairRanks: [Rank, Rank];
  rerollRank: Rank;
  opening: { dieId: number; rank: Rank }[];
}

export interface TutorialScenarioState {
  tutorialVersion: typeof TUTORIAL_VERSION;
  completedBeatIds: string[];
  seenLessonIds: TutorialLessonId[];
  firstFlame: Flame | null;
  firstFlameDieId: number | null;
  workoutDieId: number | null;
  bonusBinding: TutorialFaceBinding | null;
  workoutBinding: TutorialFaceBinding | null;
  round2Plan: TutorialRankPlan | null;
  round4Plan: TutorialRankPlan | null;
  vintageShopsSeeded: number;
  vintagePurchased: boolean;
  safeguardActivations: number;
  safeguardRerollsGranted: number;
  suppressedEncounterRound: number | null;
  structuredCurriculumComplete: boolean;
}

export interface TutorialSession {
  tutorialVersion: typeof TUTORIAL_VERSION;
  game: GameState;
  scenario: TutorialScenarioState;
}

export interface OnboardingMetadata {
  tutorialVersion: typeof TUTORIAL_VERSION;
  tutorialCompleted: boolean;
  normalRunFinishedOnce: boolean;
}

export interface TutorialDispatchOptions {
  allowAction?: (action: Action) => string | null;
}

export interface TutorialUiState {
  selection: Selection;
  selectedOffer: number | null;
  selectedFlameOffer: number | null;
  flameDetailsOpen: boolean;
}

export type TutorialCompletion =
  | { kind: 'acknowledge' }
  | { kind: 'selection'; description: string }
  | { kind: 'action'; description: string };

export interface TutorialBeat {
  id: string;
  title?: string;
  body: string[];
  target?: string;
  highlightTargets?: string[];
  interactiveTargets?: string[];
  side?: 'top' | 'right' | 'bottom' | 'left';
  blocking: boolean;
  gateInteractions?: boolean;
  requiredAction?: string;
  actionLabel?: string;
  completion?: TutorialCompletion;
  recoveryBeatId?: string;
  contextual?: boolean;
}
