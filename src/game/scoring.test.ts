import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { handScore } from './scoring';
import { exportRun } from './telemetry';
import type { Enhancement, GameState, RandomSource, Rank } from './types';

const constant = (value = 0.99): RandomSource => ({ next: () => value });
function sequence(...values: number[]): RandomSource {
  let index = 0;
  return { next: () => values[index++] ?? 0 };
}
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

describe('live hand scoring', () => {
  it.each([
    { name: 'basic hand', bonus: 0, multiplier: 0, hitch: false, hitchBonus: 0, hitchMultiplier: 0, growth: 0, pips: 22, mult: 2.5, score: 55 },
    { name: 'Bonus before multiplication', bonus: 1, multiplier: 0, hitch: false, hitchBonus: 0, hitchMultiplier: 0, growth: 0, pips: 32, mult: 2.5, score: 80 },
    { name: 'selected Multiplier before finalization', bonus: 0, multiplier: 1, hitch: false, hitchBonus: 0, hitchMultiplier: 0, growth: 0, pips: 22, mult: 3, score: 66 },
    { name: 'Bonus and Multiplier synergy', bonus: 1, multiplier: 1, hitch: false, hitchBonus: 0, hitchMultiplier: 0, growth: 0, pips: 32, mult: 3, score: 96 },
    { name: 'Hitchhiker is multiplied', bonus: 0, multiplier: 0, hitch: true, hitchBonus: 0, hitchMultiplier: 0, growth: 0, pips: 28, mult: 2.5, score: 70 },
    { name: 'Hitchhiker with selected Multiplier', bonus: 0, multiplier: 1, hitch: true, hitchBonus: 0, hitchMultiplier: 0, growth: 0, pips: 28, mult: 3, score: 84 },
    { name: 'Hitchhiker own Multiplier is ignored', bonus: 0, multiplier: 0, hitch: true, hitchBonus: 0, hitchMultiplier: 5, growth: 0, pips: 28, mult: 2.5, score: 70 },
    { name: 'Hitchhiker includes Bonus', bonus: 0, multiplier: 0, hitch: true, hitchBonus: 1, hitchMultiplier: 0, growth: 0, pips: 38, mult: 2.5, score: 95 },
    { name: 'Hitchhiker includes prior Workout and Bonus', bonus: 0, multiplier: 0, hitch: true, hitchBonus: 1, hitchMultiplier: 0, growth: 2, pips: 40, mult: 2.5, score: 100 },
    { name: 'stacked Bonus and selected Multiplier', bonus: 2, multiplier: 2, hitch: false, hitchBonus: 0, hitchMultiplier: 0, growth: 0, pips: 42, mult: 3.5, score: 147 },
  ])('$name', testCase => {
    const game = board();
    enhance(game, 0, 'bonus', testCase.bonus);
    enhance(game, 0, 'multiplier', testCase.multiplier);
    if (testCase.hitch) enhance(game, 4, 'hitchhiker');
    enhance(game, 4, 'bonus', testCase.hitchBonus);
    enhance(game, 4, 'multiplier', testCase.hitchMultiplier);
    activeFace(game.dice[4]).workoutPips = testCase.growth;
    const expected = { pips: testCase.pips, multiplier: testCase.mult, score: testCase.score };
    expect(handScore(game.dice, 'threeKind', [0, 1, 2])).toEqual(expected);
    const result = play(game);
    expect(result.error).toBeUndefined();
    expect(result.state.score).toBe(testCase.score);
    expect(result.events.filter(event => event.type === 'SCORE_ADDED')).toHaveLength(1);
    expect(result.events.find(event => event.type === 'HAND_SCORE_FINALIZED')).toMatchObject({
      pips: testCase.pips, multiplier: testCase.mult, amount: testCase.score,
      handScore: { currentPips: testCase.pips, currentMultiplier: testCase.mult, finalScore: testCase.score },
    });
    expect(result.state.stats.scoreBySource).toEqual({ hand: testCase.score, jumpingBean: 0, hitchhiker: 0 });
    if (testCase.hitchMultiplier) expect(result.state.stats.triggers.multiplier).toBeUndefined();
  });

  it('exposes immutable live values and leaves round score unchanged until its one final addition', () => {
    const game = board();
    game.score = 17;
    enhance(game, 1, 'bonus');
    enhance(game, 0, 'multiplier');
    enhance(game, 4, 'hitchhiker');
    const result = play(game);
    const live = result.events.filter(event => [
      'HAND_STARTED', 'HAND_PIPS_CHANGED', 'HAND_MULTIPLIER_CHANGED', 'HITCHHIKER_ADDED_PIPS', 'HAND_SCORE_FINALIZED',
    ].includes(event.type));
    expect(live.map(event => [event.handScore!.currentPips, event.handScore!.currentMultiplier]))
      .toEqual([[10, 2.5], [14, 2.5], [18, 2.5], [22, 2.5], [32, 2.5], [32, 3], [38, 3], [38, 3]]);
    const addition = result.events.findIndex(event => event.type === 'SCORE_ADDED');
    expect(result.events.slice(0, addition).every(event => event.board.score === 17)).toBe(true);
    expect(result.events[addition]).toMatchObject({ amount: 114, source: 'hand', board: { score: 131 } });
    expect(live[0].handScore!.finalScore).toBeNull();
    expect(live.at(-1)!.handScore!.finalScore).toBe(114);
    expect(result.events.filter(event => event.type === 'SCORE_ADDED')).toHaveLength(1);
    expect(result.state.score).toBe(131);
  });

  it('triggers Golden once per selected or Hitchhiker face before finalization without multiplying gold', () => {
    const game = board();
    enhance(game, 0, 'golden');
    enhance(game, 4, 'hitchhiker');
    enhance(game, 4, 'golden');
    const result = play(game);
    expect(result.state.score).toBe(70);
    expect(result.state.gold).toBe(2);
    expect(result.state.stats.triggers.golden).toBe(2);
    const finalIndex = result.events.findIndex(event => event.type === 'HAND_SCORE_FINALIZED');
    const income = result.events.filter(event => event.type === 'GOLD_ADDED');
    expect(income.map(event => event.dieIds)).toEqual([[0], [4]]);
    expect(income.every(event => result.events.indexOf(event) < finalIndex && event.board.score === 0)).toBe(true);
    expect(income.every(event => event.handScore?.currentPips === 28 && event.handScore.currentMultiplier === 2.5)).toBe(true);
  });

  it('uses old Workout values for selected and Hitchhiker faces, then grows them before finalization', () => {
    const game = board();
    activeFace(game.dice[0]).workoutPips = 2;
    activeFace(game.dice[4]).workoutPips = 2;
    enhance(game, 0, 'workout');
    enhance(game, 4, 'workout');
    enhance(game, 4, 'hitchhiker');
    const result = play(game);
    expect(result.state.score).toBe(80); // (10 base + 6 + 4 + 4 + 8) × 2.5
    expect(result.state.dice[0].faces[3].workoutPips).toBe(3);
    expect(result.state.dice[4].faces[5].workoutPips).toBe(3);
    const growth = result.events.filter(event => event.type === 'WORKOUT_INCREMENTED');
    expect(growth).toHaveLength(2);
    const finalIndex = result.events.findIndex(event => event.type === 'HAND_SCORE_FINALIZED');
    expect(growth.every(event => result.events.indexOf(event) < finalIndex && event.handScore?.currentPips === 32)).toBe(true);
    expect(handScore(result.state.dice, 'sixes', [4]).pips).toBe(19);
  });

  it('adds multiple Hitchhikers to the same accumulator and never adds a selected Hitchhiker twice', () => {
    const game = board();
    for (const id of [0, 3, 4]) enhance(game, id, 'hitchhiker');
    const result = play(game);
    expect(result.state.score).toBe(75); // (10 base + 12 + 2 + 6) × 2.5
    expect(result.state.stats.triggers.hitchhiker).toBe(2);
    expect(result.events.filter(event => event.type === 'HITCHHIKER_ADDED_PIPS').map(event => event.dieIds)).toEqual([[3], [4]]);
    expect(result.events.filter(event => event.type === 'SCORE_ADDED')).toHaveLength(1);
    expect(result.state.stats.hitchhikerPipsContributed).toBe(8);
  });

  it('preserves fractional scores without introducing rounding', () => {
    const game = board();
    activeFace(game.dice[0]).workoutPips = 1;
    enhance(game, 0, 'multiplier', 2);
    expect(play(game).state.score).toBe(80.5);
  });

  it('exports final hand arithmetic and pip contributions without double-counting scoring sources', () => {
    const game = board();
    enhance(game, 0, 'bonus');
    enhance(game, 0, 'multiplier');
    enhance(game, 4, 'hitchhiker');
    enhance(game, 4, 'bonus');
    const result = play(game);
    const data = exportRun(result.state);
    expect(data).toMatchObject({ schemaVersion: 5, scoringModel: 'hand-base-pips-accumulator-v2',
      handBonusPips: 20, hitchhikerPipsContributed: 16,
      scoreByHand: { threeKind: 144 }, scoreBySource: { hand: 144, jumpingBean: 0, hitchhiker: 0 } });
    expect(data.handScores).toEqual([{ round: 1, hand: 'threeKind', dieIds: [0, 1, 2],
      basePips: 10, baseMultiplier: 2.5, pips: 48, multiplier: 3, score: 144, bonusPips: 20, hitchhikerPips: 16 }]);
    expect(Object.values(data.scoreBySource).reduce((sum, score) => sum + score, 0)).toBe(result.state.score);
    expect(data).toHaveProperty('manualRerolls');
    expect(data).toHaveProperty('goldEarned');
    expect(data).toHaveProperty('rounds');
  });
});

