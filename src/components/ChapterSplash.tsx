import { Paper, Text, Title } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { useEffect, useRef } from 'react';
import { SCREEN_THEMES } from '../game/screenThemes';
import { ENHANCEMENTS, enhancementsUnlockedInChapter, maxEnhancementTypesPerFace } from '../game/enhancements';
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
  const capacityBefore = event.enhancementCapacityBefore ?? maxEnhancementTypesPerFace(chapterNumber - 1);
  const capacityAfter = event.enhancementCapacityAfter ?? maxEnhancementTypesPerFace(chapterNumber);
  const newlyUnlocked = event.newlyUnlockedEnhancements ?? enhancementsUnlockedInChapter(chapterNumber);
  const showEnhancementUnlock = chapterNumber >= 2 && chapterNumber <= 6
    && capacityAfter > capacityBefore && newlyUnlocked.length > 0;

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
      {showEnhancementUnlock && <div className="chapter-enhancement-unlock" data-testid="chapter-enhancement-unlock">
        <Text className="chapter-unlock-label">ENHANCEMENT CAPACITY</Text>
        <Text className="chapter-unlock-capacity">{capacityBefore} → {capacityAfter}</Text>
        <Text className="chapter-unlock-label">NEW ENHANCEMENTS</Text>
        <Text className="chapter-unlock-names">{newlyUnlocked.map(id => ENHANCEMENTS[id].name).join(' · ')}</Text>
      </div>}
    </div>
  </Paper>;
}
