import { Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { formatExactScore } from '../game/copy';
import { formatEffectLevel } from '../game/effectLevel';
import { FLAMES } from '../game/flames';
import { SPECIAL_DICE } from '../game/specialDice';
import type { Action, Board, DiceInventory } from '../game/types';

const claimLabel = (count: number): string => count >= 3 ? 'CLAIM ALL 3' : `CHOOSE ${count}`;

export function InfernoEvaluationScreen({ board, inventory, submit }: {
  board: Board;
  inventory: DiceInventory;
  submit: (action: Action) => void;
}) {
  const deal = board.infernoEvaluation!;
  const requestedDie = deal.requestedDieId === null ? null : inventory.instances[deal.requestedDieId];

  if (deal.engulfed) return <Stack gap="md" align="center" justify="center"
    className="inferno-evaluation-screen engulfment-result-success" data-testid="engulfment-success">
    <Text fw={950} tt="uppercase" lts=".18em">DEAL ACCEPTED</Text>
    <Title order={1}>THE INFERNO GROWS</Title>
    <Text className="engulfment-new-multiplier">×{formatExactScore(deal.infernoMultiplierAfter)}</Text>
    <div className="snuffed-flames" aria-label="Flames given to the Inferno">{deal.flamesSnuffed.map(asset => <Badge
      className="snuffed-flame" key={asset.instanceId} color="dark" variant="filled">
      {FLAMES[asset.flame].name} · GIVEN
    </Badge>)}</div>
    {deal.requestedDieId !== null && <Text fw={800}>Die {deal.requestedDieId} · GIVEN</Text>}
    <Button color="red" variant="white" onClick={() => submit({ type: 'CONTINUE_INFERNO_EVALUATION' })}>CONTINUE</Button>
  </Stack>;

  return <Stack gap="lg" align="center" justify="center"
    className="inferno-evaluation-screen inferno-ready" data-testid="inferno-deal">
    <div>
      <Text fw={950} tt="uppercase" lts=".18em" c="orange">THE INFERNO HAS AN OFFER</Text>
      <Title order={1}>TAKE THE DEAL?</Title>
      <Text c="dimmed" ta="center">This offer is frozen. Keep playing and the next one may be different.</Text>
    </div>
    <Paper className="inferno-ready-consequences" p="md" withBorder w="100%" maw={720}>
      <Text size="xs" fw={900} tt="uppercase" c="red">The Inferno wants</Text>
      <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs" mt="xs" className="offered-flames"
        aria-label="Flames requested by the Inferno">
        {deal.flamesSnuffed.map(asset => <Paper withBorder p="sm" key={asset.instanceId}
          className="offered-flame is-selected" data-testid={`requested-flame-${asset.instanceId}`}>
          <Text fw={900}>{FLAMES[asset.flame].name}</Text>
          <Text size="xs" c="dimmed">{asset.kind === 'bonfire' ? 'BONFIRE' : 'EMBER'} · SLOT {asset.slot + 1}</Text>
        </Paper>)}
      </SimpleGrid>
      {requestedDie && <Paper withBorder p="sm" mt="sm" data-testid={`requested-die-${requestedDie.id}`}>
        <Text size="xs" fw={900} tt="uppercase" c="red">And this die</Text>
        <Text fw={900}>Die {requestedDie.id}</Text>
        <Text size="sm">{requestedDie.effects.length ? requestedDie.effects.map(effect =>
          `${SPECIAL_DICE[effect.type].name} ${formatEffectLevel(effect.level)}`).join(' + ') : 'Basic I'}</Text>
      </Paper>}
      <Stack gap={3} mt="md">
        <Text fw={950} data-testid="inferno-result-multiplier">Inferno ×{formatExactScore(deal.infernoMultiplierBefore)} → ×{formatExactScore(deal.infernoMultiplierAfter)}</Text>
        {board.runMode !== 'scenario' && <Text c="orange" fw={900}>{claimLabel(deal.rewardClaimCount)} INFERNO REWARDS</Text>}
        <Text size="xs" c="red.3" fw={800} mt={5}>Accepting cannot be undone.</Text>
      </Stack>
    </Paper>
    <Group className="inferno-ready-actions" justify="center">
      <Button size="md" color="red" onClick={() => submit({ type: 'ENGULF_NOW' })}>TAKE THE DEAL</Button>
      <Button size="md" variant="default" onClick={() => submit({ type: 'NOT_YET' })}>NOT YET</Button>
    </Group>
  </Stack>;
}
