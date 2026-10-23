import { describe, expect, it } from 'vitest';
import { newRun } from './engine';
import { Resolver } from './effects';
import {
  classifyInfernoTrend, classifyInfernoWeakness, createInfernoEvaluation, engulfmentAssetKey,
  engulfmentTrainingNormalization, maximumPossibleEngulfmentReadiness, ownedEngulfmentAssets,
  selectInfernoFeedback,
} from './engulfment';
import { placeFlameInstance } from './flames';
import { summarizeRunHistoryV2 } from './runHistoryV2Summary';
import type { GameState, RandomSource } from './types';

const constant: RandomSource = { next: () => .5 };
const state = (): GameState => newRun('inferno-global-slots', constant).state;

describe('global Flame assets', () => {
  it('projects stable instance IDs and slots without carrier IDs', () => {
    const game = state();
    const ember = placeFlameInstance(game, 'vineyard', 40, 1);
    const bonfire = placeFlameInstance(game, 'ultimate', 100, 4);
    expect(ownedEngulfmentAssets(game)).toEqual([
      { kind: 'ember', flame: 'vineyard', instanceId: ember.instanceId, slot: 1 },
      { kind: 'bonfire', flame: 'ultimate', instanceId: bonfire.instanceId, slot: 4 },
    ]);
    expect(engulfmentAssetKey(ownedEngulfmentAssets(game)[0])).toContain(`:${ember.instanceId}:vineyard:1`);
  });
  it('uses the same stable identity after Ember becomes Bonfire', () => {
    const game = state(); const flame = placeFlameInstance(game, 'minigun', 99, 2);
    flame.investedGold = 100; flame.stage = 'bonfire';
    expect(ownedEngulfmentAssets(game)).toEqual([{ kind: 'bonfire', flame: 'minigun', instanceId: flame.instanceId, slot: 2 }]);
  });
  it('calculates a collection ceiling from global instances', () => {
    const game = state(); placeFlameInstance(game, 'ultimate', 50); placeFlameInstance(game, 'minigun', 50, 1);
    expect(maximumPossibleEngulfmentReadiness(game)).toBeGreaterThan(1);
  });
});

describe('Inferno evaluation and consumption', () => {
  it('builds diagnostics from slot investment', () => {
    const game = state(); const flame = placeFlameInstance(game, 'vineyard', 73, 3);
    const evaluation = createInfernoEvaluation(game)!;
    expect(evaluation.flames[0]).toMatchObject({ asset: { instanceId: flame.instanceId, slot: 3 }, status: 'ember', investment: 73 });
  });
  it('NOT YET preserves every instance and slot', () => {
    const game = state(); const flame = placeFlameInstance(game, 'ultimate', 100, 2);
    const evaluation = createInfernoEvaluation(game)!; evaluation.success = true; game.infernoEvaluation = evaluation; game.phase = 'inferno';
    new Resolver(game, constant).deferEngulfment();
    expect(game.flameSlots[2]?.instanceId).toBe(flame.instanceId);
  });
  it('ENGULF NOW empties only consumed slots without compacting survivors', () => {
    const game = state();
    const first = placeFlameInstance(game, 'ultimate', 100, 0);
    const middle = placeFlameInstance(game, 'momentum', 100, 2);
    const last = placeFlameInstance(game, 'minigun', 100, 4);
    game.chargeAttribution[middle.instanceId] = 2;
    const evaluation = createInfernoEvaluation(game)!;
    evaluation.success = true; evaluation.flamesSnuffed = [ownedEngulfmentAssets(game)[1]];
    evaluation.flamesPreserved = [ownedEngulfmentAssets(game)[0], ownedEngulfmentAssets(game)[2]];
    evaluation.infernoLevelAfter = 1; evaluation.infernoMultiplierAfter = 25n;
    game.infernoEvaluation = evaluation; game.phase = 'inferno';
    new Resolver(game, constant).engulfNow();
    expect(game.flameSlots.map(flame => flame?.instanceId ?? null)).toEqual([first.instanceId, null, null, null, last.instanceId]);
    expect(game.chargeAttribution[middle.instanceId]).toBeUndefined();
    const event = [...game.historyV2].reverse().find(item => item.kind === 'engulfment_attempted');
    expect(event).toMatchObject({ success: true, infernoLevelBefore: 0, infernoLevelAfter: 1 });
    expect(summarizeRunHistoryV2(game.historyV2, game).experienced.flameLifecycle.engulfed).toBe(1);
  });
  it('preserves Inferno hand normalization behavior', () => {
    const game = state();
    game.handLevels.ones = 1; game.handLevels.twos = 3; game.handLevels.pair = 2; game.handLevels.twoPair = 4;
    const normalized = engulfmentTrainingNormalization(game.handLevels);
    expect(normalized.upper.unifiedLevel).toBeGreaterThanOrEqual(1);
    expect(normalized.lower.unifiedLevel).toBeGreaterThanOrEqual(1);
  });
});

describe('Inferno diagnostics', () => {
  it('classifies trends with the dead zone', () => {
    expect(classifyInfernoTrend(.5, null)).toBe('first');
    expect(classifyInfernoTrend(.56, .5)).toBe('improving');
    expect(classifyInfernoTrend(.44, .5)).toBe('worsening');
    expect(classifyInfernoTrend(.52, .5)).toBe('stable');
  });
  it('classifies investment from Flame instances', () => {
    const game = state(); placeFlameInstance(game, 'ultimate', 20); placeFlameInstance(game, 'minigun', 30, 1);
    expect(classifyInfernoWeakness(ownedEngulfmentAssets(game), .2, game)).toBe('investment');
  });
  it('selects feedback deterministically', () => {
    expect(selectInfernoFeedback('seed', 2, 'quantity', 'stable', 'none', []))
      .toEqual(selectInfernoFeedback('seed', 2, 'quantity', 'stable', 'none', []));
  });
});
