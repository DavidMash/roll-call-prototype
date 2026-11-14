import { describe, expect, it } from 'vitest';
import { activeEncounterDice, bossTypeForRound } from './bosses';
import { createCollectibleDie } from './dice';
import { Resolver } from './effects';
import { availableShopStages, dispatch, newRun, validateAction } from './engine';
import { availableHandIds, BONUS_LOWER_HAND_IDS, BONUS_UPPER_HAND_IDS, HANDS } from './hands';
import { applyStructuralInfernoReward } from './infernoRewards';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { loadPersistedRun, RUN_STORAGE_KEY, savePersistedRun } from './persistence';
import { renderRunHistoryV2Event } from './runHistoryV2Renderer';
import { createDieEffect, resetDieRoundState } from './specialDice';
import type { GameState, HandId, RandomSource, Rank } from './types';
import type { BossStateChangedEvent } from './runHistoryV2';

const REPRO_SEED = 'roll-jxczn1-sqole7';
const constant = (value = 0): RandomSource => ({ next: () => value });
const bonusHands = [...BONUS_UPPER_HAND_IDS, ...BONUS_LOWER_HAND_IDS];
const upperHands = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const;

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function equipRosterSize(state: GameState, count: 5 | 6 | 7): void {
  if (count >= 6) applyStructuralInfernoReward(state, 'expandedRoster');
  if (count >= 7) applyStructuralInfernoReward(state, 'expandedRoster2');
  while (state.diceInventory.roster.filter(id => id !== null).length < count) {
    const die = createCollectibleDie(state.diceInventory.nextDieId++);
    state.diceInventory.instances[die.id] = die;
    const slot = state.diceInventory.roster.findIndex(id => id === null);
    state.diceInventory.roster[slot] = die.id;
  }
  syncActiveDiceProjection(state);
}

function startWarden(count: 5 | 6 | 7 = 5, unlockedHands: HandId[] = []): { state: GameState; resolver: Resolver } {
  const state = newRun(REPRO_SEED, constant()).state;
  equipRosterSize(state, count);
  state.round = 84;
  state.roundAttemptNumber = 1;
  state.infernoRewards.unlockedHands = [...unlockedHands];
  for (const hand of unlockedHands) state.handLevels[hand] = hand === 'miniStraight' ? 27 : 9;
  const resolver = new Resolver(state, constant());
  resolver.startRound();
  state.target = 10n ** 30n;
  state.stats.rounds.at(-1)!.target = state.target;
  return { state, resolver };
}

function chooseInitial(state: GameState, resolver: Resolver, id = rosterDice(state).at(-1)!.id): number {
  resolver.unlockWardenDie(id);
  return id;
}

function manualUpperPlay(state: GameState, resolver: Resolver, index: number): void {
  const hand = upperHands[index];
  const rank = (index + 1) as Rank;
  const die = activeEncounterDice(state)[0];
  die.value = rank;
  resolver.play(hand, [die.id]);
}

