import { Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { BOSSES, isMiniBossType } from '../game/bosses';
import type { Action, Board } from '../game/types';
import { formatPlayerNumber, formatScoreProgress } from '../game/copy';
import { fullChapterLabels } from '../game/chapters';
import { RunActionPortal } from './RunActionRow';
import { CurrencyAmount } from './CurrencyAmount';

export function RoundSummaryScreen({ board, busy, submit }: { board: Board; busy: boolean; submit: (action: Action) => void }) {
  const summary = board.roundSummary!;
  const miniBoss = summary.bossType ? isMiniBossType(summary.bossType) : false;
  const labels = fullChapterLabels(summary.round);
  const displayLabels = board.runMode === 'scenario'
    ? { chapter: 'SCENARIO', round: `ROUND ${formatPlayerNumber(summary.round)}` } : labels;
  const rows: { source: string; label: string; amount: number }[] = [
    { source: 'base', label: 'Base Reward', amount: summary.sources.baseRewardGold },
    { source: 'rerolls', label: 'Unused Rerolls', amount: summary.sources.unusedRerollGold },
    { source: 'interest', label: 'Interest', amount: summary.sources.interestGold },
    { source: 'golden', label: 'Golden', amount: summary.sources.goldenGold },
    { source: 'jackpot', label: 'Jackpot', amount: summary.sources.jackpotGold },
    { source: 'other', label: 'Other Gold', amount: summary.sources.otherGold },
    { source: 'boss', label: miniBoss ? 'Mini-Boss Reward' : 'Boss Reward', amount: summary.sources.bossRewardGold },
  ];
  const temperRows = [
    { source: 'overkill', label: 'Overkill', amount: summary.temper.overkill },
    { source: 'boardRefresh', label: 'Board Refresh', amount: summary.temper.boardRefresh },
    { source: 'miniBoss', label: 'Mini-Boss', amount: summary.temper.miniBoss },
    { source: 'boss', label: 'Boss', amount: summary.temper.boss },
  ];
  return <Paper className="round-summary-screen" p={{ base: 'md', sm: 'xl' }} data-testid="round-summary">
    <Stack gap="md">
      <div className="round-summary-heading">
        <Text className="summary-chapter" fw={900}>{displayLabels.chapter}</Text>
        <Text className="summary-kicker" fw={900}>{displayLabels.round}</Text>
        <Title order={2}>{summary.encounterType === 'boss' ? `${miniBoss ? 'MINI-BOSS' : 'BOSS'} DEFEATED` : `${displayLabels.round} CLEARED`}</Title>
        {summary.encounterType === 'boss' && <Text fw={850}>{BOSSES[summary.bossType!].name}</Text>}
        <Text fw={800} size="lg" data-testid="summary-score">{formatScoreProgress(summary.score, summary.target)}</Text>
      </div>
      <Paper className="summary-gold-card" p="md" data-tutorial="payout">
        <Group justify="space-between" align="baseline">
          <Text fw={900}>GOLD EARNED</Text>
          <Text className="summary-total" fw={950} size="xl" data-testid="summary-gold-earned"><CurrencyAmount currency="gold" value={summary.totalGoldEarned} sign="+" /></Text>
        </Group>
        <div className="summary-gold-rows" data-testid="summary-gold-breakdown">
          {rows.filter((row, index) => row.amount > 0 || index < 3).map(({ source, label, amount }) => <div className="summary-gold-row" key={label}
            data-currency-source={`summary-gold-${source}`}
            data-tutorial={label === 'Unused Rerolls' ? 'payout-rerolls' : label === 'Interest' ? 'payout-interest' : undefined}>
            <Text size="sm">{label}</Text><Text size="sm" fw={850}><CurrencyAmount currency="gold" value={amount} sign="+" /></Text>
          </div>)}
        </div>
        <Group justify="space-between" mt="md" className="summary-gold-before-after" data-testid="summary-gold-before-after">
          <Text c="dimmed">Gold</Text><Text fw={900}><CurrencyAmount currency="gold" value={summary.goldBefore} /> → <CurrencyAmount currency="gold" value={summary.goldAfter} /></Text>
        </Group>
      </Paper>
      <Paper className="summary-gold-card summary-temper-card" p="md" data-testid="summary-temper">
        <Group justify="space-between" align="baseline"><Text fw={900}>TEMPER EARNED</Text>
          <Text c="orange" fw={950} size="xl" data-testid="summary-temper-earned"><CurrencyAmount currency="temper" value={summary.temper.total} sign="+" /></Text></Group>
        <div className="summary-gold-rows">{temperRows.filter(row => row.amount > 0).map(row => <div className="summary-gold-row" key={row.label}
          data-currency-source={`summary-temper-${row.source}`}>
          <Text size="sm">{row.label}</Text><Text size="sm" fw={850} c="orange"><CurrencyAmount currency="temper" value={row.amount} sign="+" /></Text></div>)}</div>
        {summary.temper.total === 0 && <Text size="sm" c="dimmed" mt="xs">No Temper earned this Round.</Text>}
      </Paper>
      <RunActionPortal><div className="run-action-primary"><Button size="md" disabled={busy}
        onClick={() => submit({ type: 'CONTINUE_ROUND_SUMMARY' })}>CONTINUE →</Button></div></RunActionPortal>
    </Stack>
  </Paper>;
}
