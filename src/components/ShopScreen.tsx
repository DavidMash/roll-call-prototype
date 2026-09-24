import { Alert, Badge, Button, Group, Modal, Paper, Progress, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { useState } from 'react';
import { CONFIG, diceRerollCost, offerRerollCost } from '../game/config';
import { activeFace } from '../game/dice';
import { attachmentError, enhancementCost, enhancementSellValue, ENHANCEMENTS, ENHANCEMENT_IDS, FACE_TYPE_LIMIT, faceEnhancementTypes } from '../game/enhancements';
import { activeFlameId, activeFlameInvestment, flameEffectText, FLAMES, hasXMultFlame } from '../game/flames';
import type { Action, Board, Enhancement, GameEvent, Rank } from '../game/types';
import { DiceRow } from './DiceRow';
import { EnhancementCard } from './EnhancementCard';
import { RoundPayoutSummary } from './RoundPayoutSummary';
import { ScoreResolution } from './ScoreResolution';
import { StokeFlameModal } from './StokeFlameModal';
import { TrainingCard } from './TrainingCard';
import { BossPreview } from './BossPanel';

interface SaleTarget { face: Rank; enhancement: Enhancement; stacks: number; proceeds: number }
const hearts = (lives: number) => Array.from({ length: CONFIG.maxLives }, (_, index) => index < lives ? '♥' : '♡').join(' ');

export function ShopScreen({ board, event, busy, progress, selectedOffer, setSelectedOffer, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean; progress: { current: number; total: number };
  selectedOffer: number | null; setSelectedOffer: (id: number | null) => void; submit: (action: Action) => void; skip: () => void;
}) {
  const shop = board.shop!;
  const returnedFromBust = board.bust;
  const offer = shop.offers.find(item => item.id === selectedOffer && !item.purchased);
  const [managedDieId, setManagedDieId] = useState<number | null>(null);
  const [focusedFace, setFocusedFace] = useState<Rank | null>(null);
  const [saleTarget, setSaleTarget] = useState<SaleTarget | null>(null);
  const [stokeDieId, setStokeDieId] = useState<number | null>(null);
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
    if (board.flameTutorial.pendingDieId === dieId && !board.flameTutorial.completed) submit({ type: 'DISMISS_FLAME_TUTORIAL' });
    if (offer) attemptPurchase(offer.id, dieId);
    else openManager(dieId);
  }
  function sell(face: Rank, enhancement: Enhancement, count: number) {
    if (!managedDie) return;
    setSaleTarget({ face, enhancement, stacks: count, proceeds: enhancementSellValue(managedDie.faces[face - 1], enhancement) });
  }
  function closeManager() {
    setManagedDieId(null); setFocusedFace(null); setSaleTarget(null); setStokeDieId(null);
  }

  const managedFlame = activeFlameId(managedDie?.flame);
  const managedActiveFace = managedDie ? activeFace(managedDie) : null;
  const focused = managedDie && focusedFace ? managedDie.faces[focusedFace - 1] : null;
  const focusedError = offer && focused && managedActiveFace?.rank === focused.rank ? attachmentError(focused, offer.enhancement) : null;
  const canApplyFocused = !!(offer && focused && managedDie && managedActiveFace?.rank === focused.rank
    && !focusedError && board.gold >= enhancementCost(offer.enhancement));
  const tutorialDieId = !board.flameTutorial.completed ? board.flameTutorial.pendingDieId : null;
  const tutorialFlame = tutorialDieId === null ? null : board.dice[tutorialDieId]?.flame;
  const tutorialInvested = activeFlameInvestment(tutorialFlame);
  const tutorialLabel = <Stack gap={3}><Text size="sm" fw={800}>{tutorialInvested === 0 ? 'Your Flame is only an Ember—it has no effect yet.' : 'Manage and Stoke this Ember in the Shop.'}</Text>
    <Text size="xs">Click this die to manage its faces and Stoke the Flame with Gold. At 100 Gold, it becomes a Bonfire.</Text></Stack>;

  return <>
    <Stack gap="xs" className="shop-screen">
      <div className="shop-summary">{returnedFromBust ? <Paper px="sm" py={6} className="bust-shop-banner" data-testid="bust-shop-banner">
        <Group justify="space-between" gap="xs" wrap="wrap">
          <div><Text size="sm" fw={850} c="red">ROUND {returnedFromBust.round} BUST · 1 LIFE LOST</Text>
            <Text size="xs" c="dimmed">Prepare for another attempt. Your pre-attempt Shop has been restored.</Text></div>
          <Text fw={800} c="red" aria-label={`${board.lives} of ${CONFIG.maxLives} lives`}>{hearts(board.lives)}</Text>
        </Group>
      </Paper> : <RoundPayoutSummary board={board} />}</div>
      {busy && <ScoreResolution event={event} busy={busy} {...progress} onSkip={skip} showXMult={hasXMultFlame(board.dice, board.bonfires)} />}
      <BossPreview board={board} />
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
          <div><Group gap="xs"><Text fw={700} size="sm" tt="uppercase" lts=".08em">Physical Dice</Text>{offer && <Badge size="xs" color="teal">{ENHANCEMENTS[offer.enhancement].name} selected</Badge>}</Group>
            <Text size="xs" c="dimmed">{offer ? 'Eligible faces are outlined. Select a dimmed full face to make room.' : 'Select a die to manage all six physical faces.'}</Text></div>
          <Group gap="xs">
            {offer && <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setSelectedOffer(null)}>Cancel placement</Button>}
            {tutorialDieId !== null && <Button size="compact-xs" variant="subtle" color="orange" onClick={() => submit({ type: 'DISMISS_FLAME_TUTORIAL' })}>Dismiss Flame tip</Button>}
            <Button size="compact-xs" variant="default" disabled={busy || board.gold < diceRerollCost(shop.diceRerolls)}
              aria-label={`Reroll Dice · ${diceRerollCost(shop.diceRerolls)} gold`}
              onClick={() => submit({ type: 'REROLL_DICE' })}>↻ Dice · {diceRerollCost(shop.diceRerolls)} gold</Button>
          </Group>
        </Group>
        <DiceRow dice={board.dice} event={event} disabled={busy} eligibleIds={offer ? eligibleIds : undefined} restrictToEligible={!!offer}
          ineligibleReasons={placementErrors} actionableIneligibleIds={capacityBlockedIds} showCapacity
          onClick={clickDie} onDropOffer={attemptPurchase} tutorialDieId={tutorialDieId} tutorialLabel={tutorialLabel} />
      </Paper>
      <div className="shop-action-dock">
        <Text size="xs" c="dimmed">{returnedFromBust ? 'Prepare for another attempt.' : 'Upgrades are permanent for this run.'}</Text>
        <Button size="sm" disabled={busy} aria-label={returnedFromBust ? `RETRY ROUND ${board.round}` : 'NEXT ROUND'}
          color={returnedFromBust ? 'red' : undefined}
          onClick={() => submit(returnedFromBust ? { type: 'RETRY_ROUND' } : { type: 'NEXT_ROUND' })}>
          {returnedFromBust ? `RETRY ROUND ${board.round}` : 'NEXT ROUND'} →
        </Button>
      </div>
    </Stack>

    <Modal opened={managedDie !== null} onClose={closeManager} title={managedDie ? `D${managedDie.id + 1} — Manage Die` : 'Manage Die'} size="lg" centered transitionProps={{ duration: 0 }}>
      {managedDie && <Stack gap="sm">
        <Text size="sm" c="dimmed">Manage this die's Ember and sell all stacks of an enhancement type from any physical face.</Text>
        {managedFlame && <Paper withBorder p="sm" className="shop-flame-context" data-testid="shop-flame-context">
          <Group justify="space-between" align="flex-start"><div><Group gap={5}><Badge color="orange" variant="light">🔥 EMBER</Badge><Text fw={800}>{FLAMES[managedFlame].name}</Text></Group>
            <Text size="xs" c="dimmed" mt={5}>{flameEffectText(managedFlame, activeFlameInvestment(managedDie.flame), board)}</Text></div>
            <Button color="orange" variant="light" disabled={busy || board.gold < 1} onClick={() => setStokeDieId(managedDie.id)}>Stoke Flame</Button>
          </Group>
          <Group justify="space-between" mt="xs"><Text size="xs" fw={700}>{activeFlameInvestment(managedDie.flame)} / 100 → BONFIRE</Text><Text size="xs" c="dimmed">{board.gold} Gold held</Text></Group>
          <Progress value={activeFlameInvestment(managedDie.flame)} color="orange" size="sm" mt={4} />
        </Paper>}
        {offer && focused && managedActiveFace?.rank === focused.rank && focusedError?.includes(`${FACE_TYPE_LIMIT} enhancement types`) && <Alert color="orange" title={`Face ${focused.rank} is full`}>
          Face {focused.rank} already has {FACE_TYPE_LIMIT} enhancement types. Sell one to make room for {ENHANCEMENTS[offer.enhancement].name}.
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
                <div><Text size="xs">{ENHANCEMENTS[id].name}{id === 'vintage' ? '' : ` ×${face.enhancements[id]}`}</Text>
                  <Text size="xs" c="dimmed">Sell {enhancementSellValue(face, id)} Gold</Text></div>
                <Button size="compact-xs" variant="subtle" color="red" disabled={busy}
                  aria-label={`Sell ${ENHANCEMENTS[id].name} from D${managedDie.id + 1} face ${face.rank} for ${enhancementSellValue(face, id)} Gold`}
                  onClick={event => { event.stopPropagation(); sell(face.rank, id, face.enhancements[id]!); }}>Sell</Button>
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

    <Modal opened={saleTarget !== null} onClose={() => setSaleTarget(null)} title="Sell enhancement?" centered transitionProps={{ duration: 0 }}>
      {saleTarget && managedDie && <>
        <Text>Sell <strong>{ENHANCEMENTS[saleTarget.enhancement].name}{saleTarget.enhancement === 'vintage' ? '' : ` ×${saleTarget.stacks}`}</strong> for <strong>{saleTarget.proceeds} Gold</strong>?</Text>
        <Text size="sm" c="dimmed" mt="xs">All {saleTarget.stacks} {ENHANCEMENTS[saleTarget.enhancement].name} stack{saleTarget.stacks === 1 ? '' : 's'} on Face {saleTarget.face} will be removed.</Text>
        <Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setSaleTarget(null)}>Cancel</Button><Button color="red" onClick={() => {
          submit({ type: 'SELL_ENHANCEMENT', dieId: managedDie.id, face: saleTarget.face, enhancement: saleTarget.enhancement }); setSaleTarget(null);
        }}>Sell for {saleTarget.proceeds} Gold</Button></Group>
      </>}
    </Modal>
    <StokeFlameModal board={board} dieId={stokeDieId} opened={stokeDieId !== null} busy={busy}
      onClose={() => setStokeDieId(null)} submit={submit} />
  </>;
}
