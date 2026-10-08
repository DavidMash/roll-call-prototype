import { Alert, Button, Group, Modal, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { diminishingHalfChance, enhancementCost, enhancementSellValue, ENHANCEMENTS, ENHANCEMENT_IDS, FACE_TYPE_LIMIT, faceEnhancementTypes, placementError, tankMultiplierFactor } from '../game/enhancements';
import { enhancementOfferIsFree } from '../game/specialOffers';
import type { Action, Board, Enhancement, Rank } from '../game/types';
import type { DiceDisplay } from '../uiSettings';
import { formatPercentage, formatPlayerNumber } from '../game/copy';
import { PipFace } from './PipFace';
import { enhancementAccessibleName, EnhancementIdentity, EnhancementSymbol } from './EnhancementIdentity';

export interface FaceDetailsTarget { dieId: number; face: Rank }
interface SaleTarget { enhancement: Enhancement; stacks: number; proceeds: number }

export function FaceDetailsModal({ board, target, diceDisplay, selectedOffer, setSelectedOffer, busy, actionsEnabled, onClose, submit }: {
  board: Board;
  target: FaceDetailsTarget | null;
  diceDisplay: DiceDisplay;
  selectedOffer: number | null;
  setSelectedOffer: (id: number | null) => void;
  busy: boolean;
  actionsEnabled: boolean;
  onClose: () => void;
  submit: (action: Action) => void;
}) {
  const [focusedFace, setFocusedFace] = useState<Rank>(1);
  const [saleTarget, setSaleTarget] = useState<SaleTarget | null>(null);
  const die = target ? board.dice.find(item => item.id === target.dieId) ?? null : null;
  useEffect(() => {
    if (target) setFocusedFace(target.face);
    setSaleTarget(null);
  }, [target?.dieId, target?.face]);
  if (!die) return null;
  const currentDie = die;
  const face = die.faces[focusedFace - 1];
  const ids = ENHANCEMENT_IDS.filter(id => (face.enhancements[id] ?? 0) > 0);
  const shop = board.phase === 'shop' ? board.shop : null;
  const offer = shop?.offers.find(item => item.id === selectedOffer && !item.purchased);
  const isExposed = die.value === focusedFace;
  const offerError = offer && isExposed ? placementError(die, face, offer.enhancement) : null;
  const offerCostAvailable = !!(offer && shop && (enhancementOfferIsFree(shop, offer.id) || board.gold >= enhancementCost(offer.enhancement)));
  const canApply = actionsEnabled && isExposed && !!offer && !offerError && offerCostAvailable;
  const shopActions = board.phase === 'shop' && actionsEnabled;
  function requestSale(enhancement: Enhancement) {
    setSaleTarget({ enhancement, stacks: face.enhancements[enhancement]!, proceeds: enhancementSellValue(face, enhancement) });
  }
  function confirmSale() {
    if (!saleTarget) return;
    submit({ type: 'SELL_ENHANCEMENT', dieId: currentDie.id, face: focusedFace, enhancement: saleTarget.enhancement });
    setSaleTarget(null);
  }
  function applyOffer() {
    if (!offer || !canApply) return;
    submit({ type: 'BUY', offerId: offer.id, dieId: currentDie.id });
    setSelectedOffer(null);
    onClose();
  }

  return <>
    <Modal opened={target !== null} onClose={onClose}
      title={board.phase === 'shop' ? `D${die.id + 1} — MANAGE DIE` : `D${die.id + 1} · FACE ${focusedFace}`}
      size="lg" centered transitionProps={{ duration: 0 }} data-testid="face-details-modal">
      <Stack gap="sm">
        {board.phase === 'shop' && <SimpleGrid cols={{ base: 3, sm: 6 }} spacing="xs" className="manage-face-grid" aria-label={`Faces on D${die.id + 1}`}>
          {die.faces.map((candidate, index) => {
            const physicalFace = index + 1 as Rank;
            const faceIds = ENHANCEMENT_IDS.filter(id => (candidate.enhancements[id] ?? 0) > 0);
            const typeCount = faceEnhancementTypes(candidate).length;
            const enhancementLabel = faceIds.map(id => enhancementAccessibleName(id, candidate.enhancements[id]!)).join(', ');
            const isFetchTarget = board.fetchTarget?.dieId === die.id && board.fetchTarget.physicalFace === physicalFace;
            return <Paper component="button" type="button" key={physicalFace} withBorder p="xs" data-testid={`manage-face-${physicalFace}`}
              className={`manage-face-tile ${focusedFace === physicalFace ? 'focused' : ''} ${die.value === physicalFace ? 'exposed-face' : ''}`}
              aria-label={`D${die.id + 1} face ${physicalFace}${isFetchTarget ? ', Fetch target' : ''}${enhancementLabel ? `. Enhancements: ${enhancementLabel}` : '. No Enhancements'}`}
              aria-pressed={focusedFace === physicalFace} onClick={() => setFocusedFace(physicalFace)}>
              {diceDisplay === 'pips' ? <PipFace value={candidate.rank} compact label={`D${die.id + 1} face ${physicalFace}`} />
                : <span className="manage-face-number" aria-label={`D${die.id + 1} face ${physicalFace}`}>{candidate.rank}</span>}
              <strong>FACE {physicalFace}</strong>
              {die.value === physicalFace && <span className="manage-face-exposed">EXPOSED</span>}
              {isFetchTarget && <span className="manage-face-fetch">FETCH</span>}
              <small>{typeCount} / {FACE_TYPE_LIMIT} ENHANCEMENTS</small>
              <span className="manage-face-enhancements" data-testid={`manage-face-enhancements-${physicalFace}`}>
                {faceIds.map(id => <EnhancementSymbol key={id} enhancement={id} stacks={candidate.enhancements[id]!} decorative />)}
              </span>
            </Paper>;
          })}
        </SimpleGrid>}

        <div className="face-details-heading">
          <Text size="xs" fw={850} tt="uppercase" c="dimmed">D{die.id + 1} · FACE {focusedFace}</Text>
          <Text fw={850}>{ids.length ? `${ids.length} Enhancement${ids.length === 1 ? '' : 's'}` : 'No Enhancements'}</Text>
        </div>
        {offer && isExposed && offerError?.startsWith('This Face is full.') && <Alert color="orange" title="FACE FULL">Sell an Enhancement to make room.</Alert>}
        <Stack gap="xs" className="face-detail-list">
          {ids.map(id => {
            const stacks = face.enhancements[id]!;
            const dynamic = id === 'vintage' ? `Current sell value: ${formatPlayerNumber(enhancementSellValue(face, id))} Gold${face.vintageSommelierBoosted ? ' · Sommelier ×2' : ''}`
              : id === 'workout' && face.workoutPips > 0 ? `Current added Pips: ${formatPlayerNumber(face.workoutPips)}`
                : id === 'magnetic' && face.magneticSourceUsed ? 'Pull used this Round'
                  : id === 'personalTrainer' ? `Base training chance: ${formatPercentage(diminishingHalfChance(stacks))} before hand-level adjustment`
                    : id === 'doubleTime' ? `Score-twice chance: ${formatPercentage(diminishingHalfChance(stacks))}`
                      : id === 'tank' ? `Mult factor per scoring activation: ×${formatPlayerNumber(tankMultiplierFactor(stacks))}` : null;
            return <Paper key={id} withBorder p="sm" className="face-detail-item">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Group align="flex-start" wrap="nowrap"><div><Text fw={800}><EnhancementIdentity enhancement={id} stacks={stacks} /></Text>
                    <Text size="sm" c="dimmed">{ENHANCEMENTS[id].description}</Text>{dynamic && <Text size="xs" c="teal" mt={3}>{dynamic}</Text>}</div></Group>
                {shopActions && <Button size="compact-sm" variant="light" color="red" disabled={busy}
                  aria-label={`Sell ${ENHANCEMENTS[id].name} from D${die.id + 1} face ${focusedFace} for ${enhancementSellValue(face, id)} Gold`}
                  onClick={() => requestSale(id)}>Sell</Button>}
              </Group>
            </Paper>;
          })}
        </Stack>
        <Group justify="space-between">
          <Button variant="default" onClick={onClose}>Close</Button>
          {offer && isExposed && <Button color="teal" disabled={busy || !canApply} onClick={applyOffer}>Apply <EnhancementIdentity enhancement={offer.enhancement} /></Button>}
        </Group>
      </Stack>
    </Modal>
    <Modal opened={saleTarget !== null} onClose={() => setSaleTarget(null)}
      title={saleTarget ? <span>SELL <EnhancementIdentity enhancement={saleTarget.enhancement} uppercase />?</span> : 'SELL ENHANCEMENT?'} centered transitionProps={{ duration: 0 }}>
      {saleTarget && <><Text fw={900} size="xl">+{formatPlayerNumber(saleTarget.proceeds)} GOLD</Text>
        <Text size="sm" c="dimmed">All {formatPlayerNumber(saleTarget.stacks)} stack{saleTarget.stacks === 1 ? '' : 's'} will be removed from Face {focusedFace}.</Text>
        <Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setSaleTarget(null)}>CANCEL</Button><Button color="red" onClick={confirmSale}>SELL</Button></Group></>}
    </Modal>
  </>;
}
