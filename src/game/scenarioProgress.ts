export const SCENARIO_PROGRESS_STORAGE_KEY = 'roll-call:scenario-progress';
export const SCENARIO_PROGRESS_VERSION = 1;

export interface ScenarioCompletionRecord {
  scenarioId: string;
  scenarioVersion: number;
  completed: true;
  firstCompletedAt: string;
  completionCount: number;
  /** Internal idempotency keys; retained so one completed run is never counted twice after reload. */
  completedRunIds: string[];
}
export interface ScenarioProgress {
  version: typeof SCENARIO_PROGRESS_VERSION;
  completions: Record<string, ScenarioCompletionRecord>;
}

export const emptyScenarioProgress = (): ScenarioProgress => ({ version: SCENARIO_PROGRESS_VERSION, completions: {} });

export function loadScenarioProgress(storage: Pick<Storage, 'getItem'>): ScenarioProgress {
  try {
    const raw = storage.getItem(SCENARIO_PROGRESS_STORAGE_KEY);
    if (!raw) return emptyScenarioProgress();
    const parsed = JSON.parse(raw) as Partial<ScenarioProgress>;
    if (parsed.version !== SCENARIO_PROGRESS_VERSION || !parsed.completions || typeof parsed.completions !== 'object')
      return emptyScenarioProgress();
    const completions: ScenarioProgress['completions'] = {};
    for (const [id, value] of Object.entries(parsed.completions)) {
      const item = value as Partial<ScenarioCompletionRecord>;
      if (item.completed !== true || item.scenarioId !== id || !Number.isSafeInteger(item.scenarioVersion)
        || typeof item.firstCompletedAt !== 'string' || !Number.isSafeInteger(item.completionCount)) continue;
      completions[id] = { scenarioId: id, scenarioVersion: item.scenarioVersion!, completed: true,
        firstCompletedAt: item.firstCompletedAt, completionCount: Math.max(1, item.completionCount!),
        completedRunIds: Array.isArray(item.completedRunIds) ? item.completedRunIds.filter(runId => typeof runId === 'string').slice(-100) : [] };
    }
    return { version: SCENARIO_PROGRESS_VERSION, completions };
  } catch {
    return emptyScenarioProgress();
  }
}

export function saveScenarioProgress(storage: Pick<Storage, 'setItem'>, progress: ScenarioProgress): void {
  storage.setItem(SCENARIO_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
}

export function recordScenarioCompletion(storage: Pick<Storage, 'getItem' | 'setItem'>, scenarioId: string,
  scenarioVersion: number, runId: string, completedAt = new Date().toISOString()): ScenarioProgress {
  const progress = loadScenarioProgress(storage);
  const existing = progress.completions[scenarioId];
  if (existing?.completedRunIds.includes(runId)) return progress;
  progress.completions[scenarioId] = existing ? {
    ...existing, scenarioVersion, completionCount: existing.completionCount + 1,
    completedRunIds: [...existing.completedRunIds, runId].slice(-100),
  } : { scenarioId, scenarioVersion, completed: true, firstCompletedAt: completedAt,
    completionCount: 1, completedRunIds: [runId] };
  saveScenarioProgress(storage, progress);
  return progress;
}
