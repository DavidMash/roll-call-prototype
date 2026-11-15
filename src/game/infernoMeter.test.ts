import { describe, expect, it } from 'vitest';
import { createCollectibleDie } from './dice';
import { createInfernoEvaluation, evaluateEngulfmentOffering, INFERNO_TIER_POWER_THRESHOLDS,
  ownedEngulfmentAssets } from './engulfment';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { placeFlameInstance } from './flames';
import { freezeInfernoMeter, infernoDiePowerRange, infernoMeterPosition, infernoMeterScaleMax,
  initialInfernoMeterPresentation, prepareInfernoMeterPresentation, revealedInfernoCheckpointCount } from './infernoMeter';
import { loadPersistedRun, savePersistedRun } from './persistence';
import { createDieEffect } from './specialDice';
import type { GameState, RandomSource } from './types';
import type { RunHistoryV2Event } from './runHistoryV2';

const constant: RandomSource = { next: () => .5 };

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function appendFlameHand(state: GameState, round: number, instanceId: number, factor: number): void {
  const awarded = BigInt(Math.round(100 * factor));
  state.historyV2.push({
    kind: 'hand_scored', seq: state.nextHistorySeq++, round, attempt: 1,
    actionId: state.nextActionId++, timelineId: state.historyV2TimelineId,
    scorePackageId: `meter:${round}`, rootPlayId: `meter:${round}`, parentPlayId: null,
    hand: 'ones', level: 1, playSource: 'manual', selectedDice: [0], scoringDice: [],
    scoreOccurrences: [{ id: `meter:${round}:score`, rootId: `meter:${round}:score`, dieId: 0,
      cause: 'play_selection', originallySelected: true, playerSelected: true, additional: false, suppressedEffects: [] }],
    consumed: true,
    score: { infernoMultiplier: 1n, finalPips: 100, handMult: 1, finalMult: 1, finalXMult: factor,
      bossFactor: 1, raw: awarded.toString(), awarded, rounding: { mode: 'nearest_integer', delta: '0' } },
    roundScore: { before: 0n, afterAward: awarded, after: awarded }, pipsContributions: [], resolvedDicePips: [],
    multContributions: [], xMultContributions: [{ sourceId: 'ultimate', origin: 'bonfire', factor,
      sourceInstanceId: instanceId }], sideEffects: [],
  } as unknown as RunHistoryV2Event);
}

function appendClear(state: GameState, round: number): void {
  state.historyV2.push({ kind: 'round_attempt_finished', seq: state.nextHistorySeq++, round, attempt: 1,
    actionId: state.nextActionId++, timelineId: state.historyV2TimelineId, outcome: 'cleared',
    score: 2_000n, target: 1n, boss: null, livesBefore: 3, livesAfter: 3 } as RunHistoryV2Event);
}

function readyState(power = 20): { state: GameState; instanceId: number } {
  const state = newRun('inferno-meter-cooldown', constant).state;
  const flame = placeFlameInstance(state, 'ultimate', 100);
  for (let round = 1; round <= 3; round++) { appendFlameHand(state, round, flame.instanceId, power); appendClear(state, round); }
  state.round = 3;
  return { state, instanceId: flame.instanceId };
}

function completeRoundWithPower(state: GameState, round: number, instanceId: number, factor = 20): void {
  state.round = round;
  new Resolver(state, constant).startRound();
  appendFlameHand(state, round, instanceId, factor);
  state.score = state.target;
  new Resolver(state, constant).evaluate();
}

describe('Inferno rejection cooldown', () => {
  it('blocks exactly three additional completed Rounds, persists, and resumes normal eligibility', () => {
    let { state, instanceId } = readyState();
    const evaluation = createInfernoEvaluation(state)!;
    state.infernoEvaluation = evaluation;
    state.infernoMeter = prepareInfernoMeterPresentation(state.infernoMeter, {
      round: 3, actualFlamePower: evaluation.perceivedFlamePower, maximumPotential: 20,
      evaluation, cooldownRounds: 0,
    });
    state.phase = 'inferno';
    state = dispatch(state, { type: 'NOT_YET' }, constant).state;
    expect(state.infernoDealCooldownRounds).toBe(3);
    expect(state.infernoMeter.frozen).not.toBeNull();

    for (const [round, shown, remaining] of [[4, 3, 2], [5, 2, 1], [6, 1, 0]] as const) {
      completeRoundWithPower(state, round, instanceId);
      expect(state.infernoEvaluation).toBeNull();
      expect(state.infernoMeter.current).toMatchObject({ dormant: true, cooldownRounds: shown });
      expect(state.infernoDealCooldownRounds).toBe(remaining);
      state = dispatch(state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant).state;
      expect(state.phase).toBe('infernoMeter');

      const storage = new MemoryStorage();
      expect(savePersistedRun(storage, state)).toBe(true);
      const revealedBeforeReload = state.infernoMeter.revealedCheckpointCount;
      state = loadPersistedRun(storage, state.seed)!;
      expect(state.infernoDealCooldownRounds).toBe(remaining);
      expect(state.infernoMeter.revealedCheckpointCount).toBe(revealedBeforeReload);
      state = dispatch(state, { type: 'CONTINUE_INFERNO_METER' }, constant).state;
      expect(state.infernoDealCooldownRounds).toBe(remaining);
    }

    completeRoundWithPower(state, 7, instanceId);
    expect(state.infernoEvaluation).not.toBeNull();
    expect(state.infernoMeter.current?.dormant).toBe(false);
    state = dispatch(state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant).state;
    state = dispatch(state, { type: 'CONTINUE_INFERNO_METER' }, constant).state;
    expect(state.phase).toBe('inferno');
  });
});

