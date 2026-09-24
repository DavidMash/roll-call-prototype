import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { HAND_IDS } from './hands';
import type { GameState, RandomSource } from './types';

const constant = (value = .99): RandomSource => ({ next: () => value });

function clearState(gold: number): GameState {
  const state = newRun('summary', constant()).state;
  state.target = 1;
  state.stats.rounds[0].target = 1;
  state.gold = gold;
  state.stats.rounds[0].goldBefore = gold;
  state.stats.rounds[0].goldBySourceBefore = structuredClone(state.stats.goldBySource);
  state.dice.forEach(die => { die.value = 6; });
  return state;
}

describe('authoritative Round Summary', () => {
  it('reconciles scoring Gold and standard payout for a normal encounter', () => {
    const state = clearState(4);
    activeFace(state.dice[0]).enhancements.golden = 1;
    activeFace(state.dice[0]).enhancements.jackpot = 1;
    const result = dispatch(state, { type: 'PLAY', hand: 'sixes', dieIds: [0] }, constant());
    const summary = result.state.roundSummary!;
    expect(result.state.phase).toBe('roundSummary');
    expect(summary).toMatchObject({ encounterType: 'normal', bossType: null, goldBefore: 4, goldAfter: 17, totalGoldEarned: 13,
      sources: { baseRewardGold: 5, unusedRerollGold: 3, interestGold: 1, bossRewardGold: 0, goldenGold: 1, jackpotGold: 3, otherGold: 0 } });
    expect(Object.values(summary.sources).reduce((sum, amount) => sum + amount, 0)).toBe(summary.totalGoldEarned);
    expect(summary.goldBefore + summary.totalGoldEarned).toBe(summary.goldAfter);
    expect(result.events.find(event => event.type === 'ROUND_SUMMARY_SHOWN')).toMatchObject({
      encounterType: 'normal', goldBefore: 4, goldAfter: 17, goldEarnedTotal: 13, goldenGold: 1, jackpotGold: 3,
    });
  });

  it('adds Boss Reward after interest and preserves Summary → map → Flame Selection sequencing', () => {
    const state = clearState(50);
    state.round = 3;
    state.stats.rounds[0].round = 3;
    state.manualRerollsRemaining = 2;
    state.boss = { type: 'caller', calledHand: 'sixes', playsRemaining: 3, satisfied: true, satisfyingSource: 'manual' };
    const result = dispatch(state, { type: 'PLAY', hand: 'sixes', dieIds: [0] }, constant());
    const summary = result.state.roundSummary!;
    expect(summary).toMatchObject({ encounterType: 'boss', bossType: 'caller', goldBefore: 50, goldAfter: 77, totalGoldEarned: 27,
      sources: { baseRewardGold: 5, unusedRerollGold: 2, interestGold: 10, bossRewardGold: 10, goldenGold: 0, jackpotGold: 0, otherGold: 0 } });
    const goldEvents = result.events.filter(event => event.type === 'GOLD_ADDED').map(event => event.goldSource);
    expect(goldEvents).toEqual(['roundBase', 'unusedRerolls', 'interest', 'bossReward']);
    expect(result.events.some(event => event.type === 'MAP_TRANSITION')).toBe(false);
    const continued = dispatch(result.state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant());
    expect(continued.events[0]).toMatchObject({ type: 'MAP_TRANSITION', nodeType: 'flame_selection' });
    expect(continued.state.phase).toBe('flameSelection');
  });

  it('continues a normal summary through the map to Shop and never summarizes a Bust', () => {
    const clear = dispatch(clearState(0), { type: 'PLAY', hand: 'sixes', dieIds: [0] }, constant()).state;
    const continued = dispatch(clear, { type: 'CONTINUE_ROUND_SUMMARY' }, constant());
    expect(continued.events[0]).toMatchObject({ type: 'MAP_TRANSITION', nodeType: 'shop' });
    expect(continued.state.phase).toBe('shop');

    const bust = newRun('summary-bust', constant()).state;
    bust.target = 1_000_000;
    bust.consumed = [...HAND_IDS];
    bust.manualRerollsRemaining = 0;
    bust.boss = { type: 'caller', calledHand: 'ones', playsRemaining: 1, satisfied: false, satisfyingSource: null };
    const resolver = new Resolver(bust, constant());
    resolver.evaluate();
    expect(bust.roundSummary).toBeNull();
    expect(bust.lastRoundPayout).toBeNull();
    expect(bust.stats.goldBySource.bossReward).toBe(0);
    expect(resolver.events.some(event => event.type === 'ROUND_SUMMARY_SHOWN')).toBe(false);
  });
});
