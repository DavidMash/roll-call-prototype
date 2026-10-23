import { describe, expect, it } from 'vitest';
import { captureHandStart, handXMultContributions, placeFlameInstance, standardFlameMultiplier } from './flames';
import { HAND_IDS, initialHandLevels, rankedHands, trainedBaselineStrength, ultimateHands } from './hands';
import { newRun } from './engine';
import { Resolver } from './effects';
import { renderRunHistoryV2Event } from './runHistoryV2Renderer';

const constant = (value = .2) => ({ next: () => value });

describe('Ultimate Hand ranking', () => {
  it('returns exactly one hand and uses trained baseline strength at tied levels', () => {
    const levels = initialHandLevels();
    expect(ultimateHands(levels)).toEqual(['fiveKind']);
    expect(ultimateHands(levels)).toHaveLength(1);
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
    expect(ultimateHands(levels)).toEqual(['sixes']);
  });

  it('uses canonical hand order as the stable final tie-break', () => {
    const levels = initialHandLevels();
    const ranked = rankedHands(levels);
    expect(ranked.indexOf('fourKind')).toBeLessThan(ranked.indexOf('largeStraight'));
    expect(ranked.indexOf('threeKind')).toBeLessThan(ranked.indexOf('smallStraight'));
  });

  it('lets training move a hand into the top rank and another out', () => {
    const levels = initialHandLevels();
    const before = ultimateHands(levels);
    levels.fullHouse++;
    const after = ultimateHands(levels);
    expect(before).toContain('fiveKind');
    expect(before).not.toContain('fullHouse');
    expect(after).toContain('fullHouse');
    expect(after).not.toContain('fiveKind');
  });

  it('keeps the existing investment curve and snapshots qualification at hand start', () => {
    expect([0, 25, 50, 75, 100].map(standardFlameMultiplier)).toEqual([1, 2, 3, 4, 5]);
    const state = newRun('ultimate-snapshot', constant()).state;
    placeFlameInstance(state, 'ultimate', 100);

    const qualifiedSnapshot = captureHandStart(state, 'fiveKind', [0, 1, 2, 3, 4]);
    for (const hand of HAND_IDS) state.handLevels[hand] = hand === 'fiveKind' ? 1 : 10;
    expect(handXMultContributions(qualifiedSnapshot, 'fiveKind', 1, [0, 1, 2, 3, 4]))
      .toMatchObject([{ source: 'ultimate', value: 5, dieId: null }]);

    const unqualifiedState = newRun('ultimate-snapshot-unqualified', constant()).state;
    placeFlameInstance(unqualifiedState, 'ultimate', 100);
    const unqualifiedSnapshot = captureHandStart(unqualifiedState, 'fullHouse', [0, 1, 2, 3, 4]);
    unqualifiedState.handLevels.fullHouse = 10;
    expect(handXMultContributions(unqualifiedSnapshot, 'fullHouse', 1, [0, 1, 2, 3, 4])).toEqual([]);
  });

  it('records deterministic targets when Ultimate initializes or its ranking changes', () => {
    const state = newRun('ultimate-target-history', constant()).state;
    placeFlameInstance(state, 'ultimate', 100);
    const resolver = new Resolver(state, constant());
    resolver.recordUltimateTargets('acquired', true);
    const initialized = [...state.historyV2].reverse().find(event => event.kind === 'ultimate_targets_changed');
    expect(initialized).toMatchObject({ targets: ['fiveKind'], reason: 'acquired' });
    expect(initialized && renderRunHistoryV2Event(initialized)).toBe('ULTIMATE TARGETS · Five of a Kind');

    state.handLevels.fullHouse = 2;
    resolver.recordUltimateTargets('training');
    expect([...state.historyV2].reverse().find(event => event.kind === 'ultimate_targets_changed'))
      .toMatchObject({ targets: ['fullHouse'], reason: 'training' });
    resolver.recordUltimateTargets('retry', true);
    expect([...state.historyV2].reverse().find(event => event.kind === 'ultimate_targets_changed'))
      .toMatchObject({ targets: ['fullHouse'], reason: 'retry' });
  });

  it('activates on the snapshotted target and not on a non-target hand', () => {
    const target = newRun('ultimate-target-activation', constant()).state;
    placeFlameInstance(target, 'ultimate', 100);
    target.target = 1_000_000n;
    target.dice.forEach(die => { die.value = 5; });
    new Resolver(target, constant()).play('fiveKind', [0, 1, 2, 3, 4]);
    const targetPlay = [...target.historyV2].reverse().find(event => event.kind === 'hand_scored');
    expect(targetPlay?.kind === 'hand_scored' && targetPlay.xMultContributions)
      .toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: 'ultimate', factor: 5 })]));

    const nonTarget = newRun('ultimate-nontarget-activation', constant()).state;
    placeFlameInstance(nonTarget, 'ultimate', 100);
    nonTarget.target = 1_000_000n;
    nonTarget.dice[0].value = 1;
    new Resolver(nonTarget, constant()).play('ones', [0]);
    const nonTargetPlay = [...nonTarget.historyV2].reverse().find(event => event.kind === 'hand_scored');
    expect(nonTargetPlay?.kind === 'hand_scored' && nonTargetPlay.xMultContributions.some(item => item.sourceId === 'ultimate')).toBe(false);
  });
});
