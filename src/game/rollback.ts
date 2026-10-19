import { boardSnapshot } from './telemetry';
import { assertDiceInventory, syncActiveDiceProjection } from './inventory';
import type { GameState, RollbackState } from './types';

export function captureRollbackState(state: GameState): RollbackState {
  return {
    board: boardSnapshot(state), diceInventory: structuredClone(state.diceInventory),
    encounterDice: structuredClone(state.encounterDice), rngState: state.rngState, nextOfferId: state.nextOfferId,
  };
}

export function restoreRollbackState(state: GameState, rollback: RollbackState): void {
  Object.assign(state, structuredClone(rollback.board));
  state.diceInventory = structuredClone(rollback.diceInventory);
  state.encounterDice = structuredClone(rollback.encounterDice);
  state.rngState = rollback.rngState;
  state.nextOfferId = rollback.nextOfferId;
  assertDiceInventory(state.diceInventory, state.encounterDice);
  syncActiveDiceProjection(state);
}

export function isRollbackState(value: unknown): value is RollbackState {
  return typeof value === 'object' && value !== null && 'board' in value && 'diceInventory' in value
    && 'encounterDice' in value && 'rngState' in value && 'nextOfferId' in value;
}
