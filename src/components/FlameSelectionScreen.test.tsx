import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { newRun } from '../game/engine';
import { placeFlameInstance } from '../game/flames';
import type { RandomSource } from '../game/types';
import { FlameSelectionScreen } from './FlameSelectionScreen';

const constant: RandomSource = { next: () => 0.99 };

describe('FlameSelectionScreen', () => {
  it('shows replacement guidance when all five global Flame slots are occupied', () => {
    const board = newRun('full-flame-slots', constant).state;
    board.phase = 'flameSelection';
    (['ultimate', 'minigun', 'hailMary', 'fullOfGrace', 'momentum'] as const)
      .forEach((flame, slot) => placeFlameInstance(board, flame, 0, slot as 0 | 1 | 2 | 3 | 4));
    board.flameSelection = { offers: [{ id: 1, flame: 'thirdRail' }], acquired: false };
    const html = renderToStaticMarkup(<MantineProvider><FlameSelectionScreen
      board={board} event={null} busy={false} selectedOffer={null}
      setSelectedOffer={() => {}} submit={() => {}} skip={() => {}} openFlameDetails={() => {}}
    /></MantineProvider>);
    expect(html).not.toContain('Your Flames');
    expect(html).not.toContain('global-flame-slots');
    expect(html).toContain('Third Rail');
    expect(html).toContain('SELECT TO REPLACE');
  });
});
