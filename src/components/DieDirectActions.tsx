import { Button } from '@mantine/core';
import { CONFIG } from '../game/config';
import { validateAction } from '../game/engine';
import { effectOf, effectRuntime } from '../game/specialDice';
import type { Action, Board, CollectibleDie } from '../game/types';

export function directActionCount(die: CollectibleDie): number {
  return Number(!!effectOf(die, 'chameleon')) + Number(!!effectOf(die, 'furnace'));
}

export function DieDirectActions({ board, die, busy, actionsEnabled, submit }: {
  board: Board;
  die: CollectibleDie;
  busy: boolean;
  actionsEnabled: boolean;
  submit: (action: Action) => void;
}) {
  if (board.phase !== 'round') return null;
  const unavailable = busy || !actionsEnabled ? 'Gameplay controls are temporarily unavailable.' : null;
  const chameleon = effectOf(die, 'chameleon');
  const chameleonRuntime = effectRuntime(board.dieRoundState[die.id], chameleon);
  const chameleonAction: Action = { type: 'INVOKE_CHAMELEON', dieId: die.id };
  const chameleonReason = unavailable ?? (chameleon ? validateAction(board, chameleonAction) : null);
  const furnace = effectOf(die, 'furnace');
  const furnaceRuntime = effectRuntime(board.dieRoundState[die.id], furnace);
  const furnaceAction: Action = { type: 'FEED_FURNACE', dieId: die.id, amount: 1 };
  const furnaceReason = unavailable ?? (furnace ? validateAction(board, furnaceAction) : null);

  if (!chameleon && !furnace) return null;
  return <div className="die-direct-actions" aria-label={`Direct actions for die ${die.id}`}>
    {chameleon && <Button size="compact-xs" variant="light" color="grape"
      className="die-direct-action chameleon-direct-action" disabled={chameleonReason !== null}
      title={chameleonReason ?? 'Change this face to the most common face among your other dice.'}
      aria-label={`Use Chameleon. ${chameleonRuntime?.invocationsRemaining ?? 0} Uses remaining${chameleonReason ? `. Unavailable: ${chameleonReason}` : ''}`}
      data-testid={`chameleon-action-${die.id}`}
      onClick={event => { event.stopPropagation(); submit(chameleonAction); }}>
      <span>CHAM</span><small>{chameleonRuntime?.invocationsRemaining ?? 0}U</small>
    </Button>}
    {furnace && <Button size="compact-xs" variant="light" color="yellow"
      className="die-direct-action furnace-direct-action" disabled={furnaceReason !== null}
      title={furnaceReason ?? 'Spend 1 Gold to add to this Furnace reserve.'}
      aria-label={`Feed Furnace 1 Gold. Reserve ${furnaceRuntime?.furnacePips ?? 0} Pips. ${furnaceRuntime?.furnaceGoldFed ?? 0} of ${CONFIG.furnaceMaxGoldPerRound} Gold fed this Round${furnaceReason ? `. Unavailable: ${furnaceReason}` : ''}`}
      data-testid={`furnace-action-${die.id}`}
      onClick={event => { event.stopPropagation(); submit(furnaceAction); }}>
      <span>+1G</span><small>{furnaceRuntime?.furnacePips ?? 0}P · {furnaceRuntime?.furnaceGoldFed ?? 0}/{CONFIG.furnaceMaxGoldPerRound}</small>
    </Button>}
  </div>;
}
