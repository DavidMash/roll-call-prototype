import { Alert, Button, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { validateAction } from '../game/engine';
import { allInMultiplier, BRIBERY_ROUND_GOLD_CAP, briberyFactor, burnItDownChargeGain, dareDevilMultiplier,
  flameByType, hasOwnedFlame, PROGRESSIVE_FLAME_SEQUENCES } from '../game/flames';
import { availableHandIds, HANDS, planQualification, ultimateHands } from '../game/hands';
import { finalizeScore } from '../game/scoring';
import { canPlay, normalizeBoardSelection, selectBoardHand } from '../game/selection';
import type { Selection } from '../game/selection';
import type { Action, Board, GameEvent, MagicRerollChoice } from '../game/types';
import { HandScorecard } from './HandList';
import { ScoreResolution } from './ScoreResolution';
import { CurrencyAmount } from './CurrencyAmount';
import { activeEncounterDice, currentlyPlayableManualHands, lastPlayDanger, requiredEncounterDieIds, unavailableEncounterHands } from '../game/bosses';
import { BossPanel } from './BossPanel';
import { formatExactScore, formatPlayerNumber, formatScoreEquation, formatScoreProgress, playActionLabel } from '../game/copy';
import { DecisionTimer } from '../game/decisionTimer';
import { usableManualRerolls } from '../game/specialOffers';
import { RunActionLayout, RunActionPortal } from './RunActionRow';
import { effectRuntime } from '../game/specialDice';
import { DieTypeLabel } from './DieTypeLabel';
import { LightningStrikeModal } from './LightningStrikeModal';
import { canonicalPlayPreview } from '../game/playPreview';
import {
  CandidateFlamePresentationPlaybackGate, deriveFlamePresentations, flameCandidatePresentationKey,
  type FlamePresentation,
} from '../game/flamePresentation';
import { resolveManualRerollCost } from '../game/manualRerolls';
import { distinctDieOutcomes } from '../game/dice';
import { exactRatioNumber } from '../game/scoreMath';
import type { DiceDisplay } from '../uiSettings';
import { DisabledActionReason } from './DisabledActionReason';
import { eligibleMagicDice, MagicRerollModal, type MagicSelectionMap } from './MagicRerollModal';

interface PendingReroll {
  dieIds: number[];
  stage: 'magic' | 'lightning';
  magicSelections: MagicSelectionMap;
  magicChoices: MagicRerollChoice[];
}

export function RoundScreen({ board, event, busy, inputBlocked, selection, setSelection, submit, skip, diceDisplay, decisionTimer, onFlamePresentationChange }: {
  board: Board; event: GameEvent | null; busy: boolean; inputBlocked: boolean;
  selection: Selection; setSelection: (selection: Selection) => void; submit: (action: Action) => void; skip: () => void;
  onFlamePresentationChange?: (presentation: FlamePresentation[]) => void;
  decisionTimer: DecisionTimer;
  diceDisplay: DiceDisplay;
}) {
  const encounterDice = activeEncounterDice(board);
  const wardenBoss = !board.bossSilenced && board.boss?.type === 'warden' ? board.boss : null;
  const wardenDice = wardenBoss
    ? board.dice.filter(die => die.owner === 'player')
    : null;
  const wardenLockedIds = wardenBoss && wardenDice
    ? wardenDice.filter(die => !wardenBoss.activeDieIds.includes(die.id)).map(die => die.id)
    : [];
  const awaitingWardenChoice = !!wardenBoss && wardenBoss.startingDieId === null;
  const doubleOrNothingWager = board.scoreWagers.doubleOrNothing;
  const allInFactor = allInMultiplier(flameByType(board, 'allIn')?.investedGold ?? 0);
  const roundBusy = busy;
  const speedDemonOwned = hasOwnedFlame(board, 'speedDemon');
  const flameCandidateGate = useRef(new CandidateFlamePresentationPlaybackGate());
  const rerollButtonRef = useRef<HTMLButtonElement>(null);
  const [timerDecisionId, setTimerDecisionId] = useState(board.decisionId);
  const [qualificationChoiceOpen, setQualificationChoiceOpen] = useState(false);
  const [pendingReroll, setPendingReroll] = useState<PendingReroll | null>(null);
  const [dareDevilOpen, setDareDevilOpen] = useState(false);
  const blocked = inputBlocked || awaitingWardenChoice || qualificationChoiceOpen || pendingReroll !== null || dareDevilOpen;
  useLayoutEffect(() => {
    const now = performance.now();
    decisionTimer.reset(now, blocked);
    setTimerDecisionId(board.decisionId);
  }, [board.decisionId]);
  useLayoutEffect(() => {
    const now = performance.now();
    decisionTimer.setBlocked(blocked, now);
  }, [blocked]);
  const decisionMs = speedDemonOwned && timerDecisionId === board.decisionId
    ? decisionTimer.elapsed(performance.now()) : 0;
  const requiredDieIds = requiredEncounterDieIds(board);
  const unavailableHands = unavailableEncounterHands(board);
  const selectedWardenDieId = awaitingWardenChoice && selection.dieIds.length === 1 && wardenLockedIds.includes(selection.dieIds[0])
    ? selection.dieIds[0] : null;
  const effectiveSelection = awaitingWardenChoice ? { dieIds: [], hand: null } satisfies Selection
    : normalizeBoardSelection(board, selection);
  const qualification = effectiveSelection.hand ? planQualification(encounterDice, effectiveSelection.hand, effectiveSelection.dieIds,
    { roundState: board.dieRoundState }) : null;
  const validationError = effectiveSelection.hand
    ? validateAction(board, { type: 'PLAY', hand: effectiveSelection.hand, dieIds: effectiveSelection.dieIds }) : null;
  const valid = canPlay(encounterDice, unavailableHands, effectiveSelection, requiredDieIds)
    && !!qualification?.legal && (validationError === null || validationError === 'Choose which qualification die should spend its Use.');
  const preview = valid ? (() => {
    const hand = effectiveSelection.hand!;
    const canonical = canonicalPlayPreview(board, hand, effectiveSelection.dieIds, decisionMs);
    return { ...canonical, hasXMult: canonical.effectiveXMult !== 1,
      danger: lastPlayDanger(board, hand), guaranteedWin: board.score + canonical.score >= board.target };
  })() : null;
  const flameCandidateKey = roundBusy ? null : flameCandidatePresentationKey(board);
  const candidateFlamePresentation = useMemo(() => flameCandidateGate.current.resolve(roundBusy,
    () => deriveFlamePresentations(board, null, decisionMs)), [roundBusy, flameCandidateKey]);
  const flamePresentation = useMemo(() => roundBusy || !preview ? candidateFlamePresentation
    : deriveFlamePresentations(board, preview, decisionMs),
  [roundBusy, candidateFlamePresentation, board, preview?.hand, preview?.score, preview?.effectiveXMult,
    effectiveSelection.dieIds.join(',')]);
  useEffect(() => onFlamePresentationChange?.(flamePresentation), [flamePresentation, onFlamePresentationChange]);
  const manualAction: Action = { type: 'MANUAL_REROLL', dieIds: effectiveSelection.dieIds };
  const canReroll = validateAction(board, manualAction) === null;
  const lightning = flameByType(board, 'lightningStrike');
  const lightningPredictions = effectiveSelection.dieIds.flatMap(dieId => {
    const die = encounterDice.find(candidate => candidate.id === dieId);
    const outcome = die ? distinctDieOutcomes(die)[0] : undefined;
    return outcome ? [{ dieId, outcome }] : [];
  });
  const lightningAction: Action = { type: 'ACTIVATE_LIGHTNING_STRIKE', predictions: lightningPredictions };
  const lightningEligible = !!lightning && lightningPredictions.length === effectiveSelection.dieIds.length
    && validateAction(board, lightningAction) === null;
  const selectedMagicDice = eligibleMagicDice(board, effectiveSelection.dieIds);
  const selectedRerollDice = effectiveSelection.dieIds.length;
  const rerollCost = resolveManualRerollCost(board, effectiveSelection.dieIds);
  const mixedFlywheelCoverage = rerollCost.flywheelDieIds.length > 0 && !rerollCost.fullyCoveredByFlywheel;
  const carePackageRerolls = board.specialOfferEffects.carePackageRerolls;
  const manualRerolls = usableManualRerolls(board);
  const rerollMainText = rerollCost.fullyCoveredByFlywheel ? 'FLYWHEEL' : selectedRerollDice === 0 ? 'REROLL'
    : `REROLL ${selectedRerollDice} ${selectedRerollDice === 1 ? 'DIE' : 'DICE'}`;
  const rerollResourceText = `${board.manualRerollsRemaining} REROLL${board.manualRerollsRemaining === 1 ? '' : 'S'} LEFT${carePackageRerolls
    ? `, PLUS ${carePackageRerolls} CARE PACKAGE REROLL${carePackageRerolls === 1 ? '' : 'S'}` : ''}`;
  const rerollVisualResourceText = `${board.manualRerollsRemaining} LEFT${carePackageRerolls ? ` + ${carePackageRerolls}` : ''}`;
  const normalRerollFill = Math.max(0, Math.min(1,
    board.manualRerollsRemaining / board.infernoRewards.upgrades.manualRerolls));
  const burn = flameByType(board, 'burnItDown');
  const burnAction: Action = { type: 'ACTIVATE_BURN_IT_DOWN' };
  const burnReason = burn ? validateAction(board, burnAction) : null;
  const burnFraction = board.target > 0n ? Math.max(0, Math.min(1, exactRatioNumber(board.score, board.target))) : 0;
  const burnFactor = burnItDownChargeGain(burn?.investedGold ?? 0, burnFraction);
  const burnAfter = Math.min(board.maxCharge, board.chargeXMult * burnFactor);
  const dare = flameByType(board, 'dareDevil');
  const dareCount = board.interactiveFlames.dareDevilCount;
  const dareCurrentFactor = dareDevilMultiplier(dare?.investedGold ?? 0, dareCount);
  const dareNextFactor = dareDevilMultiplier(dare?.investedGold ?? 0, dareCount + 1);
  const dareAction: Action = { type: 'ACTIVATE_DARE_DEVIL' };
  const dareReason = dare ? validateAction(board, dareAction) : null;
  const selectedUltimate = !!effectiveSelection.hand
    && ultimateHands(board.handLevels, availableHandIds(board)).includes(effectiveSelection.hand);
  const interceptDareDevil = !!dare && selectedUltimate && dareReason === null;
  const allIn = flameByType(board, 'allIn');
  const allInAction: Action = { type: 'TOGGLE_ALL_IN' };
  const allInReason = allIn ? validateAction(board, allInAction) : null;
  const bribery = flameByType(board, 'bribery');
  const briberyAction: Action = { type: 'ACTIVATE_BRIBERY' };
  const briberyReason = bribery ? validateAction(board, briberyAction) : null;
  const briberyFactorPending = briberyFactor(bribery?.investedGold ?? 0, board.interactiveFlames.briberyPendingGold);
  const deadBoard = currentlyPlayableManualHands(board).length === 0;
  const scorecardRefreshing = event?.type === 'SCORECARD_REFRESHED';
  const speedEquation = event?.flame === 'speedDemon' && event.handScore && event.type !== 'SPEED_DEMON_REVEALED'
    ? (() => {
      const effectiveXMult = event.handScore.currentXMult * event.handScore.bossFactor;
      const score = finalizeScore(event.handScore.currentPips, event.handScore.currentMultiplier, effectiveXMult,
        event.handScore.infernoMultiplier).finalScore;
      return formatScoreEquation(event.handScore.currentPips, event.handScore.currentMultiplier, effectiveXMult, score,
        event.handScore.infernoMultiplier);
    })() : null;
  function commitPlay(claims?: { dieId: number; effect: 'mirror' | 'missingLink' | 'conjoined' }[]) {
    const action: Action = { type: 'PLAY', hand: effectiveSelection.hand!, dieIds: effectiveSelection.dieIds,
      ...(claims ? { qualificationClaims: claims } : {}) };
    if (speedDemonOwned) action.decisionMs = decisionTimer.freeze(performance.now());
    submit(action);
    setQualificationChoiceOpen(false);
  }
  function continuePlay() {
    if (qualification?.ambiguousClaims) { setQualificationChoiceOpen(true); return; }
    commitPlay();
  }
  function submitPlay() {
    if (interceptDareDevil) { setDareDevilOpen(true); return; }
    continuePlay();
  }
  function submitReroll() {
    const dieIds = [...effectiveSelection.dieIds];
    if (selectedMagicDice.length) {
      setPendingReroll({ dieIds, stage: 'magic', magicChoices: [],
        magicSelections: Object.fromEntries(selectedMagicDice.map(die => [die.id, null])) });
    } else if (lightningEligible) {
      setPendingReroll({ dieIds, stage: 'lightning', magicChoices: [], magicSelections: {} });
    } else submit(manualAction);
  }
  function continueMagicReroll(magicChoices: MagicRerollChoice[]) {
    if (!pendingReroll) return;
    if (lightningEligible) setPendingReroll({ ...pendingReroll, stage: 'lightning', magicChoices });
    else {
      submit({ type: 'MANUAL_REROLL', dieIds: pendingReroll.dieIds,
        ...(magicChoices.length ? { magicChoices } : {}) });
      setPendingReroll(null);
    }
  }
  function cancelPendingReroll() {
    setPendingReroll(null);
    requestAnimationFrame(() => rerollButtonRef.current?.focus());
  }
  function changeSelection(next: Selection) {
    setSelection(next);
  }
  const idleText = effectiveSelection.hand
    ? `${HANDS[effectiveSelection.hand].name} · ${effectiveSelection.dieIds.length} ${effectiveSelection.dieIds.length === 1 ? 'die' : 'dice'} selected`
    : effectiveSelection.dieIds.length ? `${effectiveSelection.dieIds.length} ${effectiveSelection.dieIds.length === 1 ? 'die' : 'dice'} selected` : undefined;
  useEffect(() => {
    if (!valid || roundBusy || awaitingWardenChoice) return;
    function playOnEnter(keyEvent: KeyboardEvent) {
      if (keyEvent.key !== 'Enter' || keyEvent.repeat || keyEvent.defaultPrevented) return;
      const target = keyEvent.target instanceof HTMLElement ? keyEvent.target : null;
      if (target?.closest('[role="dialog"], input, textarea, select, [contenteditable="true"]')) return;
      const control = target?.closest('button, a, [role="button"]');
      if (control && !control.closest('.scorecard-row, .die')) return;
      keyEvent.preventDefault();
      submitPlay();
    }
    window.addEventListener('keydown', playOnEnter, true);
    return () => window.removeEventListener('keydown', playOnEnter, true);
  }, [awaitingWardenChoice, roundBusy, effectiveSelection.dieIds, effectiveSelection.hand, submit, valid, speedDemonOwned]);
  return <Stack gap="xs" className="round-screen">
    <div className="live-score-panel" data-testid="live-score-panel">
      <ScoreResolution event={event} busy={busy} onSkip={skip} idleText={idleText}
        scoreText={formatScoreProgress(board.score, board.target)} />
    </div>
    {burn && <Paper withBorder p={5} className="burn-it-down-bar" data-testid="burn-it-down-bar">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="xs" className="burn-it-down-copy"><strong>BURN IT DOWN</strong>
          <span>{`Sacrifice ${formatExactScore(board.score)} Score · Charge ×${formatPlayerNumber(board.chargeXMult)} → ×${formatPlayerNumber(burnAfter)}`}</span>
          {burnReason && <span className="burn-it-down-reason" role="status">{burnReason}</span>}
        </Text>
        <Button size="compact-xs" color="orange" disabled={roundBusy || burnReason !== null}
          aria-label={`Burn It Down. Sacrifice ${formatExactScore(board.score)} Score for Charge ×${formatPlayerNumber(burnAfter)}${burnReason ? `. Unavailable: ${burnReason}` : ''}`}
          title={burnReason ?? undefined} data-testid="burn-it-down-action" onClick={() => submit(burnAction)}>SACRIFICE</Button>
      </Group>
    </Paper>}
    <BossPanel board={board} />
    {scorecardRefreshing && <div className="scorecard-refresh-celebration" data-testid="scorecard-refresh-celebration"
      role="status" aria-live="polite" aria-atomic="true" aria-label="Board refresh. Plus 2 Temper. All hands refreshed.">
      <span aria-hidden="true">BOARD REFRESH</span>
      <strong aria-hidden="true"><CurrencyAmount currency="temper" value={2} sign="+" accessible={false} /> · ALL HANDS REFRESHED</strong>
    </div>}
    {!roundBusy && !awaitingWardenChoice && deadBoard && <Alert className="round-status retreat-status" color="orange" py={5}
      title="NO PLAYABLE HANDS" role="status" data-testid="retreat-panel">
      <Group justify="space-between" align="center" gap="xs">
        <Text size="sm">{board.lives > 1 ? 'Lose 1 Life and return to the previous Shop.'
          : 'Retreating costs 1 Life. You only have 1 Life remaining.'}</Text>
        <Button size="compact-sm" color="orange" disabled={board.lives <= 1}
          onClick={() => submit({ type: 'RETREAT' })} data-testid="retreat-action">RETREAT</Button>
      </Group>
      {manualRerolls > 0 && <Text size="xs" c="dimmed" mt={3}>Use a Reroll.</Text>}
    </Alert>}
    {(board.hotStreakGoal || board.targetPracticeHand || hasOwnedFlame(board, 'topDown') || hasOwnedFlame(board, 'countDown')) && <Paper p="xs" className="flame-goals"><Group gap="lg">
      {board.hotStreakGoal && <Text size="xs"><strong>🔥 HOT STREAK → {HANDS[board.hotStreakGoal].name}</strong></Text>}
      {board.targetPracticeHand && <Text size="xs"><strong>◎ TARGET: {HANDS[board.targetPracticeHand].name}</strong></Text>}
      {(['topDown', 'countDown'] as const).map(id => {
        if (!hasOwnedFlame(board, id)) return null;
        const definition = PROGRESSIVE_FLAME_SEQUENCES[id];
        const progress = board.progressiveFlames[id];
        return <Text size="xs" key={id} data-testid={`${id}-progress`}><strong>{id === 'topDown' ? 'TOP DOWN' : 'COUNT DOWN'} · {progress >= definition.hands.length
          ? `COMPLETE · ${progress}/${definition.hands.length}`
          : `Next: ${HANDS[definition.hands[progress]].name} · ${progress}/${definition.hands.length}`}</strong></Text>;
      })}
    </Group></Paper>}
    {(doubleOrNothingWager || dareCount > 0)
      && <Paper p="xs" className="score-wager-status"
      data-testid="score-wager-status"><Group gap="lg">
      {dareCount > 0 && <Text size="xs"
        aria-label={`Dare Devil stored Ultimate multiplier ${formatPlayerNumber(dareCurrentFactor)}, ${dareCount} of 4 Dares`}>
        <strong>DARE DEVIL ×{formatPlayerNumber(dareCurrentFactor)} · {dareCount}/4 STORED</strong>
      </Text>}
      {doubleOrNothingWager && <Text size="xs"><strong>DOUBLE OR NOTHING · REPLAY {HANDS[doubleOrNothingWager.hand].name.toUpperCase()} ×{formatPlayerNumber(
        doubleOrNothingWager.factor)}</strong></Text>}
    </Group></Paper>}
    <Paper className={`scorecard-panel${scorecardRefreshing ? ' is-refreshing' : ''}`} p="xs">
      <HandScorecard board={board} selection={effectiveSelection} busy={roundBusy || awaitingWardenChoice} freezeAvailability={roundBusy}
        canSubmit={valid && !roundBusy && !awaitingWardenChoice}
        submitPreview={preview}
        onSelect={hand => changeSelection(selectBoardHand(board, effectiveSelection, hand, decisionMs))}
        onSubmit={submitPlay} onAcceptDoubleOrNothing={() => submit({ type: 'ACCEPT_DOUBLE_OR_NOTHING' })} />
    </Paper>
    <RunActionPortal><Paper className="gameplay-actions-panel" p="xs">
        <div className="gameplay-actions">
          {awaitingWardenChoice && <Text size="xs" c="dimmed" className="selection-preview">
            {selectedWardenDieId === null ? 'Choose Your Initial Active Die'
              : `D${board.dice.filter(die => die.owner === 'player').findIndex(die => die.id === selectedWardenDieId) + 1} will keep its current Face`}
          </Text>}
          <RunActionLayout className={`round-action-layout${allIn || bribery ? ' has-play-modifiers' : ''}`}
            left={!awaitingWardenChoice ? <>
              <Button ref={rerollButtonRef} className="reroll-action" size="sm" variant="default" disabled={roundBusy || !canReroll} data-tutorial="reroll-button"
                aria-label={`${rerollMainText}${mixedFlywheelCoverage ? ` · COST ${rerollCost.resourceCost}` : ''} · ${rerollResourceText}${selectedMagicDice.length ? ' · Opens Magic choices' : ''}${lightningEligible ? ' · Opens Lightning Strike prediction' : ''}`} data-testid="manual-reroll"
                data-normal-fill-percent={Math.round(normalRerollFill * 100)} onClick={submitReroll}>
                <span className="reroll-resource-fill" style={{ transform: `scaleX(${normalRerollFill})` }} aria-hidden="true" />
                <span className="reroll-action-copy">
                  <span className="reroll-action-main">{rerollCost.fullyCoveredByFlywheel ? 'FLYWHEEL' : 'REROLL'}</span>
                  <span className="reroll-action-resource">{selectedRerollDice > 0
                    ? `${selectedRerollDice} ${selectedRerollDice === 1 ? 'DIE' : 'DICE'}${mixedFlywheelCoverage ? ` · COST ${rerollCost.resourceCost}` : ''} · ${rerollVisualResourceText}${lightningEligible ? ' · STRIKE' : ''}`
                    : rerollVisualResourceText}</span>
                </span>
              </Button>
            </> : undefined}
            right={awaitingWardenChoice
              ? <Button className="unlock-action" size="sm" color="cyan" disabled={roundBusy || selectedWardenDieId === null}
                onClick={() => submit({ type: 'UNLOCK_WARDEN_DIE', dieId: selectedWardenDieId! })}>CHOOSE ACTIVE DIE</Button>
              : <div className="play-action-cluster">
                {(allIn || bribery) && <div className="play-flame-controls" aria-label="Play modifiers">
                  {allIn && <div className="play-flame-control">
                    <Button size="compact-xs" color="red" variant={board.scoreWagers.allInArmed ? 'filled' : 'light'}
                      disabled={roundBusy || allInReason !== null} title={allInReason ?? 'The Play package must clear the Round or its Score is lost.'}
                      aria-pressed={board.scoreWagers.allInArmed} data-testid="all-in-toggle"
                      aria-label={`${board.scoreWagers.allInArmed ? 'Disarm' : 'Arm'} All In ×${formatPlayerNumber(allInFactor)}${allInReason ? `. Unavailable: ${allInReason}` : '. The Play package must clear the Round or its Score is lost.'}`}
                      onClick={() => submit(allInAction)}>{board.scoreWagers.allInArmed ? `ALL IN ARMED · ×${formatPlayerNumber(allInFactor)}` : `ALL IN · ×${formatPlayerNumber(allInFactor)}`}</Button>
                    {allInReason && <DisabledActionReason action="All In" reason={allInReason} testId="all-in-unavailable-reason" />}
                  </div>}
                  {bribery && <div className="play-flame-control">
                    <Button size="compact-xs" color="orange" variant="light"
                      disabled={roundBusy || briberyReason !== null} title={briberyReason ?? 'Invest 1 Gold; it cannot be refunded.'}
                      data-testid="bribery-invest" aria-label={`Invest 1 Gold in Bribery. Pending multiplier ×${formatPlayerNumber(briberyFactorPending)}. ${board.interactiveFlames.briberyGoldSpentThisRound} of ${BRIBERY_ROUND_GOLD_CAP} Gold invested this Round${briberyReason ? `. Unavailable: ${briberyReason}` : ''}`}
                      onClick={() => submit(briberyAction)}>BRIBE +1G · ×{formatPlayerNumber(briberyFactorPending)}</Button>
                    {briberyReason && <DisabledActionReason action="Bribery" reason={briberyReason} testId="bribery-unavailable-reason" />}
                  </div>}
                </div>}
                <Button className="play-action" size="sm" aria-label={preview ? playActionLabel(preview.danger, preview.guaranteedWin) : 'PLAY'} disabled={roundBusy || !valid}
                  data-testid="play-action" data-tutorial="play-action" onClick={submitPlay}>
                  {speedEquation ?? (preview ? `${formatScoreEquation(preview.pips, preview.multiplier, preview.effectiveXMult,
                    preview.score, preview.infernoMultiplier)} • ${playActionLabel(preview.danger, preview.guaranteedWin)}` : 'PLAY')}
                </Button>
              </div>} />
        </div>
    </Paper></RunActionPortal>
    <MagicRerollModal board={board} dieIds={pendingReroll?.dieIds ?? []} display={diceDisplay}
      opened={pendingReroll?.stage === 'magic'} selections={pendingReroll?.magicSelections ?? {}}
      onSelectionsChange={magicSelections => setPendingReroll(current => current ? { ...current, magicSelections } : current)}
      onClose={cancelPendingReroll} onContinue={continueMagicReroll} continuesToLightning={lightningEligible} />
    <LightningStrikeModal board={board} dieIds={pendingReroll?.dieIds ?? []} display={diceDisplay}
      opened={pendingReroll?.stage === 'lightning'} magicChoices={pendingReroll?.magicChoices ?? []}
      onBack={pendingReroll && Object.keys(pendingReroll.magicSelections).length
        ? () => setPendingReroll(current => current ? { ...current, stage: 'magic' } : current) : undefined}
      onClose={cancelPendingReroll} submit={submit} />
    <Modal opened={dareDevilOpen} onClose={() => setDareDevilOpen(false)} centered className="dare-devil-modal"
      title={<Stack gap={0}><Text fw={900}>Dare Devil</Text><Text size="sm" c="dimmed">Up the ante by rerolling all dice?</Text></Stack>}
      closeButtonProps={{ 'aria-label': 'Close Dare Devil choice' }}>
      <Stack gap="sm">
        <Group grow><Paper withBorder p="sm"><Text size="xs" c="dimmed">CURRENT STORED</Text>
          <Text fw={900}>×{formatPlayerNumber(dareCurrentFactor)}</Text></Paper>
          <Paper withBorder p="sm"><Text size="xs" c="dimmed">AFTER RISK</Text>
            <Text fw={900} c="orange">×{formatPlayerNumber(dareNextFactor)}</Text></Paper></Group>
        <Text size="sm"><strong>DARE {dareCount}/4.</strong> Risk It rerolls every available player die. Your selected Ultimate may no longer be playable; the increased XMult remains stored for the next Ultimate.</Text>
        <Group justify="flex-end"><Button variant="default" data-testid="dare-devil-play-now"
          onClick={() => { setDareDevilOpen(false); continuePlay(); }}>PLAY NOW</Button>
          <Button color="orange" data-testid="dare-devil-risk-it"
            onClick={() => { setDareDevilOpen(false); submit(dareAction); }}>RISK IT</Button></Group>
      </Stack>
    </Modal>
    <Modal opened={qualificationChoiceOpen} onClose={() => setQualificationChoiceOpen(false)}
      title="HOW SHOULD THIS HAND QUALIFY?" centered>
      <Stack gap="xs">{qualification?.claimOptions.map((option, index) => <Button key={index} variant="default" fullWidth
        onClick={() => commitPlay(option.map(claim => ({ dieId: claim.dieId, effect: claim.effect, effectInstanceId: claim.effectInstanceId })))}>
        {option.map((claim, claimIndex) => {
          const die = board.dice.find(item => item.id === claim.dieId);
          const rosterSlot = board.dice.filter(item => item.owner === 'player').findIndex(item => item.id === claim.dieId);
          const effect = die?.owner === 'player' ? die.effects.find(item => item.id === claim.effectInstanceId) : undefined;
          const remaining = effectRuntime(board.dieRoundState[claim.dieId], effect)?.invocationsRemaining ?? 0;
          return <span className="qualification-claim" key={`${claim.dieId}:${claim.effect}`}>
            {claimIndex > 0 && <span> + </span>}
            {effect ? <DieTypeLabel type={effect.type} level={effect.level} /> : <span>{claim.effect}</span>}
            <span>{`${rosterSlot < 0 ? '' : ` · Roster ${rosterSlot + 1}`} — ${remaining} Use${remaining === 1 ? '' : 's'} Remaining · ${claim.effect === 'missingLink' ? 'Straight Wild' : claim.effect === 'conjoined' ? 'Two-die presence' : 'Matching Wild'}`}</span>
          </span>;
        })}
      </Button>)}<Button variant="subtle" color="gray" onClick={() => setQualificationChoiceOpen(false)}>CANCEL</Button></Stack>
    </Modal>
  </Stack>;
}
