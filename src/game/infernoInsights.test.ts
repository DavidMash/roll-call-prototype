import { describe, expect, it } from 'vitest';
import { newRun } from './engine';
import { infernoEvidenceInsights } from './engulfment';
import type { EngulfmentAssetRef, Flame, GameState } from './types';
import type { RunHistoryV2Event } from './runHistoryV2';

const fixed = { next: () => .2 };
const asset = (instanceId: number, flame: Flame, slot = 0): EngulfmentAssetRef =>
  ({ kind: 'bonfire', instanceId, flame, slot: slot as EngulfmentAssetRef['slot'] });

function evidenceState(rounds: Array<Record<number, number>>): GameState {
  const state = newRun('inferno-insights', fixed).state;
  const events: RunHistoryV2Event[] = [];
  let seq = 0;
  rounds.forEach((factors, index) => {
    const round = index + 1;
    const contributions = Object.entries(factors).filter(([, factor]) => factor > 1).map(([instanceId, factor]) => ({
      sourceId: Number(instanceId) === 1 ? 'momentum' as const : 'ultimate' as const,
      sourceInstanceId: Number(instanceId), origin: 'bonfire' as const, factor,
    }));
    const totalFactor = contributions.reduce((product, contribution) => product * contribution.factor, 1);
    events.push({ kind: 'hand_scored', seq: seq++, round, attempt: 1, actionId: round, timelineId: 0,
      scorePackageId: `p${round}`, rootPlayId: `root${round}`, parentPlayId: null,
      hand: 'ones', level: 1, playSource: 'manual', selectedDice: [0], scoringDice: [], scoreOccurrences: [], consumed: true,
      score: { infernoMultiplier: 1n, finalPips: 100, handMult: 1, finalMult: 1, finalXMult: totalFactor,
        bossFactor: 1, raw: String(100 * totalFactor), awarded: BigInt(Math.round(100 * totalFactor)),
        rounding: { mode: 'nearest_integer', delta: '0' } },
      roundScore: { before: 0n, afterAward: BigInt(Math.round(100 * totalFactor)), after: BigInt(Math.round(100 * totalFactor)) },
      pipsContributions: [], resolvedDicePips: [], multContributions: [], xMultContributions: contributions, sideEffects: [] });
    events.push({ kind: 'round_attempt_finished', seq: seq++, round, attempt: 1, actionId: round, timelineId: 0,
      outcome: 'cleared', score: BigInt(Math.round(100 * totalFactor)), target: 1n, boss: null,
      livesBefore: 3, livesAfter: 3 });
  });
  state.historyV2.splice(0, state.historyV2.length, ...events);
  state.nextHistorySeq = seq;
  state.historyV2Coverage = { complete: true, firstRound: 1, firstActionId: 0, firstSeq: 0 };
  return state;
}

describe('factual Inferno evidence insights', () => {
  it('counts utilization in the latest six canonical clears', () => {
    const state = evidenceState([{ 1: 2 }, {}, { 1: 2 }, { 1: 2 }, {}, { 1: 2 }]);
    expect(infernoEvidenceInsights(state, [asset(1, 'momentum')]))
      .toContain('Momentum contributed in 4 of your last 6 clears.');
  });

  it('compares the previous six only for meaningful utilization changes', () => {
    const increased = evidenceState([
      { 1: 2 }, { 1: 2 }, {}, {}, {}, {},
      { 1: 2 }, { 1: 2 }, { 1: 2 }, { 1: 2 }, { 1: 2 }, {},
    ]);
    expect(infernoEvidenceInsights(increased, [asset(1, 'momentum')]).join(' ')).toContain('up from 2/6');

    const noise = evidenceState([
      { 1: 2 }, { 1: 2 }, { 1: 2 }, {}, {}, {},
      { 1: 2 }, { 1: 2 }, { 1: 2 }, { 1: 2 }, {}, {},
    ]);
    expect(infernoEvidenceInsights(noise, [asset(1, 'momentum')]).join(' ')).not.toMatch(/up from|down from/);
  });

  it('applies the centralized effective-power threshold', () => {
    const quiet = evidenceState([
      ...Array.from({ length: 6 }, () => ({ 1: 2 })),
      ...Array.from({ length: 6 }, () => ({ 1: 2.4 })),
    ]);
    expect(infernoEvidenceInsights(quiet, [asset(1, 'momentum')]).join(' ')).not.toContain('more effective power');

    const meaningful = evidenceState([
      ...Array.from({ length: 6 }, () => ({ 1: 2 })),
      ...Array.from({ length: 6 }, () => ({ 1: 3 })),
    ]);
    expect(infernoEvidenceInsights(meaningful, [asset(1, 'momentum')]).join(' ')).toContain('more effective power');
  });

  it('excludes rolled-back clears from the recent window', () => {
    const state = evidenceState(Array.from({ length: 6 }, () => ({})));
    const abandonedStart = state.nextHistorySeq;
    const extra = evidenceState([{ 1: 4 }]).historyV2.map((event, index) => ({ ...event,
      seq: abandonedStart + index, round: 7, actionId: 7, timelineId: 0 })) as RunHistoryV2Event[];
    state.historyV2.push(...extra, { kind: 'checkpoint_restored', seq: abandonedStart + extra.length,
      round: 6, attempt: 1, actionId: 8, timelineId: 1, reason: 'time_travel',
      fromTimelineId: 0, toTimelineId: 1, abandonedFromSeq: abandonedStart,
      abandonedThroughSeq: abandonedStart + extra.length - 1, canonicalRound: 6, canonicalAttempt: 1 });
    expect(infernoEvidenceInsights(state, [asset(1, 'momentum')]).join(' ')).toContain('no effective-power contribution');
  });

  it('falls back factually with insufficient history and is deterministic', () => {
    const state = evidenceState([]);
    const first = infernoEvidenceInsights(state, [asset(1, 'momentum')]);
    expect(first[0]).toContain('No canonical cleared-Round');
    expect(infernoEvidenceInsights(state, [asset(1, 'momentum')])).toEqual(first);
    expect(first.length).toBeLessThanOrEqual(3);
  });

  it('prioritizes only surviving Flames supplied after Engulfment', () => {
    const state = evidenceState(Array.from({ length: 6 }, () => ({ 1: 2, 2: 8 })));
    const insights = infernoEvidenceInsights(state, [asset(1, 'momentum')]);
    expect(insights.join(' ')).toContain('Momentum');
    expect(insights.join(' ')).not.toContain('Ultimate');
  });
});
