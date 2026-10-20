import { describe, expect, it } from 'vitest';
import { activeEncounterDice, ALL_BOSS_TYPES, createCursedDie, handIsPhysicallyAttainable } from './bosses';
import { createCollectibleDie } from './dice';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { HAND_IDS, handOptions, hasPlayableHand } from './hands';
import { legalHandCombinations } from './selection';
import {
  activeDieLabel, assertDiceInventory, collectibleDieById, encounterDice, ownedDice, rosterDice, rosterDieLabel, rosterSlotOf,
  rosterTuple, storageTuple, syncActiveDiceProjection,
} from './inventory';
import { loadPersistedRun, RUN_STORAGE_KEY, savePersistedRun } from './persistence';
import { captureRollbackState, restoreRollbackState } from './rollback';
import { SeededRng } from './rng';
import { flameByType } from './flames';
import { createDieEffect } from './specialDice';
import type { BossType, GameState, Rank } from './types';

const constant = (value = .2) => ({ next: () => value });

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function equipCount(state: GameState, count: number): GameState {
  const ids = ownedDice(state).map(die => die.id);
  state.diceInventory.roster = rosterTuple(ids.map((id, index) => index < count ? id : null));
  const stored = ids.slice(count);
  state.diceInventory.storage = storageTuple([...stored, ...Array.from({ length: Math.max(0, 5 - stored.length) }, () => null)]);
  syncActiveDiceProjection(state);
  assertDiceInventory(state.diceInventory, state.encounterDice);
  return state;
}

function remapIds(state: GameState, ids: number[]): void {
  const remapped = rosterDice(state).map((die, index) => ({ ...die, id: ids[index] }));
  state.diceInventory.instances = Object.fromEntries(remapped.map(die => [die.id, die]));
  state.diceInventory.roster = rosterTuple(ids);
  state.diceInventory.nextDieId = Math.max(...ids) + 1;
  syncActiveDiceProjection(state);
  assertDiceInventory(state.diceInventory, state.encounterDice);
}

function startBoss(type: BossType, count: number): { state: GameState; resolver: Resolver } {
  const state = equipCount(newRun(`inventory-${type}-${count}`, constant()).state, count);
  state.round = ['juggler', 'capitalReturn', 'neglected', 'tightrope', 'crawler', 'magician', 'mugger'].includes(type) ? 3 : 6;
  state.bossSchedule[state.round] = type;
  const resolver = new Resolver(state, constant());
  resolver.startRound();
  return { state, resolver };
}

