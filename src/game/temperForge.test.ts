import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { placeFlameInstance } from './flames';
import { syncActiveDiceProjection } from './inventory';
import { createDieEffect } from './specialDice';
import type { GameState, RandomSource } from './types';

const constant = (value = .2): RandomSource => ({ next: () => value });
function shop(state: GameState) {
  new Resolver(state, constant()).openShop();
  state.shop!.exitUnlocked = true;
}

describe('Temper economy', () => {
  it('starts at zero with Forge locked and permanently unlocks Forge after the first gain', () => {
    const state = newRun('temper-start', constant()).state;
    expect(state).toMatchObject({ temper: 0, forgeUnlocked: false });
    new Resolver(state, constant()).addTemper(2, 'boardRefresh', 'BOARD REFRESH');
    expect(state).toMatchObject({ temper: 2, forgeUnlocked: true });
    state.temper = 0;
    expect(state.forgeUnlocked).toBe(true);
  });

  it('awards exact clamped overkill and Boss Temper at clear', () => {
    const state = newRun('temper-clear', constant()).state;
    state.target = 100n; state.score = 150n;
    state.stats.rounds.at(-1)!.target = state.target;
    new Resolver(state, constant()).evaluate();
    expect(state.roundSummary!.temper).toEqual({ overkill: 2, boardRefresh: 0, miniBoss: 0, boss: 0, total: 2 });
    expect(state.stats.temperBySource.overkill).toBe(2);
    expect(state.historyV2).toContainEqual(expect.objectContaining({ kind: 'temper_changed', operation: 'earned', source: 'overkill', amount: 2 }));
  });

  it('awards +10 once on the Ember-to-Bonfire transition', () => {
    const state = newRun('temper-bonfire', constant()).state;
    shop(state); state.gold = 10;
    const flame = placeFlameInstance(state, 'ultimate', 99);
    state.shop!.stage = 'flames';
    const result = dispatch(state, { type: 'STOKE_FLAME', flameInstanceId: flame.instanceId, amount: 1 });
    expect(result.error).toBeUndefined();
    expect(result.state.temper).toBe(10);
    expect(result.state.stats.temperBySource.bonfire).toBe(10);
  });
});

describe('authoritative Forge actions', () => {
  function forgeState(): GameState {
    const state = newRun('forge-actions', constant()).state;
    state.diceInventory.instances[0].effects = [createDieEffect(0, 'weighted', 2)];
    state.diceInventory.instances[0].effects[0].persistent.weightedFace = 3;
    state.diceInventory.instances[1].effects = [createDieEffect(1, 'weighted', 1), createDieEffect(1, 'bonus', 1)];
    syncActiveDiceProjection(state);
    shop(state); state.temper = 20; state.forgeUnlocked = true; state.shop!.stage = 'forge';
    return state;
  }

  it('makes Die A survive, consumes Die B, charges Fusion cost, and remains in Forge', () => {
    let state = forgeState();
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'A', dieId: 0 }).state;
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'B', dieId: 1 }).state;
    const result = dispatch(state, { type: 'CONFIRM_FORGE' });
    expect(result.error).toBeUndefined();
    expect(result.state.shop!.stage).toBe('forge');
    expect(result.state.diceInventory.instances[1]).toBeUndefined();
    expect(result.state.diceInventory.instances[0].effects.map(effect => [effect.type, effect.level]))
      .toEqual([['weighted', 3], ['bonus', 1]]);
    expect(result.state.diceInventory.instances[0].effects[0].persistent.weightedFace).toBe(3);
    expect(result.state.temper).toBe(16);
    expect(result.state.shop!.forgeSelection).toEqual({ dieAId: null, dieBId: null });
  });

  it('persists A/B selection across tabs and swaps socket roles without RNG', () => {
    let state = forgeState(); const rng = state.rngState;
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'A', dieId: 0 }).state;
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'B', dieId: 1 }).state;
    state = dispatch(state, { type: 'SWAP_FORGE_INGREDIENTS' }).state;
    state = dispatch(state, { type: 'SET_SHOP_STAGE', stage: 'shop' }).state;
    state = dispatch(state, { type: 'SET_SHOP_STAGE', stage: 'forge' }).state;
    expect(state.shop!.forgeSelection).toEqual({ dieAId: 1, dieBId: 0 });
    expect(state.rngState).toBe(rng);
  });

  it('rejects Normal ingredients and an unaffordable Forge without mutation', () => {
    let state = forgeState();
    expect(dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'A', dieId: 2 }).error).toMatch(/Normal dice/i);
    state.diceInventory.instances[1].effects = [createDieEffect(1, 'magic', 10)];
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'A', dieId: 0 }).state;
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'B', dieId: 1 }).state;
    state.temper = 1;
    const before = structuredClone(state.diceInventory);
    const result = dispatch(state, { type: 'CONFIRM_FORGE' });
    expect(result.error).toMatch(/Not enough Temper/i);
    expect(result.state.diceInventory).toEqual(before);
  });
});
