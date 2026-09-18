import { Alert, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { validateAction } from '../game/engine';
import { hasPlayableHand } from '../game/hands';
import { handScore } from '../game/scoring';
import { canPlay, emptySelection, selectHand, toggleDie } from '../game/selection';
import type { Selection } from '../game/selection';
import type { Action, Board, GameEvent } from '../game/types';
import { DiceRow } from './DiceRow';
import { HandList } from './HandList';
import { ScoreResolution } from './ScoreResolution';

export function RoundScreen({ board, event, busy, progress, selection, setSelection, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean; progress: { current: number; total: number };
  selection: Selection; setSelection: (selection: Selection) => void; submit: (action: Action) => void; skip: () => void;
}) {
  const valid = canPlay(board.dice, board.consumed, selection);
  const preview = valid ? handScore(board.dice, selection.hand!, selection.dieIds) : null;
  const manualAction: Action = { type: 'MANUAL_REROLL', dieIds: selection.dieIds };
  const canReroll = validateAction(board, manualAction) === null;
  const deadBoard = !hasPlayableHand(board.dice, board.consumed);
  return <Stack gap="lg">
    <ScoreResolution event={event} busy={busy} {...progress} onSkip={skip} deadBoard={deadBoard} />
    {!busy && deadBoard && board.manualRerollsRemaining > 0 && <Alert color="orange" title="No playable hands" role="status">
      Use your remaining rerolls. Select any dice below to try to make a new hand.
    </Alert>}
    <Paper withBorder p="lg">
      <HandList board={board} selection={selection} busy={busy}
        onSelect={hand => setSelection(selectHand(board.dice, board.consumed, selection, hand))}
        onClear={() => setSelection(emptySelection())} />
      <Group justify="space-between" mt="lg" align="center">
        <Text size="sm" c="dimmed">{preview ? `${preview.pips} pips × ${preview.multiplier} = ${preview.score} points` : 'Choose a complete participating set.'}</Text>
        <Group gap="sm">
          <Button variant="default" disabled={busy || !canReroll} onClick={() => submit(manualAction)}>Reroll Selected — {selection.dieIds.length}</Button>
          <Button size="lg" disabled={busy || !valid} onClick={() => submit({ type: 'PLAY', hand: selection.hand!, dieIds: selection.dieIds })}>PLAY</Button>
        </Group>
      </Group>
    </Paper>
    <div>
      <DiceRow dice={board.dice} event={event} disabled={busy} selected={selection.dieIds} showSustainableSpent
        onClick={id => setSelection(toggleDie(board.dice, board.consumed, selection, id))} />
      <Text ta="center" size="xs" c="dimmed" mt="sm">Each number identifies the active physical face. Badges belong to that face of that die.</Text>
    </div>
  </Stack>;
}
