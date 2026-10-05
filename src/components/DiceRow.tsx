import { Die } from './Die';
import { Tooltip } from '@mantine/core';
import type { CSSProperties } from 'react';
import type { Die as PhysicalDie, Flame, GameEvent } from '../game/types';
import type { DiceDisplay } from '../uiSettings';

interface Props {
  dice: PhysicalDie[];
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
  lockedUntilByDieId?: Record<number, number>;
  wardenLockedIds?: number[];
  wardenSelectableIds?: number[];
  wardenChoiceMode?: boolean;
  onClick: (dieId: number) => void;
  onEnhancements: (dieId: number) => void;
  onFlame: (dieId: number, flame: Flame) => void;
  detailsDisabled?: boolean;
  onDropOffer?: (offerId: number, dieId: number) => void;
  tutorialDieId?: number | null;
  tutorialLabel?: React.ReactNode;
}
export function DiceRow({ dice, display, selected = [], event, disabled, eligibleIds, restrictToEligible = false,
  ineligibleReasons = {}, actionableIneligibleIds = [], lockedIds = [], lockedReasons = {}, lockedUntilByDieId = {}, detailsDisabled = false,
  wardenLockedIds = [], wardenSelectableIds = [], wardenChoiceMode = false,
  onClick, onEnhancements, onFlame, onDropOffer, tutorialDieId, tutorialLabel }: Props) {
  return <div className="dice-row" data-dice-count={dice.length}
    style={{ '--dice-columns': dice.length } as CSSProperties}>{dice.map(die => {
    const involved = event?.dieIds?.includes(die.id) ?? false;
    const rendered = <Die key={die.id} die={die} display={display}
      selected={selected.includes(die.id)} highlighted={involved && event?.type !== 'DIE_ROLLED'}
      rolling={involved && (event?.type === 'DICE_REROLL_STARTED' || event?.type === 'DIE_ROLLED')}
      ability={involved ? event?.enhancement : undefined} flameAbility={involved ? event?.flame : undefined}
      disabled={disabled || (wardenChoiceMode && !wardenLockedIds.includes(die.id))} eligible={eligibleIds?.includes(die.id)}
      wardenLocked={wardenLockedIds.includes(die.id)} wardenSelectable={wardenSelectableIds.includes(die.id)}
      unlockAt={lockedUntilByDieId[die.id]}
      lockedReason={lockedIds.includes(die.id) ? lockedReasons[die.id] ?? 'This die is required.' : undefined}
      ineligibleReason={restrictToEligible && !eligibleIds?.includes(die.id) ? ineligibleReasons[die.id] ?? 'This face is not eligible.' : undefined}
      allowIneligibleClick={actionableIneligibleIds.includes(die.id)} onClick={() => onClick(die.id)}
      detailsDisabled={detailsDisabled} onEnhancements={() => onEnhancements(die.id)} onFlame={flame => onFlame(die.id, flame)}
      onDropOffer={onDropOffer ? offerId => onDropOffer(offerId, die.id) : undefined} />;
    return tutorialDieId === die.id ? <Tooltip key={`tutorial-${die.id}`} opened label={tutorialLabel} multiline maw={320}
      position="top" withArrow withinPortal><span className="flame-tutorial-anchor">{rendered}</span></Tooltip> : rendered;
  })}</div>;
}
