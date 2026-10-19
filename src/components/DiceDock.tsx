import { Button, Group, Paper, Text } from '@mantine/core';
import { validateAction } from '../game/engine';
import { hasOwnedChargeFlame } from '../game/flames';
import { activeEncounterDice } from '../game/bosses';
import { normalizeBoardSelection, toggleBoardDie } from '../game/selection';
import type { Selection } from '../game/selection';
import type { Action, Board, GameEvent } from '../game/types';
import type { DiceDisplay } from '../uiSettings';
import { DiceRow } from './DiceRow';
import type { FaceDetailsTarget } from './FaceDetailsModal';
import type { FlameDetailsTarget } from './FlameDetailsModal';
import { formatPlayerNumber } from '../game/copy';

export function DiceDock({ board, event, busy, actionsEnabled, cinematic, display, selection, setSelection,
  selectedFlameOffer: _selectedFlameOffer, submit, openFaceDetails, openFlameDetails: _openFlameDetails }: {
  board: Board;
  event: GameEvent | null;
  busy: boolean;
  actionsEnabled: boolean;
  cinematic: boolean;
  display: DiceDisplay;
  selection: Selection;
  setSelection: (selection: Selection) => void;
  selectedOffer?: number | null;
  setSelectedOffer?: (id: number | null) => void;
  selectedFlameOffer: number | null;
  submit: (action: Action) => void;
  openFaceDetails: (target: FaceDetailsTarget) => void;
  openFlameDetails: (target: FlameDetailsTarget) => void;
}) {
  const wardenBoss = board.phase === 'round' && !board.bossSilenced && board.boss?.type === 'warden' ? board.boss : null;
  const rosterProjection = board.dice.filter(die => die.owner === 'player');
  const rosterSlotById = Object.fromEntries(rosterProjection.map((die, slot) => [die.id, slot]));
  const wardenDice = wardenBoss ? rosterProjection : null;
  const dice = board.bustPresentationDice ? board.dice
    : board.phase === 'round' ? wardenDice ?? activeEncounterDice(board) : board.dice.filter(die => die.owner === 'player');
  const wardenLockedIds = wardenBoss && wardenDice ? wardenDice.filter(die => !wardenBoss.activeDieIds.includes(die.id)).map(die => die.id) : [];
  const awaitingWardenChoice = !!wardenBoss && wardenBoss.pendingReinforcements > 0;
  const selectedWardenDieId = awaitingWardenChoice && selection.dieIds.length === 1 && wardenLockedIds.includes(selection.dieIds[0])
    ? selection.dieIds[0] : null;
  const effectiveSelection = board.phase === 'round' && !awaitingWardenChoice
    ? normalizeBoardSelection(board, selection) : { dieIds: [], hand: null } satisfies Selection;
  const lockedUntilByDieId = wardenBoss?.nextUnlockTarget === null || wardenBoss?.nextUnlockTarget === undefined
    ? undefined : Object.fromEntries(wardenLockedIds.map(id => [id, wardenBoss.nextUnlockTarget!]));
  const chargeAction: Action = { type: 'TOGGLE_CHARGE', hand: effectiveSelection.hand, dieIds: effectiveSelection.dieIds };
  const canToggleCharge = validateAction(board, chargeAction) === null;
  const chargeAtMax = board.chargeXMult >= board.maxCharge - 1e-9;

  function changeRoundSelection(next: Selection) {
    setSelection(next);
  }
  function clickDie(dieId: number) {
    const die = board.dice.find(item => item.id === dieId);
    if (!die || !actionsEnabled) return;
    if (board.phase === 'round') {
      if (awaitingWardenChoice) setSelection({ dieIds: selectedWardenDieId === dieId ? [] : [dieId], hand: null });
      else changeRoundSelection(toggleBoardDie(board, effectiveSelection, dieId));
      return;
    }
    if (board.phase === 'shop') {
      openFaceDetails({ dieId, face: die.value });
      return;
    }
  }
  function openDetails(dieId: number) {
    const die = board.dice.find(item => item.id === dieId);
    if (die) openFaceDetails({ dieId, face: die.value });
  }

  return <>
    <Paper component="section" p="xs" className={`dice-dock gameplay-dock${cinematic ? ' cinematic' : ''}`} data-tutorial="dice-dock"
      data-testid="dice-dock" data-phase={board.phase} data-cinematic={cinematic || undefined}
      aria-label="Persistent Dice Dock">
      {board.phase === 'round' && hasOwnedChargeFlame(board) && <Group
        className={`charge-controls charge-dock-controls${chargeAtMax ? ' is-max' : ''}${board.chargeArmed ? ' is-armed' : ''}`}
        gap="xs" justify="space-between" wrap="nowrap" data-testid="charge-dock-controls">
        <Text size="xs" fw={800} className="charge-status" component="div">
          <span className="charge-status-main" data-testid="charge-status">{board.chargeArmed
            ? `⚡ ×${formatPlayerNumber(board.chargeXMult)} ARMED`
            : chargeAtMax ? `⚡ MAX CHARGE ×${formatPlayerNumber(board.maxCharge)}`
              : `CHARGE ×${formatPlayerNumber(board.chargeXMult)} / ×${formatPlayerNumber(board.maxCharge)}`}</span>
        </Text>
        <Button className={`charge-action${chargeAtMax ? ' is-max' : ''}`} size="compact-xs"
          color={board.chargeArmed ? 'orange' : 'yellow'} variant={board.chargeArmed || chargeAtMax ? 'filled' : 'light'}
          disabled={busy || !actionsEnabled || !canToggleCharge} onClick={() => submit(chargeAction)}>
          {board.chargeArmed ? 'DISARM' : 'ARM CHARGE'}
        </Button>
      </Group>}
      <DiceRow dice={dice} display={display} event={event} disabled={busy || !actionsEnabled}
        rosterSlotById={rosterSlotById}
        fetchTarget={board.fetchTarget}
        detailsDisabled={cinematic} selected={selectedWardenDieId === null ? effectiveSelection.dieIds : [selectedWardenDieId]}
        eligibleIds={undefined}
        wardenLockedIds={wardenLockedIds} wardenSelectableIds={awaitingWardenChoice ? wardenLockedIds : []}
        wardenChoiceMode={awaitingWardenChoice}
        lockedUntilByDieId={lockedUntilByDieId}
        onClick={clickDie} onDetails={openDetails} />
    </Paper>
  </>;
}
