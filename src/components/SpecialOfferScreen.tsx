import { Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { SPECIAL_OFFERS, specialOfferDescription, specialOfferName } from '../game/specialOffers';
import { rarityClassName, rarityLabel } from '../game/rarity';
import { RarityBadge } from './RarityBadge';
import type { Action, Board } from '../game/types';
import { RunActionPortal } from './RunActionRow';

export function SpecialOfferScreen({ board, busy, submit }: {
  board: Board;
  busy: boolean;
  submit: (action: Action) => void;
}) {
  const selection = board.specialOffer!;
  return <Stack gap="md" className="special-offer-screen">
    <Paper p="lg" className="special-offer-heading">
      <Group justify="space-between" align="flex-start">
        <div><Text size="xs" fw={850} tt="uppercase" lts=".14em" c="teal">Mini-Boss Reward</Text>
          <Title order={2}>SPECIAL OFFER</Title></div>
        <Badge color="teal" variant="light">CHOOSE 1</Badge>
      </Group>
    </Paper>
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md" data-tutorial="special-offers">
      {selection.offers.map(offer => {
        const chosen = selection.chosen?.id === offer.id;
        const rarity = SPECIAL_OFFERS[offer.type].rarity;
        return <Paper key={offer.id} withBorder p="lg" className={`special-offer-card ${rarityClassName(rarity)} ${chosen ? 'selected' : ''}`}
          aria-label={`${specialOfferName(offer)}, ${rarityLabel(rarity)} Special Offer`}>
          <Stack gap="sm" h="100%">
            <Title order={3}>{specialOfferName(offer)}</Title>
            <RarityBadge rarity={rarity} compact />
            <Text size="sm" c="dimmed" style={{ flex: 1 }}>{specialOfferDescription(offer)}</Text>
            <Button color="teal" disabled={busy || selection.acquired} onClick={() => submit({ type: 'CHOOSE_SPECIAL_OFFER', offerId: offer.id })}>
              {chosen ? 'CHOSEN' : 'CHOOSE'}
            </Button>
          </Stack>
        </Paper>;
      })}
    </SimpleGrid>
    {selection.acquired && <RunActionPortal><div className="run-action-primary"><Button color="teal" disabled={busy}
      onClick={() => submit({ type: 'CONTINUE_SPECIAL_OFFER' })}>CONTINUE →</Button></div></RunActionPortal>}
  </Stack>;
}
