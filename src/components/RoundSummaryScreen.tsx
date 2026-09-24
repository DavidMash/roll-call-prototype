import { Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { BOSSES } from '../game/bosses';
import type { Action, Board } from '../game/types';

export function RoundSummaryScreen({ board, busy, submit }: { board: Board; busy: boolean; submit: (action: Action) => void }) {
  const summary = board.roundSummary!;
  const rows = [
    ['Base Reward', summary.sources.baseRewardGold],
    ['Unused Rerolls', summary.sources.unusedRerollGold],
    ['Interest', summary.sources.interestGold],
    ['Golden', summary.sources.goldenGold],
    ['Jackpot', summary.sources.jackpotGold],
    ['Other Gold', summary.sources.otherGold],
    ['Boss Reward', summary.sources.bossRewardGold],
  ] as const;
  return <Paper className="round-summary-screen" p={{ base: 'md', sm: 'xl' }} data-testid="round-summary">
    <Stack gap="md">
      <div className="round-summary-heading">
        <Text className="summary-kicker" fw={900}>{summary.encounterType === 'boss' ? BOSSES[summary.bossType!].name : `ROUND ${summary.round}`}</Text>
        <Title order={2}>{summary.encounterType === 'boss' ? 'BOSS DEFEATED' : `ROUND ${summary.round} CLEARED`}</Title>
        <Text fw={800} size="lg" data-testid="summary-score">{summary.score.toLocaleString()} / {summary.target.toLocaleString()}</Text>
      </div>
      <Paper className="summary-gold-card" p="md">
        <Group justify="space-between" align="baseline">
          <Text fw={900}>GOLD EARNED</Text>
          <Text className="summary-total" fw={950} size="xl" data-testid="summary-gold-earned">+{summary.totalGoldEarned}</Text>
        </Group>
        <div className="summary-gold-rows" data-testid="summary-gold-breakdown">
          {rows.filter(([, amount], index) => amount > 0 || index < 3).map(([label, amount]) => <div className="summary-gold-row" key={label}>
            <Text size="sm">{label}</Text><Text size="sm" fw={850}>+{amount}</Text>
          </div>)}
        </div>
        <Group justify="space-between" mt="md" className="summary-gold-before-after" data-testid="summary-gold-before-after">
          <Text c="dimmed">Gold</Text><Text fw={900}>{summary.goldBefore} → {summary.goldAfter}</Text>
        </Group>
      </Paper>
      <Button size="md" disabled={busy} onClick={() => submit({ type: 'CONTINUE_ROUND_SUMMARY' })}>CONTINUE →</Button>
    </Stack>
  </Paper>;
}
