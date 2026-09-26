import { Badge, Button, Card, Group, Text } from '@mantine/core';
import { handTrainingCost, teamTrainingCost } from '../game/config';
import { handStats, HANDS } from '../game/hands';
import type { HandLevels, TrainingOffer } from '../game/types';
import { InfoPopover } from './InfoPopover';

export function TrainingCard({ offer, handLevels, gold, busy, onTrain }: {
  offer: TrainingOffer; handLevels: HandLevels; gold: number; busy: boolean; onTrain: () => void;
}) {
  if (offer.kind === 'team') {
    const cost = teamTrainingCost(offer.purchases);
    return <Card p="sm" className="training-card team-training-card" data-testid="training-offer-team">
      <Group className="training-card-header" justify="space-between" align="start" wrap="nowrap">
        <Group className="training-title-row" gap={3} wrap="nowrap"><Text className="training-name" fw={800} size="sm" tt="uppercase">Team Training</Text>
          <InfoPopover label="Team Training" description="Train every hand by one level." /></Group>
        <Badge size="xs" color="yellow" variant="filled">Special</Badge>
      </Group>
      {offer.purchases > 0 && <Text size="xs" mt={5} c="dimmed">Purchased {offer.purchases}× this Shop</Text>}
      <Button className="training-action" mt={6} size="compact-xs" fullWidth color="yellow" variant="light" disabled={busy || gold < cost}
        onClick={onTrain} data-testid="train-team">
        Train ALL · {cost} gold
      </Button>
    </Card>;
  }

  const currentLevel = handLevels[offer.hand];
  const nextLevel = currentLevel + 1;
  const current = handStats(offer.hand, currentLevel);
  const next = handStats(offer.hand, nextLevel);
  const cost = handTrainingCost(offer.purchases);
  return <Card p="sm" className="training-card" data-testid={`training-offer-${offer.hand}`}>
    <Group className="training-card-header" justify="space-between" align="start" wrap="nowrap">
      <div className="training-heading"><Group className="training-title-row" gap={3} wrap="nowrap"><Text className="training-name" fw={700} size="sm" tt="uppercase">{HANDS[offer.hand].name}</Text>
        <InfoPopover label={`${HANDS[offer.hand].name} training`} description={`Train ${HANDS[offer.hand].name} by one level, increasing its base Pips and Mult.`} /></Group>
        <Text className="training-level" size="xs" c="dimmed">Lv.{currentLevel} → {nextLevel}</Text></div>
      {offer.purchases > 0 && <Badge size="xs" color="teal" variant="light">Trained ×{offer.purchases}</Badge>}
    </Group>
    <Group className="training-stats" gap="md" mt={5} wrap="nowrap">
      <Text size="xs" data-testid={`training-pips-${offer.hand}`}>{current.basePips} → {next.basePips} Pips</Text>
      <Text size="xs" fw={600} c="violet" data-testid={`training-mult-${offer.hand}`}>×{current.baseMultiplier} → ×{next.baseMultiplier} Mult</Text>
    </Group>
    <Button className="training-action" mt={6} size="compact-xs" fullWidth color="violet" variant="light" disabled={busy || gold < cost}
      onClick={onTrain} data-testid={`train-${offer.hand}`}>
      Train · {cost} gold
    </Button>
  </Card>;
}
