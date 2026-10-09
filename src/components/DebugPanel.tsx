import { Badge, Button, Group, Modal, ScrollArea, SimpleGrid, Table, Tabs, Text, Textarea, TextInput } from '@mantine/core';
import { Fragment, useMemo, useState } from 'react';
import { chapterNumberForRound, chapterRoundForRound } from '../game/chapters';
import { formatPlayerNumber, formatScoreProgress } from '../game/copy';
import { scoringPips } from '../game/dice';
import { enhancementSellValue, ENHANCEMENTS, ENHANCEMENT_IDS } from '../game/enhancements';
import { activeFlameId, FLAMES } from '../game/flames';
import { HANDS, HAND_IDS } from '../game/hands';
import { createRunHistoryTextV2, exportDebugTrace, exportRunHistoryV2 } from '../game/runHistoryV2Export';
import { renderRunHistoryV2Event } from '../game/runHistoryV2Renderer';
import { classifyRunHistoryV2Timelines } from '../game/runHistoryV2Timeline';
import { activeSpecialOfferStatuses } from '../game/specialOffers';
import type { GameState } from '../game/types';

function OverviewStat({ label, value }: { label: string; value: string | number }) {
  return <div className="modal-stat"><Text size="xs" c="dimmed" tt="uppercase">{label}</Text>
    <Text fw={700}>{typeof value === 'number' ? formatPlayerNumber(value) : value}</Text></div>;
}

