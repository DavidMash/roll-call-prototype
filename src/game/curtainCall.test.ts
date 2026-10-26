import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { Resolver } from './effects';
import { newRun } from './engine';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { renderRunHistoryV2Event } from './runHistoryV2Renderer';
import {
  createDieEffect, effectOf, effectRuntime, normalizeDieRoundRuntime, resetDieRoundState, SPECIAL_DICE,
} from './specialDice';
import type { GameState, RandomSource, SpecialDieType } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });

function stateWithEffects(effects: Array<[SpecialDieType, number]>, face = 5): GameState {
  const state = newRun('curtain-call', constant(.9)).state;
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
  const die = state.diceInventory.instances[0];
  die.value = face as 1 | 2 | 3 | 4 | 5 | 6;
  die.effects = effects.map(([type, level]) => createDieEffect(die.id, type, level));
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  syncActiveDiceProjection(state);
  return state;
}

const curtainHands = (state: GameState) => state.historyV2.filter(event =>
  event.kind === 'hand_scored' && event.playSource === 'freePlay');

describe('Curtain Call Manual Reroll trigger', () => {
  it('Free Plays the current Upper Hand before the requested Manual Reroll changes the face', () => {
    const state = stateWithEffects([['freePlay', 2]], 5);
    const resolver = new Resolver(state, constant(0));
    resolver.manualReroll([0]);

    const hand = curtainHands(state)[0];
    expect(hand).toMatchObject({ kind: 'hand_scored', hand: 'fives', playSource: 'freePlay' });
    expect(hand?.kind === 'hand_scored' ? hand.scoringDice[0].face : null).toBe(5);
    expect(activeFace(state.diceInventory.instances[0]).rank).not.toBe(5);
    const handIndex = state.historyV2.findIndex(event => event === hand);
    const manualRollIndex = state.historyV2.findIndex(event => event.kind === 'roll_batch' && event.reason === 'manual');
    expect(handIndex).toBeGreaterThanOrEqual(0);
    expect(manualRollIndex).toBeGreaterThan(handIndex);
  });

  it('does not trigger from initial, post-Play, Jumping Bean, boss/effect Rolls, or face mutation', () => {
    const initial = stateWithEffects([['freePlay', 2]], 5);
    new Resolver(initial, constant(0)).rollBatch([0], 'Initial Roll', 'gameplay', false, 'initial_round');
    expect(curtainHands(initial)).toHaveLength(0);

    const postPlay = stateWithEffects([['freePlay', 2]], 5);
    new Resolver(postPlay, constant(0)).play('fives', [0]);
    expect(postPlay.historyV2.filter(event => event.kind === 'hand_scored')).toHaveLength(1);
    expect(curtainHands(postPlay)).toHaveLength(0);

    const forced = stateWithEffects([['freePlay', 2]], 5);
    new Resolver(forced, constant(0)).rollBatch([0], 'Boss-forced Roll', 'gameplay', false, 'other');
    expect(curtainHands(forced)).toHaveLength(0);

    const bean = stateWithEffects([['freePlay', 2], ['jumpingBean', 1]], 1);
    const beanDie = bean.diceInventory.instances[0];
    beanDie.faces.forEach(face => { face.rank = 1; });
    const beanResolver = new Resolver(bean, constant(0));
    beanResolver.rollBatch([0], 'Initial Jumping Bean Roll', 'gameplay', false, 'initial_round');
    beanResolver.drain();
    expect(bean.stats.jumpingBeanFreePlays).toHaveLength(3);
    expect(curtainHands(bean)).toHaveLength(0);

    const mutated = stateWithEffects([['freePlay', 2], ['chameleon', 1]], 5);
    mutated.diceInventory.instances[1].value = 3;
    mutated.diceInventory.instances[2].value = 3;
    syncActiveDiceProjection(mutated);
    new Resolver(mutated, constant(0)).invokeChameleon(0);
    expect(curtainHands(mutated)).toHaveLength(0);
  });

  it('uses canonical Manual Reroll classification when Magic controls the resulting face', () => {
    const state = stateWithEffects([['freePlay', 1], ['magic', 1]], 5);
    const die = state.diceInventory.instances[0];
    effectRuntime(state.dieRoundState[0], effectOf(die, 'magic'))!.magicArmedFace = 3;
    new Resolver(state, constant(.8)).manualReroll([0]);
    expect(curtainHands(state)).toHaveLength(1);
    expect(activeFace(die).rank).toBe(3);
  });
});

