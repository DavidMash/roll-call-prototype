import { describe, expect, it } from 'vitest';
import { Resolver } from './effects';
import { dispatch, newRun, validateAction } from './engine';
import { briberyFactor, briberyNextCost, briberyXMultIncrement, flameByType, placeFlameInstance } from './flames';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { scenarioById } from './scenarios';
import { summarizeRunHistoryV2 } from './runHistoryV2Summary';
import { createDieEffect, resetDieRoundState } from './specialDice';
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

function bribe(state: GameState): GameState {
  return dispatch(state, { type: 'ACTIVATE_BRIBERY' }, constant).state;
}

describe('Bribery formulas and escalating cost', () => {
  it('uses exact additive scaling at every required investment', () => {
    expect([0, 25, 40, 50, 100].map(briberyXMultIncrement)).toEqual([0, 1, 1.6, 2, 4]);
    expect([1, 2, 3, 4].map(count => briberyFactor(40, count))).toEqual([2.6, 4.2, 5.8, 7.4]);
    expect([1, 2, 3].map(count => briberyFactor(100, count))).toEqual([5, 9, 13]);
    expect([0, 1, 2, 3, 4].map(briberyNextCost)).toEqual([5, 10, 15, 20, 25]);
  });

  it('prevents zero-strength and unaffordable purchases', () => {
    const cold = game(0);
    expect(validateAction(cold, { type: 'ACTIVATE_BRIBERY' })).toContain('needs investment');
    const poor = game(); poor.gold = 4;
    expect(validateAction(poor, { type: 'ACTIVATE_BRIBERY' })).toContain('5 required');
  });

  it('deducts 5G, 10G, 15G, and 20G immediately and records purchase diagnostics', () => {
    let state = game();
    const startingGold = state.gold;
    for (let index = 0; index < 4; index++) state = bribe(state);
    expect(state.gold).toBe(startingGold - 50);
    expect(state.stats.goldSpentBySource.bribery).toBe(50);
    expect(state.interactiveFlames).toMatchObject({ briberyPurchasedThisRound: 4, briberyPendingCount: 4 });
    expect(state.historyV2.flatMap(event => event.kind === 'flame_action' && event.flame === 'bribery'
      && event.action.type === 'bribe_purchased'
      ? [[event.action.cost, event.action.ordinal, event.action.pendingFactor]] : []))
      .toEqual([[5, 1, 2.6], [10, 2, 4.2], [15, 3, 5.8], [20, 4, 7.4]]);
  });
});

