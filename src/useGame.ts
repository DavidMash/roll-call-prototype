import { useEffect, useState } from 'react';
import { useReducedMotion } from '@mantine/hooks';
import { CONFIG } from './game/config';
import { dispatch, newRun } from './game/engine';
import type { Action, Resolution } from './game/types';

export type PlaybackSpeed = keyof typeof CONFIG.tickMs;
export function useGame(seed: string, speed: PlaybackSpeed) {
  const reducedMotion = useReducedMotion();
  const [result, setResult] = useState<Resolution>(() => newRun(seed));
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const busy = index < result.events.length;
  useEffect(() => {
    if (!busy) return;
    if (speed === 'instant') { setIndex(result.events.length); return; }
    const currentEvent = result.events[index];
    const delay = currentEvent?.type === 'MAP_TRANSITION'
      ? reducedMotion ? 80 : currentEvent.boss ? 3000 : 1800
      : !reducedMotion && currentEvent?.type === 'ROUND_BUST'
        ? Math.max(CONFIG.tickMs[speed], 1200) : CONFIG.tickMs[speed];
    const timeout = window.setTimeout(() => setIndex(current => current + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [result, index, speed, busy, reducedMotion]);
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
    skipTransition: () => setIndex(current => Math.min(current + 1, result.events.length)),
    clearError: () => setError(null),
  };
}