describe('Curtain Call Pips multiplier', () => {
  it('applies Basic only to raw face Pips, leaves Basic I unchanged, and creates one Score occurrence', () => {
    const basicI = stateWithEffects([['basic', 1]], 5);
    new Resolver(basicI, constant(0)).play('fives', [0]);
    const basicIHand = basicI.historyV2.find(event => event.kind === 'hand_scored');
    expect(basicIHand?.kind === 'hand_scored' ? basicIHand.score.finalPips : null).toBe(5);

    const combined = stateWithEffects([['basic', 2], ['bonus', 2]], 5);
    new Resolver(combined, constant(0)).play('fives', [0]);
    const combinedHand = combined.historyV2.find(event => event.kind === 'hand_scored');
    // (Raw face 5 × Basic II) + Bonus II 20.
    expect(combinedHand?.kind === 'hand_scored' ? combinedHand.score.finalPips : null).toBe(30);
    expect(combinedHand?.kind === 'hand_scored' ? combinedHand.scoreOccurrences : []).toHaveLength(1);
  });

  it('applies Basic before additive Pips and Curtain Call multiplies the full die contribution afterward', () => {
    const state = stateWithEffects([['basic', 2], ['bonus', 2], ['freePlay', 3]], 5);
    new Resolver(state, constant(0)).manualReroll([0]);
    const hand = curtainHands(state)[0];
    // ((Raw face 5 × Basic II) + Bonus II 20) × Curtain Call III.
    expect(hand?.kind === 'hand_scored' ? hand.score.finalPips : null).toBe(90);
    expect(hand?.kind === 'hand_scored' ? hand.scoreOccurrences : []).toHaveLength(1);
  });

  it.each([1, 2, 3, 7])('scales full die Pips linearly at Lv%s', level => {
    const state = stateWithEffects([['freePlay', level]], 5);
    new Resolver(state, constant(0)).manualReroll([0]);
    const hand = curtainHands(state)[0];
    expect(hand?.kind === 'hand_scored' ? hand.score.finalPips : null).toBe(5 * level);
    expect(hand?.kind === 'hand_scored' ? hand.scoreOccurrences : []).toHaveLength(1);
  });

  it('includes Bonus, Furnace, accrued Workout, and Tank Pips before multiplying, with one Score trigger', () => {
    const state = stateWithEffects([
      ['freePlay', 3], ['bonus', 2], ['furnace', 2], ['workout', 1], ['tank', 1], ['golden', 1], ['vintage', 1],
    ], 5);
    const die = state.diceInventory.instances[0];
    effectRuntime(state.dieRoundState[0], effectOf(die, 'furnace'))!.furnaceUnits = 2;
    effectRuntime(state.dieRoundState[0], effectOf(die, 'workout'))!.temporaryPips = 7;
    effectRuntime(state.dieRoundState[0], effectOf(die, 'tank'))!.temporaryPips = 11;

    new Resolver(state, constant(0)).manualReroll([0]);
    const hand = curtainHands(state)[0];
    // (Face 5 + Bonus 20 + Furnace 12 + Workout 7 + Tank 11) × 3.
    expect(hand?.kind === 'hand_scored' ? hand.score.finalPips : null).toBe(165);
    expect(hand?.kind === 'hand_scored' ? hand.scoreOccurrences : []).toHaveLength(1);
    expect(state.stats.scoreBySource.curtainCall).toBe(hand?.kind === 'hand_scored' ? hand.score.awarded : 0n);
    expect(state.stats.scoreBySource.jumpingBean).toBe(0n);
    expect(effectRuntime(state.dieRoundState[0], effectOf(die, 'furnace'))!.furnaceUnits).toBe(1);
    expect(effectRuntime(state.dieRoundState[0], effectOf(die, 'workout'))!.temporaryPips).toBe(9);
    // Curtain Call's one Score grows Tank 11→21; the requested Manual Reroll then
    // proceeds and Tank's normal interception adds another 10 (21→31).
    expect(effectRuntime(state.dieRoundState[0], effectOf(die, 'tank'))!.temporaryPips).toBe(31);
    expect(effectRuntime(state.dieRoundState[0], effectOf(die, 'golden'))!.goldenGoldEarned).toBe(1);
    expect(effectOf(die, 'vintage')!.persistent.vintageAppreciation).toBe(1);
  });

  it('records the Curtain Call Free Play and multiplier in bounded history', () => {
    const state = stateWithEffects([['freePlay', 3], ['bonus', 1]], 5);
    new Resolver(state, constant(0)).manualReroll([0]);
    const activation = state.historyV2.find(event => event.kind === 'special_die_activated' && event.dieType === 'freePlay');
    const hand = curtainHands(state)[0];
    expect(activation && renderRunHistoryV2Event(activation)).toContain('Curtain Call Lv3');
    expect(activation && renderRunHistoryV2Event(activation)).toContain('×3 die Pips');
    expect(hand && renderRunHistoryV2Event(hand)).toContain('Curtain Call Free Play before Manual Reroll');
  });
});

describe('Curtain Call compatibility', () => {
  it('retains the freePlay key, presents Curtain Call, and drops obsolete saved per-face counters', () => {
    const state = stateWithEffects([['freePlay', 2]]);
    const die = state.diceInventory.instances[0];
    const legacy = state.dieRoundState[0].effects['0:freePlay'] as unknown as Record<string, unknown>;
    legacy.freePlayUsesByFace = { 1: 2, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0 };
    const normalized = normalizeDieRoundRuntime(die, state.dieRoundState[0]);
    expect(effectOf(die, 'freePlay')?.type).toBe('freePlay');
    expect(SPECIAL_DICE.freePlay.name).toBe('Curtain Call');
    expect(normalized.effects['0:freePlay']).not.toHaveProperty('freePlayUsesByFace');
  });
});
