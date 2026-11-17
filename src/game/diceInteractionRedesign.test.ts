import { describe, expect, it } from 'vitest';
import { activeFace, distinctDieOutcomes, highestAvailableRank, lowestAvailableRank } from './dice';
import { dispatch, newRun, validateAction } from './engine';
import { Resolver } from './effects';
import { placeFlameInstance, recalculateMaxCharge } from './flames';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { effectOf, effectRuntime, createDieEffect, normalizeDieRoundRuntime, resetDieRoundState } from './specialDice';
import type { GameState, RandomSource, Rank, SpecialDieType } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });

function game(): GameState {
  const state = newRun('dice-interaction-redesign', constant(.8)).state;
  state.target = 1_000_000n;
  state.manualRerollsRemaining = 10;
  return state;
}

function equip(state: GameState, dieIndex: number, effects: Array<[SpecialDieType, number]>) {
  const die = rosterDice(state)[dieIndex];
  die.effects = effects.map(([type, level]) => createDieEffect(die.id, type, level));
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  return die;
}

describe('atomic Manual Reroll Magic choices', () => {
  it('supports optional independent choices on multiple Magic dice and spends only participating Uses', () => {
    let state = game();
    const first = equip(state, 0, [['magic', 2]]);
    const second = equip(state, 1, [['magic', 2]]);
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [first.id, second.id], magicChoices: [
      { dieId: first.id, outcome: { kind: 'rank', rank: 4 } },
    ] }, constant(.99)).state;
    expect(activeFace(state.diceInventory.instances[first.id]).rank).toBe(4);
    expect(effectRuntime(state.dieRoundState[first.id], effectOf(state.diceInventory.instances[first.id], 'magic'))?.invocationsRemaining).toBe(1);
    expect(effectRuntime(state.dieRoundState[second.id], effectOf(state.diceInventory.instances[second.id], 'magic'))?.invocationsRemaining).toBe(2);
  });

  it('deduplicates modified outcomes, rejects stale choices, and never uses Magic on automatic Rolls', () => {
    const state = game();
    const die = equip(state, 0, [['magic', 1]]);
    die.faces.forEach((face, index) => { face.rank = ([2, 2, 3, 3, 4, 4] as Rank[])[index]; });
    expect(distinctDieOutcomes(die).map(outcome => outcome.rank)).toEqual([2, 3, 4]);
    expect(validateAction(state, { type: 'MANUAL_REROLL', dieIds: [die.id],
      magicChoices: [{ dieId: die.id, outcome: { kind: 'rank', rank: 6 } }] })).toMatch(/currently defined/);
    effectRuntime(state.dieRoundState[die.id], effectOf(die, 'magic'))!.magicArmedFace = 4;
    new Resolver(state, constant()).rollBatch([die.id], 'Automatic effect Roll', 'gameplay', false, 'other');
    expect(activeFace(die).rank).toBe(2);
    expect(effectRuntime(state.dieRoundState[die.id], effectOf(die, 'magic'))?.invocationsRemaining).toBe(1);
  });

  it('counts a Magic-forced outcome as a Lightning Strike hit before Jumping Bean follows up', () => {
    const state = game();
    const die = equip(state, 0, [['magic', 1], ['jumpingBean', 1]]);
    die.faces.forEach((face, index) => { face.rank = ([2, 2, 3, 3, 4, 4] as Rank[])[index]; });
    placeFlameInstance(state, 'lightningStrike', 100);
    recalculateMaxCharge(state);
    const result = dispatch(state, { type: 'ACTIVATE_LIGHTNING_STRIKE',
      predictions: [{ dieId: die.id, outcome: { kind: 'rank', rank: 2 } }],
      magicChoices: [{ dieId: die.id, outcome: { kind: 'rank', rank: 2 } }],
    }, constant(.99));
    expect(result.error).toBeUndefined();
    expect(result.state.chargeXMult).toBe(3);
    expect(result.state.stats.jumpingBeanFreePlays).toHaveLength(1);
    const evaluation = result.events.find(event => event.type === 'ABILITY_EVALUATED' && event.flame === 'lightningStrike');
    expect(evaluation?.flameDiagnostics).toMatchObject({ successfulPredictions: 1, predictionCount: 1 });
  });
});

describe('dynamic Weighted and Jumping Bean ranks', () => {
  it('derives the highest and lowest ranks from duplicate current face definitions and ignores legacy preferences', () => {
    const state = game();
    const die = equip(state, 0, [['weighted', 2], ['jumpingBean', 1]]);
    die.faces.forEach((face, index) => { face.rank = ([2, 2, 3, 3, 4, 4] as Rank[])[index]; });
    effectOf(die, 'weighted')!.persistent.weightedFace = 2;
    effectOf(die, 'jumpingBean')!.persistent.jumpingBeanNumber = 4;
    expect(highestAvailableRank(die)).toBe(4);
    expect(lowestAvailableRank(die)).toBe(2);
    new Resolver(state, constant(.99)).rollBatch([die.id], 'Weighted high Roll', 'gameplay');
    expect(activeFace(die).rank).toBe(4);
  });

  it('discards legacy armed Magic while retaining legacy fields for save compatibility', () => {
    const state = game();
    const die = equip(state, 0, [['magic', 1], ['weighted', 1], ['jumpingBean', 1]]);
    const runtime = state.dieRoundState[die.id];
    effectRuntime(runtime, effectOf(die, 'magic'))!.magicArmedFace = 6;
    const normalized = normalizeDieRoundRuntime(die, runtime);
    expect(effectRuntime(normalized, effectOf(die, 'magic'))?.magicArmedFace).toBeNull();
    expect(effectOf(die, 'weighted')?.persistent).toHaveProperty('weightedFace');
    expect(effectOf(die, 'jumpingBean')?.persistent).toHaveProperty('jumpingBeanNumber');
  });
});
