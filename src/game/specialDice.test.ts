import { describe, expect, it } from 'vitest';
import { activeFace, createCollectibleDie } from './dice';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { combinationsForHand, planQualification } from './hands';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { loadPersistedRun, RUN_STORAGE_KEY, savePersistedRun } from './persistence';
import { captureRollbackState, restoreRollbackState } from './rollback';
import { resetDieRoundState, SPECIAL_DICE, SPECIAL_DIE_TYPES } from './specialDice';
import type { DieType, GameState, RandomSource, Rank } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });
function game(): GameState {
  const state = newRun('special-dice', constant(0)).state;
  state.target = 1_000_000n;
  state.consumed = [];
  state.scorecardCycleConsumed = [];
  return state;
}
function makeSpecial(state: GameState, id: number, type: DieType, level = 1) {
  const die = state.diceInventory.instances[id];
  die.type = type;
  die.level = level;
  die.vintageAppreciation = 0;
  die.weightedFace = 6;
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  syncActiveDiceProjection(state);
  return die;
}
function values(state: GameState, ranks: Rank[]) {
  ranks.forEach((rank, index) => { state.dice[index].value = rank; });
}
function score(state: GameState, hand: Parameters<Resolver['play']>[0], ids: number[], random = 0.99) {
  new Resolver(state, constant(random)).play(hand, ids);
}

describe('whole-die registry and persistent/runtime state', () => {
  it('registers Normal and every approved V1 die with dice-specific rarity', () => {
    expect(SPECIAL_DIE_TYPES).toHaveLength(24);
    expect(SPECIAL_DICE.normal.rarity).toBeNull();
    expect(SPECIAL_DICE.magic.rarity).toBe('legendary');
    expect(SPECIAL_DICE.conjoined.rarity).toBe('legendary');
    expect(SPECIAL_DICE.bonus.rarity).toBe('common');
    expect(SPECIAL_DICE.hitchhiker.rarity).toBe('uncommon');
    expect(SPECIAL_DICE.tank.rarity).toBe('rare');
    expect(SPECIAL_DIE_TYPES).not.toContain('boomerang');
  });

  it('constructs every special at Lv1 and arbitrary higher levels while keeping Normal at Lv1', () => {
    for (const [index, type] of SPECIAL_DIE_TYPES.filter(type => type !== 'normal').entries()) {
      expect(createCollectibleDie(100 + index, type)).toMatchObject({ type, level: 1 });
      expect(createCollectibleDie(200 + index, type, 9)).toMatchObject({ type, level: 9 });
    }
    expect(() => createCollectibleDie(999, 'normal', 2)).toThrow(/Normal dice remain level 1/);
  });

  it('scales all Invocation-backed dice without a universal cap', () => {
    const invocationTypes = SPECIAL_DIE_TYPES.filter(type => SPECIAL_DICE[type].invocationScale === 'level');
    const state = game();
    invocationTypes.forEach((type, index) => {
      const die = state.diceInventory.instances[index % 5];
      die.type = type; die.level = 37;
      const runtime = resetDieRoundState([die])[die.id];
      expect(runtime.invocationsRemaining, type).toBe(37);
    });
  });

  it('initializes level-scaled Invocations and resets all Round-local state each attempt', () => {
    const state = game();
    makeSpecial(state, 0, 'magic', 3);
    state.dieRoundState[0].invocationsRemaining = 1;
    state.dieRoundState[0].magicArmedFace = 4;
    state.dieRoundState[0].temporaryPips = 50;
    state.dieRoundState[0].goldenGoldEarned = 3;
    state.dieRoundState[0].clockworkRolls = 6;
    state.dieRoundState[0].furnaceUnits = 5;
    state.dieRoundState[0].freePlayUsesByFace[4] = 2;
    new Resolver(state, constant(0)).startRound();
    expect(state.dieRoundState[0]).toMatchObject({ invocationsRemaining: 3, magicArmedFace: null,
      temporaryPips: 0, goldenGoldEarned: 0, clockworkRolls: 0, furnaceUnits: 0 });
    expect(state.dieRoundState[0].freePlayUsesByFace[4]).toBe(0);
  });

  it('round-trips spent Invocations and persistent Vintage appreciation', () => {
    const state = game();
    const die = makeSpecial(state, 0, 'vintage', 2);
    values(state, [1, 2, 3, 4, 5]);
    score(state, 'ones', [0]);
    state.dieRoundState[0].invocationsRemaining = 0;
    const valuesByKey = new Map<string, string>();
    const storage = { getItem: (key: string) => valuesByKey.get(key) ?? null,
      setItem: (key: string, value: string) => { valuesByKey.set(key, value); } };
    expect(savePersistedRun(storage, state)).toBe(true);
    expect(valuesByKey.has(RUN_STORAGE_KEY)).toBe(true);
    const loaded = loadPersistedRun(storage, state.seed)!;
    expect(loaded.diceInventory.instances[0].vintageAppreciation).toBe(die.vintageAppreciation);
    expect(loaded.dieRoundState[0].invocationsRemaining).toBe(0);
  });

  it('restores exact persistent and Round-local special-die state from rollback', () => {
    const state = game(); const die = makeSpecial(state, 0, 'magic', 3);
    die.vintageAppreciation = 0;
    state.dieRoundState[0].invocationsRemaining = 2;
    state.dieRoundState[0].magicArmedFace = 4;
    const checkpoint = captureRollbackState(state);
    state.dieRoundState[0].invocationsRemaining = 0;
    state.dieRoundState[0].magicArmedFace = null;
    restoreRollbackState(state, checkpoint);
    expect(state.dieRoundState[0]).toMatchObject({ invocationsRemaining: 2, magicArmedFace: 4 });
    expect(state.diceInventory.instances[0]).toMatchObject({ type: 'magic', level: 3 });
  });
});

