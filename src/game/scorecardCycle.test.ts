import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { lastPlayDanger } from './bosses';
import { dispatch, newRun, normalizeGameState } from './engine';
import { Resolver } from './effects';
import { HAND_IDS } from './hands';
import type { BossRuntimeState, GameState, HandId, Rank } from './types';

const constant = (value = 0) => ({ next: () => value });

function finalHandState(): GameState {
  const state = newRun('scorecard-cycle', constant()).state;
  const priorHands = HAND_IDS.filter(hand => hand !== 'ones');
  state.target = 1_000_000;
  state.stats.rounds[0].target = state.target;
  state.score = 73;
  state.gold = 19;
  state.lives = 2;
  state.manualRerollsRemaining = 2;
  state.specialOfferEffects.carePackageRerolls = 4;
  state.handLevels.pair = 2;
  state.consumed = [...priorHands];
  state.scorecardCycleConsumed = [...priorHands];
  state.dice.forEach((die, index) => { die.value = (index + 1) as Rank; });
  activeFace(state.dice[0]).enhancements.sticky = 1;
  return state;
}

function playFinalHand(state: GameState) {
  return dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant());
}

describe('authoritative scorecard cycles', () => {
  it('refreshes every ordinary Used hand without resetting the current Round', () => {
    const state = finalHandState();
    const beforeDice = structuredClone(state.dice);
    const result = playFinalHand(state);
    const refresh = result.events.find(event => event.type === 'SCORECARD_REFRESHED');

    expect(refresh?.message).toBe('Scorecard filled · all hands refreshed');
    expect(result.state.phase).toBe('round');
    expect(result.state.round).toBe(state.round);
    expect(result.state.score).toBe(81);
    expect(result.state.score).toBeGreaterThan(state.score);
    expect(result.state.gold).toBe(19);
    expect(result.state.lives).toBe(2);
    expect(result.state.manualRerollsRemaining).toBe(2);
    expect(result.state.specialOfferEffects.carePackageRerolls).toBe(4);
    expect(result.state.handLevels.pair).toBe(2);
    expect(result.state.consumed).toEqual([]);
    expect(result.state.scorecardCycleConsumed).toEqual([]);
    expect(result.state.dice).toEqual(beforeDice);
    expect(result.events.findIndex(event => event.type === 'HAND_SCORE_FINALIZED'))
      .toBeLessThan(result.events.findIndex(event => event.type === 'HAND_CONSUMED'));
    expect(result.events.findIndex(event => event.type === 'HAND_CONSUMED'))
      .toBeLessThan(result.events.findIndex(event => event.type === 'SCORECARD_REFRESHED'));
    expect(result.events.some(event => event.type === 'ROUND_CLEARED')).toBe(false);
  });

  it('does not label the final hand in a completable cycle as a last play', () => {
    const state = finalHandState();
    state.manualRerollsRemaining = 0;
    state.specialOfferEffects.carePackageRerolls = 0;
    expect(lastPlayDanger(state, 'ones')).toBe('none');
  });

  it('does not refresh when the final hand clears the Round', () => {
    const state = finalHandState();
    state.target = 80;
    state.stats.rounds[0].target = state.target;
    const result = playFinalHand(state);

    expect(result.state.phase).toBe('roundSummary');
    expect(new Set(result.state.consumed)).toEqual(new Set(HAND_IDS));
    expect(new Set(result.state.scorecardCycleConsumed)).toEqual(new Set(HAND_IDS));
    expect(result.events.some(event => event.type === 'SCORECARD_REFRESHED')).toBe(false);
    expect(result.events.some(event => event.type === 'ROUND_CLEARED')).toBe(true);
  });

  it('supports multiple completed cycles in one Round', () => {
    const first = playFinalHand(finalHandState());
    expect(first.events.filter(event => event.type === 'SCORECARD_REFRESHED')).toHaveLength(1);

    const secondCycle = structuredClone(first.state);
    secondCycle.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    secondCycle.scorecardCycleConsumed = HAND_IDS.filter(hand => hand !== 'ones');
    secondCycle.dice[0].value = 1;
    const second = playFinalHand(secondCycle);

    expect(second.events.filter(event => event.type === 'SCORECARD_REFRESHED')).toHaveLength(1);
    expect(second.state.history.filter(event => event.type === 'SCORECARD_REFRESHED')).toHaveLength(2);
    expect(second.state.score).toBe(first.state.score + 8);
    expect(second.state.consumed).toEqual([]);
  });

  it('does not count Jumping Bean free plays as ordinary cycle consumption', () => {
    const state = finalHandState();
    const resolver = new Resolver(state, constant());
    resolver.play('ones', [0], 'jumpingBean');

    expect(state.scorecardCycleConsumed).toEqual(HAND_IDS.filter(hand => hand !== 'ones'));
    expect(state.consumed).toEqual(HAND_IDS.filter(hand => hand !== 'ones'));
    expect(resolver.events.some(event => event.type === 'SCORECARD_REFRESHED')).toBe(false);
    expect(resolver.events.find(event => event.type === 'JUMPING_BEAN_FREE_PLAY')?.handConsumed).toBe(false);
  });

  it.each<[string, BossRuntimeState]>([
    ['Caller', { type: 'caller', calledHand: 'twos', playsRemaining: 2, satisfied: false,
      satisfyingSource: null, callsCompleted: 0, callsMissed: 0, manualHandsPlayed: 1, callDeadline: 3 }],
    ['Warden', { type: 'warden', activeDieIds: [0, 1, 2, 3, 4], startingDieId: 0,
      nextUnlockTarget: null, unlockCosts: [], unlockTargets: [20, 40], pendingReinforcements: 0 }],
    ['Quickdraw', { type: 'quickdraw', lowerShotUsed: false, playedLowerHand: null }],
    ['Fly', { type: 'fly', flyHand: 'pair', caught: false, moves: 2 }],
  ])('preserves %s state while refreshing only ordinary Used hands', (_name, boss) => {
    const refreshing = finalHandState();
    refreshing.boss = structuredClone(boss);
    const control = structuredClone(refreshing);
    control.scorecardCycleConsumed = control.scorecardCycleConsumed.filter(hand => hand !== 'twos');

    const refreshed = playFinalHand(refreshing);
    const notRefreshed = playFinalHand(control);

    expect(refreshed.events.some(event => event.type === 'SCORECARD_REFRESHED')).toBe(true);
    expect(notRefreshed.events.some(event => event.type === 'SCORECARD_REFRESHED')).toBe(false);
    expect(refreshed.state.boss).toEqual(notRefreshed.state.boss);
  });

  it('does not let Neglected restrictions complete a partial scorecard', () => {
    const state = finalHandState();
    state.boss = { type: 'neglected', neglectedHands: ['ones', 'twos'] };
    state.dice[0].value = 3;
    state.consumed = HAND_IDS.filter(hand => hand !== 'threes');
    state.scorecardCycleConsumed = HAND_IDS.filter(hand => !(['ones', 'twos', 'threes'] as HandId[]).includes(hand));
    const result = dispatch(state, { type: 'PLAY', hand: 'threes', dieIds: [0] }, constant());

    expect(result.events.some(event => event.type === 'SCORECARD_REFRESHED')).toBe(false);
    expect(result.state.scorecardCycleConsumed).toHaveLength(HAND_IDS.length - 2);
    expect(new Set(result.state.consumed)).toEqual(new Set(HAND_IDS));
    expect(result.state.boss).toEqual(state.boss);
  });

  it('disables scorecard refresh during Marathon without altering cooldown behavior', () => {
    const state = finalHandState();
    state.boss = { type: 'marathon', cooldowns: { twos: 3, pair: 1 } };
    state.consumed = [];
    state.scorecardCycleConsumed = [...HAND_IDS];
    const result = playFinalHand(state);

    expect(result.events.some(event => event.type === 'SCORECARD_REFRESHED')).toBe(false);
    expect(result.state.consumed).toEqual([]);
    expect(result.state.scorecardCycleConsumed).toEqual(HAND_IDS);
    expect(result.state.boss).toEqual({ type: 'marathon', cooldowns: { twos: 2, ones: 7 } });
  });

  it('migrates the current ordinary Used state into persisted cycle state', () => {
    const legacy = finalHandState() as unknown as Omit<GameState, 'scorecardCycleConsumed'> & { scorecardCycleConsumed?: HandId[] };
    delete legacy.scorecardCycleConsumed;
    expect(normalizeGameState(legacy as GameState).scorecardCycleConsumed)
      .toEqual(HAND_IDS.filter(hand => hand !== 'ones'));

    const neglected = finalHandState() as unknown as Omit<GameState, 'scorecardCycleConsumed'> & { scorecardCycleConsumed?: HandId[] };
    neglected.boss = { type: 'neglected', neglectedHands: ['ones', 'twos'] };
    neglected.consumed = ['ones', 'twos', 'threes'];
    delete neglected.scorecardCycleConsumed;
    expect(normalizeGameState(neglected as GameState).scorecardCycleConsumed).toEqual(['threes']);
  });
});
