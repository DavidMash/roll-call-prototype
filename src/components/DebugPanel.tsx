import { Badge, Button, Group, Modal, ScrollArea, SimpleGrid, Table, Tabs, Text, Textarea, TextInput } from '@mantine/core';
import { useState } from 'react';
import { scoringPips } from '../game/dice';
import { ENHANCEMENTS, ENHANCEMENT_IDS } from '../game/enhancements';
import { FLAMES } from '../game/flames';
import { HANDS, HAND_IDS } from '../game/hands';
import { exportRun } from '../game/telemetry';
import type { GameState } from '../game/types';

function OverviewStat({ label, value }: { label: string; value: string | number }) {
  return <div className="modal-stat"><Text size="xs" c="dimmed" tt="uppercase">{label}</Text><Text fw={700}>{value}</Text></div>;
}

export function RunInfoModal({ state, visibleEventId, busy, opened, onClose, seedInput, setSeedInput, startSeed, restartSeed, newSeed }: {
  state: GameState;
  visibleEventId?: number;
  busy: boolean;
  opened: boolean;
  onClose: () => void;
  seedInput: string;
  setSeedInput: (seed: string) => void;
  startSeed: () => void;
  restartSeed: () => void;
  newSeed: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const history = state.history.filter(event => visibleEventId === undefined || event.id <= visibleEventId);
  async function copy(content: string, label: string) {
    try { await navigator.clipboard.writeText(content); setCopied(label); }
    catch { setFallback(content); }
  }
  return <>
    <Modal opened={opened} onClose={onClose} title="Run Info" size="xl" centered transitionProps={{ duration: 0 }} classNames={{ body: 'run-info-body' }}>
      <Tabs defaultValue="overview">
        <Tabs.List grow>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="dice">Dice</Tabs.Tab>
          <Tabs.Tab value="history">History <Badge ml={5} size="xs" color="gray" variant="light">{history.length}</Badge></Tabs.Tab>
          <Tabs.Tab value="debug">Debug</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview" pt="md">
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
            <OverviewStat label="Seed" value={state.seed} />
            <OverviewStat label="Round" value={state.round} />
            <OverviewStat label="Score / goal" value={`${state.score} / ${state.target}`} />
            <OverviewStat label="Gold" value={state.gold} />
            <OverviewStat label="Rerolls" value={state.manualRerollsRemaining} />
            <OverviewStat label="Hands played" value={Object.values(state.stats.handsPlayed).reduce((sum, count) => sum + count, 0)} />
            <OverviewStat label="Enhanced faces" value={state.stats.enhancedFaces.length} />
            <OverviewStat label="Gold earned / spent" value={`${state.stats.goldEarned} / ${state.stats.goldSpent}`} />
          </SimpleGrid>
          <Text size="sm" mt="md"><strong>Hand levels:</strong> {HAND_IDS.map(hand => `${HANDS[hand].name} ${state.handLevels[hand]}`).join(' · ')}</Text>
          <Text size="sm" mt="sm"><strong>Gold sources:</strong> Golden {state.stats.goldBySource.golden} · Jackpot {state.stats.goldBySource.jackpot} · round clears {state.stats.goldBySource.roundClear}</Text>
          <Text size="sm" mt="sm"><strong>Probability procs:</strong> Sticky {state.stats.probabilityProcs.sticky.successes}/{state.stats.probabilityProcs.sticky.checks} · Sustainable {state.stats.probabilityProcs.sustainable.successes}/{state.stats.probabilityProcs.sustainable.checks} · Hitchhiker {state.stats.probabilityProcs.hitchhiker.successes}/{state.stats.probabilityProcs.hitchhiker.checks}</Text>
          <Text size="sm" mt="sm"><strong>Flames:</strong> {state.dice.filter(die => die.flame).map(die => `D${die.id + 1} ${FLAMES[die.flame!].name}`).join(' · ') || 'None'} · {state.stats.flameOfferRerolls} offer rerolls · {state.stats.flameRerollGoldSpent} gold spent</Text>
          <Text size="sm" mt="sm"><strong>Flame effects:</strong> Charge +{state.stats.chargeAccumulated} stored / +{state.stats.chargeConsumed} consumed · Encore {state.stats.doubleEncoreUsesGranted} uses · Trainer {state.stats.personalTrainerLevelsGranted} levels</Text>
          <Table.ScrollContainer minWidth={620} mt="md">
            <Table striped highlightOnHover>
              <Table.Thead><Table.Tr><Table.Th>Round</Table.Th><Table.Th>Goal</Table.Th><Table.Th>Final</Table.Th><Table.Th>Margin</Table.Th><Table.Th>Rerolls spent</Table.Th><Table.Th>Left</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{state.stats.rounds.map(round => <Table.Tr key={round.round}>
                <Table.Td>{round.round}</Table.Td><Table.Td>{round.target}</Table.Td><Table.Td>{round.finalScore}</Table.Td><Table.Td>{round.clearMargin ?? '—'}</Table.Td>
                <Table.Td>{round.manualRerollChargesSpent}</Table.Td><Table.Td>{round.manualRerollsRemainingAtClear ?? '—'}</Table.Td>
              </Table.Tr>)}</Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Tabs.Panel>
        <Tabs.Panel value="dice" pt="md">
          <Table.ScrollContainer minWidth={550}>
            <Table striped highlightOnHover>
              <Table.Thead><Table.Tr><Table.Th>Die</Table.Th><Table.Th>Flame / Charge</Table.Th><Table.Th>Physical face</Table.Th><Table.Th>Pips</Table.Th><Table.Th>Enhancements</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{state.dice.flatMap(die => die.faces.map(face => <Table.Tr key={`${die.id}:${face.rank}`} className={die.value === face.rank ? 'exposed-face-row' : undefined}>
                <Table.Td>D{die.id + 1}</Table.Td><Table.Td>{die.flame ? `${FLAMES[die.flame].name}${die.chargeXMult ? ` · +${die.chargeXMult} stored` : ''}` : '—'}</Table.Td><Table.Td>{face.rank}{die.value === face.rank ? ' · exposed' : ''}</Table.Td><Table.Td>{scoringPips(face)}</Table.Td>
                <Table.Td>{ENHANCEMENT_IDS.filter(id => face.enhancements[id]).map(id => `${ENHANCEMENTS[id].name} ×${face.enhancements[id]}`).join(', ') || '—'}</Table.Td>
              </Table.Tr>))}</Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Tabs.Panel>
        <Tabs.Panel value="history" pt="md">
          <Group justify="space-between" mb="xs">
            <Text size="sm" c="dimmed">Latest 150 visible events</Text>
            <Button size="compact-xs" variant="default" disabled={busy} onClick={() => copy(state.history.map(event => `[R${event.round} #${event.id}] ${event.message}`).join('\n'), 'Event log copied')}>COPY EVENT LOG</Button>
          </Group>
          <ScrollArea h={430} type="auto" className="event-log">
            {history.slice(-150).map(event => <Text key={event.id} size="xs" className="log-entry"><span>R{event.round} · {event.id}</span> {event.message}</Text>)}
          </ScrollArea>
        </Tabs.Panel>
        <Tabs.Panel value="debug" pt="md">
          <TextInput label="Run seed" size="sm" value={seedInput} onChange={event => setSeedInput(event.currentTarget.value)} />
          <Group gap="xs" mt="sm">
            <Button size="xs" variant="default" disabled={busy || !seedInput.trim()} onClick={startSeed}>Start seed</Button>
            <Button size="xs" variant="default" disabled={busy} onClick={restartSeed}>Restart same seed</Button>
            <Button size="xs" variant="light" disabled={busy} onClick={newSeed}>New seed</Button>
          </Group>
          <Text size="xs" c="dimmed" mt="xs">Starting or restarting replaces this run. Copy its data first if you want to keep it.</Text>
          <Button mt="lg" size="xs" variant="light" disabled={busy} onClick={() => copy(JSON.stringify(exportRun(state), null, 2), 'Run data copied')}>COPY RUN DATA</Button>
          {copied && <Text size="xs" c="teal" mt="xs" role="status">{copied}</Text>}
        </Tabs.Panel>
      </Tabs>
    </Modal>
    <Modal opened={fallback !== null} onClose={() => setFallback(null)} title="Copy manually" size="lg" transitionProps={{ duration: 0 }}>
      <Text size="sm" mb="sm">Clipboard access is unavailable. Select and copy the data below.</Text>
      <Textarea aria-label="Exported data" value={fallback ?? ''} readOnly autosize minRows={8} maxRows={18} onFocus={event => event.currentTarget.select()} />
    </Modal>
  </>;
}
