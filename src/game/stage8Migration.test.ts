import { describe, expect, it } from 'vitest';
import { newRun } from './engine';
import { loadPersistedRun, RUN_STORAGE_KEY, RUN_STORAGE_VERSION, savePersistedRun } from './persistence';
import { createDieEffect } from './specialDice';

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

describe('composable-die persistence schema', () => {
  it('round-trips effect instances, Temper, Forge unlock, and current Shop stage', () => {
    const state = newRun('schema-20').state;
    state.diceInventory.instances[0].effects = [createDieEffect(0, 'magic', 3), createDieEffect(0, 'bonus', 2)];
    state.temper = 41; state.forgeUnlocked = true;
    const storage = memoryStorage();
    expect(savePersistedRun(storage, state)).toBe(true);
    const loaded = loadPersistedRun(storage, state.seed)!;
    expect(loaded.diceInventory.instances[0].effects).toEqual(state.diceInventory.instances[0].effects);
    expect(loaded).toMatchObject({ temper: 41, forgeUnlocked: true });
    expect(JSON.parse(storage.values.get(RUN_STORAGE_KEY)!).version).toBe(RUN_STORAGE_VERSION);
  });

  it('rejects an obsolete whole-die schema without migration', () => {
    const storage = memoryStorage();
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: RUN_STORAGE_VERSION - 1,
      state: { seed: 'old', dice: [{ type: 'bonus', level: 2 }] } }));
    expect(loadPersistedRun(storage, 'old')).toBeNull();
  });
});
