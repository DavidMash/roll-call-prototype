import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { HAND_IDS } from './hands';
import { playbackBoard, rollBatchPresentation, SCORECARD_REFRESH_HOLD_MS, scoreSummaryJump } from './playback';

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

describe('simultaneous roll batch presentation', () => {
  it('settles every participating base die on the first result frame without changing event order', () => {
    const state = newRun('simultaneous-initial-roll').state;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 2, 4] }, { next: () => 0 });
    const startIndex = result.events.findIndex(event => event.type === 'DICE_REROLL_STARTED');
    const firstResultIndex = result.events.findIndex((event, index) => index > startIndex && event.type === 'DIE_ROLLED');
    const batch = rollBatchPresentation(result.events, firstResultIndex)!;
    const presented = playbackBoard(result.events, firstResultIndex, result.state);
    const settled = result.events[batch.settleIndex].board;

    expect(batch.dieIds).toEqual([0, 2, 4]);
    expect(result.events.slice(startIndex + 1, batch.settleIndex + 1).filter(event => event.type === 'DIE_ROLLED')
      .map(event => event.dieIds?.[0])).toEqual([0, 2, 4]);
    expect(presented.dice.filter(die => batch.dieIds.includes(die.id)).map(die => die.value))
      .toEqual(settled.dice.filter(die => batch.dieIds.includes(die.id)).map(die => die.value));
    expect(rollBatchPresentation(result.events, startIndex)).toBeNull();
    expect(rollBatchPresentation(result.events, batch.settleIndex + 1)).toBeNull();
  });

  it('keeps non-dice state on each authoritative effect frame while projecting settled faces', () => {
    const state = newRun('simultaneous-clockmaker-roll').state;
    state.boss = { type: 'clockmaker' };
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1] }, { next: () => 0 });
    const bumpIndex = result.events.findIndex(event => event.type === 'BUMP_ROLL');
    const batch = rollBatchPresentation(result.events, bumpIndex)!;
    const presented = playbackBoard(result.events, bumpIndex, result.state);

    expect(batch.dieIds).toEqual([0, 1]);
    expect(result.events.filter(event => event.type === 'BUMP_ROLL').map(event => event.dieIds)).toEqual([[0], [1]]);
    expect(presented.score).toBe(result.events[bumpIndex].board.score);
    expect(presented.dice.slice(0, 2).map(die => die.value))
      .toEqual(result.events[batch.settleIndex].board.dice.slice(0, 2).map(die => die.value));
  });

  it('uses the shared batch presentation for initial, post-hand, winning-settle, and Shop rolls', () => {
    const postHandState = newRun('simultaneous-post-hand').state;
    postHandState.target = 1_000_000;
    postHandState.dice.forEach((die, index) => { die.value = index < 4 ? 1 : 2; });
    const winningState = structuredClone(postHandState);
    winningState.target = 1;
    const shopState = newRun('simultaneous-shop').state;
    shopState.phase = 'shop';
    shopState.gold = 100;
    shopState.shop = { kind: 'between_rounds', offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    const cases = [
      { result: newRun('simultaneous-opening'), reason: 'Initial round roll', ids: [0, 1, 2, 3, 4] },
      { result: dispatch(postHandState, { type: 'PLAY', hand: 'fourKind', dieIds: [0, 1, 2, 3] }), reason: 'Post-hand reroll', ids: [0, 1, 2, 3] },
      { result: dispatch(winningState, { type: 'PLAY', hand: 'fourKind', dieIds: [0, 1, 2, 3] }), reason: 'Winning hand settle reroll', ids: [0, 1, 2, 3] },
      { result: dispatch(shopState, { type: 'REROLL_DICE' }), reason: 'Shop dice reroll', ids: [0, 1, 2, 3, 4] },
    ];

    for (const { result, reason, ids } of cases) {
      const startIndex = result.events.findIndex(event => event.type === 'DICE_REROLL_STARTED' && event.message.startsWith(reason));
      const resultIndex = result.events.findIndex((event, index) => index > startIndex && event.type === 'DIE_ROLLED');
      const batch = rollBatchPresentation(result.events, resultIndex)!;
      expect(startIndex).toBeGreaterThanOrEqual(0);
      expect(batch.dieIds).toEqual(ids);
      expect(playbackBoard(result.events, resultIndex, result.state).dice.filter(die => ids.includes(die.id)).map(die => die.value))
        .toEqual(result.events[batch.settleIndex].board.dice.filter(die => ids.includes(die.id)).map(die => die.value));
    }
  });
});
