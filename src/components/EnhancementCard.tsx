import { Badge, Button, Card, Group, Text } from '@mantine/core';
import { enhancementCost, ENHANCEMENTS } from '../game/enhancements';
import type { Offer } from '../game/types';
import { InfoPopover } from './InfoPopover';
import { formatPlayerNumber } from '../game/copy';
import { EnhancementIdentity } from './EnhancementIdentity';
import { rarityClassName, rarityLabel } from '../game/rarity';
import { RarityBadge } from './RarityBadge';
export function EnhancementCard({ offer, selected, gold, busy, free = false, onSelect }: {
  offer: Offer; selected: boolean; gold: number; busy: boolean; free?: boolean; onSelect: () => void;
}) {
  const definition = ENHANCEMENTS[offer.enhancement];
  const affordable = free || gold >= enhancementCost(offer.enhancement);
  const enabled = !busy && !offer.purchased && affordable;
  return <Card p="sm" className={`offer ${rarityClassName(definition.rarity)} ${selected ? 'selected' : ''} ${offer.purchased ? 'purchased' : ''}`}
    aria-label={`${definition.name}, ${rarityLabel(definition.rarity)} Enhancement`}
    data-testid={`offer-${offer.enhancement}`} data-tutorial={`enhancement-${offer.enhancement}`} draggable={enabled}
    onDragStart={event => { if (!enabled) { event.preventDefault(); return; } event.dataTransfer.setData('application/x-roll-call-offer', String(offer.id)); event.dataTransfer.effectAllowed = 'copy'; onSelect(); }}>
    <Group className="offer-card-header" justify="space-between" align="center" wrap="nowrap">
      <Group className="offer-identity" gap={4} wrap="nowrap"><Text className="offer-name" fw={700} size="sm">
        <EnhancementIdentity enhancement={offer.enhancement} className="offer-enhancement-identity" />
      </Text><InfoPopover label={`${definition.name}, ${rarityLabel(definition.rarity)} Enhancement`} description={definition.description}
          heading={<EnhancementIdentity enhancement={offer.enhancement} />} meta={<RarityBadge rarity={definition.rarity} compact />} /></Group>
      <RarityBadge rarity={definition.rarity} compact />
      <Badge className="offer-price" size="sm" variant="light" color="yellow">{free ? 'FREE' : `${formatPlayerNumber(enhancementCost(offer.enhancement))} GOLD`}</Badge>
    </Group>
    <Button className="offer-action" mt="xs" size="compact-xs" fullWidth variant={selected ? 'filled' : 'light'} disabled={!enabled} onClick={onSelect} aria-pressed={selected}>
      {offer.purchased ? 'PURCHASED' : !affordable ? 'NEED MORE GOLD' : selected ? 'CHOOSE A FACE' : 'SELECT OR DRAG'}
    </Button>
  </Card>;
}