describe('whole-die Score effects', () => {
  it('scales Bonus at Lv1 and higher levels', () => {
    const lv1 = game(); values(lv1, [1, 2, 3, 4, 5]); makeSpecial(lv1, 0, 'bonus'); score(lv1, 'ones', [0]);
    const lv3 = game(); values(lv3, [1, 2, 3, 4, 5]); makeSpecial(lv3, 0, 'bonus', 3); score(lv3, 'ones', [0]);
    expect(lv3.stats.handScores[0].pips - lv1.stats.handScores[0].pips).toBe(20);
  });

  it('re-applies whole-die Bonus on a genuine Double Time Score occurrence', () => {
    const state = game(); values(state, [1, 2, 3, 4, 5]); const die = makeSpecial(state, 0, 'bonus', 2);
    activeFace(die).enhancements.doubleTime = 20;
    score(state, 'ones', [0], 0);
    expect(state.stats.handScores[0].pips).toBe(7 + 21 + 21);
  });

  it('applies Workout only to subsequent Score occurrences and scales growth', () => {
    const state = game(); values(state, [1, 2, 3, 4, 5]); const die = makeSpecial(state, 0, 'workout', 2);
    activeFace(die).enhancements.doubleTime = 20;
    score(state, 'ones', [0], 0);
    expect(state.dieRoundState[0].temporaryPips).toBe(8);
    expect(state.stats.handScores[0].pips).toBe(7 + 1 + (1 + 4));
  });

  it('persists level-scaled Vintage appreciation through additional Scores', () => {
    const state = game(); values(state, [1, 2, 3, 4, 5]); const die = makeSpecial(state, 0, 'vintage', 3);
    activeFace(die).enhancements.doubleTime = 20;
    score(state, 'ones', [0], 0);
    expect(die.vintageAppreciation).toBe(6);
  });

  it('pays Golden for genuine additional Scores up to its per-Round cap', () => {
    const state = game(); values(state, [1, 2, 3, 4, 5]); const die = makeSpecial(state, 0, 'golden');
    activeFace(die).enhancements.doubleTime = 20;
    score(state, 'ones', [0], 0);
    values(state, [1, 2, 3, 4, 5]); score(state, 'ones', [0], 0);
    expect(state.dieRoundState[0].goldenGoldEarned).toBe(3);
    expect(state.stats.goldBySource.golden).toBe(3);
  });

  it('adds Hitchhiker as a non-selected scorer and spends one Invocation', () => {
    const state = game(); values(state, [1, 1, 3, 4, 5]); makeSpecial(state, 1, 'hitchhiker', 2);
    score(state, 'ones', [0]);
    expect(state.stats.handScores[0].dieIds).toEqual([0, 1]);
    expect(state.dieRoundState[1].invocationsRemaining).toBe(1);
    const hand = state.historyV2.find(event => event.kind === 'hand_scored');
    expect(hand?.kind === 'hand_scored' && hand.selectedDice).toEqual([0]);
  });

  it('compounds multiple Team Players over every other selected die contribution', () => {
    const one = game(); values(one, [1, 1, 1, 4, 5]); makeSpecial(one, 0, 'teamPlayer'); makeSpecial(one, 1, 'bonus');
    score(one, 'threeKind', [0, 1, 2]);
    expect(one.stats.handScores[0].pips).toBeGreaterThan(0);
    const two = game(); values(two, [1, 1, 1, 4, 5]); makeSpecial(two, 0, 'teamPlayer'); makeSpecial(two, 1, 'teamPlayer', 2);
    score(two, 'threeKind', [0, 1, 2]);
    const base = 10 + 3; // Three-kind hand base plus three printed pips.
    expect(two.stats.handScores[0].pips).toBe(base + 2 + 1 + 5); // TP extras: D0 x3, D1 x2, D2 x6.
  });

  it('Lone Wolf creates level + 1 total Score occurrences without repeating hand base', () => {
    const state = game(); values(state, [1, 2, 3, 4, 5]); makeSpecial(state, 0, 'loneWolf', 3);
    score(state, 'ones', [0]);
    expect(state.stats.handScores[0].pips).toBe(7 + 4);
    const hand = [...state.historyV2].reverse().find(event => event.kind === 'hand_scored');
    expect(hand?.kind === 'hand_scored' ? hand.pipsContributions.filter(item => item.dieId === 0) : []).toHaveLength(4);
  });

  it('Double Time uses guaranteed quarters, one remainder check, and suppresses only itself', () => {
    const state = game(); values(state, [1, 2, 3, 4, 5]); const die = makeSpecial(state, 0, 'doubleTime', 5);
    activeFace(die).enhancements.golden = 1;
    score(state, 'ones', [0], 0);
    expect(state.stats.handScores[0].pips).toBe(7 + 3);
    expect(state.stats.goldBySource.golden).toBe(3);
    const hand = [...state.historyV2].reverse().find(event => event.kind === 'hand_scored');
    const activations = hand?.kind === 'hand_scored'
      ? hand.sideEffects.filter(effect => effect.type === 'special_die' && effect.dieType === 'doubleTime') : [];
    expect(activations).toHaveLength(1);
  });

  it('keeps carrier-Flame hand resolution intact around generated Score occurrences', () => {
    const state = game(); values(state, [1, 2, 3, 4, 5]); const die = makeSpecial(state, 0, 'doubleTime', 4);
    die.flame = { id: 'minigun', investedGold: 100 };
    score(state, 'ones', [0]);
    expect(state.stats.handScores[0]).toMatchObject({ pips: 9, xMult: 5 });
  });

  it('pays each scoring Jackpot die once on the winning Play', () => {
    const state = game(); values(state, [6, 2, 3, 4, 5]); makeSpecial(state, 0, 'jackpot', 2); state.target = 1n;
    score(state, 'sixes', [0]);
    expect(state.stats.goldBySource.jackpot).toBe(6);
  });

  it('feeds Furnace authoritatively and decays exactly one unit per Score', () => {
    let state = game(); state.gold = 10; values(state, [1, 2, 3, 4, 5]); makeSpecial(state, 0, 'furnace', 2);
    const gold = state.gold;
    state = dispatch(state, { type: 'FEED_FURNACE', dieId: 0, amount: 3 }, constant()).state;
    expect(state.gold).toBe(gold - 3);
    score(state, 'ones', [0]);
    expect(state.stats.handScores[0].pips).toBe(7 + 1 + 18);
    expect(state.dieRoundState[0].furnaceUnits).toBe(2);
  });

  it('Sustainable spends only when a hand would be consumed', () => {
    const state = game(); values(state, [1, 2, 3, 4, 5]); makeSpecial(state, 0, 'sustainable', 2);
    new Resolver(state, constant()).play('ones', [0], 'freePlay');
    expect(state.dieRoundState[0].invocationsRemaining).toBe(2);
    score(state, 'ones', [0]);
    expect(state.dieRoundState[0].invocationsRemaining).toBe(1);
    expect(state.consumed).not.toContain('ones');
  });
});

