import { Modal, Button, Group, Paper, Text } from '@mantine/core';
import { useState } from 'react';
import { activeFace } from '../game/dice';
import { enhancementCost, placementError } from '../game/enhancements';
import { activeFlameId, FLAMES, hasChargeBonfire, isChargeFlame } from '../game/flames';
import { activeEncounterDice } from '../game/bosses';
import { enhancementOfferIsFree } from '../game/specialOffers';
import { normalizeBoardSelection, toggleBoardDie } from '../game/selection';
import type { Selection } from '../game/selection';
import type { Action, Board, Flame, GameEvent } from '../game/types';
import type { DiceDisplay } from '../uiSettings';
import { DiceRow } from './DiceRow';
import type { FaceDetailsTarget } from './FaceDetailsModal';
import type { FlameDetailsTarget } from './FlameDetailsModal';
import { formatPlayerNumber } from '../game/copy';
import { EnhancementIdentity } from './EnhancementIdentity';

export function DiceDock({ board, event, busy, actionsEnabled, cinematic, display, selection, setSelection,
  selectedOffer, setSelectedOffer, selectedFlameOffer, submit, openFaceDetails, openFlameDetails }: {
  board: Board;
  event: GameEvent | null;
  busy: boolean;
  actionsEnabled: boolean;
  cinematic: boolean;
  display: DiceDisplay;
  selection: Selection;
  setSelection: (selection: Selection) => void;
  selectedOffer: number | null;
  setSelectedOffer: (id: number | null) => void;
  selectedFlameOffer: number | null;
  submit: (action: Action) => void;
  openFaceDetails: (target: FaceDetailsTarget) => void;
  openFlameDetails: (target: FlameDetailsTarget) => void;
}) {
  const [replacementDieId, setReplacementDieId] = useState<number | null>(null);
  const wardenBoss = board.phase === 'round' && !board.bossSilenced && board.boss?.type === 'warden' ? board.boss : null;
  const wardenDice = wardenBoss ? board.dice.filter(die => die.owner === 'player').sort((a, b) => a.id - b.id) : null;
  const dice = board.phase === 'round' ? wardenDice ?? activeEncounterDice(board) : board.dice.filter(die => die.owner === 'player');
  const wardenLockedIds = wardenBoss && wardenDice ? wardenDice.filter(die => !wardenBoss.activeDieIds.includes(die.id)).map(die => die.id) : [];
  const awaitingWardenChoice = !!wardenBoss && wardenBoss.pendingReinforcements > 0;
  const selectedWardenDieId = awaitingWardenChoice && selection.dieIds.length === 1 && wardenLockedIds.includes(selection.dieIds[0])
    ? selection.dieIds[0] : null;
  const effectiveSelection = board.phase === 'round' && !awaitingWardenChoice
    ? normalizeBoardSelection(board, selection) : { dieIds: [], hand: null } satisfies Selection;
  const shop = board.phase === 'shop' ? board.shop : null;
  const offer = shop?.offers.find(item => item.id === selectedOffer && !item.purchased);
  const placementErrors = Object.fromEntries(dice.map(die => {
    const faceError = offer ? placementError(die, activeFace(die), offer.enhancement) : null;
    const costError = offer && shop && !enhancementOfferIsFree(shop, offer.id) && board.gold < enhancementCost(offer.enhancement)
      ? `Need ${formatPlayerNumber(enhancementCost(offer.enhancement))} Gold; you have ${formatPlayerNumber(board.gold)}.` : null;
    return [die.id, faceError ?? costError ?? ''];
  })) as Record<number, string>;
  const eligibleIds = offer ? dice.filter(die => !placementErrors[die.id]).map(die => die.id) : undefined;
  const capacityBlockedIds = offer ? dice.filter(die => placementErrors[die.id]?.startsWith('This Face is full.')).map(die => die.id) : [];
  const flameOffer = board.phase === 'flameSelection' && !board.flameSelection?.acquired
    ? board.flameSelection?.offers.find(item => item.id === selectedFlameOffer) : undefined;
  const lockedUntilByDieId = wardenBoss?.nextUnlockTarget === null || wardenBoss?.nextUnlockTarget === undefined
    ? undefined : Object.fromEntries(wardenLockedIds.map(id => [id, wardenBoss.nextUnlockTarget!])) as Record<number, number>;

  function changeRoundSelection(next: Selection) {
    if (board.chargeArmed && !hasChargeBonfire(board)) {
      const chargeIds = dice.filter(die => die.flame && isChargeFlame(die.flame.id)).map(die => die.id);
      if (chargeIds.some(id => !next.dieIds.includes(id))) submit({ type: 'TOGGLE_CHARGE', hand: next.hand, dieIds: next.dieIds });
    }
    setSelection(next);
  }
  function attemptPurchase(offerId: number, dieId: number) {
    if (!shop || !actionsEnabled) return;
    const selected = shop.offers.find(item => item.id === offerId && !item.purchased);
    const die = board.dice.find(item => item.id === dieId);
    if (!selected || !die) return;
    const error = placementError(die, activeFace(die), selected.enhancement);
    if (error?.startsWith('This Face is full.')) {
      setSelectedOffer(offerId);
      openFaceDetails({ dieId, face: die.value });
      return;
    }
    if (!error && (enhancementOfferIsFree(shop, selected.id) || board.gold >= enhancementCost(selected.enhancement))) {
      submit({ type: 'BUY', offerId, dieId });
    }
  }
  function clickDie(dieId: number) {
    const die = board.dice.find(item => item.id === dieId);
    if (!die || !actionsEnabled) return;
    if (board.phase === 'round') {
      if (awaitingWardenChoice) setSelection({ dieIds: selectedWardenDieId === dieId ? [] : [dieId], hand: null });
      else changeRoundSelection(toggleBoardDie(board, effectiveSelection, dieId));
      return;
    }
    if (board.phase === 'shop') {
      if (offer) attemptPurchase(offer.id, dieId);
      else openFaceDetails({ dieId, face: die.value });
      return;
    }
    if (board.phase === 'flameSelection' && flameOffer) {
      if (activeFlameId(die.flame)) setReplacementDieId(dieId);
      else submit({ type: 'CHOOSE_FLAME', offerId: flameOffer.id, dieId });
    }
  }
  function openEnhancements(dieId: number) {
    const die = board.dice.find(item => item.id === dieId);
    if (die) openFaceDetails({ dieId, face: die.value });
  }
  function openFlame(dieId: number, flame: Flame) { openFlameDetails({ flame, kind: 'ember', dieId }); }
  function confirmReplacement() {
    if (!flameOffer || replacementDieId === null || !actionsEnabled) return;
    submit({ type: 'CHOOSE_FLAME', offerId: flameOffer.id, dieId: replacementDieId });
    setReplacementDieId(null);
  }
  const replacing = replacementDieId === null ? null : board.dice.find(die => die.id === replacementDieId) ?? null;
  const replacingFlame = activeFlameId(replacing?.flame);

  return <>
    <Paper component="section" p="xs" className={`dice-dock gameplay-dock${cinematic ? ' cinematic' : ''}`} data-tutorial="dice-dock"
      data-testid="dice-dock" data-phase={board.phase} data-cinematic={cinematic || undefined}
      aria-label="Persistent Dice Dock">
      <DiceRow dice={dice} display={display} event={event} disabled={busy || !actionsEnabled}
        detailsDisabled={cinematic} selected={selectedWardenDieId === null ? effectiveSelection.dieIds : [selectedWardenDieId]}
        eligibleIds={board.phase === 'shop' ? eligibleIds : flameOffer ? dice.map(die => die.id) : undefined}
        restrictToEligible={board.phase === 'shop' && !!offer} ineligibleReasons={placementErrors}
        actionableIneligibleIds={capacityBlockedIds}
        wardenLockedIds={wardenLockedIds} wardenSelectableIds={awaitingWardenChoice ? wardenLockedIds : []}
        wardenChoiceMode={awaitingWardenChoice}
        lockedUntilByDieId={lockedUntilByDieId}
        onClick={clickDie} onEnhancements={openEnhancements} onFlame={openFlame}
        onDropOffer={board.phase === 'shop' ? attemptPurchase : undefined} />
      {offer && <div className="dice-dock-context" data-testid="dock-placement-context">
        <span><span><EnhancementIdentity enhancement={offer.enhancement} /> selected</span> · choose a die</span>
        <Button size="compact-xs" variant="subtle" color="gray" disabled={!actionsEnabled}
          onClick={() => setSelectedOffer(null)}>Cancel placement</Button>
      </div>}
      {flameOffer && <div className="dice-dock-context flame">{FLAMES[flameOffer.flame].name} selected · choose a die</div>}
    </Paper>
    <Modal opened={replacementDieId !== null} onClose={() => setReplacementDieId(null)} title="Replace Flame?" centered transitionProps={{ duration: 0 }}>
      {replacingFlame && flameOffer && <><Text>Replace <strong>{FLAMES[replacingFlame].name}</strong> with <strong>{FLAMES[flameOffer.flame].name}</strong>?</Text>
        <Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setReplacementDieId(null)}>Cancel</Button><Button color="orange" onClick={confirmReplacement}>Replace Flame</Button></Group></>}
    </Modal>
  </>;
}
