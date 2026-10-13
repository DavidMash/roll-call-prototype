import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from '../game/engine';
import { scoreAnnouncement, scorePresentation } from '../game/scorePresentation';
import { ScoreResolution } from './ScoreResolution';

function startedEvent(level: number) {
  const state = newRun(`inferno-presentation-${level}`, { next: () => 0.99 }).state;
  state.engulfmentLevel = level;
  state.target = 1_000_000n;
  state.dice[0].value = 1;
  return dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }).events.find(event => event.type === 'HAND_STARTED')!;
}

describe('Inferno score presentation', () => {
  it('keeps Inferno ×1 completely hidden', () => {
    const event = startedEvent(0);
    const view = scorePresentation(event)!;
    expect(view.inferno).toBe(BigInt(1n));
    expect(scoreAnnouncement(view)).not.toContain('Inferno');
    const html = renderToStaticMarkup(<MantineProvider><ScoreResolution event={event} busy onSkip={() => {}} /></MantineProvider>);
    expect(html).not.toContain('INFERNO');
    expect(html).not.toContain('hand-inferno');
  });

  it('renders Inferno first once active, ahead of Pips, Mult, and XMult', () => {
    const event = startedEvent(1);
    event.handScore!.currentXMult = 2;
    const view = scorePresentation(event)!;
    expect(view.inferno).toBe(BigInt(25n));
    expect(scoreAnnouncement(view).startsWith('Inferno 25. Pips')).toBe(true);
    const html = renderToStaticMarkup(<MantineProvider><ScoreResolution event={event} busy onSkip={() => {}} /></MantineProvider>);
    expect(html.indexOf('INFERNO')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('INFERNO')).toBeLessThan(html.indexOf('PIPS'));
    expect(html.indexOf('PIPS')).toBeLessThan(html.indexOf('MULT'));
    expect(html.indexOf('MULT')).toBeLessThan(html.indexOf('XMULT'));
  });

  it('renders Inferno XII with every exact digit', () => {
    const event = startedEvent(12);
    const view = scorePresentation(event)!;
    expect(view.inferno).toBe(59_604_644_775_390_625n);
    expect(scoreAnnouncement(view)).toContain('59,604,644,775,390,625');
    const html = renderToStaticMarkup(<MantineProvider><ScoreResolution event={event} busy onSkip={() => {}} /></MantineProvider>);
    expect(html).toContain('59,604,644,775,390,625');
  });
});
