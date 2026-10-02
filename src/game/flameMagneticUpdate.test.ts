import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { DecisionTimer } from './decisionTimer';
import { Resolver } from './effects';
import { dispatch, newRun } from './engine';
import {
  calculateMaxCharge, captureHandStart, fluxCapacitorChargeMultiplier, handXMultContributions,
  sixPackMultiplierAfterUpperHands, sixPackStartingMultiplier, speedDemonMultiplier,
} from './flames';
import type { Flame, GameState, RandomSource, Rank } from './types';

const constant = (value = .99): RandomSource => ({ next: () => value });

function game(values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const state = newRun('flame-magnetic-update', constant(.8)).state;
  values.forEach((value, index) => { state.dice[index].value = value; });
  state.target = 1_000_000;
  state.stats.rounds[0].target = state.target;
  return state;
}

function flame(state: GameState, dieId: number, id: Flame, investedGold: number): void {
  state.dice[dieId].flame = { id, investedGold };
}

function magnetic(state: GameState, dieId: number, physicalFace: Rank): void {
  state.dice[dieId].faces[physicalFace - 1].enhancements.magnetic = 1;
}

describe('Speed Demon', () => {
  it('has a one-second grace period, smooth decay, and linear investment scaling', () => {
    expect(speedDemonMultiplier(100, 0)).toBe(9);
    expect(speedDemonMultiplier(100, 1000)).toBe(9);
    expect(speedDemonMultiplier(100, 5500)).toBe(5);
    expect(speedDemonMultiplier(100, 10000)).toBe(1);
    expect(speedDemonMultiplier(50, 0)).toBe(5);
    expect(speedDemonMultiplier(0, 0)).toBe(1);
  });

  it('counts only unblocked time and freezes the exact Play-time snapshot', () => {
    const timer = new DecisionTimer();
    timer.reset(100);
    expect(timer.elapsed(600)).toBe(500);
    timer.setBlocked(true, 700);
    expect(timer.elapsed(5000)).toBe(600);
    timer.setBlocked(false, 5000);
    expect(timer.freeze(5400)).toBe(1000);
    expect(timer.elapsed(9000)).toBe(1000);
  });

  it('stays out of preview, then reveals and applies the frozen post-click factor', () => {
    const state = game([1, 2, 3, 4, 5]);
    flame(state, 0, 'speedDemon', 100);
    const preview = captureHandStart(state, 'ones', [0]);
    expect(handXMultContributions(preview, 'ones', 1, [0])).toEqual([]);

    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0], decisionMs: 5500 }, constant(.8));
    expect(result.state.stats.handScores[0].xMultFactors).toContainEqual(expect.objectContaining({ source: 'speedDemon', value: 5 }));
    const revealIndex = result.events.findIndex(event => event.type === 'SPEED_DEMON_REVEALED');
    const updateIndex = result.events.findIndex(event => event.type === 'HAND_XMULT_CHANGED' && event.flame === 'speedDemon');
    expect(result.events[revealIndex]).toMatchObject({ decisionMs: 5500, xMult: 5 });
    expect(revealIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(revealIndex);
  });
});

describe('Six Pack', () => {
  it('scales its Round-start factor from ×1 to ×6', () => {
    expect(sixPackStartingMultiplier(0)).toBe(1);
    expect(sixPackStartingMultiplier(50)).toBe(3.5);
    expect(sixPackStartingMultiplier(100)).toBe(6);
    expect(sixPackMultiplierAfterUpperHands(6, 1)).toBeCloseTo(5.166666666667);
    expect(sixPackMultiplierAfterUpperHands(1.4, 1)).toBeCloseTo(1.333333333333);
    expect(sixPackMultiplierAfterUpperHands(6, 6)).toBe(1);
  });

  it('applies the current factor before six equal Upper-hand reductions and floors at ×1', () => {
    const state = game([1, 2, 3, 4, 5]);
    flame(state, 0, 'sixPack', 100);
    state.sixPackXMult = 6;
    const resolver = new Resolver(state, constant(.8));
    for (let count = 0; count < 7; count++) resolver.play('ones', [0], 'jumpingBean');
    expect(state.stats.handScores.map(score => score.xMult)).toEqual([
      6, 5.166666666667, 4.333333333333, 3.5, 2.666666666667, 1.833333333333, 1,
    ]);
    expect(state.sixPackXMult).toBe(1);
    expect(state.sixPackUpperHandsPlayed).toBe(6);
  });

  it('reduces after a manual Upper hand but not after a Lower hand', () => {
    const upper = game([1, 2, 3, 4, 5]);
    flame(upper, 0, 'sixPack', 100);
    upper.sixPackXMult = 6;
    const played = dispatch(upper, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.8));
    expect(played.state.stats.handScores[0].xMult).toBe(6);
    expect(played.state.sixPackXMult).toBeCloseTo(5.166666666667);

    const lower = game([2, 2, 3, 4, 5]);
    flame(lower, 0, 'sixPack', 100);
    lower.sixPackXMult = 6;
    expect(dispatch(lower, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(.8)).state.sixPackXMult).toBe(6);
  });

  it('counts Jumping Bean Upper free plays and resets to invested strength each Round', () => {
    const state = game([1, 2, 3, 4, 5]);
    flame(state, 0, 'sixPack', 50);
    state.sixPackXMult = 3.5;
    new Resolver(state, constant(.8)).play('ones', [0], 'jumpingBean');
    expect(state.sixPackXMult).toBeCloseTo(3.083333333333);

    state.phase = 'shop';
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    new Resolver(state, constant(.8)).startRound();
    expect(state.sixPackXMult).toBe(3.5);
    expect(state.sixPackUpperHandsPlayed).toBe(0);
  });
});

