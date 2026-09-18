import { Badge, Button, Card, Group, Text, Tooltip } from '@mantine/core';
import { enhancementCost, ENHANCEMENTS } from '../game/enhancements';
import type { Enhancement, Offer } from '../game/types';

const SHORT_DESCRIPTION: Record<Enhancement, string> = {
  bonus: 'Adds Pips whenever this face scores.',
  multiplier: 'Raises Mult when this face participates.',
  jumpingBean: 'Scores and rerolls whenever this face is rolled.',
  golden: 'Earns Gold whenever this face scores.',
  workout: 'Permanently gains a Pip after scoring.',
  missingLink: 'Acts as a wild rank for straights.',
  mirror: 'Acts as a wild rank for matching hands.',
  magnetic: 'Flips magnetic dice to magnetic faces.',
  sticky: 'Chance to prevent a scored reroll.',
  slippy: 'Rerolls after a played hand continues.',
  sustainable: 'Chance to keep the played hand available.',
  hitchhiker: 'Adds its Pips when held out of the hand.',
  weighted: 'Raises the roll weight of the opposite face.',
  jackpot: 'Earns Gold when held out of the winning hand.',
};
const ICON: Record<Enhancement, string> = {
  bonus: '+', multiplier: '×', jumpingBean: '↯', golden: '●', workout: '▲', missingLink: '⛓', mirror: '◇',
  magnetic: '∩', sticky: '⚓', slippy: '↻', sustainable: '♻', hitchhiker: '♟', weighted: '▼', jackpot: '★',
};

export function EnhancementCard({ offer, selected, gold, busy, onSelect }: {
  offer: Offer; selected: boolean; gold: number; busy: boolean; onSelect: () => void;
}) {
  const definition = ENHANCEMENTS[offer.enhancement];
  const affordable = gold >= enhancementCost(offer.enhancement);
  const enabled = !busy && !offer.purchased && affordable;
  return <Card p="sm" className={`offer ${selected ? 'selected' : ''} ${offer.purchased ? 'purchased' : ''}`}
    data-testid={`offer-${offer.enhancement}`} draggable={enabled}
    onDragStart={event => {
      if (!enabled) { event.preventDefault(); return; }
      event.dataTransfer.setData('application/x-roll-call-offer', String(offer.id));
      event.dataTransfer.effectAllowed = 'copy';
      onSelect();
    }}>
    <Group justify="space-between" align="center" wrap="nowrap">
      <Group gap="xs" wrap="nowrap"><span className="offer-icon" aria-hidden="true">{ICON[offer.enhancement]}</span><Text fw={700} size="sm">{definition.name}</Text></Group>
      <Badge size="sm" variant="light" color="yellow" style={{ flexShrink: 0 }}>{enhancementCost(offer.enhancement)} gold</Badge>
    </Group>
    <Tooltip label={definition.description} multiline maw={320} withArrow>
      <Text size="xs" c="dimmed" mt={5} className="offer-description">{SHORT_DESCRIPTION[offer.enhancement]}</Text>
    </Tooltip>
    <Button mt="xs" size="compact-xs" fullWidth variant={selected ? 'filled' : 'light'} disabled={!enabled} onClick={onSelect} aria-pressed={selected}>
      {offer.purchased ? 'Purchased' : !affordable ? 'Need more gold' : selected ? 'Click an exposed face' : 'Select or drag'}
    </Button>
  </Card>;
}
