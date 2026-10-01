import { Badge, Button, Card, Group, Text } from '@mantine/core';
import { enhancementCost, ENHANCEMENTS } from '../game/enhancements';
import type { Enhancement, Offer } from '../game/types';
import { InfoPopover } from './InfoPopover';
import { formatPlayerNumber } from '../game/copy';
const ICON: Record<Enhancement, string> = {
  bonus: '+', jumpingBean: '↯', golden: '●', workout: '▲', missingLink: '⛓', mirror: '◇',
  magnetic: '∩', sticky: '⚓', slippy: '↻', hitchhiker: '♟', weighted: '▼', jackpot: '★', personalTrainer: 'T', bump: '↑', vintage: 'V',
};
export function EnhancementCard({ offer, selected, gold, busy, onSelect }: {
  offer: Offer; selected: boolean; gold: number; busy: boolean; onSelect: () => void;
}) {
  const definition = ENHANCEMENTS[offer.enhancement];
  const affordable = gold >= enhancementCost(offer.enhancement);
  const enabled = !busy && !offer.purchased && affordable;
  return <Card p="sm" className={`offer ${selected ? 'selected' : ''} ${offer.purchased ? 'purchased' : ''}`}
    data-testid={`offer-${offer.enhancement}`} draggable={enabled}
    onDragStart={event => { if (!enabled) { event.preventDefault(); return; } event.dataTransfer.setData('application/x-roll-call-offer', String(offer.id)); event.dataTransfer.effectAllowed = 'copy'; onSelect(); }}>
    <Group className="offer-card-header" justify="space-between" align="center" wrap="nowrap">
      <Group className="offer-identity" gap={4} wrap="nowrap"><span className="offer-icon" aria-hidden="true">{ICON[offer.enhancement]}</span><Text className="offer-name" fw={700} size="sm">{definition.name}</Text>
        <InfoPopover label={definition.name} description={definition.description} /></Group>
      <Badge className="offer-price" size="sm" variant="light" color="yellow">{formatPlayerNumber(enhancementCost(offer.enhancement))} GOLD</Badge>
    </Group>
    <Button className="offer-action" mt="xs" size="compact-xs" fullWidth variant={selected ? 'filled' : 'light'} disabled={!enabled} onClick={onSelect} aria-pressed={selected}>
      {offer.purchased ? 'PURCHASED' : !affordable ? 'NEED MORE GOLD' : selected ? 'CHOOSE A FACE' : 'SELECT OR DRAG'}
    </Button>
  </Card>;
}
