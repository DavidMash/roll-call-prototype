import { Badge, Paper, Text, Tooltip } from '@mantine/core';
import { activeFace, scoringPips } from '../game/dice';
import { ENHANCEMENTS, ENHANCEMENT_IDS } from '../game/enhancements';
import type { Die as PhysicalDie, Enhancement } from '../game/types';

interface Props {
  die: PhysicalDie;
  selected: boolean;
  highlighted: boolean;
  rolling: boolean;
  ability?: Enhancement;
  disabled: boolean;
  eligible?: boolean;
  onClick: () => void;
  onDropOffer?: (offerId: number) => void;
  showSustainableSpent?: boolean;
}
export function Die({ die, selected, highlighted, rolling, ability, disabled, eligible, onClick, onDropOffer, showSustainableSpent }: Props) {
  const face = activeFace(die);
  const enhancements = ENHANCEMENT_IDS.filter(id => face.enhancements[id]);
  return (
    <div className="die-wrap">
      <div className="ability-label" aria-hidden="true">{ability ? ENHANCEMENTS[ability].name.toUpperCase() : ''}</div>
      <Paper
        component="button" type="button" withBorder
        className={`die ${selected ? 'selected' : ''} ${highlighted ? 'scoring' : ''} ${rolling ? 'rolling' : ''} ${ability ? 'pulse' : ''} ${eligible ? 'eligible' : ''}`}
        disabled={disabled} aria-pressed={selected}
        aria-label={`Die ${die.id + 1}, face ${die.value}, ${scoringPips(face)} scoring pips`}
        onClick={onClick}
        onDragOver={event => { if (!disabled && onDropOffer) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
        onDrop={event => {
          event.preventDefault();
          if (disabled || !onDropOffer) return;
          const raw = event.dataTransfer.getData('application/x-roll-call-offer');
          if (raw !== '' && Number.isInteger(Number(raw))) onDropOffer(Number(raw));
        }}
      >
        <Text size="xs" c="dimmed">DIE {die.id + 1}</Text>
        <span className="die-number">{die.value}</span>
        <Text size="xs" c="dimmed">{scoringPips(face)} scoring pips</Text>
        <div className="die-badges">
          {enhancements.map(id => <Tooltip key={id} label={ENHANCEMENTS[id].description} withArrow>
            <Badge size="xs" variant="light" color={id === 'golden' ? 'yellow' : 'teal'}
              className={showSustainableSpent && id === 'sustainable' && face.sustainableUsedThisRound ? 'sustainable-spent' : undefined}>
              {ENHANCEMENTS[id].name}{face.enhancements[id]! > 1 ? ` ×${face.enhancements[id]}` : ''}
              {showSustainableSpent && id === 'sustainable' && face.sustainableUsedThisRound ? ' · spent' : ''}
            </Badge>
          </Tooltip>)}
        </div>
      </Paper>
    </div>
  );
}
