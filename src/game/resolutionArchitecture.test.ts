import { describe, expect, it } from 'vitest';
import { activeFace, createDice } from './dice';
import { dispatch, newRun } from './engine';
import { planQualification } from './hands';
import { createPlayIntent, createRollBatchIntent, createRollIntent } from './resolution';
import type { GameState, RandomSource, Rank } from './types';

const constant = (value: number): RandomSource => ({ next: () => value });

function setValues(state: GameState, values: Rank[]): void {
  state.dice.forEach((die, index) => { die.value = values[index]; });
}

describe('resolution architecture boundaries', () => {
  it('plans legacy qualification effects without mutating dice or claiming resources', () => {
    const mirrorDice = createDice();
    mirrorDice[0].value = 2;
    mirrorDice[1].value = 3;
    activeFace(mirrorDice[0]).enhancements.mirror = 1;
    const mirrorBefore = structuredClone(mirrorDice);
    expect(planQualification(mirrorDice, 'pair', [0, 1])).toEqual({
      hand: 'pair', requestedDieIds: [0, 1], qualifyingDieIds: [0, 1], legal: true,
      effects: [{ dieId: 0, face: 2, effect: 'mirror' }], resourceClaims: [],
    });
    expect(mirrorDice).toEqual(mirrorBefore);

    const straightDice = createDice();
    [1, 2, 6, 4, 5].forEach((value, index) => { straightDice[index].value = value as Rank; });
    activeFace(straightDice[2]).enhancements.missingLink = 1;
    expect(planQualification(straightDice, 'smallStraight', [0, 1, 2, 3])).toMatchObject({
      legal: true, effects: [{ dieId: 2, face: 6, effect: 'missingLink' }], resourceClaims: [],
    });

    const conjoinedDice = createDice();
    conjoinedDice[0].value = 4;
    activeFace(conjoinedDice[0]).enhancements.conjoined = 1;
    expect(planQualification(conjoinedDice, 'pair', [0])).toMatchObject({
      legal: true, effects: [{ dieId: 0, face: 4, effect: 'conjoined' }], resourceClaims: [],
    });
  });

  it('retains committed, player-selected, and generated Play identities separately', () => {
    const manual = createPlayIntent('play:1', 'threeKind', [2, 0, 1], 'manual', 125);
    expect(manual).toMatchObject({
      id: 'play:1', hand: 'threeKind', source: 'manual', cause: 'player',
      selectedDieIds: [2, 0, 1], originalSelectedDieIds: [2, 0, 1],
      playerSelectedDieIds: [2, 0, 1], decisionMs: 125,
    });
    const generated = createPlayIntent('play:2', 'sixes', [4], 'jumpingBean', null);
    expect(generated).toMatchObject({
      cause: 'jumping_bean', selectedDieIds: [4], originalSelectedDieIds: [4],
      playerSelectedDieIds: [],
    });
  });

  it('classifies initial, manual, post-Play, and effect-generated Roll intents explicitly', () => {
    const initial = createRollBatchIntent('roll:1', [0, 1], 'Initial round roll', 'gameplay', 'initial_round');
    expect(initial).toMatchObject({ initialRoundRoll: true, reroll: false, manual: false,
      postPlay: false, effectGenerated: false });

    const manual = createRollBatchIntent('roll:2', [0], 'Manual gameplay reroll', 'gameplay', 'manual');
    expect(createRollIntent(manual, 0)).toMatchObject({
      batchId: 'roll:2', dieId: 0, initialRoundRoll: false, reroll: true, manual: true,
      postPlay: false, effectGenerated: false, excludeStartingFace: true,
    });

    expect(createRollBatchIntent('roll:3', [0], 'Post-hand reroll', 'gameplay', 'post_hand'))
      .toMatchObject({ postPlay: true, reroll: true });
    expect(createRollBatchIntent('roll:4', [0], 'Jumping Bean reroll', 'gameplay', 'jumping_bean_followup'))
      .toMatchObject({ postPlay: false, effectGenerated: true, reroll: true });
  });

  it('resolves Double Time as one additional genuine Score while suppressing only its recursion', () => {
    const state = newRun('score-occurrence-characterization', constant(.99)).state;
    state.target = 1_000_000n;
    state.stats.rounds[0].target = state.target;
    setValues(state, [4, 4, 4, 2, 6]);
    const face = activeFace(state.dice[0]);
    face.enhancements = { doubleTime: 1, bonus: 1, golden: 1, workout: 1, vintage: 1 };

    const result = dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant(0));

    expect(result.state.stats.probabilityProcs.doubleTime).toMatchObject({ checks: 1, successes: 1, failures: 0 });
    expect(result.state.stats.handScores[0].bonusPips).toBe(20);
    expect(result.state.stats.goldBySource.golden).toBe(2);
    expect(result.state.dice[0].faces[3]).toMatchObject({ workoutPips: 2, vintageSellValue: 6 });
    expect(result.events.filter(event => event.type === 'ABILITY_TRIGGERED' && event.enhancement === 'doubleTime')).toHaveLength(1);
    expect(result.events.filter(event => event.type === 'GOLD_ADDED' && event.goldSource === 'golden')).toHaveLength(2);
  });
});
