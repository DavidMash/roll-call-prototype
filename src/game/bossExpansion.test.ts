import { describe, expect, it } from 'vitest';
import { activeFace, scoringPips } from './dice';
import { Resolver } from './effects';
import { dispatch, newRun, validateAction } from './engine';
import { handOptions, HAND_IDS, LOWER_HAND_IDS } from './hands';
import { handScore } from './scoring';
import { selectHand, toggleDie } from './selection';
import { activeEncounterDice, BOSS_TYPES, bossSchedule, requiredEncounterDieIds, unavailableEncounterHands } from './bosses';
import { targetForRound } from './config';
import type { BossType, GameState, RandomSource, Rank } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });

function bossRound(type: BossType, random: RandomSource = constant(.55)): GameState {
  const state = newRun(`expansion-${type}`, constant(.2)).state;
  state.phase = 'shop';
  state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0 };
  state.round = 2;
  state.currentNodeId = 'shop:before-round:3';
  state.bossSchedule[3] = type;
  return dispatch(state, { type: 'NEXT_ROUND' }, random).state;
}

function expose(state: GameState, values: Rank[]): void {
  values.forEach((value, index) => { state.dice[index].value = value; });
}

describe('expanded deterministic boss bag', () => {
  it('contains every boss once per shuffled bag, is seeded, and avoids boundary repeats', () => {
    const rounds = BOSS_TYPES.length * 3 * 3;
    const sequence = Object.values(bossSchedule('eight-boss-bag', rounds));
    expect(sequence).toHaveLength(BOSS_TYPES.length * 3);
    for (let index = 0; index < sequence.length; index += BOSS_TYPES.length) {
      expect(new Set(sequence.slice(index, index + BOSS_TYPES.length))).toEqual(new Set(BOSS_TYPES));
    }
    expect(Object.values(bossSchedule('eight-boss-bag', rounds))).toEqual(sequence);
    sequence.slice(1).forEach((boss, index) => expect(boss).not.toBe(sequence[index]));
    expect(sequence.slice(3).some((boss, index) => boss !== sequence[index])).toBe(true);
  });
});

describe('The Caller continuous calls', () => {
  it('starts a new available call immediately after an early answer', () => {
    let state = bossRound('caller');
    if (state.boss?.type !== 'caller') throw new Error('Caller fixture failed');
    state.target = 1_000_000;
    state.boss.calledHand = 'ones';
    state.dice[0].value = 1;
    state = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.3)).state;
    expect(state.boss).toMatchObject({ type: 'caller', playsRemaining: 3, satisfied: false, callsCompleted: 1 });
    if (state.boss?.type !== 'caller') throw new Error('Caller fixture failed');
    expect(state.boss.calledHand).not.toBe('ones');
    expect(state.consumed).not.toContain(state.boss.calledHand);
  });

  it('halves progress on the third miss before checking for a clear', () => {
    let state = bossRound('caller');
    if (state.boss?.type !== 'caller') throw new Error('Caller fixture failed');
    state.boss.calledHand = 'fullHouse';
    state.target = 20;
    for (const [index, hand] of (['ones', 'twos', 'threes'] as const).entries()) {
      state.dice[0].value = (index + 1) as Rank;
      state = dispatch(state, { type: 'PLAY', hand, dieIds: [0] }, constant(.2)).state;
    }
    expect(state.score).toBe(14);
    expect(state.phase).toBe('round');
    expect(state.boss).toMatchObject({ type: 'caller', playsRemaining: 3, callsMissed: 1 });
  });

  it('clears only after the third-miss penalty when the halved score still meets target', () => {
    let state = bossRound('caller');
    if (state.boss?.type !== 'caller') throw new Error('Caller fixture failed');
    state.boss.calledHand = 'fullHouse';
    state.target = 100;
    state.dice[0].value = 1;
    state = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.2)).state;
    state.dice[0].value = 2;
    state = dispatch(state, { type: 'PLAY', hand: 'twos', dieIds: [0] }, constant(.2)).state;
    expose(state, [6, 6, 6, 6, 6]);
    state = dispatch(state, { type: 'PLAY', hand: 'fiveKind', dieIds: [0, 1, 2, 3, 4] }, constant(.2)).state;
    expect(state.score).toBeGreaterThanOrEqual(100);
    expect(state.score).toBeLessThan(242);
    expect(state.phase).toBe('roundSummary');
  });

  it('lets a matching Bean answer without consuming a manual opportunity', () => {
    const state = bossRound('caller');
    if (state.boss?.type !== 'caller') throw new Error('Caller fixture failed');
    state.target = 1_000_000;
    state.boss.calledHand = 'ones';
    state.dice[0].value = 6;
    state.dice[0].faces[5].enhancements.bump = 1;
    state.dice[0].faces[0].enhancements.jumpingBean = 1;
    state.dice[0].faces[0].enhancements.sticky = 1;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0)).state;
    expect(result.boss).toMatchObject({ type: 'caller', playsRemaining: 3, callsCompleted: 1 });
    expect(result.stats.callerEvents.at(-1)).toMatchObject({ calledHand: 'ones', satisfied: true, source: 'jumpingBean' });
  });
});