describe('Warden Hand-release progression', () => {
  it.each([[5, 4], [6, 5], [7, 6]] as const)('%i-die Roster releases all dice after %i manual Plays', (count, releases) => {
    const { state, resolver } = startWarden(count);
    const initial = chooseInitial(state, resolver);
    const order = rosterDice(state).map(die => die.id).filter(id => id !== initial);
    for (let index = 0; index < releases; index++) {
      const before = activeEncounterDice(state).length;
      manualUpperPlay(state, resolver, index);
      expect(activeEncounterDice(state)).toHaveLength(before + 1);
      expect(state.boss?.type === 'warden' ? state.boss.activeDieIds.at(-1) : null).toBe(order[index]);
    }
    expect(activeEncounterDice(state)).toHaveLength(count);
  });

  it('uses deterministic opening selection and stable Roster-slot release order', () => {
    const first = startWarden(7); const second = startWarden(7);
    expect(first.state.dice.map(die => die.value)).toEqual(second.state.dice.map(die => die.value));
    const chosen = chooseInitial(first.state, first.resolver);
    chooseInitial(second.state, second.resolver, chosen);
    for (let index = 0; index < 6; index++) {
      manualUpperPlay(first.state, first.resolver, index);
      manualUpperPlay(second.state, second.resolver, index);
    }
    expect(first.state.boss).toEqual(second.state.boss);
    expect(first.state.boss?.type === 'warden' ? first.state.boss.activeDieIds : []).toEqual([
      chosen, ...rosterDice(first.state).map(die => die.id).filter(id => id !== chosen),
    ]);
  });

  it('does not release for a generated Free Play', () => {
    const { state, resolver } = startWarden();
    const initial = chooseInitial(state, resolver);
    state.dice.find(die => die.id === initial)!.value = 1;
    resolver.play('ones', [initial], 'freePlay');
    expect(activeEncounterDice(state).map(die => die.id)).toEqual([initial]);
  });

  it('releases once for one manual Play with multiple Double Time Score occurrences', () => {
    const { state, resolver } = startWarden();
    const initial = chooseInitial(state, resolver);
    const die = rosterDice(state).find(item => item.id === initial)!;
    die.effects = [createDieEffect(die.id, 'doubleTime', 4)];
    state.dieRoundState = resetDieRoundState(rosterDice(state));
    die.value = 1;
    resolver.play('ones', [initial]);
    const hand = state.historyV2.find(event => event.kind === 'hand_scored');
    expect(hand?.kind === 'hand_scored' ? hand.scoreOccurrences.length : 0).toBeGreaterThan(1);
    expect(activeEncounterDice(state)).toHaveLength(2);
    expect(state.stats.wardenEvents.filter(event => event.kind === 'release')).toHaveLength(1);
  });

  it('releases after the full manual Play resolves and the new die only joins subsequent actions', () => {
    const { state, resolver } = startWarden();
    const initial = chooseInitial(state, resolver);
    state.dice.find(die => die.id === initial)!.value = 1;
    resolver.play('ones', [initial]);
    const releaseIndex = resolver.events.findIndex(event => event.type === 'WARDEN_DIE_RELEASED' && event.bossState === 'manual_play');
    const scoreIndex = resolver.events.findIndex(event => event.type === 'HAND_CONSUMED');
    const postHandRollIndex = resolver.events.reduce((last, event, index) => event.type === 'DICE_REROLL_STARTED'
      && event.rollReason === 'post_hand' ? index : last, -1);
    expect(releaseIndex).toBeGreaterThan(scoreIndex);
    expect(releaseIndex).toBeGreaterThan(postHandRollIndex);
    const scored = state.historyV2.find(event => event.kind === 'hand_scored');
    expect(scored?.kind === 'hand_scored' ? scored.selectedDice : []).toEqual([initial]);
    const released = activeEncounterDice(state)[1];
    released.value = 2;
    expect(() => resolver.play('twos', [released.id])).not.toThrow();
  });

  it('clears normally before every die is released', () => {
    const { state, resolver } = startWarden();
    const initial = chooseInitial(state, resolver);
    state.target = 1n; state.stats.rounds.at(-1)!.target = 1n;
    state.dice.find(die => die.id === initial)!.value = 1;
    resolver.play('ones', [initial]);
    expect(state.phase).toBe('roundSummary');
    expect(state.boss?.type === 'warden' ? state.boss.activeDieIds : []).toHaveLength(2);
  });

  it('keeps locked dice out of gameplay until their deterministic release', () => {
    const { state, resolver } = startWarden();
    const initial = chooseInitial(state, resolver);
    const locked = rosterDice(state).find(die => die.id !== initial)!;
    expect(activeEncounterDice(state).some(die => die.id === locked.id)).toBe(false);
    expect(validateAction(state, { type: 'PLAY', hand: 'ones', dieIds: [locked.id] })).not.toBeNull();
    state.dice.find(die => die.id === initial)!.value = 1;
    resolver.play('ones', [initial]);
    expect(activeEncounterDice(state).some(die => die.id === locked.id)).toBe(true);
  });
});

