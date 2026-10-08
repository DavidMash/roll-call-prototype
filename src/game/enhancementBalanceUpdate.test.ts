import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { Resolver } from './effects';
import { dispatch, newRun } from './engine';
import { attachmentError, diminishingHalfChance, loneWolfPipsFactor, tankMultiplierFactor } from './enhancements';
import { loadPersistedRun, savePersistedRun } from './persistence';
import { handScore } from './scoring';
import type { Enhancement, GameState, RandomSource, Rank } from './types';

const constant = (value = .99): RandomSource => ({ next: () => value });
const sequence = (...values: number[]): RandomSource => {
  let index = 0;
  return { next: () => values[index++] ?? values.at(-1) ?? .99 };
};

function scoringState(values: Rank[] = [4, 4, 4, 2, 6]): GameState {
  const state = newRun('enhancement-balance-update', constant(.99)).state;
  state.target = 1_000_000;
  state.stats.rounds[0].target = state.target;
  state.dice.forEach((die, index) => { die.value = values[index]; });
  return state;
}

function enhance(state: GameState, dieId: number, enhancement: Enhancement, stacks = 1): void {
  activeFace(state.dice[dieId]).enhancements[enhancement] = stacks;
}

const playThreeKind = (state: GameState, rng: RandomSource = constant(.99)) =>
  dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, rng);

describe('Teamwork', () => {
  it('copies every other physical scorer once', () => {
    const state = scoringState();
    enhance(state, 0, 'teamwork');
    const result = playThreeKind(state);
    expect(result.state.stats.handScores[0]).toMatchObject({ pips: 30, score: 75 });
    expect(result.events.find(event => event.enhancement === 'teamwork' && event.type === 'HAND_PIPS_CHANGED'))
      .toMatchObject({ amount: 8, handScore: { currentPips: 30 } });
  });

  it('lets two Teamwork faces independently copy ordinary Pips without recursion', () => {
    const state = scoringState();
    enhance(state, 0, 'teamwork');
    enhance(state, 1, 'teamwork');
    const result = playThreeKind(state);
    expect(result.state.stats.handScores[0]).toMatchObject({ pips: 38, score: 95 });
    expect(result.events.filter(event => event.enhancement === 'teamwork' && event.type === 'HAND_PIPS_CHANGED')
      .map(event => event.amount)).toEqual([8, 8]);
    expect(result.state.stats.triggers.teamwork).toBe(2);
  });

  it('copies resolved Bonus and Workout Pips but never activates the copied face again', () => {
    const state = scoringState();
    enhance(state, 0, 'teamwork');
    enhance(state, 1, 'bonus');
    enhance(state, 1, 'workout', 3);
    activeFace(state.dice[1]).workoutPips = 6;
    enhance(state, 1, 'golden');
    const result = playThreeKind(state);
    expect(result.state.stats.handScores[0].pips).toBe(62);
    expect(result.state.stats.triggers.golden).toBe(1);
    expect(result.state.dice[1].faces[3].workoutPips).toBe(9);
    expect(result.state.stats.triggers.workout).toBe(1);
  });

  it('uses successful Hitchhikers and works on a one-die Jumping Bean free play', () => {
    const state = scoringState([4, 4, 4, 2, 6]);
    enhance(state, 0, 'teamwork');
    enhance(state, 3, 'hitchhiker', 3);
    const joined = playThreeKind(state, constant(0));
    expect(joined.events.find(event => event.enhancement === 'teamwork' && event.type === 'HAND_PIPS_CHANGED')?.amount).toBe(10);

    const free = scoringState([1, 2, 3, 4, 5]);
    enhance(free, 0, 'teamwork');
    new Resolver(free, constant(.99)).play('ones', [0], 'jumpingBean');
    expect(free.stats.handScores[0]).toMatchObject({ pips: 8, score: 8, playSource: 'jumpingBean' });
    expect(free.stats.triggers.teamwork).toBe(1);
  });

  it('activates once per genuine Double Time scoring activation', () => {
    const state = scoringState();
    enhance(state, 0, 'teamwork');
    enhance(state, 0, 'doubleTime');
    const result = playThreeKind(state, constant(0));
    expect(result.state.stats.handScores[0]).toMatchObject({ pips: 42, score: 105 });
    expect(result.events.filter(event => event.enhancement === 'teamwork' && event.type === 'HAND_PIPS_CHANGED')
      .map(event => event.amount)).toEqual([8, 8]);
    expect(result.state.stats.probabilityProcs.doubleTime.checks).toBe(1);
  });
});

