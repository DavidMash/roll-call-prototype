import { describe, expect, it } from 'vitest';
import { CONFIG, roundReward } from './config';
import { dispatch, newRun } from './engine';
import { ENHANCEMENTS, enhancementCost } from './enhancements';
import type { Enhancement, GameState, RandomSource, Rank } from './types';

const constant = (value = 0.99): RandomSource => ({ next: () => value });
function sequence(...values: number[]): RandomSource {
  let index = 0;
  return { next: () => values[index++] ?? 0.99 };
}
function board(values: Rank[] = [4, 4, 2, 5, 6], score = 26, target = 50): GameState {
  const game = newRun('jackpot-unit', constant()).state;
  game.dice.forEach((die, index) => { die.value = values[index]; });
  game.score = score;
  game.target = target;
  game.stats.rounds[0].target = target;
  game.stats.rounds[0].finalScore = score;
  return game;
}
function enhance(game: GameState, dieId: number, enhancement: Enhancement, count = 1, rank?: Rank) {
  game.dice[dieId].faces[(rank ?? game.dice[dieId].value) - 1].enhancements[enhancement] = count;
}
const playPair = (game: GameState, rng: RandomSource = constant()) =>
  dispatch(game, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, rng);

describe('round-clearing scoring Jackpot', () => {
  it('is a 3-Gold enhancement capped at three stacks', () => {
    expect(CONFIG.jackpotGold).toBe(3);
    expect(enhancementCost('jackpot')).toBe(3);
    expect(ENHANCEMENTS.jackpot).toMatchObject({ stackable: true, maxStacks: 3 });
  });

  it.each([[1, 3], [2, 6], [3, 9]] as const)
  ('pays %s scoring stack(s) as %s Gold when the hand clears', (stackCount, payout) => {
    const game = board();
    enhance(game, 0, 'jackpot', stackCount);
    const result = playPair(game);
    const interest = Math.min(10, Math.floor(payout / 5));
    expect(result.state.phase).toBe('shop');
    expect(result.state.gold).toBe(payout + roundReward() + 3 + interest);
    expect(result.state.stats.goldBySource.jackpot).toBe(payout);
    expect(result.state.stats.triggers.jackpot).toBe(1);
    expect(result.events.find(event => event.goldSource === 'jackpot')).toMatchObject({ amount: payout, dieIds: [0] });
  });

  it('pays multiple scoring Jackpot faces in physical-die order', () => {
    const game = board();
    enhance(game, 0, 'jackpot', 2);
    enhance(game, 1, 'jackpot');
    const result = playPair(game);
    expect(result.state.stats.goldBySource.jackpot).toBe(9);
    expect(result.events.filter(event => event.goldSource === 'jackpot').map(event => [event.dieIds, event.amount]))
      .toEqual([[[0], 6], [[1], 3]]);
  });

  it('does not pay below target or from a non-scoring face', () => {
    const below = board(undefined, 0, 100);
    enhance(below, 0, 'jackpot', 3);
    expect(playPair(below, constant(0)).state.stats.goldBySource.jackpot).toBe(0);

    const held = board();
    enhance(held, 4, 'jackpot', 3);
    const result = playPair(held);
    expect(result.state.stats.goldBySource.jackpot).toBe(0);
    expect(result.state.history.find(event => event.enhancement === 'jackpot' && event.dieIds?.includes(4))?.message)
      .toContain('did not score');
  });

  it('pays a successful scoring Hitchhiker and never pays a failed one', () => {
    const success = board(undefined, 17);
    enhance(success, 4, 'hitchhiker');
    enhance(success, 4, 'jackpot', 2);
    const joined = playPair(success, constant(0));
    expect(joined.state.score).toBe(50);
    expect(joined.state.stats.goldBySource.jackpot).toBe(6);

    const failure = board();
    enhance(failure, 4, 'hitchhiker');
    enhance(failure, 4, 'jackpot', 2);
    expect(playPair(failure, constant(0.99)).state.stats.goldBySource.jackpot).toBe(0);
  });

  it('pays a scoring Jumping Bean face when its free Upper hand clears', () => {
    const game = board([1, 2, 3, 4, 5], 0, 13);
    enhance(game, 0, 'jumpingBean', 1, 6);
    enhance(game, 0, 'jackpot', 2, 6);
    const result = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }, sequence(0.99));
    expect(result.state.phase).toBe('shop');
    expect(result.state.score).toBe(13);
    expect(result.state.stats.goldBySource.jackpot).toBe(6);
    expect(result.state.stats.jumpingBeanFreePlays[0]).toMatchObject({ hand: 'sixes', roundCleared: true, jackpotPayout: 6 });
    expect(result.events.filter(event => event.message.startsWith('Jumping Bean reroll'))).toHaveLength(0);
  });

  it('is deterministic for identical state and action', () => {
    const game = board();
    enhance(game, 0, 'jackpot', 2);
    const action = { type: 'PLAY' as const, hand: 'pair' as const, dieIds: [0, 1] };
    const first = dispatch(game, action), second = dispatch(game, action);
    expect(first).toEqual(second);
    expect(first.state.stats.goldBySource.jackpot).toBe(6);
  });
});
