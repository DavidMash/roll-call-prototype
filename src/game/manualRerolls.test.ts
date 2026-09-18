import { describe, expect, it, vi } from 'vitest';
import { CONFIG, roundReward } from './config';
import { dispatch, newRun } from './engine';
import { ENHANCEMENT_IDS } from './enhancements';
import { HAND_IDS, hasPlayableHand } from './hands';
import { exportRun } from './telemetry';
import type { Enhancement, GameState, RandomSource, Rank } from './types';

const constant = (value = 0.99): RandomSource => ({ next: () => value });
function sequence(...values: number[]): RandomSource {
  let index = 0;
  return { next: () => values[index++] ?? 0.99 };
}
function board(values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const game = newRun('manual-test', constant()).state;
  game.dice.forEach((die, index) => { die.value = values[index]; });
  game.target = 1000000;
  game.stats.rounds[0].target = game.target;
  return game;
}
function enhance(game: GameState, dieId: number, enhancement: Enhancement, rank?: Rank) {
  game.dice[dieId].faces[(rank ?? game.dice[dieId].value) - 1].enhancements[enhancement] = 1;
}
const reroll = (game: GameState, dieIds: number[], rng = constant()) => dispatch(game, { type: 'MANUAL_REROLL', dieIds }, rng);
function deadBoard(remaining = 3): GameState {
  const game = board([1, 1, 1, 1, 1]);
  game.consumed = ['ones', 'pair', 'twoPair', 'threeKind', 'fourKind', 'fiveKind'];
  game.manualRerollsRemaining = remaining;
  expect(hasPlayableHand(game.dice, game.consumed)).toBe(false);
  return game;
}