describe('whole-die Qualification effects', () => {
  it('previews Mirror without spending and spends exactly the committed claim', () => {
    const state = game(); values(state, [1, 2, 3, 4, 5]); makeSpecial(state, 0, 'mirror', 2);
    const preview = planQualification(state.dice, 'pair', [0, 1], { roundState: state.dieRoundState });
    expect(preview).toMatchObject({ legal: true, ambiguousClaims: false,
      resourceClaims: [{ dieId: 0, effect: 'mirror', amount: 1 }] });
    expect(state.dieRoundState[0].invocationsRemaining).toBe(2);
    new Resolver(state, constant()).play('pair', [0, 1], 'manual', null, preview.resourceClaims);
    expect(state.dieRoundState[0].invocationsRemaining).toBe(1);
    state.dieRoundState[0].invocationsRemaining = 0;
    values(state, [1, 2, 3, 4, 5]);
    expect(combinationsForHand(state.dice, 'pair', state.dieRoundState)).not.toContainEqual([0, 1]);
  });

  it('supports Missing Link and Conjoined as qualification-only claims at higher levels', () => {
    const link = game(); values(link, [1, 2, 2, 4, 5]); makeSpecial(link, 2, 'missingLink', 3);
    const linkPlan = planQualification(link.dice, 'smallStraight', [0, 1, 2, 3], { roundState: link.dieRoundState });
    expect(linkPlan.legal).toBe(true);
    expect(linkPlan.resourceClaims[0]).toMatchObject({ dieId: 2, effect: 'missingLink' });
    const joined = game(); values(joined, [3, 3, 5, 4, 5]); makeSpecial(joined, 0, 'conjoined', 2);
    const joinedPlan = planQualification(joined.dice, 'threeKind', [0, 1], { roundState: joined.dieRoundState });
    expect(joinedPlan.legal).toBe(true);
    expect(joinedPlan.resourceClaims[0]).toMatchObject({ dieId: 0, effect: 'conjoined' });
  });

  it('requires an explicit claim when multiple wildcard Invocations can qualify', () => {
    const state = game(); values(state, [1, 2, 3, 4, 5]); makeSpecial(state, 0, 'mirror'); makeSpecial(state, 1, 'mirror');
    const preview = planQualification(state.dice, 'pair', [0, 1], { roundState: state.dieRoundState });
    expect(preview).toMatchObject({ legal: true, ambiguousClaims: true });
    expect(preview.claimOptions).toHaveLength(2);
    const result = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant());
    expect(result.error).toMatch(/Choose which qualification die/);
    const committed = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1],
      qualificationClaims: [{ dieId: 1, effect: 'mirror' }] }, constant()).state;
    expect(committed.dieRoundState[0].invocationsRemaining).toBe(1);
    expect(committed.dieRoundState[1].invocationsRemaining).toBe(0);
  });
});