describe('standalone scoring boundary', () => {
  it('finalizes and consumes the hand before post-hand Jumping Bean scores independently', () => {
    const game = board();
    enhance(game, 0, 'bonus');
    enhance(game, 0, 'multiplier');
    enhance(game, 4, 'hitchhiker');
    enhance(game, 0, 'jumpingBean', 1, 6);
    enhance(game, 0, 'multiplier', 2, 6);
    enhance(game, 0, 'sticky', 1, 6);
    const result = play(game, sequence(0.99, 0.99, 0.99, 0));
    expect(result.state.score).toBe(126);
    expect(result.events.filter(event => event.type === 'SCORE_ADDED').map(event => [event.source, event.amount]))
      .toEqual([['hand', 114], ['jumpingBean', 12]]);
    const finalIndex = result.events.findIndex(event => event.type === 'HAND_SCORE_FINALIZED');
    const consumedIndex = result.events.findIndex(event => event.type === 'HAND_CONSUMED');
    const rollIndex = result.events.findIndex(event => event.type === 'DICE_REROLL_STARTED');
    const beanIndex = result.events.findIndex(event => event.type === 'STANDALONE_SCORE_CALCULATED');
    expect(finalIndex).toBeLessThan(consumedIndex);
    expect(consumedIndex).toBeLessThan(rollIndex);
    expect(rollIndex).toBeLessThan(beanIndex);
    expect(result.events.slice(consumedIndex).every(event => event.handScore === undefined)).toBe(true);
    expect(result.state.stats.handScores[0].score).toBe(114);
    expect(result.state.stats.scoreBySource).toEqual({ hand: 114, jumpingBean: 12, hitchhiker: 0 });
  });

  it.each(['manual', 'initial'])('%s roll Jumping Bean retains its own Multiplier and independent scoring', mode => {
    const game = board();
    for (const enhancement of ['jumpingBean', 'sticky', 'multiplier', 'golden', 'workout'] as Enhancement[]) {
      enhance(game, 0, enhancement, 1, 6);
    }
    enhance(game, 4, 'hitchhiker');
    if (mode === 'initial') { game.phase = 'shop'; game.shop = { offers: [], diceRerolls: 0, offerRerolls: 0 }; }
    const result = dispatch(game, mode === 'manual'
      ? { type: 'MANUAL_REROLL', dieIds: [0] } : { type: 'NEXT_ROUND' },
      mode === 'manual' ? sequence(0.99, 0) : sequence(0.99, 0.99, 0.99, 0.99, 0.99, 0));
    expect(result.state.score).toBe(9);
    expect(result.state.gold).toBe(1);
    expect(result.state.dice[0].faces[5].workoutPips).toBe(1);
    expect(result.state.stats.handScores).toEqual([]);
    expect(result.state.stats.hitchhikerPipsContributed).toBe(0);
    expect(result.events.find(event => event.type === 'STANDALONE_SCORE_CALCULATED'))
      .toMatchObject({ pips: 6, multiplier: 1.5, source: 'jumpingBean' });
    expect(result.events.every(event => event.handScore === undefined)).toBe(true);
    expect(result.state.manualRerollsRemaining).toBe(mode === 'manual' ? 2 : 3);
  });

  it('finishes independent post-hand chains before clearing after the target is crossed', () => {
    const game = board();
    game.target = 60;
    enhance(game, 0, 'jumpingBean', 1, 6);
    const result = play(game, sequence(0.99, 0, 0, 0.99, 0));
    expect(result.state.phase).toBe('shop');
    expect(result.state.score).toBe(67);
    expect(result.state.stats.rounds[0]).toMatchObject({ firstCrossedScore: 61, finalScore: 67, clearMargin: 7 });
    expect(result.events.filter(event => event.type === 'SCORE_ADDED').map(event => event.amount)).toEqual([55, 6, 6]);
    expect(result.events.findIndex(event => event.type === 'ROUND_CLEARED'))
      .toBeGreaterThan(result.events.map(event => event.type).lastIndexOf('STANDALONE_SCORE_CALCULATED'));
  });

  it('replays the same seeded enhanced hand with identical accumulator events and final state', () => {
    const game = board();
    enhance(game, 0, 'bonus');
    enhance(game, 0, 'multiplier');
    enhance(game, 4, 'hitchhiker');
    enhance(game, 4, 'workout');
    enhance(game, 0, 'jumpingBean', 1, 6);
    const before = structuredClone(game);
    const action = { type: 'PLAY' as const, hand: 'threeKind' as const, dieIds: [2, 0, 1] };
    const a = dispatch(game, action), b = dispatch(game, action);
    expect(a).toEqual(b);
    expect(game).toEqual(before);
  });
});
