import { describe, expect, it } from 'vitest';
import { dispatch, newRun, validateAction } from './engine';
import { Resolver } from './effects';
import {
  calculateMaxCharge, jumpStartChargeGain, maxChargeContribution, momentumChargeGain,
  recalculateMaxCharge, thirdRailChargeGain,
} from './flames';
import { ultimateHands } from './hands';
import type { Flame, GameState, RandomSource, Rank } from './types';

const constant = (value = .99): RandomSource => ({ next: () => value });
const sequence = (...values: number[]): RandomSource => {
  let index = 0;
  return { next: () => values[Math.min(index++, values.length - 1)] };
};
function game(values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const state = newRun('charge-family', constant()).state;
  state.dice.forEach((die, index) => { die.value = values[index]; });
  state.target = 1_000_000;
  state.stats.rounds[0].target = state.target;
  return state;
}
function flame(state: GameState, dieId: number, id: Flame, investedGold: number): void {
  state.dice[dieId].flame = { id, investedGold };
}

describe('Charge-family generation', () => {
  it('scales Momentum per manually played hand, independent of scoring-die count', () => {
    const state = game([4, 4, 4, 4, 6]);
    flame(state, 4, 'momentum', 50);
    const result = dispatch(state, { type: 'PLAY', hand: 'fourKind', dieIds: [0, 1, 2, 3] }, constant());
    expect(momentumChargeGain(50)).toBe(.25);
    expect(result.state.chargeXMult).toBe(1.25);
    expect(result.state.stats.flameTriggers.momentum).toBe(1);
  });

  it('counts a Jumping Bean free play for Momentum', () => {
    const state = game([6, 2, 4, 5, 6]);
    flame(state, 1, 'momentum', 100);
    state.dice[0].faces[2].enhancements.jumpingBean = 1;
    const resolver = new Resolver(state, sequence(.4, .99));
    resolver.rollBatch([0], 'Bean setup', 'gameplay');
    resolver.drain();
    expect(state.stats.jumpingBeanFreePlays).toHaveLength(1);
    expect(state.chargeXMult).toBe(1.5);
  });

  it('counts every gameplay die that rolls a 3, including initial rolls', () => {
    const state = game([1, 1, 1, 1, 1]);
    flame(state, 0, 'thirdRail', 100);
    const resolver = new Resolver(state, constant(.4));
    resolver.rollBatch([0, 1], 'Gameplay test', 'gameplay');
    expect(thirdRailChargeGain(100)).toBe(.5);
    expect(state.chargeXMult).toBe(2);

    state.phase = 'shop';
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    const nextRound = dispatch(state, { type: 'NEXT_ROUND' }, constant(.4)).state;
    expect(nextRound.dice.every(die => die.value === 3)).toBe(true);
    expect(nextRound.chargeXMult).toBe(3.5);
  });

  it('excludes Shop and Flame Selection rolls from Third Rail', () => {
    const state = game([1, 1, 1, 1, 1]);
    flame(state, 0, 'thirdRail', 100);
    const resolver = new Resolver(state, constant(.4));
    resolver.rollBatch([0, 1], 'Shop test', 'shop');
    resolver.rollBatch([2, 3], 'Selection test', 'flameSelection');
    expect(state.dice.slice(0, 4).every(die => die.value === 3)).toBe(true);
    expect(state.chargeXMult).toBe(1);
    expect(state.stats.flameTriggers.thirdRail).toBeUndefined();
  });

  it('scales Jump Start and awards the actual number of Rerolls spent', () => {
    expect([0, 25, 50, 100].map(jumpStartChargeGain)).toEqual([0, .5, 1, 2]);
    const state = game([1, 2, 3, 4, 5]);
    flame(state, 4, 'jumpStart', 50);
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1] }, constant(.99));
    expect(result.state.manualRerollsRemaining).toBe(1);
    expect(result.state.stats.manualRerolls.at(-1)?.charges).toBe(2);
    expect(result.state.chargeXMult).toBe(3);
    expect(result.state.stats.flameTriggers.jumpStart).toBe(2);
  });
});

