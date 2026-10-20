import { Paper, Text, Title } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { useEffect, useRef } from 'react';
import { SCREEN_THEMES } from '../game/screenThemes';
import type { GameEvent } from '../game/types';

export const CHAPTER_SPLASH_DURATION_MS = 1800;
const REDUCED_MOTION_SPLASH_DURATION_MS = 700;

export function ChapterSplash({ event, onComplete }: { event: GameEvent; onComplete: () => void }) {
  const reducedMotion = useReducedMotion();
  const completed = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const chapterNumber = event.chapterNumber ?? 1;
  const miniBoss = event.chapterMiniBoss;
  const boss = event.chapterBoss;
  const startColor = miniBoss ? SCREEN_THEMES[miniBoss].accent : SCREEN_THEMES.round.accent;
  const endColor = boss ? SCREEN_THEMES[boss].accent : SCREEN_THEMES.round.accentStrong;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (completed.current) return;
      completed.current = true;
      onCompleteRef.current();
    }, reducedMotion ? REDUCED_MOTION_SPLASH_DURATION_MS : CHAPTER_SPLASH_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [event.id, reducedMotion]);

  return <Paper className="chapter-splash" data-testid="chapter-splash" role="status" aria-live="polite"
    data-chapter={chapterNumber} data-start-color={startColor} data-end-color={endColor}
    style={{ '--chapter-start': startColor, '--chapter-end': endColor,
      '--chapter-splash-duration': `${CHAPTER_SPLASH_DURATION_MS}ms` } as React.CSSProperties}>
    <div className="chapter-splash-light" aria-hidden="true" />
    <div className="chapter-splash-title">
      <Text className="chapter-splash-kicker">ROLL CALL</Text>
      <Title order={1}>CHAPTER {chapterNumber}</Title>
    </div>
  </Paper>;
}
