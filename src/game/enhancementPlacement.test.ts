import { MantineProvider } from '@mantine/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DiceDock } from '../components/DiceDock';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { attachmentError, canPlace, enhancementCost, placementError } from './enhancements';
import type { Enhancement, GameState, RandomSource } from './types';

const constant: RandomSource = { next: () => 0.5 };

function shopState(enhancement: Enhancement): GameState {
  const state = newRun(`per-die-${enhancement}`, constant).state;
  state.phase = 'shop';
  state.gold = 100;
  state.dice.forEach(die => { die.value = 1; });
  state.shop = {
    offers: [
      { id: 100, enhancement, purchased: false },
      { id: 101, enhancement, purchased: false },
    ],
    trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0,
  };
  return state;
}

describe.each(['jumpingBean', 'magnetic'] as const)('%s per-die placement limit', enhancement => {
  it('allows the first placement, rejects another face on that die, and allows another die', () => {
    const initial = shopState(enhancement);
    const first = dispatch(initial, { type: 'BUY', offerId: 100, dieId: 0 });
    expect(first.error).toBeUndefined();
    expect(first.state.dice[0].faces[0].enhancements[enhancement]).toBe(1);
    expect(first.state.gold).toBe(100 - enhancementCost(enhancement));

    first.state.dice[0].value = 2;
    const blocked = dispatch(first.state, { type: 'BUY', offerId: 101, dieId: 0 });
    expect(blocked.error).toBe(`${enhancement === 'jumpingBean' ? 'Jumping Bean' : 'Magnetic'} is limited to one Face per Die.`);
    expect(blocked.state.gold).toBe(first.state.gold);
    expect(blocked.state.dice[0].faces[1].enhancements[enhancement]).toBeUndefined();
    expect(blocked.state.shop!.offers[1].purchased).toBe(false);

    const otherDie = dispatch(blocked.state, { type: 'BUY', offerId: 101, dieId: 1 });
    expect(otherDie.error).toBeUndefined();
    expect(otherDie.state.dice[1].faces[0].enhancements[enhancement]).toBe(1);
    expect(otherDie.state.gold).toBe(100 - 2 * enhancementCost(enhancement));
  });

  it('marks another face on the same die ineligible in the Shop while leaving a different die eligible', () => {
    const board = shopState(enhancement);
    board.dice.forEach(die => { die.value = 2; });
    board.dice[0].faces[0].enhancements[enhancement] = 1;
    board.shop!.offers = [{ id: 200, enhancement, purchased: false }];
    const html = renderToStaticMarkup(createElement(MantineProvider, null, createElement(DiceDock, {
      board, event: null, busy: false, actionsEnabled: true, cinematic: false, display: 'numerals', selectedOffer: 200,
      setSelectedOffer: () => {}, selectedFlameOffer: null, selection: { hand: null, dieIds: [] }, setSelection: () => {},
      submit: () => {}, openFaceDetails: () => {}, openFlameDetails: () => {},
    })));
    const name = enhancement === 'jumpingBean' ? 'Jumping Bean' : 'Magnetic';
    expect(html).toContain(`aria-label="Die 1, face 2, 2 Pips, unavailable: ${name} is limited to one Face per Die."`);
    expect(html).toContain('aria-label="Die 2, face 2, 2 Pips"');
  });
});

describe('placement rule compatibility', () => {
  it('keeps same-face nonstackability and the three-type face capacity rule', () => {
    const state = shopState('jumpingBean');
    const die = state.dice[0];
    const face = activeFace(die);
    face.enhancements.jumpingBean = 1;
    expect(attachmentError(face, 'jumpingBean')).toContain('already on this Face');
    expect(placementError(die, face, 'jumpingBean')).toContain('already on this Face');

    delete face.enhancements.jumpingBean;
    face.enhancements.bonus = 1;
    face.enhancements.golden = 1;
    face.enhancements.workout = 1;
    expect(placementError(die, face, 'mirror')).toContain('This Face is full');
    expect(canPlace(die, face, 'bonus')).toBe(true);
  });
});
