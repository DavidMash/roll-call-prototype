import { describe, expect, it } from 'vitest';
import { newRun } from './engine';

describe('removed whole-die state', () => {
  it('does not create legacy type, level, storage-award, or Shop physical-reroll state', () => {
    const state = newRun('clean-schema').state;
    for (const die of Object.values(state.diceInventory.instances)) {
      expect(die).not.toHaveProperty('type');
      expect(die).not.toHaveProperty('level');
      expect(die).not.toHaveProperty('weightedFace');
      expect(die).not.toHaveProperty('vintageAppreciation');
    }
    expect(state).not.toHaveProperty('storageAwards');
    expect(state.shop).toBeNull();
  });
});