describe('manual reroll resource', () => {
  it('grants three before the automatic initial roll, which spends none', () => {
    const result = newRun('initial-manual');
    expect(CONFIG.manualRerollsPerRound).toBe(3);
    expect(result.events[0].board.manualRerollsRemaining).toBe(3);
    expect(result.state.manualRerollsRemaining).toBe(3);
    expect(result.state.stats.rounds[0]).toMatchObject({ manualRerollsGranted: 3, manualRerollChargesSpent: 0 });
    expect(result.state.stats.manualRerollActions).toBe(0);
  });
  it.each([{ dieIds: [0] }, { dieIds: [0, 2] }, { dieIds: [4, 0, 2] }])('spends one charge per requested die: $dieIds', ({ dieIds }) => {
    const game = board();
    const before = structuredClone(game);
    const result = reroll(game, dieIds);
    const ids = [...dieIds].sort((a, b) => a - b);
    expect(game).toEqual(before);
    expect(result.state.manualRerollsRemaining).toBe(3 - ids.length);
    expect(result.events[0]).toMatchObject({ type: 'MANUAL_REROLL_STARTED', amount: ids.length, dieIds: ids,
      board: { manualRerollsRemaining: 3 - ids.length } });
    expect(result.events.filter(event => event.type === 'DICE_REROLL_STARTED').map(event => event.dieIds)).toEqual([ids]);
    expect(result.events.filter(event => event.type === 'DIE_ROLLED').map(event => event.dieIds![0])).toEqual(ids);
    expect(result.state.stats.rounds[0]).toMatchObject({ manualRerollChargesSpent: ids.length, manualRerollActions: 1 });
    expect(result.state.stats).toMatchObject({ manualRerollActions: 1, manualDiceRerolled: ids.length,
      manualRerolls: [{ dieIds: ids, charges: ids.length, remaining: 3 - ids.length, startedDeadBoard: false, rescuedDeadBoard: false }] });
  });
  it('allows the same physical die in separate manual actions', () => {
    let game = board();
    for (const remaining of [2, 1, 0]) {
      game = reroll(game, [1]).state;
      expect(game.manualRerollsRemaining).toBe(remaining);
    }
    expect(game.stats.manualRerollActions).toBe(3);
    expect(game.stats.manualRerolls.map(action => action.dieIds)).toEqual([[1], [1], [1]]);
  });
  it.each([{ dieIds: [] }, { dieIds: [0, 0] }, { dieIds: [5] }, { dieIds: [-1] }, { dieIds: [0.5] }, { dieIds: [NaN] }, { dieIds: [0, 1, 2, 3] }])('rejects invalid requests without spending or RNG use: $dieIds', ({ dieIds }) => {
    const game = board();
    const rng = { next: vi.fn(() => 0) };
    const result = reroll(game, dieIds, rng);
    expect(result.error).toBeTruthy();
    expect(result.state).toBe(game);
    expect(result.events).toEqual([]);
    expect(rng.next).not.toHaveBeenCalled();
  });
  it('rejects overspending the remaining budget and further actions at zero', () => {
    const game = reroll(board(), [0, 1]).state;
    expect(reroll(game, [2, 3]).state).toBe(game);
    const exhausted = reroll(game, [2]).state;
    expect(reroll(exhausted, [0]).error).toContain('Not enough');
  });
  it.each(['shop', 'lost', 'error'] as const)('rejects manual rerolls in phase %s', phase => {
    const game = board();
    game.phase = phase;
    expect(reroll(game, [0]).state).toBe(game);
    expect(reroll(game, [0]).error).toContain('gameplay round');
  });
  it('resets on next round before Weighted, Magnetic and Bean initial-roll effects', () => {
    const game = reroll(board(), [0, 1]).state;
    enhance(game, 0, 'weighted', 1);
    enhance(game, 0, 'magnetic', 6);
    enhance(game, 0, 'jumpingBean', 6);
    enhance(game, 0, 'sticky', 6);
    game.phase = 'shop';
    game.shop = { offers: [], diceRerolls: 0, offerRerolls: 0 };
    const result = dispatch(game, { type: 'NEXT_ROUND' }, sequence(0.99, 0.99, 0.99, 0.99, 0.99, 0, 0));
    expect(result.events[0].board.manualRerollsRemaining).toBe(3);
    expect(result.state.manualRerollsRemaining).toBe(3);
    expect(result.state.stats.triggers).toMatchObject({ weighted: 1, magnetic: 1, jumpingBean: 1 });
    expect(result.state.stats.rounds[1]).toMatchObject({ manualRerollsGranted: 3, manualRerollChargesSpent: 0 });
    expect(result.state.stats.manualDiceRerolled).toBe(2);
  });
  it('hand, Sticky/Slippy, Sustainable, Magnetic and Bean effects never replenish or spend charges', () => {
    let game = reroll(board(), [4]).state;
    for (const enhancement of ['sticky', 'slippy', 'sustainable'] as Enhancement[]) enhance(game, 0, enhancement, 1);
    for (const enhancement of ['magnetic', 'jumpingBean', 'sticky'] as Enhancement[]) enhance(game, 0, enhancement, 6);
    game = dispatch(game, { type: 'PLAY', hand: 'ones', dieIds: [0] }, sequence(0, 0, 0.99, 0, 0)).state;
    expect(game.manualRerollsRemaining).toBe(2);
    expect(game.stats.manualDiceRerolled).toBe(1);
    expect(game.stats.rounds[0].manualRerollChargesSpent).toBe(1);
    expect(game.stats.triggers).toMatchObject({ sticky: 2, slippy: 1, sustainable: 1, magnetic: 1, jumpingBean: 1 });
  });
});

