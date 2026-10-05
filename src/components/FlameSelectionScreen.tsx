import { Badge, Button, Card, Group, Paper, Stack, Text } from '@mantine/core';
import { hasXMultFlame, FLAMES } from '../game/flames';
import type { Action, Board, GameEvent } from '../game/types';
import { ScoreResolution } from './ScoreResolution';
import { formatPlayerNumber } from '../game/copy';
import type { FlameDetailsTarget } from './FlameDetailsModal';

export function FlameSelectionScreen({ board, event, busy, selectedOffer, setSelectedOffer, submit, skip, openFlameDetails }: {
  board: Board; event: GameEvent | null; busy: boolean;
  selectedOffer: number | null; setSelectedOffer: (id: number | null) => void; submit: (action: Action) => void; skip: () => void;
  openFlameDetails: (target: FlameDetailsTarget) => void;
}) {
  const reward = board.flameSelection!;
  const selected = reward.acquired ? undefined : reward.offers.find(item => item.id === selectedOffer);
  return <Stack gap="xs" className="flame-selection-screen">
    <Group justify="space-between" className="shop-summary flame-selection-header phase-sticky-header">
      <Text fw={800}>FLAME SELECTION</Text><Badge color="yellow" variant="light">{formatPlayerNumber(board.gold)} Gold</Badge>
    </Group>
    {busy && <ScoreResolution event={event} busy={busy} onSkip={skip} showXMult={hasXMultFlame(board.dice, board.bonfires)} />}
    {board.bonfires.length > 0 && <Paper p="xs" className="shop-section bonfire-strip" data-testid="bonfires">
      <Group gap="xs"><Text fw={700} size="sm" tt="uppercase">Bonfires</Text>{board.bonfires.map(id => <Badge component="button" type="button" key={id}
        color="red" variant="light" className="flame-detail-trigger" aria-label={`View ${FLAMES[id].name} Flame details`}
        onClick={() => openFlameDetails({ flame: id, kind: 'bonfire' })}>🔥 {FLAMES[id].name}</Badge>)}</Group>
    </Paper>}
    <Paper p="xs" className="shop-section flame-offers-section">
      <Group justify="space-between" className="section-heading"><Text fw={700} size="sm" tt="uppercase">Flame Offers</Text></Group>
      {reward.offers.length === 0 && <Text ta="center" fw={900} py="md" data-testid="all-flames-collected">ALL FLAMES COLLECTED</Text>}
      <div className="shop-grid flame-offers">{reward.offers.map(item => <Card key={item.id} p="sm"
        className={`flame-offer ${selectedOffer === item.id && !reward.acquired ? 'selected' : ''}`} data-testid={`flame-offer-${item.flame}`}>
        <Group className="flame-offer-header" justify="space-between" wrap="nowrap"><Group className="flame-offer-identity" gap={3} wrap="nowrap">
          <span className="flame-offer-icon" aria-hidden="true">🔥</span><Text className="flame-offer-name" fw={750}>{FLAMES[item.flame].name}</Text>
          <Button className="flame-offer-info" size="compact-xs" variant="subtle" color="gray"
            aria-label={`About ${FLAMES[item.flame].name}`} onClick={() => openFlameDetails({ flame: item.flame, kind: 'offer' })}>ⓘ</Button>
        </Group><Badge className="flame-offer-price" size="xs" color="teal">FREE</Badge></Group>
        <Button className="flame-offer-action" size="compact-xs" fullWidth mt="xs" color="orange"
          variant={selectedOffer === item.id && !reward.acquired ? 'filled' : 'light'} disabled={busy || reward.acquired}
          onClick={() => setSelectedOffer(selectedOffer === item.id ? null : item.id)}>{selectedOffer === item.id ? 'Choose a die below' : 'Select Flame'}</Button>
      </Card>)}</div>
    </Paper>
    <Paper p="xs" className="shop-section flame-dock-instruction">
      <Text fw={700} size="sm" tt="uppercase">Dice Dock</Text>
      <Text size="xs" c={selected ? 'orange' : 'dimmed'}>{selected ? `${FLAMES[selected.flame].name} selected — choose a die below` : 'Select a Flame, then assign it in the Dice Dock.'}</Text>
    </Paper>
    <div className="shop-action-dock"><Button disabled={busy} onClick={() => submit({ type: 'CONTINUE_FLAME_SELECTION' })}>CONTINUE TO SHOP →</Button></div>
  </Stack>;
}
