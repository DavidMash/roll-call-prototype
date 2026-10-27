import { Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { CONFIG } from '../game/config';
import type { Board } from '../game/types';
import { formatExactScore, formatScoreProgress } from '../game/copy';
import { fullChapterLabels } from '../game/chapters';
import { RunActionPortal } from './RunActionRow';

const hearts = (lives: number) => Array.from({ length: CONFIG.maxLives }, (_, index) => index < lives ? '♥' : '♡').join(' ');

export function BustScreen({ board, onContinue, restartSame, newRun, scenarioFailure = false, backToScenarios }: {
  board: Board; onContinue?: () => void; restartSame?: () => void; newRun?: () => void;
  scenarioFailure?: boolean; backToScenarios?: () => void;
}) {
  const bust = board.bust!;
  const labels = fullChapterLabels(board.round);
  const displayLabels = board.runMode === 'scenario' ? { chapter: 'SCENARIO', round: `ROUND ${board.round}` } : labels;
  return <Stack gap="sm">
    <Paper p="xl" ta="center" className="end-state bust-state">
      <Text fw={900} className="summary-chapter">{displayLabels.chapter}</Text>
      <Title order={2}>{displayLabels.round} BUST</Title>
      <Text fw={800} mt="sm">{formatScoreProgress(bust.score, bust.target)}</Text>
      <Text c="red" fw={800}>{formatExactScore(bust.shortfall)} SHORT</Text>
      <Group justify="center" gap="xs" mt="md"><Text size="xl" c="red">{hearts(bust.livesBefore)}</Text><Text>→</Text><Text size="xl" c="red">{hearts(bust.livesAfter)}</Text></Group>
      {bust.livesAfter > 0 ? <>
        <Text fw={800} mt="xs">1 Life Lost</Text>
        {onContinue && <RunActionPortal><div className="run-action-primary"><Button aria-label="Continue" onClick={onContinue}>CONTINUE</Button></div></RunActionPortal>}
      </> : <><Text fw={800} mt="xs">NO LIVES REMAIN</Text><Title order={3} mt="md">Run Over</Title>
        {scenarioFailure && restartSame && backToScenarios
          ? <Group justify="center" mt="lg"><Button onClick={restartSame}>TRY AGAIN</Button><Button variant="default" onClick={backToScenarios}>BACK TO SCENARIOS</Button></Group>
          : restartSame && newRun && <Group justify="center" mt="lg"><Button onClick={restartSame}>Restart same seed</Button><Button variant="default" onClick={newRun}>New seed</Button></Group>}
      </>}
    </Paper>
  </Stack>;
}
