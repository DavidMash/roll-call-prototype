import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import type { Enhancement, GameState, RandomSource, Rank } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });

function game(values: Rank[] = [4, 4, 4, 2, 6]): GameState {
  const state = newRun('history-v2-characterization', constant()).state;
  state.dice.forEach((die, index) => { die.value = values[index]; });
  state.target = 1_000_000;
  state.stats.rounds[0].target = state.target;
  return state;
}

function enhance(state: GameState, dieId: number, enhancement: Enhancement, stacks = 1, rank?: Rank): void {
  const face = state.dice[dieId].faces[(rank ?? state.dice[dieId].value) - 1];
  face.enhancements[enhancement] = stacks;
  if (enhancement === 'vintage') face.vintageSellValue = 0;
}

describe('Run History V2 characterization', () => {
  it('keeps a rich hand auditable in one structured event', () => {
    const state = game();
    enhance(state, 0, 'bonus');
    enhance(state, 0, 'teamwork');
    enhance(state, 0, 'tank');
    enhance(state, 0, 'doubleTime');
    enhance(state, 0, 'workout');
    enhance(state, 0, 'personalTrainer');
    enhance(state, 1, 'loneWolf');
    enhance(state, 2, 'golden');
    enhance(state, 3, 'hitchhiker');

    const result = dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant());
    expect(result.error).toBeUndefined();
    expect(result.state.score).toBeGreaterThan(0);
    expect(result.state.gold).toBe(1);
    expect(result.state.dice[0].faces[3].workoutPips).toBeGreaterThan(0);
    expect(result.state.handLevels.threeKind).toBeGreaterThan(1);

    const hand = result.state.historyV2.find(event => event.kind === 'hand_scored');
    expect(hand?.kind).toBe('hand_scored');
    if (hand?.kind !== 'hand_scored') throw new Error('Missing structured hand');
    expect(hand.pipsContributions.map(item => item.source)).toEqual(expect.arrayContaining(['bonus', 'teamwork', 'lone_wolf']));
    expect(hand.scoringDice.some(die => die.role === 'hitchhiker')).toBe(true);
    expect(hand.multContributions.map(item => item.source)).toContain('tank');
    expect(hand.checks.map(item => item.source)).toEqual(expect.arrayContaining(['doubleTime', 'personalTrainer', 'hitchhiker']));
    expect(hand.sideEffects.map(item => item.type)).toEqual(expect.arrayContaining(['workout', 'personal_trainer', 'gold', 'double_time']));
    expect(result.state.history).toEqual([]);
  });

  it('keeps attached Flame, Bonfire, Wildfire, Charge, and Boss factors explicit', () => {
    const state = game([4, 4, 4, 4, 4]);
    state.dice[0].flame = { id: 'vineyard', investedGold: 50 };
    enhance(state, 0, 'vintage');
    state.bonfires = ['lowball', 'momentum'];
    state.wildfires = [{ flame: 'boxSet', sacrificedFlame: 'minigun', sacrificedAverage: 5,
      transferMultiplier: 10, resolved: { kind: 'xMult', baseMax: 9, max: 90 } }];
    state.handFamilyFlameStages.boxSet = 'payoff';
    state.chargeXMult = 3;
    state.chargeArmed = true;
    state.boss = { type: 'fly', flyHand: 'ones', caught: false, moves: 0 };

    const result = dispatch(state, { type: 'PLAY', hand: 'fiveKind', dieIds: [0, 1, 2, 3, 4] }, constant());
    const score = result.state.stats.handScores.at(-1)!;
    expect(score.xMultFactors.map(factor => factor.source)).toEqual(['charge', 'lowball', 'boxSet', 'vineyard']);
    expect(score.bossFactor).toBe(.5);
    expect(result.state.chargeXMult).toBeGreaterThan(1);
    expect(result.state.chargeArmed).toBe(false);
    const hand = result.state.historyV2.find(event => event.kind === 'hand_scored');
    expect(hand?.kind === 'hand_scored' ? hand.xMultContributions.map(item => [item.sourceId, item.origin]) : [])
      .toEqual(expect.arrayContaining([['charge', 'charge'], ['lowball', 'bonfire'], ['boxSet', 'wildfire'], ['vineyard', 'ember']]));
    expect(hand?.kind === 'hand_scored' ? hand.score.bossFactor : 1).toBe(.5);
    expect(hand?.kind === 'hand_scored' ? hand.sideEffects : []).toContainEqual(expect.objectContaining({ type: 'charge', operation: 'consume_reset' }));
  });

  it('keeps manual, automatic, Magnetic, Bump, Weighted, and Boss-controlled rolls observable', () => {
    const state = game([1, 2, 3, 4, 5]);
    enhance(state, 0, 'bump');
    enhance(state, 1, 'magnetic');
    enhance(state, 2, 'magnetic', 1, 6);
    enhance(state, 3, 'weighted');
    state.manualRerollsRemaining = 5;

    const manual = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 2, 3] }, constant());
    const batch = manual.state.historyV2.find(event => event.kind === 'roll_batch' && event.reason === 'manual');
    expect(batch?.kind).toBe('roll_batch');
    if (batch?.kind !== 'roll_batch') throw new Error('Missing structured roll batch');
    expect(batch.results).toHaveLength(3);
    expect(batch.results.some(result => result.bump !== null)).toBe(true);
    expect(batch.results.some(result => result.magneticAnchorIds.length > 0)).toBe(true);

    const clockmaker = game();
    clockmaker.boss = { type: 'clockmaker' };
    new Resolver(clockmaker, constant()).rollBatch([0], 'characterization', 'gameplay');
    const bossBatch = [...clockmaker.historyV2].reverse().find(event => event.kind === 'roll_batch');
    expect(bossBatch?.kind === 'roll_batch' ? bossBatch.results[0].bump : null).toEqual({ source: 'clockmaker' });
  });

  it('keeps Shop, Flame, Bonfire, and life-restoration transactions observable', () => {
    const state = game();
    state.phase = 'shop';
    state.gold = 200;
    state.lives = 2;
    state.shop = { kind: 'between_rounds', offers: [{ id: 101, enhancement: 'bonus', purchased: false }],
      trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0,
      freeEnhancementOfferIds: [], freeTrainingOfferKeys: [] };

    const bought = dispatch(state, { type: 'BUY', offerId: 101, dieId: 0 }, constant()).state;
    const rerolled = dispatch(bought, { type: 'REROLL_OFFERS' }, constant()).state;
    const restored = dispatch(rerolled, { type: 'RESTORE_LIFE' }, constant()).state;
    restored.dice[0].flame = { id: 'ultimate', investedGold: 99 };
    const stoked = dispatch(restored, { type: 'STOKE_FLAME', dieId: 0, amount: 1 }, constant()).state;

    const transactions = stoked.historyV2.flatMap(event => event.kind === 'shop_transaction' ? [event.transaction.type] : []);
    expect(transactions).toEqual(expect.arrayContaining(['enhancement_purchased', 'life_restored']));
    const flames = stoked.historyV2.flatMap(event => event.kind === 'flame_changed' ? [event.change.type] : []);
    expect(flames).toEqual(expect.arrayContaining(['stoked', 'bonfire_created']));
    expect(stoked.historyV2.some(event => event.kind === 'shop_offers_presented' && event.reason === 'reroll')).toBe(true);
    expect(stoked.bonfires).toContain('ultimate');
  });

  it('records a stable serialized legacy baseline for a deterministic mixed resolution', () => {
    const state = game([2, 2, 2, 4, 5]);
    enhance(state, 0, 'bonus', 2);
    enhance(state, 1, 'workout');
    enhance(state, 2, 'golden');
    state.bonfires = ['ultimate'];
    const result = dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant(.4));
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
    expect({
      historyEntries: result.state.history.length,
      legacyHistoryBytes: bytes(result.state.history),
      runStatsBytes: bytes(result.state.stats),
    }).toMatchInlineSnapshot(`
      {
        "historyEntries": 0,
        "legacyHistoryBytes": 2,
        "runStatsBytes": 2629,
      }
    `);
  });
});
