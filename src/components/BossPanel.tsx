import { Badge, Group, Paper, Text } from '@mantine/core';
import { BOSSES } from '../game/bosses';
import { HANDS } from '../game/hands';
import type { Board } from '../game/types';

export function BossPanel({ board }: { board: Board }) {
  const boss = board.boss;
  if (!boss) return null;
  const definition = BOSSES[boss.type];
  const compactStatus = (() => {
    switch (boss.type) {
      case 'caller': return `CALL: ${HANDS[boss.calledHand].name.toUpperCase()} · DUE IN ${boss.playsRemaining}`;
      case 'warden': return `${boss.activeDieIds.length} / 5 DICE${boss.nextUnlockTarget === null ? ' · CHOOSE DIE' : ` · NEXT AT ${boss.nextUnlockTarget}`}`;
      case 'hexer': return 'CURSED DIE REQUIRED';
      case 'marathon': return 'EXTRA LARGE GOAL';
      case 'quickdraw': return boss.lowerShotUsed ? 'LOWER HAND USED' : 'LOWER HAND AVAILABLE';
      case 'fly': return boss.caught ? 'FLY CAUGHT' : 'FLY LOOSE';
      case 'snakeEyes': return `${boss.mutatedFaces.length} SNAKE-EYED`;
      case 'infected': return `${boss.infectedFaces.length} INFECTED`;
    }
  })();
  return <Paper p="xs" className={`boss-panel boss-${boss.type}`} data-testid="boss-panel">
    <Group justify="space-between" gap="xs" wrap="nowrap" className="boss-compact-row"
      aria-label={`${definition.name}. ${compactStatus}`}>
      <Text fw={900}>{definition.name}</Text>
      <Text size="xs" fw={850} ta="right" data-testid={`boss-status-${boss.type}`}>{compactStatus}</Text>
    </Group>
  </Paper>;
}

export function BossPreview({ board }: { board: Board }) {
  const nextRound = board.bust ? board.round : board.round + 1;
  const bossType = board.bossSchedule[nextRound];
  if (!bossType) return null;
  const boss = BOSSES[bossType];
  return <Paper p="sm" className={`boss-preview boss-${bossType}`} data-testid="boss-preview">
    <Group justify="space-between"><div><Text size="xs" fw={900} tt="uppercase" lts=".14em">Incoming · Round {nextRound}</Text>
      <Text fw={950}>{boss.name}</Text></div><Badge variant="light">BOSS</Badge></Group>
    <Text size="sm" mt={5}>{boss.shortRule}</Text>
  </Paper>;
}
