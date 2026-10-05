import { describe, expect, it } from 'vitest';
import { newRun, dispatch } from './engine';
import { scoreAnnouncement, scorePresentation } from './scorePresentation';
import type { GameEvent } from './types';

describe('score resolution presentation', () => {
  it('begins at authoritative Base Pips and Mult without an empty XMult stage', () => {
    const state = newRun('score-presentation-base').state;
    state.target = 1_000_000;
    state.dice.forEach((die, index) => { die.value = index < 2 ? 1 : (index + 1) as 1 | 2 | 3 | 4 | 5 | 6; });
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0, 1] });
    const started = result.events.find(event => event.type === 'HAND_STARTED')!;
    const view = scorePresentation(started)!;
    expect(view).toMatchObject({
      pips: started.handScore!.basePips,
      mult: started.handScore!.baseMultiplier,
      xMult: 1,
      showXMult: false,
      finalScore: null,
    });
  });

  it('uses typed contribution values and keeps Workout future-only', () => {
    const state = newRun('score-presentation-effects').state;
    state.target = 1_000_000;
    const die = state.dice[0];
    die.value = 1;
    die.faces[0].enhancements.bonus = 1;
    die.faces[0].enhancements.workout = 1;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] });
    const bonus = result.events.find(event => event.type === 'HAND_PIPS_CHANGED' && event.enhancement === 'bonus')!;
    const workout = result.events.find(event => event.type === 'WORKOUT_INCREMENTED')!;
    expect(scorePresentation(bonus)).toMatchObject({ pips: bonus.handScore!.currentPips, callout: 'BONUS +10', activeMetric: 'pips' });
    expect(scorePresentation(workout)).toMatchObject({ pips: workout.handScore!.currentPips, callout: 'WORKOUT +1 FUTURE PIP', activeMetric: null });
  });

  it('reveals meaningful XMult and announces the authoritative final summary', () => {
    const state = newRun('score-presentation-xmult').state;
    state.target = 1_000_000;
    state.dice[0].value = 1;
    const started = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }).events.find(event => event.type === 'HAND_STARTED')!;
    const event = structuredClone(started) as GameEvent;
    event.type = 'HAND_XMULT_CHANGED';
    event.flame = 'doubleDown';
    event.xMultFactor = { source: 'doubleDown', value: 1.8, dieId: 0 };
    event.handScore!.currentXMult = 1.8;
    event.handScore!.finalScore = 208;
    const view = scorePresentation(event)!;
    expect(view).toMatchObject({ showXMult: true, xMult: 1.8, callout: 'DOUBLE DOWN ×1.8', finalScore: 208 });
    expect(scoreAnnouncement(view)).toContain('XMult 1.8. Final score 208');
  });
});
