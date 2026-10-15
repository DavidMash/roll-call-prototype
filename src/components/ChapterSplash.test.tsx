import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Resolver } from '../game/effects';
import { newRun } from '../game/engine';
import { ENHANCEMENTS, enhancementsUnlockedInChapter } from '../game/enhancements';
import type { GameEvent, RandomSource } from '../game/types';
import { ChapterSplash } from './ChapterSplash';

const constant: RandomSource = { next: () => .2 };

function chapterEvent(chapter: number): GameEvent {
  const state = newRun(`chapter-unlock-${chapter}`, constant).state;
  state.round = (chapter - 1) * 6 + 1;
  state.presentedChapters = Array.from({ length: chapter - 1 }, (_, index) => index + 1);
  const resolver = new Resolver(state, constant);
  resolver.enterChapterIfNeeded(state.round);
  return resolver.events.find(event => event.type === 'CHAPTER_STARTED')!;
}

describe('Chapter Enhancement unlock presentation', () => {
  it.each([2, 3, 4, 5, 6])('shows the exact Chapter %i capacity increase and tier unlocks', chapter => {
    const event = chapterEvent(chapter);
    const html = renderToStaticMarkup(<MantineProvider><ChapterSplash event={event} onComplete={() => {}} /></MantineProvider>);
    expect(html).toContain(`CHAPTER ${chapter}`);
    expect(html).toContain(`${chapter - 1} → ${chapter}`);
    for (const id of enhancementsUnlockedInChapter(chapter)) expect(html).toContain(ENHANCEMENTS[id].name);
    expect(event).toMatchObject({ enhancementCapacityBefore: chapter - 1, enhancementCapacityAfter: chapter,
      newlyUnlockedEnhancements: enhancementsUnlockedInChapter(chapter) });
  });

  it('does not announce another capacity or tier unlock in Chapter 7', () => {
    const event = chapterEvent(7);
    const html = renderToStaticMarkup(<MantineProvider><ChapterSplash event={event} onComplete={() => {}} /></MantineProvider>);
    expect(html).toContain('CHAPTER 7');
    expect(html).not.toContain('ENHANCEMENT CAPACITY');
    expect(html).not.toContain('NEW ENHANCEMENTS');
    expect(event.enhancementCapacityBefore).toBeUndefined();
    expect(event.newlyUnlockedEnhancements).toBeUndefined();
  });
});
