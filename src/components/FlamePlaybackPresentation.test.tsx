import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from '../game/engine';
import { placeFlameInstance } from '../game/flames';
import { rosterDice, syncActiveDiceProjection } from '../game/inventory';
import { resetDieRoundState } from '../game/specialDice';
import type { RandomSource } from '../game/types';
import { TopHud } from './TopHud';

const constant: RandomSource = { next: () => .8 };

describe('Flame playback presentation', () => {
  it('renders event-specific activation feedback without candidate presentation', () => {
    const state = newRun('flame-playback-activation', constant).state;
    state.target = 1_000_000n;
    state.stats.rounds.at(-1)!.target = state.target;
    placeFlameInstance(state, 'missingPair', 100);
    const dice = rosterDice(state);
    dice[0].value = 2;
    dice[1].value = 2;
    syncActiveDiceProjection(state);
    state.dieRoundState = resetDieRoundState(dice);
    const result = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [dice[0].id, dice[1].id] }, constant);
    const event = result.events.find(item => item.type === 'HAND_SCORE_FINALIZED')!;
    const html = renderToStaticMarkup(<MantineProvider><TopHud
      board={event.board}
      event={event}
      flamePresentation={[]}
      speed="fast"
      setSpeed={() => {}}
      diceDisplay="numerals"
      setDiceDisplay={() => {}}
      openRunInfo={() => {}}
      openHelp={() => {}}
      openRestoreLives={() => {}}
      openFlameDetails={() => {}}
      returnToTitle={() => {}}
    /></MantineProvider>);
    expect(html).toContain('flame-resolution-pop');
    expect(html).toContain('×3 XMULT');
  });
});
