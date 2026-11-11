import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Resolver } from '../game/effects';
import { newRun } from '../game/engine';
import { placeFlameInstance } from '../game/flames';
import { HandScorecard, HandScorecardView } from './HandList';
import { deriveScorecardAvailability } from '../game/scorecardAvailability';

const wrap = (node: React.ReactNode) => renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);

describe('Bench Warmer scorecard designation', () => {
  it('uses a distinct compact badge and follows authoritative target changes', () => {
    const board = newRun('bench-warmer-ui', { next: () => .5 }).state;
    placeFlameInstance(board, 'benchWarmer', 100);
    const render = () => wrap(<HandScorecard board={board} selection={{ dieIds: [], hand: null }} busy={false}
      canSubmit={false} submitPreview={null} onSelect={() => {}} onSubmit={() => {}} onAcceptDoubleOrNothing={() => {}} />);
    expect(render()).toContain('data-testid="bench-warmer-badge-ones"');
    expect(render()).toContain('BENCH WARMER');
    expect(render()).not.toContain('data-testid="ultimate-badge-ones"');

    board.handLevels.ones = 2;
    expect(render()).toContain('data-testid="bench-warmer-badge-twos"');
  });
});

describe('Double or Nothing scorecard interaction', () => {
  it('marks three targets and renders the pending wager as a sibling scorecard action', () => {
    const board = newRun('double-or-nothing-ui', { next: () => 0 }).state;
    board.target = 1_000_000n;
    board.stats.rounds.at(-1)!.target = board.target;
    board.handLevels.ones = 2;
    placeFlameInstance(board, 'doubleOrNothing', 100);
    board.dice[0].value = 1;
    new Resolver(board, { next: () => 0 }).play('ones', [board.dice[0].id]);

    const html = wrap(<HandScorecard board={board} selection={{ dieIds: [], hand: null }} busy={false}
      canSubmit={false} submitPreview={null} onSelect={() => {}} onSubmit={() => {}} onAcceptDoubleOrNothing={() => {}} />);
    expect(html.match(/data-testid="double-or-nothing-target-/g)).toHaveLength(3);
    expect(html).toContain('data-testid="accept-double-or-nothing-ones"');
    expect(html).toContain('Accept Double or Nothing for Ones');
    expect(html).not.toContain('double-or-nothing-countdown');
  });
});

describe('scorecard playback presentation', () => {
  it('keeps frozen decision availability while live score, consumed, and boss states update', () => {
    const board = newRun('scorecard-playback-view', { next: () => 0 }).state;
    board.target = 1_000_000n;
    board.stats.rounds.at(-1)!.target = board.target;
    board.dice[0].value = 4;
    board.dice[1].value = 4;
    const selection = { dieIds: [], hand: null };
    const availability = deriveScorecardAvailability(board, selection);
    const render = () => wrap(<HandScorecardView board={board} selection={selection} availability={availability}
      busy canSubmit={false} submitPreview={null} onSelect={() => {}} onSubmit={() => {}} onAcceptDoubleOrNothing={() => {}} />);

    expect(render()).toMatch(/data-testid="scorecard-row-pair"[^>]*data-state="playable"/);
    board.scoreByHand.pair = 42n;
    board.consumed.push('pair');
    expect(render()).toMatch(/data-testid="scorecard-row-pair"[^>]*data-state="consumed"/);
    expect(render()).toContain('data-testid="scorecard-score-pair">42');

    board.consumed = [];
    board.boss = { type: 'marathon', cooldowns: { pair: 2 } };
    expect(render()).toMatch(/data-testid="scorecard-row-pair"[^>]*data-state="unavailable"/);
    expect(render()).toContain('title="Cooldown 2"');
  });
});
