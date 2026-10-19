import { Badge, Button, Card, Group, Modal, Paper, Progress, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { CONFIG, diceRerollCost, offerRerollCost } from '../game/config';
import { dieEffectDescription, dieSellBreakdown, firstPurchaseSlot, fusionEffectSummary, slotValue } from '../game/diceEconomy';
import { SPECIAL_DICE } from '../game/specialDice';
import type { Action, Board, CollectibleDie, DiceInventory, DiceSlotRef, GameEvent } from '../game/types';
import { ScoreResolution } from './ScoreResolution';
import { TrainingCard } from './TrainingCard';
import { BossPreview } from './BossPanel';
import { BOSSES } from '../game/bosses';
import { formatPlayerNumber } from '../game/copy';
import { dicePurchaseIsFree, trainingOfferIsFree } from '../game/specialOffers';
import { chapterLabel, chapterRoundForRound } from '../game/chapters';
import { RunActionLayout, RunActionPortal } from './RunActionRow';
import { RarityBadge } from './RarityBadge';
import { activeFlameId, activeFlameInvestment, FLAMES } from '../game/flames';
import type { FlameDetailsTarget } from './FlameDetailsModal';

const hearts = (lives: number) => Array.from({ length: CONFIG.maxLives }, (_, index) => index < lives ? '♥' : '♡').join(' ');
const slotKey = (slot: DiceSlotRef) => `${slot.area}:${slot.index}`;
const slotName = (slot: DiceSlotRef) => `${slot.area === 'roster' ? 'Roster' : 'Storage'} ${slot.index + 1}`;

function CollectionDieCard({ die, slot, selected, busy, onSelect, onDetails, onSell, onDragStart, onDrop }: {
  die: CollectibleDie | null; slot: DiceSlotRef; selected: boolean; busy: boolean;
  onSelect: () => void; onDetails: () => void; onSell: () => void;
  onDragStart: (event: React.DragEvent) => void; onDrop: (event: React.DragEvent) => void;
}) {
  const sale = die ? dieSellBreakdown(die) : null;
  return <Card withBorder p="xs" className={`collection-slot ${selected ? 'selected' : ''} ${die ? 'occupied' : 'empty'}`}
    data-testid={`collection-slot-${slot.area}-${slot.index}`} data-die-id={die?.id ?? undefined}
    draggable={!!die && !busy} onDragStart={onDragStart}
    onDragOver={event => { if (!busy) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={onDrop}>
    <button type="button" className="collection-slot-main" disabled={busy} onClick={onSelect}
      aria-label={die ? `${slotName(slot)}, ${SPECIAL_DICE[die.type].name} D6 level ${die.level}` : `${slotName(slot)}, empty`}>
      <Text size="xs" c="dimmed" fw={800}>{slotName(slot).toUpperCase()}</Text>
      {die ? <>
        <Group gap={5} justify="center" wrap="wrap"><Text fw={850}>{SPECIAL_DICE[die.type].name} D6</Text>
          {die.type !== 'normal' && SPECIAL_DICE[die.type].rarity && <RarityBadge rarity={SPECIAL_DICE[die.type].rarity!} compact />}</Group>
        <Text size="xs">Lv{die.level} · Sell {sale!.total} Gold</Text>
        {die.type === 'vintage' && <Text size="xs" c="teal">+{die.vintageAppreciation} appreciation</Text>}
      </> : <Text c="dimmed" fw={700}>EMPTY SLOT</Text>}
    </button>
    {die && <Group gap={4} justify="center" mt={4}>
      <Button size="compact-xs" variant="subtle" onClick={onDetails} disabled={busy}>DETAILS</Button>
      <Button size="compact-xs" variant="subtle" color="yellow" onClick={onSell} disabled={busy}>SELL</Button>
    </Group>}
  </Card>;
}

export function ShopScreen({ board, inventory, event, busy, submit, skip, openFlameDetails, tutorialProgressNudgeEligible = false }: {
  board: Board; inventory: DiceInventory; event: GameEvent | null; busy: boolean;
  submit: (action: Action) => void; skip: () => void; tutorialProgressNudgeEligible?: boolean;
  openFlameDetails: (target: FlameDetailsTarget) => void;
}) {
  const shop = board.shop!;
  const stage = shop.stage ?? 'dice';
  const returnedFromBust = board.bust;
  const nextChapter = !returnedFromBust && shop.kind === 'post_boss';
  const upcomingBoss = board.bossSchedule[board.round + 1];
  const retryRound = chapterRoundForRound(board.round);
  const rerollCost = diceRerollCost(shop.diceRerolls);
  const [showProgressNudge, setShowProgressNudge] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<DiceSlotRef | null>(null);
  const [fusion, setFusion] = useState<{ source: DiceSlotRef; destination: DiceSlotRef } | null>(null);
  const [saleSlot, setSaleSlot] = useState<DiceSlotRef | null>(null);
  const [detailSlot, setDetailSlot] = useState<DiceSlotRef | null>(null);
  const [startWarning, setStartWarning] = useState(false);
  const exitLockStartedAt = useRef(Date.now());
  const rosterCount = inventory.roster.filter(id => id !== null).length;
  const collectionFull = firstPurchaseSlot(inventory) === null;
  const ownedSlots = [
    ...inventory.roster.map((_id, index) => ({ area: 'roster' as const, index })),
    ...inventory.storage.map((_id, index) => ({ area: 'storage' as const, index })),
  ];
  const carriedFlames = ownedSlots.flatMap(slot => {
    const id = slotValue(inventory, slot);
    const die = id === null || id === undefined ? null : inventory.instances[id] ?? null;
    const flame = activeFlameId(die?.flame);
    return die && flame ? [{ die, flame, slot }] : [];
  });
  useEffect(() => {
    if (shop.exitUnlocked !== false || busy) return;
    const remaining = Math.max(0, 1000 - (Date.now() - exitLockStartedAt.current));
    const timer = window.setTimeout(() => submit({ type: 'UNLOCK_SHOP_EXIT' }), remaining);
    return () => window.clearTimeout(timer);
  }, [busy, shop.exitUnlocked, submit]);
  useEffect(() => {
    setShowProgressNudge(false);
    if (!tutorialProgressNudgeEligible) return;
    const timer = window.setTimeout(() => setShowProgressNudge(true), 5000);
    return () => window.clearTimeout(timer);
  }, [tutorialProgressNudgeEligible]);
  useEffect(() => {
    if (stage === 'dice') return;
    setSelectedSlot(null); setFusion(null); setSaleSlot(null); setDetailSlot(null);
  }, [stage]);

  const dieAt = (slot: DiceSlotRef) => {
    const id = slotValue(inventory, slot);
    return id === null || id === undefined ? null : inventory.instances[id] ?? null;
  };
  function submitMove(source: DiceSlotRef, destination: DiceSlotRef) {
    const sourceId = slotValue(inventory, source);
    const destinationId = slotValue(inventory, destination) ?? null;
    if (sourceId === null || sourceId === undefined) return;
    submit({ type: 'MOVE_DIE', source, destination, expectedSourceDieId: sourceId, expectedDestinationDieId: destinationId });
    setSelectedSlot(null);
  }
  function chooseSlot(destination: DiceSlotRef) {
    if (busy) return;
    if (!selectedSlot) {
      if (dieAt(destination)) setSelectedSlot(destination);
      return;
    }
    if (slotKey(selectedSlot) === slotKey(destination)) { setSelectedSlot(null); return; }
    const sourceDie = dieAt(selectedSlot);
    const destinationDie = dieAt(destination);
    if (sourceDie && destinationDie && sourceDie.type !== 'normal' && sourceDie.type === destinationDie.type) {
      setFusion({ source: selectedSlot, destination });
      return;
    }
    submitMove(selectedSlot, destination);
  }
  function beginDrag(event: React.DragEvent, slot: DiceSlotRef) {
    event.dataTransfer.setData('application/x-roll-call-die-slot', JSON.stringify(slot));
    event.dataTransfer.effectAllowed = 'move';
    setSelectedSlot(slot);
  }
  function drop(event: React.DragEvent, destination: DiceSlotRef) {
    event.preventDefault();
    try {
      const source = JSON.parse(event.dataTransfer.getData('application/x-roll-call-die-slot')) as DiceSlotRef;
      if ((source.area === 'roster' || source.area === 'storage') && Number.isInteger(source.index)) {
        setSelectedSlot(source); chooseDrop(source, destination);
      }
    } catch { /* Ignore foreign drag payloads. */ }
  }
  function chooseDrop(source: DiceSlotRef, destination: DiceSlotRef) {
    if (slotKey(source) === slotKey(destination)) { setSelectedSlot(null); return; }
    const sourceDie = dieAt(source); const destinationDie = dieAt(destination);
    if (sourceDie && destinationDie && sourceDie.type !== 'normal' && sourceDie.type === destinationDie.type)
      setFusion({ source, destination });
    else submitMove(source, destination);
  }
  const progressionAction: Action = returnedFromBust ? { type: 'RETRY_ROUND' } : nextChapter ? { type: 'NEXT_CHAPTER' } : { type: 'NEXT_ROUND' };
  function requestProgression() {
    if (rosterCount < 5) setStartWarning(true);
    else submit(progressionAction);
  }
  const sourceFusionDie = fusion ? dieAt(fusion.source) : null;
  const destinationFusionDie = fusion ? dieAt(fusion.destination) : null;
  const fusionPreview = sourceFusionDie && destinationFusionDie && sourceFusionDie.type !== 'normal'
    ? fusionEffectSummary(sourceFusionDie.type, destinationFusionDie.level, sourceFusionDie.level + destinationFusionDie.level) : null;
  const saleDie = saleSlot ? dieAt(saleSlot) : null;
  const detailDie = detailSlot ? dieAt(detailSlot) : null;

  const slots = (area: 'roster' | 'storage', values: Array<number | null>) => values.map((_id, index) => {
    const slot = { area, index } satisfies DiceSlotRef;
    return <CollectionDieCard key={slotKey(slot)} die={dieAt(slot)} slot={slot} busy={busy}
      selected={selectedSlot !== null && slotKey(selectedSlot) === slotKey(slot)} onSelect={() => chooseSlot(slot)}
      onDetails={() => setDetailSlot(slot)} onSell={() => setSaleSlot(slot)}
      onDragStart={event => beginDrag(event, slot)} onDrop={event => drop(event, slot)} />;
  });

  return <Stack gap="xs" className="shop-screen">
    <div className="shop-summary phase-sticky-header">{returnedFromBust ? <Paper px="sm" py={6} className="bust-shop-banner" data-testid="bust-shop-banner">
      <Group justify="space-between" gap="xs" wrap="wrap"><div><Text size="sm" fw={850} c="red">{chapterLabel(returnedFromBust.round)} BUST</Text><Text size="xs" c="dimmed">1 Life Lost</Text></div>
        <Text fw={800} c="red" aria-label={`${board.lives} of ${CONFIG.maxLives} lives`}>{hearts(board.lives)}</Text></Group>
    </Paper> : <Group justify="space-between"><Text fw={800}>SHOP</Text><Text size="xs" c="dimmed">{upcomingBoss
      ? `Prepare for ${BOSSES[upcomingBoss].name}` : `Prepare for ${chapterLabel(board.round + 1)}`}</Text></Group>}</div>
    {busy && <ScoreResolution event={event} busy={busy} onSkip={skip} />}
    <BossPreview board={board} />

    <Paper p="xs" className="shop-stage-shell" data-testid="shop-stage-indicator">
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Group gap={5} wrap="nowrap" className="shop-stage-steps">
          <Button size="compact-xs" variant={stage === 'dice' ? 'filled' : 'subtle'}
            disabled={busy || stage === 'dice' || stage === 'fireKeeping'} data-active={stage === 'dice' || undefined}
            data-testid="shop-stage-dice" onClick={() => submit({ type: 'SET_SHOP_STAGE', stage: 'dice' })}>DICE</Button>
          <Text size="xs" c="dimmed">→</Text>
          <Button size="compact-xs" variant={stage === 'training' ? 'filled' : 'subtle'}
            disabled={busy || stage === 'dice' || stage === 'training'} data-active={stage === 'training' || undefined}
            data-testid="shop-stage-training" onClick={() => submit({ type: 'SET_SHOP_STAGE', stage: 'training' })}>TRAINING</Button>
          <Text size="xs" c="dimmed">→</Text>
          <Button size="compact-xs" variant={stage === 'fireKeeping' ? 'filled' : 'subtle'} disabled
            data-active={stage === 'fireKeeping' || undefined} data-testid="shop-stage-fire-keeping">FIRE KEEPING</Button>
        </Group>
        <Badge color="yellow" variant="light" size="lg" data-testid="shop-stage-gold">{formatPlayerNumber(board.gold)} GOLD</Badge>
      </Group>
    </Paper>

    {stage === 'dice' && <Paper p="xs" className="shop-section dice-shop-section" data-testid="dice-shop">
      <Group justify="space-between" className="section-heading"><Text fw={700} size="sm" tt="uppercase" lts=".08em">Dice</Text>
        <Button size="compact-xs" variant="default" disabled={busy || board.gold < offerRerollCost(shop.offerRerolls)}
          aria-label={`REROLL DICE OFFERS · ${offerRerollCost(shop.offerRerolls)} GOLD`}
          onClick={() => submit({ type: 'REROLL_OFFERS' })}>REROLL OFFERS · {offerRerollCost(shop.offerRerolls)} GOLD</Button></Group>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs" className="dice-offer-grid">{shop.offers.map(offer => {
        const available = !!offer.dieType && !!offer.rarity && offer.price !== undefined && !offer.purchased;
        const free = dicePurchaseIsFree(shop);
        const affordable = free || board.gold >= (offer.price ?? Infinity);
        return <Card key={offer.id} withBorder p="sm" className={`dice-offer ${offer.purchased ? 'purchased' : ''}`}
          data-testid={`dice-offer-${offer.id}`}>
          {offer.dieType && offer.rarity ? <><Group justify="space-between"><Text fw={850}>{SPECIAL_DICE[offer.dieType].name} D6</Text><RarityBadge rarity={offer.rarity} compact /></Group>
            <Text size="xs" c="dimmed" mt={4}>{dieEffectDescription(offer.dieType, 1)}</Text>
            <Text size="xs" fw={850} c="yellow" mt={4} data-testid={`dice-offer-price-${offer.id}`}>{offer.price} GOLD</Text>
            <Button mt="xs" size="compact-sm" fullWidth disabled={busy || !available || !affordable || collectionFull}
              onClick={() => submit({ type: 'BUY_DIE', offerId: offer.id })}>{offer.purchased ? 'PURCHASED' : collectionFull ? 'COLLECTION FULL'
                : !affordable ? `NEED ${offer.price} GOLD` : free ? `BUY · FREE (${offer.price} GOLD VALUE)` : `BUY · ${offer.price} GOLD`}</Button></> : <Text c="dimmed">Legacy offer unavailable</Text>}
        </Card>;
      })}</SimpleGrid>
      <Stack gap={6} mt="sm"><Text size="xs" fw={850} tt="uppercase">Roster · {rosterCount} / 5 equipped</Text>
        <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="xs" className="collection-grid roster-grid">{slots('roster', inventory.roster)}</SimpleGrid>
        <Text size="xs" fw={850} tt="uppercase" mt={4}>Storage · {inventory.storage.length} slots</Text>
        <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="xs" className="collection-grid storage-grid">{slots('storage', inventory.storage)}</SimpleGrid></Stack>
    </Paper>}

    {stage === 'training' && <Paper p="xs" className="shop-section training-shop-section" data-testid="training-shop" data-tutorial="hand-training">
      <Group justify="space-between" className="section-heading"><Text fw={700} size="sm" tt="uppercase" lts=".08em">Training</Text></Group>
      <div className="shop-grid training-grid">{shop.trainingOffers.map(item => <TrainingCard
        key={item.kind === 'team' ? 'team' : item.hand} offer={item} handLevels={board.handLevels} gold={board.gold} busy={busy} free={trainingOfferIsFree(shop, item)}
        onTrain={() => submit(item.kind === 'team' ? { type: 'TRAIN_ALL_HANDS' } : { type: 'TRAIN_HAND', hand: item.hand })} />)}</div>
    </Paper>}

    {stage === 'fireKeeping' && <Paper p="xs" className="shop-section fire-keeping-section" data-testid="fire-keeping-shop">
      <Group justify="space-between" className="section-heading"><div><Text fw={700} size="sm" tt="uppercase" lts=".08em">Fire Keeping</Text>
        <Text size="xs" c="dimmed">Invest Gold in carried Embers. At 100 Gold, an Ember becomes a Bonfire.</Text></div></Group>
      {carriedFlames.length === 0 && board.bonfires.length === 0
        ? <Paper p="md" withBorder ta="center"><Text fw={750}>NO FLAMES TO TEND</Text><Text size="sm" c="dimmed">Flame rewards are earned separately after Big Bosses.</Text></Paper>
        : <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" className="fire-keeping-grid">
          {carriedFlames.map(({ die, flame, slot }) => {
            const investment = activeFlameInvestment(die.flame);
            return <Card key={`ember-${die.id}`} withBorder p="sm" className="fire-keeping-card" data-testid={`fire-keeping-ember-${die.id}`}>
              <Group justify="space-between"><div><Text size="xs" c="dimmed" fw={800}>{slotName(slot).toUpperCase()}</Text>
                <Text fw={850}>{FLAMES[flame].name}</Text></div><Badge color="orange" variant="light">EMBER</Badge></Group>
              <Group justify="space-between" mt="xs"><Text size="xs">Investment</Text><Text size="xs" fw={800}>{investment} / 100 Gold</Text></Group>
              <Progress value={investment} color="orange" size="sm" mt={4} />
              <Button mt="sm" color="orange" variant="light" disabled={busy} onClick={() => openFlameDetails({ flame, kind: 'ember', dieId: die.id })}>MANAGE FLAME</Button>
            </Card>;
          })}
          {board.bonfires.map(flame => <Card key={`bonfire-${flame}`} withBorder p="sm" className="fire-keeping-card bonfire" data-testid={`fire-keeping-bonfire-${flame}`}>
            <Group justify="space-between"><Text fw={850}>{FLAMES[flame].name}</Text><Badge color="red" variant="light">BONFIRE</Badge></Group>
            <Text size="sm" c="dimmed" mt="xs">Fully invested and active at full strength.</Text>
            <Button mt="sm" color="red" variant="light" disabled={busy} onClick={() => openFlameDetails({ flame, kind: 'bonfire' })}>VIEW BONFIRE</Button>
          </Card>)}
        </SimpleGrid>}
    </Paper>}

    <RunActionPortal><RunActionLayout className="shop-action-dock"
      left={stage === 'dice' ? <Button className="shop-dice-reroll" size="sm" variant="default" disabled={busy || board.gold < rerollCost}
          aria-label={`REROLL ALL DICE FOR ${formatPlayerNumber(rerollCost)} GOLD`} data-testid="shop-dice-reroll"
          onClick={() => submit({ type: 'REROLL_DICE' })}>REROLL ALL DICE FOR {formatPlayerNumber(rerollCost)} GOLD</Button>
        : <Button size="sm" variant="default" disabled={busy} data-testid="shop-stage-back"
          onClick={() => submit({ type: 'SET_SHOP_STAGE', stage: stage === 'training' ? 'dice' : 'training' })}>
          {stage === 'training' ? 'BACK TO DICE' : 'BACK TO TRAINING'}
        </Button>}
      right={stage !== 'fireKeeping' ? <Button size="sm" disabled={busy} data-testid="shop-stage-continue"
          onClick={() => submit({ type: 'SET_SHOP_STAGE', stage: stage === 'dice' ? 'training' : 'fireKeeping' })}>
          {stage === 'dice' ? 'CONTINUE TO TRAINING' : 'CONTINUE TO FIRE KEEPING'} →
        </Button>
        : <Button size="sm" disabled={busy || shop.exitUnlocked === false || rosterCount === 0}
          aria-label={returnedFromBust ? `RETRY ROUND ${formatPlayerNumber(retryRound)}` : nextChapter ? 'NEXT CHAPTER' : 'NEXT ROUND'}
          className={showProgressNudge ? 'tutorial-progression-nudge' : undefined} data-testid="shop-progression-action"
          data-tutorial-nudge={showProgressNudge || undefined} color={returnedFromBust ? 'red' : undefined} onClick={requestProgression}>
          {returnedFromBust ? `RETRY ROUND ${formatPlayerNumber(retryRound)}` : nextChapter ? 'NEXT CHAPTER' : 'NEXT ROUND'} →
        </Button>} /></RunActionPortal>

    <Modal opened={fusion !== null} onClose={() => { setFusion(null); setSelectedSlot(null); }} title="FUSE DICE?" centered>
      {fusion && sourceFusionDie && destinationFusionDie && fusionPreview && <Stack>
        <Text fw={850}>{SPECIAL_DICE[sourceFusionDie.type].name} D6 Lv{destinationFusionDie.level} + {SPECIAL_DICE[sourceFusionDie.type].name} D6 Lv{sourceFusionDie.level}</Text>
        <Text>→ {SPECIAL_DICE[sourceFusionDie.type].name} D6 Lv{sourceFusionDie.level + destinationFusionDie.level}</Text>
        <Text size="sm" c="dimmed">{fusionPreview.label}<br /><strong>{fusionPreview.before} → {fusionPreview.after}</strong></Text>
        <Group justify="flex-end"><Button variant="default" onClick={() => { setFusion(null); setSelectedSlot(null); }}>CANCEL</Button>
          <Button variant="default" onClick={() => { submitMove(fusion.source, fusion.destination); setFusion(null); }}>SWAP</Button>
          <Button onClick={() => { submit({ type: 'FUSE_DICE', source: fusion.source, destination: fusion.destination,
            expectedSourceDieId: sourceFusionDie.id, expectedDestinationDieId: destinationFusionDie.id }); setFusion(null); setSelectedSlot(null); }}>FUSE</Button></Group>
      </Stack>}
    </Modal>

    <Modal opened={saleSlot !== null} onClose={() => setSaleSlot(null)} title="SELL DIE?" centered>
      {saleSlot && saleDie && <Stack><Text fw={850}>{SPECIAL_DICE[saleDie.type].name} D6 · Lv{saleDie.level}</Text>
        {saleSlot.area === 'roster' && rosterCount < 6 && <Paper p="sm" withBorder><Text fw={800}>EMPTY ROSTER SLOT</Text>
          <Text size="sm">Selling this die will leave you with only {rosterCount - 1} dice equipped. Some hands may become impossible to Play.</Text></Paper>}
        {saleDie.flame && <Text c="orange">This die carries a Flame and cannot be sold until that Flame is moved or completed.</Text>}
        <Text size="xl" fw={900}>+{dieSellBreakdown(saleDie).total} GOLD</Text>
        <Group justify="flex-end"><Button variant="default" onClick={() => setSaleSlot(null)}>CANCEL</Button>
          <Button color="yellow" disabled={!!saleDie.flame || (saleSlot.area === 'roster' && rosterCount <= 1)}
            onClick={() => { submit({ type: 'SELL_DIE', slot: saleSlot, expectedDieId: saleDie.id }); setSaleSlot(null); setSelectedSlot(null); }}>{saleSlot.area === 'roster' ? 'SELL ANYWAY' : 'SELL'}</Button></Group>
      </Stack>}
    </Modal>

    <Modal opened={detailSlot !== null} onClose={() => setDetailSlot(null)} title="DIE DETAILS" centered>
      {detailDie && <Stack><Group justify="space-between"><Text fw={900} size="lg">{SPECIAL_DICE[detailDie.type].name} D6 · Lv{detailDie.level}</Text>
        {SPECIAL_DICE[detailDie.type].rarity && <RarityBadge rarity={SPECIAL_DICE[detailDie.type].rarity!} />}</Group>
        <Text>{dieEffectDescription(detailDie.type, detailDie.level)}</Text>
        {detailDie.type === 'vintage' && <Text>Vintage appreciation: +{detailDie.vintageAppreciation} Gold</Text>}
        {detailDie.type === 'weighted' && <div><Text size="sm" fw={800}>WEIGHTED FACE · {detailDie.weightedFace}</Text>
          <Group gap={4} mt={4}>{([1, 2, 3, 4, 5, 6] as const).map(face => <Button key={face} size="compact-xs"
            variant={detailDie.weightedFace === face ? 'filled' : 'default'} onClick={() => submit({ type: 'SET_WEIGHTED_FACE', dieId: detailDie.id, face })}>{face}</Button>)}</Group></div>}
        <Text size="sm" c="dimmed">Current sell value: {dieSellBreakdown(detailDie).total} Gold</Text>
        <Button variant="default" onClick={() => setDetailSlot(null)}>CLOSE</Button></Stack>}
    </Modal>

    <Modal opened={startWarning} onClose={() => setStartWarning(false)} title={`ONLY ${rosterCount} OF 5 DICE EQUIPPED`} centered>
      <Text>Some hands may be impossible to Play with this Roster.</Text>
      <Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setStartWarning(false)}>GO BACK</Button>
        <Button disabled={rosterCount === 0} onClick={() => { setStartWarning(false); submit(progressionAction); }}>START ROUND</Button></Group>
    </Modal>
  </Stack>;
}
