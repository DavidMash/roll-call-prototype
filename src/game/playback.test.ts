import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { HAND_IDS } from './hands';
import { SCORECARD_REFRESH_HOLD_MS, scoreSummaryJump } from './playback';

describe('score summary playback checkpoint', () => {
  it('lands Instant and Skip on the final authoritative hand boxes before the batch ends', () => {
    const state = newRun('score-summary-jump').state;
    state.target = 1_000_000;
    state.dice[0].value = 1;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] });
    const jump = scoreSummaryJump(result.events, 0)!;
    expect(result.events[jump.summaryIndex].type).toBe('HAND_SCORE_FINALIZED');
    expect(result.events[jump.summaryIndex].handScore?.finalScore).toBe(result.events[jump.summaryIndex].amount);
    expect(jump.boundaryIndex).toBe(result.events.length);
  });

  it('does not manufacture a summary for a non-scoring resolution', () => {
    const state = newRun('no-score-summary').state;
    expect(scoreSummaryJump(dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }).events, 0)).toBeNull();
  });

  it('keeps the scorecard refresh after the final score in Instant playback', () => {
    const state = newRun('scorecard-refresh-playback').state;
    state.target = 1_000_000;
    state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    state.scorecardCycleConsumed = [...state.consumed];
    state.dice[0].value = 1;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, { next: () => 0 });
    const refreshIndex = result.events.findIndex(event => event.type === 'SCORECARD_REFRESHED');
    const jump = scoreSummaryJump(result.events, 0)!;

    expect(refreshIndex).toBeGreaterThan(jump.summaryIndex);
    expect(jump.boundaryIndex).toBe(refreshIndex);
    expect(SCORECARD_REFRESH_HOLD_MS.normal).toBeGreaterThan(SCORECARD_REFRESH_HOLD_MS.fast);
    expect(SCORECARD_REFRESH_HOLD_MS.instant).toBeGreaterThan(SCORECARD_REFRESH_HOLD_MS.fast);
  });
});
