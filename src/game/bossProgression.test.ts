import { describe, expect, it } from 'vitest';
import { activeFace, rollWeights } from './dice';
import { dispatch, newRun, validateAction } from './engine';
import { BOSS_TYPES, bossSchedule, createCursedDie, wardenCheckpoints } from './bosses';
import { combinationsForHand, HAND_IDS } from './hands';
import { routeThrough } from './progression';
import type { BossType, GameState, RandomSource } from './types';
import { Resolver } from './effects';

const constant = (value = 0): RandomSource => ({ next: () => value });
function bossRound(type: BossType): GameState {
  const state = newRun(`boss-${type}`, constant(.2)).state;
  state.phase = 'shop';
  state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0 };
  state.round = 2;
  state.currentNodeId = 'shop:before-round:3';
  state.bossSchedule[3] = type;
  return dispatch(state, { type: 'NEXT_ROUND' }, constant(.55)).state;
}

describe('linear route and deterministic boss schedule', () => {
  it('uses stable cadence and node identifiers', () => {
    expect(routeThrough('route', 4).map(node => node.id)).toEqual([
      'round:1', 'shop:before-round:2', 'round:2', 'shop:before-round:3',
      'boss:3', 'flame:after-round:3', 'shop:before-round:4', 'round:4', 'shop:before-round:5',
    ]);
  });

  it('draws all three bosses before reshuffling without adjacent repeats', () => {
    const sequence = Object.values(bossSchedule('bag-seed', 36));
    expect(sequence).toHaveLength(12);
    for (let index = 0; index < sequence.length; index += 3) {
      expect(new Set(sequence.slice(index, index + 3))).toEqual(new Set(BOSS_TYPES));
    }
    sequence.slice(1).forEach((boss, index) => expect(boss).not.toBe(sequence[index]));
    expect(Object.values(bossSchedule('bag-seed', 36))).toEqual(sequence);
  });

  it('emits auditable movement into a boss node', () => {
    const state = bossRound('caller');
    expect(state.currentNodeId).toBe('boss:3');
    expect(state.stats.mapTransitions.at(-1)).toMatchObject({
      fromNode: 'shop:before-round:3', toNode: 'boss:3', nodeType: 'boss_round', boss: 'caller', direction: 'forward',
    });
  });
});

describe('The Caller', () => {
  it('reveals a deterministic conservative call and a matching Bean answers without using a manual play', () => {
    const state = bossRound('caller');
    if (state.boss?.type !== 'caller') throw new Error('Caller fixture failed');
    state.boss.calledHand = 'ones';
    state.dice[0].value = 6;
    state.dice[0].faces[5].enhancements.bump = 1;
    state.dice[0].faces[0].enhancements.jumpingBean = 1;
    state.dice[0].faces[0].enhancements.sticky = 1;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0));
    expect(result.state.boss).toMatchObject({ type: 'caller', calledHand: 'ones', satisfied: true, playsRemaining: 3, satisfyingSource: 'jumpingBean' });
    expect(result.state.stats.callerEvents.at(-1)).toMatchObject({ satisfied: true, source: 'jumpingBean', expired: false });
  });

  it('Busts after the third nonmatching manual play and restores the Shop checkpoint', () => {
    let state = bossRound('caller');
    if (state.boss?.type !== 'caller') throw new Error('Caller fixture failed');
    const deterministicCall = state.boss.calledHand;
    state.boss.calledHand = 'fullHouse';
    state.target = 1_000_000;
    for (const [index, hand] of (['ones', 'twos', 'threes'] as const).entries()) {
      state.dice[0].value = (index + 1) as 1 | 2 | 3;
      const result = dispatch(state, { type: 'PLAY', hand, dieIds: [0] }, constant(.2));
      state = result.state;
    }
    expect(state.phase).toBe('shop');
    expect(state.lives).toBe(2);
    expect(state.round).toBe(3);
    expect(state.roundAttemptNumber).toBe(2);
    expect(state.boss).toBeNull();
    expect(state.stats.bossEncounters.at(-1)).toMatchObject({ boss: 'caller', busted: true, callerManualPlays: 3 });
    expect(state.stats.mapTransitions.slice(-2).map(item => [item.toNode, item.direction])).toEqual([
      ['boss:3', 'forward'], ['shop:before-round:3', 'backward'],
    ]);
    state = dispatch(state, { type: 'RETRY_ROUND' }, constant(.55)).state;
    expect(state.boss).toMatchObject({ type: 'caller', calledHand: deterministicCall, playsRemaining: 3, satisfied: false });
  });
});