describe('The Hexer selection contract', () => {
  it('allows every die to toggle freely and a player die to reroll alone', () => {
    const state = bossRound('hexer');
    const cursedId = requiredEncounterDieIds(state)[0];
    let selection = toggleDie(activeEncounterDice(state), state.consumed, { dieIds: [], hand: null }, cursedId, [cursedId]);
    expect(selection.dieIds).toEqual([cursedId]);
    selection = toggleDie(activeEncounterDice(state), state.consumed, selection, cursedId, [cursedId]);
    expect(selection.dieIds).toEqual([]);
    expect(validateAction(state, { type: 'MANUAL_REROLL', dieIds: [0] })).toBeNull();
  });

  it('only exposes and selects combinations that genuinely include the Cursed Die', () => {
    const state = bossRound('hexer');
    const cursed = state.dice.find(die => die.owner === 'boss')!;
    expose(state, [2, 2, 4, 5, 6]);
    cursed.value = 7;
    const legal = handOptions(activeEncounterDice(state), state.consumed, [cursed.id]);
    expect(legal.every(option => option.combinations.every(set => set.includes(cursed.id)))).toBe(true);
    const pairSelection = selectHand(activeEncounterDice(state), state.consumed, { dieIds: [], hand: null }, 'pair', [cursed.id]);
    expect(pairSelection.hand).toBeNull();
    cursed.value = 2;
    const legalPair = selectHand(activeEncounterDice(state), state.consumed, { dieIds: [], hand: null }, 'pair', [cursed.id]);
    expect(legalPair.dieIds).toContain(cursed.id);
  });
});

describe('The Marathon', () => {
  it('triples the target and reactivates a hand after exactly seven subsequent manual plays', () => {
    let state = bossRound('marathon');
    expect(state.target).toBe(targetForRound(3) * 3);
    state.target = 1_000_000;
    const plays: { hand: typeof HAND_IDS[number]; values: Rank[]; ids: number[] }[] = [
      { hand: 'ones', values: [1], ids: [0] }, { hand: 'twos', values: [2], ids: [0] },
      { hand: 'threes', values: [3], ids: [0] }, { hand: 'fours', values: [4], ids: [0] },
      { hand: 'fives', values: [5], ids: [0] }, { hand: 'sixes', values: [6], ids: [0] },
      { hand: 'pair', values: [2, 2], ids: [0, 1] }, { hand: 'twoPair', values: [2, 2, 3, 3], ids: [0, 1, 2, 3] },
    ];
    for (const [index, play] of plays.entries()) {
      play.values.forEach((value, dieIndex) => { state.dice[dieIndex].value = value; });
      state = dispatch(state, { type: 'PLAY', hand: play.hand, dieIds: play.ids }, constant(.2)).state;
      if (state.boss?.type !== 'marathon') throw new Error('Marathon fixture failed');
      if (index === 0) expect(state.boss.cooldowns.ones).toBe(7);
      if (index === 6) expect(state.boss.cooldowns.ones).toBe(1);
    }
    if (state.boss?.type !== 'marathon') throw new Error('Marathon fixture failed');
    expect(state.boss.cooldowns.ones).toBeUndefined();
    expect(state.consumed).toEqual([]);
  });

  it('does not advance cooldowns for Jumping Bean free plays', () => {
    const state = bossRound('marathon');
    if (state.boss?.type !== 'marathon') throw new Error('Marathon fixture failed');
    state.target = 1_000_000;
    state.boss.cooldowns.fullHouse = 4;
    state.dice[0].value = 1;
    new Resolver(state, constant(.2)).play('ones', [0], 'jumpingBean');
    expect(state.boss.cooldowns.fullHouse).toBe(4);
  });
});

describe('Quickdraw', () => {
  it('uses one third target, spends one Lower shot, and leaves Upper hands available', () => {
    let state = bossRound('quickdraw');
    expect(state.target).toBe(30);
    state.target = 1_000_000;
    expose(state, [2, 2, 3, 4, 5]);
    state = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(.2)).state;
    expect(state.boss).toMatchObject({ type: 'quickdraw', lowerShotUsed: true, playedLowerHand: 'pair' });
    expect(validateAction(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] })).not.toBeNull();
    state.dice[0].value = 1;
    expect(validateAction(state, { type: 'PLAY', hand: 'ones', dieIds: [0] })).toBeNull();
  });

  it('does not require the Lower shot to clear', () => {
    const state = bossRound('quickdraw');
    if (state.boss?.type !== 'quickdraw') throw new Error('Quickdraw fixture failed');
    state.score = state.target - 1;
    state.dice[0].value = 1;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.2)).state;
    expect(result.phase).toBe('roundSummary');
    expect(state.boss.lowerShotUsed).toBe(false);
  });
});