describe('Lone Wolf', () => {
  it.each([[1, 4], [2, 3], [3, 2], [4, 1.5], [5, 1], [8, 1]])
    ('uses ×%s for %s distinct physical scoring dice', (dice, factor) => {
      expect(loneWolfPipsFactor(dice)).toBe(factor);
    });

  it.each([[1, 4], [2, 3], [3, 2], [4, 1.5], [5, 1]] as const)
    ('applies the exact %s-die curve in live scoring', (count, factor) => {
      const state = scoringState([1, 1, 1, 1, 1]);
      enhance(state, 0, 'loneWolf');
      const ids = Array.from({ length: count }, (_, index) => index);
      const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: ids }, constant(.99));
      expect(result.state.stats.handScores[0].pips).toBe(7 + factor + count - 1);
    });

  it('counts a Hitchhiker but not Teamwork copies or a Double Time activation', () => {
    const joined = scoringState([1, 1, 3, 4, 5]);
    enhance(joined, 0, 'loneWolf');
    enhance(joined, 0, 'teamwork');
    enhance(joined, 1, 'hitchhiker', 3);
    const result = dispatch(joined, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    expect(result.events.find(event => event.enhancement === 'loneWolf' && event.type === 'HAND_PIPS_CHANGED')?.amount).toBe(2);

    const doubled = scoringState([1, 2, 3, 4, 5]);
    enhance(doubled, 0, 'loneWolf');
    enhance(doubled, 0, 'doubleTime');
    const doubledResult = dispatch(doubled, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    expect(doubledResult.state.stats.handScores[0].pips).toBe(15);
    expect(doubledResult.events.filter(event => event.enhancement === 'loneWolf' && event.type === 'HAND_PIPS_CHANGED'))
      .toHaveLength(2);
  });

  it('lets multiple Lone Wolf faces use the same participant count and gives a free play ×4', () => {
    const state = scoringState([1, 1, 3, 4, 5]);
    enhance(state, 0, 'loneWolf');
    enhance(state, 1, 'loneWolf');
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0, 1] }, constant(.99));
    expect(result.state.stats.handScores[0].pips).toBe(13);

    const free = scoringState([1, 2, 3, 4, 5]);
    enhance(free, 0, 'loneWolf');
    new Resolver(free, constant(.99)).play('ones', [0], 'jumpingBean');
    expect(free.stats.handScores[0].pips).toBe(11);
  });
});

describe('Double Time', () => {
  it('uses the shared diminishing-failure curve and caps at three stacks', () => {
    expect([1, 2, 3].map(diminishingHalfChance)).toEqual([.5, .75, .875]);
    const face = activeFace(scoringState().dice[0]);
    face.enhancements.doubleTime = 3;
    expect(attachmentError(face, 'doubleTime')).toContain('capped at 3');
  });

  it('fails to one activation and succeeds to exactly two with one deterministic check', () => {
    const failure = scoringState();
    enhance(failure, 0, 'doubleTime');
    const failed = playThreeKind(failure, constant(.99));
    expect(failed.state.stats.handScores[0]).toMatchObject({ pips: 22, score: 55 });
    expect(failed.state.stats.probabilityProcs.doubleTime).toMatchObject({ checks: 1, successes: 0, failures: 1 });

    const success = scoringState();
    enhance(success, 0, 'doubleTime', 3);
    const succeeded = playThreeKind(success, constant(0));
    expect(succeeded.state.stats.handScores[0]).toMatchObject({ pips: 26, score: 65 });
    expect(succeeded.state.stats.probabilityProcs.doubleTime).toMatchObject({ checks: 1, successes: 1, failures: 0 });
    expect(succeeded.events.filter(event => event.type === 'HAND_PIPS_CHANGED' && event.dieIds?.[0] === 0 && !event.enhancement)).toHaveLength(2);

    const stackOne = scoringState();
    enhance(stackOne, 0, 'doubleTime', 1);
    expect(playThreeKind(stackOne, constant(.6)).state.stats.probabilityProcs.doubleTime.failures).toBe(1);
    const stackTwo = scoringState();
    enhance(stackTwo, 0, 'doubleTime', 2);
    expect(playThreeKind(stackTwo, constant(.6)).state.stats.probabilityProcs.doubleTime.successes).toBe(1);
  });

  it('replays ordinary per-score effects and leaves once-per-hand state capped', () => {
    const state = scoringState();
    enhance(state, 0, 'doubleTime');
    enhance(state, 0, 'bonus');
    enhance(state, 0, 'workout');
    enhance(state, 0, 'golden');
    enhance(state, 0, 'vintage');
    enhance(state, 0, 'jackpot');
    const result = playThreeKind(state, constant(0));
    expect(result.state.stats.handScores[0].bonusPips).toBe(20);
    expect(result.state.dice[0].faces[3].workoutPips).toBe(2);
    expect(result.state.stats.goldBySource.golden).toBe(2);
    expect(result.state.dice[0].faces[3].vintageSellValue).toBe(6);
    expect(result.state.handPlayCounts.threeKind).toBe(1);
    expect(result.state.stats.handsPlayed.threeKind).toBe(1);

    const winning = scoringState();
    winning.target = 1;
    winning.stats.rounds[0].target = 1;
    enhance(winning, 0, 'doubleTime');
    enhance(winning, 0, 'jackpot');
    const cleared = playThreeKind(winning, constant(0));
    expect(cleared.state.stats.goldBySource.jackpot).toBe(3);
  });

  it('re-enters Personal Trainer while retaining its own chance and level rules', () => {
    const state = scoringState();
    enhance(state, 0, 'doubleTime');
    enhance(state, 0, 'personalTrainer', 3);
    const result = playThreeKind(state, constant(0));
    expect(result.state.stats.personalTrainerAttempts).toBe(2);
    expect(result.state.stats.personalTrainerSuccesses).toBe(2);
    expect(result.state.handLevels.threeKind).toBe(3);
  });

  it('works for Jumping Bean and Hitchhiker scoring paths', () => {
    const free = scoringState([1, 2, 3, 4, 5]);
    enhance(free, 0, 'doubleTime');
    new Resolver(free, constant(0)).play('ones', [0], 'jumpingBean');
    expect(free.stats.handScores[0].pips).toBe(9);

    const joined = scoringState();
    enhance(joined, 4, 'hitchhiker', 3);
    enhance(joined, 4, 'doubleTime');
    const result = playThreeKind(joined, sequence(0, 0, .99));
    expect(result.state.stats.probabilityProcs.doubleTime.successes).toBe(1);
    expect(result.state.stats.handScores[0].hitchhikerPips).toBe(12);
  });

  it('preserves a resolved seeded result through save/load without extra rolls', () => {
    const state = scoringState();
    enhance(state, 0, 'doubleTime', 2);
    const resolved = playThreeKind(state, constant(0)).state;
    let serialized = '';
    const storage = { getItem: () => serialized || null, setItem: (_key: string, value: string) => { serialized = value; } };
    expect(savePersistedRun(storage, resolved)).toBe(true);
    const loaded = loadPersistedRun(storage, resolved.seed)!;
    expect(loaded.stats.probabilityProcs.doubleTime).toEqual(resolved.stats.probabilityProcs.doubleTime);
    expect(loaded.stats.handScores[0]).toEqual(resolved.stats.handScores[0]);
    expect(loaded.history.filter(event => event.probability?.enhancement === 'doubleTime')).toHaveLength(1);
  });
});

