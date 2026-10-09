export const DEBUG_TRACE_MAX_RECORDS = 256;
export const DEBUG_TRACE_MAX_BYTES = 64 * 1024;
export const DEBUG_TRACE_SCHEMA_VERSION = 1 as const;

export type DebugTraceMode = 'bounded' | 'full';

interface DebugTraceEnvelope {
  seq: number;
  round: number;
  attempt: number;
  actionId: number;
}

export type DebugTraceRecord = DebugTraceEnvelope & (
  | { kind: 'resolution'; rngBefore: number; rngAfter: number; playbackEvents: number }
  | { kind: 'probability_check'; source: string; chance: number; stacks: number; succeeded: boolean; dieIds: number[] }
  | { kind: 'roll_batch'; reason: string; dieIds: number[]; results: { dieId: number; before: number; after: number }[] }
  | { kind: 'scoring_step'; hand: string; stage: 'pips' | 'mult' | 'xmult' | 'final'; before: number; after: number; source: string }
);

export type CriticalDiagnostic = DebugTraceEnvelope & (
  | { kind: 'error'; detail: string }
  | { kind: 'invariant_failure'; detail: string }
  | { kind: 'checkpoint_restore'; reason: 'bust' | 'bad_dream' | 'time_travel'; fromTimelineId: number; toTimelineId: number }
  | { kind: 'persistence_failure'; detail: string; occurrences: number }
  | { kind: 'trace_truncated'; droppedRecords: number; firstAvailableSeq: number }
);

export interface DebugTraceState {
  schemaVersion: typeof DEBUG_TRACE_SCHEMA_VERSION;
  mode: DebugTraceMode;
  nextSeq: number;
  firstAvailableSeq: number;
  droppedRecords: number;
  bufferBytes: number;
  records: DebugTraceRecord[];
  critical: CriticalDiagnostic[];
}

type TraceContext = Pick<DebugTraceEnvelope, 'round' | 'attempt' | 'actionId'>;
type DebugInput = DebugTraceRecord extends infer Record
  ? Record extends DebugTraceRecord ? Omit<Record, keyof DebugTraceEnvelope> : never : never;
type CriticalInput = CriticalDiagnostic extends infer Record
  ? Record extends CriticalDiagnostic ? Omit<Record, keyof DebugTraceEnvelope> : never : never;

const serializedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function createDebugTrace(mode: DebugTraceMode = 'bounded'): DebugTraceState {
  return { schemaVersion: DEBUG_TRACE_SCHEMA_VERSION, mode, nextSeq: 0, firstAvailableSeq: 0,
    droppedRecords: 0, bufferBytes: 0, records: [], critical: [] };
}

function envelope(trace: DebugTraceState, context: TraceContext): DebugTraceEnvelope {
  return { seq: trace.nextSeq++, ...context };
}

function updateTruncationDiagnostic(trace: DebugTraceState, context: TraceContext): void {
  const existing = trace.critical.find(record => record.kind === 'trace_truncated');
  if (existing?.kind === 'trace_truncated') {
    existing.droppedRecords = trace.droppedRecords;
    existing.firstAvailableSeq = trace.firstAvailableSeq;
    return;
  }
  trace.critical.push({ ...envelope(trace, context), kind: 'trace_truncated',
    droppedRecords: trace.droppedRecords, firstAvailableSeq: trace.firstAvailableSeq });
}

export function appendDebugTrace(trace: DebugTraceState, context: TraceContext, input: DebugInput): DebugTraceRecord {
  const record = { ...envelope(trace, context), ...input } as DebugTraceRecord;
  trace.records.push(record);
  trace.bufferBytes += serializedBytes(record);
  if (trace.mode === 'bounded') {
    while (trace.records.length > DEBUG_TRACE_MAX_RECORDS || trace.bufferBytes > DEBUG_TRACE_MAX_BYTES) {
      const dropped = trace.records.shift();
      if (!dropped) break;
      trace.bufferBytes -= serializedBytes(dropped);
      trace.droppedRecords++;
    }
    trace.firstAvailableSeq = trace.records[0]?.seq ?? trace.nextSeq;
    if (trace.droppedRecords) updateTruncationDiagnostic(trace, context);
  }
  return record;
}

export function appendCriticalDiagnostic(trace: DebugTraceState, context: TraceContext, input: CriticalInput): CriticalDiagnostic {
  if (input.kind === 'persistence_failure') {
    const existing = trace.critical.find(record => record.kind === 'persistence_failure');
    if (existing?.kind === 'persistence_failure') {
      existing.occurrences += input.occurrences;
      return existing;
    }
  }
  const record = { ...envelope(trace, context), ...input } as CriticalDiagnostic;
  trace.critical.push(record);
  return record;
}

export function normalizeDebugTrace(value: DebugTraceState | undefined): DebugTraceState {
  if (!value) return createDebugTrace();
  return {
    schemaVersion: DEBUG_TRACE_SCHEMA_VERSION,
    mode: value.mode === 'full' ? 'full' : 'bounded',
    nextSeq: Math.max(0, value.nextSeq ?? 0),
    firstAvailableSeq: Math.max(0, value.firstAvailableSeq ?? 0),
    droppedRecords: Math.max(0, value.droppedRecords ?? 0),
    bufferBytes: Math.max(0, value.bufferBytes ?? 0),
    records: Array.isArray(value.records) ? value.records : [],
    critical: Array.isArray(value.critical) ? value.critical : [],
  };
}
