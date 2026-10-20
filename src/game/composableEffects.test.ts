import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { planQualification } from './hands';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { createDieEffect, effectRuntime, resetDieRoundState } from './specialDice';
import type { GameState, RandomSource, Rank, SpecialDieType } from './types';

const constant = (value = .99): RandomSource => ({ next: () => value });
function state(values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const game = newRun('composable-effects', constant()).state;
  values.forEach((value, index) => { game.diceInventory.instances[index].value = value; });
  syncActiveDiceProjection(game); game.target = 1_000_000n; game.stats.rounds.at(-1)!.target = game.target;
  return game;
}
function effects(game: GameState, dieId: number, values: Array<[SpecialDieType, number]>) {
  game.diceInventory.instances[dieId].effects = values.map(([type, level]) => createDieEffect(dieId, type, level));
  syncActiveDiceProjection(game); game.dieRoundState = resetDieRoundState(rosterDice(game));
  return game.diceInventory.instances[dieId];
}

describe('composable qualification planning', () => {
  it('prefers natural qualification and therefore spends zero effect Uses', () => {
    const game = state([4, 4, 3, 2, 1]);
    const die = effects(game, 0, [['mirror', 2], ['conjoined', 2]]);
    const plan = planQualification(rosterDice(game), 'pair', [die.id, 1], { roundState: game.dieRoundState });
    expect(plan.legal).toBe(true);
    expect(plan.resourceClaims).toEqual([]);
  });

  it('can combine Mirror and Conjoined on one die as a wildcard duplicate', () => {
    const game = state([3, 3, 3, 3, 6]);
    const die = effects(game, 0, [['mirror', 1], ['conjoined', 1]]);
    const plan = planQualification(rosterDice(game), 'fullHouse', [die.id, 1, 2, 3], { roundState: game.dieRoundState });
    expect(plan.legal).toBe(true);
    expect(plan.resourceClaims.map(claim => claim.effect)).toEqual(['mirror', 'conjoined']);
    expect(plan.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ effect: 'mirror' }),
      expect.objectContaining({ effect: 'conjoined', virtualDuplicateCount: 1 }),
    ]));
  });
});

describe('score expansion and once-per-hand effects', () => {
  it('expands Conjoined, then Double Time, then Lone Wolf multiplicatively without a cap', () => {
    const game = state([1, 2, 3, 4, 5]);
    const die = effects(game, 0, [['conjoined', 1], ['doubleTime', 4], ['loneWolf', 1], ['bonus', 1]]);
    const plan = planQualification(rosterDice(game), 'pair', [die.id], { roundState: game.dieRoundState });
    const result = dispatch(game, { type: 'PLAY', hand: 'pair', dieIds: [die.id],
      qualificationClaims: plan.resourceClaims.map(claim => ({ dieId: claim.dieId, effect: claim.effect, effectInstanceId: claim.effectInstanceId })) }, constant(.99));
    expect(result.error).toBeUndefined();
    const scored = result.state.historyV2.find(event => event.kind === 'hand_scored');
    expect(scored?.kind).toBe('hand_scored');
    if (scored?.kind !== 'hand_scored') return;
    expect(scored.scoreOccurrences).toHaveLength(8);
    expect(scored.pipsContributions.filter(item => item.source === 'special_die' && item.effectType === 'bonus')).toHaveLength(8);
  });

  it('spends Sustainable once for a hand even when the die has many Score occurrences', () => {
    const game = state([1, 2, 3, 4, 5]);
    const die = effects(game, 0, [['doubleTime', 8], ['loneWolf', 2], ['sustainable', 2]]);
    const sustainable = die.effects.find(effect => effect.type === 'sustainable')!;
    const result = dispatch(game, { type: 'PLAY', hand: 'ones', dieIds: [die.id] }, constant(.99));
    expect(result.error).toBeUndefined();
    expect(effectRuntime(result.state.dieRoundState[die.id], sustainable)?.invocationsRemaining).toBe(1);
    expect(result.state.consumed).not.toContain('ones');
  });

  it('pays Jackpot once for the winning Play regardless of expanded occurrences', () => {
    const game = state([1, 2, 3, 4, 5]);
    game.target = 1n; game.stats.rounds.at(-1)!.target = 1n;
    const die = effects(game, 0, [['doubleTime', 8], ['loneWolf', 2], ['jackpot', 2]]);
    const before = game.gold;
    const result = dispatch(game, { type: 'PLAY', hand: 'ones', dieIds: [die.id] }, constant(.99));
    expect(result.error).toBeUndefined();
    expect(result.state.stats.goldBySource.jackpot).toBe(6);
    expect(result.state.gold).toBeGreaterThanOrEqual(before + 6);
    expect(result.events.filter(event => event.type === 'GOLD_ADDED' && event.goldSource === 'jackpot')).toHaveLength(1);
  });
});
