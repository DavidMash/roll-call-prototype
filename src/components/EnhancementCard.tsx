import { Badge, Button, Card, Group, Text } from '@mantine/core';
import { enhancementCost, ENHANCEMENTS } from '../game/enhancements';
import type { Offer } from '../game/types';

export function EnhancementCard({ offer, selected, gold, busy, onSelect }: {
  offer: Offer; selected: boolean; gold: number; busy: boolean; onSelect: () => void;
}) {
  const definition = ENHANCEMENTS[offer.enhancement];
  const affordable = gold >= enhancementCost(offer.enhancement);
  const enabled = !busy && !offer.purchased && affordable;
  return <Card withBorder p="md" className={`offer ${selected ? 'selected' : ''} ${offer.purchased ? 'purchased' : ''}`}
    data-testid={`offer-${offer.enhancement}`} draggable={enabled}
    onDragStart={event => {
      if (!enabled) { event.preventDefault(); return; }
      event.dataTransfer.setData('application/x-roll-call-offer', String(offer.id));
      event.dataTransfer.effectAllowed = 'copy';
      onSelect();
    }}>
    <Group justify="space-between" align="start" wrap="nowrap">
      <Text fw={650}>{definition.name}</Text>
      <Badge variant="light" color="yellow" style={{ flexShrink: 0 }}>{enhancementCost(offer.enhancement)} gold</Badge>
    </Group>
    <Text size="sm" c="dimmed" mt="sm" className="offer-description">{definition.description}</Text>
    <Text size="xs" c="dimmed" mb="sm">{definition.stackable ? 'Stackable on a face' : 'One per physical face'}</Text>
    <Button variant={selected ? 'filled' : 'light'} disabled={!enabled} onClick={onSelect} aria-pressed={selected}>
      {offer.purchased ? 'Purchased' : !affordable ? 'Need more gold' : selected ? 'Click an exposed face' : 'Select or drag'}
    </Button>
  </Card>;
}