describe('collectible dice inventory', () => {
  it('starts with five stable Normal dice in fixed Roster slots and five empty Storage slots', () => {
    const state = newRun('inventory-start', constant()).state;
    expect(state.diceInventory.roster).toEqual([0, 1, 2, 3, 4]);
    expect(state.diceInventory.storage).toEqual([null, null, null, null, null]);
    expect(state.diceInventory.nextDieId).toBe(5);
    expect(ownedDice(state)).toHaveLength(5);
    expect(rosterDice(state)).toHaveLength(5);
    expect(ownedDice(state).every(die => die.effects.length === 0 && die.faces.length === 6)).toBe(true);
    expect(state.dice).toEqual(rosterDice(state));
  });

  it('detects duplicate, unknown, unlocated, malformed, and colliding identities', () => {
    const state = newRun('inventory-invariants', constant()).state;
    const duplicate = structuredClone(state.diceInventory);
    duplicate.storage[0] = duplicate.roster[0];
    expect(() => assertDiceInventory(duplicate)).toThrow(/more than one slot/);
    const unknown = structuredClone(state.diceInventory);
    unknown.roster[0] = 999;
    expect(() => assertDiceInventory(unknown)).toThrow(/unknown die/);
    const unlocated = structuredClone(state.diceInventory);
    unlocated.roster[0] = null;
    expect(() => assertDiceInventory(unlocated)).toThrow(/does not occupy/);
    const malformed = structuredClone(state.diceInventory);
    malformed.roster.pop();
    expect(() => assertDiceInventory(malformed)).toThrow(/exactly 5/);
    const malformedStorage = structuredClone(state.diceInventory);
    malformedStorage.storage.pop();
    expect(() => assertDiceInventory(malformedStorage)).toThrow(/exactly 5 Storage/);
    expect(() => assertDiceInventory(state.diceInventory, [{ ...createCursedDie(), id: 0,
      encounterId: 'test' }])).toThrow(/collides/);
  });

  it('resolves non-contiguous IDs by identity while retaining independent Roster order', () => {
    const state = newRun('inventory-non-contiguous', constant()).state;
    const ids = [105, 12, 999, 41, 240];
    remapIds(state, ids);
    expect(rosterDice(state).map(die => die.id)).toEqual(ids);
    expect(rosterSlotOf(state, 12)).toBe(1);
    expect(rosterDieLabel(state, 12)).toBe('D2');
    expect(activeDieLabel(state, 12)).toBe('D2');
    expect(rosterDieLabel(state, 777)).toBe('Die #777');
    expect(collectibleDieById(state, 999)?.id).toBe(999);
    [4, 4, 4, 2, 6].forEach((value, index) => { rosterDice(state)[index].value = value as Rank; });
    expect(legalHandCombinations(state, 'pair')).toEqual([[105, 12], [105, 999], [12, 999]]);
    state.phase = 'flameSelection'; state.shop = null;
    state.flameSelection = { offers: [{ id: 88, flame: 'minigun' }], acquired: false };
    const acquired = dispatch(state, { type: 'CHOOSE_FLAME', offerId: 88 }, constant()).state;
    expect(flameByType(acquired, 'minigun')).toMatchObject({ type: 'minigun', investedGold: 0 });
    acquired.gold = 10;
    acquired.shop!.stage = 'flames';
    const stoked = dispatch(acquired, { type: 'STOKE_FLAME', flameInstanceId: flameByType(acquired, 'minigun')!.instanceId, amount: 3 }, constant()).state;
    expect(flameByType(stoked, 'minigun')).toMatchObject({ type: 'minigun', investedGold: 3 });
  });

  it('rebuilds the active reference projection from authoritative Roster membership and order', () => {
    const state = newRun('inventory-projection', constant()).state;
    remapIds(state, [105, 12, 999, 41, 240]);
    state.diceInventory.roster = rosterTuple([999, null, 105, 240, 12]);
    state.diceInventory.storage = [41, null, null, null, null];
    syncActiveDiceProjection(state);
    expect(state.dice.map(die => die.id)).toEqual([999, 105, 240, 12]);
    expect(state.dice[0]).toBe(state.diceInventory.instances[999]);
    expect(state.dice.map(die => activeDieLabel(state, die.id))).toEqual(['D1', 'D2', 'D3', 'D4']);
    state.diceInventory.roster = rosterTuple([12, 999, 105, 240, null]);
    state.diceInventory.storage = [41, null, null, null, null];
    syncActiveDiceProjection(state);
    expect(state.dice.map(die => die.id)).toEqual([12, 999, 105, 240]);
    expect(state.dice.map(die => activeDieLabel(state, die.id))).toEqual(['D1', 'D2', 'D3', 'D4']);
  });

  it('keeps IDs stable through Rolls and Plays and resolves batches in Roster order', () => {
    const state = newRun('inventory-stable', constant()).state;
    const ids = [105, 12, 999, 41, 240];
    remapIds(state, ids);
    rosterDice(state).forEach(die => { die.value = 1; });
    state.target = 1_000_000n;
    state.stats.rounds.at(-1)!.target = state.target;
    const played = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [41] }, constant()).state;
    expect(rosterDice(played).map(die => die.id)).toEqual(ids);
    const scored = played.historyV2.find(event => event.kind === 'hand_scored');
    if (scored?.kind !== 'hand_scored') throw new Error('Expected hand history.');
    expect(scored.scoringDice[0]).toMatchObject({ dieId: 41, rosterSlot: 3, effects: [] });
    const rerolled = dispatch(played, { type: 'MANUAL_REROLL', dieIds: [240, 105, 999] }, constant());
    expect(rosterDice(rerolled.state).map(die => die.id)).toEqual(ids);
    expect(rerolled.events.find(event => event.type === 'DICE_REROLL_STARTED')?.dieIds).toEqual([105, 999, 240]);
  });

  it.each([1, 2, 3, 4, 5])('supports %i equipped dice through start, Play, reroll, clear, and Bust', count => {
    const state = equipCount(newRun(`reduced-${count}`, constant()).state, count);
    const resolver = new Resolver(state, constant());
    resolver.startRound();
    const activeIds = rosterDice(state).map(die => die.id);
    const opening = resolver.events.find(event => event.type === 'DICE_REROLL_STARTED');
    expect(opening?.dieIds).toEqual(activeIds);
    expect(state.dice).toHaveLength(count);
    rosterDice(state).forEach(die => { die.value = 1; });
    state.target = 1_000_000n;
    state.stats.rounds.at(-1)!.target = state.target;
    const played = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [activeIds[0]] }, constant()).state;
    expect(played.phase).toBe('round');
    const rerolled = dispatch(played, { type: 'MANUAL_REROLL', dieIds: [activeIds.at(-1)!] }, constant()).state;
    expect(rerolled.phase).toBe('round');
    rosterDice(rerolled).forEach(die => { die.value = 1; });
    expect(handOptions(rosterDice(rerolled), []).some(option => option.id === 'fiveKind')).toBe(count === 5);
    expect(hasPlayableHand(rosterDice(rerolled), [])).toBe(true);

    const clear = equipCount(newRun(`reduced-clear-${count}`, constant()).state, count);
    rosterDice(clear).forEach(die => { die.value = 1; });
    clear.target = 1n; clear.stats.rounds.at(-1)!.target = 1n;
    expect(dispatch(clear, { type: 'PLAY', hand: 'ones', dieIds: [rosterDice(clear)[0].id] }, constant()).state.phase)
      .toBe('roundSummary');

    const bust = equipCount(newRun(`reduced-bust-${count}`, constant()).state, count);
    bust.target = 1_000_000n; bust.stats.rounds.at(-1)!.target = bust.target;
    bust.consumed = [...HAND_IDS]; bust.scorecardCycleConsumed = [...HAND_IDS]; bust.manualRerollsRemaining = 0;
    new Resolver(bust, constant()).evaluate();
    expect(bust.phase).toBe('shop');
  });
});

