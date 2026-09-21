import { Badge, Button, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { diceRerollCost, offerRerollCost, roundReward } from '../game/config';
import { activeFace } from '../game/dice';
import { canAttach, enhancementCost, ENHANCEMENTS, ENHANCEMENT_IDS } from '../game/enhancements';
import { hasXMultFlame } from '../game/flames';
import type { Action, Board, GameEvent } from '../game/types';
import { DiceRow } from './DiceRow';
import { EnhancementCard } from './EnhancementCard';
import { ScoreResolution } from './ScoreResolution';
import { TrainingCard } from './TrainingCard';

export function ShopScreen({ board, event, busy, progress, selectedOffer, setSelectedOffer, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean; progress: { current: number; total: number };
  selectedOffer: number | null; setSelectedOffer: (id: number | null) => void; submit: (action: Action) => void; skip: () => void;
}) {
  const shop = board.shop!;
  const offer = shop.offers.find(item => item.id === selectedOffer && !item.purchased);
  const eligibleIds = offer && board.gold >= enhancementCost(offer.enhancement)
    ? board.dice.filter(die => canAttach(activeFace(die), offer.enhancement)).map(die => die.id) : [];
  return <Stack gap="xs" className="shop-screen">
    <Group justify="space-between" className="shop-summary">
      <Text size="sm"><strong>Round {board.round} cleared</strong> · +{board.lastRoundPayout?.total ?? roundReward()} Gold
        {board.lastRoundPayout ? ` (${board.lastRoundPayout.base} base + ${board.lastRoundPayout.unusedRerolls} rerolls + ${board.lastRoundPayout.interest} interest)` : ''} · {board.score - board.target} above goal</Text>
      <Badge color="teal" variant="light">SHOP</Badge>
    </Group>
    {busy && <ScoreResolution event={event} busy={busy} {...progress} onSkip={skip} showXMult={hasXMultFlame(board.dice, board.bonfires)} />}
    <Paper p="xs" className="shop-section">
      <Group justify="space-between" className="section-heading">
        <Text fw={700} size="sm" tt="uppercase" lts=".08em">Hand Training</Text>
        <Tooltip label="Permanent Base Pips and Base Mult upgrades for this run" withArrow><Text size="xs" c="violet">ⓘ 4 gold each</Text></Tooltip>
      </Group>
      <div className="shop-grid training-grid">{shop.trainingOffers.map(item => <TrainingCard key={item.hand} offer={item}
        level={board.handLevels[item.hand]} gold={board.gold} busy={busy}
        onTrain={() => submit({ type: 'TRAIN_HAND', hand: item.hand })} />)}</div>
    </Paper>
    <Paper p="xs" className="shop-section" data-testid="enhancement-scrap-manager">
      <Group justify="space-between" className="section-heading"><Text fw={700} size="sm" tt="uppercase">Manage faces</Text><Text size="xs" c="dimmed">Scrap all stacks of a type · no refund</Text></Group>
      <div className="scrap-grid">{board.dice.map(die => <div key={die.id} className="help-item"><Text size="xs" fw={700}>D{die.id + 1}</Text>
        {die.faces.map(face => { const ids = ENHANCEMENT_IDS.filter(id => face.enhancements[id]); return ids.length ? <Group key={face.rank} gap={4} mt={3} wrap="wrap"><Text size="xs">Face {face.rank}:</Text>{ids.map(id => <Button key={id} size="compact-xs" variant="subtle" color="red" disabled={busy}
          aria-label={`Scrap ${ENHANCEMENTS[id].name} from D${die.id + 1} face ${face.rank}`}
          onClick={() => submit({ type: 'SCRAP_ENHANCEMENT', dieId: die.id, face: face.rank, enhancement: id })}>{ENHANCEMENTS[id].name} ×{face.enhancements[id]} ✕</Button>)}</Group> : null; })}
      </div>)}</div>
    </Paper>
    <Paper p="xs" className="shop-section">
      <Group justify="space-between" className="section-heading">
        <Text fw={700} size="sm" tt="uppercase" lts=".08em">Enhancements</Text>
        <Button size="compact-xs" variant="default" disabled={busy || board.gold < offerRerollCost(shop.offerRerolls)}
          aria-label={`Reroll Enhancements · ${offerRerollCost(shop.offerRerolls)} gold`}
          onClick={() => submit({ type: 'REROLL_OFFERS' })}>↻ Reroll · {offerRerollCost(shop.offerRerolls)} gold</Button>
      </Group>
      <div className="shop-grid enhancement-grid">{shop.offers.map(item => <EnhancementCard key={item.id} offer={item} selected={selectedOffer === item.id}
        gold={board.gold} busy={busy} onSelect={() => setSelectedOffer(selectedOffer === item.id ? null : item.id)} />)}</div>
    </Paper>
    <Paper p="xs" className="shop-section exposed-section">
      <Group justify="space-between" className="section-heading">
        <Group gap="xs"><Text fw={700} size="sm" tt="uppercase" lts=".08em">Exposed Faces</Text>{offer && <Badge size="xs" color="teal">{ENHANCEMENTS[offer.enhancement].name} selected</Badge>}</Group>
        <Group gap="xs">
          {offer && <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setSelectedOffer(null)}>Cancel placement</Button>}
          <Button size="compact-xs" variant="default" disabled={busy || board.gold < diceRerollCost(shop.diceRerolls)}
            aria-label={`Reroll Dice · ${diceRerollCost(shop.diceRerolls)} gold`}
            onClick={() => submit({ type: 'REROLL_DICE' })}>↻ Dice · {diceRerollCost(shop.diceRerolls)} gold</Button>
        </Group>
      </Group>
      <DiceRow dice={board.dice} event={event} disabled={busy} eligibleIds={eligibleIds}
        onClick={dieId => { if (offer) submit({ type: 'BUY', offerId: offer.id, dieId }); }}
        onDropOffer={(offerId, dieId) => submit({ type: 'BUY', offerId, dieId })} />
    </Paper>
    <div className="shop-action-dock">
      <Text size="xs" c="dimmed">Upgrades are permanent for this run.</Text>
      <Button size="sm" disabled={busy} aria-label="NEXT ROUND" onClick={() => submit({ type: 'NEXT_ROUND' })}>NEXT ROUND →</Button>
    </div>
  </Stack>;
}
