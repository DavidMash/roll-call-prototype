import { describe, expect, it } from 'vitest';
import { appendCriticalDiagnostic, appendDebugTrace, createDebugTrace, DEBUG_TRACE_MAX_BYTES, DEBUG_TRACE_MAX_RECORDS } from './debugTrace';
import { dispatch, newRun } from './engine';
import { createRunHistoryTextV2, exportDebugTrace, exportRunHistoryV2 } from './runHistoryV2Export';
import { summarizeRunHistoryV2 } from './runHistoryV2Summary';
import { classifyRunHistoryV2Timelines } from './runHistoryV2Timeline';
import type { RunHistoryV2Event } from './runHistoryV2';
import type { RandomSource } from './types';
import { CONFIG } from './config';

const constant = (value = 0): RandomSource => ({ next: () => value });

describe('Run History V2 experienced and canonical semantics', () => {
  it('classifies abandoned Bust activity while retaining it in experienced metrics', () => {
    let state = newRun('pass2-bust', constant()).state;
    state.target = 1_000_000;
    state.stats.rounds[0].target = state.target;
    state.manualRerollsRemaining = 0;
    state.gold = 999;
    state.handLevels.ones = 99;
    state.dice[0].faces[0].enhancements.bonus = 1;
    state.consumed = ['twos', 'threes', 'fours', 'fives', 'sixes', 'pair', 'twoPair', 'threeKind',
      'smallStraight', 'largeStraight', 'fullHouse', 'fourKind', 'fiveKind'];
    state.dice[0].value = 1;
    state = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant()).state;

    const summary = summarizeRunHistoryV2(state.historyV2, state);
    expect(summary.experienced.busts).toBe(1);
    expect(summary.experienced.handUsage.ones).toBe(1);
    expect(summary.experienced.largestHand).toMatchObject({ hand: 'ones', abandoned: true });
    expect(summary.experienced.largestCanonicalTimelineHand).toBeNull();
    expect(summary.canonical.finalGold).toBe(CONFIG.startingGold);
    expect(summary.canonical.finalLives).toBe(CONFIG.maxLives - 1);
    expect(summary.canonical.finalHandLevels.ones).toBe(1);
    expect(summary.canonical.retainedEnhancements.flatMap(item => Object.keys(item.enhancements))).not.toContain('bonus');
    expect(summary.timelines.abandonedRanges).toContainEqual(expect.objectContaining({ reason: 'bust' }));
  });

  it('keeps experienced offer impressions separate from retained canonical offers', () => {
    const state = newRun('pass2-offers', constant()).state;
    const base = { round: 1, attempt: 1, actionId: 0, timelineId: 0 };
    const offers: RunHistoryV2Event = { ...base, seq: state.historyV2.length, kind: 'shop_offers_presented',
      pool: 'enhancement', reason: 'reroll', offers: [
        { id: 90, contentId: 'bonus', rarity: 'common' },
        { id: 91, contentId: 'tank', rarity: 'rare' },
      ] };
    state.historyV2.push(offers);
    state.shop = { kind: 'between_rounds', offers: [{ id: 92, enhancement: 'workout', purchased: false }],
      trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0,
      freeEnhancementOfferIds: [], freeTrainingOfferKeys: [] };

    const summary = summarizeRunHistoryV2(state.historyV2, state);
    expect(summary.experienced.offerImpressions.enhancement).toMatchObject({ total: 2,
      byRarity: { common: 1, rare: 1 }, bySource: { reroll: 2 } });
    expect(summary.canonical.retainedOffers.enhancements).toEqual([{ enhancement: 'workout', rarity: 'common' }]);
  });

  it('records Bad Dream and Time Travel as explicit abandoned timeline boundaries', () => {
    const state = newRun('timeline-fixture', constant()).state;
    const events: RunHistoryV2Event[] = [
      ...state.historyV2,
      { seq: state.historyV2.length, kind: 'hand_scored', round: 4, attempt: 1, actionId: 2, timelineId: 0,
        hand: 'ones', level: 1, playSource: 'manual', selectedDice: [0], scoringDice: [], consumed: true,
        score: { basePips: 1, finalPips: 1, baseMult: 1, finalMult: 1, finalXMult: 1, bossFactor: 1,
          raw: 1, awarded: 1, rounding: { mode: 'nearest_integer', delta: 0 } },
        roundScore: { before: 0, afterAward: 1, after: 1 }, pipsContributions: [], multContributions: [],
        xMultContributions: [], checks: [], sideEffects: [] },
      { seq: state.historyV2.length + 1, kind: 'checkpoint_restored', round: 2, attempt: 1, actionId: 3,
        timelineId: 1, reason: 'bad_dream', fromTimelineId: 0, toTimelineId: 1,
        abandonedFromSeq: state.historyV2.length, abandonedThroughSeq: state.historyV2.length,
        canonicalRound: 2, canonicalAttempt: 1 },
      { seq: state.historyV2.length + 2, kind: 'checkpoint_restored', round: 7, attempt: 1, actionId: 4,
        timelineId: 2, reason: 'time_travel', fromTimelineId: 1, toTimelineId: 2,
        abandonedFromSeq: state.historyV2.length + 1, abandonedThroughSeq: state.historyV2.length + 1,
        canonicalRound: 7, canonicalAttempt: 1 },
    ];
    const classified = classifyRunHistoryV2Timelines(events);
    expect(classified.ranges.map(range => range.reason)).toEqual(['bad_dream', 'time_travel']);
    expect(classified.isCanonical(events[state.historyV2.length])).toBe(false);
  });

  it('labels partial migrated histories and never claims complete metrics', () => {
    const state = newRun('partial-v2', constant()).state;
    state.round = 27;
    state.historyV2 = [];
    state.historyV2Coverage = { complete: false, firstRound: 27, firstActionId: 144, firstSeq: 0 };
    const text = createRunHistoryTextV2(state);
    const data = exportRunHistoryV2(state);
    expect(text).toContain('INCOMPLETE V2 HISTORY · begins at Round 27, action 144');
    expect(data.coverage.complete).toBe(false);
    expect(data.summary.coverage.metricsComplete).toBe(false);
  });
});

