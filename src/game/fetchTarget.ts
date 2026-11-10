import { activeEncounterDice } from './bosses';
import type { GameState, Rank } from './types';

export type FetchTarget = { dieId: number; physicalFace: Rank };
export type FetchRetargetReason = 'flame_acquired' | 'roster_changed' | 'die_removed' | 'forge_consumed'
  | 'load_repair' | 'round_start_repair' | 'target_scored' | 'reward_replaced';

/** Canonical player dice that can actually participate in the current encounter. */
export function eligibleFetchDice(state: Pick<GameState, 'dice' | 'diceInventory' | 'boss' | 'bossSilenced'>) {
  const roster = new Set(state.diceInventory.roster.filter((id): id is number => id !== null));
  return activeEncounterDice(state).filter((die): die is import('./types').CollectibleDie =>
    die.owner === 'player' && roster.has(die.id));
}

export function eligibleFetchTargets(
  state: Pick<GameState, 'dice' | 'diceInventory' | 'boss' | 'bossSilenced'>,
): FetchTarget[] {
  return eligibleFetchDice(state).flatMap(die => die.faces.slice(0, 6)
    .map((_face, index) => ({ dieId: die.id, physicalFace: (index + 1) as Rank })));
}

export function fetchTargetIsEligible(
  state: Pick<GameState, 'dice' | 'diceInventory' | 'boss' | 'bossSilenced'>,
  target: FetchTarget | null,
): boolean {
  return target !== null && eligibleFetchDice(state).some(die => die.id === target.dieId)
    && target.physicalFace >= 1 && target.physicalFace <= 6;
}
