import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { newRun } from '../game/engine';
import { ChallengeTracker } from './ChallengeTracker';
import { HoodedFigureScreen } from './HoodedFigureScreen';

const wrap = (node: React.ReactNode) => renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);

describe('Hooded Figure UI', () => {
  it('renders only a compact accessible tracker with progress details behind its info control', () => {
    const board = newRun('challenge-ui', { next: () => .2 }).state;
    board.round = 25;
    board.hoodedFigure.active = {
      id: 'theLongWay', issuedChapter: 5, target: 3,
      committed: { value: 1, keys: [], invalid: false, jackpotPaid: false },
      attempt: { value: 2, keys: [], invalid: false, jackpotPaid: false }, complete: false, dialogueLine: 'test',
    };
    const html = wrap(<ChallengeTracker board={board} />);
    expect(html).toContain('The Long Way');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('aria-label="About The Long Way challenge"');
    expect(html).not.toContain('Manually play Large Straight 3 times');
    expect(html).not.toContain('Rounds Remaining');
  });

  it('renders the cinematic as a modal story interaction', () => {
    const board = newRun('hooded-ui', { next: () => .2 }).state;
    board.phase = 'hoodedFigure';
    board.hoodedFigure.interaction = { kind: 'opening', stage: 'story', lineIndex: 0,
      lines: ['A hooded figure approaches...', 'The figure vanishes.'], recipient: null, sacrifice: null };
    const html = wrap(<HoodedFigureScreen board={board} busy={false} submit={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('A hooded figure approaches...');
  });

  it('shows three deterministic recipient choices without contribution averages', () => {
    const board = newRun('wildfire-ui', { next: () => .2 }).state;
    board.phase = 'hoodedFigure';
    board.bonfires = ['ultimate', 'minigun', 'hailMary', 'fullOfGrace', 'vineyard'];
    board.bonfireContributions.ultimate = { roundCount: 1, factorSum: 4 };
    board.hoodedFigure.interaction = { kind: 'return', stage: 'recipient', lineIndex: 0,
      lines: [], recipient: null, sacrifice: null };
    const html = wrap(<HoodedFigureScreen board={board} busy={false} submit={() => {}} />);
    expect((html.match(/wildfire-recipient-/g) ?? [])).toHaveLength(3);
    expect(html).not.toContain('average');
  });
});
