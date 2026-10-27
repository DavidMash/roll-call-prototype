import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { HAND_IDS } from './hands';
import { firstPresentedEventIndex, isPresentationSilentEvent, nextPresentedEventIndex, playbackBoard,
  playbackTickMs, rollBatchPresentation, SCORECARD_REFRESH_HOLD_MS, scoreSummaryJump } from './playback';
import { createDieEffect, resetDieRoundState } from './specialDice';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import type { GameEvent } from './types';

describe('score summary playback checkpoint', () => {
  it('gives each scoring die a punchy speed-specific beat and instant mode no delay', () => {
    const event = { type: 'DIE_PIPS_RESOLVED' } as Parameters<typeof playbackTickMs>[0];
    expect(playbackTickMs(event, 'normal')).toBe(200);
    expect(playbackTickMs(event, 'fast')).toBe(80);
    expect(playbackTickMs(event, 'instant')).toBe(0);
  });
  it('lands Instant and Skip on the final authoritative hand boxes before the batch ends', () => {
    const state = newRun('score-summary-jump').state;
    state.target = 1_000_000n;
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
    state.target = 1_000_000n;
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

  it('keeps non-dice state on a whole-die controller frame while projecting settled faces', () => {
    const state = newRun('simultaneous-clockwork-roll').state;
    rosterDice(state)[0].effects = [createDieEffect(rosterDice(state)[0].id, 'clockwork')];
    syncActiveDiceProjection(state);
    state.dieRoundState = resetDieRoundState(rosterDice(state));
    state.dice[0].value = 1;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1] }, { next: () => 0 });
    const resultIndex = result.events.findIndex(event => event.type === 'DIE_ROLLED');
    const batch = rollBatchPresentation(result.events, resultIndex)!;
    const presented = playbackBoard(result.events, resultIndex, result.state);

    expect(batch.dieIds).toEqual([0, 1]);
    expect(result.state.dice[0].value).toBe(2);
    expect(presented.score).toBe(BigInt(result.events[resultIndex].board.score));
    expect(presented.dice.slice(0, 2).map(die => die.value))
      .toEqual(result.events[batch.settleIndex].board.dice.slice(0, 2).map(die => die.value));
  });

  it('uses the shared batch presentation for initial, post-hand, and winning-settle rolls', () => {
    const postHandState = newRun('simultaneous-post-hand').state;
    postHandState.target = 1_000_000n;
    postHandState.dice.forEach((die, index) => { die.value = index < 4 ? 1 : 2; });
    const winningState = structuredClone(postHandState);
    winningState.target = 1n;
    const cases = [
      { result: newRun('simultaneous-opening'), reason: 'Initial round roll', ids: [0, 1, 2, 3, 4] },
      { result: dispatch(postHandState, { type: 'PLAY', hand: 'fourKind', dieIds: [0, 1, 2, 3] }), reason: 'Post-hand reroll', ids: [0, 1, 2, 3] },
      { result: dispatch(winningState, { type: 'PLAY', hand: 'fourKind', dieIds: [0, 1, 2, 3] }), reason: 'Winning hand settle reroll', ids: [0, 1, 2, 3] },
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

describe('player-visible playback cursor', () => {
  it('keeps one batch roll beat while retaining every raw per-die result', () => {
    const state = newRun('single-visible-roll-beat').state;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 2, 4] }, { next: () => 0 });
    const visibleTypes: string[] = [];
    for (let index = firstPresentedEventIndex(result.events); index < result.events.length;
      index = nextPresentedEventIndex(result.events, index)) visibleTypes.push(result.events[index].type);

    expect(result.events.filter(event => event.type === 'DIE_ROLLED')).toHaveLength(3);
    expect(visibleTypes.filter(type => type === 'DICE_REROLL_STARTED')).toHaveLength(1);
    expect(visibleTypes).not.toContain('DIE_ROLLED');
  });

  it('skips silent die results without swallowing interleaved effect beats', () => {
    const events = [
      { type: 'DICE_REROLL_STARTED' },
      { type: 'DIE_ROLLED' },
      { type: 'CHARGE_CHANGED' },
      { type: 'DIE_ROLLED' },
      { type: 'DEAD_BOARD' },
    ] as GameEvent[];

    expect(nextPresentedEventIndex(events, 0)).toBe(2);
    expect(nextPresentedEventIndex(events, 2)).toBe(4);
  });

  it('silences only round-end rewards and preserves in-round currency beats', () => {
    for (const goldSource of ['roundBase', 'unusedRerolls', 'interest', 'bossReward'] as const)
      expect(isPresentationSilentEvent({ type: 'GOLD_ADDED', goldSource } as GameEvent)).toBe(true);
    for (const temperSource of ['overkill', 'miniBoss', 'boss'] as const)
      expect(isPresentationSilentEvent({ type: 'TEMPER_CHANGED', temperSource } as GameEvent)).toBe(true);

    expect(isPresentationSilentEvent({ type: 'GOLD_ADDED', goldSource: 'golden' } as GameEvent)).toBe(false);
    expect(isPresentationSilentEvent({ type: 'GOLD_ADDED', goldSource: 'jackpot' } as GameEvent)).toBe(false);
    expect(isPresentationSilentEvent({ type: 'TEMPER_CHANGED', temperSource: 'boardRefresh' } as GameEvent)).toBe(false);
    expect(isPresentationSilentEvent({ type: 'TEMPER_CHANGED', temperSource: 'bonfire' } as GameEvent)).toBe(false);
  });

  it('moves from ROUND CLEARED directly to the authoritative results event', () => {
    const state = newRun('direct-round-summary').state;
    state.target = 1n;
    state.dice[0].value = 6;
    const result = dispatch(state, { type: 'PLAY', hand: 'sixes', dieIds: [0] }, { next: () => 0 });
    const clearedIndex = result.events.findIndex(event => event.type === 'ROUND_CLEARED');
    const summaryIndex = result.events.findIndex(event => event.type === 'ROUND_SUMMARY_SHOWN');

    expect(clearedIndex).toBeGreaterThanOrEqual(0);
    expect(result.events.slice(clearedIndex + 1, summaryIndex).some(event => event.type === 'GOLD_ADDED')).toBe(true);
    expect(result.events.slice(clearedIndex + 1, summaryIndex).some(event => event.type === 'TEMPER_CHANGED')).toBe(true);
    expect(nextPresentedEventIndex(result.events, clearedIndex)).toBe(summaryIndex);
    expect(isPresentationSilentEvent({ type: 'BOSS_CLEARED' } as GameEvent)).toBe(true);
  });

  it('folds the diagnostic Boss clear event into the visible ROUND CLEARED beat', () => {
    const state = newRun('direct-boss-summary').state;
    state.round = 6;
    state.target = 1n;
    state.dice[0].value = 6;
    state.boss = { type: 'caller', calledHand: 'sixes', playsRemaining: 3, satisfied: true, satisfyingSource: 'manual' };
    const result = dispatch(state, { type: 'PLAY', hand: 'sixes', dieIds: [0] }, { next: () => 0 });
    const visibleTypes: string[] = [];
    for (let index = firstPresentedEventIndex(result.events); index < result.events.length;
      index = nextPresentedEventIndex(result.events, index)) visibleTypes.push(result.events[index].type);

    expect(result.events.some(event => event.type === 'BOSS_CLEARED')).toBe(true);
    expect(visibleTypes).not.toContain('BOSS_CLEARED');
    expect(visibleTypes).toContain('ROUND_CLEARED');
    expect(visibleTypes.at(-1)).toBe('ROUND_SUMMARY_SHOWN');
  });
});
