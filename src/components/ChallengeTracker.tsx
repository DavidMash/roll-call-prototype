import { ActionIcon, Group, Modal, Progress, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { challengeRoundsRemaining, challengeText, CHALLENGES, displayedChallengeProgress } from '../game/hoodedFigure';
import type { Board } from '../game/types';

export function ChallengeTracker({ board }: { board: Board }) {
  const [opened, setOpened] = useState(false);
  const challenge = board.hoodedFigure.active;
  if (!challenge || challenge.issuedChapter !== Math.floor((board.round - 1) / 6) + 1 || ((board.round - 1) % 6) + 1 > 3) return null;
  const definition = CHALLENGES[challenge.id];
  const progress = displayedChallengeProgress(challenge);
  const percent = challenge.target > 0 ? Math.min(100, progress / challenge.target * 100) : 0;
  return <>
    <Stack gap={4} className="challenge-tracker" data-testid="challenge-tracker">
      <Group gap={6} justify="space-between">
        <Text size="xs" fw={800}>{definition.name}</Text>
        <ActionIcon size="sm" variant="subtle" aria-label={`About ${definition.name} challenge`} onClick={() => setOpened(true)}>i</ActionIcon>
      </Group>
      <Progress value={percent} size="sm" color={challenge.complete || progress >= challenge.target ? 'orange' : 'violet'}
        role="progressbar" aria-label={`${definition.name} challenge progress`} aria-valuemin={0}
        aria-valuemax={challenge.target} aria-valuenow={progress} />
    </Stack>
    <Modal opened={opened} onClose={() => setOpened(false)} title={definition.name} centered
      aria-label={`${definition.name} challenge details`}>
      <Stack gap="sm">
        <Text>{challengeText(challenge, 'full')}</Text>
        <Text fw={800}>{progress} / {challenge.target}</Text>
        <Text c={challenge.complete ? 'orange' : 'dimmed'}>{challenge.complete ? 'Challenge Complete'
          : `${challengeRoundsRemaining(board)} Round${challengeRoundsRemaining(board) === 1 ? '' : 's'} Remaining`}</Text>
        {definition.scope === 'round' && !challenge.complete && <Text size="sm" c="dimmed">Progress shown is for the current Round attempt. It commits only when that Round clears.</Text>}
      </Stack>
    </Modal>
  </>;
}
