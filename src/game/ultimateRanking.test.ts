import { describe, expect, it } from 'vitest';
import { captureHandStart, handXMultContributions, standardFlameMultiplier } from './flames';
import { HAND_IDS, initialHandLevels, rankedHands, trainedBaselineStrength, ultimateHands } from './hands';
import { newRun } from './engine';

const constant = (value = .2) => ({ next: () => value });

describe('Ultimate Hand ranking', () => {
  it('always returns exactly three hands and uses trained baseline strength at tied levels', () => {
    const levels = initialHandLevels();
    expect(ultimateHands(levels)).toEqual(['fiveKind', 'fourKind', 'largeStraight']);
    expect(ultimateHands(levels)).toHaveLength(3);
    expect(new Set(ultimateHands(levels)).size).toBe(3);
    expect(trainedBaselineStrength('fiveKind', 1)).toBeGreaterThan(trainedBaselineStrength('fullHouse', 1));
  });

  it('ranks level before strength even when the lower-level baseline is much stronger', () => {
    const levels = initialHandLevels();
    levels.ones = 2;
    expect(trainedBaselineStrength('ones', 2)).toBeLessThan(trainedBaselineStrength('fiveKind', 1));
    expect(rankedHands(levels)[0]).toBe('ones');
  });

  it('prefers Sixes through Ones for otherwise-identical Upper hands', () => {
    const levels = initialHandLevels();
    for (const hand of ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const) levels[hand] = 2;
    expect(ultimateHands(levels)).toEqual(['sixes', 'fives', 'fours']);
  });

  it('uses canonical hand order as the stable final tie-break', () => {
    const levels = initialHandLevels();
    const ranked = rankedHands(levels);
    expect(ranked.indexOf('fourKind')).toBeLessThan(ranked.indexOf('largeStraight'));
    expect(ranked.indexOf('threeKind')).toBeLessThan(ranked.indexOf('smallStraight'));
  });

  it('lets training move a hand into the top three and another out', () => {
    const levels = initialHandLevels();
    const before = ultimateHands(levels);
    levels.fullHouse++;
    const after = ultimateHands(levels);
    expect(before).toContain('largeStraight');
    expect(before).not.toContain('fullHouse');
    expect(after).toContain('fullHouse');
    expect(after).not.toContain('largeStraight');
  });

  it('keeps the existing investment curve and snapshots qualification at hand start', () => {
    expect([0, 25, 50, 75, 100].map(standardFlameMultiplier)).toEqual([1, 2, 3, 4, 5]);
    const state = newRun('ultimate-snapshot', constant()).state;
    state.bonfires = ['ultimate'];

    const qualifiedSnapshot = captureHandStart(state, 'largeStraight');
    for (const hand of HAND_IDS) state.handLevels[hand] = hand === 'largeStraight' ? 1 : 10;
    expect(handXMultContributions(qualifiedSnapshot, 'largeStraight', 1, [0, 1, 2, 3, 4]))
      .toMatchObject([{ source: 'ultimate', value: 5, dieId: null }]);

    const unqualifiedState = newRun('ultimate-snapshot-unqualified', constant()).state;
    unqualifiedState.bonfires = ['ultimate'];
    const unqualifiedSnapshot = captureHandStart(unqualifiedState, 'fullHouse');
    unqualifiedState.handLevels.fullHouse = 10;
    expect(handXMultContributions(unqualifiedSnapshot, 'fullHouse', 1, [0, 1, 2, 3, 4])).toEqual([]);
  });
});
