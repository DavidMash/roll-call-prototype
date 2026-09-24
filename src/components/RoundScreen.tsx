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
import { activeEncounterDice, requiredEncounterDieIds } from '../game/bosses';
import { BossPanel } from './BossPanel';

export function RoundScreen({ board, event, busy, progress, selection, setSelection, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean; progress: { current: number; total: number };
  selection: Selection; setSelection: (selection: Selection) => void; submit: (action: Action) => void; skip: () => void;
}) {
  const encounterDice = activeEncounterDice(board);
  const wardenBoss = board.boss?.type === 'warden' ? board.boss : null;
  const wardenDice = wardenBoss
    ? board.dice.filter(die => die.owner === 'player').sort((a, b) => a.id - b.id)
    : null;
  const lockedUntilByDieId: Record<number, number> = {};
  if (wardenBoss && wardenDice) {
    wardenDice.forEach((die, index) => {
      if (index > 0 && !wardenBoss.activeDieIds.includes(die.id)) {
        lockedUntilByDieId[die.id] = wardenBoss.checkpoints[index - 1];
      }
    });
  }
  const requiredDieIds = requiredEncounterDieIds(board);
  const selectedDieIds = [...new Set([...requiredDieIds, ...selection.dieIds])].sort((a, b) => a - b);
  const selectedHand = selection.hand && handOptions(encounterDice, board.consumed, selectedDieIds)
    .some(option => option.id === selection.hand && !option.consumed) ? selection.hand : null;
  const effectiveSelection: Selection = { dieIds: selectedDieIds, hand: selectedHand };
  const valid = canPlay(encounterDice, board.consumed, effectiveSelection)
    && validateAction(board, { type: 'PLAY', hand: effectiveSelection.hand!, dieIds: effectiveSelection.dieIds }) === null;
  const showXMult = hasXMultFlame(board.dice, board.bonfires);
  const preview = valid ? (() => {
    const hand = effectiveSelection.hand!;
    const base = handScore(encounterDice, hand, effectiveSelection.dieIds, board.handLevels[hand]);
    const contributions = handXMultContributions(captureHandStart(board, hand), hand, board.handLevels[hand], effectiveSelection.dieIds);
    const xMult = composeXMult(contributions);
    return { ...base, xMult, score: finalizeScore(base.pips, base.multiplier, xMult).finalScore };
  })() : null;
  const manualAction: Action = { type: 'MANUAL_REROLL', dieIds: effectiveSelection.dieIds };
  const canReroll = validateAction(board, manualAction) === null;
  const deadBoard = !hasPlayableHand(encounterDice, board.consumed, requiredDieIds);
  const availablePlays = handOptions(encounterDice, board.consumed, requiredDieIds).filter(option => !option.consumed).length;
  const lastPlay = board.manualRerollsRemaining === 0 && availablePlays === 1 && valid;
  const hotFlame = board.dice.find(die => die.flame?.id === 'hotStreak')?.flame;
  const hotInvestment = board.bonfires.includes('hotStreak') ? 100 : activeFlameInvestment(hotFlame);
  const targetFlame = board.dice.find(die => die.flame?.id === 'targetPractice')?.flame;
  const targetInvestment = board.bonfires.includes('targetPractice') ? 100 : activeFlameInvestment(targetFlame);
  const idleText = effectiveSelection.hand
    ? `${HANDS[effectiveSelection.hand].name} · ${effectiveSelection.dieIds.length} ${effectiveSelection.dieIds.length === 1 ? 'die' : 'dice'} selected`
    : effectiveSelection.dieIds.length ? `${effectiveSelection.dieIds.length} ${effectiveSelection.dieIds.length === 1 ? 'die' : 'dice'} selected` : undefined;
  return <Stack gap="xs" className="round-screen">
    <div className="live-score-panel" data-testid="live-score-panel">
      <ScoreResolution event={event} busy={busy} {...progress} onSkip={skip} deadBoard={deadBoard} idleText={idleText} showXMult={showXMult} />
    </div>
    <BossPanel board={board} />
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
      <HandScorecard board={board} selection={effectiveSelection} busy={busy}
        canClear={effectiveSelection.hand !== null || effectiveSelection.dieIds.some(id => !requiredDieIds.includes(id))}
        onSelect={hand => setSelection(selectHand(encounterDice, board.consumed, effectiveSelection, hand))}
        onClear={() => setSelection(requiredDieIds.length ? { dieIds: requiredDieIds, hand: null } : emptySelection())} />
    </Paper>
    <Paper className="gameplay-dock" p="xs">
      <div className="gameplay-dock-content">
        <DiceRow dice={wardenDice ?? encounterDice} event={event} disabled={busy} selected={effectiveSelection.dieIds}
          lockedIds={requiredDieIds} lockedReasons={Object.fromEntries(requiredDieIds.map(id => [id, 'Required by The Hexer.']))}
          lockedUntilByDieId={wardenBoss ? lockedUntilByDieId : undefined}
          onClick={id => setSelection(toggleDie(encounterDice, board.consumed, effectiveSelection, id))} />
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
            : effectiveSelection.dieIds.length ? 'Select a complete participating set' : 'Choose a hand or select dice'}</Text>
          <Group gap="xs" wrap="nowrap">
            <Button size="sm" variant="default" disabled={busy || !canReroll} aria-label={`Reroll Selected — ${effectiveSelection.dieIds.length}`} onClick={() => submit(manualAction)}>↻ Reroll Selected — {effectiveSelection.dieIds.length}</Button>
            <Button size="sm" color={lastPlay ? 'red' : undefined} disabled={busy || !valid} onClick={() => submit({ type: 'PLAY', hand: effectiveSelection.hand!, dieIds: effectiveSelection.dieIds })}>{lastPlay ? 'LAST PLAY' : 'PLAY'}</Button>
          </Group>
        </div>
      </div>
    </Paper>
  </Stack>;
}
