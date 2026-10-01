import { Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { CONFIG } from '../game/config';
import type { Board } from '../game/types';
import { DiceRow } from './DiceRow';
import type { DiceDisplay } from '../uiSettings';
import { formatPlayerNumber, formatScoreProgress } from '../game/copy';

const hearts = (lives: number) => Array.from({ length: CONFIG.maxLives }, (_, index) => index < lives ? '♥' : '♡').join(' ');

export function BustScreen({ board, diceDisplay, onContinue, restartSame, newRun }: {
  board: Board; diceDisplay: DiceDisplay; onContinue?: () => void; restartSame?: () => void; newRun?: () => void;
}) {
  const bust = board.bust!;
  return <Stack gap="sm">
    <Paper p="xl" ta="center" className="end-state bust-state">
      <Title order={2}>ROUND {formatPlayerNumber(board.round)} BUST</Title>
      <Text fw={800} mt="sm">{formatScoreProgress(bust.score, bust.target)}</Text>
      <Text c="red" fw={800}>{formatPlayerNumber(bust.shortfall)} SHORT</Text>
      <Group justify="center" gap="xs" mt="md"><Text size="xl" c="red">{hearts(bust.livesBefore)}</Text><Text>→</Text><Text size="xl" c="red">{hearts(bust.livesAfter)}</Text></Group>
      {bust.livesAfter > 0 ? <>
        <Text fw={800} mt="xs">1 Life Lost</Text>
        {onContinue && <Button mt="lg" onClick={onContinue}>Continue</Button>}
      </> : <><Text fw={800} mt="xs">NO LIVES REMAIN</Text><Title order={3} mt="md">Run Over</Title>
        {restartSame && newRun && <Group justify="center" mt="lg"><Button onClick={restartSame}>Restart same seed</Button><Button variant="default" onClick={newRun}>New seed</Button></Group>}
      </>}
    </Paper>
    <Paper p="xs"><DiceRow dice={board.dice} display={diceDisplay} event={null} disabled selected={[]} onClick={() => {}} /></Paper>
  </Stack>;
}
