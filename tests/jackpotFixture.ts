import { activeFace } from '../src/game/dice';
import { dispatch, newRun } from '../src/game/engine';
import { handOptions } from '../src/game/hands';
import { handScore } from '../src/game/scoring';
import type { GameState } from '../src/game/types';

function plays(game: GameState) {
  return handOptions(game.dice, game.consumed).filter(option => !option.consumed)
    .flatMap(option => option.combinations.map(dieIds => ({
      action: { type: 'PLAY' as const, hand: option.id, dieIds },
      score: handScore(game.dice, option.id, dieIds).score,
    })))
    .sort((a, b) => b.score > a.score ? 1 : b.score < a.score ? -1 : 0);
}

// The browser assertion is about scoring playback, so build the smallest legal
// Inferno-I board directly instead of depending on a particular Shop roll.
export function jackpotRun() {
  for (let index = 0; index < 100; index++) {
    const seed = `jackpot-browser-${index}`;
    const game = newRun(seed).state;
    game.engulfmentLevel = 1;
    const winner = plays(game)[0];
    if (!winner) continue;
    const heldDieId = winner.action.dieIds[0];
    const heldFace = game.dice[heldDieId].value;
    activeFace(game.dice[heldDieId]).enhancements.jackpot = 1;
    game.target = game.score + winner.score;
    game.stats.rounds.at(-1)!.target = game.target;
    const result = dispatch(game, winner.action);
    if (result.events.some(event => event.enhancement === 'jackpot')) {
      return { seed, actions: [], game, play: winner.action, result, heldDieId, heldFace };
    }
  }
  throw new Error('No deterministic Jackpot browser fixture found');
}
