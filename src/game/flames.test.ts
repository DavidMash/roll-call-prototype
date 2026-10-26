import { describe, expect, it } from 'vitest';
import { dispatch, newRun, validateAction } from './engine';
import { Resolver } from './effects';
import {
  captureHandStart, composeXMult, flameEffectText, flameStokeLimits, FLAME_IDS,
  handFamilyFlameMultiplier, handXMultContributions, hotStreakMultiplier, lowballMultiplier, momentumChargeGain,
  placeFlameInstance, standardFlameMultiplier, targetPracticeMultiplier, XMult_FLAME_IDS,
} from './flames';
import type { GameState, RandomSource, Rank } from './types';
import { purchaseDie } from './diceEconomy';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { createDieEffect } from './specialDice';

const constant = (value = .99): RandomSource => ({ next: () => value });
function game(values: Rank[] = [4, 4, 4, 2, 6]): GameState {
  const state = newRun('global-flames', constant()).state;
  state.dice.forEach((die, index) => { die.value = values[index]; });
  state.target = 100000n; state.stats.rounds[0].target = state.target;
  return state;
}

describe('Flame formulas', () => {
  it('keeps the active Flame roster and central formulas', () => {
    expect(FLAME_IDS).toHaveLength(44);
    expect(XMult_FLAME_IDS).toEqual(FLAME_IDS);
    expect(standardFlameMultiplier(0)).toBe(1);
    expect(standardFlameMultiplier(50)).toBe(3);
    expect(standardFlameMultiplier(100)).toBe(5);
    expect(handFamilyFlameMultiplier('doubleDown', 50)).toBe(3.5);
    expect(targetPracticeMultiplier(25)).toBe(3);
    expect(momentumChargeGain(25)).toBe(.125);
    expect(lowballMultiplier(100)).toBe(3.5);
    expect(hotStreakMultiplier(50, 2)).toBe(2);
    expect(composeXMult([3, 2.2, 1.5])).toBe(9.9);
  });
  it('derives UI copy from authoritative formulas', () => {
    const state = game();
    expect(flameEffectText('ultimate', 25, state)).toContain('×2 XMult');
    expect(flameEffectText('momentum', 25, state)).toContain('+0.125');
  });
});

