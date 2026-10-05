import { Paper, Text } from '@mantine/core';
import { activeFace, scoringPips } from '../game/dice';
import { ENHANCEMENTS, ENHANCEMENT_IDS } from '../game/enhancements';
import { activeFlameId, activeFlameInvestment, FLAMES } from '../game/flames';
import type { Die as PhysicalDie, Enhancement, Flame } from '../game/types';
import type { DiceDisplay } from '../uiSettings';
import { PipFace } from './PipFace';
import { formatPlayerNumber } from '../game/copy';
import { ENHANCEMENT_ICONS } from './enhancementIcons';

interface Props {
  die: PhysicalDie;
  display: DiceDisplay;
  selected: boolean;
  highlighted: boolean;
  rolling: boolean;
  resolving?: boolean;
  ability?: Enhancement;
  flameAbility?: Flame;
  disabled: boolean;
  detailsDisabled?: boolean;
  wardenLocked?: boolean;
  wardenSelectable?: boolean;
  unlockAt?: number;
  eligible?: boolean;
  ineligibleReason?: string;
  lockedReason?: string;
  allowIneligibleClick?: boolean;
  onClick: () => void;
  onEnhancements: () => void;
  onFlame: (flame: Flame) => void;
  onDropOffer?: (offerId: number) => void;
}

