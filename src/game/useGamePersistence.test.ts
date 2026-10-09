import { describe, expect, it } from 'vitest';
import { persistResolvedRun } from '../useGame';
import { newRun } from './engine';

describe('useGame persistence status', () => {
  it('does not report a stored run when browser persistence rejects the write', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded'); },
    };

    const state = newRun('failed-use-game-save').state;
    expect(persistResolvedRun(storage, state)).toBe(false);
    expect(persistResolvedRun(storage, state)).toBe(false);
    expect(state.debugTrace.critical).toContainEqual(expect.objectContaining({ kind: 'persistence_failure', occurrences: 2 }));
  });
});
