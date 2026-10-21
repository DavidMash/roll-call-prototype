import { describe, expect, it } from 'vitest';
import { dispatch, newRun, normalizeGameState } from './engine';
import { Resolver } from './effects';
import { placeFlameInstance } from './flames';
import { syncActiveDiceProjection } from './inventory';
import { createDieEffect } from './specialDice';
import type { GameState, RandomSource } from './types';
import { previewForge } from './forge';
import { createCollectibleDie } from './dice';

const constant = (value = .2): RandomSource => ({ next: () => value });
function shop(state: GameState) {
  new Resolver(state, constant()).openShop();
  state.shop!.exitUnlocked = true;
}

describe('Temper economy', () => {
  it('reveals only with Temper and two special dice, then stays revealed', () => {
    const state = newRun('temper-start', constant()).state;
    expect(state).toMatchObject({ temper: 0, forgeUnlocked: false });
    new Resolver(state, constant()).addTemper(2, 'boardRefresh', 'BOARD REFRESH');
    expect(state).toMatchObject({ temper: 2, forgeUnlocked: false });
    state.diceInventory.instances[0].effects = [createDieEffect(0, 'bonus')];
    state.diceInventory.instances[1].effects = [createDieEffect(1, 'golden')];
    new Resolver(state, constant()).addTemper(1, 'boardRefresh', 'BOARD REFRESH');
    expect(state).toMatchObject({ temper: 3, forgeUnlocked: true });
    state.temper = 0;
    expect(state.forgeUnlocked).toBe(true);
  });

  it('uses the full two-special-dice plus positive-Temper reveal condition', () => {
    const base = newRun('forge-reveal-matrix', constant()).state;
    base.diceInventory.instances[0].effects = [createDieEffect(0, 'bonus')];
    base.temper = 1;
    expect(normalizeGameState(base).forgeUnlocked).toBe(false);
    base.temper = 0;
    base.diceInventory.instances[1].effects = [createDieEffect(1, 'golden')];
    expect(normalizeGameState(base).forgeUnlocked).toBe(false);
    base.temper = 1;
    const revealed = normalizeGameState(base);
    expect(revealed.forgeUnlocked).toBe(true);
    revealed.temper = 0;
    revealed.diceInventory.instances[0].effects = [];
    revealed.diceInventory.instances[1].effects = [];
    expect(normalizeGameState(revealed).forgeUnlocked).toBe(true);
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

  it('consumes both unordered ingredients, creates a result, and places it Roster-first', () => {
    let state = forgeState();
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'A', dieId: 0 }).state;
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'B', dieId: 1 }).state;
    const result = dispatch(state, { type: 'CONFIRM_FORGE' });
    expect(result.error).toBeUndefined();
    expect(result.state.shop!.stage).toBe('forge');
    expect(result.state.diceInventory.instances[0]).toBeUndefined();
    expect(result.state.diceInventory.instances[1]).toBeUndefined();
    const forged = result.state.diceInventory.instances[5];
    expect(forged.effects.map(effect => [effect.type, effect.level]))
      .toEqual([['weighted', 3], ['bonus', 1]]);
    expect(forged.effects[0].persistent.weightedFace).toBe(3);
    expect(result.state.diceInventory.roster[0]).toBe(5);
    expect(result.state.temper).toBe(16);
    expect(result.state.shop!.forgeSelection).toEqual({ dieAId: null, dieBId: null });
  });

  it('clears temporary staging when leaving Forge without consuming or moving dice', () => {
    let state = forgeState(); const rng = state.rngState;
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'A', dieId: 0 }).state;
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'B', dieId: 1 }).state;
    const before = structuredClone(state.diceInventory);
    state = dispatch(state, { type: 'SET_SHOP_STAGE', stage: 'shop' }).state;
    state = dispatch(state, { type: 'SET_SHOP_STAGE', stage: 'forge' }).state;
    expect(state.shop!.forgeSelection).toEqual({ dieAId: null, dieBId: null });
    expect(state.diceInventory).toEqual(before);
    expect(state.rngState).toBe(rng);
  });

  it('reserves staged source slots while allowing other inventory rearrangement', () => {
    let state = forgeState();
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'A', dieId: 0 }).state;
    expect(dispatch(state, { type: 'MOVE_DIE', source: { area: 'roster', index: 0 }, destination: { area: 'storage', index: 0 },
      expectedSourceDieId: 0, expectedDestinationDieId: null }).error).toMatch(/staged|reserved/i);
    const moved = dispatch(state, { type: 'MOVE_DIE', source: { area: 'roster', index: 2 }, destination: { area: 'storage', index: 0 },
      expectedSourceDieId: 2, expectedDestinationDieId: null });
    expect(moved.error).toBeUndefined();
    expect(moved.state.diceInventory.storage[0]).toBe(2);
  });

  it('is order-independent and places a Roster plus Storage result into the vacated Roster slot', () => {
    let state = forgeState();
    const stored = createCollectibleDie(5, 'magic');
    state.temper = 30;
    state.diceInventory.instances[5] = stored;
    state.diceInventory.storage[0] = 5;
    state.diceInventory.nextDieId = 6;
    expect(previewForge(state.diceInventory.instances[0], stored)).toEqual(previewForge(stored, state.diceInventory.instances[0]));
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'A', dieId: 5 }).state;
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'B', dieId: 0 }).state;
    state = dispatch(state, { type: 'CONFIRM_FORGE' }).state;
    expect(state.diceInventory.roster[0]).toBe(6);
    expect(state.diceInventory.storage[0]).toBeNull();
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
