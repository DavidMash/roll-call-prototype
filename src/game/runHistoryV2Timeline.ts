import type { CheckpointRestoredEvent, RunHistoryV2Coverage, RunHistoryV2Event } from './runHistoryV2';

export type TimelineEventStatus = 'canonical' | 'abandoned' | 'unknown';

export interface AbandonedTimelineRange {
  reason: CheckpointRestoredEvent['reason'];
  fromTimelineId: number;
  toTimelineId: number;
  fromSeq: number;
  throughSeq: number;
  canonicalRound: number;
  canonicalAttempt: number;
}

export interface RunHistoryV2TimelineClassification {
  ranges: AbandonedTimelineRange[];
  abandonedSeqs: { has(seq: number): boolean };
  timelineIds: number[];
  status(event: RunHistoryV2Event): TimelineEventStatus;
  isCanonical(event: RunHistoryV2Event): boolean;
  canonicalEvents(): RunHistoryV2Event[];
  experiencedEvents(): RunHistoryV2Event[];
  unknownEvents(): RunHistoryV2Event[];
}

/**
 * Reconstructs ownership exclusively from structured restore events. Ranges are
 * sequence based so repeated or nested rollbacks cannot accidentally abandon a
 * later event merely because a timeline id was reused by migrated data.
 */
export function classifyRunHistoryV2Timelines(events: readonly RunHistoryV2Event[],
  coverage: RunHistoryV2Coverage = { complete: true, firstRound: 1, firstActionId: 0, firstSeq: 0 }): RunHistoryV2TimelineClassification {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const ranges = ordered.filter((event): event is CheckpointRestoredEvent => event.kind === 'checkpoint_restored')
    .map(event => ({ reason: event.reason, fromTimelineId: event.fromTimelineId, toTimelineId: event.toTimelineId,
      fromSeq: event.abandonedFromSeq, throughSeq: event.abandonedThroughSeq,
      canonicalRound: event.canonicalRound, canonicalAttempt: event.canonicalAttempt }));
  const intervals = ranges.map(range => [range.fromSeq, range.throughSeq] as [number, number])
    .filter(([from, through]) => from <= through).sort((a, b) => a[0] - b[0])
    .reduce<[number, number][]>((merged, current) => {
      const prior = merged.at(-1);
      if (prior && current[0] <= prior[1] + 1) prior[1] = Math.max(prior[1], current[1]);
      else merged.push([...current]);
      return merged;
    }, []);
  const retainedSeqs = new Set<number>();
  for (const restore of ordered.filter((event): event is CheckpointRestoredEvent => event.kind === 'checkpoint_restored'))
    for (const seq of restore.retainedSeqs ?? []) retainedSeqs.add(seq);
  const abandonedSeqs = { has(seq: number) {
    if (retainedSeqs.has(seq)) return false;
    let low = 0; let high = intervals.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const [from, through] = intervals[middle];
      if (seq < from) high = middle - 1;
      else if (seq > through) low = middle + 1;
      else return true;
    }
    return false;
  } };
  const timelineIds = [...new Set(ordered.map(event => event.timelineId))].sort((a, b) => a - b);
  const firstKnownCanonicalSeq = coverage.complete ? Number.NEGATIVE_INFINITY
    : ordered.find(event => event.kind === 'checkpoint_restored')?.seq ?? Number.POSITIVE_INFINITY;
  const status = (event: RunHistoryV2Event): TimelineEventStatus => {
    if (abandonedSeqs.has(event.seq)) return 'abandoned';
    if (!coverage.complete && event.seq < firstKnownCanonicalSeq) return 'unknown';
    return 'canonical';
  };
  return {
    ranges, abandonedSeqs, timelineIds, status,
    isCanonical: event => status(event) === 'canonical',
    canonicalEvents: () => ordered.filter(event => status(event) === 'canonical'),
    experiencedEvents: () => ordered,
    unknownEvents: () => ordered.filter(event => status(event) === 'unknown'),
  };
}

export const canonicalRunHistoryV2Events = (events: readonly RunHistoryV2Event[], coverage?: RunHistoryV2Coverage) =>
  classifyRunHistoryV2Timelines(events, coverage).canonicalEvents();

export const experiencedRunHistoryV2Events = (events: readonly RunHistoryV2Event[]) => [...events].sort((a, b) => a.seq - b.seq);

export const abandonedRunHistoryV2Ranges = (events: readonly RunHistoryV2Event[]) => classifyRunHistoryV2Timelines(events).ranges;