export function Die({ die, display, selected, highlighted, rolling, resolving = false, ability, flameAbility, disabled, detailsDisabled = false, eligible,
  wardenLocked = false, wardenSelectable = false, unlockAt, ineligibleReason, lockedReason, allowIneligibleClick = false,
  onClick, onEnhancements, onFlame, onDropOffer }: Props) {
  const face = activeFace(die);
  const enhancements = ENHANCEMENT_IDS.filter(id => (face.enhancements[id] ?? 0) > 0)
    .sort((a, b) => (face.enhancements[b] ?? 0) - (face.enhancements[a] ?? 0));
  const pips = scoringPips(face);
  const flameId = activeFlameId(die.flame);
  const flameInvestment = activeFlameInvestment(die.flame);
  const enhancementSummary = enhancements.map(id => `${ENHANCEMENTS[id].name} ×${formatPlayerNumber(face.enhancements[id]!)}`).join(', ');
  const interactionDisabled = disabled || (wardenLocked && !wardenSelectable) || !!lockedReason || (!!ineligibleReason && !allowIneligibleClick);
  const dieLabel = die.owner === 'boss' ? 'Cursed Die' : `Die ${die.id + 1}`;
  const temporaryStates = [
    face.snakeEyed ? 'Snake-Eyed temporary face' : '',
    face.infected ? 'infected face; 3 fewer Pips; Enhancements disabled' : '',
    face.magneticSourceUsed && face.enhancements.magnetic ? 'Magnetic source pull used this Round' : '',
  ].filter(Boolean);
  const dieDetails = `${dieLabel}, face ${formatPlayerNumber(face.rank)}, ${formatPlayerNumber(pips)} Pips`
    + `${temporaryStates.length ? `, ${temporaryStates.join(', ')}` : ''}`
    + `${flameId ? `, Ember ${FLAMES[flameId].name}, ${formatPlayerNumber(flameInvestment)} of 100 Gold` : ''}`
    + `${enhancementSummary ? `, ${enhancementSummary}` : ''}`;
  const accessibilityLabel = wardenLocked
    ? `${dieDetails}, locked${unlockAt === undefined ? '' : ` until ${formatPlayerNumber(unlockAt)} points`}${wardenSelectable ? ', selectable to unlock' : ''}`
    : `${dieDetails}${lockedReason ? `, required: ${lockedReason}` : ineligibleReason ? `, unavailable: ${ineligibleReason}` : ''}`;
  const triggered = ability || flameAbility;

  return <div className={`die-wrap die-slot${detailsDisabled ? ' details-disabled' : ''}`} data-die-id={die.id}
    data-tutorial={die.owner === 'player' ? `die-${die.id + 1}` : undefined}
    data-testid={die.owner === 'player' ? `flame-die-${die.id}` : 'cursed-die-slot'}>
    <div className="die-flame-zone">
      {flameId && <button type="button" className="die-flame-cap" disabled={detailsDisabled} data-tutorial="flame-cap"
        data-testid={`active-flame-${flameId}`}
        aria-label={`View ${FLAMES[flameId].name} Flame details, Ember at ${formatPlayerNumber(flameInvestment)} of 100 Gold`}
        onClick={() => onFlame(flameId)}>
        <span aria-hidden="true">🔥</span><span>{FLAMES[flameId].shortName}</span><strong>· {formatPlayerNumber(flameInvestment)}</strong>
      </button>}
    </div>
    <Paper component="button" type="button" withBorder
      className={`die ${die.owner === 'boss' ? 'cursed-die' : ''} ${face.snakeEyed ? 'snake-eyed-face' : ''} ${face.infected ? 'infected-face' : ''} ${face.magneticSourceUsed ? 'magnetic-used' : ''} ${selected ? 'selected' : ''} ${highlighted ? 'scoring' : ''} ${rolling ? 'rolling' : ''} ${resolving ? 'resolving' : ''} ${triggered ? 'pulse' : ''} ${eligible ? 'eligible' : ''} ${ineligibleReason ? 'ineligible' : ''} ${lockedReason ? 'locked-selection' : ''} ${wardenLocked ? 'warden-locked' : ''}`}
      disabled={interactionDisabled} aria-disabled={interactionDisabled} aria-pressed={selected}
      title={wardenLocked ? `${dieLabel} locked${unlockAt === undefined ? '' : ` until ${formatPlayerNumber(unlockAt)} points`}${wardenSelectable ? ' · choose to unlock' : ''}` : lockedReason ?? ineligibleReason}
      aria-label={accessibilityLabel} data-locked-until={unlockAt} data-resolving={resolving || undefined}
      onClick={() => { if (!interactionDisabled) onClick(); }}
      onDragOver={event => { if (!interactionDisabled && onDropOffer) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
      onDrop={event => {
        event.preventDefault();
        if (interactionDisabled || !onDropOffer) return;
        const raw = event.dataTransfer.getData('application/x-roll-call-offer');
        if (raw !== '' && Number.isInteger(Number(raw))) onDropOffer(Number(raw));
      }}>
      <Text size="xs" c="dimmed" className="die-id">{die.owner === 'boss' ? 'CURSED' : `D${die.id + 1}`}</Text>
      {wardenLocked && <div className="die-lock-overlay" aria-hidden="true"><span>🔒</span><span>{unlockAt === undefined ? 'SELECT' : `${formatPlayerNumber(unlockAt)} PTS`}</span></div>}
      {face.snakeEyed && <span className="boss-face-badge" aria-hidden="true" title="Snake Eyes">S</span>}
      {face.infected && <span className="boss-face-badge infected" aria-hidden="true" title="Infected">!</span>}
      {face.magneticSourceUsed && <span className="die-state-dot" aria-hidden="true" title="Magnetic pull used">●</span>}
      {display === 'pips'
        ? <PipFace value={face.rank} label={`${dieLabel} showing ${face.rank}`} />
        : <Text component="span" className="die-number" role="img" aria-label={`${dieLabel} showing ${face.rank}`}>{face.rank}</Text>}
    </Paper>
    <button type="button" className={`die-enhancement-strip${enhancements.length ? '' : ' empty'}`} disabled={detailsDisabled}
      aria-label={`View Enhancements on ${die.owner === 'boss' ? 'Cursed Die' : `D${die.id + 1}`} face ${face.rank}${enhancementSummary ? `: ${enhancementSummary}` : ': none'}`}
      onClick={onEnhancements}>
      {enhancements.length ? enhancements.slice(0, 3).map(id => <span key={id} className={`enhancement-icon enhancement-${id}${face.infected ? ' disabled' : ''}`}
        title={`${ENHANCEMENTS[id].name}${face.enhancements[id]! > 1 ? ` ×${face.enhancements[id]}` : ''}`}>
        <span aria-hidden="true">{ENHANCEMENT_ICONS[id]}</span>{face.enhancements[id]! > 1 && <strong>×{formatPlayerNumber(face.enhancements[id]!)}</strong>}
      </span>) : <span className="enhancement-strip-empty" aria-hidden="true">· · ·</span>}
    </button>
  </div>;
}