describe('Storage isolation and encounter-managed dice', () => {
  it('does not consume RNG or change active results when an otherwise-empty Storage slot is occupied', () => {
    const empty = newRun('storage-rng-empty', constant()).state;
    const occupied = structuredClone(empty);
    const stored = createCollectibleDie(50);
    stored.value = 6;
    occupied.diceInventory.instances[stored.id] = stored;
    occupied.diceInventory.storage[0] = stored.id;
    occupied.diceInventory.nextDieId = 51;
    syncActiveDiceProjection(occupied);
    const emptyResolver = new Resolver(empty, new SeededRng(12345));
    const occupiedResolver = new Resolver(occupied, new SeededRng(12345));
    emptyResolver.startRound();
    occupiedResolver.startRound();
    expect(rosterDice(occupied).map(die => die.value)).toEqual(rosterDice(empty).map(die => die.value));
    expect(collectibleDieById(occupied, 50)?.value).toBe(6);
    expect(emptyResolver.rngStateAfterResolution).toBe(occupiedResolver.rngStateAfterResolution);
  });

  it('keeps Storage dice out of Rolls, scoring, Juggler rerolls, and whole-die effects', () => {
    const { state } = startBoss('juggler', 4);
    const storedId = state.diceInventory.storage.find((id): id is number => id !== null)!;
    const stored = collectibleDieById(state, storedId)!;
    stored.value = 6;
    stored.effects = [createDieEffect(stored.id, 'golden', 3)];
    rosterDice(state).forEach(die => { die.value = 1; });
    state.target = 1_000_000n; state.stats.rounds.at(-1)!.target = state.target;
    const before = structuredClone(stored);
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [rosterDice(state)[0].id] }, constant());
    const juggler = result.events.find(event => event.type === 'DICE_REROLL_STARTED' && event.message.includes('Juggler'));
    expect(juggler?.dieIds).toEqual(rosterDice(result.state).map(die => die.id));
    expect(juggler?.dieIds).not.toContain(storedId);
    expect(collectibleDieById(result.state, storedId)).toEqual(before);
    expect(result.state.gold).toBe(state.gold);
    expect(result.state.dice.map(die => die.id)).not.toContain(storedId);
  });

  it('places Hexer dice in a collision-proof encounter namespace without changing ownership', () => {
    const { state } = startBoss('hexer', 3);
    expect(state.encounterDice).toHaveLength(1);
    expect(state.encounterDice[0]).toMatchObject({ id: -1, owner: 'boss', encounterId: 'hexer:cursed' });
    expect(encounterDice(state)).toHaveLength(4);
    expect(ownedDice(state)).toHaveLength(5);
    expect(state.diceInventory.roster).toHaveLength(5);
    expect(state.diceInventory.storage).not.toContain(-1);
    expect(Object.hasOwn(state.diceInventory.instances, -1)).toBe(false);
    const started = [...state.historyV2].reverse().find(event => event.kind === 'round_attempt_started');
    if (started?.kind !== 'round_attempt_started') throw new Error('Expected round history.');
    expect(started.dice.at(-1)).toMatchObject({ dieId: -1, owner: 'boss', rosterSlot: null,
      encounterId: 'hexer:cursed' });
  });
});

