import { Badge, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { diceRerollCost, offerRerollCost, roundReward } from '../game/config';
import { activeFace } from '../game/dice';
import { canAttach, enhancementCost, ENHANCEMENTS } from '../game/enhancements';
import type { Action, Board, GameEvent } from '../game/types';
import { DiceRow } from './DiceRow';
import { EnhancementCard } from './EnhancementCard';
import { ScoreResolution } from './ScoreResolution';

export function ShopScreen({ board, event, busy, progress, selectedOffer, setSelectedOffer, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean; progress: { current: number; total: number };
  selectedOffer: number | null; setSelectedOffer: (id: number | null) => void; submit: (action: Action) => void; skip: () => void;
}) {
  const shop = board.shop!;
  const offer = shop.offers.find(item => item.id === selectedOffer && !item.purchased);
  const eligibleIds = offer && board.gold >= enhancementCost(offer.enhancement)
    ? board.dice.filter(die => canAttach(activeFace(die), offer.enhancement)).map(die => die.id) : [];
  return <Stack gap="lg">
    <Paper withBorder p="lg">
      <Group justify="space-between">
        <div><Title order={2} size="h3">Build your dice</Title><Text size="sm" c="dimmed">Round {board.round} cleared · +{roundReward(board.round)} gold · {board.score - board.target} points above goal</Text></div>
        <Badge color="teal" variant="light">Permanent face enhancements</Badge>
      </Group>
      <Text size="sm" mt="md">Drag an offer onto a die, or select an offer and click a die. Only its exposed physical face receives the enhancement.</Text>
      <div className="offers">{shop.offers.map(item => <EnhancementCard key={item.id} offer={item} selected={selectedOffer === item.id}
        gold={board.gold} busy={busy} onSelect={() => setSelectedOffer(selectedOffer === item.id ? null : item.id)} />)}</div>
      <Group justify="space-between" mt="md">
        <Button variant="default" disabled={busy || board.gold < offerRerollCost(shop.offerRerolls)} onClick={() => submit({ type: 'REROLL_OFFERS' })}>
          Reroll Enhancements · {offerRerollCost(shop.offerRerolls)} gold
        </Button>
        <Text size="xs" c="dimmed">Purchased slots stay empty until you refresh.</Text>
      </Group>
    </Paper>
    {busy && <ScoreResolution event={event} busy={busy} {...progress} onSkip={skip} />}
    <div>
      <Group justify="space-between" mb="xs">
        <Text fw={600}>Exposed faces</Text>
        {offer && <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setSelectedOffer(null)}>Cancel placement</Button>}
      </Group>
      <Text size="sm" c="dimmed">{offer ? `${ENHANCEMENTS[offer.enhancement].name} selected. Outlined dice accept this enhancement.` : 'Reroll to expose a different face. Weighted works here; other abilities wait for the round.'}</Text>
      <DiceRow dice={board.dice} event={event} disabled={busy} eligibleIds={eligibleIds}
        onClick={dieId => { if (offer) submit({ type: 'BUY', offerId: offer.id, dieId }); }}
        onDropOffer={(offerId, dieId) => submit({ type: 'BUY', offerId, dieId })} />
      <Group justify="space-between" mt="lg">
        <Button variant="default" disabled={busy || board.gold < diceRerollCost(shop.diceRerolls)} onClick={() => submit({ type: 'REROLL_DICE' })}>
          Reroll Dice · {diceRerollCost(shop.diceRerolls)} gold
        </Button>
        <Button size="lg" disabled={busy} onClick={() => submit({ type: 'NEXT_ROUND' })}>NEXT ROUND</Button>
      </Group>
    </div>
  </Stack>;
}
