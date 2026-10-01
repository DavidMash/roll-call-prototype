import { Alert, Badge, Button, Group, Modal, Paper, Progress, SimpleGrid, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { CONFIG, diceRerollCost, offerRerollCost } from '../game/config';
import { activeFace } from '../game/dice';
import { enhancementCost, enhancementSellValue, ENHANCEMENTS, ENHANCEMENT_IDS, FACE_TYPE_LIMIT, faceEnhancementTypes, placementError } from '../game/enhancements';
import { activeFlameId, activeFlameInvestment, flameEffectText, FLAMES, hasXMultFlame } from '../game/flames';
import type { Action, Board, Enhancement, GameEvent, Rank } from '../game/types';
import { DiceRow } from './DiceRow';
import { EnhancementCard } from './EnhancementCard';
import { ScoreResolution } from './ScoreResolution';
import { PipFace } from './PipFace';
import { StokeFlameModal } from './StokeFlameModal';
import { TrainingCard } from './TrainingCard';
import { BossPreview } from './BossPanel';
import type { DiceDisplay } from '../uiSettings';
import { BOSSES } from '../game/bosses';
import { EMPTY_TEXT, formatPlayerNumber } from '../game/copy';

interface SaleTarget { face: Rank; enhancement: Enhancement; stacks: number; proceeds: number }
const hearts = (lives: number) => Array.from({ length: CONFIG.maxLives }, (_, index) => index < lives ? '♥' : '♡').join(' ');

export function ShopScreen({ board, event, busy, diceDisplay, selectedOffer, setSelectedOffer, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean;
  diceDisplay: DiceDisplay;
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
    const faceError = offer ? placementError(die, activeFace(die), offer.enhancement) : null;
    const costError = offer && board.gold < enhancementCost(offer.enhancement)
      ? `Need ${formatPlayerNumber(enhancementCost(offer.enhancement))} Gold; you have ${formatPlayerNumber(board.gold)}.` : null;
    return [die.id, faceError ?? costError ?? ''];
  })) as Record<number, string>;
  const eligibleIds = offer ? board.dice.filter(die => !placementErrors[die.id]).map(die => die.id) : [];
  const capacityBlockedIds = offer ? board.dice.filter(die => placementErrors[die.id]?.startsWith('This Face is full.')).map(die => die.id) : [];

  function openManager(dieId: number, face: Rank = board.dice[dieId].value) {
    setManagedDieId(dieId);
    setFocusedFace(face);
  }
  function attemptPurchase(offerId: number, dieId: number) {
    const selected = shop.offers.find(item => item.id === offerId && !item.purchased);
    if (!selected) return;
    const die = board.dice[dieId];
    const error = placementError(die, activeFace(die), selected.enhancement);
    if (error?.startsWith('This Face is full.')) {
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
  const focusedError = offer && focused && managedDie && managedActiveFace?.rank === focused.rank ? placementError(managedDie, focused, offer.enhancement) : null;
  const canApplyFocused = !!(offer && focused && managedDie && managedActiveFace?.rank === focused.rank
    && !focusedError && board.gold >= enhancementCost(offer.enhancement));
  const tutorialDieId = !board.flameTutorial.completed ? board.flameTutorial.pendingDieId : null;
  const tutorialLabel = <Stack gap={3}><Text size="sm" fw={800}>NEW EMBER</Text>
    <Text size="xs">Stoke Flames in the Shop. At 100 Gold, they become Bonfires.</Text></Stack>;
  const upcomingBoss = board.bossSchedule[board.round + 1];

  return <>
    <Stack gap="xs" className="shop-screen">
      <div className="shop-summary phase-sticky-header">{returnedFromBust ? <Paper px="sm" py={6} className="bust-shop-banner" data-testid="bust-shop-banner">
        <Group justify="space-between" gap="xs" wrap="wrap">
          <div><Text size="sm" fw={850} c="red">ROUND {formatPlayerNumber(returnedFromBust.round)} BUST</Text>
            <Text size="xs" c="dimmed">1 Life Lost</Text></div>
          <Text fw={800} c="red" aria-label={`${board.lives} of ${CONFIG.maxLives} lives`}>{hearts(board.lives)}</Text>
        </Group>
      </Paper> : <Group justify="space-between"><Text fw={800}>SHOP</Text><Text size="xs" c="dimmed">{upcomingBoss
        ? `Prepare for ${BOSSES[upcomingBoss].name}` : `Prepare for Round ${formatPlayerNumber(board.round + 1)}`}</Text></Group>}</div>
      {busy && <ScoreResolution event={event} busy={busy} onSkip={skip} showXMult={hasXMultFlame(board.dice, board.bonfires)} />}
      <BossPreview board={board} />
      <Paper p="xs" className="shop-section">
        <Group justify="space-between" className="section-heading">
          <Text fw={700} size="sm" tt="uppercase" lts=".08em">Hand Training</Text>
        </Group>
        <div className="shop-grid training-grid">{shop.trainingOffers.map(item => <TrainingCard
          key={item.kind === 'team' ? 'team' : item.hand} offer={item} handLevels={board.handLevels} gold={board.gold} busy={busy}
          onTrain={() => submit(item.kind === 'team' ? { type: 'TRAIN_ALL_HANDS' } : { type: 'TRAIN_HAND', hand: item.hand })} />)}</div>
      </Paper>
      <Paper p="xs" className="shop-section">
        <Group justify="space-between" className="section-heading">
          <Text fw={700} size="sm" tt="uppercase" lts=".08em">Enhancements</Text>
          <Button size="compact-xs" variant="default" disabled={busy || board.gold < offerRerollCost(shop.offerRerolls)}
            aria-label={`REROLL OFFERS · ${formatPlayerNumber(offerRerollCost(shop.offerRerolls))} GOLD`}
            onClick={() => submit({ type: 'REROLL_OFFERS' })}>REROLL OFFERS · {formatPlayerNumber(offerRerollCost(shop.offerRerolls))} GOLD</Button>
        </Group>
        <div className="shop-grid enhancement-grid">{shop.offers.map(item => <EnhancementCard key={item.id} offer={item} selected={selectedOffer === item.id}
          gold={board.gold} busy={busy} onSelect={() => setSelectedOffer(selectedOffer === item.id ? null : item.id)} />)}</div>
      </Paper>
      <Paper p="md" className="shop-section exposed-section">
        <Group justify="space-between" className="section-heading">
          <div><Group gap="xs"><Text fw={700} size="sm" tt="uppercase" lts=".08em">Dice</Text>{offer && <Badge size="xs" color="teal">{ENHANCEMENTS[offer.enhancement].name} selected</Badge>}</Group>
            {offer && <Text size="xs" c="dimmed">Choose an outlined Face.</Text>}</div>
          <Group gap="xs">
            {offer && <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setSelectedOffer(null)}>Cancel placement</Button>}
            {tutorialDieId !== null && <Button size="compact-xs" variant="subtle" color="orange" onClick={() => submit({ type: 'DISMISS_FLAME_TUTORIAL' })}>Dismiss Flame tip</Button>}
            <Button size="compact-xs" variant="default" disabled={busy || board.gold < diceRerollCost(shop.diceRerolls)}
              aria-label={`REROLL DICE · ${formatPlayerNumber(diceRerollCost(shop.diceRerolls))} GOLD`}
              onClick={() => submit({ type: 'REROLL_DICE' })}>REROLL DICE · {formatPlayerNumber(diceRerollCost(shop.diceRerolls))} GOLD</Button>
          </Group>
        </Group>
        <DiceRow dice={board.dice} display={diceDisplay} event={event} disabled={busy} eligibleIds={offer ? eligibleIds : undefined} restrictToEligible={!!offer}
          ineligibleReasons={placementErrors} actionableIneligibleIds={capacityBlockedIds} showCapacity
          onClick={clickDie} onDropOffer={attemptPurchase} tutorialDieId={tutorialDieId} tutorialLabel={tutorialLabel} />
      </Paper>
      <div className="shop-action-dock">
        <Button size="sm" disabled={busy} aria-label={returnedFromBust ? `RETRY ROUND ${formatPlayerNumber(board.round)}` : 'NEXT ROUND'}
          color={returnedFromBust ? 'red' : undefined}
          onClick={() => submit(returnedFromBust ? { type: 'RETRY_ROUND' } : { type: 'NEXT_ROUND' })}>
          {returnedFromBust ? `RETRY ROUND ${formatPlayerNumber(board.round)}` : 'NEXT ROUND'} →
        </Button>
      </div>
    </Stack>

    <Modal opened={managedDie !== null} onClose={closeManager} title={managedDie ? `D${managedDie.id + 1} — MANAGE DIE` : 'MANAGE DIE'} size="lg" centered transitionProps={{ duration: 0 }}>
      {managedDie && <Stack gap="sm">
        {managedFlame && <Paper withBorder p="sm" className="shop-flame-context" data-testid="shop-flame-context">
          <Group justify="space-between" align="flex-start"><div><Group gap={5}><Badge color="orange" variant="light">🔥 EMBER</Badge><Text fw={800}>{FLAMES[managedFlame].name}</Text></Group>
            <Text size="xs" c="dimmed" mt={5}>{flameEffectText(managedFlame, activeFlameInvestment(managedDie.flame), board)}</Text></div>
            <Button color="orange" variant="light" disabled={busy || board.gold < 1} onClick={() => setStokeDieId(managedDie.id)}>STOKE</Button>
          </Group>
          <Group justify="space-between" mt="xs"><Text size="xs" fw={700}>{formatPlayerNumber(activeFlameInvestment(managedDie.flame))} / 100 → BONFIRE</Text><Text size="xs" c="dimmed">{formatPlayerNumber(board.gold)} Gold held</Text></Group>
          <Progress value={activeFlameInvestment(managedDie.flame)} color="orange" size="sm" mt={4} />
        </Paper>}
        {offer && focused && managedActiveFace?.rank === focused.rank && focusedError?.startsWith('This Face is full.') && <Alert color="orange" title="FACE FULL">
          Sell an Enhancement to make room.
        </Alert>}
        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs" className="manage-face-grid">
          {managedDie.faces.map(face => {
            const ids = ENHANCEMENT_IDS.filter(id => face.enhancements[id]);
            const typeCount = faceEnhancementTypes(face).length;
            return <Paper key={face.rank} withBorder p="sm" data-testid={`manage-face-${face.rank}`}
              className={`manage-face-tile ${focusedFace === face.rank ? 'focused' : ''} ${managedDie.value === face.rank ? 'exposed-face' : ''}`}
              onClick={() => setFocusedFace(face.rank)}>
              <Group justify="space-between"><Group gap="xs">{diceDisplay === 'pips'
                ? <PipFace value={face.rank} compact label={`D${managedDie.id + 1} face ${face.rank}`} />
                : <Text component="span" className="manage-face-number" role="img" aria-label={`D${managedDie.id + 1} face ${face.rank}`}>{face.rank}</Text>}
                <Text fw={800}>FACE {face.rank}</Text></Group>{managedDie.value === face.rank && <Badge size="xs" color="teal">EXPOSED</Badge>}</Group>
              <Text size="xs" c={typeCount === FACE_TYPE_LIMIT ? 'orange' : 'dimmed'} fw={700} mt={4}>{typeCount} / {FACE_TYPE_LIMIT} ENHANCEMENTS</Text>
              <Stack gap={4} mt="xs">{ids.length === 0 ? <Text size="xs" c="dimmed">{EMPTY_TEXT.enhancements}</Text> : ids.map(id => <Group key={id} justify="space-between" gap={4} wrap="nowrap">
                <div><Text size="xs">{ENHANCEMENTS[id].name}{id === 'vintage' ? '' : ` ×${face.enhancements[id]}`}</Text>
                  <Text size="xs" c="dimmed">Sell {formatPlayerNumber(enhancementSellValue(face, id))} Gold</Text></div>
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

    <Modal opened={saleTarget !== null} onClose={() => setSaleTarget(null)} title={saleTarget ? `SELL ${ENHANCEMENTS[saleTarget.enhancement].name.toUpperCase()}?` : 'SELL ENHANCEMENT?'} centered transitionProps={{ duration: 0 }}>
      {saleTarget && managedDie && <>
        <Text fw={900} size="xl">+{formatPlayerNumber(saleTarget.proceeds)} GOLD</Text>
        <Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setSaleTarget(null)}>CANCEL</Button><Button color="red" onClick={() => {
          submit({ type: 'SELL_ENHANCEMENT', dieId: managedDie.id, face: saleTarget.face, enhancement: saleTarget.enhancement }); setSaleTarget(null);
        }}>SELL</Button></Group>
      </>}
    </Modal>
    <StokeFlameModal board={board} dieId={stokeDieId} opened={stokeDieId !== null} busy={busy}
      onClose={() => setStokeDieId(null)} submit={submit} />
  </>;
}
