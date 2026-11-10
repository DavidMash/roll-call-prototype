import { wholeDieEffectSuppressed } from './dice';
import { effectOf, effectRuntime } from './specialDice';
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
  // Preserve ordinary per-die reroll pricing. Once Flywheel participates, the
  // mixed selection is one paid Manual Reroll plus the automatically covered dice.
  const resourceCost = fullyCoveredByFlywheel ? 0 : flywheelDieIds.length > 0 ? 1 : dieIds.length;
  return { flywheelDieIds, fullyCoveredByFlywheel, resourceCost };
}