describe('bounded Debug Trace and exports', () => {
  it('caps ordinary trace retention and keeps truncation and critical diagnostics outside the ring', () => {
    const trace = createDebugTrace();
    for (let index = 0; index < DEBUG_TRACE_MAX_RECORDS + 80; index++)
      appendDebugTrace(trace, { round: 1, attempt: 1, actionId: index },
        { kind: 'resolution', rngBefore: index, rngAfter: index + 1, playbackEvents: 5 });
    appendCriticalDiagnostic(trace, { round: 1, attempt: 1, actionId: 999 },
      { kind: 'invariant_failure', detail: 'fixture invariant' });
    expect(trace.records.length).toBeLessThanOrEqual(DEBUG_TRACE_MAX_RECORDS);
    expect(trace.bufferBytes).toBeLessThanOrEqual(DEBUG_TRACE_MAX_BYTES);
    expect(trace.droppedRecords).toBeGreaterThan(0);
    expect(trace.firstAvailableSeq).toBeGreaterThan(0);
    expect(trace.critical).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'trace_truncated', droppedRecords: trace.droppedRecords }),
      expect.objectContaining({ kind: 'invariant_failure', detail: 'fixture invariant' }),
    ]));
  });

  it('retains all records only when full mode was enabled before the run', () => {
    const state = newRun('full-trace', constant(), { debugTraceMode: 'full' }).state;
    for (let index = 0; index < DEBUG_TRACE_MAX_RECORDS + 10; index++)
      appendDebugTrace(state.debugTrace, { round: 1, attempt: 1, actionId: index },
        { kind: 'resolution', rngBefore: index, rngAfter: index + 1, playbackEvents: 0 });
    expect(state.debugTrace.mode).toBe('full');
    expect(state.debugTrace.records.length).toBeGreaterThan(DEBUG_TRACE_MAX_RECORDS);
    expect(state.debugTrace.droppedRecords).toBe(0);
  });

  it('keeps structured run data and debug reproduction data separate from playback snapshots', () => {
    const state = dispatch(newRun('exports', constant()).state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant()).state;
    const runData = exportRunHistoryV2(state);
    const debugData = exportDebugTrace(state);
    expect(runData.events.map(({ timelineStatus: _status, ...event }) => event)).toEqual(state.historyV2);
    expect(runData.events.every(event => event.timelineStatus === 'canonical')).toBe(true);
    expect(runData.summary.canonical.finalGold).toBe(state.gold);
    expect(debugData.actionJournal).toEqual(state.actionJournal);
    expect(debugData.trace.records.length).toBeGreaterThan(0);
    expect(JSON.stringify(runData)).not.toContain('"board"');
    expect(JSON.stringify(debugData)).not.toContain('"board"');
  });
});
