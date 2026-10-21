import { describe, expect, it } from 'vitest';
import { dispatch, availableShopStages, newRun } from './engine';
import { Resolver } from './effects';
import { placeFlameInstance } from './flames';
import { createDieEffect } from './specialDice';
import type { GameState, RandomSource, ShopStage } from './types';

const constant = (value = .2): RandomSource => ({ next: () => value });
function openShop(seed = 'shop-tabs'): GameState {
  const state = newRun(seed, constant()).state;
  state.gold = 1_000;
  new Resolver(state, constant(.37)).openShop();
  state.shop!.exitUnlocked = true;
  return state;
}
function go(state: GameState, stage: ShopStage): GameState {
  const result = dispatch(state, { type: 'SET_SHOP_STAGE', stage });
  expect(result.error).toBeUndefined();
  return result.state;
}

describe('persistent Shop tabs', () => {
  it('shows Shop and Train initially, then permanently unlocks Forge after Temper and conditionally shows Flames', () => {
    const state = openShop();
    expect(availableShopStages(state)).toEqual(['shop', 'train']);
    state.temper = 2; state.forgeUnlocked = true;
    expect(availableShopStages(state)).toEqual(['shop', 'forge', 'train']);
    state.temper = 0;
    expect(availableShopStages(state)).toContain('forge');
    placeFlameInstance(state, 'minigun', 0);
    expect(availableShopStages(state)).toEqual(['shop', 'forge', 'train', 'flames']);
  });

  it('allows direct navigation without changing RNG, offers, training baselines, Forge selection, or visit ID', () => {
    let state = openShop('direct-tabs');
    state.temper = 10; state.forgeUnlocked = true;
    placeFlameInstance(state, 'minigun', 0);
    state.diceInventory.instances[0].effects = [createDieEffect(0, 'bonus')];
    state.shop!.forgeSelection = { dieAId: 0, dieBId: null };
    const snapshot = structuredClone({ rng: state.rngState, offers: state.shop!.offers,
      training: state.shop!.trainingSession, selection: state.shop!.forgeSelection, visit: state.shop!.visitId });
    state = go(state, 'flames');
    state = go(state, 'shop');
    state = go(state, 'forge');
    state = go(state, 'train');
    expect({ rng: state.rngState, offers: state.shop!.offers, training: state.shop!.trainingSession,
      selection: state.shop!.forgeSelection, visit: state.shop!.visitId }).toEqual({ ...snapshot,
        selection: { dieAId: null, dieBId: null } });
    expect(state.historyV2.filter(event => event.kind === 'shop_stage_changed')).toHaveLength(4);
  });

  it('does not regenerate offers when tabs change and keeps offer rerolls authoritative', () => {
    let state = openShop('tab-offers');
    state.forgeUnlocked = true;
    const initialIds = state.shop!.offers.map(offer => offer.id);
    state = go(go(go(state, 'forge'), 'train'), 'shop');
    expect(state.shop!.offers.map(offer => offer.id)).toEqual(initialIds);
    const rerolled = dispatch(state, { type: 'REROLL_OFFERS' }, constant(.9));
    expect(rerolled.error).toBeUndefined();
    expect(rerolled.state.shop!.offers.map(offer => offer.id)).not.toEqual(initialIds);
  });

  it('requires progression from the last available tab while leaving backward navigation free', () => {
    let state = openShop('sequential-cta');
    expect(dispatch(state, { type: 'NEXT_ROUND' }).error).toContain('TRAIN');
    state = go(state, 'train');
    expect(dispatch(state, { type: 'NEXT_ROUND' }).error).toBeUndefined();

    state = openShop('sequential-with-flame');
    state.forgeUnlocked = true; placeFlameInstance(state, 'minigun', 0);
    state = go(state, 'train');
    expect(dispatch(state, { type: 'NEXT_ROUND' }).error).toContain('FLAMES');
    state = go(state, 'flames');
    expect(dispatch(state, { type: 'NEXT_ROUND' }).error).toBeUndefined();
  });
});