describe('manual roll effects and hand independence', () => {
  it('does not score or consume a hand, trigger Sustainable, Slippy or Hitchhiker, or spend gold', () => {
    const game = board();
    enhance(game, 0, 'sustainable');
    enhance(game, 0, 'slippy');
    enhance(game, 0, 'golden');
    enhance(game, 0, 'workout');
    enhance(game, 4, 'slippy');
    enhance(game, 4, 'hitchhiker');
    const result = reroll(game, [0]);
    expect(result.state.score).toBe(0);
    expect(result.state.gold).toBe(0);
    expect(result.state.consumed).toEqual([]);
    expect(result.state.stats.handsPlayed).toEqual({});
    expect(result.state.stats.triggers).toEqual({});
    expect(result.state.dice[4].value).toBe(5);
    expect(result.events.filter(event => event.type === 'DIE_ROLLED')).toHaveLength(1);
  });
  it.each(ENHANCEMENT_IDS)('allows manually rerolling a currently showing %s face', enhancement => {
    const game = board();
    enhance(game, 0, enhancement);
    const result = reroll(game, [0]);
    expect(result.error).toBeUndefined();
    expect(result.state.dice[0].value).toBe(6);
    expect(result.state.manualRerollsRemaining).toBe(2);
  });
  it('uses Weighted probability and produces the usual feedback', () => {
    const game = board();
    enhance(game, 0, 'weighted', 2);
    game.dice[0].faces[1].enhancements.weighted = 2;
    const result = reroll(game, [0], constant(0.6));
    expect(result.state.dice[0].value).toBe(5);
    expect(result.events.find(event => event.enhancement === 'weighted')).toMatchObject({ dieIds: [0], face: 5 });
    expect(result.events.find(event => event.enhancement === 'weighted')?.message).toContain('Weighted x2');
    expect(result.events.find(event => event.enhancement === 'weighted')?.message).toContain('roll weight 3');
    expect(result.state.manualRerollsRemaining).toBe(2);
  });
  it('resolves Weighted then Magnetic then Bean from its original snapshot, without flip roll triggers', () => {
    const game = board();
    enhance(game, 0, 'weighted', 1);
    enhance(game, 0, 'magnetic', 2);
    for (const enhancement of ['magnetic', 'jumpingBean', 'sticky', 'bonus', 'golden', 'workout'] as Enhancement[]) enhance(game, 0, enhancement, 6);
    const result = reroll(game, [0], sequence(0.99, 0, 0));
    expect(result.state.dice[0].value).toBe(2);
    expect(result.state.score).toBe(16);
    expect(result.state.gold).toBe(1);
    expect(result.state.dice[0].faces[5].workoutPips).toBe(1);
    expect(result.events.filter(event => ['weighted', 'magnetic', 'jumpingBean'].includes(event.enhancement ?? '')).map(event => event.enhancement))
      .toEqual(['weighted', 'magnetic', 'jumpingBean']);
    expect(result.events.filter(event => event.type === 'DIE_ROLLED')).toHaveLength(1);
    expect(result.state.manualRerollsRemaining).toBe(2);
  });
  it('Bean chains score, Golden/Workout activate, and the full chain finishes before clearance', () => {
    const game = board();
    game.target = 5;
    for (const enhancement of ['jumpingBean', 'golden', 'workout'] as Enhancement[]) enhance(game, 0, enhancement, 6);
    const result = reroll(game, [0], sequence(0.99, 0.99, 0));
    expect(result.state.phase).toBe('shop');
    expect(result.state.score).toBe(13);
    expect(result.state.gold).toBe(roundReward(1) + 2);
    expect(result.state.stats.rounds[0]).toMatchObject({ firstCrossedScore: 6, finalScore: 13,
      manualRerollChargesSpent: 1, manualRerollsRemainingAtClear: 2 });
    const clearIndex = result.events.findIndex(event => event.type === 'ROUND_CLEARED');
    expect(result.events.slice(0, clearIndex).filter(event => event.type === 'DIE_ROLLED').map(event => event.face)).toEqual([6, 6, 1]);
    expect(result.state.stats.manualDiceRerolled).toBe(1);
    expect(result.state.manualRerollsRemaining).toBe(2);
    expect(result.state.stats.triggers.jumpingBean).toBe(2);
  });
});

