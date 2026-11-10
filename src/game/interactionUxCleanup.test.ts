import { describe, expect, it } from 'vitest';
import { dispatch, newRun, normalizeGameState, usesImmediateMutationPresentation, validateAction } from './engine';
import { Resolver } from './effects';
import { createCursedDie } from './bosses';
import { placeFlameInstance } from './flames';
import { eligibleFetchTargets } from './fetchTarget';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { effectOf, effectRuntime, createDieEffect, resetDieRoundState, SPECIAL_DICE } from './specialDice';
import { renderRunHistoryV2Event } from './runHistoryV2Renderer';
import type { GameState, RandomSource, ShopStage } from './types';

const constant = (value = .25): RandomSource => ({ next: () => value });

function flywheelRound(levels: number[]): GameState {
  const state = newRun('automatic-flywheel', constant()).state;
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
  levels.forEach((level, index) => {
    state.diceInventory.instances[index].effects = level > 0 ? [createDieEffect(index, 'flywheel', level)] : [];
  });
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  return state;
}

function uses(state: GameState, dieId: number): number {
  const die = state.diceInventory.instances[dieId];
  return effectRuntime(state.dieRoundState[dieId], effectOf(die, 'flywheel'))?.invocationsRemaining ?? 0;
}

describe('automatic Flywheel Manual Rerolls', () => {
  it('rerolls one covered die for free and records an automatic activation', () => {
    const state = flywheelRound([1, 0, 0, 0, 0]);
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(.7));
    expect(result.error).toBeUndefined();
    expect(result.state.manualRerollsRemaining).toBe(3);
    expect(uses(result.state, 0)).toBe(0);
    expect(result.state.stats.manualRerolls.at(-1)).toMatchObject({ charges: 0, flywheelDieIds: [0] });
    expect(result.state.historyV2.find(event => event.kind === 'special_die_activated' && event.dieType === 'flywheel'))
      .toMatchObject({ context: 'other', effectCause: 'automatic_manual_reroll' });
  });

  it('covers multiple selected Flywheel dice without consuming a Manual Reroll', () => {
    const state = flywheelRound([1, 1, 0, 0, 0]);
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1] }, constant(.7));
    expect(result.state.manualRerollsRemaining).toBe(3);
    expect([uses(result.state, 0), uses(result.state, 1)]).toEqual([0, 0]);
    expect(result.state.stats.manualRerolls.at(-1)?.charges).toBe(0);
  });

  it('uses one paid reroll for a mixed selection and consumes only available Flywheel uses', () => {
    const state = flywheelRound([1, 1, 0, 0, 0]);
    effectRuntime(state.dieRoundState[1], effectOf(state.diceInventory.instances[1], 'flywheel'))!.invocationsRemaining = 0;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1, 2] }, constant(.7));
    expect(result.state.manualRerollsRemaining).toBe(2);
    expect([uses(result.state, 0), uses(result.state, 1)]).toEqual([0, 0]);
    expect(result.state.stats.manualRerolls.at(-1)).toMatchObject({ charges: 1, flywheelDieIds: [0] });
  });

  it('permits zero-resource all-Flywheel selections but rejects mixed selections', () => {
    const free = flywheelRound([1, 1, 0, 0, 0]);
    free.manualRerollsRemaining = 0;
    expect(validateAction(free, { type: 'MANUAL_REROLL', dieIds: [0, 1] })).toBeNull();
    expect(dispatch(free, { type: 'MANUAL_REROLL', dieIds: [0, 1] }, constant()).error).toBeUndefined();

    const mixed = flywheelRound([1, 0, 0, 0, 0]);
    mixed.manualRerollsRemaining = 0;
    expect(validateAction(mixed, { type: 'MANUAL_REROLL', dieIds: [0, 1] })).toContain('Not enough');
  });

  it('is automatic metadata and no longer accepts the legacy command', () => {
    const state = flywheelRound([1, 0, 0, 0, 0]);
    expect(SPECIAL_DICE.flywheel.activation).toBe('automatic');
    expect(validateAction(state, { type: 'INVOKE_FLYWHEEL', dieId: 0 })).toContain('automatically');
  });
});

function shop(seed = 'immediate-shop'): GameState {
  const state = newRun(seed, constant()).state;
  state.gold = 1_000; state.temper = 1_000;
  new Resolver(state, constant()).openShop();
  state.shop!.exitUnlocked = true;
  return state;
}

function go(state: GameState, stage: ShopStage): GameState {
  const result = dispatch(state, { type: 'SET_SHOP_STAGE', stage }, constant());
  expect(result.error).toBeUndefined();
  expect(result.events).toEqual([]);
  return result.state;
}