describe('The Fly', () => {
  it('halves misses, moves away from the previous row, and scores catch and later hands fully', () => {
    let state = bossRound('fly');
    if (state.boss?.type !== 'fly') throw new Error('Fly fixture failed');
    state.target = 1_000_000;
    state.boss.flyHand = 'pair';
    state.dice[0].value = 1;
    state = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0)).state;
    expect(state.score).toBe(4);
    if (state.boss?.type !== 'fly') throw new Error('Fly fixture failed');
    expect(state.boss.flyHand).not.toBe('pair');
    state.boss.flyHand = 'pair';
    expose(state, [2, 2, 4, 5, 6]);
    state = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(.2)).state;
    expect(state.score).toBe(22);
    expect(state.boss).toMatchObject({ type: 'fly', caught: true, flyHand: null });
    state.dice[0].value = 2;
    state = dispatch(state, { type: 'PLAY', hand: 'twos', dieIds: [0] }, constant(.2)).state;
    expect(state.score).toBe(31);
  });

  it('moves after a Jumping Bean free play without consuming its hand', () => {
    const state = bossRound('fly');
    if (state.boss?.type !== 'fly') throw new Error('Fly fixture failed');
    state.target = 1_000_000;
    state.boss.flyHand = 'pair';
    state.dice[0].value = 1;
    new Resolver(state, constant(0)).play('ones', [0], 'jumpingBean');
    expect(state.boss.flyHand).not.toBe('pair');
    expect(state.consumed).not.toContain('ones');
  });
});

describe('Snake Eyes', () => {
  it('mutates up to two eligible scoring physical faces into real 1s and keeps enhancements attached', () => {
    let state = bossRound('snakeEyes');
    state.target = 1_000_000;
    expose(state, [2, 2, 4, 5, 6]);
    state.dice[0].faces[1].enhancements.bonus = 1;
    state = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(0)).state;
    if (state.boss?.type !== 'snakeEyes') throw new Error('Snake Eyes fixture failed');
    expect(state.boss.mutatedFaces).toHaveLength(2);
    expect(state.dice[0].faces[1]).toMatchObject({ rank: 1, snakeEyed: true, enhancements: { bonus: 1 } });
    expect(state.dice[1].faces[1]).toMatchObject({ rank: 1, snakeEyed: true });
  });

  it('skips natural 1s and already-mutated faces and rollback restores permanent values', () => {
    const state = bossRound('snakeEyes');
    state.target = 1_000_000;
    expose(state, [1, 2, 1, 5, 6]);
    state.dice[1].faces[1].snakeEyed = true;
    state.dice[1].faces[1].rank = 1;
    if (state.boss?.type !== 'snakeEyes') throw new Error('Snake Eyes fixture failed');
    state.boss.mutatedFaces.push({ dieId: 1, physicalFace: 2 });
    const resolver = new Resolver(state, constant(0));
    resolver.play('threeKind', [0, 1, 2]);
    expect(state.boss.mutatedFaces).toHaveLength(1);
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    resolver.evaluate();
    expect(state.phase).toBe('shop');
    expect(state.dice.every(die => die.faces.every((face, index) => face.rank === index + 1 && !face.snakeEyed))).toBe(true);
    const retry = dispatch(state, { type: 'RETRY_ROUND' }, constant(.55)).state;
    expect(retry.boss).toMatchObject({ type: 'snakeEyes', mutatedFaces: [] });
    expect(retry.dice.every(die => die.faces.every(face => !face.snakeEyed))).toBe(true);
  });
});

