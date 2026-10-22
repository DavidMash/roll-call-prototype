import { Paper, Text } from '@mantine/core';
import { activeFace, scoringPips } from '../game/dice';
import type { Die as PhysicalDie, DieType, Flame, Rank } from '../game/types';
import type { DiceDisplay } from '../uiSettings';
import { PipFace } from './PipFace';
import { formatExactScore, formatPlayerNumber } from '../game/copy';
import type { ExactScore } from '../game/scoreMath';
import { DieEffectsLabel, diePresentationStyle } from './DieTypeLabel';
import { SPECIAL_DICE } from '../game/specialDice';

interface Props {
  die: PhysicalDie;
  rosterSlot?: number;
  display: DiceDisplay;
  selected: boolean;
  highlighted: boolean;
  rolling: boolean;
  resolving?: boolean;
  ability?: DieType;
  flameAbility?: Flame;
  disabled: boolean;
  detailsDisabled?: boolean;
  wardenLocked?: boolean;
  wardenSelectable?: boolean;
  unlockAt?: ExactScore;
  eligible?: boolean;
  ineligibleReason?: string;
  lockedReason?: string;
  allowIneligibleClick?: boolean;
  onClick: () => void;
  onDetails: () => void;
  onDropOffer?: (offerId: number) => void;
  fetchTarget?: { dieId: number; physicalFace: Rank } | null;
}

export function Die({ die, rosterSlot, display, selected, highlighted, rolling, resolving = false, ability, flameAbility, disabled,
  detailsDisabled = false, eligible, wardenLocked = false, wardenSelectable = false, unlockAt, ineligibleReason,
  lockedReason, allowIneligibleClick = false, onClick, onDetails, onDropOffer, fetchTarget }: Props) {
  const face = activeFace(die);
  const pips = scoringPips(face);
  const mutation = face.bossMutation;
  const interactionDisabled = disabled || (wardenLocked && !wardenSelectable) || !!lockedReason
    || (!!ineligibleReason && !allowIneligibleClick);
  const playerLabel = `D${(rosterSlot ?? 0) + 1}`;
  const dieLabel = die.owner === 'boss' ? 'Cursed Die' : `Die ${(rosterSlot ?? 0) + 1}`;
  const temporaryState = mutation?.kind === 'snakeEyes' ? 'Snake-Eyed temporary face'
    : mutation?.kind === 'infected' ? 'infected face; die effects suppressed' : '';
  const isFetchTarget = fetchTarget?.dieId === die.id && fetchTarget.physicalFace === die.value;
  const collectible = die.owner === 'player' ? die : null;
  const specialName = collectible?.effects.map(effect => SPECIAL_DICE[effect.type].name).join(' + ') || null;
  const effectSuppressed = mutation?.kind === 'infected' && !!collectible?.effects.length;
  const hasDetails = die.owner === 'boss' || !!collectible?.effects.length || mutation !== undefined || isFetchTarget;
  const dieDetails = `${dieLabel}, face ${formatPlayerNumber(face.rank)}, ${formatPlayerNumber(pips)} Pips`
    + `${temporaryState ? `, ${temporaryState}` : ''}${isFetchTarget ? ', Fetch target' : ''}`;
  const accessibilityLabel = wardenLocked
    ? `${dieDetails}, locked${unlockAt === undefined ? '' : ` until ${formatExactScore(unlockAt)} points`}${wardenSelectable ? ', selectable to unlock' : ''}`
    : `${dieDetails}${lockedReason ? `, required: ${lockedReason}` : ineligibleReason ? `, unavailable: ${ineligibleReason}` : ''}`;
  const triggered = ability || flameAbility;

  return <div className={`die-wrap die-slot${detailsDisabled ? ' details-disabled' : ''}${effectSuppressed ? ' effect-suppressed' : ''}`} data-die-id={die.id}
    data-tutorial={die.owner === 'player' ? `die-${(rosterSlot ?? 0) + 1}` : undefined}
    data-testid={die.owner === 'player' ? `flame-die-${die.id}` : 'cursed-die-slot'}>
    <Paper component="button" type="button" withBorder
      className={`die die-selection-target ${die.owner === 'boss' ? 'cursed-die' : ''}${specialName ? ' special-die' : ''} ${mutation?.kind === 'snakeEyes' ? 'snake-eyed-face' : ''} ${mutation?.kind === 'infected' ? 'infected-face' : ''}${selected ? ' selected is-die-selected' : ''} ${highlighted ? 'scoring' : ''} ${rolling ? 'rolling' : ''} ${resolving ? 'resolving' : ''} ${triggered ? 'pulse' : ''} ${eligible ? 'eligible' : ''} ${ineligibleReason ? 'ineligible' : ''} ${lockedReason ? 'locked-selection' : ''} ${wardenLocked ? 'warden-locked' : ''}`}
      style={collectible ? diePresentationStyle(collectible) : undefined} data-effect-count={collectible?.effects.length ?? undefined}
      disabled={interactionDisabled} aria-disabled={interactionDisabled} aria-pressed={selected}
      title={wardenLocked ? `${dieLabel} locked${unlockAt === undefined ? '' : ` until ${formatExactScore(unlockAt)} points`}${wardenSelectable ? ' · choose to unlock' : ''}` : lockedReason ?? ineligibleReason}
      aria-label={accessibilityLabel} data-locked-until={unlockAt?.toString()} data-resolving={resolving || undefined}
      onClick={() => { if (!interactionDisabled) onClick(); }}
      onDragOver={event => { if (!interactionDisabled && onDropOffer) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
      onDrop={event => {
        event.preventDefault();
        if (interactionDisabled || !onDropOffer) return;
        const raw = event.dataTransfer.getData('application/x-roll-call-offer');
        if (raw !== '' && Number.isInteger(Number(raw))) onDropOffer(Number(raw));
      }}>
      <Text size="xs" c="dimmed" className="die-id">{die.owner === 'boss' ? 'CURSED' : playerLabel}</Text>
      {wardenLocked && <div className="die-lock-overlay" aria-hidden="true"><span>🔒</span><span>{unlockAt === undefined ? 'SELECT' : `${formatExactScore(unlockAt)} PTS`}</span></div>}
      {mutation?.kind === 'snakeEyes' && <span className="boss-face-badge" aria-hidden="true" title="Snake Eyes">S</span>}
      {mutation?.kind === 'infected' && <span className="boss-face-badge infected" aria-hidden="true" title="Infected">!</span>}
      {isFetchTarget && <span className="fetch-face-badge" aria-hidden="true" title="Fetch target">FETCH</span>}
      {display === 'pips'
        ? <PipFace value={face.rank} label={`${dieLabel} showing ${face.rank}`} />
        : <Text component="span" className="die-number" role="img" aria-label={`${dieLabel} showing ${face.rank}`}>{face.rank}</Text>}
    </Paper>
    {hasDetails ? <button type="button" className={`die-face-details${specialName ? ' special' : ' normal'}`} disabled={detailsDisabled}
      aria-label={`View details for ${die.owner === 'boss' ? 'Cursed Die' : specialName ?? playerLabel}`} onClick={onDetails}>
      {die.owner === 'boss' ? 'CURSED' : collectible && collectible.effects.length
        ? <DieEffectsLabel effects={collectible.effects} compact /> : <span className="normal-die-details-mark" aria-hidden="true">!</span>}
      {effectSuppressed && <span className="visually-hidden"> · special effect suppressed</span>}
    </button> : <span className="die-details-placeholder" aria-hidden="true" />}
  </div>;
}
