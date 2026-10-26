import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { newRun } from '../game/engine';
import { placeFlameInstance } from '../game/flames';
import { HandScorecard } from './HandList';

const wrap = (node: React.ReactNode) => renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);

describe('Bench Warmer scorecard designation', () => {
  it('uses a distinct compact badge and follows authoritative target changes', () => {
    const board = newRun('bench-warmer-ui', { next: () => .5 }).state;
    placeFlameInstance(board, 'benchWarmer', 100);
    const render = () => wrap(<HandScorecard board={board} selection={{ dieIds: [], hand: null }} busy={false}
      canSubmit={false} submitPreview={null} onSelect={() => {}} onSubmit={() => {}} />);
    expect(render()).toContain('data-testid="bench-warmer-badge-ones"');
    expect(render()).toContain('BENCH WARMER');
    expect(render()).not.toContain('data-testid="ultimate-badge-ones"');

    board.handLevels.ones = 2;
    expect(render()).toContain('data-testid="bench-warmer-badge-twos"');
  });
});
