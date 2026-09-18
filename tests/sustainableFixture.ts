import { dispatch, newRun } from '../src/game/engine';
import { enhancementCost } from '../src/game/enhancements';
import { HANDS, handOptions } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { Action, HandId } from '../src/game/types';

// Reach a repeatable probabilistic Sticky + Sustainable success through real seeded plays and purchases.
export function stickySustainableRun() {
  // Try the verified short replay first, retaining discovery if rules change later.
  const indices = [17, ...Array.from({ length: 1500 }, (_, index) => index).filter(index => index !== 17)];
  for (const index of indices) {
    const seed = `sticky-sustainable-${index}`;
    let game = newRun(seed).state;
    const actions: Action[] = [];
    for (let step = 0; step < 60 && game.round <= 4; step++) {
      if (game.phase === 'lost' || game.phase === 'error') break;
      let action: Action;
      if (game.phase === 'shop') {
        const sticky = game.shop!.offers.find(offer => offer.enhancement === 'sticky');
        const sustainable = game.shop!.offers.find(offer => offer.enhancement === 'sustainable');
        if (sticky && sustainable && game.gold >= enhancementCost('sticky') + enhancementCost('sustainable')) {
          // These enhancements do not affect the initial roll. Choose a physical face
          // that naturally reappears next round, keeping the fixture's replay short.
          const next = dispatch(game, { type: 'NEXT_ROUND' }).state;
          const die = game.dice.find(die => die.value === next.dice[die.id].value);
          if (die) {
            for (const offer of [sticky, sustainable]) {
              action = { type: 'BUY', offerId: offer.id, dieId: die.id };
              actions.push(action);
              game = dispatch(game, action).state;
            }
            action = { type: 'NEXT_ROUND' };
            actions.push(action);
            game = dispatch(game, action).state;
            const hand = (Object.keys(HANDS) as HandId[]).find(hand => HANDS[hand].rank === die.value)!;
            const play: Action = { type: 'PLAY', hand, dieIds: [die.id] };
            const first = dispatch(game, play);
            const second = dispatch(first.state, play);
            const firstSucceeded = first.events.some(event => event.enhancement === 'sustainable')
              && first.events.some(event => event.enhancement === 'sticky');
            const secondSucceeded = second.events.some(event => event.enhancement === 'sustainable')
              && second.events.some(event => event.enhancement === 'sticky');
            if (game.phase === 'round' && first.state.phase === 'round' && second.state.phase === 'round'
              && firstSucceeded && secondSucceeded && first.state.dice[die.id].value === die.value
              && second.state.dice[die.id].value === die.value) {
              return { seed, actions, game, dieId: die.id, face: die.value, hand, play, first, second };
            }
            break;
          }
        }
        action = { type: 'NEXT_ROUND' };
      } else {
        const choices = handOptions(game.dice, game.consumed).filter(option => !option.consumed)
          .flatMap(option => option.combinations.map(dieIds => ({ type: 'PLAY' as const, hand: option.id, dieIds })))
          .sort((a, b) => handScore(game.dice, b.hand, b.dieIds).score - handScore(game.dice, a.hand, a.dieIds).score);
        action = choices[0] ?? { type: 'MANUAL_REROLL', dieIds: [0] };
      }
      const result = dispatch(game, action);
      if (result.error) throw new Error(result.error);
      actions.push(action);
      game = result.state;
    }
  }
  throw new Error('No seeded repeatable Sticky + Sustainable probability fixture found');
}
