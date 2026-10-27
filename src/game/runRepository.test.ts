import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { compactRuntimeLedger, ledgerForState } from './ledger';
import { MemoryRunRepository } from './runRepository';
import { appendDebugTrace, createDebugTrace, DEBUG_TRACE_FULL_MAX_BYTES } from './debugTrace';

describe('run ledger repository', () => {
  it('commits immutable ordered chunks separately from compact game state', async () => {
    const repository = new MemoryRunRepository();
    const initial = newRun('ledger-atomic', { next: () => 0 });
    await repository.commit('normal', initial.session, [initial.ledgerChunk]);
    const next = dispatch(initial.state, { type: 'MANUAL_REROLL', dieIds: [0] }, { next: () => .5 });
    await repository.commit('normal', next.session, [next.ledgerChunk]);

    expect(next.state.nextActionId).toBe(1);
    expect(next.state.nextHistorySeq).toBeGreaterThan(initial.state.nextHistorySeq);
    expect(Object.isFrozen(next.ledgerChunk)).toBe(true);
    expect(Object.isFrozen(next.ledgerChunk.events)).toBe(true);
    const archive = await repository.readLedger(next.session.ledger.runId);
    expect(archive.actions).toEqual([{ type: 'MANUAL_REROLL', dieIds: [0] }]);
    expect(archive.events.map(event => event.seq)).toEqual(
      [...archive.events.map(event => event.seq)].sort((a, b) => a - b));
  });

  it('keeps failed commits queued by leaving committed counters unchanged', async () => {
    const repository = new MemoryRunRepository();
    const initial = newRun('ledger-failure');
    repository.failCommits = true;
    await expect(repository.commit('normal', initial.session, [initial.ledgerChunk])).rejects.toThrow('Persistence failed');
    expect(initial.session.ledger.committedActionId).toBe(0);
    expect(initial.session.ledger.committedHistorySeq).toBe(0);
    expect(await repository.load('normal')).toBeNull();
  });

  it('bounds runtime actions without removing committed archive chunks', async () => {
    const initial = newRun('ledger-bounded');
    const ledger = ledgerForState(initial.state);
    const action = { type: 'TOGGLE_CHARGE' as const };
    ledger.actions = Array.from({ length: 500 }, () => action);
    compactRuntimeLedger(initial.state);
    expect(ledger.actions).toHaveLength(200);
  });

  it('caps explicit full debug traces at 16 MiB and retains the newest records', () => {
    const trace = createDebugTrace('full');
    for (let index = 0; index < 20; index++) appendDebugTrace(trace,
      { round: 1, attempt: 1, actionId: index },
      { kind: 'scoring_step', hand: 'ones', stage: 'pips', before: index, after: index + 1,
        source: `${index}:${'x'.repeat(1024 * 1024)}` });
    expect(trace.bufferBytes).toBeLessThanOrEqual(DEBUG_TRACE_FULL_MAX_BYTES);
    expect(trace.droppedRecords).toBeGreaterThan(0);
    expect(trace.records.at(-1)?.actionId).toBe(19);
  });
});
