import { Badge, Button, Card, Group, Modal, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { FLAMES } from '../game/flames';
import type { Action, Board, FlameSlotIndex, GameEvent } from '../game/types';
import { ScoreResolution } from './ScoreResolution';
import type { FlameDetailsTarget } from './FlameDetailsModal';
import { RunActionPortal } from './RunActionRow';
import { rarityClassName, rarityLabel } from '../game/rarity';
import { RarityBadge } from './RarityBadge';
import { RewardSkipConfirmation } from './RewardSkipConfirmation';
import { RichDescription } from './RichDescription';
import { CurrencyAmount } from './CurrencyAmount';

export function FlameSelectionScreen({ board, event, busy, selectedOffer, setSelectedOffer, submit, skip, openFlameDetails }: {
  board: Board; event: GameEvent | null; busy: boolean;
  selectedOffer: number | null; setSelectedOffer: (id: number | null) => void; submit: (action: Action) => void; skip: () => void;
  openFlameDetails: (target: FlameDetailsTarget) => void;
}) {
  const reward = board.flameSelection!;
  const [replacement, setReplacement] = useState<FlameSlotIndex | null>(null);
  const selected = reward.offers.find(item => item.id === selectedOffer);
  const full = board.flameSlots.every(slot => slot !== null);
  function choose(offerId: number) {
    if (full) { setSelectedOffer(offerId); return; }
    submit({ type: 'CHOOSE_FLAME', offerId });
  }
  function confirmReplacement() {
    if (!selected || replacement === null) return;
    submit({ type: 'CHOOSE_FLAME', offerId: selected.id, replaceSlot: replacement });
    setReplacement(null); setSelectedOffer(null);
  }
  return <Stack gap="xs" className="flame-selection-screen">
    <Group justify="space-between" className="shop-summary flame-selection-header phase-sticky-header">
      <Text fw={800}>FLAME SELECTION</Text>
    </Group>
    {busy && <ScoreResolution event={event} busy={busy} onSkip={skip} />}
    <Paper p="xs" className="shop-section flame-offers-section" data-tutorial="flame-offers">
      <Group justify="space-between" className="section-heading"><Text fw={700} size="sm" tt="uppercase">Flame Offers</Text></Group>
      {reward.offers.length === 0 && <Text ta="center" fw={900} py="md" data-testid="all-flames-collected">ALL FLAMES COLLECTED</Text>}
      <div className="shop-grid flame-offers">{reward.offers.map(item => <Card key={item.id} p="sm"
        className={`flame-offer ${rarityClassName(FLAMES[item.flame].rarity)} ${selectedOffer === item.id ? 'selected' : ''}`}
        aria-label={`${FLAMES[item.flame].name}, ${rarityLabel(FLAMES[item.flame].rarity)} Flame`} data-testid={`flame-offer-${item.flame}`}>
        <Group className="flame-offer-header" justify="space-between" wrap="nowrap"><Group className="flame-offer-identity" gap={3} wrap="nowrap">
          <span className="flame-offer-icon" aria-hidden="true">🔥</span><Text className="flame-offer-name" fw={750}>{FLAMES[item.flame].name}</Text>
          <Button className="flame-offer-info" size="compact-xs" variant="subtle" color="gray"
            aria-label={`About ${FLAMES[item.flame].name}, ${rarityLabel(FLAMES[item.flame].rarity)} Flame`}
            onClick={() => openFlameDetails({ flame: item.flame, kind: 'offer' })}>ⓘ</Button>
        </Group><Group gap={4} wrap="nowrap"><RarityBadge rarity={FLAMES[item.flame].rarity} compact /><Badge size="xs" color="teal">FREE</Badge></Group></Group>
        <div className="flame-offer-description"><RichDescription copy={FLAMES[item.flame].verboseDescription} size="xs" /></div>
        <Button className="flame-offer-action" size="compact-xs" fullWidth mt="xs" color="orange" disabled={busy || reward.acquired}
          onClick={() => choose(item.id)}>{full ? 'SELECT TO REPLACE' : 'SELECT FLAME'}</Button>
      </Card>)}</div>
    </Paper>
    {full && selected && <Paper p="xs" className="shop-section flame-replacement-picker" data-testid="flame-replacement-picker">
      <Text fw={800}>REPLACE A FLAME?</Text><Text size="sm" c="dimmed">Your fire is full. Choose a Flame to extinguish. Replacing it permanently loses its invested Gold.</Text>
      <SimpleGrid cols={{ base: 1, sm: 5 }} mt="xs">{board.flameSlots.map((flame, index) => flame && <Button key={flame.instanceId}
        variant="light" color="orange" onClick={() => setReplacement(index as FlameSlotIndex)}>{FLAMES[flame.type].name}<br /><CurrencyAmount currency="gold" value={flame.investedGold} /></Button>)}</SimpleGrid>
    </Paper>}
    {!reward.acquired && <RunActionPortal><div className="run-action-primary shop-action-dock">
      <RewardSkipConfirmation disabled={busy} onConfirm={() => submit({ type: 'SKIP_FLAME_SELECTION' })} />
    </div></RunActionPortal>}
    <Modal opened={replacement !== null} onClose={() => setReplacement(null)} title="REPLACE A FLAME?" centered>
      {replacement !== null && selected && board.flameSlots[replacement] && <Stack><Text>Extinguish <strong>{FLAMES[board.flameSlots[replacement]!.type].name}</strong> and lose {board.flameSlots[replacement]!.investedGold} invested Gold?</Text>
        <Group justify="flex-end"><Button variant="default" onClick={() => setReplacement(null)}>CANCEL</Button><Button color="orange" onClick={confirmReplacement}>REPLACE</Button></Group></Stack>}
    </Modal>
  </Stack>;
}
