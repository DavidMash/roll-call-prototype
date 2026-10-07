import { newRun, normalizeGameState } from './engine';
import type { GameState } from './types';

export const RUN_STORAGE_KEY = 'roll-call:active-run';
export const RUN_STORAGE_VERSION = 2;

type RunStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface PersistedRun {
  version: typeof RUN_STORAGE_VERSION;
  state: GameState;
}

const PHASES = new Set(['round', 'roundSummary', 'bust', 'flameSelection', 'specialOffer', 'hoodedFigure', 'shop', 'lost', 'error']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasTemplateShape(value: unknown, template: unknown): boolean {
  if (template === null) return value === null || isRecord(value) || typeof value === 'string';
  if (Array.isArray(template)) return Array.isArray(value);
  if (isRecord(template)) {
    // Derived/runtime fields are filled during normalization, including in checkpoints.
    return isRecord(value) && Object.entries(template).every(([key, child]) =>
      (['maxCharge', 'decisionId', 'sixPackXMult', 'sixPackUpperHandsPlayed', 'handFamilyFlameStages', 'bossSilenced',
        'specialOfferEffects', 'suppressedPostBossRewardRounds', 'specialOffer', 'badDreamCheckpoint',
        'freeEnhancementOfferIds', 'freeTrainingOfferKeys', 'chapterPlans', 'presentedChapters', 'scorecardCycleConsumed',
        'wildfires', 'bonfireContributions', 'bonfireRoundContributions', 'chargeAttribution', 'hoodedFigure'].includes(key) && !Object.hasOwn(value, key))
      || (Object.hasOwn(value, key) && hasTemplateShape(value[key], child)));
  }
  return typeof value === typeof template;
}

function isGameState(value: unknown): value is GameState {
  if (!isRecord(value) || typeof value.seed !== 'string' || !value.seed ||
    typeof value.phase !== 'string' || !PHASES.has(value.phase)) return false;
  const template = newRun(value.seed).state;
  // This telemetry bucket was added without invalidating otherwise compatible
  // active runs. Normalization fills it before Personal Trainer can be used.
  delete (template.stats.probabilityProcs as Partial<typeof template.stats.probabilityProcs>).personalTrainer;
  if (!hasTemplateShape(value, template)) return false;
  const { roundCheckpoint: _checkpoint, badDreamCheckpoint: _badDream, ...baseTemplate } = template;
  if (value.roundCheckpoint !== null) {
    if (!isRecord(value.roundCheckpoint)) return false;
    if (!hasTemplateShape(value.roundCheckpoint, baseTemplate)) return false;
  }
  if (value.badDreamCheckpoint !== undefined && value.badDreamCheckpoint !== null) {
    if (!isRecord(value.badDreamCheckpoint) || !hasTemplateShape(value.badDreamCheckpoint, baseTemplate)) return false;
  }
  return true;
}

export function browserRunStorage(): RunStorage | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage; }
  catch { return null; }
}

export function loadPersistedRun(storage: RunStorage | null, requestedSeed: string | null): GameState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(RUN_STORAGE_KEY);
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (!isRecord(saved) || saved.version !== RUN_STORAGE_VERSION || !isGameState(saved.state)) return null;
    if (requestedSeed !== null && saved.state.seed !== requestedSeed) return null;
    return normalizeGameState(saved.state);
  } catch {
    return null;
  }
}

export function isResumableRun(state: GameState | null): state is GameState {
  return state !== null && state.phase !== 'lost' && state.phase !== 'error';
}

export function savePersistedRun(storage: RunStorage | null, state: GameState): boolean {
  if (!storage) return false;
  const saved: PersistedRun = { version: RUN_STORAGE_VERSION, state };
  try {
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}
