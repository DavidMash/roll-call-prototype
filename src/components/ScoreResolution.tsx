import { Badge, Button, Group, Paper, Text } from '@mantine/core';
import { ENHANCEMENTS } from '../game/enhancements';
import { FLAMES } from '../game/flames';
import { HANDS } from '../game/hands';
import type { GameEvent } from '../game/types';

export function ScoreResolution({ event, busy, current, total, onSkip, deadBoard = false, idleText, showXMult = false }: {
  event: GameEvent | null;
  busy: boolean;
  current: number;
  total: number;
  onSkip: () => void;
  deadBoard?: boolean;
  idleText?: string;
  showXMult?: boolean;
}) {
  let heading = idleText ?? (deadBoard ? 'No playable hands — use a reroll' : 'Choose a hand or select dice');
  if (event?.type === 'HAND_SCORE_FINALIZED' || event?.type === 'STANDALONE_SCORE_CALCULATED') heading = `+${event.amount}`;
  else if (event?.type === 'JUMPING_BEAN_FREE_PLAY' && event.hand) heading = `JUMPING BEAN · FREE ${HANDS[event.hand].name.toUpperCase()}`;
  else if (event?.type === 'SCORE_ADDED') heading = `+${event.amount}`;
  else if (event?.type === 'HITCHHIKER_ADDED_PIPS') heading = 'HITCHHIKER';
  else if (event?.flame) heading = FLAMES[event.flame].name.toUpperCase();
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
  return <Paper className={`resolution ${busy ? 'active' : ''}`} p="xs" aria-live="polite" aria-atomic="true">
    <Group justify="space-between" className="resolution-meta">
      <Text size="xs" c="dimmed">{busy ? `EVENT ${current} / ${total}` : 'READY'}</Text>
      {busy && <Button size="compact-xs" variant="subtle" color="gray" onClick={onSkip}>Skip playback</Button>}
    </Group>
    {event?.handScore && <Group justify="center" gap="xl" className="score-accumulator" data-testid="hand-accumulator">
      <div><Text size="xs" c="dimmed">PIPS</Text><Text size="xl" fw={700} data-testid="hand-pips">{event.handScore.currentPips}</Text></div>
      <Text c="dimmed">×</Text>
      <div><Text size="xs" c="dimmed">MULT</Text><Text size="xl" fw={700} data-testid="hand-multiplier">x{event.handScore.currentMultiplier}</Text></div>
      {showXMult && <><Text c="dimmed">×</Text><div><Text size="xs" c="dimmed">XMULT</Text><Text size="xl" fw={700} data-testid="hand-xmult">x{event.handScore.currentXMult}</Text></div></>}
    </Group>}
    {!event?.handScore && showXMult && event?.type === 'STANDALONE_SCORE_CALCULATED' && <Group justify="center" gap="xl" className="score-accumulator" data-testid="standalone-accumulator">
      <div><Text size="xs" c="dimmed">PIPS</Text><Text size="xl" fw={700}>{event.pips}</Text></div><Text c="dimmed">×</Text>
      <div><Text size="xs" c="dimmed">MULT</Text><Text size="xl" fw={700}>x{event.multiplier}</Text></div><Text c="dimmed">×</Text>
      <div><Text size="xs" c="dimmed">XMULT</Text><Text size="xl" fw={700} data-testid="standalone-xmult">x{event.xMult ?? 1}</Text></div>
    </Group>}
    <Text key={event?.id ?? 'ready'} className="score-tick" fw={700}>{heading}</Text>
    {busy && event?.message && <Text size="xs" c="dimmed" className="resolution-message">{event.message}</Text>}
    {event?.source && <Badge size="xs" mt={4} variant="light">{event.source === 'hand' ? 'Selected hand' : ENHANCEMENTS[event.source].name}</Badge>}
  </Paper>;
}
