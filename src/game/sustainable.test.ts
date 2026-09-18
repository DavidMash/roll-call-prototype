import { describe, expect, it, vi } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { diminishingHalfChance } from './enhancements';
import type { GameState, HandId, RandomSource, Rank } from './types';

const constant = (value: number): RandomSource => ({ next: () => value });
function sequence(...values: number[]): RandomSource {
  let index = 0;
  return { next: () => values[index++] ?? 0.99 };
}
function board(values: Rank[] = [4, 2, 4, 1, 6]): GameState {
  const game = newRun('sustainable-probability', constant(0.99)).state;
  game.dice.forEach((die, index) => { die.value = values[index]; });
  game.target = 1000;
  game.stats.rounds[0].target = game.target;
  return game;
}
function enhance(game: GameState, dieId: number, enhancement: 'sticky' | 'sustainable' | 'hitchhiker', count = 1) {
  activeFace(game.dice[dieId]).enhancements[enhancement] = count;
}
const play = (game: GameState, rng: RandomSource, dieIds = [0], hand: HandId = 'fours') =>
  dispatch(game, { type: 'PLAY', hand, dieIds }, rng);

describe('Sustainable probability', () => {
  it.each([[1, 0.5], [2, 0.75], [3, 0.875], [4, 0.9375]] as const)
  ('uses diminishing half chance for x%s', (stacks, chance) => {
    expect(diminishingHalfChance(stacks)).toBe(chance);
  });

  it('never reaches mathematical certainty for a finite stack count', () => {
    expect(diminishingHalfChance(10_000)).toBeLessThan(1);
  });

  it('preserves with one stack below 50% and records one successful check', () => {
    const game = board();
    enhance(game, 0, 'sustainable');
    const result = play(game, sequence(0.49, 0));
    expect(result.state.consumed).not.toContain('fours');
    expect(result.events.filter(event => event.enhancement === 'sustainable')).toHaveLength(1);
    expect(result.state.history.find(event => event.type === 'ABILITY_CHECKED' && event.probability?.enhancement === 'sustainable'))
      .toMatchObject({ probability: { stacks: 1, chance: 0.5, succeeded: true } });
    expect(result.state.stats.probabilityProcs.sustainable)
      .toEqual({ checks: 1, successes: 1, failures: 0, stacksAtCheck: [1] });
  });

  it('consumes with one stack at 50% and emits no prominent Sustainable tick', () => {
    const game = board();
    enhance(game, 0, 'sustainable');
    const result = play(game, sequence(0.5, 0));
    expect(result.state.consumed).toContain('fours');
    expect(result.events.some(event => event.enhancement === 'sustainable')).toBe(false);
    expect(result.state.history.find(event => event.type === 'ABILITY_CHECKED'))
      .toMatchObject({ probability: { stacks: 1, chance: 0.5, succeeded: false } });
    expect(result.state.stats.probabilityProcs.sustainable)
      .toEqual({ checks: 1, successes: 0, failures: 1, stacksAtCheck: [1] });
  });

  it('combines stacks across all selected participating faces in one check', () => {
    const game = board();
    enhance(game, 0, 'sustainable', 1);
    enhance(game, 2, 'sustainable', 2);
    const rng = { next: vi.fn(() => 0.874) };
    const result = play(game, rng, [2, 0]);
    expect(result.state.consumed).not.toContain('fours');
    expect(result.state.stats.probabilityProcs.sustainable.stacksAtCheck).toEqual([3]);
    expect(result.state.history.find(event => event.probability?.enhancement === 'sustainable'))
      .toMatchObject({ dieIds: [0, 2], probability: { stacks: 3, chance: 0.875, succeeded: true } });
    expect(rng.next).toHaveBeenCalledTimes(3); // One combined proc check, then two ordinary die rolls.
  });

  it.each([false, true])('ignores unselected Sustainable, including Hitchhikers (hitchhiker=%s)', hitchhiker => {
    const game = board();
    enhance(game, 2, 'sustainable', 3);
    if (hitchhiker) enhance(game, 2, 'hitchhiker');
    const result = play(game, constant(0));
    expect(result.state.consumed).toContain('fours');
    expect(result.state.stats.probabilityProcs.sustainable.checks).toBe(0);
    expect(result.events.some(event => event.enhancement === 'sustainable')).toBe(false);
  });

  it('can succeed repeatedly on the same physical face in one round without spent state', () => {
    const game = board();
    enhance(game, 0, 'sustainable');
    enhance(game, 0, 'sticky');
    const first = play(game, sequence(0, 0));
    const second = play(first.state, sequence(0, 0));
    expect(first.state.dice[0].value).toBe(4);
    expect(second.state.dice[0].value).toBe(4);
    expect(second.state.consumed).not.toContain('fours');
    expect(second.state.stats.probabilityProcs.sustainable)
      .toEqual({ checks: 2, successes: 2, failures: 0, stacksAtCheck: [1, 1] });
    expect('sustainableUsedThisRound' in activeFace(second.state.dice[0])).toBe(false);
  });

  it('can fail and consume after an earlier success in the same round', () => {
    const game = board();
    enhance(game, 0, 'sustainable');
    enhance(game, 0, 'sticky');
    const first = play(game, sequence(0, 0));
    const second = play(first.state, sequence(0.5, 0));
    expect(second.state.consumed).toContain('fours');
    expect(second.state.stats.probabilityProcs.sustainable)
      .toEqual({ checks: 2, successes: 1, failures: 1, stacksAtCheck: [1, 1] });
    expect(second.events.some(event => event.enhancement === 'sustainable')).toBe(false);
  });

  it('resolves Sustainable and Sticky as independent checks', () => {
    const game = board();
    enhance(game, 0, 'sustainable');
    enhance(game, 0, 'sticky');
    const rng = { next: vi.fn().mockReturnValueOnce(0.49).mockReturnValueOnce(0.49) };
    const result = play(game, rng);
    expect(result.state.consumed).not.toContain('fours');
    expect(result.state.dice[0].value).toBe(4);
    expect(result.state.stats.probabilityProcs.sustainable.successes).toBe(1);
    expect(result.state.stats.probabilityProcs.sticky.successes).toBe(1);
    expect(rng.next).toHaveBeenCalledTimes(2);
  });

  it('requires no round reset state and remains available next round', () => {
    const game = board();
    enhance(game, 0, 'sustainable', 2);
    const first = play(game, sequence(0, 0)).state;
    first.phase = 'shop';
    first.shop = { offers: [], diceRerolls: 0, offerRerolls: 0 };
    const next = dispatch(first, { type: 'NEXT_ROUND' }, constant(0.55));
    expect(next.state.dice[0].faces[3].enhancements.sustainable).toBe(2);
    expect(next.state.dice.flatMap(die => die.faces).every(face => !('sustainableUsedThisRound' in face))).toBe(true);
  });

  it('audits but does not prominently animate a successful check on a winning hand', () => {
    const game = board();
    game.target = 14;
    enhance(game, 0, 'sustainable');
    const result = play(game, constant(0));
    expect(result.state.phase).toBe('shop');
    expect(result.state.consumed).not.toContain('fours');
    expect(result.state.stats.probabilityProcs.sustainable.successes).toBe(1);
    expect(result.state.stats.triggers.sustainable).toBe(1);
    expect(result.events.some(event => event.enhancement === 'sustainable')).toBe(false);
    expect(result.events.some(event => event.type === 'POST_HAND_REROLLS_SKIPPED')).toBe(true);
  });

  it('replays identical probability decisions from the same seed and action', () => {
    const game = board();
    enhance(game, 0, 'sustainable', 2);
    enhance(game, 0, 'sticky', 2);
    const before = structuredClone(game);
    const action = { type: 'PLAY' as const, hand: 'fours' as const, dieIds: [0] };
    expect(dispatch(game, action)).toEqual(dispatch(game, action));
    expect(game).toEqual(before);
  });
});
