import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from '../game/engine';
import { scoreAnnouncement, scorePresentation } from '../game/scorePresentation';
import { ScoreResolution } from './ScoreResolution';

function scoringEvents(level: number) {
  const state = newRun(`inferno-presentation-${level}`, { next: () => 0.99 }).state;
  state.engulfmentLevel = level;
  state.target = 1_000_000n;
  state.dice[0].value = 1;
  return dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }).events;
}

describe('Inferno score presentation', () => {
  it('keeps Inferno ×1 completely hidden', () => {
    const event = scoringEvents(0).find(item => item.type === 'HAND_STARTED')!;
    const view = scorePresentation(event)!;
    expect(view.inferno).toBe(BigInt(1n));
    expect(scoreAnnouncement(view)).not.toContain('Inferno');
    const html = renderToStaticMarkup(<MantineProvider><ScoreResolution event={event} busy onSkip={() => {}} /></MantineProvider>);
    expect(html).not.toContain('INFERNO');
    expect(html).not.toContain('hand-inferno');
  });

  it('renders Inferno as the final multiplicative layer after Pips, Mult, and XMult', () => {
    const events = scoringEvents(1);
    const started = events.find(item => item.type === 'HAND_STARTED')!;
    expect(scorePresentation(started)?.showInferno).toBe(false);
    const event = events.find(item => item.type === 'HAND_INFERNO_APPLIED')!;
    event.handScore!.currentXMult = 2;
    const view = scorePresentation(event)!;
    expect(view.inferno).toBe(BigInt(25n));
    expect(scoreAnnouncement(view)).toContain('Pips 1. XMult 2. Inferno 25');
    const html = renderToStaticMarkup(<MantineProvider><ScoreResolution event={event} busy onSkip={() => {}} /></MantineProvider>);
    expect(html.indexOf('INFERNO')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('PIPS')).toBeLessThan(html.indexOf('MULT'));
    expect(html.indexOf('MULT')).toBeLessThan(html.indexOf('XMULT'));
    expect(html.indexOf('XMULT')).toBeLessThan(html.indexOf('INFERNO'));
  });

  it('renders Inferno XII with every exact digit', () => {
    const event = scoringEvents(12).find(item => item.type === 'HAND_INFERNO_APPLIED')!;
    const view = scorePresentation(event)!;
    expect(view.inferno).toBe(59_604_644_775_390_625n);
    expect(scoreAnnouncement(view)).toContain('59,604,644,775,390,625');
    const html = renderToStaticMarkup(<MantineProvider><ScoreResolution event={event} busy onSkip={() => {}} /></MantineProvider>);
    expect(html).toContain('59,604,644,775,390,625');
  });
});