describe('Power Surge', () => {
  it('applies same-hand Momentum first, then triples current Charge', () => {
    const state = game([1, 2, 3, 4, 5]);
    flame(state, 0, 'momentum', 100);
    flame(state, 1, 'powerSurge', 100);
    state.handLevels.ones = 2;
    state.chargeXMult = 2;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant());
    expect(result.events.filter(event => event.type === 'CHARGE_CHANGED').map(event => event.flame))
      .toEqual(['momentum', 'powerSurge']);
    expect(result.state.chargeXMult).toBe(7.5);
  });

  it('uses Ultimate’s single authoritative highest-hand tie-break', () => {
    expect(ultimateHands(game().handLevels)).toEqual(['fiveKind']);
    const unqualified = game([1, 2, 3, 4, 5]);
    flame(unqualified, 0, 'powerSurge', 100);
    unqualified.chargeXMult = 1.5;
    const first = dispatch(unqualified, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant());
    expect(first.state.chargeXMult).toBe(1.5);

    const qualified = game([5, 5, 5, 5, 5]);
    flame(qualified, 0, 'powerSurge', 100);
    qualified.chargeXMult = 1.5;
    const second = dispatch(qualified, { type: 'PLAY', hand: 'fiveKind', dieIds: [0, 1, 2, 3, 4] }, constant());
    expect(second.state.chargeXMult).toBe(4.5);
  });

  it('qualifies a Jumping Bean free play against the same highest-hand selection', () => {
    const state = game([6, 2, 4, 5, 6]);
    flame(state, 1, 'powerSurge', 100);
    state.handLevels.threes = 2;
    state.chargeXMult = 2;
    state.dice[0].faces[2].enhancements.jumpingBean = 1;
    const resolver = new Resolver(state, sequence(.4, .99));
    resolver.rollBatch([0], 'Bean setup', 'gameplay');
    resolver.drain();
    expect(ultimateHands(state.handLevels)).toEqual(['threes']);
    expect(state.chargeXMult).toBe(5);
    expect(state.stats.flameTriggers.powerSurge).toBe(1);
  });
});

describe('Max Charge and shared spending', () => {
  it('scales each Flame contribution from ×1 to ×5 and stacks all owned family Flames', () => {
    expect([0, 25, 50, 100].map(maxChargeContribution)).toEqual([1, 2, 3, 5]);
    const state = game();
    flame(state, 0, 'momentum', 100);
    flame(state, 1, 'thirdRail', 0);
    expect(calculateMaxCharge(state)).toBe(6);
    flame(state, 1, 'thirdRail', 100);
    expect(calculateMaxCharge(state)).toBe(10);
  });

  it('acquires a Charge ember at ×1 capacity and clamps when capacity falls', () => {
    const state = game();
    state.phase = 'flameSelection';
    state.flameSelection = { offers: [{ id: 10, flame: 'momentum' }], acquired: false };
    let acquired = dispatch(state, { type: 'CHOOSE_FLAME', offerId: 10, dieId: 0 }).state;
    expect(acquired.maxCharge).toBe(1);
    flame(acquired, 1, 'thirdRail', 100);
    recalculateMaxCharge(acquired);
    acquired.chargeXMult = 6;
    acquired.dice[1].flame = null;
    recalculateMaxCharge(acquired);
    expect(acquired.maxCharge).toBe(1);
    expect(acquired.chargeXMult).toBe(1);
  });

  it('requires every local family die, disarms when selection clears, and revalidates on commit', () => {
    let state = game([4, 4, 5, 2, 6]);
    flame(state, 0, 'momentum', 100);
    flame(state, 1, 'jumpStart', 100);
    state.chargeXMult = 2;
    expect(validateAction(state, { type: 'TOGGLE_CHARGE', hand: 'fours', dieIds: [0] }))
      .toContain('every Charge Flame die');
    expect(validateAction(state, { type: 'TOGGLE_CHARGE', hand: 'pair', dieIds: [0, 1] })).toBeNull();
    state = dispatch(state, { type: 'TOGGLE_CHARGE', hand: 'pair', dieIds: [0, 1] }).state;
    expect(validateAction(state, { type: 'PLAY', hand: 'fours', dieIds: [0] })).toContain('must participate');
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant()).state;
    expect(state.chargeArmed).toBe(false);
  });

  it('lets any Charge-family Bonfire globally unlock spending even with another local family die', () => {
    let state = game([4, 4, 5, 2, 6]);
    flame(state, 0, 'momentum', 100);
    state.bonfires = ['thirdRail'];
    state.chargeXMult = 2;
    expect(validateAction(state, { type: 'TOGGLE_CHARGE', hand: 'fives', dieIds: [2] })).toBeNull();
    state = dispatch(state, { type: 'TOGGLE_CHARGE', hand: 'fives', dieIds: [2] }).state;
    expect(validateAction(state, { type: 'PLAY', hand: 'fives', dieIds: [2] })).toBeNull();
  });

  it('applies armed Charge to the committed hand and resets the shared meter', () => {
    let state = game([1, 2, 4, 5, 6]);
    state.bonfires = ['thirdRail'];
    state.chargeXMult = 3;
    state = dispatch(state, { type: 'TOGGLE_CHARGE', hand: 'ones', dieIds: [0] }).state;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.99));
    expect(result.state.stats.handScores[0].xMultFactors).toContainEqual(expect.objectContaining({ source: 'charge', value: 3 }));
    expect(result.state.chargeXMult).toBe(1);
    expect(result.state.chargeArmed).toBe(false);
  });
});
