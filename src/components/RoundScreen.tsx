import { Alert, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { validateAction } from '../game/engine';
import {
  activeFlameId, captureHandStart, composeXMult, handXMultContributions, hasChargeBonfire,
  hasOwnedChargeFlame, hasOwnedFlame, isChargeFlame, isGuaranteedWinningPlay, speedDemonMultiplier,
} from '../game/flames';
import { hasPlayableHand, HANDS } from '../game/hands';
import { finalizeScore, handScore } from '../game/scoring';
import { canPlay, normalizeBoardSelection, selectBoardHand } from '../game/selection';
import type { Selection } from '../game/selection';
import type { Action, Board, GameEvent } from '../game/types';
import { HandScorecard } from './HandList';
import { ScoreResolution } from './ScoreResolution';
import { activeEncounterDice, lastPlayDanger, requiredEncounterDieIds, unavailableEncounterHands } from '../game/bosses';
import { BossPanel } from './BossPanel';
import { CONFIG } from '../game/config';
import { formatPlayerNumber, formatScoreEquation, formatScoreProgress, playActionLabel } from '../game/copy';
import { DecisionTimer } from '../game/decisionTimer';
import { usableManualRerolls } from '../game/specialOffers';
import { RunActionLayout, RunActionPortal } from './RunActionRow';

export function RoundScreen({ board, event, busy, inputBlocked, selection, setSelection, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean; inputBlocked: boolean;
  selection: Selection; setSelection: (selection: Selection) => void; submit: (action: Action) => void; skip: () => void;
}) {
  const encounterDice = activeEncounterDice(board);
  const wardenBoss = !board.bossSilenced && board.boss?.type === 'warden' ? board.boss : null;
  const wardenDice = wardenBoss
    ? board.dice.filter(die => die.owner === 'player').sort((a, b) => a.id - b.id)
    : null;
  const wardenLockedIds = wardenBoss && wardenDice
    ? wardenDice.filter(die => !wardenBoss.activeDieIds.includes(die.id)).map(die => die.id)
    : [];
  const awaitingWardenChoice = !!wardenBoss && wardenBoss.pendingReinforcements > 0;
  const speedDemonOwned = hasOwnedFlame(board, 'speedDemon');
  const decisionTimer = useRef(new DecisionTimer());
  const [decisionMs, setDecisionMs] = useState(0);
  const blocked = inputBlocked || awaitingWardenChoice;
  useLayoutEffect(() => {
    const now = performance.now();
    decisionTimer.current.reset(now, blocked);
    setDecisionMs(0);
  }, [board.decisionId]);
  useLayoutEffect(() => {
    const now = performance.now();
    decisionTimer.current.setBlocked(blocked, now);
    setDecisionMs(decisionTimer.current.elapsed(now));
  }, [blocked]);
  useEffect(() => {
    if (blocked || !speedDemonOwned) return;
    const interval = window.setInterval(() => setDecisionMs(decisionTimer.current.elapsed(performance.now())), 50);
    return () => window.clearInterval(interval);
  }, [blocked, speedDemonOwned]);
  const requiredDieIds = requiredEncounterDieIds(board);
  const unavailableHands = unavailableEncounterHands(board);
  const selectedWardenDieId = awaitingWardenChoice && selection.dieIds.length === 1 && wardenLockedIds.includes(selection.dieIds[0])
    ? selection.dieIds[0] : null;
  const effectiveSelection = awaitingWardenChoice ? { dieIds: [], hand: null } satisfies Selection
    : normalizeBoardSelection(board, selection);
  const valid = canPlay(encounterDice, unavailableHands, effectiveSelection, requiredDieIds)
    && validateAction(board, { type: 'PLAY', hand: effectiveSelection.hand!, dieIds: effectiveSelection.dieIds }) === null;
  const preview = valid ? (() => {
    const hand = effectiveSelection.hand!;
    const base = handScore(encounterDice, hand, effectiveSelection.dieIds, board.handLevels[hand]);
    const snapshot = captureHandStart(board, hand, effectiveSelection.dieIds);
    const contributions = handXMultContributions(snapshot, hand, board.handLevels[hand], effectiveSelection.dieIds);
    const xMult = composeXMult(contributions);
    const bossFactor = snapshot.bossFactor;
    return { ...base, hasXMult: contributions.length > 0, effectiveXMult: Number((xMult * bossFactor).toFixed(12)),
      score: finalizeScore(base.pips, base.multiplier, xMult * bossFactor).finalScore,
      danger: lastPlayDanger(board, hand), guaranteedWin: isGuaranteedWinningPlay(snapshot, hand) };
  })() : null;
  const manualAction: Action = { type: 'MANUAL_REROLL', dieIds: effectiveSelection.dieIds };
  const canReroll = validateAction(board, manualAction) === null;
  const selectedRerollDice = effectiveSelection.dieIds.length;
  const carePackageRerolls = board.specialOfferEffects.carePackageRerolls;
  const manualRerolls = usableManualRerolls(board);
  const rerollMainText = selectedRerollDice === 0 ? 'REROLL'
    : `REROLL ${selectedRerollDice} ${selectedRerollDice === 1 ? 'DIE' : 'DICE'}`;
  const rerollResourceText = `${board.manualRerollsRemaining} REROLL${board.manualRerollsRemaining === 1 ? '' : 'S'} REMAINING${carePackageRerolls ? ` + ${carePackageRerolls}` : ''}`;
  const rerollVisualResourceText = `NORMAL ${board.manualRerollsRemaining}${carePackageRerolls ? ` · EXTRA ${carePackageRerolls}` : ''}`;
  const normalRerollFill = Math.max(0, Math.min(1, board.manualRerollsRemaining / CONFIG.manualRerollsPerRound));
  const deadBoard = !hasPlayableHand(encounterDice, unavailableHands, requiredDieIds);
  const chargeAction: Action = { type: 'TOGGLE_CHARGE', hand: effectiveSelection.hand, dieIds: effectiveSelection.dieIds };
  const canToggleCharge = validateAction(board, chargeAction) === null;
  const chargeDieIds = encounterDice.filter(die => isChargeFlame(activeFlameId(die.flame))).map(die => die.id);
  const chargeGloballyUnlocked = hasChargeBonfire(board);
  const missingChargeDie = !chargeGloballyUnlocked && chargeDieIds.some(id => !effectiveSelection.dieIds.includes(id));
  const chargeAtMax = board.chargeXMult >= board.maxCharge - 1e-9;
  const speedStrength = (speedDemonMultiplier(100, decisionMs) - 1) / 8;
  const speedReveal = event?.type === 'SPEED_DEMON_REVEALED' ? event : null;
  const scorecardRefreshing = event?.type === 'SCORECARD_REFRESHED';
  const speedEquation = event?.flame === 'speedDemon' && event.handScore && event.type !== 'SPEED_DEMON_REVEALED'
    ? (() => {
      const effectiveXMult = event.handScore.currentXMult * event.handScore.bossFactor;
      const score = finalizeScore(event.handScore.currentPips, event.handScore.currentMultiplier, effectiveXMult).finalScore;
      return formatScoreEquation(event.handScore.currentPips, event.handScore.currentMultiplier, effectiveXMult, score);
    })() : null;
  function submitPlay() {
    const action: Action = { type: 'PLAY', hand: effectiveSelection.hand!, dieIds: effectiveSelection.dieIds };
    if (speedDemonOwned) action.decisionMs = decisionTimer.current.freeze(performance.now());
    submit(action);
  }
  function changeSelection(next: Selection) {
    if (board.chargeArmed && !chargeGloballyUnlocked && chargeDieIds.some(id => !next.dieIds.includes(id))) {
      submit({ type: 'TOGGLE_CHARGE', hand: next.hand, dieIds: next.dieIds });
    }
    setSelection(next);
  }
  const idleText = effectiveSelection.hand
    ? `${HANDS[effectiveSelection.hand].name} · ${effectiveSelection.dieIds.length} ${effectiveSelection.dieIds.length === 1 ? 'die' : 'dice'} selected`
    : effectiveSelection.dieIds.length ? `${effectiveSelection.dieIds.length} ${effectiveSelection.dieIds.length === 1 ? 'die' : 'dice'} selected` : undefined;
  useEffect(() => {
    if (!valid || busy || awaitingWardenChoice) return;
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
  }, [awaitingWardenChoice, busy, effectiveSelection.dieIds, effectiveSelection.hand, submit, valid, speedDemonOwned]);
  return <Stack gap="xs" className="round-screen">
    <div className="live-score-panel" data-testid="live-score-panel">
      <ScoreResolution event={event} busy={busy} onSkip={skip} idleText={idleText}
        scoreText={formatScoreProgress(board.score, board.target)} />
    </div>
    <BossPanel board={board} />
    {scorecardRefreshing && <div className="scorecard-refresh-celebration" data-testid="scorecard-refresh-celebration"
      role="status" aria-live="polite" aria-atomic="true" aria-label="Scorecard filled. All hands refreshed.">
      <span aria-hidden="true">SCORECARD FILLED</span>
      <strong aria-hidden="true">ALL HANDS REFRESHED</strong>
    </div>}
    {!busy && !awaitingWardenChoice && deadBoard && manualRerolls > 0 && <Alert className="round-status" color="orange" py={5} title="NO PLAYABLE HANDS" role="status">
      Use a Reroll.
    </Alert>}
    {(board.hotStreakGoal || board.targetPracticeHand) && <Paper p="xs" className="flame-goals"><Group gap="lg">
      {board.hotStreakGoal && <Text size="xs"><strong>🔥 HOT STREAK → {HANDS[board.hotStreakGoal].name}</strong></Text>}
      {board.targetPracticeHand && <Text size="xs"><strong>◎ TARGET: {HANDS[board.targetPracticeHand].name}</strong></Text>}
    </Group></Paper>}
    <Paper className={`scorecard-panel${scorecardRefreshing ? ' is-refreshing' : ''}`} p="xs">
      <HandScorecard board={board} selection={effectiveSelection} busy={busy || awaitingWardenChoice} canSubmit={valid && !busy && !awaitingWardenChoice}
        submitPreview={preview}
        onSelect={hand => changeSelection(selectBoardHand(board, effectiveSelection, hand, decisionMs))}
        onSubmit={submitPlay} />
    </Paper>
    <RunActionPortal><Paper className="gameplay-actions-panel" p="xs">
        <div className="gameplay-actions">
          {hasOwnedChargeFlame(board) && <Group className={`charge-controls${chargeAtMax ? ' is-max' : ''}${board.chargeArmed ? ' is-armed' : ''}`} gap="xs" justify="flex-end" mb={4}>
            <Stack gap={0} className="charge-status">
              <Text size="xs" fw={800} data-testid="charge-status">{board.chargeArmed
                ? `⚡ ×${formatPlayerNumber(board.chargeXMult)} ARMED`
                : chargeAtMax ? `⚡ MAX CHARGE ×${formatPlayerNumber(board.maxCharge)}`
                  : `CHARGE ×${formatPlayerNumber(board.chargeXMult)} / ×${formatPlayerNumber(board.maxCharge)}`}</Text>
              {chargeAtMax && missingChargeDie && !board.chargeArmed
                && <Text size="10px" fw={800} c="yellow" data-testid="charge-guidance">SELECT CHARGE DIE TO USE</Text>}
            </Stack>
            <Button className={`charge-action${chargeAtMax ? ' is-max' : ''}`} size="compact-xs" color={board.chargeArmed ? 'orange' : 'yellow'} variant={board.chargeArmed || chargeAtMax ? 'filled' : 'light'}
              disabled={busy || !canToggleCharge} onClick={() => submit(chargeAction)}>
              {board.chargeArmed ? 'DISARM' : 'ARM CHARGE'}
            </Button>
          </Group>}
          {awaitingWardenChoice && <Text size="xs" c="dimmed" className="selection-preview">
            {selectedWardenDieId === null ? 'Choose a Locked Die to Unlock' : `D${selectedWardenDieId + 1} will keep its current Face`}
          </Text>}
          <RunActionLayout className="round-action-layout"
            left={!awaitingWardenChoice ? <>
              <Button className="reroll-action" size="sm" variant="default" disabled={busy || !canReroll} data-tutorial="reroll-button"
                aria-label={`${rerollMainText} · ${rerollResourceText}`} data-testid="manual-reroll"
                data-normal-fill-percent={Math.round(normalRerollFill * 100)} onClick={() => submit(manualAction)}>
                <span className="reroll-resource-fill" style={{ transform: `scaleX(${normalRerollFill})` }} aria-hidden="true" />
                <span className="reroll-action-copy">
                  <span className="reroll-action-main">{rerollMainText}</span>
                  <span className="reroll-action-resource">{rerollVisualResourceText}</span>
                </span>
              </Button>
              {speedDemonOwned && <div className={`speed-demon-meter${speedReveal ? ' is-revealed' : ''}`} data-testid="speed-demon-meter"
                aria-label="Speed Demon time remaining">
                <div className="speed-demon-meter-fill" style={{ transform: `scaleX(${speedStrength})` }} />
                {speedReveal && <span data-testid="speed-demon-reveal">SPEED DEMON ×{formatPlayerNumber(speedReveal.xMult ?? 1)}</span>}
              </div>}
            </> : undefined}
            right={awaitingWardenChoice
              ? <Button className="unlock-action" size="sm" color="cyan" disabled={busy || selectedWardenDieId === null}
                onClick={() => submit({ type: 'UNLOCK_WARDEN_DIE', dieId: selectedWardenDieId! })}>UNLOCK DIE</Button>
              : <Button className="play-action" size="sm" aria-label={preview ? playActionLabel(preview.danger, preview.guaranteedWin) : 'PLAY'} disabled={busy || !valid}
                data-testid="play-action" data-tutorial="play-action" onClick={submitPlay}>
                {speedEquation ?? (preview ? `${formatScoreEquation(preview.pips, preview.multiplier, preview.effectiveXMult, preview.score)} • ${playActionLabel(preview.danger, preview.guaranteedWin)}` : 'PLAY')}
              </Button>} />
        </div>
    </Paper></RunActionPortal>
  </Stack>;
}
