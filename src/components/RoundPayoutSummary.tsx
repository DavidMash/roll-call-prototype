import { Group, Text } from '@mantine/core';
import { roundReward } from '../game/config';
import type { Board } from '../game/types';

export function RoundPayoutSummary({ board }: { board: Board }) {
  const payout = board.lastRoundPayout;
  const total = payout?.totalRoundRewardGold ?? roundReward();
  return <div className="round-payout-summary" data-testid="round-payout-summary">
    <Group gap="xs" align="baseline" wrap="wrap">
      <Text size="sm" fw={700}>Round {board.round} cleared</Text>
      <Text fw={850} c="yellow">+{total} Gold</Text>
      <Text size="xs" c="dimmed">{board.score - board.target} above goal</Text>
    </Group>
    {payout && <Text size="xs" c="dimmed" data-testid="round-payout-breakdown">
      {payout.baseGold} base + {payout.unusedRerollGold} rerolls + {payout.interestGold} interest
      {payout.flameBonusGold > 0 ? ` + ${payout.flameBonusGold} Flame Bonus` : ''}
    </Text>}
  </div>;
}
