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

describe('Jackpot', () => {
  it('is a stackable three-gold catalog enhancement', () => {
    expect(CONFIG.jackpotGold).toBe(3);
    expect(enhancementCost('jackpot')).toBe(3);
    expect(ENHANCEMENTS.jackpot.stackable).toBe(true);
  });

  it.each([[1, 3], [2, 6], [3, 9]] as const)
  ('pays %s held stack(s) as %s gold when a played hand wins', (stackCount, payout) => {
    const game = board();
    enhance(game, 4, 'jackpot', stackCount);
    const result = playPair(game);
    expect(result.state.phase).toBe('shop');
    const interest = Math.min(5, Math.floor(payout / 5));
    expect(result.state.gold).toBe(payout + roundReward(1) + 3 + interest);
    expect(result.state.stats.goldBySource).toEqual({ golden: 0, jackpot: payout, roundBase: 5, unusedRerolls: 3, interest });
    expect(result.state.stats.triggers.jackpot).toBe(1);
    expect(result.events.find(event => event.enhancement === 'jackpot')).toMatchObject({ dieIds: [4], face: 6 });
    expect(result.events.find(event => event.goldSource === 'jackpot')).toMatchObject({ amount: payout, dieIds: [4] });
  });

  it('does not pay a showing Jackpot face that participated in the winning hand', () => {
    const game = board();
    enhance(game, 0, 'jackpot', 3);
    const result = playPair(game);
    expect(result.state.stats.goldBySource.jackpot).toBe(0);
    expect(result.state.stats.triggers.jackpot).toBeUndefined();
    expect(result.events.some(event => event.enhancement === 'jackpot')).toBe(false);
    expect(result.state.history.find(event => event.type === 'ABILITY_EVALUATED'
      && event.enhancement === 'jackpot' && event.dieIds?.includes(0))?.message)
      .toContain('did not trigger: die scored');
  });

  it('pays multiple held Jackpot dice in stable physical-die order', () => {
    const game = board();
    enhance(game, 2, 'jackpot', 1);
    enhance(game, 4, 'jackpot', 2);
    const result = playPair(game);
    expect(result.state.stats.goldBySource.jackpot).toBe(9);
    expect(result.state.stats.triggers.jackpot).toBe(2);
    expect(result.events.filter(event => event.enhancement === 'jackpot').map(event => event.dieIds)).toEqual([[2], [4]]);
    expect(result.events.filter(event => event.goldSource === 'jackpot').map(event => event.amount)).toEqual([3, 6]);
    expect(result.state.history.find(event => event.message === 'Total Jackpot payout: +9 gold')).toBeTruthy();
  });

  it('does not pay when the played hand remains below target', () => {
    const game = board(undefined, 0, 100);
    enhance(game, 4, 'jackpot', 3);
    const result = playPair(game, constant(0));
    expect(result.state.phase).toBe('round');
    expect(result.state.stats.goldBySource.jackpot).toBe(0);
    expect(result.state.stats.triggers.jackpot).toBeUndefined();
  });

  it('pays when the played hand lands exactly on the target and skips post-hand rerolls', () => {
    const game = board(); // 26 + Pair's Level 1 score of 24 = 50 exactly.
    enhance(game, 4, 'jackpot');
    const result = playPair(game);
    expect(result.state.score).toBe(result.state.target);
    expect(result.state.stats.goldBySource.jackpot).toBe(3);
    expect(result.events.some(event => event.type === 'DICE_REROLL_STARTED' && event.message.startsWith('Post-hand'))).toBe(false);
    const jackpotIndex = result.events.findIndex(event => event.enhancement === 'jackpot');
    const skipIndex = result.events.findIndex(event => event.type === 'POST_HAND_REROLLS_SKIPPED');
    const clearIndex = result.events.findIndex(event => event.type === 'ROUND_CLEARED');
    expect(jackpotIndex).toBeGreaterThan(result.events.findIndex(event => event.type === 'SCORE_ADDED'));
    expect(jackpotIndex).toBeLessThan(skipIndex);
    expect(skipIndex).toBeLessThan(clearIndex);
  });

  it('does not pay when successful Hitchhiker makes the held face a scoring die', () => {
    const game = board(undefined, 17); // (8 base + 4 + 4 + Hitchhiker 6) × 1.5 = 33; total 50.
    enhance(game, 4, 'hitchhiker');
    enhance(game, 4, 'jackpot');
    const result = playPair(game, constant(0));
    expect(result.state.score).toBe(50);
    expect(result.state.stats.hitchhikerPipsContributed).toBe(6);
    expect(result.state.stats.triggers.hitchhiker).toBe(1);
    expect(result.state.stats.triggers.jackpot).toBeUndefined();
    expect(result.state.stats.goldBySource.jackpot).toBe(0);
  });

  it('keeps Golden independent when a held Jackpot face does not score', () => {
    const game = board();
    enhance(game, 4, 'golden', 2);
    enhance(game, 4, 'jackpot', 2);
    const result = playPair(game);
    expect(result.state.stats.goldBySource.golden).toBe(0);
    expect(result.state.stats.goldBySource.jackpot).toBe(6);
    expect(result.state.stats.triggers.golden).toBeUndefined();
    expect(result.state.stats.triggers.jackpot).toBe(1);
  });

  it('does not pay when a manual-reroll Jumping Bean reaches the target', () => {
    const game = board([1, 2, 3, 4, 5], 44);
    enhance(game, 0, 'jumpingBean', 1, 6);
    enhance(game, 1, 'jackpot');
    const result = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }, sequence(0.99, 0));
    expect(result.state.phase).toBe('shop');
    expect(result.state.score).toBe(50);
    expect(result.state.stats.triggers.jumpingBean).toBe(1);
    expect(result.state.stats.goldBySource.jackpot).toBe(0);
  });

  it('does not pay when a post-hand Jumping Bean chain reaches the target', () => {
    const game = board([1, 2, 3, 4, 5], 36);
    enhance(game, 0, 'jumpingBean', 1, 6);
    enhance(game, 1, 'jackpot');
    const result = dispatch(game, { type: 'PLAY', hand: 'ones', dieIds: [0] }, sequence(0.99, 0));
    expect(result.state.phase).toBe('shop');
    expect(result.state.score).toBe(50); // Level 1 Ones scores 8, then Jumping Bean scores 6.
    expect(result.state.stats.goldBySource.jackpot).toBe(0);
  });

  it('does not pay when an initial-roll Jumping Bean reaches the target', () => {
    const game = board();
    game.phase = 'shop';
    game.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0 };
    enhance(game, 0, 'jumpingBean', 1, 6);
    enhance(game, 0, 'bonus', 7, 6);
    enhance(game, 1, 'jackpot', 1, 1);
    const result = dispatch(game, { type: 'NEXT_ROUND' }, sequence(0.99, 0, 0, 0, 0, 0));
    expect(result.state.phase).toBe('shop');
    expect(result.state.score).toBe(76);
    expect(result.state.stats.triggers.jumpingBean).toBe(1);
    expect(result.state.stats.goldBySource.jackpot).toBe(0);
  });

  it('is deterministic for identical state, seed, and played-hand action', () => {
    const game = board();
    enhance(game, 4, 'jackpot', 2);
    const action = { type: 'PLAY' as const, hand: 'pair' as const, dieIds: [0, 1] };
    const first = dispatch(game, action);
    const second = dispatch(game, action);
    expect(first).toEqual(second);
    expect(first.state.shop?.offers).toEqual(second.state.shop?.offers);
    expect(first.state.stats.goldBySource.jackpot).toBe(6);
  });
});
