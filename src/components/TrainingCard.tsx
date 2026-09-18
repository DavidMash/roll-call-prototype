import { Badge, Button, Card, Group, Text } from '@mantine/core';
import { CONFIG } from '../game/config';
import { handStats, HANDS } from '../game/hands';
import type { TrainingOffer } from '../game/types';

export function TrainingCard({ offer, level, gold, busy, onTrain }: {
  offer: TrainingOffer; level: number; gold: number; busy: boolean; onTrain: () => void;
}) {
  const offeredLevel = offer.purchased ? level - 1 : level;
  const nextLevel = offeredLevel + 1;
  const current = handStats(offer.hand, offeredLevel);
  const next = handStats(offer.hand, nextLevel);
  return <Card p="sm" className="training-card" data-testid={`training-offer-${offer.hand}`}>
    <Group justify="space-between" align="start" wrap="nowrap">
      <div><Text fw={700} size="sm" tt="uppercase">{HANDS[offer.hand].name}</Text><Text size="xs" c="dimmed">Lv.{offeredLevel} → {nextLevel}</Text></div>
      {offer.purchased && <Badge size="xs" color="teal" variant="light">Purchased</Badge>}
    </Group>
    <Group gap="md" mt={5} wrap="nowrap">
      <Text size="xs" data-testid={`training-pips-${offer.hand}`}>{current.basePips} → {next.basePips} Pips</Text>
      <Text size="xs" fw={600} c="violet" data-testid={`training-mult-${offer.hand}`}>×{current.baseMultiplier} → ×{next.baseMultiplier} Mult</Text>
    </Group>
    <Button mt={6} size="compact-xs" fullWidth color="violet" variant="light" disabled={busy || offer.purchased || gold < CONFIG.handTrainingCost}
      onClick={onTrain} data-testid={`train-${offer.hand}`}>
      {offer.purchased ? 'Trained' : `Train · ${CONFIG.handTrainingCost} gold`}
    </Button>
  </Card>;
}
