import { Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { CONFIG } from '../game/config';
import type { Board } from '../game/types';
import { DiceRow } from './DiceRow';

const hearts = (lives: number) => Array.from({ length: CONFIG.maxLives }, (_, index) => index < lives ? '♥' : '♡').join(' ');

export function BustScreen({ board, restartSame, newRun }: {
  board: Board; restartSame?: () => void; newRun?: () => void;
}) {
  const bust = board.bust!;
  return <Stack gap="sm">
    <Paper p="xl" ta="center" className="end-state bust-state">
      <Title order={2}>BUST</Title>
      <Text fw={800} mt="sm">{bust.score.toLocaleString()} / {bust.target.toLocaleString()}</Text>
      <Text c="red" fw={800}>{bust.shortfall.toLocaleString()} SHORT</Text>
      <Group justify="center" gap="xs" mt="md"><Text size="xl" c="red">{hearts(bust.livesBefore)}</Text><Text>→</Text><Text size="xl" c="red">{hearts(bust.livesAfter)}</Text></Group>
      {bust.livesAfter > 0 ? <>
        <Text fw={800} mt="xs">1 LIFE LOST</Text>
        <Text size="sm" c="dimmed" mt="md">Restoring your pre-attempt build and returning to the Shop…</Text>
      </> : <><Text fw={800} mt="xs">NO LIVES REMAIN</Text><Title order={3} mt="md">RUN OVER</Title>
        {restartSame && newRun && <Group justify="center" mt="lg"><Button onClick={restartSame}>Restart same seed</Button><Button variant="default" onClick={newRun}>New seed</Button></Group>}
      </>}
    </Paper>
    <Paper p="xs"><DiceRow dice={board.dice} event={null} disabled selected={[]} onClick={() => {}} /></Paper>
  </Stack>;
}