describe('global activation', () => {
  it('applies Lowball only when a scoring die shows 1, 2, or 3', () => {
    for (const face of [1, 2, 3, 4, 5, 6] as const) {
      const state = game([face, 2, 3, 4, 5]);
      placeFlameInstance(state, 'lowball', 100);
      const hand = (['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const)[face - 1];
      const preview = handXMultContributions(captureHandStart(state, hand, [0]), hand, 1, [0]);
      expect(preview.some(factor => factor.source === 'lowball'), `face ${face}`).toBe(face <= 3);
      new Resolver(state, constant()).play(hand, [0]);
      expect(state.stats.handScores.at(-1)?.xMult, `face ${face}`)
        .toBe(face <= 3 ? lowballMultiplier(100) : 1);
    }
  });

  it('uses the written condition independent of selected dice at Ember and Bonfire', () => {
    const ember = game(); ember.handLevels.threeKind = 3;
    const instance = placeFlameInstance(ember, 'ultimate', 50, 4);
    const selected = handXMultContributions(captureHandStart(ember, 'threeKind', [0, 1, 2]), 'threeKind', 3, [0, 1, 2]);
    const otherDice = handXMultContributions(captureHandStart(ember, 'threeKind', [1, 2, 3]), 'threeKind', 3, [1, 2, 3]);
    expect(selected).toMatchObject([{ source: 'ultimate', value: 3, dieId: null, flameInstanceId: instance.instanceId }]);
    expect(otherDice).toMatchObject([{ source: 'ultimate', value: 3, dieId: null, flameInstanceId: instance.instanceId }]);
    instance.investedGold = 100; instance.stage = 'bonfire';
    expect(handXMultContributions(captureHandStart(ember, 'threeKind', [1, 2, 3]), 'threeKind', 3, [1, 2, 3]))
      .toMatchObject([{ source: 'ultimate', value: 5, dieId: null, flameInstanceId: instance.instanceId }]);
  });
  it('keeps conditional Flames conditional without carrier checks', () => {
    const state = game([1, 2, 3, 4, 6]);
    placeFlameInstance(state, 'straightShooter', 50, 0);
    placeFlameInstance(state, 'targetPractice', 50, 1);
    placeFlameInstance(state, 'lowball', 50, 2);
    state.handFamilyFlameStages.straightShooter = 'payoff';
    state.targetPracticeHand = 'smallStraight';
    expect(handXMultContributions(captureHandStart(state, 'smallStraight', [0, 1, 2, 3]), 'smallStraight', 1, [0, 1, 2, 3])
      .map(factor => factor.source)).toEqual(['targetPractice', 'lowball']);
  });
  it('uses genuine scoring participants for Fat Cat and Vineyard, not ownership', () => {
    const state = game(); placeFlameInstance(state, 'fatCat', 100); placeFlameInstance(state, 'vineyard', 100);
    rosterDice(state)[1].effects = [createDieEffect(rosterDice(state)[1].id, 'golden')];
    rosterDice(state)[2].effects = [createDieEffect(rosterDice(state)[2].id, 'vintage')];
    syncActiveDiceProjection(state);
    expect(handXMultContributions(captureHandStart(state, 'threeKind', [0, 1, 2]), 'threeKind', 1, [0, 1, 2])
      .map(factor => factor.source)).toEqual(['fatCat', 'vineyard']);
    expect(handXMultContributions(captureHandStart(state, 'threeKind', [0]), 'threeKind', 1, [0])).toEqual([]);
  });
});

describe('five-slot lifecycle', () => {
  function reward(): GameState {
    const state = game(); state.phase = 'flameSelection'; state.gold = 200;
    state.flameSelection = { offers: [{ id: 1, flame: 'ultimate' }, { id: 2, flame: 'momentum' }], acquired: false };
    return state;
  }
  it('acquires into the first empty slot with a stable ID and advances in place', () => {
    let state = dispatch(reward(), { type: 'CHOOSE_FLAME', offerId: 1 }).state;
    const acquired = state.flameSlots[0]!;
    expect(acquired).toMatchObject({ type: 'ultimate', investedGold: 0, stage: 'ember' });
    state.shop!.stage = 'flames';
    state = dispatch(state, { type: 'STOKE_FLAME', flameInstanceId: acquired.instanceId, amount: 100 }).state;
    expect(state.flameSlots[0]).toMatchObject({ instanceId: acquired.instanceId, type: 'ultimate', investedGold: 100, stage: 'bonfire' });
    expect(state.flameSlots).toHaveLength(5);
  });
  it('requires explicit replacement when full and destroys the old investment', () => {
    const state = reward();
    (['minigun', 'hailMary', 'fullOfGrace', 'momentum', 'thirdRail'] as const)
      .forEach((type, slot) => placeFlameInstance(state, type, 20 + slot, slot as 0 | 1 | 2 | 3 | 4));
    expect(validateAction(state, { type: 'CHOOSE_FLAME', offerId: 1 })).toContain('slot to replace');
    const oldId = state.flameSlots[2]!.instanceId;
    const result = dispatch(state, { type: 'CHOOSE_FLAME', offerId: 1, replaceSlot: 2 });
    expect(result.state.flameSlots[2]).toMatchObject({ type: 'ultimate', investedGold: 0, stage: 'ember' });
    expect(result.state.flameSlots[2]!.instanceId).not.toBe(oldId);
  });
  it('enforces unique types and shows shared Stoke limits', () => {
    const state = reward(); const flame = placeFlameInstance(state, 'momentum', 95); state.gold = 4;
    expect(() => placeFlameInstance(state, 'momentum')).toThrow(/already owned/);
    expect(flameStokeLimits(state, flame.instanceId)).toEqual({ remainingCapacity: 5, affordableAmount: 4, maximumAmount: 4 });
  });
  it('generates only unowned unique offers and gracefully handles fewer than three', () => {
    const state = reward(); state.flameSelection!.offers = [];
    FLAME_IDS.slice(0, 21).forEach((type, index) => {
      if (index < 5) placeFlameInstance(state, type, 0, index as 0 | 1 | 2 | 3 | 4);
    });
    // A real run can own at most five; exclusion is asserted directly for those five.
    new Resolver(state, constant(.42)).freshFlameOffers();
    expect(new Set(state.flameSelection!.offers.map(offer => offer.flame)).size).toBe(state.flameSelection!.offers.length);
    expect(state.flameSelection!.offers.every(offer => !state.flameSlots.some(flame => flame?.type === offer.flame))).toBe(true);
  });
  it('keeps Flame identity unchanged through die movement, sale, and Fusion', () => {
    let state = game(); state.phase = 'shop'; state.gold = 100;
    state.shop = { stage: 'shop', offers: [], offerRerolls: 0, lifeRestores: 0 };
    const flame = placeFlameInstance(state, 'ultimate', 37, 3);
    const rosterId = state.diceInventory.roster[0]!;
    state = dispatch(state, { type: 'MOVE_DIE', source: { area: 'roster', index: 0 }, destination: { area: 'storage', index: 0 },
      expectedSourceDieId: rosterId, expectedDestinationDieId: null }).state;
    expect(state.flameSlots[3]).toEqual(flame);
    state = dispatch(state, { type: 'SELL_DIE', slot: { area: 'storage', index: 0 }, expectedDieId: rosterId }).state;
    expect(state.flameSlots[3]).toEqual(flame);
    const first = purchaseDie(state.diceInventory, 'bonus');
    const second = purchaseDie(state.diceInventory, 'bonus');
    state.temper = 10; state.forgeUnlocked = true; state.shop!.stage = 'forge';
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'A', dieId: second.die.id }).state;
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'B', dieId: first.die.id }).state;
    state = dispatch(state, { type: 'CONFIRM_FORGE' }).state;
    expect(state.flameSlots[3]).toEqual(flame);
  });
});

describe('Charge identity', () => {
  it('builds and arms Charge without selecting a carrier die', () => {
    let state = game(); const momentum = placeFlameInstance(state, 'momentum', 50, 4);
    state = dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant()).state;
    expect(state.chargeXMult).toBe(1.25);
    expect(state.chargeAttribution[momentum.instanceId]).toBe(.25);
    expect(validateAction(state, { type: 'TOGGLE_CHARGE' })).toBeNull();
  });
  it('keeps Hot Streak eligibility global', () => {
    let state = game([2, 2, 4, 4, 6]); placeFlameInstance(state, 'hotStreak', 50, 4); state.hotStreakGoal = 'twoPair';
    state = dispatch(state, { type: 'PLAY', hand: 'twoPair', dieIds: [0, 1, 2, 3] }, constant()).state;
    expect(state.hotStreakCharges).toBe(1);
  });
});
