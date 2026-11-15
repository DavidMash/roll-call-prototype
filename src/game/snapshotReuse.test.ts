import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { placeFlameInstance } from './flames';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { cloneGameState } from './ledger';
import { stringifyExactJson } from './scoreMath';
import { createDieEffect, effectOf, resetDieRoundState } from './specialDice';
import type { Action, GameState, RandomSource, Rank, SpecialDieType } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });

function base(seed: string, values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const state = newRun(seed, constant(.73)).state;
  state.target = 10n ** 30n;
  state.stats.rounds.at(-1)!.target = state.target;
  rosterDice(state).forEach((die, index) => { die.value = values[index] ?? values.at(-1)!; });
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  return state;
}

function setEffects(state: GameState, dieIndex: number, effects: Array<[SpecialDieType, number]>) {
  const die = rosterDice(state)[dieIndex];
  die.effects = effects.map(([type, level]) => createDieEffect(die.id, type, level));
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
}

function complexPlay(seed: string): { state: GameState; action: Action } {
  const state = base(seed);
  for (let index = 0; index < 5; index++) setEffects(state, index,
    [['bonus', 5], ['golden', 3], ['workout', 3], ['doubleTime', 1]]);
  state.handLevels.largeStraight = 12;
  (['ultimate', 'momentum', 'heavyHitters', 'frankenstein', 'fatCat'] as const)
    .forEach((flame, slot) => placeFlameInstance(state, flame, 100, slot as 0 | 1 | 2 | 3 | 4));
  return { state, action: { type: 'PLAY', hand: 'largeStraight', dieIds: rosterDice(state).map(die => die.id) } };
}

function curtainCall(): { state: GameState; action: Action } {
  const state = base('snapshot-curtain', [5, 2, 3, 4, 6]);
  setEffects(state, 0, [['freePlay', 5], ['bonus', 5], ['golden', 3], ['workout', 3]]);
  (['freeRealEstate', 'heavyHitters', 'frankenstein', 'fatCat', 'momentum'] as const)
    .forEach((flame, slot) => placeFlameInstance(state, flame, 100, slot as 0 | 1 | 2 | 3 | 4));
  return { state, action: { type: 'MANUAL_REROLL', dieIds: [rosterDice(state)[0].id] } };
}

function jumpingBean(): { state: GameState; action: Action } {
  const state = base('snapshot-bean', [6, 6, 6, 6, 6]);
  for (let index = 0; index < 2; index++) {
    setEffects(state, index, [['jumpingBean', 3], ['bonus', 5], ['golden', 3], ['workout', 3]]);
    const die = rosterDice(state)[index];
    die.faces.forEach(face => { face.rank = 1; });
    effectOf(die, 'jumpingBean')!.persistent.jumpingBeanNumber = 1;
  }
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  (['freeRealEstate', 'lowball', 'heavyHitters', 'frankenstein', 'fatCat'] as const)
    .forEach((flame, slot) => placeFlameInstance(state, flame, 100, slot as 0 | 1 | 2 | 3 | 4));
  return { state, action: { type: 'MANUAL_REROLL', dieIds: rosterDice(state).slice(0, 2).map(die => die.id) } };
}

function bossPlay(): { state: GameState; action: Action } {
  const state = base('snapshot-boss');
  state.boss = { type: 'juggler' };
  setEffects(state, 0, [['bonus', 5], ['golden', 3], ['workout', 3]]);
  (['momentum', 'heavyHitters', 'frankenstein'] as const)
    .forEach((flame, slot) => placeFlameInstance(state, flame, 100, slot as 0 | 1 | 2));
  return { state, action: { type: 'PLAY', hand: 'ones', dieIds: [rosterDice(state)[0].id] } };
}

describe('playback Board snapshot reuse', () => {
  it.each([
    ['multi-Flame special-die Play', () => complexPlay('snapshot-complex')],
    ['Curtain Call Free Play', curtainCall],
    ['Jumping Bean automatic chain', jumpingBean],
    ['Juggler boss Play', bossPlay],
  ])('matches fresh snapshots for %s', (_name, fixture) => {
    const { state, action } = fixture();
    const legacy = dispatch(state, action, constant(0), { disableSnapshotReuse: true });
    const optimized = dispatch(state, action, constant(0), { verifySnapshotReuse: true });

    expect(legacy.error).toBeUndefined();
    expect(optimized.error).toBeUndefined();
    expect(legacy.state.phase).not.toBe('error');
    expect(optimized.state.phase).not.toBe('error');
    expect(optimized.events).toEqual(legacy.events);
    expect(optimized.state).toEqual(legacy.state);
    expect(optimized.state.rngState).toBe(legacy.state.rngState);
    expect(optimized.ledgerChunk).toEqual(legacy.ledgerChunk);
    expect(new Set(legacy.events.map(event => event.board)).size).toBe(legacy.events.length);
    expect(new Set(optimized.events.map(event => event.board)).size).toBeLessThan(optimized.events.length);
    expect(new Set(structuredClone(optimized.events).map(event => event.board)).size)
      .toBe(new Set(optimized.events.map(event => event.board)).size);

    const emittedBoards = stringifyExactJson(optimized.events.map(event => event.board));
    optimized.state.gold += 99;
    rosterDice(optimized.state)[0].value = 6;
    expect(stringifyExactJson(optimized.events.map(event => event.board))).toBe(emittedBoards);
  });

  it('keeps round-start playback equivalent to fresh snapshots', () => {
    const initial = base('snapshot-round-transition');
    const legacyState = cloneGameState(initial);
    const optimizedState = cloneGameState(initial);
    const legacy = new Resolver(legacyState, constant(.4), { disableSnapshotReuse: true });
    const optimized = new Resolver(optimizedState, constant(.4), { verifySnapshotReuse: true });
    legacy.startRound(true);
    optimized.startRound(true);
    expect(optimized.events).toEqual(legacy.events);
    expect(optimizedState).toEqual(legacyState);
    expect(optimized.rngStateAfterResolution).toBe(legacy.rngStateAfterResolution);
  });
});
