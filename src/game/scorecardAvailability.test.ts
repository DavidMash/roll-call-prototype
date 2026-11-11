import { describe, expect, it } from 'vitest';
import { newRun } from './engine';
import {
  deriveScorecardAvailability, ScorecardAvailabilityPlaybackGate,
} from './scorecardAvailability';
import { emptySelection } from './selection';
import type { GameState, Rank } from './types';

function game(values: Rank[]): GameState {
  const state = newRun('scorecard-availability', { next: () => 0 }).state;
  state.target = 1_000_000n;
  state.stats.rounds[0].target = state.target;
  state.dice.forEach((die, index) => { die.value = values[index]; });
  return state;
}

describe('scorecard availability playback gate', () => {
  it('does not derive availability again for cloned playback boards', () => {
    const gate = new ScorecardAvailabilityPlaybackGate();
    const pair = game([2, 2, 3, 4, 5]);
    const five = game([6, 6, 6, 6, 6]);
    let derivations = 0;
    const derive = (board: GameState) => {
      derivations++;
      return deriveScorecardAvailability(board, emptySelection());
    };

    const interactive = gate.resolve(false, () => derive(pair));
    expect(interactive.playableHands.has('fiveKind')).toBe(false);
    for (let beat = 0; beat < 5; beat++) {
      const playbackSnapshot = structuredClone(five);
      expect(gate.resolve(true, () => derive(playbackSnapshot))).toBe(interactive);
    }
    expect(derivations).toBe(1);
  });

  it('refreshes when playback finishes and on each interactive board change', () => {
    const gate = new ScorecardAvailabilityPlaybackGate();
    const pair = game([2, 2, 3, 4, 5]);
    const five = game([6, 6, 6, 6, 6]);
    const noPair = game([1, 2, 3, 4, 6]);
    let derivations = 0;
    const resolve = (board: GameState, busy: boolean) => gate.resolve(busy, () => {
      derivations++;
      return deriveScorecardAvailability(board, emptySelection());
    });

    expect(resolve(pair, false).playableHands.has('pair')).toBe(true);
    expect(resolve(five, true).playableHands.has('fiveKind')).toBe(false);
    expect(resolve(five, false).playableHands.has('fiveKind')).toBe(true);
    expect(resolve(noPair, false).playableHands.has('pair')).toBe(false);
    expect(derivations).toBe(3);
  });
});
