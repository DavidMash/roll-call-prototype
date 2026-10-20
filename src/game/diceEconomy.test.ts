import { describe, expect, it } from 'vitest';
import { createCollectibleDie } from './dice';
import { DICE_PRICES, DICE_RARITY_WEIGHTS, canFuse, dieSellBreakdown, generateDiceOfferTypes } from './diceEconomy';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { ownedDice, rosterDice, syncActiveDiceProjection } from './inventory';
import { loadPersistedRun, RUN_STORAGE_KEY, savePersistedRun } from './persistence';
import type { GameState, RandomSource } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });
function shopGame(random: RandomSource = constant(.1)): GameState {
  const state = newRun('dice-economy', constant()).state;
  state.gold = 500;
  new Resolver(state, random).openShop();
  state.shop!.exitUnlocked = true;
  return state;
}

describe('Dice Shop offers', () => {
  it('centralizes the approved rarity weights and prices', () => {
    expect(DICE_RARITY_WEIGHTS).toEqual({ common: 55, uncommon: 30, rare: 13, legendary: 2 });
    expect(DICE_PRICES).toEqual({ common: 10, uncommon: 20, rare: 30, legendary: 40 });
  });

  it('creates exactly three deterministic special offers and permits duplicates', () => {
    expect(generateDiceOfferTypes(constant(0))).toEqual(['bonus', 'bonus', 'bonus']);
    const first = shopGame(constant(0));
    const replay = shopGame(constant(0));
    expect(first.shop!.offers).toEqual(replay.shop!.offers);
    expect(first.shop!.offers).toHaveLength(3);
    expect(first.shop!.offers.every(offer => !!offer.dieType)).toBe(true);
  });

  it('rerolls only the offers with seeded RNG and records old/new stable IDs', () => {
    const state = shopGame(constant(.2));
    const old = state.shop!.offers.map(offer => offer.id);
    const inventory = structuredClone(state.diceInventory);
    const result = dispatch(state, { type: 'REROLL_OFFERS' }, constant(.9));
    expect(result.error).toBeUndefined();
    expect(result.state.shop!.offers.map(offer => offer.id)).not.toEqual(old);
    expect(result.state.diceInventory).toEqual(inventory);
    expect([...result.state.historyV2].reverse().find(event => event.kind === 'shop_transaction'
      && event.transaction.type === 'dice_offers_rerolled')).toMatchObject({ kind: 'shop_transaction', transaction: {
      type: 'dice_offers_rerolled', oldOfferIds: old, rerollCount: 1,
    } });
  });

  it('preserves exact offer IDs, contents, and purchase state across reload and prevents repurchase', () => {
    let state = shopGame();
    const offerId = state.shop!.offers[0].id;
    state = dispatch(state, { type: 'BUY_DIE', offerId }, constant()).state;
    const storage = new Map<string, string>();
    const store = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } };
    expect(savePersistedRun(store, state)).toBe(true);
    const loaded = loadPersistedRun(store, state.seed)!;
    expect(loaded.shop!.offers).toEqual(state.shop!.offers);
    expect(JSON.parse(storage.get(RUN_STORAGE_KEY)!).version).toBeGreaterThan(0);
    const retry = dispatch(loaded, { type: 'BUY_DIE', offerId }, constant());
    expect(retry.error).toMatch(/available Dice offer/i);
  });
});

