import { activeFace } from '../src/game/dice';
import { dispatch, newRun } from '../src/game/engine';
import { enhancementCost, stacks } from '../src/game/enhancements';
import { handOptions } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { Action, Enhancement } from '../src/game/types';
import { activeEncounterDice } from '../src/game/bosses';

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
      if (game.phase === 'roundSummary') {
        action = { type: 'CONTINUE_ROUND_SUMMARY' };
      } else if (game.phase === 'flameSelection') {
        action = game.flameSelection!.acquired
          ? { type: 'CONTINUE_FLAME_SELECTION' }
          : { type: 'CHOOSE_FLAME', offerId: game.flameSelection!.offers[0].id, dieId: Math.floor(game.round / 3 - 1) % 5 };
      } else if (game.phase === 'shop') {
        if (game.bust) action = { type: 'RETRY_ROUND' };
        else {
        const offer = game.shop!.offers.find(item => !item.purchased && !purchased.has(item.enhancement)
          && ['bonus', 'hitchhiker'].includes(item.enhancement)
          && game.gold >= enhancementCost(item.enhancement));
        if (offer) {
          const dieId = offer.enhancement === 'bonus' ? 0 : 4;
          action = { type: 'BUY', offerId: offer.id, dieId };
          purchased.add(offer.enhancement);
        } else action = { type: 'NEXT_ROUND' };
        }
      } else {
        const dice = activeEncounterDice(game);
        const callerHand = game.boss?.type === 'caller' && !game.boss.satisfied ? game.boss.calledHand : null;
        const choices = handOptions(dice, game.consumed).filter(option => !option.consumed)
          .flatMap(option => option.combinations.map(dieIds => ({ type: 'PLAY' as const, hand: option.id, dieIds })))
          .filter(choice => game.boss?.type !== 'hexer' || choice.dieIds.includes(game.boss.cursedDieId))
          .sort((a, b) => (callerHand ? Number(b.hand === callerHand) - Number(a.hand === callerHand) : 0)
            || handScore(dice, b.hand, b.dieIds).score - handScore(dice, a.hand, a.dieIds).score);
        const scoringAction = choices.find(choice =>
          choice.dieIds.some(id => stacks(activeFace(game.dice[id]), 'bonus'))
          && dice.some(die => !choice.dieIds.includes(die.id) && stacks(activeFace(die), 'hitchhiker')));
        if (scoringAction) {
          const result = dispatch(game, scoringAction);
          if (result.events.some(event => event.enhancement === 'hitchhiker')) return { seed, actions, game, action: scoringAction, result };
        }
        action = choices[0] ?? { type: 'MANUAL_REROLL', dieIds: [dice[0].id] };
      }
      const result = dispatch(game, action);
      if (result.error) throw new Error(result.error);
      actions.push(action);
      game = result.state;
    }
  }
  throw new Error('No seeded Bonus/Hitchhiker playback fixture found');
}
