import { describe, expect, it, vi } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { exportRun } from './telemetry';
import type { Enhancement, GameState, HandId, RandomSource, Rank } from './types';

const constant = (value = 0.99): RandomSource => ({ next: () => value });
function sequence(...values: number[]): RandomSource {
  let index = 0;
  return { next: () => values[index++] ?? 0.99 };
}
function board(values: Rank[] = [4, 2, 4, 1, 6]): GameState {
  const game = newRun('sustainable-test', constant()).state;
  game.dice.forEach((die, index) => { die.value = values[index]; });
  game.target = 1000;
  game.stats.rounds[0].target = game.target;
  return game;
}
function enhance(game: GameState, dieId: number, enhancements: Enhancement[], rank = game.dice[dieId].value) {
  for (const enhancement of enhancements) game.dice[dieId].faces[rank - 1].enhancements[enhancement] = 1;
}
const play = (game: GameState, dieIds = [0], hand: HandId = 'fours') =>
  dispatch(game, { type: 'PLAY', hand, dieIds }, constant());
const spent = (game: GameState, id: number, rank: Rank = 4) => game.dice[id].faces[rank - 1].sustainableUsedThisRound;

describe('Sustainable physical-face charges', () => {
  it('starts every physical face unspent', () => {
    expect(newRun('fresh-sustainable').state.dice.flatMap(die => die.faces)
      .every(face => !face.sustainableUsedThisRound)).toBe(true);
  });

  it('preserves once and emits explicit physical face, spent state and hand metadata', () => {
    const game = board();
    enhance(game, 0, ['sustainable']);
    const result = play(game);
    expect(result.state.consumed).not.toContain('fours');
    expect(spent(result.state, 0)).toBe(true);
    expect(spent(game, 0)).toBe(false); // Commands and playback snapshots remain immutable.
    const trigger = result.events.find(event => event.enhancement === 'sustainable')!;
    expect(trigger).toMatchObject({ type: 'ABILITY_TRIGGERED', dieIds: [0], face: 4,
      hand: 'fours', sustainableSpent: true });
    expect(trigger.message).toContain('now spent for round 1');
    expect(trigger.board.dice[0].faces[3].sustainableUsedThisRound).toBe(true);
    expect(result.state.stats.triggers.sustainable).toBe(1);
    expect(result.events.findIndex(event => event.type === 'SCORE_ADDED')).toBeLessThan(result.events.indexOf(trigger));
  });

  it('breaks the Sticky exploit: preserve first play, consume second, reject third', () => {
    const game = board();
    enhance(game, 0, ['sticky', 'sustainable']);
    const first = play(game);
    expect(first.state.score).toBe(4);
    expect(first.state.consumed).not.toContain('fours');
    expect(first.state.dice[0].value).toBe(4);
    expect(first.events.some(event => event.type === 'DIE_ROLLED')).toBe(false);
    const second = play(first.state);
    expect(second.state.score).toBe(8);
    expect(second.state.consumed).toContain('fours');
    expect(second.state.dice[0].value).toBe(4);
    expect(second.events.some(event => event.enhancement === 'sustainable')).toBe(false);
    expect(second.state.stats.triggers.sustainable).toBe(1);
    expect(second.state.stats.triggers.sticky).toBe(2);
    const rng = { next: vi.fn(() => 0) };
    const third = dispatch(second.state, { type: 'PLAY', hand: 'fours', dieIds: [0] }, rng);
    expect(third.error).toContain('consumed');
    expect(third.state).toBe(second.state);
    expect(third.events).toEqual([]);
    expect(rng.next).not.toHaveBeenCalled();
  });

  it.each([{ hand: 'pair' as const, ids: [0, 2] }, { hand: 'twoPair' as const, ids: [0, 1, 2, 3] }])
   ('uses the same finite preservation rule for $hand', ({ hand, ids }) => {
      const game = board([4, 2, 4, 2, 6]);
      for (const id of ids) enhance(game, id, ['sticky']);
      enhance(game, 0, ['sustainable']);
      const first = play(game, ids, hand);
      const second = play(first.state, ids, hand);
      expect(first.state.consumed).not.toContain(hand);
      expect(second.state.consumed).toContain(hand);
      expect(second.state.stats.triggers.sustainable).toBe(1);
      expect(second.state.score).toBe(first.state.score * 2);
    });

  it('spends only the lowest physical die, then ignores it and spends the available face', () => {
    const game = board();
    for (const id of [0, 2]) enhance(game, id, ['sustainable', 'sticky']);
    const first = play(game, [2, 0]); // Caller order must not decide which charge is used.
    expect([spent(first.state, 0), spent(first.state, 2)]).toEqual([true, false]);
    expect(first.events.filter(event => event.enhancement === 'sustainable').map(event => event.dieIds)).toEqual([[0]]);
    const second = play(first.state, [2, 0]);
    expect([spent(second.state, 0), spent(second.state, 2)]).toEqual([true, true]);
    expect(second.events.filter(event => event.enhancement === 'sustainable').map(event => event.dieIds)).toEqual([[2]]);
    expect(second.state.consumed).not.toContain('fours');
    const third = play(second.state, [0, 2]);
    expect(third.state.consumed).toContain('fours');
    expect(third.state.stats.triggers.sustainable).toBe(2);
  });

  it('lets separate physical dice independently preserve the same category', () => {
    const game = board();
    for (const id of [0, 2]) enhance(game, id, ['sustainable', 'sticky']);
    const first = play(game, [2]);
    expect([spent(first.state, 0), spent(first.state, 2)]).toEqual([false, true]);
    const second = play(first.state, [0]);
    expect(second.state.consumed).not.toContain('fours');
    expect(second.state.stats.sustainableActivations.map(item => item.dieId)).toEqual([2, 0]);
    expect(play(second.state).state.consumed).toContain('fours');
  });

  it('tracks different physical faces of the same die independently', () => {
    const game = board();
    enhance(game, 0, ['sustainable', 'sticky'], 4);
    enhance(game, 0, ['sustainable', 'sticky'], 5);
    const first = play(game).state;
    const rolled = dispatch(first, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0.8)).state;
    const second = play(rolled, [0], 'fives');
    expect([spent(second.state, 0, 4), spent(second.state, 0, 5)]).toEqual([true, true]);
    expect(second.state.consumed).not.toContain('fives');
    expect(second.state.stats.sustainableActivations.map(item => item.face)).toEqual([4, 5]);
  });

  it.each([false, true])('does not spend unselected Sustainable, even through Hitchhiker (hitchhiker=%s)', hitchhiker => {
    const game = board();
    enhance(game, 2, hitchhiker ? ['sustainable', 'hitchhiker'] : ['sustainable']);
    const result = play(game);
    expect(result.state.score).toBe(hitchhiker ? 8 : 4);
    expect(result.state.consumed).toContain('fours');
    expect(spent(result.state, 2)).toBe(false);
    expect(result.state.stats.triggers.sustainable).toBeUndefined();
    expect(result.state.stats.sustainableActivations).toEqual([]);
  });

  it('stays spent when manually rolled away and back during the round', () => {
    const game = board();
    enhance(game, 0, ['sustainable', 'sticky']);
    const first = play(game).state;
    const away = dispatch(first, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0.8)).state;
    expect(away.dice[0].value).toBe(5);
    expect(spent(away, 0)).toBe(true);
    const back = dispatch(away, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0.55)).state;
    expect(back.dice[0].value).toBe(4);
    expect(spent(back, 0)).toBe(true);
    expect(play(back).state.consumed).toContain('fours');
  });

  it('stays spent when Magnetic flips the physical die away and back', () => {
    const game = board();
    enhance(game, 0, ['sustainable', 'sticky', 'magnetic'], 4);
    enhance(game, 0, ['magnetic'], 5);
    enhance(game, 1, ['magnetic'], 3);
    const first = play(game).state;
    const away = dispatch(first, { type: 'MANUAL_REROLL', dieIds: [1] }, sequence(0.4, 0.99, 0.4));
    expect(away.state.dice[0].value).toBe(5);
    expect(away.events.some(event => event.type === 'DIE_FLIPPED')).toBe(true);
    const back = dispatch(away.state, { type: 'MANUAL_REROLL', dieIds: [1] }, sequence(0.4, 0.01, 0.4));
    expect(back.state.dice[0].value).toBe(4);
    expect(spent(back.state, 0)).toBe(true);
    expect(play(back.state).state.consumed).toContain('fours');
  });

  it('manual rerolls do not spend an available Sustainable charge', () => {
    const game = board();
    enhance(game, 0, ['sustainable', 'sticky']);
    const result = dispatch(game, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0.55));
    expect(result.state.dice[0].value).toBe(4);
    expect(spent(result.state, 0)).toBe(false);
    expect(result.state.stats.triggers.sustainable).toBeUndefined();
  });

  it('records a winning activation before clearance, retains it through shop, and resets before the next initial roll', () => {
    const game = board();
    game.target = 4;
    enhance(game, 0, ['sustainable', 'sticky']);
    const win = play(game);
    const types = win.events.map(event => event.type);
    const activation = win.events.find(event => event.enhancement === 'sustainable')!;
    expect(types.indexOf('SCORE_ADDED')).toBeLessThan(win.events.indexOf(activation));
    expect(win.events.indexOf(activation)).toBeLessThan(types.indexOf('POST_HAND_REROLLS_SKIPPED'));
    expect(types.indexOf('POST_HAND_REROLLS_SKIPPED')).toBeLessThan(types.indexOf('ROUND_CLEARED'));
    const clear = win.events.find(event => event.type === 'ROUND_CLEARED')!;
    expect(clear.board.score).toBe(4);
    expect(clear.board.dice[0].value).toBe(4);
    expect(clear.board.dice[0].faces[3].sustainableUsedThisRound).toBe(true);
    expect(win.events.slice(0, types.indexOf('ROUND_CLEARED')).some(event => event.type === 'DICE_REROLL_STARTED')).toBe(false);
    expect(win.state.phase).toBe('shop');
    expect(spent(win.state, 0)).toBe(true);
    const shopRoll = dispatch(win.state, { type: 'REROLL_DICE' }, constant(0.55));
    const shopOffers = dispatch(shopRoll.state, { type: 'REROLL_OFFERS' }, constant());
    expect(spent(shopOffers.state, 0)).toBe(true);
    expect(activeFace(shopOffers.state.dice[0]).enhancements.sustainable).toBe(1);
    const next = dispatch(shopOffers.state, { type: 'NEXT_ROUND' }, constant(0.55));
    expect(next.events[0].type).toBe('ROUND_STARTED');
    expect(next.events[0].board.dice.flatMap(die => die.faces).every(face => !face.sustainableUsedThisRound)).toBe(true);
    expect(next.state.manualRerollsRemaining).toBe(3);
    const again = play(next.state);
    expect(again.state.consumed).not.toContain('fours');
    expect(again.state.stats.triggers.sustainable).toBe(2);
    expect(exportRun(again.state).sustainableActivations).toEqual([
      { round: 1, dieId: 0, face: 4, hand: 'fours' },
      { round: 2, dieId: 0, face: 4, hand: 'fours' },
    ]);
  });

  it('consumes a winning hand normally if its selected Sustainable was already spent', () => {
    const game = board();
    enhance(game, 0, ['sustainable', 'sticky']);
    const first = play(game).state;
    first.target = 8;
    const win = play(first);
    expect(win.state.phase).toBe('shop');
    expect(win.state.consumed).toContain('fours');
    expect(win.events.some(event => event.enhancement === 'sustainable')).toBe(false);
    expect(win.events.find(event => event.type === 'ROUND_CLEARED')!.board.dice[0].value).toBe(4);
  });

  it('replays identical Sustainable decisions and event sequences with the same seed and actions', () => {
    const run = () => {
      let game = board();
      for (const id of [0, 2]) enhance(game, id, ['sustainable', 'sticky']);
      const events = [];
      for (let index = 0; index < 3; index++) {
        const result = dispatch(game, { type: 'PLAY', hand: 'fours', dieIds: [2, 0] });
        events.push(...result.events);
        game = result.state;
      }
      return { game, events };
    };
    expect(run()).toEqual(run());
  });
});
