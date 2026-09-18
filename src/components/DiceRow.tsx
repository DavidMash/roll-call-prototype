import { Die } from './Die';
import type { Die as PhysicalDie, GameEvent } from '../game/types';

interface Props {
  dice: PhysicalDie[];
  selected?: number[];
  event: GameEvent | null;
  disabled: boolean;
  eligibleIds?: number[];
  onClick: (dieId: number) => void;
  onDropOffer?: (offerId: number, dieId: number) => void;
  showSustainableSpent?: boolean;
}
export function DiceRow({ dice, selected = [], event, disabled, eligibleIds, onClick, onDropOffer, showSustainableSpent }: Props) {
  return <div className="dice-row">{dice.map(die => {
    const involved = event?.dieIds?.includes(die.id) ?? false;
    return <Die key={`${die.id}:${involved && event?.enhancement ? event.id : 'idle'}`} die={die}
      selected={selected.includes(die.id)} highlighted={involved && event?.type !== 'DIE_ROLLED'}
      rolling={involved && (event?.type === 'DICE_REROLL_STARTED' || event?.type === 'DIE_ROLLED')}
      ability={involved ? event?.enhancement : undefined} disabled={disabled}
      showSustainableSpent={showSustainableSpent}
      eligible={eligibleIds?.includes(die.id)} onClick={() => onClick(die.id)}
      onDropOffer={onDropOffer ? offerId => onDropOffer(offerId, die.id) : undefined} />;
  })}</div>;
}
