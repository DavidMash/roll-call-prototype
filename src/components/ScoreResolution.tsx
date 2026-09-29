import { Button, Group, Paper, Text } from '@mantine/core';
import { ENHANCEMENTS } from '../game/enhancements';
import { FLAMES } from '../game/flames';
import { HANDS } from '../game/hands';
import type { GameEvent } from '../game/types';

export function ScoreResolution({ event, busy, onSkip, idleText, scoreText, showXMult = false }: {
  event: GameEvent | null;
  busy: boolean;
  onSkip: () => void;
  idleText?: string;
  scoreText?: string;
  showXMult?: boolean;
}) {
  let heading = idleText ?? '';
  if (event?.type === 'HAND_SCORE_FINALIZED' || event?.type === 'STANDALONE_SCORE_CALCULATED') heading = `+${event.amount}`;
  else if (event?.type === 'JUMPING_BEAN_FREE_PLAY' && event.hand) heading = `JUMPING BEAN · FREE ${HANDS[event.hand].name.toUpperCase()}`;
  else if (event?.type === 'SCORE_ADDED') heading = (event.amount ?? 0) < 0 ? `−${Math.abs(event.amount!)}` : `+${event.amount}`;
  else if (event?.type === 'HITCHHIKER_ADDED_PIPS') heading = 'HITCHHIKER';
  else if (event?.flame) heading = FLAMES[event.flame].name.toUpperCase();
  else if (event?.enhancement) heading = ENHANCEMENTS[event.enhancement].name.toUpperCase();
  else if (event?.type === 'HAND_STARTED' && event.hand) heading = `${HANDS[event.hand].name} — Lv. ${event.handScore?.handLevel ?? event.board.handLevels[event.hand]}`;
  else if (event?.type === 'TRAINING_PURCHASED' && event.hand) heading = `${HANDS[event.hand].name} — Lv. ${event.board.handLevels[event.hand]}`;
  else if (event?.type === 'GOLD_ADDED') heading = `+${event.amount} Gold`;
  else if (event?.type === 'MANUAL_REROLL_STARTED') heading = 'Reroll';
  else if (event?.type === 'DEAD_BOARD') heading = 'Use a Reroll';
  else if (event?.type === 'DEAD_BOARD_RESCUED') heading = 'Dead board rescued';
  else if (event?.type === 'POST_HAND_REROLLS_SKIPPED' || event?.type === 'ROUND_CLEARED') heading = 'ROUND CLEARED';
  else if (event?.type === 'DICE_REROLL_STARTED' || event?.type === 'DIE_ROLLED') heading = 'Rolling dice';
  else if (event) heading = '';
  return <Paper className={`resolution ${busy ? 'active' : ''}`} p="xs" aria-live="polite" aria-atomic="true">
    <Group justify={scoreText ? 'space-between' : 'flex-end'} className="resolution-meta is-round-score">
      {scoreText && <Text className="round-score-readout" data-testid="round-score-progress">{scoreText}</Text>}
      {busy && <Button size="compact-xs" variant="subtle" color="gray" onClick={onSkip}>Skip playback</Button>}
    </Group>
    {event?.handScore && <Group justify="center" gap="xl" className="score-accumulator" data-testid="hand-accumulator">
      <div><Text size="xs" c="dimmed">Pips</Text><Text size="xl" fw={700} data-testid="hand-pips">{event.handScore.currentPips}</Text></div>
      <Text c="dimmed">×</Text>
      <div><Text size="xs" c="dimmed">Mult</Text><Text size="xl" fw={700} data-testid="hand-multiplier">×{event.handScore.currentMultiplier}</Text></div>
      {showXMult && <><Text c="dimmed">×</Text><div><Text size="xs" c="dimmed">XMult</Text><Text size="xl" fw={700} data-testid="hand-xmult">×{event.handScore.currentXMult}</Text></div></>}
      {event.handScore.bossFactor !== 1 && <><Text c="dimmed">×</Text><div><Text size="xs" c="dimmed">Boss</Text><Text size="xl" fw={700} data-testid="hand-boss-factor">×{event.handScore.bossFactor}</Text></div></>}
    </Group>}
    {!event?.handScore && showXMult && event?.type === 'STANDALONE_SCORE_CALCULATED' && <Group justify="center" gap="xl" className="score-accumulator" data-testid="standalone-accumulator">
      <div><Text size="xs" c="dimmed">Pips</Text><Text size="xl" fw={700}>{event.pips}</Text></div><Text c="dimmed">×</Text>
      <div><Text size="xs" c="dimmed">Mult</Text><Text size="xl" fw={700}>×{event.multiplier}</Text></div><Text c="dimmed">×</Text>
      <div><Text size="xs" c="dimmed">XMult</Text><Text size="xl" fw={700} data-testid="standalone-xmult">×{event.xMult ?? 1}</Text></div>
    </Group>}
    {heading && <Text key={event?.id ?? 'ready'} className="score-tick" fw={700}>{heading}</Text>}
  </Paper>;
}
