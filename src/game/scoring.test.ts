import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { finalizeScore, handScore } from './scoring';
import { createDieEffect, resetDieRoundState } from './specialDice';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import type { RandomSource, Rank } from './types';

const constant = (value = .99): RandomSource => ({ next: () => value });

describe('whole-die scoring', () => {
  it.each([
    { pips: 32, multiplier: 3, rawScore: '96', finalScore: 96n },
    { pips: 13, multiplier: 1.25, rawScore: '16.25', finalScore: 16n },
    { pips: 13, multiplier: 1.5, rawScore: '19.5', finalScore: 20n },
  ])('rounds once after multiplication', ({ pips, multiplier, rawScore, finalScore }) => {
    expect(finalizeScore(pips, multiplier)).toEqual({ rawScore, finalScore });
  });

  it('uses printed pips, hand stats, and a whole Bonus die exactly once', () => {
    const state = newRun('whole-score', constant()).state;
    ([4, 4, 4, 2, 6] as Rank[]).forEach((rank, index) => { state.dice[index].value = rank; });
    rosterDice(state)[0].effects = [createDieEffect(rosterDice(state)[0].id, 'bonus', 2)];
    syncActiveDiceProjection(state);
    state.dieRoundState = resetDieRoundState(rosterDice(state));
    const preview = handScore(state.dice, 'threeKind', [0, 1, 2]);
    expect(preview.pips).toBe(22);
    const resolved = dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant());
    expect(resolved.state.stats.handScores[0]).toMatchObject({ pips: 42, bonusPips: 20 });
  });
});
