import { ActionIcon, Badge, Button, Card, Group, Modal, Paper, Progress, Stack, Tabs, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { CONFIG, offerRerollCost } from '../game/config';
import { dieSellBreakdown, firstPurchaseSlot, fusionEffectSummary, slotValue } from '../game/diceEconomy';
import { SPECIAL_DICE } from '../game/specialDice';
import type { Action, Board, CollectibleDie, DiceInventory, DiceSlotRef, GameEvent } from '../game/types';
import { ScoreResolution } from './ScoreResolution';
import { TrainingScorecard } from './TrainingScorecard';
import { BossPreview } from './BossPanel';
import { BOSSES } from '../game/bosses';
import { formatPlayerNumber } from '../game/copy';
import { dicePurchaseIsFree } from '../game/specialOffers';
import { chapterLabel, chapterRoundForRound } from '../game/chapters';
import { RunActionLayout, RunActionPortal } from './RunActionRow';
import { RarityBadge } from './RarityBadge';
import { flameEffectText, flameInstances, FLAMES } from '../game/flames';
import type { FlameDetailsTarget } from './FlameDetailsModal';
import { CollectibleDieVisual } from './CollectibleDieVisual';
import { DieTypeLabel, diePresentationStyle } from './DieTypeLabel';
import { RichDescription } from './RichDescription';
import { chameleonTieDetail } from '../game/effectDescriptions';

const hearts = (lives: number) => Array.from({ length: CONFIG.maxLives }, (_, index) => index < lives ? '♥' : '♡').join(' ');
const slotKey = (slot: DiceSlotRef) => `${slot.area}:${slot.index}`;
const slotName = (slot: DiceSlotRef) => `${slot.area === 'roster' ? 'Roster' : 'Storage'} ${slot.index + 1}`;

function CollectionDieCard({ die, slot, selected, dragging, dropTarget, arriving, rolling, busy, onSelect, onDetails, onSell,
  onDragStart, onDragEnd, onDragEnter, onDrop }: {
  die: CollectibleDie | null; slot: DiceSlotRef; selected: boolean; dragging: boolean; dropTarget: boolean;
  arriving: boolean; rolling: boolean; busy: boolean;
  onSelect: () => void; onDetails: () => void; onSell: () => void;
  onDragStart: (event: React.DragEvent) => void; onDragEnd: () => void; onDragEnter: () => void;
  onDrop: (event: React.DragEvent) => void;
}) {
  const sale = die ? dieSellBreakdown(die) : null;
  const slotCode = `${slot.area === 'roster' ? 'D' : 'S'}${slot.index + 1}`;
  return <Card withBorder p="xs"
    className={`collection-slot die-selection-target ${slot.area}${selected ? ' selected is-die-selected' : ''}${dragging ? ' is-die-dragging' : ''}${dropTarget ? ' valid-drop-target' : ''}${arriving ? ' arriving' : ''} ${die ? 'occupied' : 'empty'}`}
    style={die ? diePresentationStyle(die.type) : undefined}
    data-testid={`collection-slot-${slot.area}-${slot.index}`} data-die-id={die?.id ?? undefined}
    data-selected={selected || undefined} data-dragging={dragging || undefined} data-drop-target={dropTarget || undefined}
    draggable={!!die && !busy} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragEnter={onDragEnter}
    onDragOver={event => { if (!busy) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={onDrop}>
    <button type="button" className="collection-slot-main" disabled={busy} onClick={onSelect}
      aria-label={die ? `${slotName(slot)}, ${SPECIAL_DICE[die.type].name}, level ${die.level}` : `${slotName(slot)}, empty`}>
      {die ? <>
        <CollectibleDieVisual type={die.type} face={die.value as 1 | 2 | 3 | 4 | 5 | 6}
          slotLabel={slotCode} compact={slot.area === 'storage'} rolling={rolling} />
        {die.type !== 'normal' && <Text className="collection-die-name" fw={850}><DieTypeLabel type={die.type} level={die.level} /></Text>}
        <Text size="xs" className="collection-die-meta">Sell {sale!.total}G</Text>
        {die.type === 'vintage' && <Text size="xs" c="teal">+{die.vintageAppreciation} appreciation</Text>}
      </> : <><span className="empty-collection-die" aria-hidden="true">+</span><Text size="xs" c="dimmed" fw={700}>{slotCode}</Text></>}
    </button>
    {die && <Group gap={2} justify="center" className="collection-slot-actions">
      <Button size="compact-xs" variant="subtle" onClick={onDetails} disabled={busy}>INFO</Button>
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
  const [showProgressNudge, setShowProgressNudge] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<DiceSlotRef | null>(null);
  const [draggingSlot, setDraggingSlot] = useState<DiceSlotRef | null>(null);
  const [dragTargetSlot, setDragTargetSlot] = useState<DiceSlotRef | null>(null);
  const [fusion, setFusion] = useState<{ source: DiceSlotRef; destination: DiceSlotRef } | null>(null);
  const [saleSlot, setSaleSlot] = useState<DiceSlotRef | null>(null);
  const [detailSlot, setDetailSlot] = useState<DiceSlotRef | null>(null);
  const [detailOfferType, setDetailOfferType] = useState<CollectibleDie['type'] | null>(null);
  const [arrivalId, setArrivalId] = useState<number | null>(null);
  const [startWarning, setStartWarning] = useState(false);
  const exitLockStartedAt = useRef(Date.now());
  const knownDieIds = useRef(new Set(Object.keys(inventory.instances).map(Number)));
  const rosterCount = inventory.roster.filter(id => id !== null).length;
  const ownedFlames = flameInstances(board);
  const hasFlames = ownedFlames.length > 0;
  const collectionFull = firstPurchaseSlot(inventory) === null;
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
    setSelectedSlot(null); setFusion(null); setSaleSlot(null); setDetailSlot(null); setDetailOfferType(null);
  }, [stage]);
  useEffect(() => {
    const current = new Set(Object.keys(inventory.instances).map(Number));
    const added = [...current].find(id => !knownDieIds.current.has(id)) ?? null;
    knownDieIds.current = current;
    if (added === null) return;
    setArrivalId(added);
    const timer = window.setTimeout(() => setArrivalId(null), 900);
    return () => window.clearTimeout(timer);
  }, [inventory.instances]);

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
    setDraggingSlot(slot);
  }
  function finishDrag() { setDraggingSlot(null); setDragTargetSlot(null); }
  function drop(event: React.DragEvent, destination: DiceSlotRef) {
    event.preventDefault();
    try {
      const source = JSON.parse(event.dataTransfer.getData('application/x-roll-call-die-slot')) as DiceSlotRef;
      if ((source.area === 'roster' || source.area === 'storage') && Number.isInteger(source.index)) {
        setSelectedSlot(source); chooseDrop(source, destination);
      }
    } catch { /* Ignore foreign drag payloads. */ }
    finishDrag();
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
  const detailType = detailDie?.type ?? detailOfferType;
  const detailLevel = detailDie?.level ?? 1;

  const slots = (area: 'roster' | 'storage', values: Array<number | null>) => values.map((_id, index) => {
    const slot = { area, index } satisfies DiceSlotRef;
    return <CollectionDieCard key={slotKey(slot)} die={dieAt(slot)} slot={slot} busy={busy}
      arriving={dieAt(slot)?.id === arrivalId}
      rolling={!!dieAt(slot) && event?.type === 'DICE_REROLL_STARTED' && !!event.dieIds?.includes(dieAt(slot)!.id)}
      selected={selectedSlot !== null && slotKey(selectedSlot) === slotKey(slot)} onSelect={() => chooseSlot(slot)}
      dragging={draggingSlot !== null && slotKey(draggingSlot) === slotKey(slot)}
      dropTarget={dragTargetSlot !== null && slotKey(dragTargetSlot) === slotKey(slot)}
      onDetails={() => setDetailSlot(slot)} onSell={() => setSaleSlot(slot)}
      onDragStart={event => beginDrag(event, slot)} onDragEnd={finishDrag}
      onDragEnter={() => { if (draggingSlot && slotKey(draggingSlot) !== slotKey(slot)) setDragTargetSlot(slot); }}
      onDrop={event => drop(event, slot)} />;
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
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Tabs className="shop-stage-tabs" value={stage} onChange={value => {
          if (value && value !== stage) submit({ type: 'SET_SHOP_STAGE', stage: value as typeof stage });
        }}>
          <Tabs.List>
            <Tabs.Tab value="dice" disabled={busy} data-testid="shop-stage-dice">DICE</Tabs.Tab>
            <Tabs.Tab value="training" disabled={busy} data-testid="shop-stage-training">TRAINING</Tabs.Tab>
            {hasFlames && <Tabs.Tab value="fireKeeping" disabled={busy} data-testid="shop-stage-fire-keeping">FIRE KEEPING</Tabs.Tab>}
          </Tabs.List>
        </Tabs>
        <Badge color="yellow" variant="light" size="lg" data-testid="shop-stage-gold">{formatPlayerNumber(board.gold)} GOLD</Badge>
      </Group>
    </Paper>

    {stage === 'dice' && <Paper p="xs" className="shop-section dice-shop-section" data-testid="dice-shop">
      <Group justify="space-between" className="section-heading"><Text fw={700} size="sm" tt="uppercase" lts=".08em">Dice</Text>
        <Button size="compact-xs" variant="default" disabled={busy || board.gold < offerRerollCost(shop.offerRerolls)}
          aria-label={`REROLL OFFERS · ${offerRerollCost(shop.offerRerolls)} GOLD`}
          onClick={() => submit({ type: 'REROLL_OFFERS' })}>REROLL OFFERS · {offerRerollCost(shop.offerRerolls)} GOLD</Button></Group>
      <div className="dice-offer-grid">{shop.offers.map(offer => {
        const available = !!offer.dieType && !!offer.rarity && offer.price !== undefined && !offer.purchased;
        const free = dicePurchaseIsFree(shop);
        const affordable = free || board.gold >= (offer.price ?? Infinity);
        return <Card key={offer.id} withBorder p="xs" className={`dice-offer ${offer.purchased ? 'purchased' : ''}`}
          style={offer.dieType ? diePresentationStyle(offer.dieType) : undefined}
          data-die-type={offer.dieType} data-testid={`dice-offer-${offer.id}`}>
          {offer.dieType && offer.rarity ? <><ActionIcon className="dice-offer-info" variant="subtle" color="gray" size="sm"
              aria-label={`View ${SPECIAL_DICE[offer.dieType].name} details`} onClick={() => setDetailOfferType(offer.dieType)}>ⓘ</ActionIcon>
            <CollectibleDieVisual type={offer.dieType} face={((offer.id % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6} />
            <Text className="dice-offer-name" fw={850}><DieTypeLabel type={offer.dieType} /></Text>
            <RarityBadge rarity={offer.rarity} compact />
            <Text size="xs" fw={850} c="yellow" data-testid={`dice-offer-price-${offer.id}`}>{offer.price} GOLD</Text>
            <Button className="dice-offer-buy" size="compact-xs" fullWidth disabled={busy || !available || !affordable || collectionFull}
              onClick={() => submit({ type: 'BUY_DIE', offerId: offer.id })}>{offer.purchased ? 'PURCHASED' : collectionFull ? 'COLLECTION FULL'
                : !affordable ? `NEED ${offer.price}G` : free ? 'FREE' : 'BUY'}</Button></> : <Text c="dimmed">Offer unavailable</Text>}
        </Card>;
      })}</div>
      <Stack gap={5} mt="xs" className="dice-collection">
        <Group justify="space-between"><Text size="xs" fw={850} tt="uppercase">Storage</Text>
          <Text size="xs" c="dimmed">{inventory.storage.filter(Boolean).length} / {inventory.storage.length}</Text></Group>
        <div className="collection-grid storage-grid" data-testid="storage-strip">{slots('storage', inventory.storage)}</div>
        <div className="roster-collection-dock" data-testid="shop-roster-dock">
          <Group justify="space-between" className="collection-heading"><Text size="xs" fw={850} tt="uppercase">Roster</Text>
            <Text size="xs" c="dimmed">{rosterCount} / 5 equipped</Text></Group>
          <div className="collection-grid roster-grid">{slots('roster', inventory.roster)}</div>
        </div>
      </Stack>
    </Paper>}

    {stage === 'training' && <Paper p="xs" className="shop-section training-shop-section" data-testid="training-shop" data-tutorial="hand-training">
      <Group justify="space-between" className="section-heading"><div><Text fw={700} size="sm" tt="uppercase" lts=".08em">Training</Text>
        <Text size="xs" c="dimmed">Training costs more as a hand rises above the rest of its section.</Text></div></Group>
      <TrainingScorecard handLevels={board.handLevels} shop={shop} gold={board.gold} busy={busy}
        onTrain={hand => submit({ type: 'TRAIN_HAND', hand })} />
    </Paper>}

    {stage === 'fireKeeping' && hasFlames && <Paper p="xs" className="shop-section fire-keeping-section" data-testid="fire-keeping-shop">
      <Group justify="space-between" className="section-heading"><div><Text fw={700} size="sm" tt="uppercase" lts=".08em">Fire Keeping</Text>
        <Text size="xs" c="dimmed">Feed Gold to your Flames to make them stronger. At 100 Gold, an Ember becomes a Bonfire.</Text></div>
        <Badge color="orange" variant="light">{ownedFlames.length} / 5 FLAMES</Badge></Group>
      <div className="fire-keeping-grid" data-testid="global-flame-slots">
          {ownedFlames.map(flame => <Card key={`flame-${flame.instanceId}`} withBorder p="sm"
            className={`fire-keeping-card ${flame.stage}`} data-testid={`fire-keeping-flame-${flame.instanceId}`}>
            <Group justify="space-between"><Text fw={850}>{FLAMES[flame.type].name}</Text>
              <Badge color={flame.stage === 'bonfire' ? 'red' : 'orange'} variant="light">{flame.stage.toUpperCase()}</Badge></Group>
            <Text size="xs" c="dimmed" mt={4}>{flameEffectText(flame.type, flame.investedGold, board)}</Text>
            <Group justify="space-between" mt="xs"><Text size="xs">Investment</Text><Text size="xs" fw={800}>{flame.investedGold} / 100 Gold</Text></Group>
            <Progress value={flame.investedGold} color={flame.stage === 'bonfire' ? 'red' : 'orange'} size="sm" mt={4} />
            <Button mt="sm" color={flame.stage === 'bonfire' ? 'red' : 'orange'} variant="light" disabled={busy}
              onClick={() => openFlameDetails({ flameInstanceId: flame.instanceId, kind: flame.stage })}>{flame.stage === 'bonfire' ? 'VIEW BONFIRE' : 'MANAGE FLAME'}</Button>
          </Card>)}
        </div>
    </Paper>}

    <RunActionPortal><RunActionLayout className="shop-action-dock"
      right={stage === 'dice' ? <Button size="sm" disabled={busy} data-testid="shop-stage-continue"
          onClick={() => submit({ type: 'SET_SHOP_STAGE', stage: 'training' })}>CONTINUE TO TRAINING →</Button>
        : stage === 'training' && hasFlames ? <Button size="sm" disabled={busy} data-testid="shop-stage-continue"
          onClick={() => submit({ type: 'SET_SHOP_STAGE', stage: 'fireKeeping' })}>CONTINUE TO FIRE KEEPING →</Button>
        : <Button size="sm" disabled={busy || shop.exitUnlocked === false || rosterCount === 0}
          aria-label={returnedFromBust ? `RETRY ROUND ${formatPlayerNumber(retryRound)}` : nextChapter ? 'NEXT CHAPTER' : 'NEXT ROUND'}
          className={showProgressNudge ? 'tutorial-progression-nudge' : undefined} data-testid="shop-progression-action"
          data-tutorial-nudge={showProgressNudge || undefined} color={returnedFromBust ? 'red' : undefined} onClick={requestProgression}>
          {returnedFromBust ? `RETRY ROUND ${formatPlayerNumber(retryRound)}` : nextChapter ? 'NEXT CHAPTER' : 'NEXT ROUND'} →
        </Button>} /></RunActionPortal>

    <Modal opened={fusion !== null} onClose={() => { setFusion(null); setSelectedSlot(null); }} title="FUSE DICE?" centered>
      {fusion && sourceFusionDie && destinationFusionDie && fusionPreview && <Stack>
        <Text fw={850} className="fusion-die-line"><DieTypeLabel type={sourceFusionDie.type} level={destinationFusionDie.level} /> + <DieTypeLabel type={sourceFusionDie.type} level={sourceFusionDie.level} /></Text>
        <Text className="fusion-die-line">→ <DieTypeLabel type={sourceFusionDie.type} level={sourceFusionDie.level + destinationFusionDie.level} /></Text>
        <Text size="sm" c="dimmed">{fusionPreview.label}<br /><strong>{fusionPreview.before} → {fusionPreview.after}</strong></Text>
        <Group justify="flex-end"><Button variant="default" onClick={() => { setFusion(null); setSelectedSlot(null); }}>CANCEL</Button>
          <Button variant="default" onClick={() => { submitMove(fusion.source, fusion.destination); setFusion(null); }}>SWAP</Button>
          <Button onClick={() => { submit({ type: 'FUSE_DICE', source: fusion.source, destination: fusion.destination,
            expectedSourceDieId: sourceFusionDie.id, expectedDestinationDieId: destinationFusionDie.id }); setFusion(null); setSelectedSlot(null); }}>FUSE</Button></Group>
      </Stack>}
    </Modal>

    <Modal opened={saleSlot !== null} onClose={() => setSaleSlot(null)} title="SELL DIE?" centered>
      {saleSlot && saleDie && <Stack>{saleDie.type === 'normal' ? <Text fw={850}>Normal</Text> : <Text fw={850}><DieTypeLabel type={saleDie.type} level={saleDie.level} /></Text>}
        {saleSlot.area === 'roster' && rosterCount < 6 && <Paper p="sm" withBorder><Text fw={800}>EMPTY ROSTER SLOT</Text>
          <Text size="sm">Selling this die will leave you with only {rosterCount - 1} dice equipped. Some hands may become impossible to Play.</Text></Paper>}
        <Text size="xl" fw={900}>+{dieSellBreakdown(saleDie).total} GOLD</Text>
        <Group justify="flex-end"><Button variant="default" onClick={() => setSaleSlot(null)}>CANCEL</Button>
          <Button color="yellow" disabled={saleSlot.area === 'roster' && rosterCount <= 1}
            onClick={() => { submit({ type: 'SELL_DIE', slot: saleSlot, expectedDieId: saleDie.id }); setSaleSlot(null); setSelectedSlot(null); }}>{saleSlot.area === 'roster' ? 'SELL ANYWAY' : 'SELL'}</Button></Group>
      </Stack>}
    </Modal>

    <Modal opened={detailType !== null} onClose={() => { setDetailSlot(null); setDetailOfferType(null); }} title="DIE DETAILS" centered>
      {detailType && <Stack><Group justify="space-between"><Text fw={900} size="lg">{detailType === 'normal' ? 'Normal' : <DieTypeLabel type={detailType} level={detailLevel} />}</Text>
        {SPECIAL_DICE[detailType].rarity && <RarityBadge rarity={SPECIAL_DICE[detailType].rarity!} />}</Group>
        <RichDescription copy={SPECIAL_DICE[detailType].verboseDescription(detailLevel)} />
        {detailType === 'chameleon' && <RichDescription copy={chameleonTieDetail} size="xs" />}
        {detailType !== 'normal' && <Text size="sm" c="dimmed">Level effect: {fusionEffectSummary(detailType, detailLevel, detailLevel).before}</Text>}
        {detailDie?.type === 'vintage' && <Text>Vintage appreciation: +{detailDie.vintageAppreciation} Gold</Text>}
        {detailDie?.type === 'weighted' && <div><Text size="sm" fw={800}>WEIGHTED FACE · {detailDie.weightedFace}</Text>
          <Group gap={4} mt={4}>{([1, 2, 3, 4, 5, 6] as const).map(face => <Button key={face} size="compact-xs"
            variant={detailDie.weightedFace === face ? 'filled' : 'default'} onClick={() => submit({ type: 'SET_WEIGHTED_FACE', dieId: detailDie.id, face })}>{face}</Button>)}</Group></div>}
        {detailDie && <Text size="sm" c="dimmed">Current sell value: {dieSellBreakdown(detailDie).total} Gold</Text>}
        <Button variant="default" onClick={() => { setDetailSlot(null); setDetailOfferType(null); }}>CLOSE</Button></Stack>}
    </Modal>

    <Modal opened={startWarning} onClose={() => setStartWarning(false)} title={`ONLY ${rosterCount} OF 5 DICE EQUIPPED`} centered>
      <Text>Some hands may be impossible to Play with this Roster.</Text>
      <Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setStartWarning(false)}>GO BACK</Button>
        <Button disabled={rosterCount === 0} onClick={() => { setStartWarning(false); submit(progressionAction); }}>START ROUND</Button></Group>
    </Modal>
  </Stack>;
}