describe('loss, rescue and shop separation', () => {
  it.each([3, 1, 0])('after a hand, a dead board with %s charges loses only at zero', remaining => {
    const game = board([1, 2, 2, 4, 5]);
    game.consumed = ['twos', 'threes', 'fours', 'fives', 'sixes', 'pair', 'twoPair'];
    game.manualRerollsRemaining = remaining;
    const result = dispatch(game, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant());
    expect(hasPlayableHand(result.state.dice, result.state.consumed)).toBe(false);
    expect(result.state.phase).toBe(remaining === 0 ? 'lost' : 'round');
    expect(result.events.at(-1)!.type).toBe(remaining === 0 ? 'RUN_LOST' : 'DEAD_BOARD');
  });
  it('a legal hand keeps the round active with zero rerolls', () => {
    const game = board();
    game.manualRerollsRemaining = 0;
    const result = dispatch(game, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant());
    expect(hasPlayableHand(result.state.dice, result.state.consumed)).toBe(true);
    expect(result.state.phase).toBe('round');
  });
  it('clears a target reached with no legal hand and no charges, instead of losing', () => {
    const game = board([1, 2, 2, 4, 5]);
    game.manualRerollsRemaining = 0;
    game.consumed = ['twos', 'threes', 'fours', 'fives', 'sixes', 'pair', 'twoPair'];
    game.target = 1;
    const result = dispatch(game, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant());
    expect(result.state.phase).toBe('shop');
    expect(result.state.stats.loss).toBeNull();
    expect(result.state.stats.rounds[0].manualRerollsRemainingAtClear).toBe(0);
  });
  it('can rescue a dead board with the final charge and resume normal play', () => {
    const result = reroll(deadBoard(1), [0], constant(0.2));
    expect(result.state.phase).toBe('round');
    expect(result.state.manualRerollsRemaining).toBe(0);
    expect(hasPlayableHand(result.state.dice, result.state.consumed)).toBe(true);
    expect(result.state.stats.deadBoardRescues).toBe(1);
    expect(result.state.stats.rounds[0].deadBoardRescues).toBe(1);
    expect(result.state.stats.manualRerolls[0]).toMatchObject({ startedDeadBoard: true, rescuedDeadBoard: true });
    expect(dispatch(result.state, { type: 'PLAY', hand: 'twos', dieIds: [0] }, constant()).error).toBeUndefined();
  });
  it('keeps a persistent dead board active until the final reroll resolves', () => {
    let game = deadBoard();
    for (const remaining of [2, 1, 0]) {
      const result = reroll(game, [0], constant(0));
      game = result.state;
      expect(game.manualRerollsRemaining).toBe(remaining);
      expect(game.phase).toBe(remaining ? 'round' : 'lost');
      expect(result.events.at(-1)!.type).toBe(remaining ? 'DEAD_BOARD' : 'RUN_LOST');
    }
    expect(game.stats.deadBoardRescues).toBe(0);
    expect(game.stats.loss).toMatchObject({ afterAction: 'MANUAL_REROLL', manualRerollsRemaining: 0 });
  });
  it('the final dead-board charge can clear through a Bean chain with no playable categories', () => {
    const game = deadBoard(1);
    game.consumed = [...HAND_IDS];
    game.target = 5;
    enhance(game, 0, 'jumpingBean', 6);
    const result = reroll(game, [0], sequence(0.99, 0.99, 0));
    expect(result.state.phase).toBe('shop');
    expect(result.state.score).toBe(12);
    expect(result.state.manualRerollsRemaining).toBe(0);
    expect(result.state.stats.loss).toBeNull();
    expect(result.state.stats.deadBoardRescues).toBe(1);
    expect(result.state.stats.rounds[0]).toMatchObject({ firstCrossedScore: 6, finalScore: 12, manualRerollsRemainingAtClear: 0 });
  });
  it('shop dice rerolls remain gold-paid and do not spend or reset the manual budget', () => {
    const game = board();
    game.phase = 'shop';
    game.shop = { offers: [], diceRerolls: 0, offerRerolls: 0 };
    game.gold = 10;
    game.manualRerollsRemaining = 1;
    const result = dispatch(game, { type: 'REROLL_DICE' }, constant());
    expect(result.state.gold).toBe(9);
    expect(result.state.shop!.diceRerolls).toBe(1);
    expect(result.state.manualRerollsRemaining).toBe(1);
    expect(result.state.stats.manualRerollActions).toBe(0);
  });
  it('same seed and choices reproduce complete states, events, and exported manual telemetry', () => {
    let a = newRun('manual-replay').state;
    let b = newRun('manual-replay').state;
    for (const dieIds of [[1], [1], [3]]) {
      const ar = dispatch(a, { type: 'MANUAL_REROLL', dieIds });
      const br = dispatch(b, { type: 'MANUAL_REROLL', dieIds });
      expect(ar.events).toEqual(br.events);
      a = ar.state; b = br.state;
      expect(a).toEqual(b);
    }
    expect(exportRun(a).manualRerolls).toHaveLength(3);
    expect(exportRun(a).rounds[0].manualRerollChargesSpent).toBe(3);
    expect(exportRun(a).board.manualRerollsRemaining).toBe(0);
  });
});
