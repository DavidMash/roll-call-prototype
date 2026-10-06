import { Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { BOSSES, isMiniBossType } from '../game/bosses';
import type { Action, Board } from '../game/types';
import { formatPlayerNumber, formatScoreProgress } from '../game/copy';
import { fullChapterLabels } from '../game/chapters';
import { RunActionPortal } from './RunActionRow';

export function RoundSummaryScreen({ board, busy, submit }: { board: Board; busy: boolean; submit: (action: Action) => void }) {
  const summary = board.roundSummary!;
  const miniBoss = summary.bossType ? isMiniBossType(summary.bossType) : false;
  const labels = fullChapterLabels(summary.round);
  const rows = [
    ['Base Reward', summary.sources.baseRewardGold],
    ['Unused Rerolls', summary.sources.unusedRerollGold],
    ['Interest', summary.sources.interestGold],
    ['Golden', summary.sources.goldenGold],
    ['Jackpot', summary.sources.jackpotGold],
    ['Other Gold', summary.sources.otherGold],
    [miniBoss ? 'Mini-Boss Reward' : 'Boss Reward', summary.sources.bossRewardGold],
  ] as const;
  return <Paper className="round-summary-screen" p={{ base: 'md', sm: 'xl' }} data-testid="round-summary">
    <Stack gap="md">
      <div className="round-summary-heading">
        <Text className="summary-chapter" fw={900}>{labels.chapter}</Text>
        <Text className="summary-kicker" fw={900}>{labels.round}</Text>
        <Title order={2}>{summary.encounterType === 'boss' ? `${miniBoss ? 'MINI-BOSS' : 'BOSS'} DEFEATED` : `${labels.round} CLEARED`}</Title>
        {summary.encounterType === 'boss' && <Text fw={850}>{BOSSES[summary.bossType!].name}</Text>}
        <Text fw={800} size="lg" data-testid="summary-score">{formatScoreProgress(summary.score, summary.target)}</Text>
      </div>
      <Paper className="summary-gold-card" p="md" data-tutorial="payout">
        <Group justify="space-between" align="baseline">
          <Text fw={900}>GOLD EARNED</Text>
          <Text className="summary-total" fw={950} size="xl" data-testid="summary-gold-earned">+{formatPlayerNumber(summary.totalGoldEarned)}</Text>
        </Group>
        <div className="summary-gold-rows" data-testid="summary-gold-breakdown">
          {rows.filter(([, amount], index) => amount > 0 || index < 3).map(([label, amount]) => <div className="summary-gold-row" key={label}
            data-tutorial={label === 'Unused Rerolls' ? 'payout-rerolls' : label === 'Interest' ? 'payout-interest' : undefined}>
            <Text size="sm">{label}</Text><Text size="sm" fw={850}>+{formatPlayerNumber(amount)}</Text>
          </div>)}
        </div>
        <Group justify="space-between" mt="md" className="summary-gold-before-after" data-testid="summary-gold-before-after">
          <Text c="dimmed">Gold</Text><Text fw={900}>{formatPlayerNumber(summary.goldBefore)} → {formatPlayerNumber(summary.goldAfter)}</Text>
        </Group>
      </Paper>
      <RunActionPortal><div className="run-action-primary"><Button size="md" disabled={busy}
        onClick={() => submit({ type: 'CONTINUE_ROUND_SUMMARY' })}>CONTINUE →</Button></div></RunActionPortal>
    </Stack>
  </Paper>;
}
