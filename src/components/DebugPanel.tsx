import { Accordion, Badge, Button, Group, Modal, ScrollArea, Table, Text, Textarea } from '@mantine/core';
import { useState } from 'react';
import { scoringPips } from '../game/dice';
import { CONFIG } from '../game/config';
import { ENHANCEMENTS, ENHANCEMENT_IDS } from '../game/enhancements';
import { handStats, HANDS, HAND_IDS } from '../game/hands';
import { exportRun } from '../game/telemetry';
import type { GameState } from '../game/types';

export function DebugPanel({ state, visibleEventId, busy }: { state: GameState; visibleEventId?: number; busy: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const history = state.history.filter(event => visibleEventId === undefined || event.id <= visibleEventId);
  async function copy(content: string, label: string) {
    try { await navigator.clipboard.writeText(content); setCopied(label); }
    catch { setFallback(content); }
  }
  return <>
    <Accordion variant="separated" mt="xl">
      <Accordion.Item value="debug">
        <Accordion.Control>Run data & event history <Badge ml="xs" color="gray" variant="light">{history.length}</Badge></Accordion.Control>
        <Accordion.Panel>
          <Group justify="space-between" mb="md">
            <Text size="sm">Seed: <strong>{state.seed}</strong></Text>
            <Group gap="xs">
              <Button size="xs" variant="light" disabled={busy} onClick={() => copy(JSON.stringify(exportRun(state), null, 2), 'Run data copied')}>COPY RUN DATA</Button>
              <Button size="xs" variant="default" disabled={busy} onClick={() => copy(state.history.map(event => `[R${event.round} #${event.id}] ${event.message}`).join('\n'), 'Event log copied')}>COPY EVENT LOG</Button>
            </Group>
          </Group>
          {copied && <Text size="xs" c="teal" role="status">{copied}</Text>}
          <Text size="sm" mb="md">Gold earned {state.stats.goldEarned} · spent {state.stats.goldSpent} · Hands {Object.values(state.stats.handsPlayed).reduce((sum, n) => sum + n, 0)}</Text>
          <Text size="sm" mb="md">Gold sources: Golden {state.stats.goldBySource.golden} · Jackpot {state.stats.goldBySource.jackpot} · round clears {state.stats.goldBySource.roundClear}</Text>
          <Text size="sm" mb="md">Hand training: {state.stats.trainingPurchasesTotal} purchases · {state.stats.trainingGoldSpent} gold spent</Text>
          <Text size="sm" mb="md">Hand levels: {HAND_IDS.map(hand => `${HANDS[hand].name} ${state.handLevels[hand]}`).join(' · ')}</Text>
          <Text size="sm" mb="md">Manual reroll actions {state.stats.manualRerollActions} · dice rerolled {state.stats.manualDiceRerolled} · dead-board rescues {state.stats.deadBoardRescues}</Text>
          <Text size="sm" mb="md">Probability procs: Sticky {state.stats.probabilityProcs.sticky.successes}/{state.stats.probabilityProcs.sticky.checks} · Sustainable {state.stats.probabilityProcs.sustainable.successes}/{state.stats.probabilityProcs.sustainable.checks}</Text>
          <Text size="sm" mb="md">Hand Bonus pips {state.stats.handBonusPips} · Hitchhiker pips contributed {state.stats.hitchhikerPipsContributed}. Final hand scores include those contributions.</Text>
          <Table.ScrollContainer minWidth={480}>
            <Table withTableBorder mb="md">
              <Table.Thead><Table.Tr><Table.Th>Round</Table.Th><Table.Th>Goal</Table.Th><Table.Th>First crossed</Table.Th><Table.Th>Final score</Table.Th><Table.Th>Margin</Table.Th><Table.Th>Rerolls granted</Table.Th><Table.Th>Spent</Table.Th><Table.Th>Left at clear</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{state.stats.rounds.map(round => <Table.Tr key={round.round}>
                <Table.Td>{round.round}</Table.Td><Table.Td>{round.target}</Table.Td><Table.Td>{round.firstCrossedScore ?? '—'}</Table.Td><Table.Td>{round.finalScore}</Table.Td><Table.Td>{round.clearMargin ?? '—'}</Table.Td>
                <Table.Td>{round.manualRerollsGranted}</Table.Td><Table.Td>{round.manualRerollChargesSpent}</Table.Td><Table.Td>{round.manualRerollsRemainingAtClear ?? '—'}</Table.Td>
              </Table.Tr>)}</Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Text size="xs" c="dimmed" mb="xs">Scores: hands {state.stats.scoreBySource.hand} · Jumping Bean {state.stats.scoreBySource.jumpingBean}. Hitchhiker contributes pips to hands.</Text>
          {state.stats.loss && <Text size="sm" mb="sm">Loss after {state.stats.loss.afterAction === 'MANUAL_REROLL' ? 'manual reroll' : state.stats.loss.afterHand ? HANDS[state.stats.loss.afterHand].name : 'initial roll'}; board {state.stats.loss.values.join(', ')}; all formable categories were consumed and no manual rerolls remained.</Text>}
          <ScrollArea h={220} type="auto" className="event-log">
            {history.slice(-150).map(event => <Text key={event.id} size="xs" className="log-entry"><span>R{event.round} · {event.id}</span> {event.message}</Text>)}
          </ScrollArea>
          <Text size="xs" c="dimmed" mt="xs">Showing the latest 150 events. The copied event log includes the full run.</Text>
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value="inventory">
        <Accordion.Control>Inspect all physical faces</Accordion.Control>
        <Accordion.Panel>
          <Table.ScrollContainer minWidth={550}>
            <Table withTableBorder>
              <Table.Thead><Table.Tr><Table.Th>Die</Table.Th><Table.Th>Physical face</Table.Th><Table.Th>Pips</Table.Th><Table.Th>Enhancements</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{state.dice.flatMap(die => die.faces.map(face => <Table.Tr key={`${die.id}:${face.rank}`} style={{ background: die.value === face.rank ? 'var(--mantine-color-teal-0)' : undefined }}>
                <Table.Td>D{die.id + 1}</Table.Td><Table.Td>{face.rank}{die.value === face.rank ? ' · exposed' : ''}</Table.Td><Table.Td>{scoringPips(face)}</Table.Td>
                <Table.Td>{ENHANCEMENT_IDS.filter(id => face.enhancements[id]).map(id => `${ENHANCEMENTS[id].name} ×${face.enhancements[id]}`).join(', ') || '—'}</Table.Td>
              </Table.Tr>))}</Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value="rules">
        <Accordion.Control>Quick rules & enhancement reference</Accordion.Control>
        <Accordion.Panel>
          <Text size="sm" mb="md">Each round gives {CONFIG.manualRerollsPerRound} manual die rerolls, one charge per selected die. You may spend them with or without a playable hand. They use real rolls and their ability chains; Sticky does not prevent a manual reroll. The run ends only below the goal with no playable hand and zero manual rerolls. Shop rerolls remain separate and cost gold. Every scorecard category stays visible. Its row accumulates score from that hand for the current round; Effect Score contains standalone scoring. Upper hands may use any non-empty subset showing that number. Clicking an upper hand initially selects all matching dice; deselect individual dice to preserve useful board structure while rerolling a duplicate to pursue a straight. The category is still consumed after one play unless a selected Sustainable face prevents it. Lower hands use exactly their required dice. Hand Base Pips and base multipliers derive from the hand's permanent training level: {HAND_IDS.map(hand => `${HANDS[hand].name} starts ${handStats(hand, 1).basePips} × ${handStats(hand, 1).baseMultiplier}`).join('; ')}. Score = (Base Pips + face/effect pips) × (base multiplier + participating Multiplier stacks). Base Pips are not a face event. Played dice reroll, unless an ability changes that. Every category, scorecard breakdown, and manual reroll budget resets each round; training levels persist for the run. The complete effect chain finishes before clearance or loss.</Text>
          {ENHANCEMENT_IDS.map(id => <Text key={id} size="sm" mb="xs"><strong>{ENHANCEMENTS[id].name}:</strong> {ENHANCEMENTS[id].description}</Text>)}
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
    <Modal opened={fallback !== null} onClose={() => setFallback(null)} title="Copy manually" size="lg">
      <Text size="sm" mb="sm">Clipboard access is unavailable in this browser. Select and copy the data below.</Text>
      <Textarea aria-label="Exported data" value={fallback ?? ''} readOnly autosize minRows={8} maxRows={18} onFocus={event => event.currentTarget.select()} />
    </Modal>
  </>;
}
