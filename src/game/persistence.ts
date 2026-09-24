import { newRun } from './engine';
import type { GameState } from './types';

export const RUN_STORAGE_KEY = 'roll-call:active-run';
export const RUN_STORAGE_VERSION = 1;

type RunStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface PersistedRun {
  version: typeof RUN_STORAGE_VERSION;
  state: GameState;
}

const PHASES = new Set(['round', 'roundSummary', 'bust', 'flameSelection', 'shop', 'lost', 'error']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasTemplateShape(value: unknown, template: unknown): boolean {
  if (template === null) return value === null || isRecord(value) || typeof value === 'string';
  if (Array.isArray(template)) return Array.isArray(value);
  if (isRecord(template)) {
    return isRecord(value) && Object.entries(template).every(([key, child]) =>
      Object.hasOwn(value, key) && hasTemplateShape(value[key], child));
  }
  return typeof value === typeof template;
}

function isGameState(value: unknown): value is GameState {
  if (!isRecord(value) || typeof value.seed !== 'string' || !value.seed ||
    typeof value.phase !== 'string' || !PHASES.has(value.phase)) return false;
  const template = newRun(value.seed).state;
  if (!hasTemplateShape(value, template)) return false;
  if (value.roundCheckpoint !== null) {
    if (!isRecord(value.roundCheckpoint)) return false;
    const { roundCheckpoint: _checkpoint, ...baseTemplate } = template;
    if (!hasTemplateShape(value.roundCheckpoint, baseTemplate)) return false;
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
    return structuredClone(saved.state);
  } catch {
    return null;
  }
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
