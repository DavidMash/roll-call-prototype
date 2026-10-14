import { activeFace } from '../src/game/dice';
import { dispatch, newRun } from '../src/game/engine';
import { handOptions } from '../src/game/hands';
import type { Action } from '../src/game/types';

// Playback tests need a deterministic scoring event, not a particular Shop route.
// Build the smallest legal Inferno-I board and retain the real dispatch result.
export function scoringPlaybackRun() {
  for (let index = 0; index < 200; index++) {
    const seed = `live-scoring-${index}`;
    const base = newRun(seed).state;
    const choices = handOptions(base.dice, []).filter(option => !option.consumed)
      .flatMap(option => option.combinations.map(dieIds => ({ type: 'PLAY' as const, hand: option.id, dieIds })))
      .filter(choice => choice.dieIds.length < base.dice.length);
    for (const action of choices) {
      const game = structuredClone(base);
      game.engulfmentLevel = 1;
      game.target = 1_000_000n;
      game.stats.rounds.at(-1)!.target = game.target;
      game.handLevels[action.hand] = 3;
      activeFace(game.dice[action.dieIds[0]]).enhancements.bonus = 1;
      const hitchhiker = game.dice.find(die => !action.dieIds.includes(die.id))!;
      activeFace(hitchhiker).enhancements.hitchhiker = 3;
      const result = dispatch(game, action);
      const hasBonus = result.events.some(event => event.type === 'HAND_PIPS_CHANGED' && event.enhancement === 'bonus');
      const hasHitchhiker = result.events.some(event => event.type === 'HITCHHIKER_ADDED_PIPS');
      if (hasBonus && hasHitchhiker) return { seed, actions: [] as Action[], game, action, result };
    }
  }
  throw new Error('No seeded Bonus/Hitchhiker playback fixture found');
}