describe('reduced-Roster boss safety', () => {
  it.each(ALL_BOSS_TYPES)('%s starts safely for every Roster size without involving Storage', type => {
    for (const count of [1, 2, 3, 4, 5]) {
      const { state } = startBoss(type, count);
      const storedIds = new Set(state.diceInventory.storage.filter((id): id is number => id !== null));
      expect(state.dice.some(die => storedIds.has(die.id))).toBe(false);
      const expectedActive = type === 'warden' ? 0 : type === 'hexer' ? count + 1
        : type === 'magician' && count > 1 ? count - 1 : count;
      expect(activeEncounterDice(state)).toHaveLength(expectedActive);
    }
  });

  it.each([1, 2, 3, 4, 5])('derives Warden reinforcements from %i equipped dice', count => {
    const { state, resolver } = startBoss('warden', count);
    if (state.boss?.type !== 'warden') throw new Error('Warden fixture failed.');
    const ids = rosterDice(state).map(die => die.id);
    expect(state.boss.encounterDieIds).toEqual(ids);
    expect(state.boss.unlockCosts).toHaveLength(count - 1);
    expect(activeEncounterDice(state)).toHaveLength(0);
    resolver.unlockWardenDie(ids[0]);
    expect(activeEncounterDice(state).map(die => die.id)).toEqual([ids[0]]);
    if (count === 1) expect(state.boss.nextUnlockTarget).toBeNull();
  });

  it('does not let Magician remove the final equipped die', () => {
    const { state } = startBoss('magician', 1);
    expect(state.boss).toMatchObject({ type: 'magician', missingDieId: null, returned: true });
    expect(activeEncounterDice(state)).toHaveLength(1);
  });

  it.each([1, 2, 3, 4, 5])('keeps Caller, Fly, and Neglected targets attainable with %i dice', count => {
    const caller = startBoss('caller', count).state;
    if (caller.boss?.type !== 'caller') throw new Error('Caller fixture failed.');
    expect(handIsPhysicallyAttainable(caller.boss.calledHand, count)).toBe(true);

    const fly = startBoss('fly', count).state;
    if (fly.boss?.type !== 'fly') throw new Error('Fly fixture failed.');
    if (fly.boss.flyHand === null) expect(count).toBe(1);
    else expect(handIsPhysicallyAttainable(fly.boss.flyHand, count)).toBe(true);

    const neglected = startBoss('neglected', count).state;
    if (neglected.boss?.type !== 'neglected') throw new Error('Neglected fixture failed.');
    const neglectedHands = neglected.boss.neglectedHands;
    const attainable = HAND_IDS.filter(hand => handIsPhysicallyAttainable(hand, count));
    expect(neglectedHands.length).toBeLessThan(attainable.length);
    expect(attainable.some(hand => !neglectedHands.includes(hand))).toBe(true);
  });

  it.each(['snakeEyes', 'infected'] as const)('%s mutates only equipped dice', type => {
    const { state, resolver } = startBoss(type, 4);
    const storedId = state.diceInventory.storage.find((id): id is number => id !== null)!;
    const storedBefore = structuredClone(collectibleDieById(state, storedId));
    rosterDice(state).forEach(die => { die.value = 1; });
    state.target = 1_000_000n; state.stats.rounds.at(-1)!.target = state.target;
    resolver.play('ones', [rosterDice(state)[0].id]);
    expect(collectibleDieById(state, storedId)).toEqual(storedBefore);
  });
});

describe('fixed Storage, persistence, and rollback', () => {
  it('keeps exactly five Storage slots through Chapter clear and reward flow', () => {
    const { state, resolver } = startBoss('caller', 5);
    expect(state.round).toBe(6);
    state.score = state.target;
    state.stats.rounds.at(-1)!.finalScore = state.score;
    resolver.evaluate();
    expect(state.phase).toBe('roundSummary');
    expect(state.diceInventory.storage).toHaveLength(5);
    resolver.evaluate();
    expect(state.diceInventory.storage).toHaveLength(5);
    resolver.continueRoundSummary();
    expect(state.phase).toBe('flameSelection');
    expect(state.diceInventory.storage).toHaveLength(5);
  });

  it('round-trips exact slot layout, IDs, allocator state, and rollback state', () => {
    const state = newRun('inventory-persistence', constant()).state;
    remapIds(state, [12, 41, 105, 240, 999]);
    state.diceInventory.roster = rosterTuple([12, null, 105, 240, 999]);
    state.diceInventory.storage = [null, 41, null, null, null];
    state.diceInventory.nextDieId = 1_500;
    syncActiveDiceProjection(state);
    const rollback = captureRollbackState(state);
    state.diceInventory.roster = rosterTuple([12, 41, 105, 240, 999]);
    state.diceInventory.storage = [null, null, null, null, null];
    syncActiveDiceProjection(state);
    restoreRollbackState(state, rollback);
    expect(state.diceInventory).toEqual(rollback.diceInventory);
    expect(state.dice.map(die => die.id)).toEqual([12, 105, 240, 999]);
    state.roundCheckpoint = null;

    const storage = new MemoryStorage();
    expect(savePersistedRun(storage, state)).toBe(true);
    expect(storage.values.get(RUN_STORAGE_KEY)).toBeTruthy();
    const loaded = loadPersistedRun(storage, state.seed)!;
    expect(loaded.diceInventory).toEqual(state.diceInventory);
    expect(loaded.dice.map(die => die.id)).toEqual([12, 105, 240, 999]);
    expect(loaded.diceInventory.nextDieId).toBe(1_500);
  });
});
