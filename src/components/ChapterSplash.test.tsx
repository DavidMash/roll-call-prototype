import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Resolver } from '../game/effects';
import { newRun } from '../game/engine';
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

describe('Chapter Storage unlock presentation', () => {
  it.each([2, 3, 4, 5, 6, 7])('shows the Chapter %i Storage increase without legacy Enhancement progression', chapter => {
    const event = chapterEvent(chapter);
    const html = renderToStaticMarkup(<MantineProvider><ChapterSplash event={event} onComplete={() => {}} /></MantineProvider>);
    expect(html).toContain(`CHAPTER ${chapter}`);
    expect(html).toContain('+1 STORAGE SLOT');
    expect(html).not.toContain('ENHANCEMENT CAPACITY');
    expect(html).not.toContain('NEW ENHANCEMENTS');
    expect(event.enhancementCapacityBefore).toBeUndefined();
    expect(event.newlyUnlockedEnhancements).toBeUndefined();
  });
});
