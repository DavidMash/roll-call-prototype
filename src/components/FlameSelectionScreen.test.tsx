import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { newRun } from '../game/engine';
import { FLAME_IDS } from '../game/flames';
import type { RandomSource } from '../game/types';
import { FlameSelectionScreen } from './FlameSelectionScreen';

const constant: RandomSource = { next: () => 0.99 };

describe('FlameSelectionScreen', () => {
  it('shows the all-collected state and keeps Shop continuation available', () => {
    const board = newRun('all-flames-collected', constant).state;
    board.phase = 'flameSelection';
    board.bonfires = [...FLAME_IDS];
    board.flameSelection = { offers: [], acquired: false };
    const html = renderToStaticMarkup(<MantineProvider><FlameSelectionScreen
      board={board} event={null} busy={false} diceDisplay="numerals" selectedOffer={null}
      setSelectedOffer={() => {}} submit={() => {}} skip={() => {}}
    /></MantineProvider>);
    expect(html).toContain('ALL FLAMES COLLECTED');
    expect(html).toContain('CONTINUE TO SHOP');
    expect(html).not.toContain('disabled=""');
  });
});
