import { activeFace } from '../src/game/dice';
import { activeEncounterDice, requiredEncounterDieIds, unavailableEncounterHands } from '../src/game/bosses';
import { dispatch, newRun } from '../src/game/engine';
import { stacks } from '../src/game/enhancements';
import { combinationsForHand, handOptions } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { Action, GameState } from '../src/game/types';

export function pairSelectionRun(hand: 'pair' | 'twoPair') {
  for (let index = 0; index < 6000; index++) {
    const game = newRun(`${hand}-selection-${index}`).state;
    const combinations = combinationsForHand(game.dice, hand);
    if (combinations.length !== 3) continue;
    const action = { type: 'PLAY' as const, hand, dieIds: combinations[1] };
    const result = dispatch(game, action);
    if (result.state.phase === 'round' && combinationsForHand(result.state.dice, hand).length) {
      return { game, initial: combinations[0], action, result };
    }
  }
  throw new Error(`No deterministic ${hand} substitution fixture found`);
}

function choices(game: GameState) {
  return handOptions(activeEncounterDice(game), unavailableEncounterHands(game), requiredEncounterDieIds(game)).filter(option => !option.consumed)
    .flatMap(option => option.combinations.map(dieIds => ({ type: 'PLAY' as const, hand: option.id, dieIds })))
    .sort((a, b) => handScore(game.dice, b.hand, b.dieIds).score - handScore(game.dice, a.hand, a.dieIds).score);
}

export function winningSlippyRun() {
  for (let index = 0; index < 1000; index++) {
    const seed = `winning-slippy-${index}`;
    let game = newRun(seed).state;
    const actions: Action[] = [];
    let boughtSlippy = false;
    for (let step = 0; step < 80 && game.round <= 4; step++) {
      if (game.phase === 'lost' || game.phase === 'error') break;
      let action: Action;
      if (game.phase === 'roundSummary') {
        action = { type: 'CONTINUE_ROUND_SUMMARY' };
      } else if (game.phase === 'flameSelection') {
        action = game.flameSelection!.acquired
          ? { type: 'CONTINUE_FLAME_SELECTION' }
          : { type: 'CHOOSE_FLAME', offerId: game.flameSelection!.offers[0].id, dieId: Math.floor(game.round / 3 - 1) % 5 };
      } else if (game.phase === 'specialOffer') {
        const offer = game.specialOffer!.offers.find(item => item.type !== 'timeTravel') ?? game.specialOffer!.offers[0];
        action = game.specialOffer!.acquired ? { type: 'CONTINUE_SPECIAL_OFFER' }
          : { type: 'CHOOSE_SPECIAL_OFFER', offerId: offer.id };
      } else if (game.phase === 'shop') {
        const offer = !game.bust ? game.shop!.offers.find(item => item.enhancement === 'slippy' && !item.purchased) : undefined;
        if (offer && !boughtSlippy) {
          action = { type: 'BUY', offerId: offer.id, dieId: 4 };
          boughtSlippy = true;
        } else action = game.bust ? { type: 'RETRY_ROUND' } : { type: 'NEXT_ROUND' };
      } else {
        if (game.boss?.type === 'warden' && game.boss.pendingReinforcements > 0) {
          const activeDieIds = game.boss.activeDieIds;
          const die = game.dice.find(item => item.owner === 'player' && !activeDieIds.includes(item.id));
          if (!die) throw new Error('Warden fixture has no locked die to unlock');
          action = { type: 'UNLOCK_WARDEN_DIE', dieId: die.id };
          const result = dispatch(game, action);
          if (result.error) throw new Error(result.error);
          actions.push(action);
          game = result.state;
          continue;
        }
        const hands = choices(game);
        const winning = hands.find(choice => game.score + handScore(game.dice, choice.hand, choice.dieIds).score >= game.target);
        if (winning && !game.boss && stacks(activeFace(game.dice[4]), 'slippy')) {
          return { seed, game, actions, action: winning, result: dispatch(game, winning) };
        }
        action = hands[0] ?? { type: 'MANUAL_REROLL', dieIds: [0] };
      }
      const result = dispatch(game, action);
      if (result.error) throw new Error(result.error);
      actions.push(action);
      game = result.state;
    }
  }
  throw new Error('No deterministic winning hand with exposed Slippy found');
}
