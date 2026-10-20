import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { HAND_IDS } from './hands';
import { purchaseDie } from './diceEconomy';
import { loadPersistedRun, savePersistedRun } from './persistence';
import type { GameState, RandomSource } from './types';
import { flameByType, placeFlameInstance } from './flames';

const constant = (value = .2): RandomSource => ({ next: () => value });

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

function openShop(seed = 'staged-shop', withFlame = true): GameState {
  const state = newRun(seed, constant()).state;
  state.gold = 1_000;
  new Resolver(state, constant(.37)).openShop();
  if (withFlame) placeFlameInstance(state, 'minigun', 0);
  state.shop!.exitUnlocked = true;
  return state;
}

function go(state: GameState, stage: 'dice' | 'training' | 'fireKeeping'): GameState {
  const result = dispatch(state, { type: 'SET_SHOP_STAGE', stage });
  expect(result.error).toBeUndefined();
  return result.state;
}

function bust(state: GameState): GameState {
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
  state.manualRerollsRemaining = 0;
  state.consumed = [...HAND_IDS];
  state.scorecardCycleConsumed = [...state.consumed];
  new Resolver(state, constant()).evaluate();
  return state;
}

describe('persistent staged Shop', () => {
  it('opens every new Shop on Dice and records one visit with the initial stage', () => {
    const state = openShop();
    expect(state.shop).toMatchObject({ stage: 'dice', kind: 'between_rounds' });
    expect(state.shop!.offers).toHaveLength(3);
    expect(state.historyV2.filter(event => event.kind === 'shop_visit_started')).toContainEqual(
      expect.objectContaining({ shopVisitId: state.shop!.visitId, initialStage: 'dice' }),
    );
  });

  it('allows direct tab navigation and emits no redundant stage events', () => {
    let state = openShop('stage-adjacency');
    state = go(state, 'fireKeeping');
    state = go(state, 'dice');
    state = go(state, 'training');
    expect(dispatch(state, { type: 'SET_SHOP_STAGE', stage: 'training' }).error).toContain('already');
    expect(state.historyV2.filter(event => event.kind === 'shop_stage_changed').map(event =>
      event.kind === 'shop_stage_changed' ? [event.from, event.to, event.shopVisitId] : null)).toEqual([
      ['dice', 'fireKeeping', state.shop!.visitId],
      ['fireKeeping', 'dice', state.shop!.visitId],
      ['dice', 'training', state.shop!.visitId],
    ]);
  });

  it('preserves Dice, Training, Flame, Gold, and visit state across repeated navigation', () => {
    let state = openShop('stage-preservation');
    const visitId = state.shop!.visitId;
    const firstOffer = state.shop!.offers[0];
    state = dispatch(state, { type: 'BUY_DIE', offerId: firstOffer.id }, constant()).state;
    state = dispatch(state, { type: 'REROLL_OFFERS' }, constant(.73)).state;
    const { die: source, slot: sourceSlot } = purchaseDie(state.diceInventory, 'bonus');
    const { die: destination, slot: destinationSlot } = purchaseDie(state.diceInventory, 'bonus');
    state = dispatch(state, { type: 'FUSE_DICE', source: sourceSlot, destination: destinationSlot,
      expectedSourceDieId: source.id, expectedDestinationDieId: destination.id }).state;
    const diceSnapshot = structuredClone({ shop: state.shop, roster: state.diceInventory.roster,
      storage: state.diceInventory.storage, fusedLevel: state.diceInventory.instances[destination.id].level });

    state = go(state, 'training');
    state = dispatch(state, { type: 'TRAIN_HAND', hand: 'pair' }).state;
    const trainedLevels = structuredClone(state.handLevels);
    const flame = placeFlameInstance(state, 'ultimate', 10);
    state = go(state, 'fireKeeping');
    state = dispatch(state, { type: 'STOKE_FLAME', flameInstanceId: flame.instanceId, amount: 3 }).state;
    const goldAfterTransactions = state.gold;

    state = go(state, 'training');
    state = go(state, 'dice');
    expect(state.shop!.visitId).toBe(visitId);
    expect(state.shop!.offers).toEqual(diceSnapshot.shop!.offers);
    expect(state.shop!.offerRerolls).toBe(diceSnapshot.shop!.offerRerolls);
    expect(state.diceInventory.roster).toEqual(diceSnapshot.roster);
    expect(state.diceInventory.storage).toEqual(diceSnapshot.storage);
    expect(state.diceInventory.instances[destination.id].level).toBe(diceSnapshot.fusedLevel);
    expect(state.handLevels).toEqual(trainedLevels);
    expect(activeFace(state.dice[0])).toBeDefined();
    expect(flameByType(state, 'ultimate')).toMatchObject({ investedGold: 13 });
    expect(state.gold).toBe(goldAfterTransactions);
  });

  it('navigation consumes no RNG and leaves the next seeded offer reroll identical', () => {
    const initial = openShop('stage-rng');
    let straight = structuredClone(initial);
    let wandering = structuredClone(initial);
    straight = go(straight, 'training');
    straight = go(straight, 'fireKeeping');
    wandering = go(wandering, 'training');
    wandering = go(wandering, 'dice');
    wandering = go(wandering, 'training');
    wandering = go(wandering, 'fireKeeping');
    wandering = go(wandering, 'training');
    wandering = go(wandering, 'fireKeeping');
    expect(wandering.rngState).toBe(straight.rngState);
    straight = go(go(straight, 'training'), 'dice');
    wandering = go(go(wandering, 'training'), 'dice');
    const rerolledA = dispatch(straight, { type: 'REROLL_OFFERS' }).state;
    const rerolledB = dispatch(wandering, { type: 'REROLL_OFFERS' }).state;
    expect(rerolledB.rngState).toBe(rerolledA.rngState);
    expect(rerolledB.shop!.offers).toEqual(rerolledA.shop!.offers);
  });

  it('captures Training at Shop creation without consuming RNG for the scorecard shape', () => {
    const balanced = newRun('training-no-rng').state;
    const shaped = structuredClone(balanced);
    shaped.handLevels.ones = 20; shaped.handLevels.fullHouse = 14;
    let balancedCalls = 0; let shapedCalls = 0;
    new Resolver(balanced, { next: () => { balancedCalls++; return .37; } }).openShop();
    new Resolver(shaped, { next: () => { shapedCalls++; return .37; } }).openShop();
    expect(shapedCalls).toBe(balancedCalls);
    expect(shaped.shop!.offers).toEqual(balanced.shop!.offers);
    expect(shaped.shop!.trainingSession).toMatchObject({
      upperLevelsAtEntry: { ones: 20 }, lowerLevelsAtEntry: { fullHouse: 14 },
    });
    expect(shaped.historyV2).toContainEqual(expect.objectContaining({ kind: 'training_session_started',
      shopVisitId: shaped.shop!.visitId, upperBaseline: 4, lowerBaseline: 3 }));
  });

  it('keeps global Flame investment independent from collection movement', () => {
    let state = openShop('stage-stored-flame');
    const dieId = state.diceInventory.roster[0]!;
    const flame = placeFlameInstance(state, 'ultimate', 5);
    state = dispatch(state, { type: 'MOVE_DIE', source: { area: 'roster', index: 0 }, destination: { area: 'storage', index: 0 },
      expectedSourceDieId: dieId, expectedDestinationDieId: null }).state;
    expect(state.dice.some(die => die.id === dieId)).toBe(false);
    state = go(go(state, 'training'), 'fireKeeping');
    const stoked = dispatch(state, { type: 'STOKE_FLAME', flameInstanceId: flame.instanceId, amount: 3 });
    expect(stoked.error).toBeUndefined();
    expect(flameByType(stoked.state, 'ultimate')).toMatchObject({ investedGold: 8 });
    expect(stoked.state.dice.some(die => die.id === dieId)).toBe(false);
  });

  it.each(['dice', 'training', 'fireKeeping'] as const)('persists and reloads the exact %s stage', stage => {
    let state = openShop(`stage-reload-${stage}`);
    if (stage !== 'dice') state = go(state, 'training');
    if (stage === 'fireKeeping') state = go(state, 'fireKeeping');
    const storage = memoryStorage();
    expect(savePersistedRun(storage, state)).toBe(true);
    const loaded = loadPersistedRun(storage, state.seed)!;
    expect(loaded.shop).toEqual(state.shop);
    expect(loaded.shop!.stage).toBe(stage);
    expect(loaded.gold).toBe(state.gold);
  });

  it('restores a Bust to Dice in the same visit without changing restored RNG or Shop content', () => {
    let state = go(openShop('stage-bust'), 'training');
    state = dispatch(state, { type: 'TRAIN_HAND', hand: 'pair' }).state;
    state = go(state, 'fireKeeping');
    state.shop!.offers[0].purchased = true;
    const visitId = state.shop!.visitId;
    const nextVisitId = state.nextShopVisitId;
    const shopBefore = structuredClone(state.shop!);
    const attempt = dispatch(state, { type: 'NEXT_ROUND' }, constant(.4)).state;
    const checkpointRng = attempt.roundCheckpoint!.rngState;
    const returned = bust(attempt);
    expect(returned).toMatchObject({ phase: 'shop', shop: { visitId, stage: 'dice' } });
    expect(returned.nextShopVisitId).toBe(nextVisitId);
    expect(returned.rngState).toBe(checkpointRng);
    expect({ ...returned.shop, stage: shopBefore.stage }).toEqual(shopBefore);
    expect(returned.shop!.trainingSession).toEqual(shopBefore.trainingSession);
    expect(returned.historyV2.filter(event => event.kind === 'shop_visit_started'
      && event.shopVisitId === visitId)).toHaveLength(1);
    expect(returned.historyV2).toContainEqual(expect.objectContaining({ kind: 'shop_stage_changed',
      shopVisitId: visitId, from: 'fireKeeping', to: 'dice' }));
  });

  it('permits completion only from Fire Keeping and records the completed visit', () => {
    let state = openShop('stage-completion');
    expect(dispatch(state, { type: 'NEXT_ROUND' }).error).toContain('Fire Keeping');
    state = go(state, 'training');
    expect(dispatch(state, { type: 'NEXT_ROUND' }).error).toContain('Fire Keeping');
    state = go(state, 'fireKeeping');
    const visitId = state.shop!.visitId;
    const completed = dispatch(state, { type: 'NEXT_ROUND' }, constant(.4));
    expect(completed.error).toBeUndefined();
    expect(completed.state.phase).toBe('round');
    expect(completed.state.historyV2).toContainEqual(expect.objectContaining({ kind: 'shop_visit_completed',
      shopVisitId: visitId, stage: 'fireKeeping', progression: 'next_round' }));
  });

  it('omits Fire Keeping when no Flames are owned and completes from Training', () => {
    let state = openShop('stage-no-flames', false);
    expect(dispatch(state, { type: 'SET_SHOP_STAGE', stage: 'fireKeeping' }).error).toContain('after you acquire a Flame');
    expect(dispatch(state, { type: 'NEXT_ROUND' }).error).toContain('Training');
    state = go(state, 'training');
    const visitId = state.shop!.visitId;
    const completed = dispatch(state, { type: 'NEXT_ROUND' }, constant(.4));
    expect(completed.error).toBeUndefined();
    expect(completed.state.phase).toBe('round');
    expect(completed.state.historyV2).toContainEqual(expect.objectContaining({ kind: 'shop_visit_completed',
      shopVisitId: visitId, stage: 'training', progression: 'next_round' }));
  });
});