describe('Inferno meter mapping and durable presentation', () => {
  it('maps the exact evaluator power and only gives dice a section when the evaluator improves a tier', () => {
    const { state } = readyState(24);
    const die = createCollectibleDie(state.diceInventory.nextDieId++, 'doubleTime', 10);
    state.diceInventory.instances[die.id] = die;
    state.diceInventory.storage[0] = die.id;
    const offering = evaluateEngulfmentOffering(state, ownedEngulfmentAssets(state));
    const evaluation = createInfernoEvaluation(state)!;
    const meter = prepareInfernoMeterPresentation(initialInfernoMeterPresentation(), {
      round: 3, actualFlamePower: offering.offeringMultiplier, maximumPotential: 30,
      evaluation, cooldownRounds: 0,
    });
    expect(meter.current?.displayedFlamePower).toBeCloseTo(offering.offeringMultiplier, 12);
    expect(infernoDiePowerRange(evaluation)).toEqual({
      base: expect.any(Number), final: expect.any(Number),
    });
    expect(meter.current?.dieFinalPower).toBeGreaterThan(meter.current?.dieBasePower ?? Infinity);

    const withoutUpgrade = readyState(16).state;
    withoutUpgrade.diceInventory.instances[1].effects = [createDieEffect(1, 'bonus', 1)];
    const noDieDeal = createInfernoEvaluation(withoutUpgrade)!;
    expect(noDieDeal.requestedDieId).toBeNull();
    expect(infernoDiePowerRange(noDieDeal)).toBeNull();
  });

  it('reveals checkpoints in durable pairs, rescales piecewise, and never removes them as power falls', () => {
    const thresholds = INFERNO_TIER_POWER_THRESHOLDS;
    expect(revealedInfernoCheckpointCount(0, thresholds[0] - .01, thresholds[0] - .01)).toBe(0);
    expect(revealedInfernoCheckpointCount(0, thresholds[0], thresholds[0] - .01)).toBe(2);
    expect(revealedInfernoCheckpointCount(2, thresholds[0], thresholds[1])).toBe(4);
    expect(revealedInfernoCheckpointCount(4, thresholds[0], thresholds[3])).toBe(6);
    expect(revealedInfernoCheckpointCount(6, 0, 1)).toBe(6);

    const twoScale = infernoMeterScaleMax(2, thresholds[0]);
    expect(infernoMeterPosition(thresholds[0], 2, twoScale)).toBeGreaterThan(70);
    expect(infernoMeterPosition(thresholds[1], 2, twoScale)).toBe(100);
    const fourScale = infernoMeterScaleMax(4, thresholds[2]);
    expect(infernoMeterPosition(thresholds[0], 4, fourScale)).toBeLessThan(
      infernoMeterPosition(thresholds[1], 4, fourScale));
    expect(infernoMeterPosition(thresholds[3], 4, fourScale)).toBe(100);
  });

  it('freezes dormant visuals while actual power changes, then reconciles without losing discovery', () => {
    let presentation = prepareInfernoMeterPresentation(initialInfernoMeterPresentation(), {
      round: 3, actualFlamePower: INFERNO_TIER_POWER_THRESHOLDS[1], maximumPotential: 100,
      evaluation: null, cooldownRounds: 0,
    });
    expect(presentation.revealedCheckpointCount).toBe(4);
    presentation = freezeInfernoMeter(presentation);
    const frozenPower = presentation.frozen!.flamePower;
    presentation = prepareInfernoMeterPresentation(presentation, {
      round: 4, actualFlamePower: 2, maximumPotential: 100, evaluation: null, cooldownRounds: 3,
    });
    expect(presentation.current).toMatchObject({ actualFlamePower: 2, displayedFlamePower: frozenPower,
      checkpointCount: 4, dormant: true });
    presentation = prepareInfernoMeterPresentation(presentation, {
      round: 7, actualFlamePower: 5, maximumPotential: 100, evaluation: null, cooldownRounds: 0,
    });
    expect(presentation.current).toMatchObject({ startFlamePower: frozenPower, displayedFlamePower: 5,
      checkpointCount: 4, reconciling: true, dormant: false });
    expect(presentation.revealedCheckpointCount).toBe(4);
  });

  it('skips the meter when no Flames are owned', () => {
    let state = newRun('no-flames-meter', constant).state;
    state.score = state.target;
    new Resolver(state, constant).evaluate();
    expect(state.infernoMeter.current).toBeNull();
    state = dispatch(state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant).state;
    expect(state.phase).not.toBe('infernoMeter');
  });
});
