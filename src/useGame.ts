import { useEffect, useState } from 'react';
import { CONFIG } from './game/config';
import { dispatch, newRun } from './game/engine';
import type { Action, Resolution } from './game/types';

export type PlaybackSpeed = keyof typeof CONFIG.tickMs;
export function useGame(seed: string, speed: PlaybackSpeed) {
  const [result, setResult] = useState<Resolution>(() => newRun(seed));
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const busy = index < result.events.length;
  useEffect(() => {
    if (!busy) return;
    if (speed === 'instant') { setIndex(result.events.length); return; }
    const timeout = window.setTimeout(() => setIndex(current => current + 1), CONFIG.tickMs[speed]);
    return () => window.clearTimeout(timeout);
  }, [result, index, speed, busy]);
  function load(next: Resolution) {
    if (next.error) { setError(next.error); return; }
    setError(null);
    setResult(next);
    setIndex(0);
  }
  return {
    state: result.state,
    board: busy ? result.events[index].board : result.state,
    event: busy ? result.events[index] : null,
    busy, error,
    progress: { current: Math.min(index + 1, result.events.length), total: result.events.length },
    submit: (action: Action) => { if (!busy) load(dispatch(result.state, action)); },
    restart: (nextSeed: string) => load(newRun(nextSeed)),
    skip: () => setIndex(result.events.length),
    clearError: () => setError(null),
  };
}
