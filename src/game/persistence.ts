import { createDebugTrace } from './debugTrace';
import { newRun, normalizeGameState } from './engine';
import { isRollbackState } from './rollback';
import { createStats } from './telemetry';
import { stringifyExactJson } from './scoreMath';
import type { BadDreamCheckpoint, GameState } from './types';

export const RUN_STORAGE_KEY = 'roll-call:active-run';
export const RUN_STORAGE_VERSION = 21;

type RunStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface PersistedRun {
  version: typeof RUN_STORAGE_VERSION;
  state: GameState;
}

const PHASES = new Set(['round', 'roundSummary', 'inferno', 'bust', 'flameSelection', 'specialOffer', 'shop', 'lost', 'error']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasTemplateShape(value: unknown, template: unknown): boolean {
  if (template === null) return value === null || isRecord(value)
    || ['string', 'number', 'boolean'].includes(typeof value);
  if (Array.isArray(template)) return Array.isArray(value);
  if (isRecord(template)) {
    return isRecord(value) && Object.entries(template).every(([key, child]) =>
      ((key === 'diceInventory' || key === 'dieRoundState') && Object.hasOwn(value, key) && isRecord(value[key]))
      ||
      (Object.hasOwn(value, key) && hasTemplateShape(value[key], child)));
  }
  return typeof value === typeof template;
}

function isBadDreamCheckpoint(value: unknown): value is BadDreamCheckpoint {
  return isRecord(value) && Number.isInteger(value.chapter) && (value.chapter as number) > 0;
}

function isGameState(value: unknown): value is GameState {
  if (!isRecord(value) || typeof value.seed !== 'string' || !value.seed
    || typeof value.phase !== 'string' || !PHASES.has(value.phase)) return false;
  const template = newRun(value.seed).state;
  const { roundCheckpoint: _round, badDreamCheckpoint: _dream, ...baseTemplate } = template;
  if (!hasTemplateShape(value, baseTemplate)) return false;
  if (value.roundCheckpoint !== null && (!isRecord(value.roundCheckpoint) || !isRollbackState(value.roundCheckpoint))) return false;
  if (value.badDreamCheckpoint !== undefined && value.badDreamCheckpoint !== null
    && !isBadDreamCheckpoint(value.badDreamCheckpoint)) return false;
  return true;
}

export function compactGameStateForPersistence(state: GameState): GameState {
  const compact = structuredClone(state);
  // The V1 prose timeline is a playback surface, not durable analysis history.
  compact.history = [];
  // Ordinary/full trace records are reproduction data, not durable gameplay state.
  const trace = createDebugTrace('bounded');
  trace.critical = structuredClone(state.debugTrace.critical);
  compact.debugTrace = trace;
  // Preserve counters and specialist distributions that still have a runtime
  // owner, but drop historical arrays already represented losslessly by V2.
  const empty = createStats(state.seed);
  compact.stats.busts = empty.busts;
  compact.stats.mapTransitions = empty.mapTransitions;
  compact.stats.lifeRestores = empty.lifeRestores;
  compact.stats.trainingPurchases = empty.trainingPurchases;
  compact.stats.flameAcquisitions = empty.flameAcquisitions;
  compact.stats.flameStokes = empty.flameStokes;
  compact.stats.handScores = empty.handScores;
  compact.stats.jumpingBeanFreePlays = empty.jumpingBeanFreePlays;
  compact.stats.loss = null;
  return normalizeGameState(compact);
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
    if (!isRecord(saved) || saved.version !== RUN_STORAGE_VERSION) return null;
    const migrated = normalizeGameState(saved.state as GameState);
    if (!isGameState(migrated)) return null;
    if (requestedSeed !== null && migrated.seed !== requestedSeed) return null;
    return migrated;
  } catch {
    return null;
  }
}

export function isResumableRun(state: GameState | null): state is GameState {
  return state !== null && state.phase !== 'lost' && state.phase !== 'error';
}

export function savePersistedRun(storage: RunStorage | null, state: GameState): boolean {
  if (!storage) return false;
  const saved: PersistedRun = { version: RUN_STORAGE_VERSION, state: compactGameStateForPersistence(state) };
  try {
    storage.setItem(RUN_STORAGE_KEY, stringifyExactJson(saved));
    return true;
  } catch {
    return false;
  }
}
