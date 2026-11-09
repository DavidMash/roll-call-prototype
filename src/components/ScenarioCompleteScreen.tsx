import { Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import type { Board } from '../game/types';
import { formatExactScore, formatPlayerNumber } from '../game/copy';

export function ScenarioCompleteScreen({ board, onScenarios, onHome }: {
  board: Board; onScenarios: () => void; onHome: () => void;
}) {
  const scenario = board.scenario!;
  return <main className="scenario-complete-screen" aria-labelledby="scenario-complete-title" data-testid="scenario-complete-screen">
    <Paper p={{ base: 'lg', sm: 'xl' }} ta="center">
      <Stack align="center" gap="md"><Text className="landing-kicker">SCENARIO COMPLETE</Text>
        <Title id="scenario-complete-title">CONGRATULATIONS!</Title>
        <Title order={2}>You've completed {scenario.name}.</Title><Text size="lg">You reached Engulfment.</Text>
        <SimpleGrid cols={{ base: 1, xs: 4 }} className="scenario-complete-stats">
          <div><small>SCENARIO ROUNDS PLAYED</small><strong>{formatPlayerNumber(board.round)}</strong></div>
          <div><small>CURRENT GOAL</small><strong>{formatExactScore(board.target)}</strong></div>
          <div><small>ENGULFMENTS</small><strong>{formatPlayerNumber(board.engulfmentLevel)}</strong></div>
          <div><small>INFERNO MULTIPLIER</small><strong>×{formatExactScore(board.infernoMultiplier)}</strong></div>
        </SimpleGrid>
        <Group justify="center"><Button size="lg" color="orange" onClick={onScenarios}>BACK TO SCENARIOS</Button></Group>
        <Button variant="subtle" color="gray" onClick={onHome}>HOME</Button>
      </Stack>
    </Paper>
  </main>;
}
