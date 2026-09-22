import { Alert, Badge, Button, Group, Modal, Paper, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { useState } from 'react';
import { diceRerollCost, offerRerollCost } from '../game/config';
import { activeFace } from '../game/dice';
import { attachmentError, enhancementCost, ENHANCEMENTS, ENHANCEMENT_IDS, FACE_TYPE_LIMIT, faceEnhancementTypes } from '../game/enhancements';
import { activeFlameId, activeFlameInvestment, FLAMES, hasXMultFlame } from '../game/flames';
import type { Action, Board, Enhancement, GameEvent, Rank } from '../game/types';
import { DiceRow } from './DiceRow';
import { EnhancementCard } from './EnhancementCard';
import { RoundPayoutSummary } from './RoundPayoutSummary';
import { ScoreResolution } from './ScoreResolution';
import { TrainingCard } from './TrainingCard';

interface ScrapTarget { face: Rank; enhancement: Enhancement; stacks: number }

export function ShopScreen({ board, event, busy, progress, selectedOffer, setSelectedOffer, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean; progress: { current: number; total: number };
  selectedOffer: number | null; setSelectedOffer: (id: number | null) => void; submit: (action: Action) => void; skip: () => void;
}) {
  const shop = board.shop!;
  const offer = shop.offers.find(item => item.id === selectedOffer && !item.purchased);
  const [managedDieId, setManagedDieId] = useState<number | null>(null);
  const [focusedFace, setFocusedFace] = useState<Rank | null>(null);
  const [scrapTarget, setScrapTarget] = useState<ScrapTarget | null>(null);
  const managedDie = managedDieId === null ? null : board.dice.find(die => die.id === managedDieId) ?? null;

  const placementErrors = Object.fromEntries(board.dice.map(die => {
    const faceError = offer ? attachmentError(activeFace(die), offer.enhancement) : null;
    const costError = offer && board.gold < enhancementCost(offer.enhancement)
      ? `Need ${enhancementCost(offer.enhancement)} Gold; you have ${board.gold}.` : null;
    return [die.id, faceError ?? costError ?? ''];
  })) as Record<number, string>;
  const eligibleIds = offer ? board.dice.filter(die => !placementErrors[die.id]).map(die => die.id) : [];
  const capacityBlockedIds = offer ? board.dice.filter(die => placementErrors[die.id]?.includes(`${FACE_TYPE_LIMIT} enhancement types`)).map(die => die.id) : [];

  function openManager(dieId: number, face: Rank = board.dice[dieId].value) {
    setManagedDieId(dieId);
    setFocusedFace(face);
  }
  function attemptPurchase(offerId: number, dieId: number) {
    const selected = shop.offers.find(item => item.id === offerId && !item.purchased);
    if (!selected) return;
    const error = attachmentError(activeFace(board.dice[dieId]), selected.enhancement);
    if (error?.includes(`${FACE_TYPE_LIMIT} enhancement types`)) {
      setSelectedOffer(offerId);
      openManager(dieId);
      return;
    }
    if (!error && board.gold >= enhancementCost(selected.enhancement)) submit({ type: 'BUY', offerId, dieId });
  }
  function clickDie(dieId: number) {
    if (offer) attemptPurchase(offer.id, dieId);
    else openManager(dieId);
  }
  function scrap(face: Rank, enhancement: Enhancement, count: number) {
    if (count > 1) setScrapTarget({ face, enhancement, stacks: count });
    else if (managedDie) submit({ type: 'SCRAP_ENHANCEMENT', dieId: managedDie.id, face, enhancement });
  }
  function closeManager() {
    setManagedDieId(null); setFocusedFace(null); setScrapTarget(null);
  }

  const managedFlame = activeFlameId(managedDie?.flame);
  const managedActiveFace = managedDie ? activeFace(managedDie) : null;
  const focused = managedDie && focusedFace ? managedDie.faces[focusedFace - 1] : null;
  const focusedError = offer && focused && managedActiveFace?.rank === focused.rank ? attachmentError(focused, offer.enhancement) : null;
  const canApplyFocused = !!(offer && focused && managedDie && managedActiveFace?.rank === focused.rank
    && !focusedError && board.gold >= enhancementCost(offer.enhancement));

  return <>
    <Stack gap="xs" className="shop-screen">
      <div className="shop-summary"><RoundPayoutSummary board={board} /></div>
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
      <Paper p="md" className="shop-section exposed-section">
        <Group justify="space-between" className="section-heading">
          <div><Group gap="xs"><Text fw={700} size="sm" tt="uppercase" lts=".08em">Exposed Faces</Text>{offer && <Badge size="xs" color="teal">{ENHANCEMENTS[offer.enhancement].name} selected</Badge>}</Group>
            <Text size="xs" c="dimmed">{offer ? 'Eligible faces are outlined. Select a dimmed full face to make room.' : 'Select a die to manage all six physical faces.'}</Text></div>
          <Group gap="xs">
            {offer && <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setSelectedOffer(null)}>Cancel placement</Button>}
            <Button size="compact-xs" variant="default" disabled={busy || board.gold < diceRerollCost(shop.diceRerolls)}
              aria-label={`Reroll Dice · ${diceRerollCost(shop.diceRerolls)} gold`}
              onClick={() => submit({ type: 'REROLL_DICE' })}>↻ Dice · {diceRerollCost(shop.diceRerolls)} gold</Button>
          </Group>
        </Group>
        <DiceRow dice={board.dice} event={event} disabled={busy} eligibleIds={offer ? eligibleIds : undefined} restrictToEligible={!!offer}
          ineligibleReasons={placementErrors} actionableIneligibleIds={capacityBlockedIds} showCapacity
          onClick={clickDie} onDropOffer={attemptPurchase} />
      </Paper>
      <div className="shop-action-dock">
        <Text size="xs" c="dimmed">Upgrades are permanent for this run.</Text>
        <Button size="sm" disabled={busy} aria-label="NEXT ROUND" onClick={() => submit({ type: 'NEXT_ROUND' })}>NEXT ROUND →</Button>
      </div>
    </Stack>

    <Modal opened={managedDie !== null} onClose={closeManager} title={managedDie ? `D${managedDie.id + 1} — Manage Faces` : 'Manage Die'} size="lg" centered transitionProps={{ duration: 0 }}>
      {managedDie && <Stack gap="sm">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">Scrap all stacks of one enhancement type for no refund.</Text>
          {managedFlame && <Badge color="orange" variant="light">🔥 {FLAMES[managedFlame].name} · {activeFlameInvestment(managedDie.flame)}/100</Badge>}
        </Group>
        {offer && focused && managedActiveFace?.rank === focused.rank && focusedError?.includes(`${FACE_TYPE_LIMIT} enhancement types`) && <Alert color="orange" title={`Face ${focused.rank} is full`}>
          Face {focused.rank} already has {FACE_TYPE_LIMIT} enhancement types. Scrap one to make room for {ENHANCEMENTS[offer.enhancement].name}.
        </Alert>}
        {offer && focused && managedActiveFace?.rank === focused.rank && !focusedError && <Alert color="teal" title="Room available">
          {ENHANCEMENTS[offer.enhancement].name} is still selected and can now be applied to exposed face {focused.rank}.
        </Alert>}
        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs" className="manage-face-grid">
          {managedDie.faces.map(face => {
            const ids = ENHANCEMENT_IDS.filter(id => face.enhancements[id]);
            const typeCount = faceEnhancementTypes(face).length;
            return <Paper key={face.rank} withBorder p="sm" data-testid={`manage-face-${face.rank}`}
              className={`manage-face-tile ${focusedFace === face.rank ? 'focused' : ''} ${managedDie.value === face.rank ? 'exposed-face' : ''}`}
              onClick={() => setFocusedFace(face.rank)}>
              <Group justify="space-between"><Text fw={800}>FACE {face.rank}</Text>{managedDie.value === face.rank && <Badge size="xs" color="teal">EXPOSED</Badge>}</Group>
              <Text size="xs" c={typeCount === FACE_TYPE_LIMIT ? 'orange' : 'dimmed'} fw={700} mt={4}>{typeCount} / {FACE_TYPE_LIMIT} TYPES</Text>
              <Stack gap={4} mt="xs">{ids.length === 0 ? <Text size="xs" c="dimmed">No enhancements</Text> : ids.map(id => <Group key={id} justify="space-between" gap={4} wrap="nowrap">
                <Text size="xs">{ENHANCEMENTS[id].name} ×{face.enhancements[id]}</Text>
                <Button size="compact-xs" variant="subtle" color="red" disabled={busy}
                  aria-label={`Scrap ${ENHANCEMENTS[id].name} from D${managedDie.id + 1} face ${face.rank}`}
                  onClick={event => { event.stopPropagation(); scrap(face.rank, id, face.enhancements[id]!); }}>Scrap</Button>
              </Group>)}</Stack>
            </Paper>;
          })}
        </SimpleGrid>
        <Group justify="space-between" mt="xs">
          <Button variant="default" onClick={closeManager}>Close</Button>
          {offer && focused && managedActiveFace?.rank === focused.rank && <Button color="teal" disabled={busy || !canApplyFocused}
            onClick={() => { attemptPurchase(offer.id, managedDie.id); if (canApplyFocused) closeManager(); }}>
            Apply {ENHANCEMENTS[offer.enhancement].name}
          </Button>}
        </Group>
      </Stack>}
    </Modal>

    <Modal opened={scrapTarget !== null} onClose={() => setScrapTarget(null)} title="Scrap enhancement stacks?" centered transitionProps={{ duration: 0 }}>
      {scrapTarget && managedDie && <>
        <Text>Remove all <strong>{scrapTarget.stacks} stacks</strong> of <strong>{ENHANCEMENTS[scrapTarget.enhancement].name}</strong> from D{managedDie.id + 1} face {scrapTarget.face}?</Text>
        <Text size="sm" c="dimmed" mt="xs">This gives no Gold refund.</Text>
        <Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setScrapTarget(null)}>Cancel</Button><Button color="red" onClick={() => {
          submit({ type: 'SCRAP_ENHANCEMENT', dieId: managedDie.id, face: scrapTarget.face, enhancement: scrapTarget.enhancement }); setScrapTarget(null);
        }}>Scrap {scrapTarget.stacks} stacks</Button></Group>
      </>}
    </Modal>
  </>;
}
