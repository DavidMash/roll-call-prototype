import { describe, expect, it } from 'vitest';
import { activeFace, createCollectibleDie, rollWeights, weightedNumberProbability, weightedSelectedFaceWeight } from './dice';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { effectDetails } from './specialDiePresentation';
import { createDieEffect, effectOf, effectRuntime, initialEffectRoundRuntime, resetDieRoundState } from './specialDice';
import type { GameState, RandomSource } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });
const sequence = (...values: number[]): RandomSource => {
  let index = 0;
  return { next: () => values[Math.min(index++, values.length - 1)] };
};
function stateWithEffects(effects: Array<['weighted' | 'jumpingBean' | 'magic' | 'chameleon' | 'clockwork', number]>): GameState {
  const state = newRun('configurable-effects', constant(.9)).state;
  state.target = 1_000_000n;
  const die = state.diceInventory.instances[0];
  die.effects = effects.map(([type, level]) => createDieEffect(die.id, type, level));
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  syncActiveDiceProjection(state);
  return state;
}

describe('Weighted physical-face probability', () => {
  it('applies the exact diminishing formula to matching physical faces at and above level 5', () => {
    const die = createCollectibleDie(0, 'weighted', 1);
    for (const level of [1, 2, 3, 4, 5, 8]) {
      const expected = 1 + 4 * level / (level + 2);
      expect(weightedSelectedFaceWeight(level)).toBeCloseTo(expected, 12);
      const weights = rollWeights(die, undefined, { selectedNumber: 6, level });
      expect(weights.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
      expect(weights[5]).toBeCloseTo(expected, 12);
    }
    const chances = [1, 2, 3, 4, 5, 6, 7, 8].map(level => weightedNumberProbability(die, 6, level));
    expect(chances[0]).toBeCloseTo(2.333333333 / 7.333333333, 8);
    expect(chances.every((chance, index) => index === 0 || chance > chances[index - 1])).toBe(true);
    expect(chances.slice(1).every((chance, index) => chance - chances[index] < chances[index] - (chances[index - 1] ?? 0))).toBe(true);
    expect(chances.every(chance => chance < .5)).toBe(true);
  });

  it('uses current Chameleon-mutated faces, including zero and six matching faces', () => {
    const die = createCollectibleDie(0, 'weighted', 3);
    expect(weightedNumberProbability(die, 6, 3)).toBeCloseTo(3.4 / 8.4, 10);
    die.faces[0].rank = 6; die.faces[1].rank = 6;
    expect(weightedNumberProbability(die, 6, 3)).toBeCloseTo((3 * 3.4) / (3 * 3.4 + 3), 10);
    die.faces.forEach(face => { face.rank = 2; });
    expect(weightedNumberProbability(die, 6, 3)).toBe(0);
    die.faces.forEach(face => { face.rank = 6; });
    expect(weightedNumberProbability(die, 6, 3)).toBe(1);
  });

  it('changes future random Rolls without mutating faces and reports the same probability', () => {
    let state = stateWithEffects([['weighted', 2]]);
    const beforeFaces = structuredClone(state.diceInventory.instances[0].faces);
    state = dispatch(state, { type: 'SET_DIE_EFFECT_NUMBER', dieId: 0, effect: 'weighted', number: 2 }).state;
    const die = state.diceInventory.instances[0];
    expect(die.faces).toEqual(beforeFaces);
    new Resolver(state, constant(.3)).rollBatch([0], 'Weighted random test', 'gameplay');
    expect(activeFace(die).rank).toBe(2);
    const weighted = effectOf(die, 'weighted')!;
    expect(effectDetails(die, weighted, state.dieRoundState[0]).status).toContainEqual({
      label: 'Chance to Roll 2', value: `${(weightedNumberProbability(die, 2, 2) * 100).toFixed(1)}%`,
    });
  });

  it('does not override deterministic Clockwork resolution', () => {
    const state = stateWithEffects([['weighted', 5], ['clockwork', 1]]);
    const before = activeFace(state.diceInventory.instances[0]).rank;
    effectOf(state.diceInventory.instances[0], 'weighted')!.persistent.weightedFace = 6;
    new Resolver(state, constant(0)).manualReroll([0]);
    expect(activeFace(state.diceInventory.instances[0]).rank).toBe(before === 6 ? 1 : before + 1);
  });
});

describe('automatic Jumping Bean', () => {
  it.each([[1, 3], [2, 6], [3, 9]] as const)('starts and resets Lv%s with %s Uses per Round', (level, uses) => {
    const effect = createDieEffect(0, 'jumpingBean', level);
    const runtime = initialEffectRoundRuntime(effect);
    expect(runtime.invocationsRemaining).toBe(uses);
    runtime.invocationsRemaining = 0;
    expect(initialEffectRoundRuntime(effect).invocationsRemaining).toBe(uses);
  });

  it('defaults to 1 and changes independently from Weighted and Magic', () => {
    let state = stateWithEffects([['weighted', 1], ['jumpingBean', 2], ['magic', 1]]);
    const die = state.diceInventory.instances[0];
    expect(effectOf(die, 'jumpingBean')!.persistent.jumpingBeanNumber).toBe(1);
    state = dispatch(state, { type: 'SET_DIE_EFFECT_NUMBER', dieId: 0, effect: 'weighted', number: 6 }).state;
    state = dispatch(state, { type: 'SET_DIE_EFFECT_NUMBER', dieId: 0, effect: 'jumpingBean', number: 3 }).state;
    state = dispatch(state, { type: 'ARM_MAGIC', dieId: 0, face: 5 }).state;
    const updated = state.diceInventory.instances[0];
    expect(effectOf(updated, 'weighted')!.persistent.weightedFace).toBe(6);
    expect(effectOf(updated, 'jumpingBean')!.persistent.jumpingBeanNumber).toBe(3);
    expect(effectRuntime(state.dieRoundState[0], effectOf(updated, 'magic'))!.magicArmedFace).toBe(5);
  });

  it.each(['initial_round', 'post_hand', 'manual', 'other'] as const)(
    'triggers from a genuine %s Roll and performs Free Play then follow-up Roll', reason => {
      const state = stateWithEffects([['jumpingBean', 1]]);
      const before = state.historyV2.filter(event => event.kind === 'roll_batch').length;
      const resolver = new Resolver(state, constant(0));
      resolver.rollBatch([0], 'Jumping Bean canonical Roll', 'gameplay', false, reason);
      resolver.drain();
      expect(state.stats.jumpingBeanFreePlays).toHaveLength(3);
      expect(effectRuntime(state.dieRoundState[0], effectOf(state.diceInventory.instances[0], 'jumpingBean'))!.invocationsRemaining).toBe(0);
      expect(state.historyV2.filter(event => event.kind === 'roll_batch')).toHaveLength(before + 4);
    });

  it('consumes exactly one of six Lv2 Uses for one activation and reports the remaining count', () => {
    const state = stateWithEffects([['jumpingBean', 2]]);
    const die = state.diceInventory.instances[0];
    die.value = 6;
    const resolver = new Resolver(state, sequence(0, .6));
    resolver.rollBatch([0], 'Single Jumping Bean activation', 'gameplay', false, 'other');
    resolver.drain();
    const effect = effectOf(die, 'jumpingBean')!;
    expect(state.stats.jumpingBeanFreePlays).toHaveLength(1);
    expect(effectRuntime(state.dieRoundState[0], effect)?.invocationsRemaining).toBe(5);
    expect(effectDetails(die, effect, state.dieRoundState[0]).status).toContainEqual({ label: 'Uses Remaining', value: '5' });
    const activation = state.historyV2.find(event => event.kind === 'special_die_activated' && event.dieType === 'jumpingBean');
    expect(activation).toMatchObject({ kind: 'special_die_activated', invocationBefore: 6, invocationAfter: 5 });
  });

  it('does not trigger on Chameleon mutation, then triggers when a later Roll lands on that physical face', () => {
    let state = stateWithEffects([['jumpingBean', 1], ['chameleon', 1]]);
    const die = state.diceInventory.instances[0];
    effectOf(die, 'jumpingBean')!.persistent.jumpingBeanNumber = 3;
    state.diceInventory.instances[1].value = 3;
    state.diceInventory.instances[2].value = 3;
    syncActiveDiceProjection(state);
    state = dispatch(state, { type: 'INVOKE_CHAMELEON', dieId: 0 }, constant()).state;
    const bean = effectOf(state.diceInventory.instances[0], 'jumpingBean')!;
    expect(effectRuntime(state.dieRoundState[0], bean)!.invocationsRemaining).toBe(3);
    const resolver = new Resolver(state, constant(.99));
    resolver.rollBatch([0], 'Roll mutated face', 'gameplay');
    resolver.drain();
    expect(state.stats.jumpingBeanFreePlays).toHaveLength(3);
  });

  it('chains by numeric final result while Uses remain and stops without recursion', () => {
    const state = stateWithEffects([['jumpingBean', 1]]);
    const die = state.diceInventory.instances[0];
    die.faces.forEach(face => { face.rank = 1; });
    const before = state.historyV2.filter(event => event.kind === 'roll_batch').length;
    const resolver = new Resolver(state, constant(.5));
    resolver.rollBatch([0], 'Jumping Bean chain', 'gameplay');
    resolver.drain();
    expect(state.stats.jumpingBeanFreePlays).toHaveLength(3);
    expect(effectRuntime(state.dieRoundState[0], effectOf(die, 'jumpingBean'))!.invocationsRemaining).toBe(0);
    expect(state.historyV2.filter(event => event.kind === 'roll_batch')).toHaveLength(before + 4);
  });
});
