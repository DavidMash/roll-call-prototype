import { Badge, Button, Group, Paper, Progress, SimpleGrid, Stack, Text } from '@mantine/core';
import { BOSSES, createCursedDie, cursedFaceSummary, wardenCheckpoints } from '../game/bosses';
import { targetForRound } from '../game/config';
import { HANDS } from '../game/hands';
import type { Action, Board } from '../game/types';

export function BossPanel({ board, busy, submit }: { board: Board; busy: boolean; submit: (action: Action) => void }) {
  const boss = board.boss;
  if (!boss) return null;
  const definition = BOSSES[boss.type];
  return <Paper p="xs" className={`boss-panel boss-${boss.type}`} data-testid="boss-panel">
    <Group justify="space-between" align="flex-start" gap="xs">
      <div><Text size="xs" fw={900} tt="uppercase" lts=".14em">Boss Round {board.round}</Text>
        <Text fw={950}>{definition.name}</Text></div>
      <Badge color={boss.type === 'caller' ? 'violet' : boss.type === 'warden' ? 'cyan' : 'lime'}>{definition.motif}</Badge>
    </Group>
    {boss.type === 'caller' && <Group mt={6} justify="space-between" gap="xs">
      <Text size="sm"><strong>CALL:</strong> {HANDS[boss.calledHand].name}</Text>
      <Text size="sm" fw={800} c={boss.satisfied ? 'teal' : boss.playsRemaining <= 1 ? 'red' : undefined}>
        {boss.satisfied ? 'ANSWERED' : `${boss.playsRemaining} MANUAL ${boss.playsRemaining === 1 ? 'PLAY' : 'PLAYS'} LEFT`}
      </Text>
    </Group>}
    {boss.type === 'warden' && <Stack gap={5} mt={6}>
      <Group gap={5}>{boss.checkpoints.map((threshold, index) => <Badge key={threshold} size="sm"
        variant={index < boss.reachedCheckpoints ? 'filled' : 'light'} color="cyan">{threshold}</Badge>)}</Group>
      <Progress value={Math.min(100, board.score / board.target * 100)} color="cyan" size="sm" />
      {(boss.startingDieId === null || boss.pendingReinforcements > 0) && <div>
        <Text size="xs" fw={800} mb={4}>{boss.startingDieId === null ? 'CHOOSE YOUR STARTING DIE' : `CHOOSE REINFORCEMENT · ${boss.pendingReinforcements} PENDING`}</Text>
        <Group gap="xs">{board.dice.filter(die => die.owner === 'player' && !boss.activeDieIds.includes(die.id)).map(die =>
          <Button key={die.id} size="compact-sm" color="cyan" variant="light" disabled={busy}
            onClick={() => submit({ type: 'CHOOSE_WARDEN_DIE', dieId: die.id })}>Deploy D{die.id + 1} · face {die.value}</Button>)}</Group>
      </div>}
    </Stack>}
    {boss.type === 'hexer' && <div className="hexer-rule" data-testid="hexer-rule">
      <Text size="sm"><strong>CURSE:</strong> The Cursed Die must participate in every manual hand.</Text>
      <Text size="xs" c="dimmed">Its authored seven-face loadout remains active; face 7 is a genuine rank.</Text>
    </div>}
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
    {bossType === 'caller' && <Text size="xs" c="dimmed" mt={4}>The exact called hand is revealed when the encounter begins.</Text>}
    {bossType === 'warden' && <Text size="xs" mt={4}>Reinforcements at {wardenCheckpoints(targetForRound(nextRound)).join(', ')} points (10%, 25%, 45%, 70%).</Text>}
    {bossType === 'hexer' && <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={4} mt="xs">
      {createCursedDie().faces.map(face => <Text key={face.rank} size="xs"><strong>{face.rank}</strong> · {cursedFaceSummary(face.rank)}</Text>)}
    </SimpleGrid>}
  </Paper>;
}
