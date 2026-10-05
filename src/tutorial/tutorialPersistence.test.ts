import { describe, expect, it } from 'vitest';
import { newRun } from '../game/engine';
import { loadPersistedRun, RUN_STORAGE_KEY, savePersistedRun } from '../game/persistence';
import { newTutorialSession } from './scenario';
import {
  defaultOnboardingMetadata, loadOnboardingMetadata, loadTutorialSession, ONBOARDING_STORAGE_KEY,
  saveOnboardingMetadata, saveTutorialSession, TUTORIAL_RUN_STORAGE_KEY,
} from './tutorialPersistence';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('tutorial persistence isolation', () => {
  it('keeps normal, tutorial, and onboarding data in independent versioned records', () => {
    const storage = new MemoryStorage();
    const normal = newRun('normal-save').state;
    normal.gold = 42;
    const tutorial = newTutorialSession().session;
    tutorial.scenario.completedBeatIds.push('welcome');
    const onboarding = { ...defaultOnboardingMetadata(), normalRunFinishedOnce: true };

    expect(savePersistedRun(storage, normal)).toBe(true);
    expect(saveTutorialSession(storage, tutorial)).toBe(true);
    expect(saveOnboardingMetadata(storage, onboarding)).toBe(true);
    expect([...storage.values.keys()].sort()).toEqual([ONBOARDING_STORAGE_KEY, RUN_STORAGE_KEY, TUTORIAL_RUN_STORAGE_KEY].sort());
    expect(loadPersistedRun(storage, null)?.gold).toBe(42);
    expect(loadTutorialSession(storage)?.scenario.completedBeatIds).toContain('welcome');
    expect(loadOnboardingMetadata(storage).normalRunFinishedOnce).toBe(true);
  });

  it('falls back safely for malformed or old tutorial metadata', () => {
    const storage = new MemoryStorage();
    storage.setItem(TUTORIAL_RUN_STORAGE_KEY, '{bad');
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ version: 999, metadata: { tutorialCompleted: true } }));
    expect(loadTutorialSession(storage)).toBeNull();
    expect(loadOnboardingMetadata(storage)).toEqual(defaultOnboardingMetadata());
  });

  it('preserves physical-face bindings and rank-relative plans across refresh', () => {
    const storage = new MemoryStorage();
    const tutorial = newTutorialSession().session;
    tutorial.scenario.bonusBinding = { dieId: 1, faceRank: 2 };
    tutorial.scenario.workoutBinding = { dieId: 0, faceRank: 5 };
    tutorial.scenario.round2Plan = {
      singletonDieId: 0, singletonRank: 1, upperHand: 'ones', pairRanks: [2, 3], rerollRank: 2,
      opening: [{ dieId: 0, rank: 1 }, { dieId: 1, rank: 2 }, { dieId: 2, rank: 2 }, { dieId: 3, rank: 3 }, { dieId: 4, rank: 3 }],
    };

    expect(saveTutorialSession(storage, tutorial)).toBe(true);
    const restored = loadTutorialSession(storage);
    expect(restored?.scenario.bonusBinding).toEqual({ dieId: 1, faceRank: 2 });
    expect(restored?.scenario.workoutBinding).toEqual({ dieId: 0, faceRank: 5 });
    expect(restored?.scenario.round2Plan).toEqual(tutorial.scenario.round2Plan);
  });
});
