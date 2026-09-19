import { Badge, Paper, Text, Tooltip } from '@mantine/core';
import { activeFace, scoringPips } from '../game/dice';
import { ENHANCEMENTS, ENHANCEMENT_IDS } from '../game/enhancements';
import { FLAMES } from '../game/flames';
import type { Die as PhysicalDie, Enhancement, Flame } from '../game/types';

interface Props {
  die: PhysicalDie;
  selected: boolean;
  highlighted: boolean;
  rolling: boolean;
  ability?: Enhancement;
  flameAbility?: Flame;
  disabled: boolean;
  eligible?: boolean;
  onClick: () => void;
  onDropOffer?: (offerId: number) => void;
}

const BADGE_LABELS: Partial<Record<Enhancement, (count: number) => string>> = {
  bonus: count => `B+${count}`,
  multiplier: count => `×+${count}`,
  golden: count => `Gold${count > 1 ? ` ×${count}` : ''}`,
  workout: count => `Fit${count > 1 ? ` ×${count}` : ''}`,
};

export function Die({ die, selected, highlighted, rolling, ability, flameAbility, disabled, eligible, onClick, onDropOffer }: Props) {
  const face = activeFace(die);
  const enhancements = ENHANCEMENT_IDS.filter(id => face.enhancements[id])
    .sort((a, b) => face.enhancements[b]! - face.enhancements[a]!);
  const visibleEnhancements = enhancements.slice(0, 3);
  const hiddenEnhancements = enhancements.slice(3);
  const pips = scoringPips(face);
  const enhancementSummary = enhancements.map(id => `${ENHANCEMENTS[id].name} ×${face.enhancements[id]}`).join(', ');
  const activeAbility = flameAbility ? FLAMES[flameAbility].name : ability ? ENHANCEMENTS[ability].name : '';
  return <div className="die-wrap">
    <div className="ability-label" aria-hidden="true">{activeAbility.toUpperCase()}</div>
    <Paper component="button" type="button" withBorder
      className={`die ${selected ? 'selected' : ''} ${highlighted ? 'scoring' : ''} ${rolling ? 'rolling' : ''} ${ability || flameAbility ? 'pulse' : ''} ${eligible ? 'eligible' : ''}`}
      disabled={disabled} aria-pressed={selected}
      aria-label={`Die ${die.id + 1}, face ${die.value}, ${pips} scoring pips${die.flame ? `, Flame ${FLAMES[die.flame].name}` : ''}${enhancementSummary ? `, ${enhancementSummary}` : ''}`}
      onClick={onClick}
      onDragOver={event => { if (!disabled && onDropOffer) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
      onDrop={event => {
        event.preventDefault();
        if (disabled || !onDropOffer) return;
        const raw = event.dataTransfer.getData('application/x-roll-call-offer');
        if (raw !== '' && Number.isInteger(Number(raw))) onDropOffer(Number(raw));
      }}>
      <Text size="xs" c="dimmed" className="die-id">D{die.id + 1}</Text>
      {die.flame && <Tooltip label={`${FLAMES[die.flame].name}: ${FLAMES[die.flame].description}`} multiline maw={320} withArrow>
        <Badge className="flame-badge" size="xs" color="orange" variant="light">🔥 {FLAMES[die.flame].shortName}</Badge>
      </Tooltip>}
      <span className="die-number">{die.value}</span>
      {pips !== face.rank && <Text size="xs" c="teal" fw={700} className="die-pips">{pips} Pips</Text>}
      <div className="die-badges">
        {visibleEnhancements.map(id => {
          const count = face.enhancements[id]!;
          const label = BADGE_LABELS[id]?.(count) ?? `${ENHANCEMENTS[id].name}${count > 1 ? ` ×${count}` : ''}`;
          return <Tooltip key={id} label={`${ENHANCEMENTS[id].name}: ${ENHANCEMENTS[id].description}`} withArrow>
            <Badge size="xs" variant="light" color={id === 'golden' ? 'yellow' : id === 'jackpot' ? 'orange' : 'teal'}>{label}</Badge>
          </Tooltip>;
        })}
        {hiddenEnhancements.length > 0 && <Tooltip label={hiddenEnhancements.map(id => `${ENHANCEMENTS[id].name} ×${face.enhancements[id]}`).join(', ')} multiline maw={320} withArrow>
          <Badge size="xs" variant="outline" color="gray">+{hiddenEnhancements.length}</Badge>
        </Tooltip>}
      </div>
    </Paper>
  </div>;
}
