import { Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { SCENARIOS, inventoryForScenario, type ScenarioDefinition } from '../game/scenarios';
import type { ScenarioProgress } from '../game/scenarioProgress';
import { FLAMES } from '../game/flames';
import { formatExactScore, formatPlayerNumber } from '../game/copy';
import { CollectibleDieVisual } from './CollectibleDieVisual';
import { DieEffectsLabel } from './DieTypeLabel';
import { CurrencyAmount } from './CurrencyAmount';

function ScenarioCard({ scenario, completed, onOpen }: { scenario: ScenarioDefinition; completed: boolean; onOpen: () => void }) {
  const inventory = inventoryForScenario(scenario);
  const dice = scenario.roster.map(item => inventory.instances[item.rosterSlot]);
  return <Paper component="article" withBorder p="md" className="scenario-card" data-testid={`scenario-card-${scenario.id}`}>
    <Stack gap="sm" h="100%">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div><Title order={3}>{scenario.name}</Title><Text size="sm" c="dimmed">{scenario.tagline}</Text></div>
        {completed && <Badge color="teal" variant="light" aria-label="Completed">✓ COMPLETED</Badge>}
      </Group>
      <div className="scenario-dice-preview" aria-label={`${scenario.roster.length} starting dice`}>
        {dice.map((die, index) => <div className="scenario-die-preview" key={die.id}>
          <CollectibleDieVisual effects={die.effects} face={1} compact slotLabel={`D${index + 1}`} />
          <DieEffectsLabel effects={die.effects} compact />
        </div>)}
      </div>
      <Group gap={5} wrap="wrap" aria-label="Starting Flames">
        {scenario.flames.map(flame => <Badge key={flame.key} color="orange" variant="light">🔥 {FLAMES[flame.key].shortName} {flame.investedGold}/100</Badge>)}
        {scenario.unavailableStartingFlames?.map(flame => <Badge key={flame.name} color="gray" variant="outline">{flame.name} unavailable</Badge>)}
        {!scenario.flames.length && !scenario.unavailableStartingFlames?.length && <Text size="xs" c="dimmed">No starting Flames</Text>}
      </Group>
      <Group gap="md" mt="auto" className="scenario-card-stats">
        <Text size="sm"><strong>GOAL</strong> {formatExactScore(scenario.startingGoal)}</Text>
        <Text size="sm"><strong><CurrencyAmount currency="gold" value={scenario.startingGold} /></strong></Text>
        <Text size="sm"><strong>{formatPlayerNumber(scenario.roster.length)}</strong> {scenario.roster.length === 1 ? 'DIE' : 'DICE'}</Text>
      </Group>
      <Button fullWidth variant={completed ? 'light' : 'filled'} onClick={onOpen}
        aria-label={`View ${scenario.name} Scenario`}>{completed ? 'PLAY AGAIN' : 'VIEW SCENARIO'}</Button>
    </Stack>
  </Paper>;
}

export function ScenarioBrowser({ progress, activeScenario, onResume, onOpen, onBack }: {
  progress: ScenarioProgress; activeScenario?: { name: string; round: number } | null; onResume?: () => void;
  onOpen: (scenario: ScenarioDefinition) => void; onBack: () => void;
}) {
  return <main className="scenario-browser" aria-labelledby="scenario-browser-title">
    <Group justify="space-between" mb="md"><div><Text className="landing-kicker">CURATED CHALLENGES</Text>
      <Title id="scenario-browser-title">SCENARIOS</Title></div><Button variant="subtle" color="gray" onClick={onBack}>BACK HOME</Button></Group>
    <Text c="dimmed" mb="lg">Start from a curated build, then use every normal Roll Call system to reach Engulfment.</Text>
    {activeScenario && onResume && <Paper withBorder p="sm" mb="md" className="scenario-resume-card">
      <Group justify="space-between"><div><Text size="xs" fw={900} tt="uppercase" c="orange">Active Scenario</Text>
        <Text fw={850}>{activeScenario.name} · Scenario Round {activeScenario.round}</Text></div>
        <Button onClick={onResume}>CONTINUE</Button></Group>
    </Paper>}
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
      {SCENARIOS.map(scenario => <ScenarioCard key={scenario.id} scenario={scenario}
        completed={progress.completions[scenario.id]?.completed === true} onOpen={() => onOpen(scenario)} />)}
    </SimpleGrid>
  </main>;
}
