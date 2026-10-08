import { Badge, Button, Group, Modal, ScrollArea, SimpleGrid, Table, Tabs, Text, Textarea, TextInput } from '@mantine/core';
import { useState } from 'react';
import { scoringPips } from '../game/dice';
import { enhancementSellValue, ENHANCEMENTS, ENHANCEMENT_IDS } from '../game/enhancements';
import { activeFlameId, FLAMES } from '../game/flames';
import { HANDS, HAND_IDS } from '../game/hands';
import { exportRun } from '../game/telemetry';
import type { GameState } from '../game/types';
import { formatPlayerNumber, formatScoreProgress } from '../game/copy';
import { activeSpecialOfferStatuses } from '../game/specialOffers';

function OverviewStat({ label, value }: { label: string; value: string | number }) {
  return <div className="modal-stat"><Text size="xs" c="dimmed" tt="uppercase">{label}</Text><Text fw={700}>{typeof value === 'number' ? formatPlayerNumber(value) : value}</Text></div>;
}
export function RunInfoModal({ state, visibleEventId, busy, opened, onClose, seedInput, setSeedInput, startSeed, restartSeed, newSeed }: {
  state: GameState; visibleEventId?: number; busy: boolean; opened: boolean; onClose: () => void;
  seedInput: string; setSeedInput: (seed: string) => void; startSeed: () => void; restartSeed: () => void; newSeed: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const history = state.history.filter(event => visibleEventId === undefined || event.id <= visibleEventId);
  async function copy(content: string, label: string) { try { await navigator.clipboard.writeText(content); setCopied(label); } catch { setFallback(content); } }
  return <>
    <Modal opened={opened} onClose={onClose} title="Run Info" size="xl" centered transitionProps={{ duration: 0 }}>
      <Tabs defaultValue="overview">
        <Tabs.List grow><Tabs.Tab value="overview">Overview</Tabs.Tab><Tabs.Tab value="dice">Dice</Tabs.Tab><Tabs.Tab value="history">History <Badge ml={5} size="xs">{history.length}</Badge></Tabs.Tab><Tabs.Tab value="debug">Debug</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="overview" pt="md">
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
            <OverviewStat label="Seed" value={state.seed} /><OverviewStat label="Round" value={state.round} />
            <OverviewStat label="Attempt" value={state.roundAttemptNumber} /><OverviewStat label="Lives" value={`${formatPlayerNumber(state.lives)} / 3`} />
            <OverviewStat label="Score / goal" value={formatScoreProgress(state.score, state.target)} /><OverviewStat label="Gold" value={state.gold} />
            <OverviewStat label="Shop spend" value={state.lifetimeNormalShopGoldSpent} /><OverviewStat label="Flame investment" value={state.stats.totalFlameInvestment} />
            <OverviewStat label="Charge" value={`×${formatPlayerNumber(state.chargeXMult)} / ×${formatPlayerNumber(state.maxCharge)}${state.chargeArmed ? ' armed' : ''}`} /><OverviewStat label="Bonfires" value={state.bonfires.length} /><OverviewStat label="Wildfires" value={state.wildfires.length} />
            <OverviewStat label="Bean free plays" value={state.stats.jumpingBeanFreePlays.length} /><OverviewStat label="Jackpot Gold" value={state.stats.goldBySource.jackpot} />
            <OverviewStat label="Busts" value={state.stats.busts.length} /><OverviewStat label="Life restores" value={state.stats.lifeRestores.length} />
            <OverviewStat label="Enhancement sales" value={state.stats.sales.length} /><OverviewStat label="Vintage growth" value={state.stats.vintageGrowth.length} />
          </SimpleGrid>
          <Text size="sm" mt="md"><strong>Hand levels:</strong> {HAND_IDS.map(hand => `${HANDS[hand].name} ${formatPlayerNumber(state.handLevels[hand])}`).join(' · ')}</Text>
          <Text size="sm" mt="sm"><strong>Gold:</strong> base {formatPlayerNumber(state.stats.goldBySource.roundBase)} · rerolls {formatPlayerNumber(state.stats.goldBySource.unusedRerolls)} · interest {formatPlayerNumber(state.stats.goldBySource.interest)} · Boss Reward {formatPlayerNumber(state.stats.goldBySource.bossReward)} · Golden {formatPlayerNumber(state.stats.goldBySource.golden)} · Jackpot {formatPlayerNumber(state.stats.goldBySource.jackpot)}</Text>
          <Text size="sm" mt="sm"><strong>Probability:</strong> Sticky {formatPlayerNumber(state.stats.probabilityProcs.sticky.successes)}/{formatPlayerNumber(state.stats.probabilityProcs.sticky.checks)} · Hitchhiker {formatPlayerNumber(state.stats.probabilityProcs.hitchhiker.successes)}/{formatPlayerNumber(state.stats.probabilityProcs.hitchhiker.checks)} · Double Time {formatPlayerNumber(state.stats.probabilityProcs.doubleTime.successes)}/{formatPlayerNumber(state.stats.probabilityProcs.doubleTime.checks)} · Trainer {formatPlayerNumber(state.stats.personalTrainerSuccesses)}/{formatPlayerNumber(state.stats.personalTrainerAttempts)}</Text>
          <Text size="sm" mt="sm"><strong>Active Flames:</strong> {state.dice.filter(die => activeFlameId(die.flame)).map(die => `D${die.id + 1} ${FLAMES[activeFlameId(die.flame)!].name} ${formatPlayerNumber(die.flame!.investedGold)}/100`).join(' · ') || 'None'}</Text>
          <Text size="sm" mt="sm"><strong>Bonfires:</strong> {state.bonfires.map(id => FLAMES[id].name).join(' · ') || 'None'}</Text>
          <Text size="sm"><strong>Wildfires:</strong> {state.wildfires.map(item => `${FLAMES[item.flame].name} (${JSON.stringify(item.resolved)})`).join(' · ') || 'None'}</Text>
          <Text size="sm" mt="sm"><strong>Special Offers:</strong> {activeSpecialOfferStatuses(state.specialOfferEffects).join(' · ') || 'None active'}</Text>
          <Table.ScrollContainer minWidth={760} mt="md"><Table striped><Table.Thead><Table.Tr><Table.Th>Round</Table.Th><Table.Th>Attempt</Table.Th><Table.Th>Goal</Table.Th><Table.Th>Final</Table.Th><Table.Th>Margin</Table.Th><Table.Th>Base</Table.Th><Table.Th>Rerolls</Table.Th><Table.Th>Interest</Table.Th><Table.Th>Boss Reward</Table.Th><Table.Th>Total</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{state.stats.rounds.map(round => <Table.Tr key={`${round.round}:${round.attempt}`}><Table.Td>{formatPlayerNumber(round.round)}</Table.Td><Table.Td>{formatPlayerNumber(round.attempt)}</Table.Td><Table.Td>{formatPlayerNumber(round.target)}</Table.Td><Table.Td>{formatPlayerNumber(round.finalScore)}</Table.Td><Table.Td>{round.clearMargin === null ? '—' : formatPlayerNumber(round.clearMargin)}</Table.Td><Table.Td>{round.payout ? formatPlayerNumber(round.payout.baseGold) : '—'}</Table.Td><Table.Td>{round.payout ? formatPlayerNumber(round.payout.unusedRerollGold) : '—'}</Table.Td><Table.Td>{round.payout ? formatPlayerNumber(round.payout.interestGold) : '—'}</Table.Td><Table.Td>{round.payout ? formatPlayerNumber(round.payout.bossRewardGold) : '—'}</Table.Td><Table.Td>{round.payout ? formatPlayerNumber(round.payout.totalRoundRewardGold) : '—'}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table></Table.ScrollContainer>
        </Tabs.Panel>
        <Tabs.Panel value="dice" pt="md"><Table.ScrollContainer minWidth={650}><Table striped><Table.Thead><Table.Tr><Table.Th>Die</Table.Th><Table.Th>Flame</Table.Th><Table.Th>Face</Table.Th><Table.Th>Pips</Table.Th><Table.Th>Enhancements</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{state.dice.flatMap(die => die.faces.map((face, index) => { const id = activeFlameId(die.flame); const exposed = die.value === index + 1; return <Table.Tr key={`${die.id}:${index + 1}`} className={exposed ? 'exposed-face-row' : undefined}><Table.Td>D{die.id + 1}</Table.Td><Table.Td>{id ? `${FLAMES[id].name} ${formatPlayerNumber(die.flame!.investedGold)}/100` : '—'}</Table.Td><Table.Td>side {formatPlayerNumber(index + 1)} → {formatPlayerNumber(face.rank)}{exposed ? ' · exposed' : ''}{face.snakeEyed ? ' · SNAKE-EYED' : ''}{face.infected ? ' · INFECTED' : ''}</Table.Td><Table.Td>{formatPlayerNumber(scoringPips(face))}</Table.Td><Table.Td>{ENHANCEMENT_IDS.filter(e => face.enhancements[e]).map(e => e === 'vintage' ? `Vintage · sell ${formatPlayerNumber(enhancementSellValue(face, 'vintage'))}${face.vintageSommelierBoosted ? ' · Sommelier ×2' : ''}` : `${ENHANCEMENTS[e].name} ×${formatPlayerNumber(face.enhancements[e]!)}`).join(', ') || '—'}{face.infected ? ' · DISABLED' : ''}</Table.Td></Table.Tr>; }))}</Table.Tbody>
        </Table></Table.ScrollContainer></Tabs.Panel>
        <Tabs.Panel value="history" pt="md"><Group justify="space-between" mb="xs"><Text size="sm" c="dimmed">Latest 150 visible events</Text><Button size="compact-xs" variant="default" disabled={busy} onClick={() => copy(state.history.map(e => `[R${e.round} #${e.id}] ${e.message}`).join('\n'), 'Event log copied')}>COPY EVENT LOG</Button></Group>
          <ScrollArea h={430}>{history.slice(-150).map(e => <Text key={e.id} size="xs" className="log-entry"><span>R{e.round} · {e.id}</span> {e.message}</Text>)}</ScrollArea></Tabs.Panel>
        <Tabs.Panel value="debug" pt="md"><TextInput label="Run seed" size="sm" value={seedInput} onChange={e => setSeedInput(e.currentTarget.value)} /><Group gap="xs" mt="sm"><Button size="xs" variant="default" disabled={busy || !seedInput.trim()} onClick={startSeed}>Start seed</Button><Button size="xs" variant="default" disabled={busy} onClick={restartSeed}>Restart same seed</Button><Button size="xs" variant="light" disabled={busy} onClick={newSeed}>New seed</Button></Group>
          <Button mt="lg" size="xs" variant="light" disabled={busy} onClick={() => copy(JSON.stringify(exportRun(state), null, 2), 'Run data copied')}>COPY RUN DATA</Button>{copied && <Text size="xs" c="teal" mt="xs">{copied}</Text>}</Tabs.Panel>
      </Tabs>
    </Modal>
    <Modal opened={fallback !== null} onClose={() => setFallback(null)} title="Copy manually" size="lg"><Textarea value={fallback ?? ''} readOnly autosize minRows={8} /></Modal>
  </>;
}