describe('Dice collection transactions', () => {
  it('places purchases into the first open Roster slot, then Storage, with a stable Lv1 ID', () => {
    let state = shopGame();
    state.diceInventory.storage[0] = state.diceInventory.roster[4];
    state.diceInventory.roster[4] = null;
    syncActiveDiceProjection(state);
    const firstOffer = state.shop!.offers[0];
    state = dispatch(state, { type: 'BUY_DIE', offerId: firstOffer.id }, constant()).state;
    const rosterId = state.diceInventory.roster[4]!;
    expect(state.diceInventory.instances[rosterId]).toMatchObject({ id: rosterId, type: firstOffer.dieType, level: 1 });
    expect(rosterId).toBe(5);

    const secondOffer = state.shop!.offers[1];
    state = dispatch(state, { type: 'BUY_DIE', offerId: secondOffer.id }, constant()).state;
    expect(state.diceInventory.storage[1]).toBe(6);
  });

  it('rejects a full collection without Gold or offer mutation', () => {
    const state = shopGame();
    for (let index = 0; index < state.diceInventory.storage.length; index++) {
      const die = createCollectibleDie(state.diceInventory.nextDieId++, 'bonus');
      state.diceInventory.instances[die.id] = die;
      state.diceInventory.storage[index] = die.id;
    }
    expect(ownedDice(state)).toHaveLength(10);
    const gold = state.gold; const offer = structuredClone(state.shop!.offers[0]);
    const result = dispatch(state, { type: 'BUY_DIE', offerId: offer.id }, constant());
    expect(result.error).toMatch(/Collection full/);
    expect(result.state.gold).toBe(gold);
    expect(result.state.shop!.offers[0]).toEqual(offer);
  });

  it('moves and swaps by stable expected identity without consuming RNG', () => {
    let state = shopGame();
    const rng = state.rngState;
    state = dispatch(state, { type: 'MOVE_DIE', source: { area: 'roster', index: 0 }, destination: { area: 'storage', index: 0 },
      expectedSourceDieId: 0, expectedDestinationDieId: null }).state;
    expect(state.diceInventory.roster[0]).toBeNull();
    expect(state.diceInventory.storage[0]).toBe(0);
    expect(state.rngState).toBe(rng);
    const stale = dispatch(state, { type: 'MOVE_DIE', source: { area: 'storage', index: 0 }, destination: { area: 'roster', index: 1 },
      expectedSourceDieId: 99, expectedDestinationDieId: 1 });
    expect(stale.error).toMatch(/collection changed/i);
  });

  it('fuses into the destination identity, adds levels, combines Vintage, and preserves destination Weighted config', () => {
    let state = shopGame();
    Object.assign(state.diceInventory.instances[0], { type: 'vintage', level: 2, vintageAppreciation: 170 });
    Object.assign(state.diceInventory.instances[1], { type: 'vintage', level: 2, vintageAppreciation: 170 });
    expect(canFuse(state.diceInventory.instances[0], state.diceInventory.instances[1])).toBe(true);
    state = dispatch(state, { type: 'FUSE_DICE', source: { area: 'roster', index: 0 }, destination: { area: 'roster', index: 1 },
      expectedSourceDieId: 0, expectedDestinationDieId: 1 }).state;
    expect(state.diceInventory.instances[0]).toBeUndefined();
    expect(state.diceInventory.roster[0]).toBeNull();
    expect(state.diceInventory.instances[1]).toMatchObject({ id: 1, level: 4, vintageAppreciation: 340 });

    Object.assign(state.diceInventory.instances[2], { type: 'weighted', level: 1, weightedFace: 2 });
    Object.assign(state.diceInventory.instances[3], { type: 'weighted', level: 2, weightedFace: 5 });
    state = dispatch(state, { type: 'FUSE_DICE', source: { area: 'roster', index: 2 }, destination: { area: 'roster', index: 3 },
      expectedSourceDieId: 2, expectedDestinationDieId: 3 }).state;
    expect(state.diceInventory.instances[3]).toMatchObject({ level: 3, weightedFace: 5 });
  });

  it('does not allow Fusion to consume the final equipped die into Storage', () => {
    const state = shopGame();
    Object.assign(state.diceInventory.instances[0], { type: 'bonus', level: 1 });
    Object.assign(state.diceInventory.instances[1], { type: 'bonus', level: 1 });
    state.diceInventory.storage = [1, 2, 3, 4, null];
    for (let index = 1; index < 5; index++) state.diceInventory.roster[index] = null;
    syncActiveDiceProjection(state);
    expect(dispatch(state, { type: 'FUSE_DICE', source: { area: 'roster', index: 0 }, destination: { area: 'storage', index: 0 },
      expectedSourceDieId: 0, expectedDestinationDieId: 1 }).error).toMatch(/At least one die/i);
  });

  it('uses authoritative sale formulas and prevents selling the final equipped die', () => {
    let state = shopGame();
    const normal = state.diceInventory.instances[0];
    expect(dieSellBreakdown(normal).total).toBe(1);
    Object.assign(state.diceInventory.instances[1], { type: 'vintage', level: 3, vintageAppreciation: 80 });
    expect(dieSellBreakdown(state.diceInventory.instances[1])).toEqual({ base: 15, vintageAppreciation: 80, total: 95 });
    for (let index = 1; index < 5; index++) {
      state.diceInventory.storage[index - 1] ??= state.diceInventory.roster[index];
      state.diceInventory.roster[index] = null;
    }
    syncActiveDiceProjection(state);
    expect(rosterDice(state)).toHaveLength(1);
    expect(dispatch(state, { type: 'SELL_DIE', slot: { area: 'roster', index: 0 }, expectedDieId: 0 }).error)
      .toMatch(/final equipped die/i);
  });
});
