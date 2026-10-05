import { normalizeGameState } from '../game/engine';
import type { GameState } from '../game/types';
import { TUTORIAL_VERSION, type OnboardingMetadata, type TutorialScenarioState, type TutorialSession } from './types';
import { reconcileTutorialBindings } from './tutorialBindings';

export const TUTORIAL_RUN_STORAGE_KEY = 'roll-call:tutorial-run';
export const ONBOARDING_STORAGE_KEY = 'roll-call:onboarding';
export const TUTORIAL_RUN_STORAGE_VERSION = 1;
export const ONBOARDING_STORAGE_VERSION = 1;

export type TutorialStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const defaultOnboardingMetadata = (): OnboardingMetadata => ({
  tutorialVersion: TUTORIAL_VERSION,
  tutorialCompleted: false,
  normalRunFinishedOnce: false,
});

export const initialTutorialScenario = (): TutorialScenarioState => ({
  tutorialVersion: TUTORIAL_VERSION,
  completedBeatIds: [],
  seenLessonIds: [],
  firstFlame: null,
  firstFlameDieId: null,
  workoutDieId: null,
  bonusBinding: null,
  workoutBinding: null,
  round2Plan: null,
  round4Plan: null,
  vintageShopsSeeded: 0,
  vintagePurchased: false,
  safeguardActivations: 0,
  safeguardRerollsGranted: 0,
  suppressedEncounterRound: null,
  structuredCurriculumComplete: false,
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function loadOnboardingMetadata(storage: TutorialStorage | null): OnboardingMetadata {
  if (!storage) return defaultOnboardingMetadata();
  try {
    const raw = storage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return defaultOnboardingMetadata();
    const saved: unknown = JSON.parse(raw);
    if (!isRecord(saved) || saved.version !== ONBOARDING_STORAGE_VERSION || !isRecord(saved.metadata)) return defaultOnboardingMetadata();
    return {
      tutorialVersion: TUTORIAL_VERSION,
      tutorialCompleted: saved.metadata.tutorialVersion === TUTORIAL_VERSION && saved.metadata.tutorialCompleted === true,
      normalRunFinishedOnce: saved.metadata.normalRunFinishedOnce === true,
    };
  } catch { return defaultOnboardingMetadata(); }
}

export function saveOnboardingMetadata(storage: TutorialStorage | null, metadata: OnboardingMetadata): boolean {
  if (!storage) return false;
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ version: ONBOARDING_STORAGE_VERSION, metadata }));
    return true;
  } catch { return false; }
}

function scenarioIsValid(value: unknown): value is TutorialScenarioState {
  return isRecord(value) && value.tutorialVersion === TUTORIAL_VERSION
    && Array.isArray(value.completedBeatIds) && value.completedBeatIds.every(item => typeof item === 'string')
    && Array.isArray(value.seenLessonIds) && value.seenLessonIds.every(item => typeof item === 'string');
}

export function loadTutorialSession(storage: TutorialStorage | null): TutorialSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(TUTORIAL_RUN_STORAGE_KEY);
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (!isRecord(saved) || saved.version !== TUTORIAL_RUN_STORAGE_VERSION || !isRecord(saved.session)) return null;
    if (saved.session.tutorialVersion !== TUTORIAL_VERSION || !scenarioIsValid(saved.session.scenario) || !isRecord(saved.session.game)) return null;
    // normalizeGameState is the engine's compatibility gate. A malformed object
    // may still throw while normalizing, which is intentionally treated as no save.
    const game = normalizeGameState(saved.session.game as unknown as GameState);
    const session = { tutorialVersion: TUTORIAL_VERSION, game,
      scenario: { ...initialTutorialScenario(), ...saved.session.scenario } } as TutorialSession;
    reconcileTutorialBindings(session);
    return session;
  } catch { return null; }
}

export function saveTutorialSession(storage: TutorialStorage | null, session: TutorialSession): boolean {
  if (!storage) return false;
  try {
    storage.setItem(TUTORIAL_RUN_STORAGE_KEY, JSON.stringify({ version: TUTORIAL_RUN_STORAGE_VERSION, session }));
    return true;
  } catch { return false; }
}

export function clearTutorialSession(storage: TutorialStorage | null): boolean {
  if (!storage) return false;
  try { storage.removeItem(TUTORIAL_RUN_STORAGE_KEY); return true; }
  catch { return false; }
}

export const isResumableTutorial = (session: TutorialSession | null): session is TutorialSession =>
  !!session && session.game.phase !== 'lost' && session.game.phase !== 'error';
