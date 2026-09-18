import { Badge, Button, Group, Paper, Text } from '@mantine/core';
import { ENHANCEMENTS } from '../game/enhancements';
import { HANDS } from '../game/hands';
import type { GameEvent } from '../game/types';

export function ScoreResolution({ event, busy, current, total, onSkip, deadBoard = false }: {
  event: GameEvent | null; busy: boolean; current: number; total: number; onSkip: () => void; deadBoard?: boolean;
}) {
  let heading = deadBoard ? 'Use your remaining rerolls' : 'Choose your next hand';
  if (event?.type === 'HAND_SCORE_FINALIZED') heading = `${event.pips} × ${event.multiplier} = ${event.amount}`;
  else if (event?.type === 'STANDALONE_SCORE_CALCULATED') heading = `${event.pips} × ${event.multiplier}`;
  else if (event?.type === 'SCORE_ADDED') heading = `+${event.amount}`;
  else if (event?.enhancement) heading = ENHANCEMENTS[event.enhancement].name.toUpperCase();
  else if (event?.type === 'HAND_STARTED' && event.hand) heading = `${HANDS[event.hand].name} — LV. ${event.handScore?.handLevel ?? event.board.handLevels[event.hand]}`;
  else if (event?.type === 'TRAINING_PURCHASED' && event.hand) heading = `${HANDS[event.hand].name} — LV. ${event.board.handLevels[event.hand]}`;
  else if (event?.type === 'GOLD_ADDED') heading = `+${event.amount} gold`;
  else if (event?.type === 'MANUAL_REROLL_STARTED') heading = 'Manual reroll';
  else if (event?.type === 'DEAD_BOARD') heading = 'Use your rerolls';
  else if (event?.type === 'DEAD_BOARD_RESCUED') heading = 'Dead board rescued';
  else if (event?.type === 'POST_HAND_REROLLS_SKIPPED' || event?.type === 'ROUND_CLEARED') heading = 'ROUND CLEARED';
  else if (event?.type === 'DICE_REROLL_STARTED' || event?.type === 'DIE_ROLLED') heading = 'Rolling dice';
  else if (event) heading = 'Resolving';
  return <Paper className={`resolution ${busy ? 'active' : ''}`} withBorder p="lg" aria-live="polite" aria-atomic="true">
    <Group justify="space-between" className="resolution-meta">
      <Text size="xs" c="dimmed">{busy ? `EVENT ${current} / ${total}` : 'READY TO PLAY'}</Text>
      {busy && <Button size="compact-xs" variant="subtle" color="gray" onClick={onSkip}>Skip playback</Button>}
    </Group>
    {event?.handScore && <Group justify="center" gap="xl" mt="sm" data-testid="hand-accumulator">
      <div><Text size="xs" c="dimmed">PIPS</Text><Text size="xl" fw={700} data-testid="hand-pips">{event.handScore.currentPips}</Text></div>
      <div><Text size="xs" c="dimmed">MULT</Text><Text size="xl" fw={700} data-testid="hand-multiplier">x{event.handScore.currentMultiplier}</Text></div>
    </Group>}
    <Text key={event?.id ?? 'ready'} className="score-tick" fw={700}>{heading}</Text>
    <Text size="sm" c="dimmed">{event?.message ?? (deadBoard
      ? 'No playable hands. Select any physical dice and press Reroll Selected to try to make a hand.'
      : 'Select a hand, or select dice to narrow your options. Press PLAY to score, or Reroll Selected to spend one reroll per die.')}</Text>
    {event?.source && <Badge mt="xs" variant="light">{event.source === 'hand' ? 'Selected hand' : ENHANCEMENTS[event.source].name}</Badge>}
  </Paper>;
}
