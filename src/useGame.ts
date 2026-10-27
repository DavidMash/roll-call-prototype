import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@mantine/hooks';
import { CONFIG } from './game/config';
import { dispatch, newRun } from './game/engine';
import { browserRunStorage, loadPersistedRun, savePersistedRun } from './game/persistence';
import type { Action, Resolution } from './game/types';
import { appendCriticalDiagnostic, type DebugTraceMode } from './game/debugTrace';
import { firstPresentedEventIndex, isChapterMapTransition, isPlaybackBarrier, isPlaybackCheckpoint,
  nextPresentedEventIndex, nextScorecardRefreshIndex, playbackBoard, playbackTickMs,
  SCORECARD_REFRESH_HOLD_MS, SCORE_SUMMARY_HOLD_MS, scoreSummaryJump,
  type ScoreSummaryJump } from './game/playback';

export type PlaybackSpeed = keyof typeof CONFIG.tickMs;

export function persistResolvedRun(storage: Parameters<typeof savePersistedRun>[0], state: Resolution['state']): boolean {
  const saved = savePersistedRun(storage, state);
  if (!saved) appendCriticalDiagnostic(state.debugTrace, { round: state.round,
    attempt: state.roundAttemptNumber, actionId: state.actionJournal.length },
  { kind: 'persistence_failure', detail: 'Browser storage write failed; this run is not safely resumable.', occurrences: 1 });
  return saved;
}

export function useGame(requestedSeed: string | null, fallbackSeed: string, speed: PlaybackSpeed, active = true,
  debugTraceMode: DebugTraceMode = 'bounded') {
  const reducedMotion = useReducedMotion();
  const [storage] = useState(browserRunStorage);
  const [initial] = useState(() => {
    const saved = loadPersistedRun(storage, requestedSeed);
    return { result: saved ? { state: saved, events: [] } : newRun(requestedSeed ?? fallbackSeed, undefined, { debugTraceMode }), restored: saved !== null };
  });
  const [result, setResult] = useState<Resolution>(initial.result);
  const [hasStoredRun, setHasStoredRun] = useState(initial.restored);
  const [index, setIndex] = useState(() => firstPresentedEventIndex(initial.result.events));
  const [summaryJump, setSummaryJump] = useState<ScoreSummaryJump | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const busy = index < result.events.length;
  useEffect(() => { submitting.current = false; }, [result]);
  useEffect(() => {
    if (!active || !busy) return;
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
  }, [result, index, speed, busy, reducedMotion, active, summaryJump]);
  function load(next: Resolution) {
    if (next.error) { setError(next.error); return; }
    const saved = persistResolvedRun(storage, next.state);
    setHasStoredRun(saved);
    setError(null);
    setResult(next);
    setIndex(firstPresentedEventIndex(next.events));
    setSummaryJump(null);
  }
  return {
    state: result.state,
    board: busy ? playbackBoard(result.events, index, result.state) : result.state,
    event: busy ? result.events[index] : null,
    busy, error,
    hasStoredRun,
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
      load(next);
      return true;
    },
    restart: (nextSeed: string) => load(newRun(nextSeed, undefined, { debugTraceMode })),
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
