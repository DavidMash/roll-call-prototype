import { ActionIcon, Badge, Button, Card, Group, Modal, Paper, Progress, Stack, Tabs, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { BOSSES } from '../game/bosses';
import { chapterLabel, chapterRoundForRound } from '../game/chapters';
import { CONFIG, offerRerollCost } from '../game/config';
import { formatPlayerNumber } from '../game/copy';
import { firstPurchaseSlot, slotValue } from '../game/diceEconomy';
import { availableShopStages } from '../game/engine';
import { chameleonTieDetail } from '../game/effectDescriptions';
import { flameEffectText, flameInstances, FLAMES } from '../game/flames';
import { dieForgeRating, dieSellBreakdown, formatForgeValue, previewForge } from '../game/forge';
import { createDieEffect, SPECIAL_DICE } from '../game/specialDice';
import { dicePurchaseIsFree } from '../game/specialOffers';
import type { Action, Board, CollectibleDie, DiceInventory, DiceSlotRef, GameEvent } from '../game/types';
import { BossPreview } from './BossPanel';
import { CollectibleDieVisual } from './CollectibleDieVisual';
import { DieEffectsLabel, DieTypeLabel, diePresentationStyle } from './DieTypeLabel';
import type { FlameDetailsTarget } from './FlameDetailsModal';
import { RarityBadge } from './RarityBadge';
import { RichDescription } from './RichDescription';
import { RunActionLayout, RunActionPortal } from './RunActionRow';
import { ScoreResolution } from './ScoreResolution';
import { TrainingScorecard } from './TrainingScorecard';

const hearts = (lives: number) => Array.from({ length: CONFIG.maxLives }, (_, index) => index < lives ? '♥' : '♡').join(' ');
const slotKey = (slot: DiceSlotRef) => `${slot.area}:${slot.index}`;
const slotName = (slot: DiceSlotRef) => `${slot.area === 'roster' ? 'Roster' : 'Storage'} ${slot.index + 1}`;

function CollectionDieCard({ die, slot, selected, dragging, dropTarget, arriving, rolling, busy, onSelect, onDetails, onSell,
  onDragStart, onDragEnd, onDragEnter, onDrop }: {
  die: CollectibleDie | null; slot: DiceSlotRef; selected: boolean; dragging: boolean; dropTarget: boolean;
  arriving: boolean; rolling: boolean; busy: boolean; onSelect: () => void; onDetails: () => void; onSell: () => void;
  onDragStart: (event: React.DragEvent) => void; onDragEnd: () => void; onDragEnter: () => void; onDrop: (event: React.DragEvent) => void;
}) {
  const sale = die ? dieSellBreakdown(die) : null;
  const slotCode = `${slot.area === 'roster' ? 'D' : 'S'}${slot.index + 1}`;
  const identity = die?.effects.map(effect => `${SPECIAL_DICE[effect.type].name} ${effect.level}`).join(', ') || 'Normal';
  return <Card withBorder p="xs"
    className={`collection-slot die-selection-target ${slot.area}${selected ? ' selected is-die-selected' : ''}${dragging ? ' is-die-dragging' : ''}${dropTarget ? ' valid-drop-target' : ''}${arriving ? ' arriving' : ''} ${die ? 'occupied' : 'empty'}`}
    style={die ? diePresentationStyle(die) : undefined} data-testid={`collection-slot-${slot.area}-${slot.index}`}
    data-die-id={die?.id ?? undefined} data-effect-count={die?.effects.length ?? undefined}
    data-selected={selected || undefined} data-dragging={dragging || undefined} data-drop-target={dropTarget || undefined}
    draggable={!!die && !busy} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragEnter={onDragEnter}
    onDragOver={event => { if (!busy) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={onDrop}>
    <button type="button" className="collection-slot-main" disabled={busy} onClick={onSelect}
      aria-label={die ? `${slotName(slot)}, ${identity}` : `${slotName(slot)}, empty`}>
      {die ? <><CollectibleDieVisual effects={die.effects} face={die.value as 1 | 2 | 3 | 4 | 5 | 6}
        slotLabel={slotCode} compact={slot.area === 'storage'} rolling={rolling} />
        {!!die.effects.length && <Text className="collection-die-name" fw={850}><DieEffectsLabel effects={die.effects} /></Text>}
        <Text size="xs" className="collection-die-meta">Sell {sale!.total}G</Text></>
        : <><span className="empty-collection-die" aria-hidden="true">+</span><Text size="xs" c="dimmed" fw={700}>{slotCode}</Text></>}
    </button>
    {die && <Group gap={2} justify="center" className="collection-slot-actions"><Button size="compact-xs" variant="subtle" onClick={onDetails} disabled={busy}>INFO</Button>
      <Button size="compact-xs" variant="subtle" color="yellow" onClick={onSell} disabled={busy}>SELL</Button></Group>}
  </Card>;
}

function EffectDetails({ effects }: { effects: CollectibleDie['effects'] }) {
  return <Stack gap="sm">{effects.map(effect => <Paper key={effect.id} withBorder p="sm" className="forge-effect-summary">
    <Group justify="space-between"><Text fw={900}><DieTypeLabel type={effect.type} level={effect.level} /></Text>
      <RarityBadge rarity={SPECIAL_DICE[effect.type].rarity} compact /></Group>
    <RichDescription copy={SPECIAL_DICE[effect.type].verboseDescription(effect.level)} />
    {effect.type === 'chameleon' && <RichDescription copy={chameleonTieDetail} size="xs" />}
    {effect.type === 'vintage' && <Text size="xs">Appreciation: +{effect.persistent.vintageAppreciation} Gold</Text>}
    {effect.type === 'weighted' && <Text size="xs">Weighted face: {effect.persistent.weightedFace}</Text>}
  </Paper>)}</Stack>;
}

export function ShopScreen({ board, inventory, event, busy, submit, skip, openFlameDetails, tutorialProgressNudgeEligible = false }: {
  board: Board; inventory: DiceInventory; event: GameEvent | null; busy: boolean; submit: (action: Action) => void;
  skip: () => void; tutorialProgressNudgeEligible?: boolean; openFlameDetails: (target: FlameDetailsTarget) => void;
}) {
  const shop = board.shop!;
  const stage = shop.stage ?? 'shop';
  const returnedFromBust = board.bust;
  const nextChapter = !returnedFromBust && shop.kind === 'post_boss';
  const upcomingBoss = board.bossSchedule[board.round + 1];
  const retryRound = chapterRoundForRound(board.round);
  const [showProgressNudge, setShowProgressNudge] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<DiceSlotRef | null>(null);
  const [draggingSlot, setDraggingSlot] = useState<DiceSlotRef | null>(null);
  const [dragTargetSlot, setDragTargetSlot] = useState<DiceSlotRef | null>(null);
  const [saleSlot, setSaleSlot] = useState<DiceSlotRef | null>(null);
  const [detailDie, setDetailDie] = useState<CollectibleDie | null>(null);
  const [confirmForge, setConfirmForge] = useState(false);
  const [arrivalId, setArrivalId] = useState<number | null>(null);
  const [startWarning, setStartWarning] = useState(false);
  const exitLockStartedAt = useRef(Date.now());
  const knownDieIds = useRef(new Set(Object.keys(inventory.instances).map(Number)));
  const rosterCount = inventory.roster.filter(id => id !== null).length;
  const ownedFlames = flameInstances(board);
  const collectionFull = firstPurchaseSlot(inventory) === null;
  const stages = availableShopStages(board);

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
  useEffect(() => { if (stage !== 'shop') { setSelectedSlot(null); setSaleSlot(null); setDetailDie(null); } }, [stage]);
  useEffect(() => {
    const current = new Set(Object.keys(inventory.instances).map(Number));
    const added = [...current].find(id => !knownDieIds.current.has(id)) ?? null;
    knownDieIds.current = current;
    if (added === null) return;
    setArrivalId(added);
    const timer = window.setTimeout(() => setArrivalId(null), 900);
    return () => window.clearTimeout(timer);
  }, [inventory.instances]);

  const dieAt = (slot: DiceSlotRef) => { const id = slotValue(inventory, slot); return id == null ? null : inventory.instances[id] ?? null; };
  const slotForDie = (id: number): DiceSlotRef | null => {
    const roster = inventory.roster.indexOf(id); if (roster >= 0) return { area: 'roster', index: roster };
    const storage = inventory.storage.indexOf(id); return storage >= 0 ? { area: 'storage', index: storage } : null;
  };
  function submitMove(source: DiceSlotRef, destination: DiceSlotRef) {
    const sourceId = slotValue(inventory, source); const destinationId = slotValue(inventory, destination) ?? null;
    if (sourceId == null) return;
    submit({ type: 'MOVE_DIE', source, destination, expectedSourceDieId: sourceId, expectedDestinationDieId: destinationId }); setSelectedSlot(null);
  }
  function chooseSlot(destination: DiceSlotRef) {
    if (busy) return;
    if (!selectedSlot) { if (dieAt(destination)) setSelectedSlot(destination); return; }
    if (slotKey(selectedSlot) === slotKey(destination)) { setSelectedSlot(null); return; }
    submitMove(selectedSlot, destination);
  }
  function beginDrag(event: React.DragEvent, slot: DiceSlotRef) {
    event.dataTransfer.setData('application/x-roll-call-die-slot', JSON.stringify(slot)); event.dataTransfer.effectAllowed = 'move';
    setSelectedSlot(slot); setDraggingSlot(slot);
  }
  function finishDrag() { setDraggingSlot(null); setDragTargetSlot(null); }
  function drop(event: React.DragEvent, destination: DiceSlotRef) {
    event.preventDefault();
    try { const source = JSON.parse(event.dataTransfer.getData('application/x-roll-call-die-slot')) as DiceSlotRef;
      if ((source.area === 'roster' || source.area === 'storage') && Number.isInteger(source.index)) submitMove(source, destination);
    } catch { /* Ignore foreign drag payloads. */ }
    finishDrag();
  }
  const progressionAction: Action = returnedFromBust ? { type: 'RETRY_ROUND' } : nextChapter ? { type: 'NEXT_CHAPTER' } : { type: 'NEXT_ROUND' };
  function requestProgression() { if (rosterCount < 5) setStartWarning(true); else submit(progressionAction); }
  const saleDie = saleSlot ? dieAt(saleSlot) : null;
  const slots = (area: 'roster' | 'storage', values: Array<number | null>) => values.map((_id, index) => {
    const slot = { area, index } satisfies DiceSlotRef;
    return <CollectionDieCard key={slotKey(slot)} die={dieAt(slot)} slot={slot} busy={busy} arriving={dieAt(slot)?.id === arrivalId}
      rolling={!!dieAt(slot) && event?.type === 'DICE_REROLL_STARTED' && !!event.dieIds?.includes(dieAt(slot)!.id)}
      selected={selectedSlot !== null && slotKey(selectedSlot) === slotKey(slot)} onSelect={() => chooseSlot(slot)}
      dragging={draggingSlot !== null && slotKey(draggingSlot) === slotKey(slot)} dropTarget={dragTargetSlot !== null && slotKey(dragTargetSlot) === slotKey(slot)}
      onDetails={() => setDetailDie(dieAt(slot))} onSell={() => setSaleSlot(slot)} onDragStart={event => beginDrag(event, slot)} onDragEnd={finishDrag}
      onDragEnter={() => { if (draggingSlot && slotKey(draggingSlot) !== slotKey(slot)) setDragTargetSlot(slot); }} onDrop={event => drop(event, slot)} />;
  });
  const selection = shop.forgeSelection ?? { dieAId: null, dieBId: null };
  const dieA = selection.dieAId == null ? null : inventory.instances[selection.dieAId] ?? null;
  const dieB = selection.dieBId == null ? null : inventory.instances[selection.dieBId] ?? null;
  const forgePreview = dieA && dieB ? previewForge(dieA, dieB) : null;
  const forgeEligible = Object.values(inventory.instances).filter(die => die.effects.length);

  const forwardStage = stage === 'shop' ? (stages.includes('forge') ? 'forge' : 'train') : stage === 'forge' ? 'train'
    : stage === 'train' && stages.includes('flames') ? 'flames' : null;
  const forwardLabel = forwardStage === 'forge' ? 'CONTINUE TO FORGE →' : forwardStage === 'train' ? 'CONTINUE TO TRAINING →'
    : forwardStage === 'flames' ? 'CONTINUE TO FLAMES →' : null;

  return <Stack gap="xs" className="shop-screen">
    <div className="shop-summary phase-sticky-header">{returnedFromBust ? <Paper px="sm" py={6} className="bust-shop-banner" data-testid="bust-shop-banner">
      <Group justify="space-between" gap="xs" wrap="wrap"><div><Text size="sm" fw={850} c="red">{chapterLabel(returnedFromBust.round)} BUST</Text><Text size="xs" c="dimmed">1 Life Lost</Text></div>
        <Text fw={800} c="red" aria-label={`${board.lives} of ${CONFIG.maxLives} lives`}>{hearts(board.lives)}</Text></Group></Paper>
      : <Group justify="space-between"><Text fw={800}>SHOP</Text><Text size="xs" c="dimmed">{upcomingBoss ? `Prepare for ${BOSSES[upcomingBoss].name}` : `Prepare for ${chapterLabel(board.round + 1)}`}</Text></Group>}</div>
    {busy && <ScoreResolution event={event} busy={busy} onSkip={skip} />}
    <BossPreview board={board} />
    <Paper p="xs" className="shop-stage-shell" data-testid="shop-stage-indicator"><Group justify="space-between" gap="xs" wrap="nowrap">
      <Tabs className="shop-stage-tabs" value={stage} onChange={value => { if (value && value !== stage) submit({ type: 'SET_SHOP_STAGE', stage: value as typeof stage }); }}>
        <Tabs.List>{stages.map(value => <Tabs.Tab key={value} value={value} disabled={busy} data-testid={`shop-stage-${value}`}>{value.toUpperCase()}</Tabs.Tab>)}</Tabs.List>
      </Tabs><Group gap={5} wrap="nowrap"><Badge color="orange" variant="light" size="lg" data-testid="shop-stage-temper">{formatPlayerNumber(board.temper)} TEMPER</Badge>
        <Badge color="yellow" variant="light" size="lg" data-testid="shop-stage-gold">{formatPlayerNumber(board.gold)} GOLD</Badge></Group>
    </Group></Paper>

    {stage === 'shop' && <Paper p="xs" className="shop-section dice-shop-section" data-testid="dice-shop">
      <Group justify="space-between" className="section-heading"><Text fw={700} size="sm" tt="uppercase" lts=".08em">Dice</Text>
        <Button size="compact-xs" variant="default" disabled={busy || board.gold < offerRerollCost(shop.offerRerolls)}
          aria-label={`REROLL OFFERS · ${offerRerollCost(shop.offerRerolls)} GOLD`} onClick={() => submit({ type: 'REROLL_OFFERS' })}>REROLL OFFERS · {offerRerollCost(shop.offerRerolls)} GOLD</Button></Group>
      <div className="dice-offer-grid">{shop.offers.map(offer => {
        const effect = createDieEffect(-offer.id - 1, offer.dieType); const effects = [effect]; const free = dicePurchaseIsFree(shop);
        const affordable = free || board.gold >= offer.price; const available = !offer.purchased;
        return <Card key={offer.id} withBorder p="xs" className={`dice-offer ${offer.purchased ? 'purchased' : ''}`} style={diePresentationStyle({ effects })}
          data-die-type={offer.dieType} data-testid={`dice-offer-${offer.id}`}><ActionIcon className="dice-offer-info" variant="subtle" color="gray" size="sm"
            aria-label={`View ${SPECIAL_DICE[offer.dieType].name} details`} onClick={() => setDetailDie({ id: effect.id.length * -1, owner: 'player', value: 1, faces: [], effects })}>ⓘ</ActionIcon>
          <CollectibleDieVisual effects={effects} face={((offer.id % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6} />
          <Text className="dice-offer-name" fw={850}><DieTypeLabel type={offer.dieType} /></Text><RarityBadge rarity={offer.rarity} compact />
          <Text size="xs" fw={850} c="yellow" data-testid={`dice-offer-price-${offer.id}`}>{offer.price} GOLD</Text>
          <Button className="dice-offer-buy" size="compact-xs" fullWidth disabled={busy || !available || !affordable || collectionFull}
            onClick={() => submit({ type: 'BUY_DIE', offerId: offer.id })}>{offer.purchased ? 'PURCHASED' : collectionFull ? 'COLLECTION FULL' : !affordable ? `NEED ${offer.price}G` : free ? 'FREE' : 'BUY'}</Button>
        </Card>;
      })}</div>
      <Stack gap={5} mt="xs" className="dice-collection"><Group justify="space-between"><Text size="xs" fw={850} tt="uppercase">Storage</Text><Text size="xs" c="dimmed">{inventory.storage.filter(Boolean).length} / 5</Text></Group>
        <div className="collection-grid storage-grid" data-testid="storage-strip">{slots('storage', inventory.storage)}</div>
        <div className="roster-collection-dock" data-testid="shop-roster-dock"><Group justify="space-between" className="collection-heading"><Text size="xs" fw={850} tt="uppercase">Roster</Text><Text size="xs" c="dimmed">{rosterCount} / 5 equipped</Text></Group>
          <div className="collection-grid roster-grid">{slots('roster', inventory.roster)}</div></div></Stack>
    </Paper>}

    {stage === 'forge' && <Paper p="sm" className="shop-section forge-shop-section" data-testid="forge-shop">
      <Group justify="space-between" className="section-heading"><div><Text fw={800}>FORGE</Text><Text size="xs" c="dimmed">Die A survives. Die B is consumed. Matching effect sets fuse; other combinations forge.</Text></div>
        <Badge color="orange" variant="light">{formatPlayerNumber(board.temper)} TEMPER</Badge></Group>
      <div className="forge-sockets"><Card withBorder p="sm" className="forge-socket" data-testid="forge-socket-a"><Text size="xs" fw={900}>DIE A · SURVIVES</Text>
        {dieA ? <><CollectibleDieVisual effects={dieA.effects} face={dieA.value as 1|2|3|4|5|6} /><DieEffectsLabel effects={dieA.effects} />
          <Button size="compact-xs" variant="subtle" onClick={() => submit({ type: 'SET_FORGE_INGREDIENT', socket: 'A', dieId: null })}>CLEAR</Button></> : <Text c="dimmed">Choose a special die below.</Text>}</Card>
        <Button variant="default" onClick={() => submit({ type: 'SWAP_FORGE_INGREDIENTS' })} disabled={busy || !dieA || !dieB}>SWAP A / B</Button>
        <Card withBorder p="sm" className="forge-socket" data-testid="forge-socket-b"><Text size="xs" fw={900}>DIE B · CONSUMED</Text>
        {dieB ? <><CollectibleDieVisual effects={dieB.effects} face={dieB.value as 1|2|3|4|5|6} /><DieEffectsLabel effects={dieB.effects} />
          <Button size="compact-xs" variant="subtle" onClick={() => submit({ type: 'SET_FORGE_INGREDIENT', socket: 'B', dieId: null })}>CLEAR</Button></> : <Text c="dimmed">Choose a different special die below.</Text>}</Card></div>
      <div className="forge-die-picker">{forgeEligible.map(die => { const slot = slotForDie(die.id); const active = die.id === dieA?.id || die.id === dieB?.id;
        return <Button key={die.id} variant={active ? 'light' : 'default'} className="forge-die-option" disabled={busy}
          onClick={() => submit({ type: 'SET_FORGE_INGREDIENT', socket: !dieA || dieB ? 'A' : 'B', dieId: die.id })}>
          {slot ? `${slot.area === 'roster' ? 'D' : 'S'}${slot.index + 1} · ` : ''}<DieEffectsLabel effects={die.effects} /></Button>; })}</div>
      {forgePreview && <Paper withBorder p="sm" className="forge-preview" data-testid="forge-preview"><Group justify="space-between"><Text fw={900}>{forgePreview.kind === 'fusion' ? 'FUSION' : 'TRUE FORGE'}</Text>
        <Text fw={900} c="orange">{formatForgeValue(forgePreview.cost)} TEMPER</Text></Group>
        <Text size="sm">Result: <DieEffectsLabel effects={forgePreview.effects} /></Text><Text size="xs" c="dimmed">Forge Rating {formatForgeValue(forgePreview.rating)} · Sell {forgePreview.sellValue} Gold</Text>
        <Button mt="sm" fullWidth color="orange" disabled={busy || forgePreview.cost > BigInt(board.temper)} onClick={() => setConfirmForge(true)}>
          {forgePreview.cost > BigInt(board.temper) ? 'NOT ENOUGH TEMPER' : `CONFIRM ${forgePreview.kind.toUpperCase()}`}</Button></Paper>}
    </Paper>}

    {stage === 'train' && <Paper p="xs" className="shop-section training-shop-section" data-testid="training-shop" data-tutorial="hand-training">
      <Group justify="space-between" className="section-heading"><div><Text fw={700} size="sm" tt="uppercase" lts=".08em">Train</Text><Text size="xs" c="dimmed">Training costs more as a hand rises above the rest of its section.</Text></div></Group>
      <TrainingScorecard handLevels={board.handLevels} shop={shop} gold={board.gold} busy={busy} onTrain={hand => submit({ type: 'TRAIN_HAND', hand })} />
    </Paper>}

    {stage === 'flames' && <Paper p="xs" className="shop-section fire-keeping-section" data-testid="fire-keeping-shop"><Group justify="space-between" className="section-heading"><div><Text fw={700} size="sm" tt="uppercase" lts=".08em">Flames</Text>
      <Text size="xs" c="dimmed">Feed Gold to your Flames to make them stronger. At 100 Gold, an Ember becomes a Bonfire.</Text></div><Badge color="orange" variant="light">{ownedFlames.length} / 5 FLAMES</Badge></Group>
      <div className="fire-keeping-grid" data-testid="global-flame-slots">{ownedFlames.map(flame => <Card key={`flame-${flame.instanceId}`} withBorder p="sm" className={`fire-keeping-card ${flame.stage}`} data-testid={`fire-keeping-flame-${flame.instanceId}`}>
        <Group justify="space-between"><Text fw={850}>{FLAMES[flame.type].name}</Text><Badge color={flame.stage === 'bonfire' ? 'red' : 'orange'} variant="light">{flame.stage.toUpperCase()}</Badge></Group>
        <Text size="xs" c="dimmed" mt={4}>{flameEffectText(flame.type, flame.investedGold, board)}</Text><Group justify="space-between" mt="xs"><Text size="xs">Investment</Text><Text size="xs" fw={800}>{flame.investedGold} / 100 Gold</Text></Group>
        {flame.stage === 'ember' && <Text size="xs" fw={850} c="orange" mt={4}>Complete this Bonfire: +10 Temper</Text>}
        <Progress value={flame.investedGold} color={flame.stage === 'bonfire' ? 'red' : 'orange'} size="sm" mt={4} /><Button mt="sm" color={flame.stage === 'bonfire' ? 'red' : 'orange'} variant="light" disabled={busy}
          onClick={() => openFlameDetails({ flameInstanceId: flame.instanceId, kind: flame.stage })}>{flame.stage === 'bonfire' ? 'VIEW BONFIRE' : 'MANAGE FLAME'}</Button></Card>)}</div>
    </Paper>}

    <RunActionPortal><RunActionLayout className="shop-action-dock" right={forwardStage && forwardLabel
      ? <Button size="sm" disabled={busy} data-testid="shop-stage-continue" onClick={() => submit({ type: 'SET_SHOP_STAGE', stage: forwardStage })}>{forwardLabel}</Button>
      : <Button size="sm" disabled={busy || shop.exitUnlocked === false || rosterCount === 0}
        aria-label={returnedFromBust ? `RETRY ROUND ${formatPlayerNumber(retryRound)}` : nextChapter ? 'NEXT CHAPTER' : 'NEXT ROUND'}
        className={showProgressNudge ? 'tutorial-progression-nudge' : undefined}
        data-tutorial-nudge={showProgressNudge ? 'true' : undefined} data-testid="shop-progression-action"
        color={returnedFromBust ? 'red' : undefined} onClick={requestProgression}>
        {returnedFromBust ? `RETRY ROUND ${formatPlayerNumber(retryRound)}` : nextChapter ? 'NEXT CHAPTER' : 'NEXT ROUND'} →</Button>} /></RunActionPortal>

    <Modal opened={confirmForge} onClose={() => setConfirmForge(false)} title="CONFIRM FORGE?" centered>{dieA && dieB && forgePreview && <Stack>
      <Text><DieEffectsLabel effects={dieA.effects} /> + <DieEffectsLabel effects={dieB.effects} /></Text><Text>→ <DieEffectsLabel effects={forgePreview.effects} /></Text>
      <Text fw={900} c="orange">{formatForgeValue(forgePreview.cost)} TEMPER</Text><Text size="sm" c="dimmed">Die A remains in its slot. Die B is permanently consumed.</Text>
      <Group justify="flex-end"><Button variant="default" onClick={() => setConfirmForge(false)}>CANCEL</Button><Button color="orange" onClick={() => { submit({ type: 'CONFIRM_FORGE' }); setConfirmForge(false); }}>CONFIRM</Button></Group></Stack>}</Modal>

    <Modal opened={saleSlot !== null} onClose={() => setSaleSlot(null)} title="SELL DIE?" centered>{saleSlot && saleDie && <Stack>
      <Text fw={850}>{saleDie.effects.length ? <DieEffectsLabel effects={saleDie.effects} /> : 'Normal'}</Text>{(() => { const sale = dieSellBreakdown(saleDie); return <Paper withBorder p="sm">
        <Text size="sm">Components: {sale.componentSalvage} Gold</Text>{sale.complexityPremium > 0 && <Text size="sm">Complexity: +{sale.complexityPremium} Gold</Text>}
        {sale.vintageAppreciation > 0 && <Text size="sm">Vintage: +{sale.vintageAppreciation} Gold</Text>}<Text size="xl" fw={900}>Total: {sale.total} Gold</Text></Paper>; })()}
      <Group justify="flex-end"><Button variant="default" onClick={() => setSaleSlot(null)}>CANCEL</Button><Button color="yellow" disabled={saleSlot.area === 'roster' && rosterCount <= 1}
        onClick={() => { submit({ type: 'SELL_DIE', slot: saleSlot, expectedDieId: saleDie.id }); setSaleSlot(null); setSelectedSlot(null); }}>SELL</Button></Group></Stack>}</Modal>

    <Modal opened={detailDie !== null} onClose={() => setDetailDie(null)} title="DIE DETAILS" centered size="lg">{detailDie && <Stack>
      <Group justify="space-between"><Text fw={900} size="lg">{detailDie.effects.length ? <DieEffectsLabel effects={detailDie.effects} /> : 'Normal'}</Text>
        <Stack gap={0} align="flex-end"><Text size="sm" c="dimmed">Current sell value: {dieSellBreakdown(detailDie).total} Gold</Text>
          {!!detailDie.effects.length && <Text size="sm" c="dimmed">Rating {formatForgeValue(dieForgeRating(detailDie))}</Text>}</Stack></Group><EffectDetails effects={detailDie.effects} />
      {!detailDie.effects.length && <Text c="dimmed">Normal dice have no special effects.</Text>}<Button variant="default" onClick={() => setDetailDie(null)}>CLOSE</Button></Stack>}</Modal>

    <Modal opened={startWarning} onClose={() => setStartWarning(false)} title={`ONLY ${rosterCount} OF 5 DICE EQUIPPED`} centered><Text>Some hands may be impossible to Play with this Roster.</Text>
      <Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setStartWarning(false)}>GO BACK</Button><Button disabled={rosterCount === 0} onClick={() => { setStartWarning(false); submit(progressionAction); }}>START ROUND</Button></Group></Modal>
  </Stack>;
}
