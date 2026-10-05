import { useEffect, useState } from 'react';
import { useReducedMotion } from '@mantine/hooks';
import { CONFIG } from '../game/config';
import type { Action, Resolution } from '../game/types';
import type { PlaybackSpeed } from '../useGame';
import { acknowledgeBeat, dispatchTutorial, newTutorialSession } from './scenario';
import { clearTutorialSession, loadTutorialSession, saveTutorialSession, type TutorialStorage } from './tutorialPersistence';
import type { TutorialSession } from './types';
import { isPlaybackBarrier, SCORE_SUMMARY_HOLD_MS, scoreSummaryJump, type ScoreSummaryJump } from '../game/playback';

const browserStorage = (): TutorialStorage | null => {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage; } catch { return null; }
};

export function useTutorialGame(speed: PlaybackSpeed, active = true) {
  const reducedMotion = useReducedMotion();
  const [storage] = useState(browserStorage);
  const [initial] = useState(() => {
    const saved = loadTutorialSession(storage);
    const fresh = newTutorialSession();
    return saved
      ? { session: saved, resolution: { state: saved.game, events: [] } as Resolution, restored: true }
      : { session: fresh.session, resolution: fresh.resolution, restored: false };
  });
  const [session, setSession] = useState<TutorialSession>(initial.session);
  const [result, setResult] = useState<Resolution>(initial.resolution);
  const [hasStoredRun, setHasStoredRun] = useState(initial.restored);
  const [index, setIndex] = useState(0);
  const [summaryJump, setSummaryJump] = useState<ScoreSummaryJump | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = index < result.events.length;

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
    if (speed === 'instant' && currentEvent?.type === 'CHAPTER_STARTED') { setIndex(current => current + 1); return; }
    if (isPlaybackBarrier(currentEvent)) return;
    if (speed === 'instant') {
      const jump = scoreSummaryJump(result.events, index);
      if (jump) { setSummaryJump(jump); setIndex(jump.summaryIndex); }
      else {
        const nextBarrier = result.events.findIndex((candidate, candidateIndex) => candidateIndex > index && isPlaybackBarrier(candidate));
        setIndex(nextBarrier === -1 ? result.events.length : nextBarrier);
      }
      return;
    }
    const delay = !reducedMotion && currentEvent?.type === 'ROUND_BUST' ? Math.max(CONFIG.tickMs[speed], 1200) : CONFIG.tickMs[speed];
    const timeout = window.setTimeout(() => setIndex(current => current + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [active, busy, index, reducedMotion, result, speed, summaryJump]);

  function load(nextSession: TutorialSession, nextResult: Resolution) {
    saveTutorialSession(storage, nextSession);
    setHasStoredRun(true);
    setSession(nextSession);
    setResult(nextResult);
    setIndex(0);
    setSummaryJump(null);
    setError(null);
  }

  function acknowledge(beatId: string) {
    const next = acknowledgeBeat(session, beatId);
    saveTutorialSession(storage, next);
    setSession(next);
  }

  return {
    session,
    state: session.game,
    board: busy ? result.events[index].board : session.game,
    event: busy ? result.events[index] : null,
    busy,
    error,
    hasStoredRun,
    progress: { current: Math.min(index + 1, result.events.length), total: result.events.length },
    submit: (action: Action) => {
      if (busy) return false;
      const next = dispatchTutorial(session, action);
      if (next.error) { setError(next.error); return false; }
      load(next.session, next.resolution);
      return true;
    },
    restart: () => {
      const fresh = newTutorialSession();
      load(fresh.session, fresh.resolution);
    },
    clearStored: () => { clearTutorialSession(storage); setHasStoredRun(false); },
    acknowledge,
    completeBeat: acknowledge,
    skip: () => {
      const jump = scoreSummaryJump(result.events, index);
      if (jump) { setSummaryJump(jump); setIndex(jump.summaryIndex); }
      else setIndex(result.events.length);
    },
    continuePlayback: () => setIndex(current => Math.min(current + 1, result.events.length)),
    clearError: () => setError(null),
  };
}
