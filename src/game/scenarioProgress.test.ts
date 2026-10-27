import { describe, expect, it } from 'vitest';
import { SCENARIO_PROGRESS_STORAGE_KEY, SCENARIO_PROGRESS_VERSION, loadScenarioProgress, recordScenarioCompletion } from './scenarioProgress';

class StorageMock {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('Scenario completion progress', () => {
  it('persists separately, keeps the first timestamp, increments count, and stores versions', () => {
    const storage = new StorageMock();
    recordScenarioCompletion(storage, 'popcorn', 1, 'run-a', '2026-01-01T00:00:00.000Z');
    recordScenarioCompletion(storage, 'popcorn', 2, 'run-b', '2026-02-01T00:00:00.000Z');
    recordScenarioCompletion(storage, 'popcorn', 2, 'run-b', '2026-03-01T00:00:00.000Z');
    const progress = loadScenarioProgress(storage);
    expect(progress.version).toBe(SCENARIO_PROGRESS_VERSION);
    expect(progress.completions.popcorn).toMatchObject({ scenarioId: 'popcorn', scenarioVersion: 2,
      completed: true, firstCompletedAt: '2026-01-01T00:00:00.000Z', completionCount: 2 });
    expect(storage.values.has(SCENARIO_PROGRESS_STORAGE_KEY)).toBe(true);
  });

  it('ignores malformed or unrelated storage without coupling to active-run versions', () => {
    const storage = new StorageMock();
    storage.setItem('roll-call:run', '{"version":999}');
    expect(loadScenarioProgress(storage).completions).toEqual({});
  });
});
