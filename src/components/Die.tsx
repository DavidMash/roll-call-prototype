import { Badge, Paper, Text, Tooltip } from '@mantine/core';
import { activeFace, scoringPips } from '../game/dice';
import { ENHANCEMENTS, ENHANCEMENT_IDS, FACE_TYPE_LIMIT, faceEnhancementTypes } from '../game/enhancements';
import { activeFlameId, activeFlameInvestment, FLAMES } from '../game/flames';
import type { Die as PhysicalDie, Enhancement, Flame } from '../game/types';
import type { DiceDisplay } from '../uiSettings';
import { PipFace } from './PipFace';

interface Props {
  die: PhysicalDie;
  display: DiceDisplay;
  selected: boolean;
  highlighted: boolean;
  rolling: boolean;
  ability?: Enhancement;
  flameAbility?: Flame;
  disabled: boolean;
  wardenLocked?: boolean;
  wardenSelectable?: boolean;
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

export function Die({ die, display, selected, highlighted, rolling, ability, flameAbility, disabled, eligible,
  wardenLocked = false, wardenSelectable = false, unlockAt, ineligibleReason, lockedReason, allowIneligibleClick = false, showCapacity = false, onClick, onDropOffer }: Props) {
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
  const interactionDisabled = disabled || (wardenLocked && !wardenSelectable) || !!lockedReason || (!!ineligibleReason && !allowIneligibleClick);
  const capacity = faceEnhancementTypes(face).length;
  const dieLabel = die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`;
  const displayValue = face.rank;
  const temporaryState = face.snakeEyed ? ', Snake-Eyed Face' : face.infected ? ', Infected Face; 3 fewer Pips; Enhancements disabled'
    : face.magneticDestinationUsed && face.enhancements.magnetic ? ', Magnetic destination used this round' : '';
  const dieDetails = `${dieLabel}, face ${displayValue}, ${pips} Pips${temporaryState}${flameId ? `, Ember ${FLAMES[flameId].name}, ${flameInvestment} of 100 Gold` : ''}${enhancementSummary ? `, ${enhancementSummary}` : ''}`;
  const accessibilityLabel = wardenLocked
    ? `${dieDetails}, locked${unlockAt === undefined ? '' : ` until ${unlockAt} points`}${wardenSelectable ? ', selectable to unlock' : ''}`
    : `${dieDetails}${lockedReason ? `, required: ${lockedReason}` : ineligibleReason ? `, unavailable: ${ineligibleReason}` : ''}`;
  return <div className="die-wrap">
    <div className="ability-label" aria-hidden="true">{activeAbility.toUpperCase()}</div>
    <Paper component="button" type="button" withBorder
      className={`die ${die.owner === 'boss' ? 'cursed-die' : ''} ${face.snakeEyed ? 'snake-eyed-face' : ''} ${face.infected ? 'infected-face' : ''} ${face.magneticDestinationUsed ? 'magnetic-used' : ''} ${selected ? 'selected' : ''} ${highlighted ? 'scoring' : ''} ${rolling ? 'rolling' : ''} ${ability || flameAbility ? 'pulse' : ''} ${eligible ? 'eligible' : ''} ${ineligibleReason ? 'ineligible' : ''} ${lockedReason ? 'locked-selection' : ''} ${wardenLocked ? 'warden-locked' : ''}`}
      disabled={interactionDisabled} aria-disabled={interactionDisabled} aria-pressed={selected}
      title={wardenLocked ? `${dieLabel} locked${unlockAt === undefined ? '' : ` until ${unlockAt} points`}${wardenSelectable ? ' · choose to unlock' : ''}` : lockedReason ?? ineligibleReason}
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
        <span>{unlockAt === undefined ? 'SELECT' : `${unlockAt} PTS`}</span>
      </div>}
      {flameId && <Tooltip label={`Ember ${FLAMES[flameId].name}: ${flameInvestment}/100 Gold. ${FLAMES[flameId].description}`} multiline maw={320} withArrow>
        <Badge className="flame-badge" size="xs" color="orange" variant="light">🔥 {FLAMES[flameId].shortName} {flameInvestment}</Badge>
      </Tooltip>}
      {face.snakeEyed && <Badge className="boss-face-badge" size="xs" color="green">SNAKE EYES</Badge>}
      {face.infected && <Badge className="boss-face-badge" size="xs" color="red">INFECTED</Badge>}
      {display === 'pips'
        ? <PipFace value={displayValue} label={`${die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`} showing ${displayValue}`} />
        : <Text component="span" className="die-number" role="img" aria-label={`${die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`} showing ${displayValue}`}>{displayValue}</Text>}
      <div className={`die-face-status${showCapacity ? ' with-capacity' : ''}`}>
        {pips !== face.rank && <Text size="xs" c="teal" fw={700} className="die-pips">{pips} Pips</Text>}
        <div className="die-badges">
          {visibleEnhancements.map(id => {
            const count = face.enhancements[id]!;
            const label = BADGE_LABELS[id]?.(count) ?? `${ENHANCEMENTS[id].name}${count > 1 ? ` ×${count}` : ''}`;
            return <Tooltip key={id} label={`${ENHANCEMENTS[id].name}: ${ENHANCEMENTS[id].description}`} withArrow>
              <Badge size="xs" variant="light" color={id === 'magnetic' && face.magneticDestinationUsed ? 'gray' : id === 'golden' ? 'yellow' : id === 'jackpot' ? 'orange' : 'teal'}>{label}{id === 'magnetic' && face.magneticDestinationUsed ? ' · PULL USED' : ''}</Badge>
            </Tooltip>;
          })}
          {hiddenEnhancements.length > 0 && <Tooltip label={hiddenEnhancements.map(id => `${ENHANCEMENTS[id].name} ×${face.enhancements[id]}`).join(', ')} multiline maw={320} withArrow>
            <Badge size="xs" variant="outline" color="gray">+{hiddenEnhancements.length}</Badge>
          </Tooltip>}
        </div>
        {face.infected && enhancements.length > 0 && <Text size="xs" c="red" fw={800} className="disabled-enhancements">ENHANCEMENTS DISABLED</Text>}
      </div>
      {showCapacity && (capacity > 0 || eligible !== undefined) && <Text size="xs" c="dimmed" className="die-capacity">{capacity} / {FACE_TYPE_LIMIT}</Text>}
    </Paper>
  </div>;
}
