import { Badge, Group, Paper, Text } from '@mantine/core';
import { BOSSES, isMiniBossType } from '../game/bosses';
import { HANDS } from '../game/hands';
import type { Board } from '../game/types';
import { formatPlayerNumber } from '../game/copy';

export function BossPanel({ board }: { board: Board }) {
  const boss = board.boss;
  if (!boss) return null;
  const definition = BOSSES[boss.type];
  const tier = isMiniBossType(boss.type) ? 'MINI-BOSS' : 'BOSS';
  if (board.bossSilenced) return <Paper p="xs" className={`boss-panel boss-${boss.type}`} data-testid="boss-panel">
    <Group justify="space-between"><Text fw={900}>{tier} · {definition.name}</Text><Badge color="teal">SILENCED</Badge></Group>
  </Paper>;
  const compactStatus = (() => {
    switch (boss.type) {
      case 'caller': return `CALL: ${HANDS[boss.calledHand].name.toUpperCase()} · DUE IN ${formatPlayerNumber(boss.playsRemaining)}`;
      case 'warden': return `${formatPlayerNumber(boss.activeDieIds.length)} / 5 DICE${boss.nextUnlockTarget === null ? ' · CHOOSE DIE' : ` · NEXT AT ${formatPlayerNumber(boss.nextUnlockTarget)}`}`;
      case 'hexer': return 'CURSED DIE REQUIRED';
      case 'marathon': return 'EXTRA LARGE GOAL';
      case 'quickdraw': return boss.lowerShotUsed ? 'LOWER HAND USED' : 'LOWER HAND AVAILABLE';
      case 'fly': return boss.caught ? 'FLY CAUGHT' : 'FLY LOOSE';
      case 'snakeEyes': return `${formatPlayerNumber(boss.mutatedFaces.length)} SNAKE-EYED`;
      case 'infected': return `${formatPlayerNumber(boss.infectedFaces.length)} INFECTED`;
      case 'juggler': return 'EXTRA DIE REROLL';
      case 'capitalReturn': return '−1 GOLD · LOWER';
      case 'neglected': return '2 HANDS NEGLECTED';
      case 'clockmaker': return 'EVERY ROLL BUMPS';
      case 'tightrope': return '0 REROLLS · HALF GOAL';
      case 'crawler': return '1 SCORING REROLL';
      case 'magician': return `CALLS ${formatPlayerNumber(boss.completedHands.length)} / ${formatPlayerNumber(boss.calledHands.length)}`;
      case 'mugger': return boss.spent && boss.revealedHand ? `${HANDS[boss.revealedHand].name.toUpperCase()} · SPENT` : 'HIDDEN LOWER HAND';
    }
  })();
  return <Paper p="xs" className={`boss-panel boss-${boss.type}`} data-testid="boss-panel">
    <Group justify="space-between" gap="xs" wrap="nowrap" className="boss-compact-row"
      aria-label={`${definition.name}. ${compactStatus}`}>
      <Text fw={900}><span className="boss-tier-label">{tier} · </span>{definition.name}</Text>
      <Text size="xs" fw={850} ta="right" data-testid={`boss-status-${boss.type}`}>{compactStatus}</Text>
    </Group>
    {boss.type === 'magician' && !boss.returned && <Group gap={4} mt={4} data-testid="magician-calls">
      {boss.calledHands.map(hand => <Badge key={hand} size="xs" variant="light"
        color={boss.completedHands.includes(hand) ? 'teal' : 'grape'}>{boss.completedHands.includes(hand) ? '✓ ' : ''}{HANDS[hand].name}</Badge>)}
    </Group>}
  </Paper>;
}

export function BossPreview({ board }: { board: Board }) {
  const nextRound = board.bust ? board.round : board.round + 1;
  const bossType = board.bossSchedule[nextRound];
  if (!bossType) return null;
  const boss = BOSSES[bossType];
  return <Paper p="sm" className={`boss-preview boss-${bossType}`} data-testid="boss-preview">
    <Group justify="space-between"><div><Text size="xs" fw={900} tt="uppercase" lts=".14em">Incoming · Round {formatPlayerNumber(nextRound)}</Text>
      <Text fw={950}>{boss.name}</Text></div><Badge variant="light">{isMiniBossType(bossType) ? 'MINI-BOSS' : 'BOSS'}</Badge></Group>
    <Text size="sm" mt={5}>{boss.shortRule}</Text>
  </Paper>;
}
