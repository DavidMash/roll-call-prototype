import { createDebugTrace } from './debugTrace';
import { newRun, normalizeGameState } from './engine';
import { isRollbackState } from './rollback';
import { boardSnapshot, createStats } from './telemetry';
import { chapterNumberForRound } from './chapters';
import type { Action, BadDreamCheckpoint, GameState, GameStateBase, RollbackState } from './types';

export const RUN_STORAGE_KEY = 'roll-call:active-run';
export const RUN_STORAGE_VERSION = 6;
const SUPPORTED_STORAGE_VERSIONS = new Set([2, 3, 4, 5, RUN_STORAGE_VERSION]);

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
    return isRecord(value) && Object.entries(template).every(([key, child]) =>
      (['maxCharge', 'decisionId', 'sixPackXMult', 'sixPackUpperHandsPlayed', 'handFamilyFlameStages', 'bossSilenced',
        'engulfmentLevel', 'nextShopVisitId', 'nextFlameInstanceId', 'flameInstanceIds', 'visitId', 'engulfmentAttemptUsed',
        'specialOfferEffects', 'suppressedPostBossRewardRounds', 'specialOffer', 'badDreamCheckpoint',
        'freeEnhancementOfferIds', 'freeTrainingOfferKeys', 'chapterPlans', 'presentedChapters', 'chapterLifecycle', 'scorecardCycleConsumed',
        'wildfires', 'bonfireContributions', 'bonfireRoundContributions', 'chargeAttribution', 'hoodedFigure',
        'issuedChapters', 'rewardedChapters', 'forfeitedChapters', 'challengeCheckpoint',
        'historyV2', 'historyV2TimelineId', 'historyV2Coverage', 'debugTrace', 'actionJournal',
        'nextPlaybackEventId'].includes(key) && !Object.hasOwn(value, key))
      || (Object.hasOwn(value, key) && hasTemplateShape(value[key], child)));
  }
  return typeof value === typeof template;
}

function legacyRollbackState(value: unknown): RollbackState | null {
  if (!isRecord(value)) return null;
  if (isRollbackState(value)) return value;
  const legacy = value as unknown as GameStateBase;
  return { board: boardSnapshot(legacy as GameState), rngState: legacy.rngState, nextOfferId: legacy.nextOfferId };
}

function badDreamCheckpoint(value: unknown): BadDreamCheckpoint | null {
  if (!isRecord(value)) return null;
  if (typeof value.chapter === 'number' && ('hoodedChallenge' in value))
    return value as unknown as BadDreamCheckpoint;
  const legacy = legacyRollbackState(value);
  return legacy ? {
    chapter: chapterNumberForRound(legacy.board.round),
    hoodedChallenge: structuredClone(legacy.board.hoodedFigure?.active ?? null),
  } : null;
}

function isBadDreamCheckpoint(value: unknown): value is BadDreamCheckpoint {
  return isRecord(value) && Number.isInteger(value.chapter) && (value.chapter as number) > 0
    && (value.hoodedChallenge === null || isRecord(value.hoodedChallenge));
}

/** Converts Pass 1/2 and pre-V2 state shape without interpreting legacy prose. */
function migratePersistedState(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const next = structuredClone(value) as Record<string, unknown>;
  const legacyStats = isRecord(next.stats) ? next.stats : null;
  next.actionJournal ??= structuredClone((legacyStats?.actions as Action[] | undefined) ?? []);
  next.nextPlaybackEventId ??= Array.isArray(next.history)
    ? next.history.reduce((max, item) => isRecord(item) && typeof item.id === 'number' ? Math.max(max, item.id + 1) : max, 0)
    : 0;
  if (next.roundCheckpoint != null) next.roundCheckpoint = legacyRollbackState(next.roundCheckpoint);
  if (next.badDreamCheckpoint != null) next.badDreamCheckpoint = badDreamCheckpoint(next.badDreamCheckpoint);
  return next;
}

function isGameState(value: unknown): value is GameState {
  if (!isRecord(value) || typeof value.seed !== 'string' || !value.seed
    || typeof value.phase !== 'string' || !PHASES.has(value.phase)) return false;
  const template = newRun(value.seed).state;
  delete (template.stats.probabilityProcs as Partial<typeof template.stats.probabilityProcs>).personalTrainer;
  delete (template.stats.probabilityProcs as Partial<typeof template.stats.probabilityProcs>).doubleTime;
  const { roundCheckpoint: _round, badDreamCheckpoint: _dream, ...baseTemplate } = template;
  if (!hasTemplateShape(value, baseTemplate)) return false;
  if (value.roundCheckpoint !== null && (!isRecord(value.roundCheckpoint) || !isRollbackState(value.roundCheckpoint))) return false;
  if (value.badDreamCheckpoint !== undefined && value.badDreamCheckpoint !== null
    && !isBadDreamCheckpoint(value.badDreamCheckpoint)) return false;
  return true;
}

export function compactGameStateForPersistence(state: GameState): GameState {
  const compact = structuredClone(state);
  // Compatibility-only prose is accepted on load but never carried into current saves.
  compact.history = [];
  // Ordinary/full trace records are reproduction data, not durable gameplay state.
  const trace = createDebugTrace('bounded');
  trace.critical = structuredClone(state.debugTrace.critical);
  compact.debugTrace = trace;
  // Preserve counters and specialist distributions that still have a runtime
  // owner, but drop historical arrays already represented losslessly by V2.
  const empty = createStats(state.seed);
  compact.stats.purchases = empty.purchases;
  compact.stats.sales = empty.sales;
  compact.stats.busts = empty.busts;
  compact.stats.mapTransitions = empty.mapTransitions;
  compact.stats.lifeRestores = empty.lifeRestores;
  compact.stats.vintageGrowth = empty.vintageGrowth;
  compact.stats.trainingPurchases = empty.trainingPurchases;
  compact.stats.flameAcquisitions = empty.flameAcquisitions;
  compact.stats.flameStokes = empty.flameStokes;
  compact.stats.handScores = empty.handScores;
  compact.stats.jumpingBeanFreePlays = empty.jumpingBeanFreePlays;
  compact.stats.loss = null;
  return compact;
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
    if (!isRecord(saved) || typeof saved.version !== 'number' || !SUPPORTED_STORAGE_VERSIONS.has(saved.version)) return null;
    const migrated = migratePersistedState(saved.state);
    if (!isGameState(migrated)) return null;
    if (requestedSeed !== null && migrated.seed !== requestedSeed) return null;
    return normalizeGameState(migrated);
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
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}
