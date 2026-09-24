import { describe, expect, it, vi } from 'vitest';
import { roundReward } from './config';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import type { Enhancement, GameState, Rank } from './types';

const constant = (value = 0.99) => ({ next: () => value });
function sequence(...values: number[]) {
  let index = 0;
  return { next: () => values[index++] ?? 0.99 };
}
function board(values: Rank[] = [4, 4, 4, 2, 6], score = 40, target = 50): GameState {
  const game = newRun('winning-hand', constant()).state;
  game.dice.forEach((die, index) => { die.value = values[index]; });
  game.score = score;
  game.target = target;
  game.stats.rounds[0].target = target;
  return game;
}
function enhance(game: GameState, id: number, enhancement: Enhancement, rank?: Rank) {
  game.dice[id].faces[(rank ?? game.dice[id].value) - 1].enhancements[enhancement] = 1;
}

describe('winning-hand boundary', () => {
  it.each([
    { hand: 'pair' as const, values: [4, 4, 4, 2, 6] as Rank[], handScore: 24, finalScore: 64 },
    { hand: 'fives' as const, values: [5, 5, 4, 2, 6] as Rank[], handScore: 17, finalScore: 57 },
  ])('$hand clears at/above target without scheduling Sticky, Slippy or gameplay rolls', ({ hand, values, handScore, finalScore }) => {
    const game = board(values);
    enhance(game, 0, 'sticky');
    enhance(game, 2, 'slippy');
    for (const enhancement of ['magnetic', 'jumpingBean'] as Enhancement[]) enhance(game, 0, enhancement, 6);
    enhance(game, 0, 'weighted', 1);
    const rng = { next: vi.fn(() => 0.99) };
    const result = dispatch(game, { type: 'PLAY', hand, dieIds: [0, 1] }, rng);
    expect(result.state.phase).toBe('roundSummary');
    expect(result.state.score).toBe(finalScore);
    expect(result.state.stats.rounds[0]).toMatchObject({ firstCrossedScore: finalScore, finalScore,
      clearMargin: finalScore - 50, cleared: true });
    expect(result.events.filter(event => event.type === 'SCORE_ADDED').map(event => event.amount)).toEqual([handScore]);
    const clearIndex = result.events.findIndex(event => event.type === 'ROUND_CLEARED');
    const gameplay = result.events.slice(0, clearIndex + 1);
    expect(gameplay.some(event => ['DICE_REROLL_STARTED', 'DIE_ROLLED', 'DIE_FLIPPED'].includes(event.type))).toBe(false);
    expect(gameplay.some(event => ['sticky', 'slippy', 'weighted', 'magnetic', 'jumpingBean'].includes(event.enhancement ?? ''))).toBe(false);
    expect(result.events.filter(event => event.type === 'POST_HAND_REROLLS_SKIPPED')).toHaveLength(1);
    expect(result.events[clearIndex].board.dice.map(die => die.value)).toEqual(values);
    expect(result.state.consumed).toContain(hand);
    expect(result.state.manualRerollsRemaining).toBe(3);
    // Normal shop exposure remains a separate free five-die roll after ROUND_CLEARED.
    expect(result.events.filter(event => event.type === 'DICE_REROLL_STARTED').map(event => event.message))
      .toEqual([]);
    expect(result.events.slice(clearIndex + 1).filter(event => event.type === 'DIE_ROLLED')).toHaveLength(0);
    expect(result.state.stats.triggers.slippy).toBeUndefined();
    expect(result.state.stats.triggers.magnetic).toBeUndefined();
    expect(result.state.stats.triggers.jumpingBean).toBeUndefined();
    expect(rng.next).not.toHaveBeenCalled();
    expect(result.state.gold).toBe(roundReward(1) + 3);
  });

  it('finishes winning Bonus/Hitchhiker, Golden and Workout contributions before clearing', () => {
    const game = board(undefined, 10);
    for (const enhancement of ['bonus', 'golden', 'workout', 'sticky'] as Enhancement[]) enhance(game, 0, enhancement);
    for (const enhancement of ['hitchhiker', 'bonus', 'golden', 'workout', 'slippy'] as Enhancement[]) enhance(game, 4, enhancement);
    activeFace(game.dice[4]).workoutPips = 2;
    const result = dispatch(game, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(0));
    expect(result.state.score).toBe(76); // (8 base + 8 + 10 + 18) × 1.5 + existing 10
    expect(result.state.gold).toBe(10);
    expect(result.state.dice[0].faces[3].workoutPips).toBe(1);
    expect(result.state.dice[4].faces[5].workoutPips).toBe(3);
    expect(result.state.stats.handScores[0]).toMatchObject({ handLevel: 1, basePips: 8, pips: 44, multiplier: 1.5, score: 66, hitchhikerPips: 18 });
    const finalIndex = result.events.findIndex(event => event.type === 'HAND_SCORE_FINALIZED');
    const clearIndex = result.events.findIndex(event => event.type === 'ROUND_CLEARED');
    expect(result.events.slice(0, finalIndex).filter(event => event.type === 'WORKOUT_INCREMENTED')).toHaveLength(2);
    expect(result.events.slice(0, finalIndex).filter(event => event.type === 'GOLD_ADDED')).toHaveLength(2);
    expect(finalIndex).toBeLessThan(clearIndex);
    expect(result.events.slice(0, clearIndex).some(event => event.type === 'DICE_REROLL_STARTED')).toBe(false);
    expect(result.state.stats.triggers.slippy).toBeUndefined();
    expect(result.state.stats.triggers.sticky).toBeUndefined();
  });

  it('can win specifically through Hitchhiker pips and skip subsequent gameplay rerolls', () => {
    const game = board(undefined, 18);
    enhance(game, 4, 'hitchhiker');
    expect(18 + (8 + 8) * 1.5).toBeLessThan(game.target);
    const result = dispatch(game, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(0));
    expect(result.state.score).toBe(51);
    expect(result.state.phase).toBe('roundSummary');
    expect(result.events.some(event => event.type === 'POST_HAND_REROLLS_SKIPPED')).toBe(true);
    expect(result.events.some(event => event.type === 'DICE_REROLL_STARTED' && event.message.startsWith('Post-hand'))).toBe(false);
  });

  it('can win through Bonus and trained Base Mult before skipping rerolls', () => {
    const game = board(undefined, 20);
    enhance(game, 0, 'bonus');
    const result = dispatch(game, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant());
    expect(result.state.score).toBe(59);
    expect(result.state.phase).toBe('roundSummary');
    expect(result.events.find(event => event.type === 'HAND_SCORE_FINALIZED')).toMatchObject({ pips: 26, multiplier: 1.5, amount: 39 });
    expect(result.events.some(event => event.type === 'DICE_REROLL_STARTED' && event.message.startsWith('Post-hand'))).toBe(false);
  });

  it('consumes a winning hand without scheduling post-win rerolls', () => {
    const game = board();
    const result = dispatch(game, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant());
    expect(result.state.phase).toBe('roundSummary');
    expect(result.state.consumed).toContain('pair');
    expect(result.events.some(event => event.type === 'POST_HAND_REROLLS_SKIPPED')).toBe(true);
    expect(result.events.some(event => event.type === 'DICE_REROLL_STARTED' && event.message.startsWith('Post-hand'))).toBe(false);
  });

  it('preserves non-winning Sticky/Slippy batches and prevents same-batch Magnetic self-anchoring', () => {
    const game = board([5, 5, 4, 2, 6], 20, 100);
    enhance(game, 0, 'sticky');
    enhance(game, 3, 'slippy');
    enhance(game, 1, 'weighted', 1);
    for (const enhancement of ['magnetic', 'jumpingBean', 'sticky'] as Enhancement[]) enhance(game, 1, enhancement, 6);
    const result = dispatch(game, { type: 'PLAY', hand: 'fives', dieIds: [0, 1] }, sequence(0, 0.99, 0.99, 0, 0));
    expect(result.state.phase).toBe('round');
    expect(result.state.score).toBe(50); // Hand 17, then a one-die Sixes free play for 13.
    expect(result.state.dice[0].value).toBe(5);
    expect(result.events.filter(event => event.type === 'DICE_REROLL_STARTED').map(event => event.dieIds)).toEqual([[1, 3]]);
    expect(result.events.filter(event => event.type === 'ABILITY_TRIGGERED' && ['weighted', 'magnetic', 'jumpingBean'].includes(event.enhancement ?? '')).map(event => event.enhancement))
      .toEqual(['weighted', 'jumpingBean']);
    expect(result.events.filter(event => event.type === 'SCORE_ADDED').map(event => [event.source, event.amount]))
      .toEqual([['hand', 17], ['jumpingBean', 13]]);
    expect(result.events.some(event => event.type === 'POST_HAND_REROLLS_SKIPPED')).toBe(false);
    expect(result.state.manualRerollsRemaining).toBe(3);
  });
});