describe('Shop mutations are presentation-silent', () => {
  it('keeps purchases, Training, Forge, Flame investment, and collection movement out of gameplay beats', () => {
    let state = shop();
    let result = dispatch(state, { type: 'BUY_DIE', offerId: state.shop!.offers[0].id }, constant());
    expect(result.events).toEqual([]); state = result.state;

    result = dispatch(state, { type: 'MOVE_DIE', source: { area: 'roster', index: 0 },
      destination: { area: 'storage', index: 0 }, expectedSourceDieId: 0, expectedDestinationDieId: null }, constant());
    expect(result.events).toEqual([]); state = result.state;

    state = go(state, 'train');
    result = dispatch(state, { type: 'TRAIN_HAND', hand: 'ones' }, constant());
    expect(result.events).toEqual([]); state = result.state;

    placeFlameInstance(state, 'momentum', 0);
    state = go(state, 'flames');
    result = dispatch(state, { type: 'STOKE_FLAME', flameInstanceId: state.flameSlots[0]!.instanceId, amount: 5 }, constant());
    expect(result.events).toEqual([]);

    state = shop('forge-silent'); state.forgeUnlocked = true;
    state.diceInventory.instances[0].effects = [createDieEffect(0, 'bonus')];
    state = go(state, 'forge');
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'A', dieId: 0 }, constant()).state;
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'B', dieId: 1 }, constant()).state;
    result = dispatch(state, { type: 'CONFIRM_FORGE' }, constant());
    expect(result.events).toEqual([]);
  });

  it('retains Round gameplay beats and centralizes immediate-action classification', () => {
    const state = flywheelRound([0, 0, 0, 0, 0]);
    expect(dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant()).events.length).toBeGreaterThan(0);
    expect(usesImmediateMutationPresentation({ type: 'TRAIN_HAND', hand: 'ones' })).toBe(true);
    expect(usesImmediateMutationPresentation({ type: 'PLAY', hand: 'ones', dieIds: [0] })).toBe(false);
  });
});

describe('Shop-local navigation history', () => {
  function fullyOpen(): GameState {
    const state = shop('shop-history');
    state.forgeUnlocked = true; placeFlameInstance(state, 'momentum', 0);
    return state;
  }

  it('walks the actual Forge → Training → Flames path backward', () => {
    let state = fullyOpen();
    state = go(state, 'forge'); state = go(state, 'train'); state = go(state, 'flames');
    expect(state.shop!.navigationHistory).toEqual(['shop', 'forge', 'train', 'flames']);
    state = dispatch(state, { type: 'SHOP_BACK' }).state;
    expect(state.shop!.stage).toBe('train');
    state = dispatch(state, { type: 'SHOP_BACK' }).state;
    expect(state.shop!.stage).toBe('forge');
  });

  it('returns directly from Flames to Shop and resets for a new visit', () => {
    let state = fullyOpen();
    state = go(state, 'flames');
    state = dispatch(state, { type: 'SHOP_BACK' }).state;
    expect(state.shop!.stage).toBe('shop');
    expect(state.shop!.navigationHistory).toEqual(['shop']);
    new Resolver(state, constant()).openShop();
    expect(state.shop!.navigationHistory).toEqual(['shop']);
  });

  it('rejects duplicate consecutive navigation without duplicating the stack', () => {
    const state = fullyOpen();
    const duplicate = dispatch(state, { type: 'SET_SHOP_STAGE', stage: 'shop' });
    expect(duplicate.error).toContain('already open');
    expect(state.shop!.navigationHistory).toEqual(['shop']);
  });
});

function fetchState(seed = 'fetch-targeting'): GameState {
  const state = newRun(seed, constant()).state;
  placeFlameInstance(state, 'fetch', 100);
  new Resolver(state, constant()).setFetchTarget(null);
  return state;
}

