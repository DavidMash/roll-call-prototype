import { describe, expect, it } from 'vitest';
import { appendCriticalDiagnostic, appendDebugTrace } from './debugTrace';
import { dispatch, newRun } from './engine';
import { HAND_IDS } from './hands';
import { compactGameStateForPersistence, loadPersistedRun, RUN_STORAGE_KEY, savePersistedRun } from './persistence';
import { captureRollbackState, restoreRollbackState } from './rollback';
import { classifyRunHistoryV2Timelines } from './runHistoryV2Timeline';
import { summarizeRunHistoryV2 } from './runHistoryV2Summary';
import type { GameState, Rank } from './types';
import type { RunHistoryV2Coverage, RunHistoryV2Event } from './runHistoryV2';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const coverage: RunHistoryV2Coverage = { complete: true, firstRound: 1, firstActionId: 0, firstSeq: 0 };
const fake = (seq: number, timelineId: number, event: Partial<RunHistoryV2Event>): RunHistoryV2Event => ({
  seq, timelineId, round: 1, attempt: 1, actionId: seq, kind: 'scorecard_refreshed', refreshedHands: [], ...event,
} as RunHistoryV2Event);

describe('Run History V2 Pass 3 ownership', () => {
  it('captures gameplay-only RollbackState and leaves cumulative owners untouched on restore', () => {
    const state = newRun('rollback-owner').state;
    const rollback = captureRollbackState(state);
    const traceBefore = state.debugTrace.records.length;
    expect(Object.keys(rollback).sort()).toEqual(['board', 'nextOfferId', 'rngState']);
    for (const excluded of ['history', 'historyV2', 'stats', 'debugTrace', 'actionJournal', 'roundCheckpoint',
      'badDreamCheckpoint', 'events']) expect(JSON.stringify(rollback)).not.toContain(`"${excluded}"`);

    const historyBefore = state.historyV2.length;
    state.gold = 99;
    state.historyV2.push(fake(state.historyV2.length, 0, {}));
    state.actionJournal.push({ type: 'MANUAL_REROLL', dieIds: [0] });
    state.stats.manualRerollActions++;
    appendDebugTrace(state.debugTrace, { round: 1, attempt: 1, actionId: 1 },
      { kind: 'scoring_step', hand: 'ones', stage: 'final', before: 0, after: 0, source: 'manual' });
    restoreRollbackState(state, rollback);

    expect(state.gold).toBe(rollback.board.gold);
    expect(state.historyV2).toHaveLength(historyBefore + 1);
    expect(state.actionJournal).toHaveLength(1);
    expect(state.stats.manualRerollActions).toBe(1);
    expect(state.debugTrace.records).toHaveLength(traceBefore + 1);
  });

  it('classifies sequential and nested rollback ranges deterministically', () => {
    const events = [
      fake(0, 0, {}),
      fake(1, 1, { kind: 'checkpoint_restored', reason: 'bust', fromTimelineId: 0, toTimelineId: 1,
        abandonedFromSeq: 0, abandonedThroughSeq: 0, canonicalRound: 1, canonicalAttempt: 2 }),
      fake(2, 1, {}),
      fake(3, 2, { kind: 'checkpoint_restored', reason: 'bust', fromTimelineId: 1, toTimelineId: 2,
        abandonedFromSeq: 2, abandonedThroughSeq: 2, canonicalRound: 1, canonicalAttempt: 3 }),
      fake(4, 2, {}),
      fake(5, 3, { kind: 'checkpoint_restored', reason: 'time_travel', fromTimelineId: 2, toTimelineId: 3,
        abandonedFromSeq: 3, abandonedThroughSeq: 4, canonicalRound: 1, canonicalAttempt: 1 }),
    ];
    const result = classifyRunHistoryV2Timelines(events, coverage);
    expect(events.map(event => result.status(event))).toEqual([
      'abandoned', 'canonical', 'abandoned', 'abandoned', 'abandoned', 'canonical',
    ]);
    expect(result.canonicalEvents().map(event => event.seq)).toEqual([1, 5]);
    expect(result.experiencedEvents()).toHaveLength(6);
    expect(result.ranges).toHaveLength(3);
  });

  it('marks provenance before the first structured restore unknown in a partial migrated stream', () => {
    const partial = { complete: false, firstRound: 27, firstActionId: 100, firstSeq: 0 };
    const events = [fake(0, 4, {}), fake(1, 5, { kind: 'checkpoint_restored', reason: 'bad_dream',
      fromTimelineId: 4, toTimelineId: 5, abandonedFromSeq: 99, abandonedThroughSeq: 99,
      canonicalRound: 27, canonicalAttempt: 1 }), fake(2, 5, {})];
    const result = classifyRunHistoryV2Timelines(events, partial);
    expect(events.map(event => result.status(event))).toEqual(['unknown', 'canonical', 'canonical']);
    expect(result.unknownEvents()).toEqual([events[0]]);
  });

  it('keeps experienced hand history through Bust while canonical metrics exclude it', () => {
    const state = newRun('pass3-bust', { next: () => 0 }).state;
    state.target = 1_000_000;
    state.stats.rounds[0].target = state.target;
    state.dice.forEach((die, index) => { die.value = ([1, 2, 2, 4, 5] as Rank[])[index]; });
    state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    state.manualRerollsRemaining = 0;
    const busted = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, { next: () => 0 }).state;
    const timelines = classifyRunHistoryV2Timelines(busted.historyV2, busted.historyV2Coverage);
    const hand = busted.historyV2.find(event => event.kind === 'hand_scored')!;
    expect(timelines.status(hand)).toBe('abandoned');
    expect(timelines.ranges.at(-1)).toMatchObject({ reason: 'bust', canonicalAttempt: 2 });
    const summary = summarizeRunHistoryV2(busted.historyV2, busted);
    expect(summary.experienced.handUsage.ones).toBe(1);
    expect(summary.canonical.scoreByHand.ones).toBeUndefined();
    expect(busted.history).toEqual([]);
  });

  it('keeps rollback-heavy checkpoints bounded while retaining every experienced attempt', () => {
    let state = newRun('rollback-heavy-pass3', { next: () => 0 }).state;
    const checkpointSizes: number[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      state.target = 1_000_000;
      state.stats.rounds.at(-1)!.target = state.target;
      state.dice.forEach((die, index) => { die.value = ([1, 2, 2, 4, 5] as Rank[])[index]; });
      state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
      state.manualRerollsRemaining = 0;
      state = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, { next: () => 0 }).state;
      checkpointSizes.push(Buffer.byteLength(JSON.stringify(state.roundCheckpoint)));
      if (attempt === 0) state = dispatch(state, { type: 'RETRY_ROUND' }, { next: () => 0 }).state;
    }
    const classified = classifyRunHistoryV2Timelines(state.historyV2, state.historyV2Coverage);
    expect(classified.ranges.filter(range => range.reason === 'bust')).toHaveLength(2);
    expect(state.historyV2.filter(event => event.kind === 'hand_scored')).toHaveLength(2);
    expect(classified.canonicalEvents().some(event => event.kind === 'hand_scored')).toBe(false);
    expect(Math.max(...checkpointSizes)).toBeLessThan(10_000);
    expect(Math.max(...checkpointSizes) - Math.min(...checkpointSizes)).toBeLessThan(500);
    expect(Buffer.byteLength(JSON.stringify(compactGameStateForPersistence(state)))).toBeLessThan(100_000);
  });

  it('records Hooded attempt rollback on the new canonical timeline', () => {
    const state = newRun('hooded-rollback-pass3', { next: () => 0 }).state;
    state.hoodedFigure.active = { id: 'theLongWay', issuedChapter: 1, target: 3,
      committed: { value: 0, keys: [], invalid: false, jackpotPaid: false },
      attempt: { value: 0, keys: [], invalid: false, jackpotPaid: false }, complete: false, dialogueLine: 'test' };
    state.roundCheckpoint = captureRollbackState(state);
    state.hoodedFigure.active.attempt.value = 2;
    state.target = 1_000_000;
    state.stats.rounds[0].target = state.target;
    state.dice.forEach((die, index) => { die.value = ([1, 2, 2, 4, 5] as Rank[])[index]; });
    state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    state.manualRerollsRemaining = 0;
    const busted = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, { next: () => 0 }).state;
    const rolledBack = busted.historyV2.find(event => event.kind === 'hooded_challenge_changed'
      && event.change === 'rolled_back')!;
    const timelines = classifyRunHistoryV2Timelines(busted.historyV2, busted.historyV2Coverage);
    expect(rolledBack.timelineId).toBe(busted.historyV2TimelineId);
    expect(timelines.status(rolledBack)).toBe('canonical');
    expect(busted.hoodedFigure.active?.attempt.value).toBe(0);
  });

  it('persists V2, gameplay checkpoints, and replay actions without legacy or ordinary/full trace duplication', () => {
    const storage = new MemoryStorage();
    let state = newRun('compact-save', undefined, { debugTraceMode: 'full' }).state;
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }).state;
    appendCriticalDiagnostic(state.debugTrace, { round: 1, attempt: 1, actionId: 1 }, { kind: 'error', detail: 'kept' });
    state.history.push({ id: 999, round: 1, type: 'ABILITY_EVALUATED', message: 'legacy compatibility' });
    const compact = compactGameStateForPersistence(state);
    expect(compact.history).toEqual([]);
    expect(compact.historyV2).toEqual(state.historyV2);
    expect(compact.actionJournal).toEqual(state.actionJournal);
    expect(compact.stats.handScores).toEqual([]);
    expect(compact.stats.purchases).toEqual([]);
    expect(compact.debugTrace).toMatchObject({ mode: 'bounded', records: [], critical: state.debugTrace.critical });
    expect(compact.roundCheckpoint).not.toHaveProperty('historyV2');
    expect(compact.roundCheckpoint).not.toHaveProperty('debugTrace');
    expect(savePersistedRun(storage, state)).toBe(true);
    const loaded = loadPersistedRun(storage, state.seed)!;
    expect(loaded.history).toEqual([]);
    expect(loaded.historyV2).toEqual(state.historyV2);
    expect(loaded.actionJournal).toEqual(state.actionJournal);
    expect(loaded.debugTrace.records).toEqual([]);
    expect(loaded.debugTrace.critical).toEqual(state.debugTrace.critical);
  });

  it('resumes a version-2 broad checkpoint, marks missing V2 coverage partial, and writes only V2 afterward', () => {
    const storage = new MemoryStorage();
    const legacy = newRun('pass2-migration').state as GameState & Record<string, unknown>;
    const broad = structuredClone(legacy) as GameState & Record<string, unknown>;
    broad.roundCheckpoint = null;
    broad.badDreamCheckpoint = null;
    legacy.roundCheckpoint = broad as unknown as GameState['roundCheckpoint'];
    legacy.history = [{ id: 0, round: 1, type: 'ROUND_STARTED', message: 'old prose' }];
    const oldShape = legacy as Partial<GameState> & Record<string, unknown>;
    delete oldShape.historyV2;
    delete oldShape.historyV2Coverage;
    delete oldShape.historyV2TimelineId;
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: 2, state: legacy }));
    const loaded = loadPersistedRun(storage, null)!;
    expect(loaded.historyV2Coverage.complete).toBe(false);
    expect(loaded.roundCheckpoint).toHaveProperty('board');
    const next = dispatch(loaded, { type: 'MANUAL_REROLL', dieIds: [0] }).state;
    expect(next.history).toHaveLength(1);
    expect(next.historyV2.some(event => event.kind === 'roll_batch')).toBe(true);
    expect(savePersistedRun(storage, next)).toBe(true);
    expect(JSON.parse(storage.getItem(RUN_STORAGE_KEY)!).state.history).toEqual([]);
  });
});
