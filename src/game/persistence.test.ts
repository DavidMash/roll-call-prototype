import { describe, expect, it } from 'vitest';
import { newRun } from './engine';
import { compactGameStateForPersistence, isResumableRun, loadPersistedRun, RUN_STORAGE_KEY, RUN_STORAGE_VERSION, savePersistedRun } from './persistence';
import { stringifyExactJson } from './scoreMath';
import { createInfernoEvaluation } from './engulfment';
import { placeFlameInstance } from './flames';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('run persistence', () => {
  it('round-trips the complete current state, including Inferno progress', () => {
    const storage = new MemoryStorage();
    const state = newRun('saved-inferno').state;
    state.engulfmentLevel = 2;
    state.infernoMultiplier = 625n;
    state.infernoProgress = {
      evaluationIndex: 4, previousReadiness: .75,
      recentMessageIds: ['close-01', 'close-02'], recentAction: 'flame_invested', declinedAtEvidenceRoundId: null,
    };
    placeFlameInstance(state, 'vineyard', 40);
    state.infernoEvaluation = createInfernoEvaluation(state);
    expect(savePersistedRun(storage, state)).toBe(true);
    const loaded = loadPersistedRun(storage, state.seed)!;
    expect(loaded).toEqual(compactGameStateForPersistence(state));
    expect(loaded.infernoProgress.previousReadiness).toBe(.75);
  });

  it('only treats non-terminal phases as resumable', () => {
    const state = newRun('resumable').state;
    expect(isResumableRun(state)).toBe(true);
    expect(isResumableRun({ ...state, phase: 'inferno' })).toBe(true);
    expect(isResumableRun({ ...state, phase: 'lost' })).toBe(false);
    expect(isResumableRun({ ...state, phase: 'scenarioComplete', runMode: 'scenario',
      scenario: { id: 'short-circuit', version: 1, name: 'Short Circuit',
        startingTarget: 6_000n,
        completionPending: false, completionAcknowledged: true } })).toBe(false);
    expect(isResumableRun(null)).toBe(false);
  });

  it('rejects malformed and unsupported saves', () => {
    const storage = new MemoryStorage();
    storage.setItem(RUN_STORAGE_KEY, '{not-json');
    expect(loadPersistedRun(storage, null)).toBeNull();
    storage.setItem(RUN_STORAGE_KEY, stringifyExactJson({ version: 27, state: newRun('old').state }));
    expect(loadPersistedRun(storage, null)).toBeNull();
  });

  it('rejects a well-formed save from the previous storage version', () => {
    const storage = new MemoryStorage();
    const previous = newRun('previous-version').state;
    storage.setItem(RUN_STORAGE_KEY, stringifyExactJson({ version: RUN_STORAGE_VERSION - 1, state: previous }));
    expect(loadPersistedRun(storage, previous.seed)).toBeNull();
  });
});
