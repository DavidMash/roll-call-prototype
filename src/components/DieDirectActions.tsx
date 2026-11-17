import type { CSSProperties } from 'react';
import { Button } from '@mantine/core';
import { CONFIG } from '../game/config';
import { validateAction } from '../game/engine';
import { effectOf, effectRuntime, invocationCapacity, SPECIAL_DICE } from '../game/specialDice';
import type { Action, Board, CollectibleDie } from '../game/types';
import { DieTypeIcon } from './DieTypeLabel';

function capacityStyle(type: 'chameleon' | 'furnace', remaining: number, capacity: number): CSSProperties {
  const progress = capacity > 0 ? Math.max(0, Math.min(1, remaining / capacity)) : 0;
  return {
    '--die-action-accent': SPECIAL_DICE[type].color,
    '--die-action-progress': progress,
  } as CSSProperties;
}

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
  const chameleonCapacity = chameleon ? invocationCapacity(chameleon) : 0;
  const chameleonRemaining = chameleonRuntime?.invocationsRemaining ?? chameleonCapacity;
  const chameleonAction: Action = { type: 'INVOKE_CHAMELEON', dieId: die.id };
  const chameleonReason = unavailable ?? (chameleon ? validateAction(board, chameleonAction) : null);
  const furnace = effectOf(die, 'furnace');
  const furnaceRuntime = effectRuntime(board.dieRoundState[die.id], furnace);
  const furnaceFed = furnaceRuntime?.furnaceGoldFed ?? 0;
  const furnaceRemaining = Math.max(0, CONFIG.furnaceMaxGoldPerRound - furnaceFed);
  const furnaceAction: Action = { type: 'FEED_FURNACE', dieId: die.id, amount: 1 };
  const furnaceReason = unavailable ?? (furnace ? validateAction(board, furnaceAction) : null);

  if (!chameleon && !furnace) return null;
  return <div className="die-direct-actions" aria-label={`Direct actions for die ${die.id}`}>
    {chameleon && <Button size="compact-xs" variant="light" color="grape"
      className="die-direct-action chameleon-direct-action" disabled={chameleonReason !== null}
      title={`Change this face to the most common face among your other dice. ${chameleonRemaining} of ${chameleonCapacity} Uses remaining.${chameleonReason ? ` Unavailable: ${chameleonReason}` : ''}`}
      aria-label={`Use Chameleon. ${chameleonRemaining} of ${chameleonCapacity} Uses remaining${chameleonReason ? `. Unavailable: ${chameleonReason}` : ''}`}
      data-action-remaining={chameleonRemaining} data-action-capacity={chameleonCapacity}
      data-testid={`chameleon-action-${die.id}`}
      style={capacityStyle('chameleon', chameleonRemaining, chameleonCapacity)}
      onClick={event => { event.stopPropagation(); submit(chameleonAction); }}>
      <span>USE</span><DieTypeIcon type="chameleon" size={16} />
    </Button>}
    {furnace && <Button size="compact-xs" variant="light" color="yellow"
      className="die-direct-action furnace-direct-action" disabled={furnaceReason !== null}
      title={`Spend 1 Gold to add to this Furnace reserve. ${furnaceRemaining} of ${CONFIG.furnaceMaxGoldPerRound} feeds remaining; ${furnaceRuntime?.furnacePips ?? 0} Pips reserved.${furnaceReason ? ` Unavailable: ${furnaceReason}` : ''}`}
      aria-label={`Feed Furnace 1 Gold. ${furnaceRemaining} of ${CONFIG.furnaceMaxGoldPerRound} feeds remaining. Reserve ${furnaceRuntime?.furnacePips ?? 0} Pips${furnaceReason ? `. Unavailable: ${furnaceReason}` : ''}`}
      data-action-remaining={furnaceRemaining} data-action-capacity={CONFIG.furnaceMaxGoldPerRound}
      data-testid={`furnace-action-${die.id}`}
      style={capacityStyle('furnace', furnaceRemaining, CONFIG.furnaceMaxGoldPerRound)}
      onClick={event => { event.stopPropagation(); submit(furnaceAction); }}>
      <span>FEED</span><DieTypeIcon type="furnace" size={16} />
    </Button>}
  </div>;
}
