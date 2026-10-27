import { Badge, Button, Group, Paper, Progress, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useMemo, useState } from 'react';
import { newRun } from '../game/engine';
import { flameInstances, FLAMES } from '../game/flames';
import { handStats, HANDS, HAND_IDS } from '../game/hands';
import { handLevelsForScenario, type ScenarioDefinition } from '../game/scenarios';
import { formatExactScore, formatPlayerNumber } from '../game/copy';
import type { FaceDetailsTarget } from './FaceDetailsModal';
import { FaceDetailsModal } from './FaceDetailsModal';
import type { FlameDetailsTarget } from './FlameDetailsModal';
import { FlameDetailsModal } from './FlameDetailsModal';
import { CollectibleDieVisual } from './CollectibleDieVisual';
import { DieEffectsLabel } from './DieTypeLabel';
import { CurrencyAmount } from './CurrencyAmount';
import type { HandId } from '../game/types';

export function ScenarioDetails({ scenario, completed, onBack, onStart }: {
  scenario: ScenarioDefinition; completed: boolean; onBack: () => void; onStart: () => void;
}) {
  const preview = useMemo(() => newRun(`scenario-preview-${scenario.id}`, { next: () => .314159 }, { scenario }).state, [scenario]);
  const levels = handLevelsForScenario(scenario);
  const [dieTarget, setDieTarget] = useState<FaceDetailsTarget | null>(null);
  const [flameTarget, setFlameTarget] = useState<FlameDetailsTarget | null>(null);
  const featured = scenario.featuredHands ?? [];
  const remaining = HAND_IDS.filter(hand => !featured.includes(hand));
  const HandRows = ({ hands }: { hands: readonly HandId[] }) => <div className="scenario-hand-list">
    {hands.map(hand => { const stats = handStats(hand, levels[hand]); return <div key={hand}
      className={`scenario-hand-row${featured.includes(hand) ? ' featured' : ''}`} data-featured={featured.includes(hand) || undefined}>
      <span>{HANDS[hand].name}</span><span>Lv. {formatPlayerNumber(stats.level)}</span><strong>×{formatPlayerNumber(stats.handMultiplier)} MULT</strong>
    </div>; })}
  </div>;
  return <main className="scenario-details" aria-labelledby="scenario-details-title">
    <Group justify="space-between" align="flex-start" mb="md"><div><Group gap="xs"><Title id="scenario-details-title">{scenario.name}</Title>
      {completed && <Badge color="teal" aria-label="Completed">✓ COMPLETED</Badge>}</Group><Text c="dimmed">{scenario.tagline}</Text></div>
      <Button variant="subtle" color="gray" onClick={onBack}>BACK TO SCENARIOS</Button></Group>
    <Paper withBorder p="md" mb="md" className="scenario-objective" aria-label="Scenario objective">
      <Text size="xs" fw={900} tt="uppercase" c="orange">Objective</Text><Title order={2}>Reach Engulfment</Title>
    </Paper>
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
      <Paper withBorder p="md"><Title order={3}>Starting Dice</Title>
        <Text size="xs" c="dimmed" mb="sm">Tap a die to inspect its canonical effects.</Text>
        <div className="scenario-starting-dice">{preview.dice.filter(die => die.owner === 'player').map((die, index) => <button type="button"
          key={die.id} className="scenario-loadout-die" aria-label={`Inspect starting die ${index + 1}, ${die.effects.map(effect => `${effect.type} level ${effect.level}`).join(', ')}`}
          onClick={() => setDieTarget({ dieId: die.id, face: die.value })}>
          <CollectibleDieVisual effects={die.effects} face={die.value as 1 | 2 | 3 | 4 | 5 | 6} slotLabel={`D${index + 1}`} />
          <DieEffectsLabel effects={die.effects} />
        </button>)}</div>
      </Paper>
      <Paper withBorder p="md"><Title order={3}>Starting Flames</Title>
        <Stack gap="xs" mt="sm">{flameInstances(preview).map(flame => <button type="button" className="scenario-flame-row" key={flame.instanceId}
          aria-label={`Inspect ${FLAMES[flame.type].name}, ${flame.investedGold} of 100 Ember investment`}
          onClick={() => setFlameTarget({ flameInstanceId: flame.instanceId, kind: flame.stage })}>
          <span>🔥 <strong>{FLAMES[flame.type].name}</strong></span><span>{flame.investedGold}/100 EMBER</span>
          <Progress value={flame.investedGold} color="orange" aria-label={`${FLAMES[flame.type].name} investment`} />
        </button>)}
        {scenario.unavailableStartingFlames?.map(flame => <Paper key={flame.name} withBorder p="xs" className="scenario-unavailable-asset" role="note">
          <Text fw={850}>{flame.name} · requested {flame.investedGold}/100</Text><Text size="xs" c="dimmed">{flame.reason} It is not applied to this Scenario.</Text>
        </Paper>)}
        {!scenario.flames.length && !scenario.unavailableStartingFlames?.length && <Text c="dimmed">No starting Flames.</Text>}</Stack>
      </Paper>
      <Paper withBorder p="md"><Title order={3}>Starting Conditions</Title>
        <SimpleGrid cols={2} spacing="xs" mt="sm" className="scenario-condition-grid">
          <div><small>GOAL</small><strong>{formatExactScore(scenario.startingGoal)}</strong></div>
          <div><small>GOLD</small><strong><CurrencyAmount currency="gold" value={scenario.startingGold} /></strong></div>
          <div><small>TEMPER</small><strong><CurrencyAmount currency="temper" value={scenario.startingTemper} /></strong></div>
          <div><small>LIVES</small><strong>{scenario.startingLives}</strong></div>
          <div><small>ROSTER</small><strong>{scenario.roster.length} / 5</strong></div>
          <div><small>START</small><strong>SCENARIO ROUND 1</strong></div>
        </SimpleGrid>
      </Paper>
      <Paper withBorder p="md"><Title order={3}>Starting Hand Training</Title>
        {featured.length > 0 && <><Text size="xs" fw={900} tt="uppercase" c="orange" mt="sm">Featured Hands</Text><HandRows hands={featured} /></>}
        {remaining.length > 0 && <details className="scenario-other-hands" open={!featured.length}><summary>{featured.length ? 'All other Hands' : 'All Hands'}</summary><HandRows hands={remaining} /></details>}
      </Paper>
    </SimpleGrid>
    <Group justify="center" mt="xl"><Button size="lg" color="orange" onClick={onStart}
      aria-label={`${completed ? 'Play again' : 'Start'} ${scenario.name}`}>{completed ? 'PLAY AGAIN' : 'START SCENARIO'}</Button></Group>
    <FaceDetailsModal board={preview} target={dieTarget} diceDisplay="numerals" busy actionsEnabled={false}
      onClose={() => setDieTarget(null)} submit={() => {}} />
    <FlameDetailsModal board={preview} inventory={preview.diceInventory} target={flameTarget} busy actionsEnabled={false}
      onClose={() => setFlameTarget(null)} submit={() => {}} />
  </main>;
}