describe('The Infected', () => {
  function clearInfection(state: GameState): void {
    state.dice.forEach(die => die.faces.forEach(face => { delete face.infected; }));
    if (state.boss?.type === 'infected') state.boss.infectedFaces = [];
  }

  it('starts with an infected physical face on every die', () => {
    const state = bossRound('infected', constant(.2));
    expect(state.dice.every(die => die.faces.filter(face => face.infected).length === 1)).toBe(true);
  });

  it('subtracts 3 Pips from an infected scoring face without reducing Hand Base Pips', () => {
    const state = bossRound('infected');
    clearInfection(state);
    state.dice[0].value = 6;
    activeFace(state.dice[0]).infected = true;
    expect(scoringPips(activeFace(state.dice[0]))).toBe(3);
    expect(handScore(state.dice, 'sixes', [0]).pips).toBe(10);
  });

  it('floors an infected face contribution at 0 Pips', () => {
    const state = bossRound('infected');
    clearInfection(state);
    state.dice[0].value = 2;
    activeFace(state.dice[0]).infected = true;
    expect(scoringPips(activeFace(state.dice[0]))).toBe(0);
    expect(handScore(state.dice, 'twos', [0]).pips).toBe(7);
  });

  it('applies the penalty to accumulated permanent face Pips', () => {
    const state = bossRound('infected');
    clearInfection(state);
    state.dice[0].value = 6;
    activeFace(state.dice[0]).workoutPips = 4;
    activeFace(state.dice[0]).infected = true;
    expect(scoringPips(activeFace(state.dice[0]))).toBe(7);
    expect(handScore(state.dice, 'sixes', [0]).pips).toBe(14);
  });

  it('still suppresses infected-face enhancements while clean faces remain unaffected', () => {
    const state = bossRound('infected');
    clearInfection(state);
    expose(state, [4, 4, 2, 5, 6]);
    const infected = activeFace(state.dice[0]);
    const clean = activeFace(state.dice[1]);
    infected.infected = true;
    for (const face of [infected, clean]) {
      face.enhancements.bonus = 1;
      face.enhancements.golden = 1;
      face.enhancements.workout = 1;
    }
    expect(scoringPips(infected)).toBe(1);
    expect(scoringPips(clean)).toBe(14);
    expect(handScore(state.dice, 'pair', [0, 1]).pips).toBe(23);

    state.target = 1_000_000;
    const result = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(.2)).state;
    expect(result.gold).toBe(1);
    expect(result.dice[0].faces[3].workoutPips).toBe(0);
    expect(result.dice[1].faces[3].workoutPips).toBe(1);
  });

  it('keeps the whole-die Flame active on an infected exposed face', () => {
    const state = bossRound('infected');
    clearInfection(state);
    state.dice[0].value = 1;
    activeFace(state.dice[0]).infected = true;
    state.dice[0].flame = { id: 'minigun', investedGold: 100 };
    state.target = 1_000_000;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.2)).state;
    expect(result.stats.handScores.at(-1)?.xMult).toBe(5);
  });

  it('spreads from another die, never self-spreads, and does not recursively spread in the same batch', () => {
    const state = bossRound('infected');
    clearInfection(state);
    expose(state, [1, 1, 1, 1, 1]);
    state.dice[0].faces[0].infected = true;
    if (state.boss?.type !== 'infected') throw new Error('Infected fixture failed');
    state.boss.infectedFaces.push({ dieId: 0, physicalFace: 1 });
    new Resolver(state, constant(.25)).rollBatch([0, 1], 'test batch', 'gameplay', true);
    expect(activeFace(state.dice[0]).infected).not.toBe(true);
    expect(activeFace(state.dice[1]).infected).toBe(true);
  });

  it('rolls all infection back to a clean permanent build on Bust', () => {
    let state = bossRound('infected');
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    new Resolver(state, constant(.2)).evaluate();
    expect(state.phase).toBe('shop');
    expect(state.dice.every(die => die.faces.every(face => !face.infected))).toBe(true);
    state = dispatch(state, { type: 'RETRY_ROUND' }, constant(.55)).state;
    expect(state.boss?.type).toBe('infected');
    expect(state.dice.every(die => die.faces.filter(face => face.infected).length === 1)).toBe(true);
  });

  it('uses boss-aware unavailable hands for Quickdraw and Marathon', () => {
    const quick = bossRound('quickdraw');
    if (quick.boss?.type !== 'quickdraw') throw new Error('Quickdraw fixture failed');
    quick.boss.lowerShotUsed = true;
    expect(LOWER_HAND_IDS.every(hand => unavailableEncounterHands(quick).includes(hand))).toBe(true);
  });
});

describe('boss attempt-local runtime rollback', () => {
  it.each(['marathon', 'quickdraw', 'fly'] as const)('resets %s runtime state on retry', type => {
    let state = bossRound(type);
    if (state.boss?.type === 'marathon') state.boss.cooldowns.ones = 4;
    if (state.boss?.type === 'quickdraw') { state.boss.lowerShotUsed = true; state.boss.playedLowerHand = 'pair'; }
    if (state.boss?.type === 'fly') { state.boss.caught = true; state.boss.flyHand = null; state.boss.moves = 3; }
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    new Resolver(state, constant(.2)).evaluate();
    expect(state.phase).toBe('shop');
    state = dispatch(state, { type: 'RETRY_ROUND' }, constant(.55)).state;
    if (type === 'marathon') expect(state.boss).toMatchObject({ type, cooldowns: {} });
    if (type === 'quickdraw') expect(state.boss).toMatchObject({ type, lowerShotUsed: false, playedLowerHand: null });
    if (type === 'fly') expect(state.boss).toMatchObject({ type, caught: false, moves: 0 });
  });
});