describe('The Warden', () => {
  it('uses exact rounded thresholds, locks dice, and deploys each choice with a real roll', () => {
    let state = bossRound('warden');
    expect(state.boss).toMatchObject({ type: 'warden', checkpoints: wardenCheckpoints(state.target), activeDieIds: [] });
    expect(validateAction(state, { type: 'PLAY', hand: 'ones', dieIds: [0] })).toContain('Choose the Warden');
    state = dispatch(state, { type: 'CHOOSE_WARDEN_DIE', dieId: 2 }, constant(0)).state;
    expect(state.boss).toMatchObject({ type: 'warden', startingDieId: 2, activeDieIds: [2] });
    expect(state.dice[2].value).toBe(1);
    expect(validateAction(state, { type: 'MANUAL_REROLL', dieIds: [1] })).toContain('unlocked');
    expect(state.stats.wardenEvents[0]).toMatchObject({ kind: 'starting_die', dieId: 2, activeDice: 1 });
  });

  it('queues multiple crossed reinforcements and requires sequential choices', () => {
    let state = bossRound('warden');
    state = dispatch(state, { type: 'CHOOSE_WARDEN_DIE', dieId: 0 }, constant(0)).state;
    state.handLevels.ones = 20;
    state = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0)).state;
    if (state.boss?.type !== 'warden') throw new Error('Warden fixture failed');
    expect(state.boss.pendingReinforcements).toBe(4);
    expect(state.phase).toBe('round');
    for (const dieId of [1, 2, 3, 4]) state = dispatch(state, { type: 'CHOOSE_WARDEN_DIE', dieId }, constant(0)).state;
    expect(state.phase).toBe('flameReward');
    expect(state.dice).toHaveLength(5);
    expect(state.stats.bossEncounters.at(-1)).toMatchObject({ boss: 'warden', cleared: true, wardenActiveDiceAtEnd: 5 });
  });

  it('resets attempt-local locks and asks for a new starter on retry', () => {
    let state = bossRound('warden');
    state = dispatch(state, { type: 'CHOOSE_WARDEN_DIE', dieId: 3 }, constant(.2)).state;
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    new Resolver(state, constant(.2)).evaluate();
    expect(state.phase).toBe('shop');
    state = dispatch(state, { type: 'RETRY_ROUND' }, constant(.55)).state;
    expect(state.boss).toMatchObject({ type: 'warden', startingDieId: null, activeDieIds: [], reachedCheckpoints: 0 });
  });
});

describe('The Hexer', () => {
  it('constructs the exact temporary seven-face loadout', () => {
    const die = createCursedDie();
    expect(die.owner).toBe('boss');
    expect(die.faces).toHaveLength(7);
    expect(die.faces[0]).toMatchObject({ rank: 1, weightedTarget: 6, enhancements: { golden: 1, jumpingBean: 1, weighted: 1 } });
    expect(die.faces[4].enhancements).toEqual({ workout: 5, mirror: 1, bump: 1 });
    expect(die.faces[6]).toMatchObject({ rank: 7, enhancements: { bonus: 5, jackpot: 1, sticky: 1, mirror: 1 } });
    expect(rollWeights(die)).toEqual([1, 1, 1, 2, 2, 2, 1]);
  });

  it('requires the Cursed Die in manual hands and removes it after clear', () => {
    let state = bossRound('hexer');
    expect(state.dice).toHaveLength(6);
    const cursed = state.dice.find(die => die.owner === 'boss')!;
    state.dice[0].value = 2;
    state.dice[1].value = 2;
    cursed.value = 2;
    expect(validateAction(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] })).toContain('Cursed Die');
    expect(validateAction(state, { type: 'PLAY', hand: 'pair', dieIds: [0, cursed.id] })).toBeNull();
    state.target = 1;
    state = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, cursed.id] }, constant(.2)).state;
    expect(state.phase).toBe('flameReward');
    expect(state.dice.every(die => die.owner === 'player')).toBe(true);
    expect(state.lastRoundPayout).toMatchObject({ baseGold: 5, unusedRerollGold: 3, interestGold: 0, flameBonusGold: 5, totalRoundRewardGold: 13 });
  });

  it('supports extended straights and Mirror group matching with rank 7', () => {
    const cursed = createCursedDie();
    const players = newRun('seven-hands', constant(.2)).state.dice;
    [3, 4, 5, 6].forEach((rank, index) => { players[index].value = rank as 3 | 4 | 5 | 6; });
    cursed.value = 7;
    expect(combinationsForHand([...players.slice(0, 4), cursed], 'largeStraight')).toContainEqual([0, 1, 2, 3, cursed.id]);
    players[0].value = 2;
    expect(combinationsForHand([players[0], cursed], 'pair')).toContainEqual([0, cursed.id]);
    expect(activeFace(cursed).rank).toBe(7);
  });

  it('uses no-wrap Bump, temporary Workout growth, Sticky, and Jackpot on authored faces', () => {
    let state = bossRound('hexer');
    let cursed = state.dice.find(die => die.owner === 'boss')!;
    cursed.value = 6;
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [cursed.id] }, constant(0)).state;
    cursed = state.dice.find(die => die.owner === 'boss')!;
    expect(cursed.value).toBe(7);

    state.target = 1_000_000;
    state.dice[0].value = 2;
    cursed.value = 7;
    state = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, cursed.id] }, constant(0)).state;
    cursed = state.dice.find(die => die.owner === 'boss')!;
    expect(cursed.value).toBe(7);
    expect(state.stats.triggers.sticky).toBe(1);

    state.dice[0].value = 3;
    cursed.value = 3;
    state = dispatch(state, { type: 'PLAY', hand: 'threes', dieIds: [cursed.id] }, constant(.95)).state;
    cursed = state.dice.find(die => die.owner === 'boss')!;
    expect(cursed.faces[2].workoutPips).toBe(1);

    const jackpotState = bossRound('hexer');
    const jackpotCursed = jackpotState.dice.find(die => die.owner === 'boss')!;
    jackpotState.dice[0].value = 2;
    jackpotCursed.value = 7;
    jackpotState.target = 1;
    const cleared = dispatch(jackpotState, { type: 'PLAY', hand: 'pair', dieIds: [0, jackpotCursed.id] }, constant(.2)).state;
    expect(cleared.stats.goldBySource.jackpot).toBe(3);
    expect(cleared.gold).toBe(16);
  });

  it('removes the Cursed Die on failed-attempt rollback and recreates it for the retry', () => {
    let state = bossRound('hexer');
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    new Resolver(state, constant(.2)).evaluate();
    expect(state.phase).toBe('shop');
    expect(state.dice).toHaveLength(5);
    expect(state.dice.every(die => die.owner === 'player')).toBe(true);
    state = dispatch(state, { type: 'RETRY_ROUND' }, constant(.55)).state;
    expect(state.boss?.type).toBe('hexer');
    expect(state.dice.filter(die => die.owner === 'boss')).toHaveLength(1);
  });
});
