import { wholeDieEffectSuppressed } from './dice';
import { effectOf, effectRuntime } from './specialDice';
import { activeEncounterDice } from './bosses';
import { usableManualRerolls } from './specialOffers';
import type { Board, DieId } from './types';

export interface ManualRerollResolution {
  flywheelDieIds: DieId[];
  resourceCost: number;
  fullyCoveredByFlywheel: boolean;
}

/** Resolves automatic Flywheel coverage before a Manual Reroll is validated or paid. */
export function resolveManualRerollCost(
  state: Pick<Board, 'dice' | 'dieRoundState'>,
  dieIds: readonly DieId[],
): ManualRerollResolution {
  const selected = new Set(dieIds);
  const flywheelDieIds = state.dice.filter((die): die is import('./types').CollectibleDie =>
    selected.has(die.id) && die.owner === 'player')
    .filter(die => {
      const effect = effectOf(die, 'flywheel');
      return !!effect && !wholeDieEffectSuppressed(die)
        && (effectRuntime(state.dieRoundState[die.id], effect)?.invocationsRemaining ?? 0) > 0;
    })
    .map(die => die.id);
  const fullyCoveredByFlywheel = dieIds.length > 0 && flywheelDieIds.length === dieIds.length;
  const resourceCost = Math.max(0, dieIds.length - flywheelDieIds.length);
  return { flywheelDieIds, fullyCoveredByFlywheel, resourceCost };
}

/** Whether the submitted Manual Reroll selection can be paid after automatic coverage. */
export function canAffordManualReroll(state: Board, dieIds: readonly DieId[]): boolean {
  return resolveManualRerollCost(state, dieIds).resourceCost <= usableManualRerolls(state);
}

/** Whether the player can currently submit at least one legal Manual Reroll selection. */
export function hasLegalManualReroll(state: Board): boolean {
  if (state.phase !== 'round') return false;
  if (!state.bossSilenced && state.boss?.type === 'warden' && state.boss.startingDieId === null) return false;
  return activeEncounterDice(state).some(die => canAffordManualReroll(state, [die.id]));
}