describe('Tank', () => {
  function tankState(): GameState {
    const state = scoringState();
    state.handLevels.threeKind = 6;
    return state;
  }

  it('uses the exact stack curve and caps at three stacks', () => {
    expect([1, 2, 3].map(tankMultiplierFactor)).toEqual([1.5, 2, 2.5]);
    const face = activeFace(tankState().dice[0]);
    face.enhancements.tank = 3;
    expect(attachmentError(face, 'tank')).toContain('capped at 3');
  });

  it.each([[1, 15], [2, 20], [3, 25]] as const)('applies Tank ×%s as Mult %s from base 10', (stacks, expected) => {
    const state = tankState();
    enhance(state, 0, 'tank', stacks);
    expect(playThreeKind(state).state.stats.handScores[0].multiplier).toBe(expected);
  });

  it('multiplies multiple Tank faces sequentially without a hand-wide cap', () => {
    const two = tankState();
    enhance(two, 0, 'tank');
    enhance(two, 1, 'tank');
    const twoResult = playThreeKind(two);
    expect(twoResult.state.stats.handScores[0]).toMatchObject({ baseMultiplier: 10, multiplier: 22.5, xMult: 1 });

    const mixed = tankState();
    enhance(mixed, 0, 'tank', 3);
    enhance(mixed, 1, 'tank');
    expect(playThreeKind(mixed).state.stats.handScores[0].multiplier).toBe(37.5);
  });

  it('activates Tank again for Double Time and preserves XMult', () => {
    const doubled = tankState();
    enhance(doubled, 0, 'tank');
    enhance(doubled, 0, 'doubleTime');
    const doubledResult = playThreeKind(doubled, constant(0));
    expect(doubledResult.state.stats.handScores[0]).toMatchObject({ multiplier: 22.5, xMult: 1 });
    expect(doubledResult.events.filter(event => event.type === 'HAND_MULTIPLIER_CHANGED' && event.enhancement === 'tank')).toHaveLength(2);

    const combined = tankState();
    enhance(combined, 0, 'tank');
    enhance(combined, 0, 'doubleTime');
    enhance(combined, 1, 'tank');
    const combinedResult = playThreeKind(combined, constant(0));
    expect(combinedResult.state.stats.handScores[0]).toMatchObject({ multiplier: 33.75, xMult: 1 });
    expect(combinedResult.state.stats.handScores[0].score)
      .toBe(Math.round(combinedResult.state.stats.handScores[0].pips * 33.75));
  });

  it('includes deterministic Teamwork, Lone Wolf, and Tank effects in score previews', () => {
    const state = tankState();
    enhance(state, 0, 'teamwork');
    enhance(state, 0, 'loneWolf');
    enhance(state, 0, 'tank');
    const preview = handScore(state.dice, 'threeKind', [0, 1, 2], 6);
    expect(preview).toMatchObject({ pips: 53, multiplier: 15, rawScore: 795, score: 795 });
  });
});
