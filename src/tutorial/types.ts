import type { Action, Flame, GameState } from '../game/types';

export const TUTORIAL_VERSION = 1 as const;
export const TUTORIAL_SEED = 'roll-call-tutorial-v1';

export type TutorialLessonId =
  | 'interest' | 'bust' | 'selling' | 'care-package' | 'persistent-effect'
  | 'bonfire' | 'later-boss' | 'bonus-trigger' | 'workout-trigger' | 'safeguard';

export interface TutorialScenarioState {
  tutorialVersion: typeof TUTORIAL_VERSION;
  completedBeatIds: string[];
  seenLessonIds: TutorialLessonId[];
  firstFlame: Flame | null;
  firstFlameDieId: number | null;
  workoutDieId: number | null;
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

export interface TutorialBeat {
  id: string;
  title?: string;
  body: string[];
  target?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  blocking: boolean;
  requiredAction?: string;
  actionLabel?: string;
  contextual?: boolean;
}
