import { describe, expect, it } from 'vitest';
import { activeFace, scoringPips } from './dice';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { planQualification } from './hands';
import { renderHandScoredV2 } from './runHistoryV2Renderer';
import type { GameState, RandomSource } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });
function hexerState(): GameState {
  const state = newRun('hexer-face-seven-regression', constant()).state;
  state.round = 6;
  state.bossSchedule[6] = 'hexer';
  new Resolver(state, constant()).startRound();
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
  return state;
}

describe('Hexer Cursed Die face/scoring coherence', () => {
  it('scores the plain seventh face as 7 Pips through the temporary Sevens hand', () => {
    const state = hexerState();
    const cursed = state.encounterDice[0];
    cursed.value = 7;
    const selected = [cursed.id];

    expect(activeFace(cursed).rank).toBe(7);
    expect(scoringPips(activeFace(cursed))).toBe(7);
    expect(planQualification(state.dice, 'sevens', selected, { roundState: state.dieRoundState }).legal).toBe(true);
    expect(cursed.faces.every(face => !('hexerEffect' in face))).toBe(true);

    const result = dispatch(state, { type: 'PLAY', hand: 'sevens', dieIds: selected }, constant(.7));
    expect(result.error).toBeUndefined();
    const scored = [...result.state.historyV2].reverse().find(event => event.kind === 'hand_scored');
    if (!scored || scored.kind !== 'hand_scored') throw new Error('Expected Hexer hand history.');
    expect(scored.scoringDice.find(die => die.dieId === -1)).toMatchObject({ face: 7, pips: 7 });
    expect(renderHandScoredV2(scored)).toContain('Sevens');
    expect(renderHandScoredV2(scored)).not.toContain('Die #-1=57');

    const nextCursed = result.state.encounterDice[0];
    expect(nextCursed.faces).toHaveLength(7);
    expect(activeFace(nextCursed).rank).toBe(nextCursed.faces[nextCursed.value - 1].rank);
  });
});
