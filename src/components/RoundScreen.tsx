import { Alert, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { validateAction } from '../game/engine';
import { hasPlayableHand, HANDS } from '../game/hands';
import { handScore } from '../game/scoring';
import { canPlay, emptySelection, selectHand, toggleDie } from '../game/selection';
import type { Selection } from '../game/selection';
import type { Action, Board, GameEvent } from '../game/types';
import { DiceRow } from './DiceRow';
import { HandScorecard } from './HandList';
import { ScoreResolution } from './ScoreResolution';

export function RoundScreen({ board, event, busy, progress, selection, setSelection, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean; progress: { current: number; total: number };
  selection: Selection; setSelection: (selection: Selection) => void; submit: (action: Action) => void; skip: () => void;
}) {
  const valid = canPlay(board.dice, board.consumed, selection);
  const preview = valid ? handScore(board.dice, selection.hand!, selection.dieIds, board.handLevels[selection.hand!]) : null;
  const manualAction: Action = { type: 'MANUAL_REROLL', dieIds: selection.dieIds };
  const canReroll = validateAction(board, manualAction) === null;
  const deadBoard = !hasPlayableHand(board.dice, board.consumed);
  const idleText = selection.hand
    ? `${HANDS[selection.hand].name} · ${selection.dieIds.length} ${selection.dieIds.length === 1 ? 'die' : 'dice'} selected`
    : selection.dieIds.length ? `${selection.dieIds.length} ${selection.dieIds.length === 1 ? 'die' : 'dice'} selected` : undefined;
  return <Stack gap="xs" className="round-screen">
    <ScoreResolution event={event} busy={busy} {...progress} onSkip={skip} deadBoard={deadBoard} idleText={idleText} />
    {!busy && deadBoard && board.manualRerollsRemaining > 0 && <Alert color="orange" py={5} title="No playable hands" role="status">
      Select dice and use a reroll.
    </Alert>}
    <Paper className="scorecard-panel" p="xs">
      <HandScorecard board={board} selection={selection} busy={busy}
        onSelect={hand => setSelection(selectHand(board.dice, board.consumed, selection, hand))}
        onClear={() => setSelection(emptySelection())} />
    </Paper>
    <Paper className="gameplay-dock" p="xs">
      <div className="gameplay-dock-content">
        <DiceRow dice={board.dice} event={event} disabled={busy} selected={selection.dieIds}
          onClick={id => setSelection(toggleDie(board.dice, board.consumed, selection, id))} />
        <div className="gameplay-actions">
          <Text size="xs" c="dimmed" className="selection-preview">{preview
            ? `${preview.pips} pips × ${preview.multiplier} = ${preview.score} points`
            : selection.dieIds.length ? 'Select a complete participating set' : 'Choose a hand or select dice'}</Text>
          <Group gap="xs" wrap="nowrap">
            <Button size="sm" variant="default" disabled={busy || !canReroll} aria-label={`Reroll Selected — ${selection.dieIds.length}`} onClick={() => submit(manualAction)}>↻ Reroll Selected — {selection.dieIds.length}</Button>
            <Button size="sm" disabled={busy || !valid} onClick={() => submit({ type: 'PLAY', hand: selection.hand!, dieIds: selection.dieIds })}>PLAY</Button>
          </Group>
        </div>
      </div>
    </Paper>
  </Stack>;
}
