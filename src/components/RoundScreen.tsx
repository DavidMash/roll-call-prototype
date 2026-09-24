import { Alert, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { validateAction } from '../game/engine';
import { activeFlameInvestment, captureHandStart, composeXMult, handXMultContributions, hasXMultFlame, hotStreakMultiplier, targetPracticeMultiplier } from '../game/flames';
import { handOptions, hasPlayableHand, HANDS } from '../game/hands';
import { finalizeScore, handScore } from '../game/scoring';
import { canPlay, emptySelection, selectHand, toggleDie } from '../game/selection';
import type { Selection } from '../game/selection';
import type { Action, Board, GameEvent } from '../game/types';
import { DiceRow } from './DiceRow';
import { HandScorecard } from './HandList';
import { ScoreResolution } from './ScoreResolution';
import { activeEncounterDice } from '../game/bosses';
import { BossPanel } from './BossPanel';

export function RoundScreen({ board, event, busy, progress, selection, setSelection, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean; progress: { current: number; total: number };
  selection: Selection; setSelection: (selection: Selection) => void; submit: (action: Action) => void; skip: () => void;
}) {
  const encounterDice = activeEncounterDice(board);
  const valid = canPlay(encounterDice, board.consumed, selection)
    && (board.boss?.type !== 'hexer' || selection.dieIds.includes(board.boss.cursedDieId));
  const showXMult = hasXMultFlame(board.dice, board.bonfires);
  const preview = valid ? (() => {
    const hand = selection.hand!;
    const base = handScore(encounterDice, hand, selection.dieIds, board.handLevels[hand]);
    const contributions = handXMultContributions(captureHandStart(board, hand), hand, board.handLevels[hand], selection.dieIds);
    const xMult = composeXMult(contributions);
    return { ...base, xMult, score: finalizeScore(base.pips, base.multiplier, xMult).finalScore };
  })() : null;
  const manualAction: Action = { type: 'MANUAL_REROLL', dieIds: selection.dieIds };
  const canReroll = validateAction(board, manualAction) === null;
  const awaitingWarden = board.boss?.type === 'warden' && (board.boss.startingDieId === null || board.boss.pendingReinforcements > 0);
  const deadBoard = !awaitingWarden && !hasPlayableHand(encounterDice, board.consumed);
  const availablePlays = handOptions(encounterDice, board.consumed).filter(option => !option.consumed).length;
  const lastPlay = board.manualRerollsRemaining === 0 && availablePlays === 1 && valid;
  const hotFlame = board.dice.find(die => die.flame?.id === 'hotStreak')?.flame;
  const hotInvestment = board.bonfires.includes('hotStreak') ? 100 : activeFlameInvestment(hotFlame);
  const targetFlame = board.dice.find(die => die.flame?.id === 'targetPractice')?.flame;
  const targetInvestment = board.bonfires.includes('targetPractice') ? 100 : activeFlameInvestment(targetFlame);
  const idleText = selection.hand
    ? `${HANDS[selection.hand].name} · ${selection.dieIds.length} ${selection.dieIds.length === 1 ? 'die' : 'dice'} selected`
    : selection.dieIds.length ? `${selection.dieIds.length} ${selection.dieIds.length === 1 ? 'die' : 'dice'} selected` : undefined;
  return <Stack gap="xs" className="round-screen">
    <ScoreResolution event={event} busy={busy} {...progress} onSkip={skip} deadBoard={deadBoard} idleText={idleText} showXMult={showXMult} />
    <BossPanel board={board} busy={busy} submit={submit} />
    {!busy && deadBoard && board.manualRerollsRemaining > 0 && <Alert color="orange" py={5} title="No playable hands" role="status">
      Select dice and use a reroll.
    </Alert>}
    {!busy && !deadBoard && <Group gap="xs" aria-label="Round options remaining">
      {board.manualRerollsRemaining === 0 && <Alert color="orange" py={4} title="NO REROLLS" />}
      <Text size="xs" fw={800} c={lastPlay ? 'red' : 'dimmed'}>{lastPlay ? 'LAST PLAY' : `${availablePlays} ${availablePlays === 1 ? 'PLAY' : 'PLAYS'} AVAILABLE`}</Text>
    </Group>}
    {(board.hotStreakGoal || board.targetPracticeHand) && <Paper p="xs" className="flame-goals"><Group gap="lg">
      {board.hotStreakGoal && <Text size="xs"><strong>🔥 HOT STREAK</strong> · Next: {HANDS[board.hotStreakGoal].name} · Charges: {board.hotStreakCharges} · Hit now: ×{Number(hotStreakMultiplier(hotInvestment, board.hotStreakCharges + 1).toFixed(4))}</Text>}
      {board.targetPracticeHand && <Text size="xs"><strong>◎ TARGET</strong> · {HANDS[board.targetPracticeHand].name} · ×{Number(targetPracticeMultiplier(targetInvestment).toFixed(4))}</Text>}
    </Group></Paper>}
    <Paper className="scorecard-panel" p="xs">
      <HandScorecard board={board} selection={selection} busy={busy}
        onSelect={hand => setSelection(selectHand(encounterDice, board.consumed, selection, hand))}
        onClear={() => setSelection(emptySelection())} />
    </Paper>
    <Paper className="gameplay-dock" p="xs">
      <div className="gameplay-dock-content">
        <DiceRow dice={board.dice} event={event} disabled={busy} selected={selection.dieIds}
          eligibleIds={board.boss?.type === 'warden' ? board.boss.activeDieIds : undefined}
          restrictToEligible={board.boss?.type === 'warden'}
          ineligibleReasons={board.boss?.type === 'warden' ? Object.fromEntries(board.dice.map(die => [die.id, 'Locked by The Warden until a checkpoint.'])) : undefined}
          onClick={id => setSelection(toggleDie(encounterDice, board.consumed, selection, id))} />
        <div className="gameplay-actions">
          {(board.bonfires.includes('charge') || board.dice.some(die => die.flame?.id === 'charge')) && <Group gap="xs" justify="flex-end" mb={4}>
            <Text size="xs" fw={700}>⚡ Charge ×{Number(board.chargeXMult.toFixed(4))}</Text>
            <Button size="compact-xs" color={board.chargeArmed ? 'orange' : 'yellow'} variant={board.chargeArmed ? 'filled' : 'light'}
              disabled={busy || (!board.chargeArmed && board.chargeXMult <= 1)} onClick={() => submit({ type: 'TOGGLE_CHARGE' })}>
              {board.chargeArmed ? 'ARMED — cancel' : `Use Charge ×${Number(board.chargeXMult.toFixed(4))}`}
            </Button>
          </Group>}
          <Text size="xs" c="dimmed" className="selection-preview">{preview
            ? `${preview.pips} pips × ${preview.multiplier}${showXMult ? ` × ${preview.xMult} XMult` : ''} = ${preview.score} points`
            : selection.dieIds.length ? 'Select a complete participating set' : 'Choose a hand or select dice'}</Text>
          <Group gap="xs" wrap="nowrap">
            <Button size="sm" variant="default" disabled={busy || !canReroll} aria-label={`Reroll Selected — ${selection.dieIds.length}`} onClick={() => submit(manualAction)}>↻ Reroll Selected — {selection.dieIds.length}</Button>
            <Button size="sm" color={lastPlay ? 'red' : undefined} disabled={busy || !valid} onClick={() => submit({ type: 'PLAY', hand: selection.hand!, dieIds: selection.dieIds })}>{lastPlay ? 'LAST PLAY' : 'PLAY'}</Button>
          </Group>
        </div>
      </div>
    </Paper>
  </Stack>;
}
