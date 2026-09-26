import { Alert, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { validateAction } from '../game/engine';
import { activeFlameInvestment, captureHandStart, composeXMult, handXMultContributions, hasXMultFlame, hotStreakMultiplier, targetPracticeMultiplier } from '../game/flames';
import { handOptions, hasPlayableHand, HANDS } from '../game/hands';
import { handScore } from '../game/scoring';
import { canPlay, selectHand, toggleDie } from '../game/selection';
import type { Selection } from '../game/selection';
import type { Action, Board, GameEvent } from '../game/types';
import { DiceRow } from './DiceRow';
import { HandScorecard } from './HandList';
import { ScoreResolution } from './ScoreResolution';
import { activeEncounterDice, requiredEncounterDieIds, unavailableEncounterHands } from '../game/bosses';
import { BossPanel } from './BossPanel';
import { CONFIG } from '../game/config';
import type { DiceDisplay } from '../uiSettings';

export function RoundScreen({ board, event, busy, progress, diceDisplay, selection, setSelection, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean; progress: { current: number; total: number };
  diceDisplay: DiceDisplay;
  selection: Selection; setSelection: (selection: Selection) => void; submit: (action: Action) => void; skip: () => void;
}) {
  const encounterDice = activeEncounterDice(board);
  const wardenBoss = board.boss?.type === 'warden' ? board.boss : null;
  const wardenDice = wardenBoss
    ? board.dice.filter(die => die.owner === 'player').sort((a, b) => a.id - b.id)
    : null;
  const wardenLockedIds = wardenBoss && wardenDice
    ? wardenDice.filter(die => !wardenBoss.activeDieIds.includes(die.id)).map(die => die.id)
    : [];
  const awaitingWardenChoice = !!wardenBoss && wardenBoss.pendingReinforcements > 0;
  const nextWardenThreshold = wardenBoss?.nextUnlockTarget ?? undefined;
  const lockedUntilByDieId: Record<number, number> = {};
  if (nextWardenThreshold !== undefined) wardenLockedIds.forEach(id => { lockedUntilByDieId[id] = nextWardenThreshold; });
  const requiredDieIds = requiredEncounterDieIds(board);
  const unavailableHands = unavailableEncounterHands(board);
  const selectedWardenDieId = awaitingWardenChoice && selection.dieIds.length === 1 && wardenLockedIds.includes(selection.dieIds[0])
    ? selection.dieIds[0] : null;
  const selectedDieIds = awaitingWardenChoice ? [] : [...selection.dieIds].sort((a, b) => a - b);
  const selectedHand = selection.hand && handOptions(encounterDice, unavailableHands, selectedDieIds)
    .some(option => option.id === selection.hand && !option.consumed
      && option.combinations.some(set => requiredDieIds.every(id => set.includes(id)))) ? selection.hand : null;
  const effectiveSelection: Selection = { dieIds: selectedDieIds, hand: selectedHand };
  const valid = canPlay(encounterDice, unavailableHands, effectiveSelection, requiredDieIds)
    && validateAction(board, { type: 'PLAY', hand: effectiveSelection.hand!, dieIds: effectiveSelection.dieIds }) === null;
  const showXMult = hasXMultFlame(encounterDice, board.bonfires);
  const preview = valid ? (() => {
    const hand = effectiveSelection.hand!;
    const base = handScore(encounterDice, hand, effectiveSelection.dieIds, board.handLevels[hand]);
    const contributions = handXMultContributions(captureHandStart(board, hand), hand, board.handLevels[hand], effectiveSelection.dieIds);
    const xMult = composeXMult(contributions);
    const bossFactor = board.boss?.type === 'fly' && !board.boss.caught && hand !== board.boss.flyHand ? .5 : 1;
    return { ...base, hasXMult: contributions.length > 0, effectiveXMult: Number((xMult * bossFactor).toFixed(12)) };
  })() : null;
  const manualAction: Action = { type: 'MANUAL_REROLL', dieIds: effectiveSelection.dieIds };
  const canReroll = validateAction(board, manualAction) === null;
  const deadBoard = !hasPlayableHand(encounterDice, unavailableHands, requiredDieIds);
  const hotFlame = board.dice.find(die => die.flame?.id === 'hotStreak')?.flame;
  const hotInvestment = board.bonfires.includes('hotStreak') ? 100 : activeFlameInvestment(hotFlame);
  const targetFlame = board.dice.find(die => die.flame?.id === 'targetPractice')?.flame;
  const targetInvestment = board.bonfires.includes('targetPractice') ? 100 : activeFlameInvestment(targetFlame);
  const idleText = effectiveSelection.hand
    ? `${HANDS[effectiveSelection.hand].name} · ${effectiveSelection.dieIds.length} ${effectiveSelection.dieIds.length === 1 ? 'die' : 'dice'} selected`
    : effectiveSelection.dieIds.length ? `${effectiveSelection.dieIds.length} ${effectiveSelection.dieIds.length === 1 ? 'die' : 'dice'} selected` : undefined;
  return <Stack gap="xs" className="round-screen">
    <div className="live-score-panel" data-testid="live-score-panel">
      <ScoreResolution event={event} busy={busy} {...progress} onSkip={skip} deadBoard={deadBoard} idleText={idleText}
        idleMeta={`${board.score} / ${board.target}`} showXMult={showXMult} />
    </div>
    <BossPanel board={board} />
    {!busy && !awaitingWardenChoice && deadBoard && board.manualRerollsRemaining > 0 && <Alert className="round-status" color="orange" py={5} title="No playable hands" role="status">
      Select dice and use a reroll.
    </Alert>}
    {(board.hotStreakGoal || board.targetPracticeHand) && <Paper p="xs" className="flame-goals"><Group gap="lg">
      {board.hotStreakGoal && <Text size="xs"><strong>🔥 HOT STREAK</strong> · Next: {HANDS[board.hotStreakGoal].name} · Charges: {board.hotStreakCharges} · Hit now: ×{Number(hotStreakMultiplier(hotInvestment, board.hotStreakCharges + 1).toFixed(4))}</Text>}
      {board.targetPracticeHand && <Text size="xs"><strong>◎ TARGET</strong> · {HANDS[board.targetPracticeHand].name} · ×{Number(targetPracticeMultiplier(targetInvestment).toFixed(4))}</Text>}
    </Group></Paper>}
    <Paper className="scorecard-panel" p="xs">
      <HandScorecard board={board} selection={effectiveSelection} busy={busy || awaitingWardenChoice}
        onSelect={hand => setSelection(selectHand(encounterDice, unavailableHands, effectiveSelection, hand, requiredDieIds))} />
    </Paper>
    <Paper className="gameplay-dock" p="xs">
      <div className="gameplay-dock-content">
        <DiceRow dice={wardenDice ?? encounterDice} display={diceDisplay} event={event} disabled={busy}
          selected={selectedWardenDieId === null ? effectiveSelection.dieIds : [selectedWardenDieId]}
          wardenLockedIds={wardenLockedIds} wardenSelectableIds={awaitingWardenChoice ? wardenLockedIds : []}
          wardenChoiceMode={awaitingWardenChoice}
          lockedUntilByDieId={wardenBoss ? lockedUntilByDieId : undefined}
          onClick={id => awaitingWardenChoice
            ? setSelection({ dieIds: selectedWardenDieId === id ? [] : [id], hand: null })
            : setSelection(toggleDie(encounterDice, unavailableHands, effectiveSelection, id, requiredDieIds))} />
        <div className="gameplay-actions">
          {(board.bonfires.includes('charge') || encounterDice.some(die => die.flame?.id === 'charge')) && <Group className="charge-controls" gap="xs" justify="flex-end" mb={4}>
            <Text size="xs" fw={700}>⚡ Charge ×{Number(board.chargeXMult.toFixed(4))}</Text>
            <Button size="compact-xs" color={board.chargeArmed ? 'orange' : 'yellow'} variant={board.chargeArmed ? 'filled' : 'light'}
              disabled={busy || (!board.chargeArmed && board.chargeXMult <= 1)} onClick={() => submit({ type: 'TOGGLE_CHARGE' })}>
              {board.chargeArmed ? 'ARMED — cancel' : `Use Charge ×${Number(board.chargeXMult.toFixed(4))}`}
            </Button>
          </Group>}
          {awaitingWardenChoice && <Text size="xs" c="dimmed" className="selection-preview">
            {selectedWardenDieId === null ? 'Choose any locked die to bring online' : `D${selectedWardenDieId + 1} will keep its current face`}
          </Text>}
          <Group gap="xs" wrap="nowrap">
            {awaitingWardenChoice ? <Button className="unlock-action" size="sm" color="cyan" disabled={busy || selectedWardenDieId === null}
              onClick={() => submit({ type: 'UNLOCK_WARDEN_DIE', dieId: selectedWardenDieId! })}>UNLOCK DIE</Button> : <>
              <Button className="reroll-action" size="sm" variant="default" disabled={busy || !canReroll}
                onClick={() => submit(manualAction)}>Reroll {CONFIG.manualRerollsPerRound - board.manualRerollsRemaining + effectiveSelection.dieIds.length} / {CONFIG.manualRerollsPerRound}</Button>
              <Button className="play-action" size="sm" aria-label="PLAY" disabled={busy || !valid}
                onClick={() => submit({ type: 'PLAY', hand: effectiveSelection.hand!, dieIds: effectiveSelection.dieIds })}>
                {preview ? `${preview.pips} x ${preview.multiplier}${preview.hasXMult ? ` * ${preview.effectiveXMult}` : ''} • PLAY` : 'PLAY'}
              </Button>
            </>}
          </Group>
        </div>
      </div>
    </Paper>
  </Stack>;
}
