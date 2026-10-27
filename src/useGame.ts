import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@mantine/hooks';
import { CONFIG } from './game/config';
import { dispatch, newRun } from './game/engine';
import { savePersistedRun } from './game/persistence';
import type { Action, Resolution, RunLedgerChunk } from './game/types';
import { appendCriticalDiagnostic, type DebugTraceMode } from './game/debugTrace';
import { browserRunRepository, type PersistenceStatus, type RunRepository } from './game/runRepository';
import { chunkForResolution, compactRuntimeLedger } from './game/ledger';
import { stringifyExactJson } from './game/scoreMath';
import { firstPresentedEventIndex, isChapterMapTransition, isPlaybackBarrier, isPlaybackCheckpoint,
  nextPresentedEventIndex, nextScorecardRefreshIndex, playbackBoard, playbackTickMs,
  SCORECARD_REFRESH_HOLD_MS, SCORE_SUMMARY_HOLD_MS, scoreSummaryJump,
  type ScoreSummaryJump } from './game/playback';

export type PlaybackSpeed = keyof typeof CONFIG.tickMs;

export function persistResolvedRun(storage: Parameters<typeof savePersistedRun>[0], state: Resolution['state']): boolean {
  const saved = savePersistedRun(storage, state);
  if (!saved) appendCriticalDiagnostic(state.debugTrace, { round: state.round,
    attempt: state.roundAttemptNumber, actionId: state.nextActionId },
  { kind: 'persistence_failure', detail: 'Browser storage write failed; this run is not safely resumable.', occurrences: 1 });
  return saved;
}

