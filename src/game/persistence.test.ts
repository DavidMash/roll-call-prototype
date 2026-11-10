import { describe, expect, it } from 'vitest';
import { newRun } from './engine';
import { compactGameStateForPersistence, isResumableRun, loadPersistedRun, RUN_STORAGE_KEY, savePersistedRun } from './persistence';
import { stringifyExactJson } from './scoreMath';
import { createInfernoEvaluation, infernoMeterTransition } from './engulfment';
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
      recentMessageIds: ['close-01', 'close-02'], recentAction: 'flame_invested',
    };
    placeFlameInstance(state, 'vineyard', 40);
    state.infernoEvaluation = createInfernoEvaluation(state);
    state.phase = 'inferno';
    expect(savePersistedRun(storage, state)).toBe(true);
    const loaded = loadPersistedRun(storage, state.seed)!;
    expect(loaded).toEqual(compactGameStateForPersistence(state));
    expect(infernoMeterTransition(loaded.infernoEvaluation!).startPercent).toBe(75);
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

  it('migrates v28 Inferno levels deterministically to the authoritative cumulative multiplier', () => {
    const storage = new MemoryStorage();
    const legacy = newRun('v28-inferno').state;
    legacy.engulfmentLevel = 3;
    delete (legacy as unknown as { infernoMultiplier?: bigint }).infernoMultiplier;
    delete (legacy as unknown as { chargeEvents?: unknown[] }).chargeEvents;
    if (legacy.roundCheckpoint) {
      delete (legacy.roundCheckpoint.board as unknown as { infernoMultiplier?: bigint }).infernoMultiplier;
      delete (legacy.roundCheckpoint.board as unknown as { chargeEvents?: unknown[] }).chargeEvents;
      legacy.roundCheckpoint.board.engulfmentLevel = 3;
    }
    storage.setItem(RUN_STORAGE_KEY, stringifyExactJson({ version: 28, state: legacy }));
    const loaded = loadPersistedRun(storage, legacy.seed)!;
    expect(loaded.infernoMultiplier).toBe(15_625n);
    expect(loaded.chargeEvents).toEqual([]);
  });
});
