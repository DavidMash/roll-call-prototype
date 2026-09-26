import { Badge, Group, Paper, Stack, Text } from '@mantine/core';
import { BOSSES } from '../game/bosses';
import { HANDS } from '../game/hands';
import type { Board } from '../game/types';

export function BossPanel({ board }: { board: Board }) {
  const boss = board.boss;
  if (!boss) return null;
  const definition = BOSSES[boss.type];
  const compactStatus = (() => {
    switch (boss.type) {
      case 'caller': return `${HANDS[boss.calledHand].name} · ${boss.playsRemaining} ${boss.playsRemaining === 1 ? 'PLAY' : 'PLAYS'}`;
      case 'warden': return `${boss.activeDieIds.length}/5 DICE${boss.nextUnlockTarget === null ? ' · CHOOSE DIE' : ` · NEXT ${boss.nextUnlockTarget}`}`;
      case 'hexer': return 'CURSED DIE · REQUIRED';
      case 'marathon': return '3× TARGET · 7-PLAY COOLDOWN';
      case 'quickdraw': return boss.lowerShotUsed ? 'SHOT USED' : '1 SHOT AVAILABLE';
      case 'fly': return boss.caught ? 'FLY CAUGHT' : 'FLY LOOSE · ×0.5';
      case 'snakeEyes': return `${boss.mutatedFaces.length} SNAKE-EYED`;
      case 'infected': return `${boss.infectedFaces.length} INFECTED FACES`;
    }
  })();
  return <Paper p="xs" className={`boss-panel boss-${boss.type}`} data-testid="boss-panel">
    <details className="boss-details">
      <summary className="boss-compact-row" aria-label={`${definition.name}. ${compactStatus}. Expand boss details`}>
        <strong>{definition.name}</strong><span aria-hidden="true"> · {compactStatus}</span><span className="boss-expand" aria-hidden="true">⌄</span>
      </summary>
      <div className="boss-full-details">
        <Group justify="space-between" align="flex-start" gap="xs">
          <div><Text size="xs" fw={900} tt="uppercase" lts=".14em">Boss Round {board.round}</Text>
            <Text fw={950}>{definition.name}</Text></div>
          <Badge style={{ backgroundColor: definition.primary }}>BOSS</Badge>
        </Group>
        {boss.type === 'caller' && <Group mt={6} justify="space-between" gap="xs">
          <Text size="sm"><strong>CALL:</strong> {HANDS[boss.calledHand].name}</Text>
          <Text size="sm" fw={800} c={boss.playsRemaining <= 1 ? 'red' : undefined}>
            {boss.playsRemaining} {boss.playsRemaining === 1 ? 'PLAY' : 'PLAYS'} LEFT
          </Text>
        </Group>}
        {boss.type === 'warden' && <Stack gap={5} mt={6}>
          <Text size="xs" fw={800} data-testid="warden-active-dice">{boss.activeDieIds.length} / 5 DICE UNLOCKED</Text>
          {boss.nextUnlockTarget !== null && <Text size="xs" fw={800} data-testid="warden-next-target">NEXT DIE AT {boss.nextUnlockTarget}</Text>}
        </Stack>}
        {boss.type === 'hexer' && <div className="hexer-rule" data-testid="hexer-rule">
          <Text size="sm"><strong>CURSE:</strong> Include the Cursed Die whenever you play a hand.</Text>
        </div>}
        {boss.type === 'marathon' && <Text size="sm" mt={6}><strong>3× TARGET</strong> · Played hands recharge after seven subsequent manual plays.</Text>}
        {boss.type === 'quickdraw' && <Text size="sm" mt={6} fw={800}>{boss.lowerShotUsed
          ? `SHOT USED · ${boss.playedLowerHand ? HANDS[boss.playedLowerHand].name : 'Lower hand'} locked in`
          : '1 SHOT AVAILABLE'}</Text>}
        {boss.type === 'fly' && <Text size="sm" mt={6} fw={800}>{boss.caught ? 'FLY CAUGHT' : 'FLY LOOSE · ×0.5'}</Text>}
        {boss.type === 'snakeEyes' && <Text size="sm" mt={6}><strong>{boss.mutatedFaces.length} SNAKE-EYED</strong> · Up to two scoring faces become 1 after each hand.</Text>}
        {boss.type === 'infected' && <Text size="sm" mt={6}><strong>{boss.infectedFaces.length} INFECTED FACES</strong> · −3 Pips (minimum 0); enhancements disabled.</Text>}
      </div>
    </details>
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
