import { useEffect, useState } from 'react';
import { useReducedMotion } from '@mantine/hooks';
import { CONFIG } from './game/config';
import { dispatch, newRun } from './game/engine';
import { browserRunStorage, loadPersistedRun, savePersistedRun } from './game/persistence';
import type { Action, Resolution } from './game/types';

export type PlaybackSpeed = keyof typeof CONFIG.tickMs;

const isPlaybackBarrier = (event: Resolution['events'][number] | undefined) => event?.type === 'CHAPTER_STARTED'
  || event?.type === 'MAP_TRANSITION'
  || (event?.type === 'ROUND_BUST' && (event.board.bust?.livesAfter ?? 0) > 0);

export function useGame(requestedSeed: string | null, fallbackSeed: string, speed: PlaybackSpeed, active = true) {
  const reducedMotion = useReducedMotion();
  const [storage] = useState(browserRunStorage);
  const [initial] = useState(() => {
    const saved = loadPersistedRun(storage, requestedSeed);
    return { result: saved ? { state: saved, events: [] } : newRun(requestedSeed ?? fallbackSeed), restored: saved !== null };
  });
  const [result, setResult] = useState<Resolution>(initial.result);
  const [hasStoredRun, setHasStoredRun] = useState(initial.restored);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const busy = index < result.events.length;
  useEffect(() => {
    if (!active || !busy) return;
    const currentEvent = result.events[index];
    if (speed === 'instant' && currentEvent?.type === 'CHAPTER_STARTED') {
      setIndex(current => current + 1);
      return;
    }
    if (isPlaybackBarrier(currentEvent)) return;
    if (speed === 'instant') {
      const nextBarrier = result.events.findIndex((candidate, candidateIndex) => candidateIndex > index && isPlaybackBarrier(candidate));
      setIndex(nextBarrier === -1 ? result.events.length : nextBarrier);
      return;
    }
    const delay = !reducedMotion && currentEvent?.type === 'ROUND_BUST'
      ? Math.max(CONFIG.tickMs[speed], 1200) : CONFIG.tickMs[speed];
    const timeout = window.setTimeout(() => setIndex(current => current + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [result, index, speed, busy, reducedMotion, active]);
  function load(next: Resolution) {
    if (next.error) { setError(next.error); return; }
    savePersistedRun(storage, next.state);
    setHasStoredRun(true);
    setError(null);
    setResult(next);
    setIndex(0);
  }
  return {
    state: result.state,
    board: busy ? result.events[index].board : result.state,
    event: busy ? result.events[index] : null,
    busy, error,
    hasStoredRun,
    progress: { current: Math.min(index + 1, result.events.length), total: result.events.length },
    submit: (action: Action) => {
      if (busy) return false;
      const next = dispatch(result.state, action);
      if (next.error) {
        setError(next.error);
        return false;
      }
      load(next);
      return true;
    },
    restart: (nextSeed: string) => load(newRun(nextSeed)),
    skip: () => setIndex(result.events.length),
    continuePlayback: () => setIndex(current => Math.min(current + 1, result.events.length)),
    clearError: () => setError(null),
  };
}
