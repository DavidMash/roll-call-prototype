import { describe, expect, it } from 'vitest';
import { newTutorialSession } from './scenario';
import { loadTutorialSession, saveTutorialSession, TUTORIAL_RUN_STORAGE_KEY } from './tutorialPersistence';

describe('tutorial persistence', () => {
  it('round-trips the current tutorial schema without legacy face bindings', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const { session } = newTutorialSession();
    expect(saveTutorialSession(storage, session)).toBe(true);
    expect(values.has(TUTORIAL_RUN_STORAGE_KEY)).toBe(true);
    const loaded = loadTutorialSession(storage);
    expect(loaded?.game.diceInventory).toEqual(session.game.diceInventory);
    expect(loaded?.scenario).toEqual(session.scenario);
  });
});