describe('Warden compatibility and independence from Hand taxonomy', () => {
  it.each([[['miniStraight']], [['chance']], [['miniStraight', 'chance', 'odds', 'evens', 'oddStraight', 'evenStraight']]] as [HandId[]][])(
    'starts Round 84 with bonus Hands %j', hands => {
      expect(bossTypeForRound(REPRO_SEED, 84)).toBe('warden');
      expect(() => startWarden(5, hands)).not.toThrow();
    },
  );

  it('starts with every currently unlockable bonus Hand and ignores arbitrary future Hand group shapes', () => {
    const groups = HANDS.pair.groups;
    try {
      HANDS.pair.groups = undefined;
      expect(() => startWarden(7, bonusHands)).not.toThrow();
    } finally { HANDS.pair.groups = groups; }
  });

  it('round-trips mid-Warden release state through persistence', () => {
    const { state, resolver } = startWarden(6, ['miniStraight', 'chance']);
    const initial = chooseInitial(state, resolver);
    manualUpperPlay(state, resolver, 0);
    const storage = new MemoryStorage();
    expect(savePersistedRun(storage, state)).toBe(true);
    const loaded = loadPersistedRun(storage, REPRO_SEED)!;
    expect(loaded.boss).toEqual(state.boss);
    expect(loaded.boss?.type === 'warden' ? loaded.boss.activeDieIds : []).toEqual([
      initial, rosterDice(state).find(die => die.id !== initial)!.id,
    ]);
  });

  it('migrates a legacy active-Warden save from its current active and locked dice', () => {
    const { state, resolver } = startWarden();
    chooseInitial(state, resolver, 2);
    manualUpperPlay(state, resolver, 0);
    const storage = new MemoryStorage();
    savePersistedRun(storage, state);
    const payload = JSON.parse(storage.values.get(RUN_STORAGE_KEY)!) as { version: number; state: Record<string, unknown> };
    payload.version = 30;
    const boss = payload.state.boss as Record<string, unknown>;
    Object.assign(boss, { pendingReinforcements: 1, nextUnlockTarget: '999', unlockCosts: ['5'], unlockTargets: ['5'] });
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify(payload));
    const loaded = loadPersistedRun(storage, REPRO_SEED)!;
    expect(loaded.boss).toEqual({ type: 'warden', encounterDieIds: [0, 1, 2, 3, 4], activeDieIds: [2, 0], startingDieId: 2 });
    expect(loaded.boss).not.toHaveProperty('nextUnlockTarget');
  });

  it('restores a fresh Warden on Bust rollback/retry without corrupting release state', () => {
    const { state, resolver } = startWarden(5, ['miniStraight']);
    chooseInitial(state, resolver);
    state.consumed = availableHandIds(state);
    state.manualRerollsRemaining = 0;
    state.specialOfferEffects.carePackageRerolls = 0;
    resolver.evaluate();
    expect(state.phase).toBe('shop');
    state.shop!.stage = availableShopStages(state).at(-1)!;
    state.shop!.exitUnlocked = true;
    const retried = dispatch(state, { type: 'RETRY_ROUND' }, constant()).state;
    expect(retried.roundAttemptNumber).toBe(2);
    expect(retried.boss).toMatchObject({ type: 'warden', activeDieIds: [], startingDieId: null });
    expect(activeEncounterDice(retried)).toEqual([]);
  });

  it('keeps old Warden threshold history readable', () => {
    const event: BossStateChangedEvent = { seq: 1, kind: 'boss_state_changed', round: 30, attempt: 1,
      actionId: 1, timelineId: 0, boss: 'warden', change: 'warden_target', dieIds: [], amount: 40n };
    expect(renderRunHistoryV2Event(event)).toContain('Warden');
  });
});
