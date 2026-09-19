import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { diminishingHalfChance } from './enhancements';
import { isValidSelection } from './hands';
import type { Enhancement, GameState, RandomSource, Rank } from './types';

const constant = (value: number): RandomSource => ({ next: () => value });
function state(values: Rank[] = [4, 4, 4, 2, 6]): GameState {
  const game = newRun('hitchhiker-v2', constant(0.99)).state;
  game.dice.forEach((die, index) => { die.value = values[index]; });
  game.target = 100000;
  game.stats.rounds[0].target = game.target;
  return game;
}
function enhance(game: GameState, dieId: number, enhancement: Enhancement, count = 1) {
  activeFace(game.dice[dieId]).enhancements[enhancement] = count;
}
const play = (game: GameState, rng: RandomSource) => dispatch(game, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, rng);

describe('revised Hitchhiker', () => {
  it('uses the shared diminishing formula and one combined check per showing face', () => {
    expect([1, 2, 3, 4].map(diminishingHalfChance)).toEqual([0.5, 0.75, 0.875, 0.9375]);
    const game = state();
    enhance(game, 4, 'hitchhiker', 3);
    const result = play(game, constant(0.8));
    expect(result.state.stats.probabilityProcs.hitchhiker).toEqual({ checks: 1, successes: 1, failures: 0, stacksAtCheck: [3] });
    expect(result.state.history.find(event => event.probability?.enhancement === 'hitchhiker')?.probability).toMatchObject({ stacks: 3, chance: 0.875, succeeded: true });
  });

  it('success joins the scoring hand while failure does not, reproducibly', () => {
    const success = state();
    enhance(success, 4, 'hitchhiker');
    const a = play(structuredClone(success), constant(0));
    const b = play(structuredClone(success), constant(0));
    expect(a.state.score).toBe(70); // (10 base + 12 selected + 6 Hitchhiker) ×2.5
    expect(b.state.score).toBe(a.state.score);
    expect(a.state.stats.hitchhikerPipsContributed).toBe(6);
    expect(a.events.some(event => event.enhancement === 'hitchhiker')).toBe(true);
    const failed = play(success, constant(0.99));
    expect(failed.state.score).toBe(55);
    expect(failed.events.some(event => event.enhancement === 'hitchhiker')).toBe(false);
  });

  it('never helps form the selected hand', () => {
    const game = state([4, 4, 4, 2, 6]);
    enhance(game, 2, 'hitchhiker');
    expect(isValidSelection(game.dice, 'threeKind', [0, 1])).toBe(false);
    expect(isValidSelection(game.dice, 'threeKind', [0, 1, 2])).toBe(true);
  });

  it('success applies Bonus, Multiplier, Golden, Workout, and Sustainable', () => {
    const game = state();
    for (const enhancement of ['hitchhiker', 'bonus', 'multiplier', 'golden', 'workout', 'sustainable'] as Enhancement[]) enhance(game, 4, enhancement);
    const result = play(game, constant(0));
    expect(result.state.stats.handScores[0]).toMatchObject({ pips: 38, multiplier: 3, xMult: 1, score: 114, hitchhikerPips: 16 });
    expect(result.state.gold).toBe(1);
    expect(result.state.dice[4].faces[5].workoutPips).toBe(1);
    expect(result.state.consumed).not.toContain('threeKind');
    expect(result.state.stats.probabilityProcs.sustainable.checks).toBe(1);
  });

  it('does not receive the normal scoring reroll, while its Slippy still rerolls it', () => {
    const held = state();
    enhance(held, 4, 'hitchhiker');
    const noSlippy = play(held, constant(0));
    expect(noSlippy.events.filter(event => event.type === 'DICE_REROLL_STARTED').at(-1)?.dieIds).toEqual([0, 1, 2]);
    const slippery = state();
    enhance(slippery, 4, 'hitchhiker');
    enhance(slippery, 4, 'slippy');
    const withSlippy = play(slippery, constant(0));
    expect(withSlippy.events.filter(event => event.type === 'DICE_REROLL_STARTED').at(-1)?.dieIds).toEqual([0, 1, 2, 4]);
  });

  it('successful Hitchhiker cannot Jackpot, but a failed one can', () => {
    const success = state();
    success.target = 1;
    success.stats.rounds[0].target = 1;
    enhance(success, 4, 'hitchhiker');
    enhance(success, 4, 'jackpot');
    const joined = play(success, constant(0));
    expect(joined.state.stats.goldBySource.jackpot).toBe(0);
    expect(joined.state.history.some(event => event.message.includes('scored in winning hand'))).toBe(true);

    const failure = state();
    failure.target = 1;
    failure.stats.rounds[0].target = 1;
    enhance(failure, 4, 'hitchhiker');
    enhance(failure, 4, 'jackpot');
    const held = play(failure, constant(0.99));
    expect(held.state.stats.goldBySource.jackpot).toBe(3);
  });
});
