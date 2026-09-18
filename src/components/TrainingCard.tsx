import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import { CONFIG } from '../game/config';
import { handStats, HANDS } from '../game/hands';
import type { TrainingOffer } from '../game/types';

export function TrainingCard({ offer, level, gold, busy, onTrain }: {
  offer: TrainingOffer;
  level: number;
  gold: number;
  busy: boolean;
  onTrain: () => void;
}) {
  const offeredLevel = offer.purchased ? level - 1 : level;
  const nextLevel = offeredLevel + 1;
  const current = handStats(offer.hand, offeredLevel);
  const next = handStats(offer.hand, nextLevel);
  return <Card withBorder padding="md" data-testid={`training-offer-${offer.hand}`}>
    <Stack gap="xs">
      <Group justify="space-between" align="start">
        <div>
          <Text fw={700}>{HANDS[offer.hand].name}</Text>
          <Text size="xs" c="dimmed">Level {offeredLevel} → {nextLevel}</Text>
        </div>
        {offer.purchased && <Badge color="teal" variant="light">Purchased</Badge>}
      </Group>
      <Text size="sm" data-testid={`training-pips-${offer.hand}`}>{current.basePips} → {next.basePips} Pips</Text>
      <Text size="sm" fw={600} c="teal" data-testid={`training-mult-${offer.hand}`}>×{current.baseMultiplier} → ×{next.baseMultiplier} Mult</Text>
      <Button mt="xs" disabled={busy || offer.purchased || gold < CONFIG.handTrainingCost}
        onClick={onTrain} data-testid={`train-${offer.hand}`}>
        {offer.purchased ? 'Trained' : `Train · ${CONFIG.handTrainingCost} gold`}
      </Button>
    </Stack>
  </Card>;
}
