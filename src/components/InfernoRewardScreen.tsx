import { Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { CURATED_DIE_BUILDS, INFERNO_REWARD_OFFERS } from '../game/infernoRewards';
import { SPECIAL_DICE } from '../game/specialDice';
import type { Action, Board, DiceInventory, DiceSlotRef } from '../game/types';
import { CollectibleDieVisual } from './CollectibleDieVisual';
import { DieEffectsLabel } from './DieTypeLabel';
import { RarityBadge } from './RarityBadge';

export function InfernoRewardScreen({ board, inventory, busy, submit }: {
  board: Board;
  inventory: DiceInventory;
  busy: boolean;
  submit: (action: Action) => void;
}) {
  const selection = board.infernoRewards.pending!;
  const makeRoom = selection.makeRoomOfferId;
  if (makeRoom) {
    const reward = INFERNO_REWARD_OFFERS[makeRoom];
    const slots = (area: DiceSlotRef['area'], ids: (number | null)[]) => ids.flatMap((id, index) => {
      if (id == null) return [];
      const die = inventory.instances[id];
      if (!die) return [];
      const destination = { area, index } satisfies DiceSlotRef;
      return <Paper key={`${area}:${index}`} withBorder p="sm" className="inferno-make-room-die">
        <Stack gap="xs" align="center">
          <CollectibleDieVisual effects={die.effects} face={die.value as 1 | 2 | 3 | 4 | 5 | 6} compact />
          <Text size="xs" fw={800}>{area === 'roster' ? 'Roster' : 'Storage'} {index + 1} · Die {id}</Text>
          <Text size="xs" c="dimmed" ta="center">{die.effects.length ? <DieEffectsLabel effects={die.effects} compact /> : 'Normal'}</Text>
          <Button color="red" variant="light" size="xs" disabled={busy}
            onClick={() => submit({ type: 'PLACE_INFERNO_DIE', destination, expectedDieId: id })}>
            REPLACE WITH REWARD
          </Button>
        </Stack>
      </Paper>;
    });
    return <Stack gap="md" className="inferno-reward-screen" data-testid="inferno-make-room">
      <Paper p="lg" className="inferno-reward-heading"><Title order={2}>MAKE ROOM</Title>
        <Text mt="xs">Choose one die to replace with <strong>{reward.name}</strong>. No die will be sold and no sale Gold is awarded.</Text></Paper>
      <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="sm">{slots('roster', inventory.roster)}{slots('storage', inventory.storage)}</SimpleGrid>
      <Button variant="default" disabled={busy} onClick={() => submit({ type: 'CANCEL_INFERNO_MAKE_ROOM' })}>
        CANCEL · BACK TO REWARDS
      </Button>
    </Stack>;
  }
  return <Stack gap="md" className="inferno-reward-screen" data-testid="inferno-reward-screen">
    <Paper p="lg" className="inferno-reward-heading">
      <Group justify="space-between" align="flex-start">
        <div><Text size="xs" fw={850} tt="uppercase" lts=".14em" c="orange">Engulfment Reward</Text>
          <Title order={2}>INFERNO REWARD</Title></div>
        <Badge color="orange" variant="light">CHOOSE 1</Badge>
      </Group>
    </Paper>
    <SimpleGrid cols={{ base: 1, sm: Math.max(1, Math.min(3, selection.offers.length)) }} spacing="md">
      {selection.offers.map(id => {
        const definition = INFERNO_REWARD_OFFERS[id];
        const build = CURATED_DIE_BUILDS[id];
        const recycled = selection.recycledOfferIds.includes(id);
        return <Paper key={id} withBorder p="lg" className={`inferno-reward-card rarity-${definition.rarity}`}
          aria-label={`${definition.name}, ${definition.rarity} Inferno Reward`}>
          <Stack gap="sm" h="100%">
            <Group justify="space-between" align="flex-start"><Title order={3}>{definition.name}</Title>
              <Badge size="xs" variant="outline">{definition.category.toUpperCase()}</Badge></Group>
            <Group gap="xs"><RarityBadge rarity={definition.rarity} compact />{recycled && <Badge size="xs" color="gray">RECYCLED</Badge>}</Group>
            <Text style={{ flex: 1 }}>{definition.description}</Text>
            {build && <Paper p="xs" className="inferno-die-build"><Text size="xs" fw={850} tt="uppercase">Component build</Text>
              <Text size="sm">{build.map(([type, level]) => `${SPECIAL_DICE[type].name} ${level}`).join(' + ')}</Text></Paper>}
            <Button color="orange" disabled={busy} onClick={() => submit({ type: 'CHOOSE_INFERNO_REWARD', offerId: id })}>CHOOSE</Button>
          </Stack>
        </Paper>;
      })}
    </SimpleGrid>
  </Stack>;
}
