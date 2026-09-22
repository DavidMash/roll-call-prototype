import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { finalizeScore, handScore } from './scoring';
import { exportRun } from './telemetry';
import type { Enhancement, GameState, RandomSource, Rank } from './types';

const constant = (value = 0.99): RandomSource => ({ next: () => value });
function board(): GameState {
  const game = newRun('scoring-test', constant()).state;
  const values: Rank[] = [4, 4, 4, 2, 6];
  game.dice.forEach((die, index) => { die.value = values[index]; });
  game.target = 100000;
  game.stats.rounds[0].target = game.target;
  return game;
}
function enhance(game: GameState, id: number, enhancement: Enhancement, count = 1, rank?: Rank) {
  game.dice[id].faces[(rank ?? game.dice[id].value) - 1].enhancements[enhancement] = count;
}
const play = (game: GameState, rng = constant()) =>
  dispatch(game, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, rng);

describe('score finalization', () => {
  it.each([
    { pips: 32, multiplier: 3, rawScore: 96, finalScore: 96 },
    { pips: 13, multiplier: 1.25, rawScore: 16.25, finalScore: 16 },
    { pips: 13, multiplier: 1.5, rawScore: 19.5, finalScore: 20 },
    { pips: 23, multiplier: 2.25, rawScore: 51.75, finalScore: 52 },
  ])('rounds $pips × $multiplier once from $rawScore to $finalScore', testCase => {
    expect(finalizeScore(testCase.pips, testCase.multiplier)).toEqual({
      rawScore: testCase.rawScore, finalScore: testCase.finalScore,
    });
  });

  it('takes ordinary Mult only from the trained hand', () => {
    const game = board();
    game.handLevels.threeKind = 3;
    enhance(game, 0, 'bonus', 2);
    const score = handScore(game.dice, 'threeKind', [0, 1, 2], 3);
    expect(score.multiplier).toBe(3.5);
    expect(score.pips).toBe(50);
    expect(score.score).toBe(175);
  });

  it('ignores and removes a stale Multiplier without crashing', () => {
    const game = board();
    (activeFace(game.dice[0]).enhancements as Record<string, number>).multiplier = 20;
    const result = play(game);
    expect(result.state.score).toBe(55);
    expect(result.state.stats.handScores[0].multiplier).toBe(2.5);
    expect((activeFace(result.state.dice[0]).enhancements as Record<string, number>).multiplier).toBeUndefined();
  });
});

describe('live hand scoring', () => {
  it('finalizes Bonus and Hitchhiker Pips through one trained Mult', () => {
    const game = board();
    enhance(game, 0, 'bonus');
    enhance(game, 4, 'hitchhiker');
    enhance(game, 4, 'bonus');
    const result = play(game, constant(0));
    expect(result.state.score).toBe(120);
    expect(result.events.filter(event => event.type === 'SCORE_ADDED')).toHaveLength(1);
    expect(result.state.stats.handScores[0]).toMatchObject({
      pips: 48, baseMultiplier: 2.5, multiplier: 2.5, rawScore: 120, score: 120,
      bonusPips: 20, hitchhikerPips: 16, playSource: 'manual', consumedHand: true,
    });
    expect(result.state.stats.scoreBySource).toEqual({ hand: 120, jumpingBean: 0, hitchhiker: 0 });
  });

  it('emits immutable accumulator snapshots and adds round score only after finalization', () => {
    const game = board();
    game.score = 17;
    enhance(game, 0, 'bonus');
    enhance(game, 4, 'hitchhiker');
    enhance(game, 4, 'bonus');
    const result = play(game, constant(0));
    const live = result.events.filter(event => [
      'HAND_STARTED', 'HAND_PIPS_CHANGED', 'HITCHHIKER_ADDED_PIPS', 'HAND_SCORE_FINALIZED',
    ].includes(event.type));
    expect(live.map(event => [event.handScore!.currentPips, event.handScore!.currentMultiplier]))
      .toEqual([[10, 2.5], [14, 2.5], [18, 2.5], [22, 2.5], [28, 2.5], [38, 2.5], [48, 2.5], [48, 2.5]]);
    const addition = result.events.findIndex(event => event.type === 'SCORE_ADDED');
    expect(result.events.slice(0, addition).every(event => event.board.score === 17)).toBe(true);
    expect(result.events[addition]).toMatchObject({ amount: 120, source: 'hand', board: { score: 137 } });
  });

  it('triggers capped Golden and Workout from selected and successful Hitchhiker faces', () => {
    const game = board();
    enhance(game, 0, 'golden', 9);
    enhance(game, 0, 'workout');
    enhance(game, 4, 'hitchhiker');
    enhance(game, 4, 'golden', 2);
    enhance(game, 4, 'workout');
    const result = play(game, constant(0));
    expect(result.state.gold).toBe(5);
    expect(result.state.dice[0].faces[3].workoutPips).toBe(1);
    expect(result.state.dice[4].faces[5].workoutPips).toBe(1);
    expect(result.state.stats.triggers.golden).toBe(2);
  });

  it('adds multiple Hitchhikers without adding a selected Hitchhiker twice', () => {
    const game = board();
    for (const id of [0, 3, 4]) enhance(game, id, 'hitchhiker');
    const result = play(game, constant(0));
    expect(result.state.score).toBe(75);
    expect(result.state.stats.triggers.hitchhiker).toBe(2);
    expect(result.events.filter(event => event.type === 'HITCHHIKER_ADDED_PIPS').map(event => event.dieIds)).toEqual([[3], [4]]);
  });

  it('exports source-aware hand arithmetic without double-counting', () => {
    const game = board();
    enhance(game, 0, 'bonus');
    enhance(game, 4, 'hitchhiker');
    enhance(game, 4, 'bonus');
    const result = play(game, constant(0));
    const data = exportRun(result.state);
    expect(data).toMatchObject({ schemaVersion: 11, scoringModel: 'free-upper-jumping-bean-v1',
      handBonusPips: 20, hitchhikerPipsContributed: 16,
      scoreByHand: { threeKind: 120 }, scoreBySource: { hand: 120, jumpingBean: 0, hitchhiker: 0 } });
    expect(data.handScores[0]).toMatchObject({ hand: 'threeKind', pips: 48, multiplier: 2.5,
      score: 120, playSource: 'manual', consumedHand: true });
    expect(Object.values(data.scoreBySource).reduce((sum, score) => sum + score, 0)).toBe(result.state.score);
  });

  it('replays the same seeded enhanced hand identically', () => {
    const game = board();
    enhance(game, 0, 'bonus');
    enhance(game, 4, 'hitchhiker');
    enhance(game, 4, 'workout');
    enhance(game, 0, 'jumpingBean', 1, 6);
    const before = structuredClone(game);
    const action = { type: 'PLAY' as const, hand: 'threeKind' as const, dieIds: [2, 0, 1] };
    expect(dispatch(game, action)).toEqual(dispatch(game, action));
    expect(game).toEqual(before);
  });
});
