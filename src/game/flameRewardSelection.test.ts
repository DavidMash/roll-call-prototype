import { describe, expect, it } from 'vitest';
import { selectFlameRewardTypes } from './effects';
import { flameBaseMultiplier, FLAMES } from './flames';
import { OFFER_RARITY_WEIGHTS, rarityFirstSelection } from './rarity';
import type { Flame, RandomSource } from './types';

const constant = (value = .2): RandomSource => ({ next: () => value });
const sequence = (...values: number[]): RandomSource => {
  let index = 0;
  return { next: () => values[index++] ?? values.at(-1) ?? 0 };
};
const normalSelection = (pool: readonly Flame[], rng: RandomSource) =>
  rarityFirstSelection(pool, 3, id => FLAMES[id].rarity, OFFER_RARITY_WEIGHTS.flame, rng);

describe('post-boss Flame reward selection', () => {
  it('guarantees different low- and high-multiplier offers and selects a third unique Flame', () => {
    const selected = selectFlameRewardTypes(
      ['missingPair', 'lowball', 'oneShort', 'targetPractice', 'ultimate'], constant(),
    );

    const lowIndex = selected.findIndex(id => flameBaseMultiplier(id) <= 5);
    const highIndex = selected.findIndex((id, index) => index !== lowIndex && flameBaseMultiplier(id) >= 5);
    expect(selected).toHaveLength(3);
    expect(lowIndex).toBeGreaterThanOrEqual(0);
    expect(highIndex).toBeGreaterThanOrEqual(0);
    expect(new Set(selected).size).toBe(3);
  });

  it('uses a ×5 Flame for either threshold without letting it fill both slots', () => {
    const asHigh = selectFlameRewardTypes(['ultimate', 'missingPair', 'lowball'], constant());
    const asLow = selectFlameRewardTypes(['ultimate', 'oneShort', 'targetPractice'], constant());

    expect(flameBaseMultiplier('ultimate')).toBe(5);
    expect(asHigh).toContain('ultimate');
    expect(asHigh.some(id => id !== 'ultimate' && flameBaseMultiplier(id) <= 5)).toBe(true);
    expect(asLow).toContain('ultimate');
    expect(asLow.some(id => id !== 'ultimate' && flameBaseMultiplier(id) >= 5)).toBe(true);
    expect(new Set(asHigh).size).toBe(asHigh.length);
    expect(new Set(asLow).size).toBe(asLow.length);
  });

  it('still fills both guarantees when the only qualifying pair is Rare', () => {
    const selected = selectFlameRewardTypes(['speedDemon', 'targetPractice'], constant());

    expect(selected).toEqual(expect.arrayContaining(['speedDemon', 'targetPractice']));
  });

  it('randomizes presentation order after choosing the same three Flames', () => {
    const pool: Flame[] = ['missingPair', 'oneShort', 'lowball'];
    const first = selectFlameRewardTypes(pool, sequence(.1, .1, .1, .1, .1, .1, 0, 0));
    const second = selectFlameRewardTypes(pool, sequence(.1, .1, .1, .1, .1, .1, .99, .99));

    expect(new Set(first)).toEqual(new Set(second));
    expect(first).not.toEqual(second);
  });

  it('falls back to normal selection when the eligible pool cannot fill both guarantees', () => {
    const pools: Flame[][] = [
      ['missingPair', 'lowball', 'freeRealEstate'],
      ['oneShort', 'targetPractice', 'cleanSweep'],
      ['ultimate'],
    ];

    for (const pool of pools) {
      expect(selectFlameRewardTypes(pool, constant(.42))).toEqual(normalSelection(pool, constant(.42)));
    }
  });
});