export function RunInfoModal({ state, busy, opened, onClose, seedInput, setSeedInput, startSeed, restartSeed, newSeed }: {
  state: GameState; busy: boolean; opened: boolean; onClose: () => void;
  seedInput: string; setSeedInput: (seed: string) => void; startSeed: () => void; restartSeed: () => void; newSeed: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const timeline = useMemo(() => classifyRunHistoryV2Timelines(state.historyV2), [state.historyV2]);
  const visibleHistory = useMemo(() => state.historyV2
    .filter(event => !busy || event.actionId < state.actionJournal.length).slice(-200),
  [state.historyV2, state.actionJournal.length, busy]);

  async function copy(createContent: () => string, label: string) {
    let content: string | undefined;
    try {
      content = createContent();
      await navigator.clipboard.writeText(content);
      setFallback(null); setCopied(label);
    } catch {
      try { content ??= createContent(); setFallback(content); setCopied('Clipboard unavailable · use manual copy'); }
      catch { setCopied('Export failed'); }
    }
  }

  return <>
    <Modal opened={opened} onClose={onClose} title="Run Info" size="xl" centered transitionProps={{ duration: 0 }}>
      <Tabs defaultValue="overview">
        <Tabs.List grow>
          <Tabs.Tab value="overview">Overview</Tabs.Tab><Tabs.Tab value="dice">Dice</Tabs.Tab>
          <Tabs.Tab value="history">History <Badge ml={5} size="xs">{state.historyV2.length}</Badge></Tabs.Tab>
          <Tabs.Tab value="debug">Debug</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview" pt="md">
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
            <OverviewStat label="Seed" value={state.seed} /><OverviewStat label="Round" value={state.round} />
            <OverviewStat label="Attempt" value={state.roundAttemptNumber} /><OverviewStat label="Lives" value={`${formatPlayerNumber(state.lives)} / 3`} />
            <OverviewStat label="Score / goal" value={formatScoreProgress(state.score, state.target)} /><OverviewStat label="Gold" value={state.gold} />
            <OverviewStat label="Shop spend" value={state.lifetimeNormalShopGoldSpent} /><OverviewStat label="Flame investment" value={state.stats.totalFlameInvestment} />
            <OverviewStat label="Charge" value={`×${formatPlayerNumber(state.chargeXMult)} / ×${formatPlayerNumber(state.maxCharge)}${state.chargeArmed ? ' armed' : ''}`} />
            <OverviewStat label="Bonfires" value={state.bonfires.length} /><OverviewStat label="Wildfires" value={state.wildfires.length} />
            <OverviewStat label="Bean free plays" value={state.stats.jumpingBeanFreePlays.length} /><OverviewStat label="Jackpot Gold" value={state.stats.goldBySource.jackpot} />
            <OverviewStat label="Busts" value={state.stats.busts.length} /><OverviewStat label="Life restores" value={state.stats.lifeRestores.length} />
            <OverviewStat label="Enhancement sales" value={state.stats.sales.length} /><OverviewStat label="Vintage growth" value={state.stats.vintageGrowth.length} />
          </SimpleGrid>
          <Text size="sm" mt="md"><strong>Hand levels:</strong> {HAND_IDS.map(hand => `${HANDS[hand].name} ${formatPlayerNumber(state.handLevels[hand])}`).join(' · ')}</Text>
          <Text size="sm" mt="sm"><strong>Active Flames:</strong> {state.dice.filter(die => activeFlameId(die.flame)).map(die => `D${die.id + 1} ${FLAMES[activeFlameId(die.flame)!].name} ${formatPlayerNumber(die.flame!.investedGold)}/100`).join(' · ') || 'None'}</Text>
          <Text size="sm"><strong>Bonfires:</strong> {state.bonfires.map(id => FLAMES[id].name).join(' · ') || 'None'}</Text>
          <Text size="sm"><strong>Wildfires:</strong> {state.wildfires.map(item => FLAMES[item.flame].name).join(' · ') || 'None'}</Text>
          <Text size="sm" mt="sm"><strong>Special Offers:</strong> {activeSpecialOfferStatuses(state.specialOfferEffects).join(' · ') || 'None active'}</Text>
          <Text size="sm" mt="sm"><strong>Gold:</strong> base {formatPlayerNumber(state.stats.goldBySource.roundBase)} · rerolls {formatPlayerNumber(state.stats.goldBySource.unusedRerolls)} · interest {formatPlayerNumber(state.stats.goldBySource.interest)} · Boss Reward {formatPlayerNumber(state.stats.goldBySource.bossReward)} · Golden {formatPlayerNumber(state.stats.goldBySource.golden)} · Jackpot {formatPlayerNumber(state.stats.goldBySource.jackpot)}</Text>
          <Text size="sm" mt="sm"><strong>Probability:</strong> Sticky {state.stats.probabilityProcs.sticky.successes}/{state.stats.probabilityProcs.sticky.checks} · Hitchhiker {state.stats.probabilityProcs.hitchhiker.successes}/{state.stats.probabilityProcs.hitchhiker.checks} · Double Time {state.stats.probabilityProcs.doubleTime.successes}/{state.stats.probabilityProcs.doubleTime.checks} · Trainer {state.stats.personalTrainerSuccesses}/{state.stats.personalTrainerAttempts}</Text>
          <Table.ScrollContainer minWidth={760} mt="md"><Table striped><Table.Thead><Table.Tr><Table.Th>Round</Table.Th><Table.Th>Attempt</Table.Th><Table.Th>Goal</Table.Th><Table.Th>Final</Table.Th><Table.Th>Margin</Table.Th><Table.Th>Reward</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{state.stats.rounds.map((round, index) => <Table.Tr key={`${round.round}:${round.attempt}:${index}`}>
              <Table.Td>{round.round}</Table.Td><Table.Td>{round.attempt}</Table.Td><Table.Td>{formatPlayerNumber(round.target)}</Table.Td>
              <Table.Td>{formatPlayerNumber(round.finalScore)}</Table.Td><Table.Td>{round.clearMargin === null ? '—' : formatPlayerNumber(round.clearMargin)}</Table.Td>
              <Table.Td>{round.payout ? formatPlayerNumber(round.payout.totalRoundRewardGold) : '—'}</Table.Td>
            </Table.Tr>)}</Table.Tbody>
          </Table></Table.ScrollContainer>
        </Tabs.Panel>
        <Tabs.Panel value="dice" pt="md">
          <Table.ScrollContainer minWidth={650}><Table striped><Table.Thead><Table.Tr><Table.Th>Die</Table.Th><Table.Th>Flame</Table.Th><Table.Th>Face</Table.Th><Table.Th>Pips</Table.Th><Table.Th>Enhancements</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{state.dice.flatMap(die => die.faces.map((face, index) => {
              const flame = activeFlameId(die.flame); const exposed = die.value === index + 1;
              return <Table.Tr key={`${die.id}:${index + 1}`} className={exposed ? 'exposed-face-row' : undefined}>
                <Table.Td>D{die.id + 1}</Table.Td><Table.Td>{flame ? `${FLAMES[flame].name} ${formatPlayerNumber(die.flame!.investedGold)}/100` : '—'}</Table.Td>
                <Table.Td>side {index + 1} → {face.rank}{exposed ? ' · exposed' : ''}</Table.Td><Table.Td>{formatPlayerNumber(scoringPips(face))}</Table.Td>
                <Table.Td>{ENHANCEMENT_IDS.filter(id => face.enhancements[id]).map(id => id === 'vintage'
                  ? `Vintage · sell ${formatPlayerNumber(enhancementSellValue(face, 'vintage'))}`
                  : `${ENHANCEMENTS[id].name} ×${formatPlayerNumber(face.enhancements[id]!)}`).join(', ') || '—'}</Table.Td>
              </Table.Tr>;
            }))}</Table.Tbody>
          </Table></Table.ScrollContainer>
        </Tabs.Panel>
        <Tabs.Panel value="history" pt="md">
          <Group justify="space-between" mb="xs"><Text size="sm" c="dimmed">Latest 200 structured events · rendered on demand</Text>
            <Button size="compact-xs" variant="default" disabled={busy}
              onClick={() => copy(() => createRunHistoryTextV2(state), 'Run history copied')}>COPY RUN HISTORY</Button></Group>
          {!state.historyV2Coverage.complete && <Text size="xs" c="orange" mb="xs">Run History V2 begins at Round {state.historyV2Coverage.firstRound}, action {state.historyV2Coverage.firstActionId}. Earlier activity is unavailable in V2 format.</Text>}
          <ScrollArea h={430}>{visibleHistory.map((event, index) => {
            const previous = visibleHistory[index - 1];
            const beginsGroup = !previous || previous.round !== event.round || previous.attempt !== event.attempt;
            const abandoned = !timeline.isCanonical(event);
            return <Fragment key={event.seq}>
              {beginsGroup && <Text size="xs" fw={800} mt={index ? 'sm' : 0}>CHAPTER {chapterNumberForRound(event.round)} · ROUND {event.round} (LOCAL {chapterRoundForRound(event.round)}) · ATTEMPT {event.attempt}</Text>}
              <Text size="xs" className="log-entry" c={abandoned ? 'dimmed' : undefined}
                style={{ whiteSpace: 'pre-wrap', opacity: abandoned ? .65 : 1 }}>
                {abandoned ? `[ROLLED BACK · TIMELINE ${event.timelineId}] ` : ''}{renderRunHistoryV2Event(event)}
              </Text>
            </Fragment>;
          })}</ScrollArea>
          {copied && <Text size="xs" c={copied.includes('copied') ? 'teal' : 'orange'} mt="xs">{copied}</Text>}
        </Tabs.Panel>
        <Tabs.Panel value="debug" pt="md">
          <TextInput label="Run seed" size="sm" value={seedInput} onChange={event => setSeedInput(event.currentTarget.value)} />
          <Group gap="xs" mt="sm"><Button size="xs" variant="default" disabled={busy || !seedInput.trim()} onClick={startSeed}>Start seed</Button>
            <Button size="xs" variant="default" disabled={busy} onClick={restartSeed}>Restart same seed</Button>
            <Button size="xs" variant="light" disabled={busy} onClick={newSeed}>New seed</Button></Group>
          <Text size="xs" c="dimmed" mt="md">Debug Trace: {state.debugTrace.mode} · {state.debugTrace.records.length} buffered · {state.debugTrace.bufferBytes} bytes · {state.debugTrace.droppedRecords} dropped{state.debugTrace.mode === 'bounded' ? ' · use ?debugTrace=full before reproduction for full retention' : ''}</Text>
          <Group gap="xs" mt="sm"><Button size="xs" variant="light" disabled={busy}
            onClick={() => copy(() => JSON.stringify(exportRunHistoryV2(state), null, 2), 'Run data copied')}>COPY RUN DATA</Button>
            <Button size="xs" variant="light" disabled={busy}
              onClick={() => copy(() => JSON.stringify(exportDebugTrace(state), null, 2), 'Debug trace copied')}>COPY DEBUG TRACE</Button></Group>
          {copied && <Text size="xs" c={copied.includes('copied') ? 'teal' : 'orange'} mt="xs">{copied}</Text>}
        </Tabs.Panel>
      </Tabs>
    </Modal>
    <Modal opened={fallback !== null} onClose={() => setFallback(null)} title="Copy manually" size="lg">
      <Textarea value={fallback ?? ''} readOnly autosize minRows={8} />
    </Modal>
  </>;
}