export function useGame(requestedSeed: string | null, fallbackSeed: string, speed: PlaybackSpeed, active = true,
  debugTraceMode: DebugTraceMode = 'bounded', suppliedRepository?: RunRepository) {
  const reducedMotion = useReducedMotion();
  const [repository] = useState(() => suppliedRepository ?? browserRunRepository());
  const [initial] = useState(() => newRun(requestedSeed ?? fallbackSeed, undefined, { debugTraceMode }));
  const [result, setResult] = useState<Resolution>(initial);
  const [hasStoredRun, setHasStoredRun] = useState(false);
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const [index, setIndex] = useState(() => firstPresentedEventIndex(initial.events));
  const [summaryJump, setSummaryJump] = useState<ScoreSummaryJump | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const pendingChunks = useRef<RunLedgerChunk[]>([]);
  const retryAttempt = useRef(0);
  const initialSaveStarted = useRef(false);
  const playbackBusy = index < result.events.length;
  const busy = persistenceStatus.kind === 'loading' || saving || playbackBusy;

  useEffect(() => {
    let cancelled = false;
    void repository.load('normal').then(stored => {
      if (cancelled) return;
      if (stored && (!requestedSeed || stored.session.state.seed === requestedSeed)) {
        const state = stored.session.state;
        setResult({ state, session: stored.session, events: [],
          ledgerChunk: chunkForResolution(state, null, null, state.nextHistorySeq) });
        setHasStoredRun(true);
      }
      setPersistenceStatus({ kind: 'saved' });
    }).catch(cause => {
      if (!cancelled) setPersistenceStatus({ kind: 'unsaved', partialHistory: false,
        message: cause instanceof Error ? cause.message : 'Run storage is unavailable.' });
    });
    return () => { cancelled = true; };
  }, [initial, repository, requestedSeed]);
  useEffect(() => {
    if (!active || hasStoredRun || persistenceStatus.kind !== 'saved' || initialSaveStarted.current) return;
    initialSaveStarted.current = true;
    pendingChunks.current = [result.ledgerChunk];
    setSaving(true);
    void repository.commit('normal', result.session, pendingChunks.current).then(() => {
      pendingChunks.current = [];
      setHasStoredRun(true);
    }).catch(cause => setPersistenceStatus({ kind: 'unsaved', partialHistory: false,
      message: cause instanceof Error ? cause.message : 'Run storage is unavailable.' }))
      .finally(() => setSaving(false));
  }, [active, hasStoredRun, persistenceStatus.kind, repository, result]);

  useEffect(() => {
    if (result.events.length === 0 || playbackBusy) return;
    setResult(current => current.events.length ? { ...current, events: [] } : current);
    setIndex(0);
  }, [playbackBusy, result.events.length]);
  useEffect(() => {
    if (persistenceStatus.kind !== 'unsaved' || saving) return;
    const delay = Math.min(30_000, 1_000 * (2 ** retryAttempt.current));
    const timeout = window.setTimeout(retryPersistence, delay);
    return () => window.clearTimeout(timeout);
  }, [persistenceStatus, saving]);
  useEffect(() => {
    if (!active || !playbackBusy) return;
    const currentEvent = result.events[index];
    if (summaryJump && index === summaryJump.summaryIndex) {
      const timeout = window.setTimeout(() => {
        setIndex(summaryJump.boundaryIndex);
        setSummaryJump(null);
      }, SCORE_SUMMARY_HOLD_MS);
      return () => window.clearTimeout(timeout);
    }
    if (speed === 'instant' && currentEvent?.type === 'CHAPTER_STARTED') {
      setIndex(current => nextPresentedEventIndex(result.events, current));
      return;
    }
    if (currentEvent?.type === 'MAP_TRANSITION' && !isChapterMapTransition(currentEvent)) {
      setIndex(current => nextPresentedEventIndex(result.events, current));
      return;
    }
    if (currentEvent?.type === 'SCORECARD_REFRESHED') {
      const timeout = window.setTimeout(() => setIndex(current => nextPresentedEventIndex(result.events, current)), SCORECARD_REFRESH_HOLD_MS[speed]);
      return () => window.clearTimeout(timeout);
    }
    if (isPlaybackBarrier(currentEvent)) return;
    if (speed === 'instant') {
      const jump = scoreSummaryJump(result.events, index);
      if (jump && jump.summaryIndex >= index) {
        setSummaryJump(jump);
        setIndex(jump.summaryIndex);
      } else {
        const nextBarrier = result.events.findIndex((candidate, candidateIndex) => candidateIndex > index && isPlaybackCheckpoint(candidate));
        setIndex(nextBarrier === -1 ? result.events.length : nextBarrier);
      }
      return;
    }
    const baseDelay = playbackTickMs(currentEvent, speed);
    const delay = !reducedMotion && currentEvent?.type === 'ROUND_BUST'
      ? Math.max(baseDelay, 1200) : baseDelay;
    const timeout = window.setTimeout(() => setIndex(current => nextPresentedEventIndex(result.events, current)), delay);
    return () => window.clearTimeout(timeout);
  }, [result, index, speed, playbackBusy, reducedMotion, active, summaryJump]);

  function publish(next: Resolution) {
    setError(null);
    setResult(next);
    setIndex(firstPresentedEventIndex(next.events));
    setSummaryJump(null);
  }

  function enforcePendingLimit(next: Resolution): boolean {
    const limit = 16 * 1024 * 1024;
    const bytes = (chunk: RunLedgerChunk) => new TextEncoder().encode(stringifyExactJson(chunk)).byteLength;
    let total = pendingChunks.current.reduce((sum, chunk) => sum + bytes(chunk), 0);
    let partial = false;
    while (pendingChunks.current.length > 0 && total > limit) {
      const dropped = pendingChunks.current.shift()!;
      total -= bytes(dropped);
      partial = true;
    }
    if (partial) {
      const first = pendingChunks.current[0]?.events[0];
      next.session.ledger.coverage = { complete: false, firstRound: first?.round ?? next.state.round,
        firstActionId: first?.actionId ?? next.state.nextActionId, firstSeq: first?.seq ?? next.state.nextHistorySeq };
      next.state.historyV2Coverage = next.session.ledger.coverage;
    }
    return partial;
  }

  function commit(next: Resolution) {
    if (next.error) { setError(next.error); submitting.current = false; return; }
    pendingChunks.current.push(next.ledgerChunk);
    const partial = enforcePendingLimit(next);
    setSaving(true);
    void repository.commit('normal', next.session, pendingChunks.current).then(() => {
      pendingChunks.current = [];
      retryAttempt.current = 0;
      compactRuntimeLedger(next.state);
      setHasStoredRun(true);
      setPersistenceStatus({ kind: 'saved' });
    }).catch(cause => {
      retryAttempt.current++;
      setHasStoredRun(false);
      appendCriticalDiagnostic(next.state.debugTrace, { round: next.state.round,
        attempt: next.state.roundAttemptNumber, actionId: next.state.nextActionId },
      { kind: 'persistence_failure', detail: 'Browser storage write failed; this run is not safely resumable.', occurrences: 1 });
      setPersistenceStatus({ kind: 'unsaved', partialHistory: partial || !next.session.ledger.coverage.complete,
        message: cause instanceof Error ? cause.message : 'Run storage is unavailable.' });
    }).finally(() => {
      setSaving(false);
      submitting.current = false;
      publish(next);
    });
  }

  function retryPersistence() {
    if (saving) return;
    submitting.current = true;
    setSaving(true);
    void repository.commit('normal', result.session, pendingChunks.current).then(() => {
      pendingChunks.current = [];
      retryAttempt.current = 0;
      compactRuntimeLedger(result.state);
      setHasStoredRun(true);
      setPersistenceStatus({ kind: 'saved' });
    }).catch(cause => { retryAttempt.current++; setPersistenceStatus({ kind: 'unsaved', partialHistory: !result.session.ledger.coverage.complete,
      message: cause instanceof Error ? cause.message : 'Run storage is unavailable.' }); })
      .finally(() => { submitting.current = false; setSaving(false); });
  }
  return {
    state: result.state,
    board: playbackBusy ? playbackBoard(result.events, index, result.state) : result.state,
    event: playbackBusy ? result.events[index] : null,
    busy, error,
    hasStoredRun, persistenceStatus, retryPersistence, repository, session: result.session, runSession: result.session,
    progress: { current: Math.min(index + 1, result.events.length), total: result.events.length },
    submit: (action: Action) => {
      if (busy || submitting.current) return false;
      submitting.current = true;
      const next = dispatch(result.state, action);
      if (next.error) {
        submitting.current = false;
        setError(next.error);
        return false;
      }
      commit(next);
      return true;
    },
    restart: (nextSeed: string) => {
      if (busy || submitting.current) return false;
      submitting.current = true;
      pendingChunks.current = [];
      commit(newRun(nextSeed, undefined, { debugTraceMode }));
      return true;
    },
    skip: () => {
      const jump = scoreSummaryJump(result.events, index);
      if (jump) { setSummaryJump(jump); setIndex(jump.summaryIndex); }
      else {
        const refreshIndex = nextScorecardRefreshIndex(result.events, index);
        setIndex(refreshIndex === -1 ? result.events.length : refreshIndex);
      }
    },
    continuePlayback: () => setIndex(current => nextPresentedEventIndex(result.events, current)),
    clearError: () => setError(null),
  };
}