describe('Bribery scoring and lifecycle', () => {
  it('stacks several Bribes as one factor, consumes them on one manual Hand, and keeps the escalated price', () => {
    let state = bribe(bribe(game()));
    const goldBeforePlay = state.gold;
    state = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [rosterDice(state)[0].id] }, constant).state;
    const factors = state.stats.handScores.at(-1)!.xMultFactors.filter(factor => factor.source === 'bribery');
    expect(factors).toEqual([expect.objectContaining({ source: 'bribery', value: 4.2, input: 2 })]);
    expect(state.interactiveFlames).toMatchObject({ briberyPurchasedThisRound: 2, briberyPendingCount: 0 });
    expect(state.stats.flameTriggers.bribery).toBe(1);
    expect(state.gold).toBe(goldBeforePlay);
    state = bribe(state);
    expect(state.gold).toBe(goldBeforePlay - 15);
    expect(state.interactiveFlames).toMatchObject({ briberyPurchasedThisRound: 3, briberyPendingCount: 1 });
    const diagnostics = summarizeRunHistoryV2(state.historyV2, state).experienced.flames.bribery?.diagnostics;
    expect(diagnostics).toMatchObject({ briberyPurchases: 3, briberyGoldSpent: 30,
      briberyPayoffHands: 1, briberyMaxStack: 2, briberyMaxFactor: 4.2 });
  });

  it('leaves Bribery armed across a Free Play and applies it only once across repeated Score occurrences', () => {
    const state = bribe(game());
    const resolver = new Resolver(state, constant);
    resolver.play('ones', [rosterDice(state)[0].id], 'freePlay');
    expect(state.interactiveFlames.briberyPendingCount).toBe(1);
    expect(state.stats.handScores.at(-1)!.xMultFactors.some(factor => factor.source === 'bribery')).toBe(false);

    const die = rosterDice(state)[1];
    die.effects = [createDieEffect(die.id, 'doubleTime', 8)];
    state.dieRoundState = resetDieRoundState(rosterDice(state));
    die.value = 1; syncActiveDiceProjection(state);
    resolver.play('ones', [die.id]);
    const hand = state.historyV2.filter(event => event.kind === 'hand_scored').at(-1);
    expect(hand?.kind === 'hand_scored' ? hand.scoreOccurrences.length : 0).toBeGreaterThan(1);
    expect(state.stats.handScores.at(-1)!.xMultFactors.filter(factor => factor.source === 'bribery')).toHaveLength(1);
    expect(state.interactiveFlames.briberyPendingCount).toBe(0);
  });

  it('resets pending Bribes and price at a new Round without changing permanent investment', () => {
    const state = bribe(bribe(game()));
    state.phase = 'shop';
    state.shop = { stage: 'shop', offers: [], offerRerolls: 0, lifeRestores: 0 };
    new Resolver(state, constant).startRound();
    expect(state.interactiveFlames).toMatchObject({ briberyPurchasedThisRound: 0, briberyPendingCount: 0 });
    expect(briberyNextCost(state.interactiveFlames.briberyPurchasedThisRound)).toBe(5);
    expect(flameByType(state, 'bribery')?.investedGold).toBe(40);
    expect(state.historyV2.some(event => event.kind === 'flame_action' && event.flame === 'bribery'
      && event.action.type === 'bribery_round_reset')).toBe(true);
  });

  it('restores Gold and Bribery state from the Round checkpoint after a rollback', () => {
    let state = newRun('money-bags-rollback', constant, { scenario: scenarioById('money-bags')! }).state;
    state = bribe(state);
    expect(state).toMatchObject({ gold: 10, interactiveFlames: { briberyPurchasedThisRound: 1, briberyPendingCount: 1 } });
    new Resolver(state, constant).retreat();
    expect(state.gold).toBe(15);
    expect(state.interactiveFlames).toMatchObject({ briberyPurchasedThisRound: 0, briberyPendingCount: 0 });
    expect(flameByType(state, 'bribery')?.investedGold).toBe(40);
  });

  it('uses the same Gold balance as Furnace and later Golden earnings', () => {
    let state = newRun('money-bags-shared-gold', constant, { scenario: scenarioById('money-bags')! }).state;
    const furnaceDie = rosterDice(state)[0];
    state = dispatch(state, { type: 'FEED_FURNACE', dieId: furnaceDie.id, amount: 5 }, constant).state;
    expect(state.gold).toBe(10);
    state = bribe(state);
    expect(state.gold).toBe(5);
    expect(validateAction(state, { type: 'ACTIVATE_BRIBERY' })).toContain('10 required');
    new Resolver(state, constant).addGold(10, 'Golden test earnings', 'golden', furnaceDie.id);
    state = bribe(state);
    expect(state.gold).toBe(5);
    expect(state.stats.goldSpentBySource).toMatchObject({ furnace: 5, bribery: 15, flameInvestment: 0 });
    expect(state.lifetimeNormalShopGoldSpent).toBe(0);
  });
});

describe('Money Bags Bribery integration', () => {
  it('starts at version 2 with 40/100 Bribery, 15G, and unfed Furnaces', () => {
    const definition = scenarioById('money-bags')!;
    let state = newRun('money-bags-bribery', constant, { scenario: definition }).state;
    expect(definition.version).toBe(2);
    expect(flameByType(state, 'bribery')).toMatchObject({ investedGold: 40, stage: 'ember' });
    expect(state.gold).toBe(15);
    expect(Object.values(state.dieRoundState).flatMap(runtime => Object.values(runtime.effects))
      .filter(effect => effect.type === 'furnace').every(effect => effect.furnaceGoldFed === 0)).toBe(true);
    state = bribe(state);
    expect(state.gold).toBe(10);
    state = bribe(state);
    expect(state.gold).toBe(0);
    expect(briberyFactor(40, state.interactiveFlames.briberyPendingCount)).toBe(4.2);
  });
});
