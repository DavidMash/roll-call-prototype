import { describe, expect, it } from 'vitest';
import { createCollectibleDie } from './dice';
import { DICE_RARITY_WEIGHTS, generateDiceOfferTypes } from './diceEconomy';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { classifyForge, dieForgeRating, dieSellBreakdown, mergedEffects, previewForge } from './forge';
import { ownedDice, syncActiveDiceProjection } from './inventory';
import { createDieEffect, effectOf } from './specialDice';
import type { GameState, RandomSource } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });
function shopGame(random: RandomSource = constant(.1)): GameState {
  const state = newRun('dice-economy', constant()).state;
  state.gold = 500;
  new Resolver(state, random).openShop();
  state.shop!.exitUnlocked = true;
  return state;
}

describe('Dice Shop offers and capacity', () => {
  it('uses authoritative rarity weights and creates three deterministic offers', () => {
    expect(DICE_RARITY_WEIGHTS).toEqual({ common: 55, uncommon: 30, rare: 13, legendary: 2 });
    expect(generateDiceOfferTypes(constant(0))).toEqual(['bonus', 'bonus', 'bonus']);
    expect(shopGame(constant(0)).shop!.offers).toHaveLength(3);
  });

  it('always owns five Roster and five fixed Storage slots and fills Roster before Storage', () => {
    let state = shopGame();
    expect(state.diceInventory.roster).toHaveLength(5);
    expect(state.diceInventory.storage).toEqual([null, null, null, null, null]);
    state.diceInventory.storage[0] = state.diceInventory.roster[4];
    state.diceInventory.roster[4] = null;
    syncActiveDiceProjection(state);
    const first = state.shop!.offers[0];
    state = dispatch(state, { type: 'BUY_DIE', offerId: first.id }, constant()).state;
    expect(state.diceInventory.instances[state.diceInventory.roster[4]!].effects[0].type).toBe(first.dieType);
    const second = state.shop!.offers[1];
    state = dispatch(state, { type: 'BUY_DIE', offerId: second.id }, constant()).state;
    expect(state.diceInventory.storage[1]).not.toBeNull();
  });

  it('blocks an eleventh die without charging Gold or mutating its offer', () => {
    const state = shopGame();
    for (let index = 0; index < 5; index++) {
      const die = createCollectibleDie(state.diceInventory.nextDieId++, 'bonus');
      state.diceInventory.instances[die.id] = die; state.diceInventory.storage[index] = die.id;
    }
    expect(ownedDice(state)).toHaveLength(10);
    const gold = state.gold; const offer = structuredClone(state.shop!.offers[0]);
    const result = dispatch(state, { type: 'BUY_DIE', offerId: offer.id });
    expect(result.error).toMatch(/Collection full/i);
    expect(result.state.gold).toBe(gold);
    expect(result.state.shop!.offers[0]).toEqual(offer);
  });

  it('swaps occupied collection slots without opening an implicit Fusion path', () => {
    const state = shopGame();
    const result = dispatch(state, { type: 'MOVE_DIE', source: { area: 'roster', index: 0 }, destination: { area: 'roster', index: 1 },
      expectedSourceDieId: 0, expectedDestinationDieId: 1 });
    expect(result.error).toBeUndefined();
    expect(result.state.diceInventory.roster.slice(0, 2)).toEqual([1, 0]);
  });
});

describe('Forge math and sale economy', () => {
  it('computes ratings with arbitrary-precision multiplication', () => {
    const die = createCollectibleDie(1, 'magic', 20);
    die.effects.push(createDieEffect(1, 'conjoined', 30), createDieEffect(1, 'doubleTime', 40));
    expect(dieForgeRating(die)).toBe(27n * 37n * 47n);
  });

  it('classifies containment as Fusion and adds matching levels while retaining Die A identity/configuration', () => {
    const a = createCollectibleDie(1, 'weighted', 2);
    effectOf(a, 'weighted')!.persistent.weightedFace = 3;
    const b = createCollectibleDie(2, 'weighted', 4);
    effectOf(b, 'weighted')!.persistent.weightedFace = 6;
    b.effects.push(createDieEffect(2, 'bonus', 1));
    expect(classifyForge(a, b)).toBe('fusion');
    const effects = mergedEffects(a, b);
    expect(effects.map(effect => [effect.type, effect.level])).toEqual([['weighted', 6], ['bonus', 1]]);
    expect(effects[0].id).toBe('1:weighted');
    expect(effects[0].persistent.weightedFace).toBe(3);
    expect(previewForge(a, b).cost).toBe(7n);
  });

  it('classifies incomparable sets as a true Forge and charges the input rating product', () => {
    const a = createCollectibleDie(1, 'bonus', 2); // weight 3
    const b = createCollectibleDie(2, 'magic', 3); // weight 10
    const preview = previewForge(a, b);
    expect(preview.kind).toBe('forge');
    expect(preview.cost).toBe(30n);
    expect(preview.effects.map(effect => effect.type)).toEqual(['bonus', 'magic']);
  });

  it('uses component salvage, exact floored complexity, and Vintage appreciation', () => {
    const die = createCollectibleDie(3, 'bonus', 2);
    die.effects.push(createDieEffect(3, 'magic', 1), createDieEffect(3, 'vintage', 1));
    effectOf(die, 'vintage')!.persistent.vintageAppreciation = 17;
    // Components 10 + 20 + 5; rating 3*8*2=48; floor(4*sqrt(48))=27.
    expect(dieSellBreakdown(die)).toEqual({ componentSalvage: 35, complexityPremium: 27,
      vintageAppreciation: 17, total: 79 });
    expect(dieSellBreakdown(createCollectibleDie(4)).total).toBe(1);
  });
});
