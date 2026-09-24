import { activeFace } from '../src/game/dice';
import { dispatch, newRun } from '../src/game/engine';
import { handOptions } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { Action, GameState } from '../src/game/types';

function plays(game: GameState) {
  return handOptions(game.dice, game.consumed).filter(option => !option.consumed)
    .flatMap(option => option.combinations.map(dieIds => ({
      action: { type: 'PLAY' as const, hand: option.id, dieIds },
      score: handScore(game.dice, option.id, dieIds).score,
    })))
    .sort((a, b) => b.score - a.score);
}

// Discover a fully legal seeded route: buy Jackpot, later score its showing face
// in the hand that clears the round.
export function jackpotRun() {
  for (let index = 0; index < 2500; index++) {
    const seed = `jackpot-browser-${index}`;
    let game = newRun(seed).state;
    const route: Action[] = [];
    for (let step = 0; step < 15 && game.phase === 'round'; step++) {
      const choice = plays(game)[0];
      const action: Action = choice?.action ?? { type: 'MANUAL_REROLL', dieIds: [0] };
      route.push(action);
      game = dispatch(game, action).state;
    }
    if (game.phase !== 'shop' || game.bust) continue;
    const offer = game.shop!.offers.find(item => item.enhancement === 'jackpot');
    if (!offer) continue;

    for (const candidate of game.dice) {
      let branch = structuredClone(game);
      const actions = [...route];
      const heldDieId = candidate.id;
      const heldFace = candidate.value;
      const buy: Action = { type: 'BUY', offerId: offer.id, dieId: heldDieId };
      actions.push(buy);
      branch = dispatch(branch, buy).state;
      const next: Action = { type: 'NEXT_ROUND' };
      actions.push(next);
      branch = dispatch(branch, next).state;

      for (let step = 0; step < 80 && branch.round <= 6; step++) {
        if (branch.phase === 'shop') {
          const shopAction: Action = branch.bust ? { type: 'RETRY_ROUND' } : next;
          actions.push(shopAction);
          branch = dispatch(branch, shopAction).state;
          continue;
        }
        if (branch.phase !== 'round') break;
        const choices = plays(branch);
        const showingJackpot = activeFace(branch.dice[heldDieId]).enhancements.jackpot;
        const winner = showingJackpot && choices.find(choice => choice.action.dieIds.includes(heldDieId)
          && branch.score + choice.score >= branch.target);
        if (winner) {
          const result = dispatch(branch, winner.action);
          if (result.events.some(event => event.enhancement === 'jackpot')) {
            return { seed, actions, game: branch, play: winner.action, result, heldDieId, heldFace };
          }
        }

        let action: Action;
        const preferred = showingJackpot
          ? choices.find(choice => choice.action.dieIds.includes(heldDieId))
          : choices[0];
        if (preferred) action = preferred.action;
        else if (branch.manualRerollsRemaining > 0) action = { type: 'MANUAL_REROLL', dieIds: [heldDieId] };
        else break;
        actions.push(action);
        branch = dispatch(branch, action).state;
      }
    }
  }
  throw new Error('No deterministic Jackpot browser fixture found');
}
