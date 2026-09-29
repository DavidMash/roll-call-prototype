import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { DecisionTimer } from './decisionTimer';
import { Resolver } from './effects';
import { dispatch, newRun } from './engine';
import {
  calculateMaxCharge, captureHandStart, fluxCapacitorChargeGain, handXMultContributions,
  sixPackStartingMultiplier, speedDemonMultiplier,
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
  });

  it('applies the current factor before Upper-hand reduction and floors at ×1', () => {
    const state = game([1, 2, 3, 4, 5]);
    flame(state, 0, 'sixPack', 100);
    state.sixPackXMult = 2;
    const resolver = new Resolver(state, constant(.8));
    resolver.play('ones', [0], 'jumpingBean');
    resolver.play('ones', [0], 'jumpingBean');
    expect(state.stats.handScores.map(score => score.xMult)).toEqual([2, 1]);
    expect(state.sixPackXMult).toBe(1);
  });

  it('reduces after a manual Upper hand but not after a Lower hand', () => {
    const upper = game([1, 2, 3, 4, 5]);
    flame(upper, 0, 'sixPack', 100);
    upper.sixPackXMult = 6;
    const played = dispatch(upper, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.8));
    expect(played.state.stats.handScores[0].xMult).toBe(6);
    expect(played.state.sixPackXMult).toBe(5);

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
    expect(state.sixPackXMult).toBe(2.5);

    state.phase = 'shop';
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    new Resolver(state, constant(.8)).startRound();
    expect(state.sixPackXMult).toBe(3.5);
  });
});

describe('Magnetic destination exhaustion and Flux Capacitor', () => {
  it('spends only a successful destination; that spent face can still be a source', () => {
    const state = game([1, 2, 3, 4, 6]);
    magnetic(state, 4, 6);
    magnetic(state, 0, 3);
    magnetic(state, 1, 4);
    const resolver = new Resolver(state, constant(0));
    resolver.rollBatch([0], 'first pull', 'gameplay');
    expect(state.dice[0].faces[2].magneticDestinationUsed).toBe(true);
    expect(activeFace(state.dice[4]).magneticDestinationUsed).toBeUndefined();

    resolver.rollBatch([1], 'spent destination acts as source', 'gameplay');
    expect(state.dice[1].value).toBe(4);
    expect(state.stats.magneticAttractions).toBe(2);
  });

  it('does not spend a naturally rolled Magnetic face and will pull to it later', () => {
    const state = game([1, 2, 3, 4, 5]);
    magnetic(state, 0, 3);
    const resolver = new Resolver(state, constant(.4));
    resolver.rollBatch([0], 'natural roll', 'gameplay');
    expect(state.dice[0].value).toBe(3);
    expect(state.dice[0].faces[2].magneticDestinationUsed).toBeUndefined();

    magnetic(state, 4, 5);
    resolver.rollBatch([0], 'later pull', 'gameplay');
    expect(state.dice[0].faces[2].magneticDestinationUsed).toBe(true);
  });

  it('allows multiple unique destinations and builds Flux Charge once per successful pull', () => {
    const state = game([1, 2, 3, 4, 6]);
    flame(state, 3, 'fluxCapacitor', 50);
    magnetic(state, 4, 6);
    magnetic(state, 0, 2);
    magnetic(state, 1, 3);
    const resolver = new Resolver(state, constant(0));
    resolver.rollBatch([0, 1], 'two pulls', 'gameplay');
    expect(fluxCapacitorChargeGain(50)).toBe(1);
    expect(fluxCapacitorChargeGain(0)).toBe(0);
    expect(fluxCapacitorChargeGain(100)).toBe(2);
    expect(state.stats.magneticAttractions).toBe(2);
    expect(state.chargeXMult).toBe(3);
    expect(state.stats.flameTriggers.fluxCapacitor).toBe(2);
    expect(calculateMaxCharge(state)).toBe(3);
    flame(state, 3, 'fluxCapacitor', 100);
    expect(calculateMaxCharge(state)).toBe(5);
  });

  it('prevents reuse of the same destination until the Round reset', () => {
    const state = game([1, 2, 3, 4, 6]);
    magnetic(state, 4, 6);
    magnetic(state, 0, 3);
    const resolver = new Resolver(state, constant(0));
    resolver.rollBatch([0], 'first pull', 'gameplay');
    resolver.rollBatch([0], 'second roll', 'gameplay');
    expect(state.stats.magneticAttractions).toBe(1);

    state.phase = 'shop';
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    new Resolver(state, constant(.8)).startRound();
    expect(state.dice.flatMap(die => die.faces).some(face => face.magneticDestinationUsed)).toBe(false);
    expect(state.chargeXMult).toBe(1);
  });
});