describe('whole-die Roll controllers, reactions, and commands', () => {
  it('Weighted controls the initial Roll and level-scaled subsequent Rolls', () => {
    const state = game(); const die = makeSpecial(state, 0, 'weighted', 2); die.weightedFace = 5;
    new Resolver(state, constant(0)).startRound();
    expect(state.diceInventory.instances[0].value).toBe(5);
    expect(state.dieRoundState[0].invocationsRemaining).toBe(1);
    new Resolver(state, constant(0)).rollBatch([0], 'test', 'gameplay', false, 'manual');
    expect(state.diceInventory.instances[0].value).toBe(5);
    expect(state.dieRoundState[0].invocationsRemaining).toBe(0);
  });

  it('Clockwork advances after the initial Roll and exhausts at 3 per level', () => {
    const state = game(); values(state, [4, 2, 3, 4, 5]); makeSpecial(state, 0, 'clockwork');
    const resolver = new Resolver(state, constant(0));
    for (let index = 0; index < 3; index++) resolver.rollBatch([0], 'clock', 'gameplay', false, 'manual');
    expect(state.diceInventory.instances[0].value).toBe(1);
    expect(state.dieRoundState[0].clockworkRolls).toBe(3);
    resolver.rollBatch([0], 'random', 'gameplay', false, 'manual');
    expect(state.diceInventory.instances[0].value).toBe(2);
  });

  it('Magnetic claims by Roster order, skips rolling magnets, and respects locked Magic', () => {
    let state = game(); values(state, [3, 5, 1, 4, 6]); makeSpecial(state, 0, 'magnetic'); makeSpecial(state, 1, 'magnetic');
    new Resolver(state, constant(0)).rollBatch([2], 'magnetic', 'gameplay', false, 'manual');
    expect(state.diceInventory.instances[2].value).toBe(3);
    expect(state.dieRoundState[0].invocationsRemaining).toBe(0);
    expect(state.dieRoundState[1].invocationsRemaining).toBe(1);
    state = game(); values(state, [3, 1, 2, 4, 5]); makeSpecial(state, 0, 'magnetic'); makeSpecial(state, 1, 'magic');
    state = dispatch(state, { type: 'ARM_MAGIC', dieId: 1, face: 6 }, constant()).state;
    new Resolver(state, constant(0)).rollBatch([1], 'magic', 'gameplay', false, 'manual');
    expect(state.diceInventory.instances[1].value).toBe(6);
    expect(state.dieRoundState[0].invocationsRemaining).toBe(1);
    new Resolver(state, constant(0)).rollBatch([0, 2], 'simultaneous', 'gameplay', false, 'manual');
    expect(state.dieRoundState[0].invocationsRemaining).toBe(1);
  });

  it('Tank intercepts Rerolls without Roll reactions and grows once per attempt', () => {
    const state = game(); values(state, [4, 2, 3, 4, 5]); makeSpecial(state, 0, 'tank', 2);
    const beforeEvents = state.history.length;
    new Resolver(state, constant(0)).rollBatch([0], 'tank', 'gameplay', false, 'manual');
    expect(state.diceInventory.instances[0].value).toBe(4);
    expect(state.dieRoundState[0].temporaryPips).toBe(20);
    expect(state.history.slice(beforeEvents).some(event => event.type === 'DIE_ROLLED')).toBe(false);
  });

  it('Tank grows once for its Score and once for the normal post-Play Reroll attempt', () => {
    const state = game(); values(state, [4, 2, 3, 4, 5]); makeSpecial(state, 0, 'tank');
    score(state, 'fours', [0]);
    expect(state.dieRoundState[0].temporaryPips).toBe(20);
    expect(state.diceInventory.instances[0].value).toBe(4);
  });

  it('Free Play reacts after genuine Rolls, tracks each face, and does not reroll itself', () => {
    const state = game(); values(state, [1, 2, 3, 4, 5]); makeSpecial(state, 0, 'freePlay', 2);
    const resolver = new Resolver(state, constant(0));
    resolver.rollBatch([0], 'free', 'gameplay', false, 'manual'); resolver.drain();
    expect(state.dieRoundState[0].freePlayUsesByFace[2]).toBe(1);
    expect(state.diceInventory.instances[0].value).toBe(2);
    expect(state.consumed).not.toContain('twos');
  });

  it('Free Play reacts to the initial Round Roll', () => {
    const state = game(); makeSpecial(state, 0, 'freePlay');
    new Resolver(state, constant(0)).startRound();
    expect(state.dieRoundState[0].freePlayUsesByFace[1]).toBe(1);
    expect(state.handPlayCounts.ones).toBeGreaterThan(0);
    expect(state.consumed).not.toContain('ones');
  });

  it('executes Jumping Bean Free Play then its explicit free Reroll', () => {
    let state = game(); values(state, [1, 2, 3, 4, 5]); makeSpecial(state, 0, 'jumpingBean', 2);
    state = dispatch(state, { type: 'INVOKE_JUMPING_BEAN', dieId: 0 }, constant(.5)).state;
    expect(state.dieRoundState[0].invocationsRemaining).toBe(1);
    expect(state.consumed).not.toContain('ones');
    expect(state.diceInventory.instances[0].value).not.toBe(1);
  });

  it('uses seeded Chameleon ties without treating the change as a Roll', () => {
    let state = game(); values(state, [6, 1, 2, 3, 4]); makeSpecial(state, 0, 'chameleon', 2);
    const result = dispatch(state, { type: 'INVOKE_CHAMELEON', dieId: 0 }, constant(.6)); state = result.state;
    expect(state.diceInventory.instances[0].value).toBe(3);
    expect(state.dieRoundState[0].invocationsRemaining).toBe(1);
    expect(result.events.at(-1)?.type).toBe('DIE_FLIPPED');
  });

  it('routes Flywheel through the Roll pipeline without spending manual rerolls', () => {
    let state = game(); values(state, [1, 2, 3, 4, 5]); makeSpecial(state, 0, 'flywheel', 2);
    const rerolls = state.manualRerollsRemaining;
    const result = dispatch(state, { type: 'INVOKE_FLYWHEEL', dieId: 0 }, constant(.5)); state = result.state;
    expect(state.manualRerollsRemaining).toBe(rerolls);
    expect(state.dieRoundState[0].invocationsRemaining).toBe(1);
    expect(result.events.some(event => event.type === 'DIE_ROLLED' && event.dieIds?.[0] === 0)).toBe(true);
  });

  it('arms Magic without spending, then consumes and clears on the next Reroll', () => {
    let state = game(); values(state, [1, 2, 3, 4, 5]); makeSpecial(state, 0, 'magic', 2);
    state = dispatch(state, { type: 'ARM_MAGIC', dieId: 0, face: 5 }, constant()).state;
    expect(state.dieRoundState[0]).toMatchObject({ invocationsRemaining: 2, magicArmedFace: 5 });
    new Resolver(state, constant()).rollBatch([0], 'magic', 'gameplay', false, 'manual');
    expect(state.diceInventory.instances[0].value).toBe(5);
    expect(state.dieRoundState[0]).toMatchObject({ invocationsRemaining: 1, magicArmedFace: null });
  });
});

describe('Storage isolation for whole-die effects', () => {
  it('does not initialize or activate stored Magnetic, Golden, Hitchhiker, Free Play, or wildcard dice', () => {
    for (const type of ['magnetic', 'golden', 'hitchhiker', 'freePlay', 'mirror'] as const) {
      const state = game();
      const stored = state.diceInventory.instances[4];
      stored.type = type;
      state.diceInventory.roster[4] = null;
      state.diceInventory.storage[0] = stored.id;
      syncActiveDiceProjection(state);
      state.dieRoundState = resetDieRoundState(rosterDice(state));
      expect(state.dieRoundState[stored.id]).toBeUndefined();
      expect(state.dice.some(die => die.id === stored.id)).toBe(false);
      new Resolver(state, constant()).rollBatch([0], 'storage isolation', 'gameplay', false, 'manual');
      expect(state.history.some(event => event.type === 'SPECIAL_DIE_EFFECT' && event.dieIds?.includes(stored.id))).toBe(false);
    }
  });
});
