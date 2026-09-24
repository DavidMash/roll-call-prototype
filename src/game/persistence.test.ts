import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { loadPersistedRun, RUN_STORAGE_KEY, RUN_STORAGE_VERSION, savePersistedRun } from './persistence';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('run persistence', () => {
  it('round-trips the complete settled game state', () => {
    const storage = new MemoryStorage();
    const started = newRun('saved-run').state;
    const matchingDice = started.dice.filter(die => die.value === 1);
    const action = matchingDice.length > 0
      ? { type: 'PLAY' as const, hand: 'ones' as const, dieIds: matchingDice.map(die => die.id) }
      : { type: 'MANUAL_REROLL' as const, dieIds: [0] };
    const state = dispatch(started, action).state;

    expect(savePersistedRun(storage, state)).toBe(true);
    expect(loadPersistedRun(storage, null)).toEqual(state);
    expect(loadPersistedRun(storage, 'saved-run')).toEqual(state);
    expect(loadPersistedRun(storage, 'another-run')).toBeNull();
  });

  it('rejects malformed, unsupported, and incomplete saves', () => {
    const storage = new MemoryStorage();
    storage.setItem(RUN_STORAGE_KEY, '{not-json');
    expect(loadPersistedRun(storage, null)).toBeNull();

    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: RUN_STORAGE_VERSION + 1, state: newRun('old').state }));
    expect(loadPersistedRun(storage, null)).toBeNull();

    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: RUN_STORAGE_VERSION, state: { seed: 'partial', phase: 'round' } }));
    expect(loadPersistedRun(storage, null)).toBeNull();
  });

  it('treats storage read and write failures as non-fatal', () => {
    const broken = {
      getItem(): string | null { throw new Error('blocked'); },
      setItem(): void { throw new Error('full'); },
    };
    const state = newRun('storage-failure').state;
    expect(loadPersistedRun(broken, null)).toBeNull();
    expect(savePersistedRun(broken, state)).toBe(false);
  });
});
