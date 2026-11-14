import { describe, expect, it } from 'vitest';
import { Resolver } from './effects';
import { dispatch, newRun, validateAction } from './engine';
import { BRIBERY_ROUND_GOLD_CAP, briberyFactor, briberyXMultPerGold, flameByType, placeFlameInstance } from './flames';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { summarizeRunHistoryV2 } from './runHistoryV2Summary';
import type { GameState, RandomSource } from './types';

const constant: RandomSource = { next: () => .01 };

function game(investment = 40): GameState {
  const state = newRun('bribery-test', constant).state;
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
  state.gold = 1_000;
  placeFlameInstance(state, 'bribery', investment);
  for (const die of rosterDice(state)) die.value = 1;
  syncActiveDiceProjection(state);
  return state;
}

function invest(state: GameState, amount = 1): GameState {
  for (let index = 0; index < amount; index++) state = dispatch(state, { type: 'ACTIVATE_BRIBERY' }, constant).state;
  return state;
}

describe('Bribery one-Gold investment', () => {
  it('scales linearly with Flame investment and has a documented 20G Round cap', () => {
    expect([0, 25, 40, 50, 100].map(briberyXMultPerGold)).toEqual([0, .125, .2, .25, .5]);
    expect(briberyFactor(40, 1)).toBe(1.2);
    expect(briberyFactor(40, 20)).toBe(5);
    expect(briberyFactor(100, 20)).toBe(11);
    expect(BRIBERY_ROUND_GOLD_CAP).toBe(20);
  });

  it('deducts exactly 1G immediately, records pending XMult, and enforces strength, Gold, and cap rules', () => {
    const cold = game(0);
    expect(validateAction(cold, { type: 'ACTIVATE_BRIBERY' })).toContain('needs investment');
    const poor = game(); poor.gold = 0;
    expect(validateAction(poor, { type: 'ACTIVATE_BRIBERY' })).toContain('1 required');

    let state = invest(game(), BRIBERY_ROUND_GOLD_CAP);
    expect(state.gold).toBe(1_000 - BRIBERY_ROUND_GOLD_CAP);
    expect(state.stats.goldSpentBySource.bribery).toBe(BRIBERY_ROUND_GOLD_CAP);
    expect(state.interactiveFlames).toMatchObject({ briberyGoldSpentThisRound: 20, briberyPendingGold: 20 });
    expect(validateAction(state, { type: 'ACTIVATE_BRIBERY' })).toContain('20 Gold Round cap');
    expect(state.historyV2.filter(event => event.kind === 'flame_action' && event.flame === 'bribery'
      && event.action.type === 'bribery_invested')).toHaveLength(20);
  });
});

describe('Bribery scoring and lifecycle', () => {
  it('applies pending Gold as one factor to the next manual Play, then allows no more than 20G total that Round', () => {
    let state = invest(game(), 5);
    const goldBeforePlay = state.gold;
    state = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [rosterDice(state)[0].id] }, constant).state;
    const factors = state.stats.handScores.at(-1)!.xMultFactors.filter(factor => factor.source === 'bribery');
    expect(factors).toEqual([expect.objectContaining({ source: 'bribery', value: 2, input: 5 })]);
    expect(state.interactiveFlames).toMatchObject({ briberyGoldSpentThisRound: 5, briberyPendingGold: 0 });
    expect(state.gold).toBe(goldBeforePlay);
    state = invest(state, 15);
    expect(state.interactiveFlames).toMatchObject({ briberyGoldSpentThisRound: 20, briberyPendingGold: 15 });
    const diagnostics = summarizeRunHistoryV2(state.historyV2, state).experienced.flames.bribery?.diagnostics;
    expect(diagnostics).toMatchObject({ briberyPurchases: 20, briberyGoldSpent: 20,
      briberyPayoffHands: 1, briberyMaxStack: 15, briberyMaxFactor: 4 });
  });

  it('ignores Free Plays and resets pending and spent Gold at the next Round', () => {
    const state = invest(game(), 3);
    new Resolver(state, constant).play('ones', [rosterDice(state)[0].id], 'freePlay');
    expect(state.interactiveFlames.briberyPendingGold).toBe(3);
    expect(state.stats.handScores.at(-1)!.xMultFactors.some(factor => factor.source === 'bribery')).toBe(false);

    state.phase = 'shop';
    state.shop = { stage: 'shop', offers: [], offerRerolls: 0, lifeRestores: 0 };
    new Resolver(state, constant).startRound();
    expect(state.interactiveFlames).toMatchObject({ briberyGoldSpentThisRound: 0, briberyPendingGold: 0 });
    expect(flameByType(state, 'bribery')?.investedGold).toBe(40);
    expect(state.historyV2.some(event => event.kind === 'flame_action' && event.flame === 'bribery'
      && event.action.type === 'bribery_round_reset')).toBe(true);
  });
});