describe('authoritative Fetch targeting', () => {
  it('initially targets only active roster player dice and never temporary boss dice', () => {
    const state = fetchState();
    state.encounterDice.push(createCursedDie()); syncActiveDiceProjection(state);
    new Resolver(state, constant(.99)).setFetchTarget(state.fetchTarget, 'target_scored');
    expect(state.fetchTarget).not.toBeNull();
    expect(state.diceInventory.roster).toContain(state.fetchTarget!.dieId);
    expect(state.fetchTarget!.dieId).toBeGreaterThanOrEqual(0);
    expect(eligibleFetchTargets(state).every(target => target.dieId >= 0)).toBe(true);
  });

  it('immediately retargets when the target moves to Storage', () => {
    const initial = fetchState('fetch-move');
    new Resolver(initial, constant()).openShop(); initial.shop!.exitUnlocked = true;
    const targetId = initial.fetchTarget!.dieId;
    const sourceIndex = initial.diceInventory.roster.indexOf(targetId);
    const result = dispatch(initial, { type: 'MOVE_DIE', source: { area: 'roster', index: sourceIndex },
      destination: { area: 'storage', index: 0 }, expectedSourceDieId: targetId, expectedDestinationDieId: null }, constant(.8));
    expect(result.state.fetchTarget?.dieId).not.toBe(targetId);
    expect(result.state.diceInventory.roster).toContain(result.state.fetchTarget!.dieId);
    expect([...result.state.historyV2].reverse().find(event => event.kind === 'fetch_target_changed'))
      .toMatchObject({ reason: 'roster_changed', previous: { dieId: targetId } });
  });

  it('updates the eligible pool when a Storage die returns to the roster', () => {
    let state = fetchState('fetch-pool');
    new Resolver(state, constant()).openShop(); state.shop!.exitUnlocked = true;
    state = dispatch(state, { type: 'MOVE_DIE', source: { area: 'roster', index: 4 },
      destination: { area: 'storage', index: 0 }, expectedSourceDieId: 4, expectedDestinationDieId: null }, constant()).state;
    expect(eligibleFetchTargets(state).some(target => target.dieId === 4)).toBe(false);
    state = dispatch(state, { type: 'MOVE_DIE', source: { area: 'storage', index: 0 },
      destination: { area: 'roster', index: 4 }, expectedSourceDieId: 4, expectedDestinationDieId: null }, constant()).state;
    expect(eligibleFetchTargets(state).some(target => target.dieId === 4)).toBe(true);
  });

  it('repairs targeted dice consumed by Forge or removed by sale', () => {
    let forged = fetchState('fetch-forge');
    new Resolver(forged, constant()).openShop(); forged.shop!.exitUnlocked = true; forged.forgeUnlocked = true; forged.temper = 100;
    const targetId = forged.fetchTarget!.dieId;
    const otherId = forged.diceInventory.roster.find(id => id !== null && id !== targetId)!;
    forged.diceInventory.instances[targetId].effects = [createDieEffect(targetId, 'bonus')];
    forged = go(forged, 'forge');
    forged = dispatch(forged, { type: 'SET_FORGE_INGREDIENT', socket: 'A', dieId: targetId }).state;
    forged = dispatch(forged, { type: 'SET_FORGE_INGREDIENT', socket: 'B', dieId: otherId }).state;
    forged = dispatch(forged, { type: 'CONFIRM_FORGE' }, constant()).state;
    expect(forged.fetchTarget?.dieId).not.toBe(targetId);
    expect([...forged.historyV2].reverse().find(event => event.kind === 'fetch_target_changed'))
      .toMatchObject({ reason: 'forge_consumed' });

    let sold = fetchState('fetch-sell'); new Resolver(sold, constant()).openShop(); sold.shop!.exitUnlocked = true;
    const soldId = sold.fetchTarget!.dieId;
    const slot = sold.diceInventory.roster.indexOf(soldId);
    sold = dispatch(sold, { type: 'SELL_DIE', slot: { area: 'roster', index: slot }, expectedDieId: soldId }, constant()).state;
    expect(sold.fetchTarget?.dieId).not.toBe(soldId);
    expect([...sold.historyV2].reverse().find(event => event.kind === 'fetch_target_changed'))
      .toMatchObject({ reason: 'die_removed' });
  });

  it('repairs stale Storage targets on load and logs stable IDs', () => {
    const state = fetchState('fetch-load');
    const target = state.fetchTarget!;
    const source = state.diceInventory.roster.indexOf(target.dieId);
    state.diceInventory.roster[source] = null; state.diceInventory.storage[0] = target.dieId;
    syncActiveDiceProjection(state);
    const loaded = normalizeGameState(state);
    expect(loaded.fetchTarget?.dieId).not.toBe(target.dieId);
    const event = [...loaded.historyV2].reverse().find(item => item.kind === 'fetch_target_changed')!;
    expect(event).toMatchObject({ reason: 'load_repair', previous: { dieId: target.dieId } });
    expect(renderRunHistoryV2Event(event)).toContain(`Die #${target.dieId}`);
  });

  it('uses a safe no-target state when no roster die is playable', () => {
    const state = fetchState('fetch-none');
    const onlyId = state.diceInventory.roster[0]!;
    for (let index = 1; index < state.diceInventory.roster.length; index++) {
      const id = state.diceInventory.roster[index];
      state.diceInventory.roster[index] = null;
      if (id !== null) state.diceInventory.storage[index - 1] = id;
    }
    syncActiveDiceProjection(state);
    state.boss = { type: 'magician', missingDieId: onlyId, returned: false,
      calledHands: ['sixes', 'fives', 'fours'], completedHands: [] };
    new Resolver(state, constant()).revalidateFetchTarget('round_start_repair');
    expect(state.fetchTarget).toBeNull();
  });
});
