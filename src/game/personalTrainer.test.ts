import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { attachmentError, diminishingHalfChance, ENHANCEMENTS, enhancementCost, enhancementSellValue, personalTrainerChance } from './enhancements';
import type { Enhancement, GameState, RandomSource, Rank } from './types';

const constant = (value = 0.99): RandomSource => ({ next: () => value });
const sequence = (...values: number[]): RandomSource => {
  let index = 0;
  return { next: () => values[index++] ?? 0.99 };
};
function game(values: Rank[] = [4, 4, 4, 2, 6]): GameState {
  const state = newRun('personal-trainer-enhancement', constant()).state;
  state.dice.forEach((die, index) => { die.value = values[index]; });
  state.target = 1_000_000;
  state.stats.rounds[0].target = state.target;
  return state;
}
function enhance(state: GameState, dieId: number, enhancement: Enhancement, count = 1, rank?: Rank): void {
  state.dice[dieId].faces[(rank ?? state.dice[dieId].value) - 1].enhancements[enhancement] = count;
}
const playThreeKind = (state: GameState, rng: RandomSource) =>
  dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, rng);

describe('Personal Trainer enhancement', () => {
  it('uses premium purchase, per-stack sale, and stack-cap metadata', () => {
    const state = game();
    const face = activeFace(state.dice[0]);
    face.enhancements.personalTrainer = 3;
    expect(enhancementCost('personalTrainer')).toBe(8);
    expect(ENHANCEMENTS.personalTrainer).toMatchObject({ baseSellPrice: 4, maxStacks: 3, stackable: true });
    expect(enhancementSellValue(face, 'personalTrainer')).toBe(12);
    expect(attachmentError(face, 'personalTrainer')).toContain('capped at 3');
  });

  it.each([[1, 0.5], [2, 0.75], [3, 0.875]] as const)
  ('uses a %s-stack chance of %s', (stackCount, chance) => {
    expect(diminishingHalfChance(stackCount)).toBe(chance);
    const success = game();
    enhance(success, 0, 'personalTrainer', stackCount);
    const trained = playThreeKind(success, constant(chance - 0.001));
    expect(trained.state.handLevels.threeKind).toBe(2);
    const check = trained.state.historyV2.flatMap(event => event.kind === 'hand_scored' ? event.checks : [])
      .find(item => item.source === 'personalTrainer');
    expect(check).toMatchObject({ source: 'personalTrainer', stacks: stackCount, chance, succeeded: true });

    const failure = game();
    enhance(failure, 0, 'personalTrainer', stackCount);
    const untrained = playThreeKind(failure, constant(chance));
    expect(untrained.state.handLevels.threeKind).toBe(1);
    expect(untrained.state.stats.probabilityProcs.personalTrainer.failures).toBe(1);
  });

  it('scales from the lowest level through the average and clamps extreme outliers', () => {
    const levels = [1, 2, 3];
    expect(personalTrainerChance(1, 1, levels)).toBe(0.5);
    expect(personalTrainerChance(1, 2, levels)).toBe(0.375);
    expect(personalTrainerChance(1, 3, levels)).toBe(0.1875);
    expect(personalTrainerChance(3, 100, levels)).toBe(0.01);
    expect(personalTrainerChance(2, 5, [5, 5, 5])).toBe(0.75);
  });

  it('recalculates the effective chance before each independent check', () => {
    const state = game();
    enhance(state, 0, 'personalTrainer');
    enhance(state, 1, 'personalTrainer');
    const result = playThreeKind(state, sequence(0.49, 0.02));
    const checks = result.state.historyV2.flatMap(event => event.kind === 'hand_scored' ? event.checks : [])
      .filter(check => check.source === 'personalTrainer');
    expect(checks.map(check => check.chance)).toEqual([0.5, 0.01]);
    expect(checks.map(check => check.succeeded)).toEqual([true, false]);
    expect(result.state.handLevels.threeKind).toBe(2);
  });

  it('checks each scoring Trainer face independently and allows multiple levels from one hand', () => {
    const mixed = game();
    enhance(mixed, 0, 'personalTrainer');
    enhance(mixed, 1, 'personalTrainer');
    const oneSuccess = playThreeKind(mixed, sequence(0.49, 0.5));
    expect(oneSuccess.state.stats.probabilityProcs.personalTrainer)
      .toEqual({ checks: 2, successes: 1, failures: 1, stacksAtCheck: [1, 1] });
    expect(oneSuccess.state.handLevels.threeKind).toBe(2);

    const both = game();
    enhance(both, 0, 'personalTrainer');
    enhance(both, 1, 'personalTrainer');
    const twoSuccesses = playThreeKind(both, constant(0));
    expect(twoSuccesses.state.handLevels.threeKind).toBe(3);
    expect(twoSuccesses.state.stats.personalTrainerLevelsGranted).toBe(2);
  });

  it('trains only after the scored hand is finalized and awarded', () => {
    const state = game();
    enhance(state, 0, 'personalTrainer');
    const result = playThreeKind(state, constant(0));
    expect(result.state.stats.handScores[0].handLevel).toBe(1);
    expect(result.state.handLevels.threeKind).toBe(2);
    const scored = result.state.historyV2.find(event => event.kind === 'hand_scored' && event.hand === 'threeKind');
    expect(scored?.kind).toBe('hand_scored');
    if (scored?.kind !== 'hand_scored') throw new Error('Missing structured hand event');
    expect(scored.level).toBe(1);
    expect(scored.checks).toContainEqual(expect.objectContaining({ source: 'personalTrainer', succeeded: true }));
    expect(scored.sideEffects).toContainEqual(expect.objectContaining({ type: 'personal_trainer', beforeLevel: 1, afterLevel: 2 }));
  });

  it('counts a successful scoring Hitchhiker but not a failed one', () => {
    const joined = game();
    enhance(joined, 4, 'hitchhiker');
    enhance(joined, 4, 'personalTrainer');
    const success = playThreeKind(joined, sequence(0, 0));
    expect(success.state.stats.handScores[0].dieIds).toEqual([0, 1, 2, 4]);
    expect(success.state.handLevels.threeKind).toBe(2);
    expect(success.state.stats.probabilityProcs.personalTrainer.checks).toBe(1);

    const held = game();
    enhance(held, 4, 'hitchhiker');
    enhance(held, 4, 'personalTrainer');
    const failure = playThreeKind(held, constant(0.99));
    expect(failure.state.stats.handScores[0].dieIds).toEqual([0, 1, 2]);
    expect(failure.state.handLevels.threeKind).toBe(1);
    expect(failure.state.stats.probabilityProcs.personalTrainer.checks).toBe(0);
  });

  it('counts a Jumping Bean scoring face', () => {
    const state = game([1, 2, 3, 4, 5]);
    enhance(state, 0, 'bump', 1, 1);
    enhance(state, 0, 'jumpingBean', 1, 2);
    enhance(state, 0, 'personalTrainer', 1, 2);
    enhance(state, 0, 'sticky', 1, 2);
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, sequence(0, 0));
    expect(result.state.stats.handScores[0]).toMatchObject({ hand: 'twos', playSource: 'jumpingBean', handLevel: 1 });
    expect(result.state.handLevels.twos).toBe(2);
    expect(result.state.stats.jumpingBeanFreePlays[0].personalTrainerSucceeded).toBe(true);
  });

  it('does not check a Trainer merely because its face is showing or rolled', () => {
    const showing = game();
    enhance(showing, 0, 'personalTrainer');
    const held = dispatch(showing, { type: 'MANUAL_REROLL', dieIds: [3] }, constant(0));
    expect(held.state.stats.probabilityProcs.personalTrainer.checks).toBe(0);

    const rolled = game([1, 2, 3, 4, 5]);
    enhance(rolled, 0, 'bump', 1, 1);
    enhance(rolled, 0, 'personalTrainer', 1, 2);
    const landed = dispatch(rolled, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0));
    expect(activeFace(landed.state.dice[0]).rank).toBe(2);
    expect(landed.state.stats.probabilityProcs.personalTrainer.checks).toBe(0);
    expect(landed.state.handLevels.twos).toBe(1);
  });
});
