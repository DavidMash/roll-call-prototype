import { activeFace } from '../src/game/dice';
import { dispatch, newRun } from '../src/game/engine';
import { enhancementCost, stacks } from '../src/game/enhancements';
import { handOptions } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { Action, Enhancement } from '../src/game/types';

// Reach the enhanced board through real seeded plays and purchases, without UI injection.
export function scoringPlaybackRun() {
  // Try the verified fixture first; retain discovery if future rules invalidate it.
  const indices = [216, ...Array.from({ length: 1500 }, (_, index) => index).filter(index => index !== 216)];
  for (const index of indices) {
    const seed = `live-scoring-${index}`;
    let game = newRun(seed).state;
    const actions: Action[] = [];
    const purchased = new Set<Enhancement>();
    for (let step = 0; step < 80 && game.round <= 6; step++) {
      if (game.phase === 'lost' || game.phase === 'error') break;
      let action: Action;
      if (game.phase === 'flameReward') {
        action = game.flameReward!.acquired
          ? { type: 'CONTINUE_FLAME_REWARD' }
          : { type: 'CHOOSE_FLAME', offerId: game.flameReward!.offers[0].id, dieId: Math.floor(game.round / 3 - 1) % 5 };
      } else if (game.phase === 'shop') {
        const offer = game.shop!.offers.find(item => !item.purchased && !purchased.has(item.enhancement)
          && ['bonus', 'multiplier', 'hitchhiker'].includes(item.enhancement)
          && game.gold >= enhancementCost(item.enhancement));
        if (offer) {
          const dieId = offer.enhancement === 'bonus' ? 0 : offer.enhancement === 'multiplier' ? 1 : 4;
          action = { type: 'BUY', offerId: offer.id, dieId };
          purchased.add(offer.enhancement);
        } else action = { type: 'NEXT_ROUND' };
      } else {
        const choices = handOptions(game.dice, game.consumed).filter(option => !option.consumed)
          .flatMap(option => option.combinations.map(dieIds => ({ type: 'PLAY' as const, hand: option.id, dieIds })))
          .sort((a, b) => handScore(game.dice, b.hand, b.dieIds).score - handScore(game.dice, a.hand, a.dieIds).score);
        const scoringAction = choices.find(choice =>
          choice.dieIds.some(id => stacks(activeFace(game.dice[id]), 'bonus'))
          && choice.dieIds.some(id => stacks(activeFace(game.dice[id]), 'multiplier'))
          && game.dice.some(die => !choice.dieIds.includes(die.id) && stacks(activeFace(die), 'hitchhiker')));
        if (scoringAction) {
          const result = dispatch(game, scoringAction);
          if (result.events.some(event => event.enhancement === 'hitchhiker')) return { seed, actions, game, action: scoringAction, result };
        }
        action = choices[0] ?? { type: 'MANUAL_REROLL', dieIds: [0] };
      }
      const result = dispatch(game, action);
      if (result.error) throw new Error(result.error);
      actions.push(action);
      game = result.state;
    }
  }
  throw new Error('No seeded Bonus/Multiplier/Hitchhiker playback fixture found');
}