describe('Magnetic source use and Flux Capacitor', () => {
  it('spends a held source after one successful pull while destinations remain reusable', () => {
    const state = game([1, 2, 3, 4, 6]);
    magnetic(state, 4, 6);
    magnetic(state, 0, 3);
    const resolver = new Resolver(state, constant(0));
    resolver.rollBatch([0], 'first pull', 'gameplay');
    expect(state.dice[0].value).toBe(3);
    expect(activeFace(state.dice[4]).magneticSourceUsed).toBe(true);
    expect(state.dice[0].faces[2].magneticSourceUsed).toBeUndefined();

    magnetic(state, 3, 4);
    resolver.rollBatch([0], 'same destination pulled by another source', 'gameplay');
    expect(state.dice[0].value).toBe(3);
    expect(state.stats.magneticAttractions).toBe(2);
    expect(activeFace(state.dice[3]).magneticSourceUsed).toBe(true);
  });

  it('lets a pulled Magnetic face remain unused, then act as its own held source', () => {
    const state = game([1, 2, 3, 4, 6]);
    magnetic(state, 4, 6);
    magnetic(state, 0, 3);
    magnetic(state, 1, 4);
    const resolver = new Resolver(state, constant(0));
    resolver.rollBatch([0], 'pull a future source', 'gameplay');
    expect(state.dice[0].value).toBe(3);
    expect(activeFace(state.dice[0]).magneticSourceUsed).toBeUndefined();

    resolver.rollBatch([1], 'pulled face uses its own source pull', 'gameplay');
    expect(state.dice[1].value).toBe(4);
    expect(activeFace(state.dice[0]).magneticSourceUsed).toBe(true);
    expect(state.stats.magneticAttractions).toBe(2);
  });

  it('counts all pulled Magnetic faces once per activation for investment-scaled Flux', () => {
    const state = game([1, 2, 3, 4, 6]);
    flame(state, 3, 'fluxCapacitor', 50);
    magnetic(state, 4, 6);
    magnetic(state, 0, 2);
    magnetic(state, 1, 3);
    const resolver = new Resolver(state, constant(0));
    resolver.rollBatch([0, 1], 'two pulls', 'gameplay');
    expect(fluxCapacitorChargeMultiplier(50, 2)).toBe(2);
    expect(fluxCapacitorChargeMultiplier(100, 1)).toBe(2);
    expect(fluxCapacitorChargeMultiplier(100, 2)).toBe(3);
    expect(fluxCapacitorChargeMultiplier(100, 3)).toBe(4);
    expect(state.stats.magneticAttractions).toBe(2);
    expect(state.chargeXMult).toBe(2);
    expect(state.stats.flameTriggers.fluxCapacitor).toBe(1);
    expect(calculateMaxCharge(state)).toBe(3);
    flame(state, 3, 'fluxCapacitor', 100);
    expect(calculateMaxCharge(state)).toBe(5);
  });

  it('clamps one Flux multiplication to Max Charge and resets source use next Round', () => {
    const state = game([1, 2, 3, 4, 6]);
    flame(state, 3, 'fluxCapacitor', 100);
    state.chargeXMult = 4;
    magnetic(state, 4, 6);
    magnetic(state, 0, 3);
    magnetic(state, 1, 4);
    const resolver = new Resolver(state, constant(0));
    resolver.rollBatch([0, 1], 'clamped pull', 'gameplay');
    expect(state.chargeXMult).toBe(5);
    expect(state.stats.flameTriggers.fluxCapacitor).toBe(1);
    expect(activeFace(state.dice[4]).magneticSourceUsed).toBe(true);

    state.phase = 'shop';
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    new Resolver(state, constant(.8)).startRound();
    expect(state.dice.flatMap(die => die.faces).some(face => face.magneticSourceUsed)).toBe(false);
    expect(state.chargeXMult).toBe(1);
  });
});
