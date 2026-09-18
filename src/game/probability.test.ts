import { describe, expect, it, vi } from 'vitest';
import { dispatch, newRun } from './engine';
import { diminishingHalfChance } from './enhancements';
import type { GameState, RandomSource, Rank } from './types';

const constant = (value: number): RandomSource => ({ next: () => value });
function sequence(...values: number[]): RandomSource {
  let index = 0;
  return { next: () => values[index++] ?? 0.99 };
}
function board(values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const game = newRun('sticky-probability', constant(0.99)).state;
  game.dice.forEach((die, index) => { die.value = values[index]; });
  game.target = 100000;
  game.stats.rounds[0].target = game.target;
  return game;
}
function enhance(game: GameState, enhancement: 'sticky' | 'slippy' | 'jumpingBean', count = 1, rank?: Rank) {
  game.dice[0].faces[(rank ?? game.dice[0].value) - 1].enhancements[enhancement] = count;
}
const play = (game: GameState, rng: RandomSource) =>
  dispatch(game, { type: 'PLAY', hand: 'ones', dieIds: [0] }, rng);

describe('Sticky probability', () => {
  it.each([[1, 0.5], [2, 0.75], [3, 0.875], [4, 0.9375]] as const)
  ('uses diminishing half chance for x%s', (stacks, chance) => {
    expect(diminishingHalfChance(stacks)).toBe(chance);
  });

  it('never becomes additive certainty at two stacks', () => {
    expect(diminishingHalfChance(2)).toBe(0.75);
    expect(diminishingHalfChance(2)).not.toBe(1);
    expect(diminishingHalfChance(10_000)).toBeLessThan(1);
  });

  it('uses one seeded check and suppresses a scored reroll on success', () => {
    const game = board();
    enhance(game, 'sticky');
    const rng = { next: vi.fn(() => 0.49) };
    const result = play(game, rng);
    expect(result.state.dice[0].value).toBe(1);
    expect(result.events.filter(event => event.type === 'DIE_ROLLED')).toHaveLength(0);
    expect(result.events.filter(event => event.enhancement === 'sticky')).toHaveLength(1);
    expect(result.state.stats.probabilityProcs.sticky)
      .toEqual({ checks: 1, successes: 1, failures: 0, stacksAtCheck: [1] });
    expect(rng.next).toHaveBeenCalledTimes(1);
  });

  it('allows the scored reroll on failure without a prominent Sticky tick', () => {
    const game = board();
    enhance(game, 'sticky');
    const result = play(game, sequence(0.5, 0.99));
    expect(result.state.dice[0].value).toBe(6);
    expect(result.events.filter(event => event.type === 'DIE_ROLLED')).toHaveLength(1);
    expect(result.events.some(event => event.enhancement === 'sticky')).toBe(false);
    expect(result.state.history.find(event => event.type === 'ABILITY_CHECKED'))
      .toMatchObject({ probability: { enhancement: 'sticky', stacks: 1, chance: 0.5, succeeded: false } });
  });

  it.each([
    { name: 'success', check: 0.49 },
    { name: 'failure', check: 0.5 },
  ])('deduplicates the shared post-hand batch when Sticky $name combines with Slippy', ({ check }) => {
    const game = board();
    enhance(game, 'sticky');
    enhance(game, 'slippy');
    const result = play(game, sequence(check, 0.99));
    expect(result.events.filter(event => event.type === 'DICE_REROLL_STARTED').map(event => event.dieIds)).toEqual([[0]]);
    expect(result.events.filter(event => event.type === 'DIE_ROLLED')).toHaveLength(1);
  });

  it('prevents a Jumping Bean automatic reroll on success', () => {
    const game = board();
    enhance(game, 'jumpingBean', 1, 6);
    enhance(game, 'sticky', 1, 6);
    const result = play(game, sequence(0.99, 0.49));
    expect(result.events.filter(event => event.type === 'DIE_ROLLED').map(event => event.face)).toEqual([6]);
    expect(result.events.filter(event => event.enhancement === 'sticky')).toHaveLength(1);
    expect(result.state.stats.probabilityProcs.sticky.successes).toBe(1);
  });

  it('allows a Jumping Bean automatic reroll on failure', () => {
    const game = board();
    enhance(game, 'jumpingBean', 1, 6);
    enhance(game, 'sticky', 1, 6);
    const result = play(game, sequence(0.99, 0.5, 0));
    expect(result.events.filter(event => event.type === 'DIE_ROLLED').map(event => event.face)).toEqual([6, 1]);
    expect(result.events.some(event => event.enhancement === 'sticky')).toBe(false);
    expect(result.state.stats.probabilityProcs.sticky.failures).toBe(1);
  });

  it('does not check Sticky for a player-paid manual reroll', () => {
    const game = board();
    enhance(game, 'sticky', 4);
    const result = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0.99));
    expect(result.state.dice[0].value).toBe(6);
    expect(result.state.stats.probabilityProcs.sticky.checks).toBe(0);
  });

  it('does not check Sticky for a shop reroll', () => {
    const game = board();
    enhance(game, 'sticky', 4);
    game.phase = 'shop';
    game.gold = 10;
    game.shop = { offers: [], diceRerolls: 0, offerRerolls: 0 };
    const result = dispatch(game, { type: 'REROLL_DICE' }, constant(0.99));
    expect(result.state.dice[0].value).toBe(6);
    expect(result.state.stats.probabilityProcs.sticky.checks).toBe(0);
  });
});
