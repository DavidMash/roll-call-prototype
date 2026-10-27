import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@mantine/hooks';
import type { Action, Resolution, RunLedgerChunk } from '../game/types';
import type { PlaybackSpeed } from '../useGame';
import { acknowledgeBeat, dispatchTutorial, newTutorialSession } from './scenario';
import type { TutorialScenarioState, TutorialSession } from './types';
import { firstPresentedEventIndex, isChapterMapTransition, isPlaybackBarrier, isPlaybackCheckpoint,
  nextPresentedEventIndex, nextScorecardRefreshIndex, playbackBoard, playbackTickMs,
  SCORECARD_REFRESH_HOLD_MS, SCORE_SUMMARY_HOLD_MS, scoreSummaryJump, type ScoreSummaryJump } from '../game/playback';
import { browserRunRepository, type PersistenceStatus, type RunRepository } from '../game/runRepository';
import { chunkForResolution, compactRuntimeLedger } from '../game/ledger';
import { appendCriticalDiagnostic } from '../game/debugTrace';
import { stringifyExactJson } from '../game/scoreMath';

export function useTutorialGame(speed: PlaybackSpeed, active = true, suppliedRepository?: RunRepository) {
  const reducedMotion = useReducedMotion();
  const [repository] = useState(() => suppliedRepository ?? browserRunRepository());
  const [initial] = useState(newTutorialSession);
  const [session, setSession] = useState<TutorialSession>(initial.session);
  const [result, setResult] = useState<Resolution>(initial.resolution);
  const [hasStoredRun, setHasStoredRun] = useState(false);
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const [index, setIndex] = useState(() => firstPresentedEventIndex(initial.resolution.events));
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
    void repository.load('tutorial').then(stored => {
      if (cancelled) return;
      if (stored) {
        const scenario = { ...initial.session.scenario,
          ...(stored.scenario as Partial<TutorialScenarioState> | undefined) };
        const restored = { tutorialVersion: initial.session.tutorialVersion,
          game: stored.session.state, scenario } satisfies TutorialSession;
        setSession(restored);
        setResult({ state: restored.game, session: stored.session, events: [],
          ledgerChunk: chunkForResolution(restored.game, null, null, restored.game.nextHistorySeq) });
        setHasStoredRun(true);
      }
      setPersistenceStatus({ kind: 'saved' });
    }).catch(cause => {
      if (!cancelled) setPersistenceStatus({ kind: 'unsaved', partialHistory: false,
        message: cause instanceof Error ? cause.message : 'Tutorial storage is unavailable.' });
    });
    return () => { cancelled = true; };
  }, [initial.session.scenario, initial.session.tutorialVersion, repository]);
  useEffect(() => {
    if (!active || hasStoredRun || persistenceStatus.kind !== 'saved' || initialSaveStarted.current) return;
    initialSaveStarted.current = true;
    pendingChunks.current = [result.ledgerChunk];
    setSaving(true);
    void repository.commit('tutorial', result.session, pendingChunks.current, session.scenario).then(() => {
      pendingChunks.current = [];
      setHasStoredRun(true);
    }).catch(cause => setPersistenceStatus({ kind: 'unsaved', partialHistory: false,
      message: cause instanceof Error ? cause.message : 'Tutorial storage is unavailable.' }))
      .finally(() => setSaving(false));
  }, [active, hasStoredRun, persistenceStatus.kind, repository, result, session.scenario]);

  useEffect(() => {
    if (result.events.length === 0 || playbackBusy) return;
    setResult(current => current.events.length ? { ...current, events: [] } : current);
    setIndex(0);
  }, [playbackBusy, result.events.length]);
  useEffect(() => {
    if (persistenceStatus.kind !== 'unsaved' || saving) return;
    const timeout = window.setTimeout(retryPersistence,
      Math.min(30_000, 1_000 * (2 ** retryAttempt.current)));
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
      setIndex(current => nextPresentedEventIndex(result.events, current)); return;
    }
    if (currentEvent?.type === 'MAP_TRANSITION' && !isChapterMapTransition(currentEvent)) {
      setIndex(current => nextPresentedEventIndex(result.events, current)); return;
    }
    if (currentEvent?.type === 'SCORECARD_REFRESHED') {
      const timeout = window.setTimeout(() => setIndex(current => nextPresentedEventIndex(result.events, current)), SCORECARD_REFRESH_HOLD_MS[speed]);
      return () => window.clearTimeout(timeout);
    }
    if (isPlaybackBarrier(currentEvent)) return;
    if (speed === 'instant') {
      const jump = scoreSummaryJump(result.events, index);
      if (jump && jump.summaryIndex >= index) { setSummaryJump(jump); setIndex(jump.summaryIndex); }
      else {
        const nextBarrier = result.events.findIndex((candidate, candidateIndex) => candidateIndex > index && isPlaybackCheckpoint(candidate));
        setIndex(nextBarrier === -1 ? result.events.length : nextBarrier);
      }
      return;
    }
    const baseDelay = playbackTickMs(currentEvent, speed);
    const delay = !reducedMotion && currentEvent?.type === 'ROUND_BUST' ? Math.max(baseDelay, 1200) : baseDelay;
    const timeout = window.setTimeout(() => setIndex(current => nextPresentedEventIndex(result.events, current)), delay);
    return () => window.clearTimeout(timeout);
  }, [active, index, playbackBusy, reducedMotion, result, speed, summaryJump]);

  function publish(nextSession: TutorialSession, nextResult: Resolution) {
    setSession(nextSession);
    setResult(nextResult);
    setIndex(firstPresentedEventIndex(nextResult.events));
    setSummaryJump(null);
    setError(null);
  }

  function commit(nextSession: TutorialSession, nextResult: Resolution) {
    pendingChunks.current.push(nextResult.ledgerChunk);
    const chunkBytes = (chunk: RunLedgerChunk) => new TextEncoder().encode(stringifyExactJson(chunk)).byteLength;
    let bytes = pendingChunks.current.reduce((sum, chunk) => sum + chunkBytes(chunk), 0);
    let partial = false;
    while (pendingChunks.current.length > 0 && bytes > 16 * 1024 * 1024) {
      bytes -= chunkBytes(pendingChunks.current.shift()!);
      partial = true;
    }
    if (partial) {
      const first = pendingChunks.current[0]?.events[0];
      nextResult.session.ledger.coverage = { complete: false, firstRound: first?.round ?? nextSession.game.round,
        firstActionId: first?.actionId ?? nextSession.game.nextActionId,
        firstSeq: first?.seq ?? nextSession.game.nextHistorySeq };
      nextSession.game.historyV2Coverage = nextResult.session.ledger.coverage;
    }
    setSaving(true);
    void repository.commit('tutorial', nextResult.session, pendingChunks.current, nextSession.scenario).then(() => {
      pendingChunks.current = [];
      retryAttempt.current = 0;
      compactRuntimeLedger(nextSession.game);
      setHasStoredRun(true);
      setPersistenceStatus({ kind: 'saved' });
    }).catch(cause => {
      retryAttempt.current++;
      setHasStoredRun(false);
      appendCriticalDiagnostic(nextSession.game.debugTrace, { round: nextSession.game.round,
        attempt: nextSession.game.roundAttemptNumber, actionId: nextSession.game.nextActionId },
      { kind: 'persistence_failure', detail: 'Tutorial storage write failed.', occurrences: 1 });
      setPersistenceStatus({ kind: 'unsaved', partialHistory: partial || !nextResult.session.ledger.coverage.complete,
        message: cause instanceof Error ? cause.message : 'Tutorial storage is unavailable.' });
    }).finally(() => {
      submitting.current = false;
      setSaving(false);
      publish(nextSession, nextResult);
    });
  }

  function acknowledge(beatId: string) {
    if (saving) return;
    const next = acknowledgeBeat(session, beatId);
    setSaving(true);
    void repository.commit('tutorial', result.session, pendingChunks.current, next.scenario).then(() => {
      pendingChunks.current = [];
      retryAttempt.current = 0;
      setHasStoredRun(true);
      setPersistenceStatus({ kind: 'saved' });
      setSession(next);
    }).catch(cause => { retryAttempt.current++; setPersistenceStatus({ kind: 'unsaved', partialHistory: !result.session.ledger.coverage.complete,
      message: cause instanceof Error ? cause.message : 'Tutorial storage is unavailable.' }); })
      .finally(() => setSaving(false));
  }

  function retryPersistence() {
    if (saving) return;
    setSaving(true);
    void repository.commit('tutorial', result.session, pendingChunks.current, session.scenario).then(() => {
      pendingChunks.current = [];
      retryAttempt.current = 0;
      compactRuntimeLedger(result.state);
      setHasStoredRun(true);
      setPersistenceStatus({ kind: 'saved' });
    }).catch(cause => { retryAttempt.current++; setPersistenceStatus({ kind: 'unsaved', partialHistory: !result.session.ledger.coverage.complete,
      message: cause instanceof Error ? cause.message : 'Tutorial storage is unavailable.' }); })
      .finally(() => setSaving(false));
  }

  return {
    session,
    state: session.game,
    board: playbackBusy ? playbackBoard(result.events, index, session.game) : session.game,
    event: playbackBusy ? result.events[index] : null,
    busy, error, hasStoredRun, persistenceStatus, retryPersistence, repository, runSession: result.session,
    progress: { current: Math.min(index + 1, result.events.length), total: result.events.length },
    submit: (action: Action) => {
      if (busy || submitting.current) return false;
      submitting.current = true;
      const next = dispatchTutorial(session, action);
      if (next.error) { submitting.current = false; setError(next.error); return false; }
      commit(next.session, next.resolution);
      return true;
    },
    restart: () => {
      if (busy || submitting.current) return false;
      submitting.current = true;
      pendingChunks.current = [];
      const fresh = newTutorialSession();
      commit(fresh.session, fresh.resolution);
      return true;
    },
    clearStored: () => { void repository.remove('tutorial'); setHasStoredRun(false); },
    acknowledge,
    completeBeat: acknowledge,
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
