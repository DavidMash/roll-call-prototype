import { Die } from './Die';
import { Tooltip } from '@mantine/core';
import type { CSSProperties } from 'react';
import type { Die as PhysicalDie, GameEvent } from '../game/types';

interface Props {
  dice: PhysicalDie[];
  selected?: number[];
  event: GameEvent | null;
  disabled: boolean;
  eligibleIds?: number[];
  restrictToEligible?: boolean;
  ineligibleReasons?: Record<number, string>;
  actionableIneligibleIds?: number[];
  showCapacity?: boolean;
  onClick: (dieId: number) => void;
  onDropOffer?: (offerId: number, dieId: number) => void;
  tutorialDieId?: number | null;
  tutorialLabel?: React.ReactNode;
}
export function DiceRow({ dice, selected = [], event, disabled, eligibleIds, restrictToEligible = false,
  ineligibleReasons = {}, actionableIneligibleIds = [], showCapacity = false, onClick, onDropOffer, tutorialDieId, tutorialLabel }: Props) {
  return <div className="dice-row" style={{ '--dice-columns': Math.min(5, dice.length) } as CSSProperties}>{dice.map(die => {
    const involved = event?.dieIds?.includes(die.id) ?? false;
    const rendered = <Die key={`${die.id}:${involved && event?.enhancement ? event.id : 'idle'}`} die={die}
      selected={selected.includes(die.id)} highlighted={involved && event?.type !== 'DIE_ROLLED'}
      rolling={involved && (event?.type === 'DICE_REROLL_STARTED' || event?.type === 'DIE_ROLLED')}
      ability={involved ? event?.enhancement : undefined} flameAbility={involved ? event?.flame : undefined}
      disabled={disabled} eligible={eligibleIds?.includes(die.id)}
      ineligibleReason={restrictToEligible && !eligibleIds?.includes(die.id) ? ineligibleReasons[die.id] ?? 'This face is not eligible.' : undefined}
      allowIneligibleClick={actionableIneligibleIds.includes(die.id)} showCapacity={showCapacity} onClick={() => onClick(die.id)}
      onDropOffer={onDropOffer ? offerId => onDropOffer(offerId, die.id) : undefined} />;
    return tutorialDieId === die.id ? <Tooltip key={`tutorial-${die.id}`} opened label={tutorialLabel} multiline maw={320}
      position="top" withArrow withinPortal><span className="flame-tutorial-anchor">{rendered}</span></Tooltip> : rendered;
  })}</div>;
}
