import { Badge, Paper, Text, Tooltip } from '@mantine/core';
import { activeFace, scoringPips } from '../game/dice';
import { ENHANCEMENTS, ENHANCEMENT_IDS, FACE_TYPE_LIMIT, faceEnhancementTypes } from '../game/enhancements';
import { activeFlameId, activeFlameInvestment, FLAMES } from '../game/flames';
import type { Die as PhysicalDie, Enhancement, Flame } from '../game/types';
import { PipFace } from './PipFace';

interface Props {
  die: PhysicalDie;
  selected: boolean;
  highlighted: boolean;
  rolling: boolean;
  ability?: Enhancement;
  flameAbility?: Flame;
  disabled: boolean;
  unlockAt?: number;
  eligible?: boolean;
  ineligibleReason?: string;
  lockedReason?: string;
  allowIneligibleClick?: boolean;
  showCapacity?: boolean;
  onClick: () => void;
  onDropOffer?: (offerId: number) => void;
}

const BADGE_LABELS: Partial<Record<Enhancement, (count: number) => string>> = {
  bonus: count => `B+${count}`,
  golden: count => `Gold${count > 1 ? ` ×${count}` : ''}`,
  workout: count => `Fit${count > 1 ? ` ×${count}` : ''}`,
};

export function Die({ die, selected, highlighted, rolling, ability, flameAbility, disabled, eligible,
  unlockAt, ineligibleReason, lockedReason, allowIneligibleClick = false, showCapacity = false, onClick, onDropOffer }: Props) {
  const face = activeFace(die);
  const enhancements = ENHANCEMENT_IDS.filter(id => face.enhancements[id])
    .sort((a, b) => face.enhancements[b]! - face.enhancements[a]!);
  const visibleEnhancements = enhancements.slice(0, 3);
  const hiddenEnhancements = enhancements.slice(3);
  const pips = scoringPips(face);
  const flameId = activeFlameId(die.flame);
  const flameInvestment = activeFlameInvestment(die.flame);
  const enhancementSummary = enhancements.map(id => `${ENHANCEMENTS[id].name} ×${face.enhancements[id]}`).join(', ');
  const activeAbility = flameAbility ? FLAMES[flameAbility].name : ability ? ENHANCEMENTS[ability].name : '';
  const wardenLocked = unlockAt !== undefined;
  const interactionDisabled = disabled || wardenLocked || !!lockedReason || (!!ineligibleReason && !allowIneligibleClick);
  const capacity = faceEnhancementTypes(face).length;
  const dieLabel = die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`;
  const accessibilityLabel = wardenLocked
    ? `${dieLabel}, locked until ${unlockAt} points`
    : `${dieLabel}, face ${die.value}, ${pips} scoring pips${flameId ? `, Flame ${FLAMES[flameId].name}, ${flameInvestment} of 100 Gold` : ''}${enhancementSummary ? `, ${enhancementSummary}` : ''}${lockedReason ? `, required: ${lockedReason}` : ineligibleReason ? `, unavailable: ${ineligibleReason}` : ''}`;
  return <div className="die-wrap">
    <div className="ability-label" aria-hidden="true">{activeAbility.toUpperCase()}</div>
    <Paper component="button" type="button" withBorder
      className={`die ${die.owner === 'boss' ? 'cursed-die' : ''} ${selected ? 'selected' : ''} ${highlighted ? 'scoring' : ''} ${rolling ? 'rolling' : ''} ${ability || flameAbility ? 'pulse' : ''} ${eligible ? 'eligible' : ''} ${ineligibleReason ? 'ineligible' : ''} ${lockedReason ? 'locked-selection' : ''} ${wardenLocked ? 'warden-locked' : ''}`}
      disabled={disabled || wardenLocked} aria-disabled={interactionDisabled} aria-pressed={selected}
      title={wardenLocked ? `${dieLabel} locked until ${unlockAt} points` : lockedReason ?? ineligibleReason}
      aria-label={accessibilityLabel} data-locked-until={unlockAt}
      onClick={() => { if (!interactionDisabled) onClick(); }}
      onDragOver={event => { if (!interactionDisabled && onDropOffer) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
      onDrop={event => {
        event.preventDefault();
        if (interactionDisabled || !onDropOffer) return;
        const raw = event.dataTransfer.getData('application/x-roll-call-offer');
        if (raw !== '' && Number.isInteger(Number(raw))) onDropOffer(Number(raw));
      }}>
      <Text size="xs" c="dimmed" className="die-id">{die.owner === 'boss' ? 'CURSED' : `D${die.id + 1}`}</Text>
      {wardenLocked && <div className="die-lock-overlay" aria-hidden="true">
        <span className="die-lock-symbol">🔒</span>
        <span>{unlockAt} PTS</span>
      </div>}
      {flameId && <Tooltip label={`${FLAMES[flameId].name}: ${flameInvestment}/100 Gold. ${FLAMES[flameId].description}`} multiline maw={320} withArrow>
        <Badge className="flame-badge" size="xs" color="orange" variant="light">🔥 {FLAMES[flameId].shortName} {flameInvestment}</Badge>
      </Tooltip>}
      <PipFace value={die.value} label={`${die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`} showing ${die.value}`} />
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
      {showCapacity && (capacity > 0 || eligible !== undefined) && <Text size="xs" c="dimmed" className="die-capacity">{capacity} / {FACE_TYPE_LIMIT}</Text>}
    </Paper>
  </div>;
}
