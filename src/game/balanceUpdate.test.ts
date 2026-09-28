import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { Resolver } from './effects';
import { dispatch, newRun, validateAction } from './engine';
import { captureHandStart, handXMultContributions, trainerChance } from './flames';
import { HAND_IDS } from './hands';
import type { GameState, HandId, RandomSource, Rank } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });

function game(values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const state = newRun('balance-update', constant(.8)).state;
  values.forEach((value, index) => { state.dice[index].value = value; });
  state.target = 1_000_000;
  state.stats.rounds[0].target = state.target;
  return state;
}

function consumeExcept(state: GameState, hand: HandId): void {
  state.consumed = HAND_IDS.filter(id => id !== hand);
}

describe('focused balance update', () => {
  it('scales Personal Trainer linearly at 0, 50, and 100 Gold', () => {
    expect([0, 50, 100].map(trainerChance)).toEqual([0, .375, .75]);
  });

  it('clears The Warden immediately with locked dice and a pending reinforcement', () => {
    const state = game([1, 2, 3, 4, 5]);
    state.target = 1;
    state.stats.rounds[0].target = 1;
    state.boss = {
      type: 'warden', activeDieIds: [0], startingDieId: 0, nextUnlockTarget: 1,
      unlockTargets: [1], pendingReinforcements: 0,
    };
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.8));
    expect(result.state.phase).toBe('roundSummary');
    expect(result.state.boss).toMatchObject({ type: 'warden', activeDieIds: [0], pendingReinforcements: 1 });
    expect(result.events.some(event => event.type === 'BOSS_CLEARED' && event.boss === 'warden')).toBe(true);
  });

  it('exhausts every participating Magnetic face for the round and resets them next round', () => {
    const state = game([1, 2, 3, 4, 6]);
    activeFace(state.dice[4]).enhancements.magnetic = 1;
    state.dice[0].faces[2].enhancements.magnetic = 1;
    state.dice[1].faces[3].enhancements.magnetic = 1;
    const resolver = new Resolver(state, constant(0));
    resolver.rollBatch([0], 'first attraction', 'gameplay');
    expect(state.stats.magneticAttractions).toBe(1);
    expect(activeFace(state.dice[4]).magneticUsed).toBe(true);
    expect(state.dice[0].faces[2].magneticUsed).toBe(true);
    resolver.rollBatch([1], 'second roll', 'gameplay');
    expect(state.stats.magneticAttractions).toBe(1);

    state.phase = 'shop';
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    state.round++;
    new Resolver(state, constant(.8)).startRound();
    expect(state.dice.flatMap(die => die.faces).some(face => face.magneticUsed)).toBe(false);
  });

  it('keeps Caller deadlines fixed at manual hands 3, 6, and 9 after early answers', () => {
    let state = game([1, 2, 3, 4, 5]);
    state.boss = {
      type: 'caller', calledHand: 'ones', playsRemaining: 3, satisfied: false, satisfyingSource: null,
      callsCompleted: 0, callsMissed: 0, manualHandsPlayed: 0, callDeadline: 3,
    };
    state = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.2)).state;
    expect(state.boss).toMatchObject({ type: 'caller', manualHandsPlayed: 1, callDeadline: 6, playsRemaining: 5 });
    if (state.boss?.type !== 'caller') throw new Error('Caller fixture failed');
    state.boss.calledHand = 'twos';
    state = dispatch(state, { type: 'PLAY', hand: 'twos', dieIds: [1] }, constant(.2)).state;
    expect(state.boss).toMatchObject({ type: 'caller', manualHandsPlayed: 2, callDeadline: 9, playsRemaining: 7 });
  });

  it('applies Full of Grace only on authoritative LAST PLAY, requires participation, and stacks with Hail Mary', () => {
    const state = game([1, 2, 3, 4, 5]);
    state.manualRerollsRemaining = 0;
    consumeExcept(state, 'ones');
    state.dice[0].flame = { id: 'fullOfGrace', investedGold: 50 };
    state.bonfires = ['hailMary'];
    expect(handXMultContributions(captureHandStart(state, 'ones'), 'ones', 1, [0]))
      .toMatchObject([{ source: 'hailMary', value: 5 }, { source: 'fullOfGrace', value: 3, dieId: 0 }]);
    expect(handXMultContributions(captureHandStart(state, 'ones'), 'ones', 1, [1]))
      .toMatchObject([{ source: 'hailMary', value: 5 }]);

    state.bonfires = ['hailMary', 'fullOfGrace'];
    state.dice[0].flame = null;
    expect(handXMultContributions(captureHandStart(state, 'ones'), 'ones', 1, [1]).map(factor => factor.source))
      .toEqual(['hailMary', 'fullOfGrace']);
    state.manualRerollsRemaining = 1;
    expect(handXMultContributions(captureHandStart(state, 'ones'), 'ones', 1, [1])).toEqual([]);
  });

  it('builds Charge from selected scorers and successful Hitchhikers, never from rolls, and caps at ×5', () => {
    let state = game([4, 4, 4, 2, 6]);
    state.dice[4].flame = { id: 'charge', investedGold: 100 };
    activeFace(state.dice[3]).enhancements.hitchhiker = 1;
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [4] }, constant(.8)).state;
    expect(state.chargeXMult).toBe(1);
    state.dice[4].value = 6;
    const scored = dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant(0));
    expect(scored.state.stats.handScores[0].dieIds).toEqual([0, 1, 2, 3]);
    expect(scored.state.chargeXMult).toBe(3);
    scored.state.chargeXMult = 4.8;
    scored.state.consumed = [];
    scored.state.dice[0].value = 1;
    const capped = dispatch(scored.state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.8));
    expect(capped.state.chargeXMult).toBe(5);
    expect(capped.state.stats.chargeGained).toBe(2.2);
  });

  it('requires the physical Charge die to arm and commit before Bonfire, then removes that restriction', () => {
    let state = game([4, 4, 5, 2, 6]);
    state.dice[0].flame = { id: 'charge', investedGold: 100 };
    state.chargeXMult = 2;
    expect(validateAction(state, { type: 'TOGGLE_CHARGE', hand: 'fives', dieIds: [2] })).toContain('physical Charge die');
    expect(validateAction(state, { type: 'TOGGLE_CHARGE', hand: 'pair', dieIds: [0, 1] })).toBeNull();
    state = dispatch(state, { type: 'TOGGLE_CHARGE', hand: 'pair', dieIds: [0, 1] }).state;
    expect(validateAction(state, { type: 'PLAY', hand: 'fives', dieIds: [2] })).toContain('must participate');
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(.8)).state;
    expect(state.chargeArmed).toBe(false);

    state.dice[0].flame = null;
    state.bonfires = ['charge'];
    expect(validateAction(state, { type: 'TOGGLE_CHARGE', hand: 'fives', dieIds: [2] })).toBeNull();
    state = dispatch(state, { type: 'TOGGLE_CHARGE', hand: 'fives', dieIds: [2] }).state;
    expect(validateAction(state, { type: 'PLAY', hand: 'fives', dieIds: [2] })).toBeNull();
  });
});
