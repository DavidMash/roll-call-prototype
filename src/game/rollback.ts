import { boardSnapshot } from './telemetry';
import type { GameState, RollbackState } from './types';

export function captureRollbackState(state: GameState): RollbackState {
  return { board: boardSnapshot(state), rngState: state.rngState, nextOfferId: state.nextOfferId };
}

export function restoreRollbackState(state: GameState, rollback: RollbackState): void {
  Object.assign(state, structuredClone(rollback.board));
  state.rngState = rollback.rngState;
  state.nextOfferId = rollback.nextOfferId;
}

export function isRollbackState(value: unknown): value is RollbackState {
  return typeof value === 'object' && value !== null && 'board' in value && 'rngState' in value && 'nextOfferId' in value;
}
