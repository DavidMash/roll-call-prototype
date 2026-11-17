import { Die } from './Die';
import type { CSSProperties, ReactNode } from 'react';
import type { Die as PhysicalDie, DieRoundState, GameEvent, Rank } from '../game/types';
import type { DiceDisplay } from '../uiSettings';

interface Props {
  dice: PhysicalDie[];
  rosterSlotById?: Record<number, number>;
  display: DiceDisplay;
  selected?: number[];
  event: GameEvent | null;
  disabled: boolean;
  eligibleIds?: number[];
  restrictToEligible?: boolean;
  ineligibleReasons?: Record<number, string>;
  actionableIneligibleIds?: number[];
  lockedIds?: number[];
  lockedReasons?: Record<number, string>;
  wardenLockedIds?: number[];
  wardenSelectableIds?: number[];
  wardenChoiceMode?: boolean;
  onClick: (dieId: number) => void;
  onDetails: (dieId: number) => void;
  detailsDisabled?: boolean;
  fetchTarget?: { dieId: number; physicalFace: Rank } | null;
  hotPotatoDieId?: number | null;
  onDropOffer?: (offerId: number, dieId: number) => void;
  directActionRows?: number;
  renderDirectActions?: (die: PhysicalDie) => ReactNode;
  roundState?: DieRoundState;
}
export function DiceRow({ dice, rosterSlotById = {}, display, selected = [], event, disabled, eligibleIds, restrictToEligible = false,
  ineligibleReasons = {}, actionableIneligibleIds = [], lockedIds = [], lockedReasons = {}, detailsDisabled = false,
  wardenLockedIds = [], wardenSelectableIds = [], wardenChoiceMode = false,
  onClick, onDetails, onDropOffer, fetchTarget, hotPotatoDieId, directActionRows = 0, renderDirectActions, roundState }: Props) {
  return <div className="dice-row" data-dice-count={dice.length}
    style={{ '--dice-columns': dice.length, '--die-action-rows': directActionRows } as CSSProperties}>{dice.map(die => {
    const involved = event?.dieIds?.includes(die.id) ?? false;
    const resolving = involved && (event?.type === 'DIE_PIPS_RESOLVED'
      || event?.type === 'HAND_XMULT_CHANGED' || event?.type === 'SPECIAL_DIE_EFFECT');
    const resolvedPips = event?.type === 'DIE_PIPS_RESOLVED' && event.resolvedDiePips?.dieId === die.id
      ? event.resolvedDiePips : undefined;
    return <Die key={die.id} die={die} rosterSlot={rosterSlotById[die.id]} display={display}
      roundRuntime={roundState?.[die.id]}
      fetchTarget={fetchTarget}
      pipsPop={resolvedPips && resolvedPips.totalPips > 0 ? { eventId: event!.id, amount: resolvedPips.totalPips } : undefined}
      hotPotato={hotPotatoDieId === die.id}
      selected={selected.includes(die.id)} highlighted={involved && event?.type !== 'DIE_ROLLED'}
      rolling={involved && event?.type === 'DICE_REROLL_STARTED'}
      resolving={resolving}
      ability={involved ? event?.dieType : undefined} flameAbility={involved ? event?.flame : undefined}
      disabled={disabled || (wardenChoiceMode && !wardenLockedIds.includes(die.id))} eligible={eligibleIds?.includes(die.id)}
      wardenLocked={wardenLockedIds.includes(die.id)} wardenSelectable={wardenSelectableIds.includes(die.id)}
      lockedReason={lockedIds.includes(die.id) ? lockedReasons[die.id] ?? 'This die is required.' : undefined}
      ineligibleReason={restrictToEligible && !eligibleIds?.includes(die.id) ? ineligibleReasons[die.id] ?? 'This face is not eligible.' : undefined}
      allowIneligibleClick={actionableIneligibleIds.includes(die.id)} onClick={() => onClick(die.id)}
      directActions={renderDirectActions?.(die)}
      detailsDisabled={detailsDisabled} onDetails={() => onDetails(die.id)}
      onDropOffer={onDropOffer ? offerId => onDropOffer(offerId, die.id) : undefined} />;
  })}</div>;
}
