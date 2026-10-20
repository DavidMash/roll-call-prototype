import { CONFIG, lifeRestoreCost, offerRerollCost } from './config';
import { createDiceInventory, wholeDieEffectSuppressed } from './dice';
import { Resolver } from './effects';
import type { ResolverOptions } from './effects';
import {
  createFlameInstance, emptyFlameSlots, flameByType, flameEffectText, flameInstances, flameStokeLimits, FLAMES, hasOwnedChargeFlame,
  HAND_FAMILY_FLAME_IDS, hasOwnedFlame, isFlame, ownedFlameIds, recalculateMaxCharge,
  normalizeFlameInstanceRuntime, sixPackMultiplierAfterUpperHands, sixPackStartingMultiplier,
} from './flames';
import { HANDS, HAND_IDS, initialHandLevels, initialHandPlayCounts, planQualification } from './hands';
import { hashSeed, SeededRng } from './rng';
import { boardSnapshot, createStats } from './telemetry';
import { activeEncounterDice, bossSchedule, isBigBossRound, unavailableEncounterHands } from './bosses';
import { chapterNumberForRound, ensureChapterPlan } from './chapters';
import { formatPlayerNumber } from './copy';
import { appendCriticalDiagnostic, appendDebugTrace, createDebugTrace, normalizeDebugTrace, type DebugTraceMode } from './debugTrace';
import { isRollbackState } from './rollback';
import { assertDiceInventory, collectibleDieById, ownedDice, rosterDice, rosterDieLabel, syncActiveDiceProjection } from './inventory';
import { effectOf, effectRuntime, hasEffect, normalizeDieRoundRuntime, requireEffect, resetDieRoundState, SPECIAL_DICE } from './specialDice';
import { dicePurchaseIsFree, initialSpecialOfferEffects, usableManualRerolls } from './specialOffers';
import { createTrainingSession, quoteTraining } from './training';
import { firstPurchaseSlot, purchaseDie, setSlotValue, slotExists, slotValue } from './diceEconomy';
import { dieForgeRating, dieSellBreakdown, formatForgeValue, mergedEffects, previewForge } from './forge';
import { formatEffectLevel } from './effectLevel';
import { Decimal, exactInferno, scoreFromUnknown, type ExactScore } from './scoreMath';
import { getEncounterGoalBreakdown, targetForRound } from './goals';
import type { Action, Board, FlameSlotIndex, GameState, RandomSource, Resolution, Shop, ShopStage } from './types';

const exact = (value: unknown, fallback: ExactScore = 0n): ExactScore => value === undefined || value === null
  ? fallback : scoreFromUnknown(value);
const exactDecimal = (value: unknown): string => typeof value === 'string' ? new Decimal(value).toFixed()
  : new Decimal(String(value ?? 0)).toFixed();
const exactHistoricalInferno = (value: unknown): ExactScore => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const level = Math.round(Math.log(value) / Math.log(25));
    if (Number.isSafeInteger(level) && level >= 0 && 25 ** level === value) return exactInferno(level);
  }
  return exact(value, 1n);
};

function normalizeBoardScores(board: Board): void {
  board.score = exact(board.score);
  board.target = exact(board.target, BigInt(CONFIG.baseTarget));
  board.effectScore = exact(board.effectScore);
  board.scoreByHand = Object.fromEntries(Object.entries(board.scoreByHand ?? {}).map(([hand, score]) => [hand, exact(score)]));
  if (board.roundSummary) {
    board.roundSummary.score = exact(board.roundSummary.score);
    board.roundSummary.target = exact(board.roundSummary.target);
  }
  if (board.infernoEvaluation) {
    board.infernoEvaluation.infernoMultiplierBefore = exactInferno(board.infernoEvaluation.infernoLevelBefore);
    board.infernoEvaluation.infernoMultiplierAfter = exactInferno(board.infernoEvaluation.infernoLevelAfter);
  }
  if (board.bust) {
    board.bust.score = exact(board.bust.score);
    board.bust.target = exact(board.bust.target);
    board.bust.shortfall = exact(board.bust.shortfall);
  }
  if (board.boss?.type === 'warden') {
    board.boss.nextUnlockTarget = board.boss.nextUnlockTarget === null ? null : exact(board.boss.nextUnlockTarget);
    board.boss.unlockCosts = (board.boss.unlockCosts ?? []).map(value => exact(value));
    board.boss.unlockTargets = (board.boss.unlockTargets ?? []).map(value => exact(value));
  }
}

function normalizeHistoricalScores(state: GameState): void {
  state.historyV2 ??= [];
  state.stats.rounds ??= [];
  state.stats.scoreBySource ??= { hand: 0n, jumpingBean: 0n, hitchhiker: 0n, boss: 0n };
  state.stats.handScores ??= [];
  state.stats.standaloneScores ??= [];
  state.stats.jumpingBeanFreePlays ??= [];
  state.stats.busts ??= [];
  state.stats.bossEncounters ??= [];
  state.stats.wardenEvents ??= [];
  for (const round of state.stats.rounds) {
    round.target = exact(round.target);
    round.firstCrossedScore = round.firstCrossedScore === null ? null : exact(round.firstCrossedScore);
    round.finalScore = exact(round.finalScore);
    round.clearMargin = round.clearMargin === null ? null : exact(round.clearMargin);
    round.scoreByHand = Object.fromEntries(Object.entries(round.scoreByHand ?? {}).map(([hand, score]) => [hand, exact(score)]));
    round.effectScore = exact(round.effectScore);
  }
  state.stats.scoreBySource = Object.fromEntries(Object.entries(state.stats.scoreBySource)
    .map(([source, score]) => [source, exact(score)])) as typeof state.stats.scoreBySource;
  for (const score of state.stats.handScores) {
    score.infernoMultiplier = exactHistoricalInferno(score.infernoMultiplier);
    score.rawScore = exactDecimal(score.rawScore);
    score.score = exact(score.score);
  }
  for (const score of state.stats.standaloneScores) {
    score.rawScore = exactDecimal(score.rawScore);
    score.score = exact(score.score);
  }
  for (const play of state.stats.jumpingBeanFreePlays) play.score = exact(play.score);
  for (const bust of state.stats.busts) {
    bust.score = exact(bust.score); bust.target = exact(bust.target); bust.shortfall = exact(bust.shortfall);
  }
  for (const encounter of state.stats.bossEncounters)
    if (encounter.wardenUnlockTargets) encounter.wardenUnlockTargets = encounter.wardenUnlockTargets.map(value => exact(value));
  for (const event of state.stats.wardenEvents) if (event.threshold !== undefined) event.threshold = exact(event.threshold);
  if (state.stats.loss) state.stats.loss.score = exact(state.stats.loss.score);

  for (const event of state.historyV2) {
    if (event.kind === 'round_attempt_started') {
      event.target.chapterBase = exactDecimal(event.target.chapterBase);
      event.target.neutralRawGoal = exactDecimal(event.target.neutralRawGoal);
      event.target.postBossRawGoal = exactDecimal(event.target.postBossRawGoal);
      event.target.coarseCandidate = exact(event.target.coarseCandidate);
      event.target.fineFallback = event.target.fineFallback === undefined ? undefined : exact(event.target.fineFallback);
      event.target.finalGoal = exact(event.target.finalGoal);
    } else if (event.kind === 'hand_scored') {
      event.score.infernoMultiplier = exactHistoricalInferno(event.score.infernoMultiplier);
      event.score.raw = exactDecimal(event.score.raw);
      event.score.awarded = exact(event.score.awarded);
      event.score.rounding.delta = exactDecimal(event.score.rounding.delta);
      event.roundScore.before = exact(event.roundScore.before);
      event.roundScore.afterAward = exact(event.roundScore.afterAward);
      event.roundScore.after = exact(event.roundScore.after);
    } else if (event.kind === 'round_attempt_finished' || event.kind === 'run_finished') {
      event.score = exact(event.score); event.target = exact(event.target);
    } else if (event.kind === 'engulfment_attempted') {
      event.infernoMultiplierBefore = exactInferno(event.infernoLevelBefore);
      event.infernoMultiplierAfter = exactInferno(event.infernoLevelAfter);
    } else if (event.kind === 'inferno_evaluated') {
      event.evaluation.infernoMultiplierBefore = exactInferno(event.evaluation.infernoLevelBefore);
      event.evaluation.infernoMultiplierAfter = exactInferno(event.evaluation.infernoLevelAfter);
    } else if (event.kind === 'boss_state_changed' && (event.change === 'warden_target' || event.change === 'warden_unlock')
      && event.amount !== undefined) event.amount = exact(event.amount);
  }
  const exactAmountEvents = new Set([
    'HAND_SCORE_FINALIZED', 'STANDALONE_SCORE_CALCULATED', 'SCORE_ROUNDING_AUDIT',
    'SCORE_ADDED', 'ROUND_BUST', 'WARDEN_UNLOCK_TARGET',
  ]);
  for (const event of state.history ?? []) {
    if (event.rawScore !== undefined) event.rawScore = exactDecimal(event.rawScore);
    if (event.amount !== undefined && exactAmountEvents.has(event.type)) event.amount = exact(event.amount);
    if (event.handScore) {
      event.handScore.infernoMultiplier = exactHistoricalInferno(event.handScore.infernoMultiplier);
      event.handScore.rawScore = event.handScore.rawScore === null ? null : exactDecimal(event.handScore.rawScore);
      event.handScore.finalScore = event.handScore.finalScore === null ? null : exact(event.handScore.finalScore);
    }
    if (event.roundSummary) {
      event.roundSummary.score = exact(event.roundSummary.score);
      event.roundSummary.target = exact(event.roundSummary.target);
    }
  }
}

const attemptSeed = (seed: string, round: number, attempt: number) => hashSeed(`${seed}:round:${round}:attempt:${attempt}`);

function normalizeShop(shop: Shop, state: Pick<Board, 'nextShopVisitId' | 'handLevels' | 'flameSlots' | 'forgeUnlocked'>): void {
  if (!shop.stage || !['shop', 'forge', 'train', 'flames'].includes(shop.stage)) shop.stage = 'shop';
  if (shop.stage === 'flames' && !state.flameSlots.some(Boolean)) shop.stage = 'train';
  if (shop.stage === 'forge' && !state.forgeUnlocked) shop.stage = 'shop';
  shop.forgeSelection ??= { dieAId: null, dieBId: null };
  if (shop.trainingSession) {
    for (const hand of HAND_IDS) shop.trainingSession.purchasesByHand[hand] = Math.max(0,
      Math.floor(shop.trainingSession.purchasesByHand[hand] ?? 0));
    shop.trainingSession.freeTrainingAvailable = shop.trainingSession.freeTrainingAvailable === true;
  }
  shop.lifeRestores = Math.max(0, Math.floor(shop.lifeRestores ?? 0));
  if (!Number.isInteger(shop.visitId) || (shop.visitId ?? 0) < 1) shop.visitId = state.nextShopVisitId++;
  else state.nextShopVisitId = Math.max(state.nextShopVisitId, shop.visitId! + 1);
}

function normalizeSpecialRuntime(state: Board): void {
  if (!state) return;
  state.specialOfferEffects = { ...initialSpecialOfferEffects(), ...(state.specialOfferEffects ?? {}) };
  state.specialOfferEffects.carePackageRerolls = Math.max(0, Math.floor(state.specialOfferEffects.carePackageRerolls));
  for (const key of ['taxEvasionRounds', 'bottledFairyRounds', 'badDreamRounds'] as const)
    state.specialOfferEffects[key] = Math.max(0, Math.floor(state.specialOfferEffects[key]));
  state.bossSilenced ??= false;
  state.specialOffer ??= null;
}

function normalizeBossRuntime(state: Board): void {
  if (state.boss?.type !== 'neglected') return;
  state.boss.handsPlayed = Math.max(0, Math.min(6,
    Math.floor(typeof state.boss.handsPlayed === 'number' && Number.isFinite(state.boss.handsPlayed) ? state.boss.handsPlayed : 0)));
  state.boss.restored = state.boss.restored === true;
}

function normalizeChapterLifecycle(state: Board): void {
  state.chapterLifecycle ??= {};
  for (const lifecycle of Object.values(state.chapterLifecycle)) if (lifecycle)
    lifecycle.specialOfferConsumed = !!lifecycle.specialOfferConsumed;
}

function normalizeSixPackRuntime(state: Pick<Board, 'flameSlots' | 'sixPackXMult' | 'sixPackUpperHandsPlayed'>): void {
  const startingFactor = sixPackStartingMultiplier(flameByType(state, 'sixPack')?.investedGold ?? 0);
  const missingCount = state.sixPackUpperHandsPlayed === undefined;
  const inferred = startingFactor <= 1 ? 0 : Math.round(6 * (startingFactor - Math.max(1, state.sixPackXMult ?? 1)) / (startingFactor - 1));
  state.sixPackUpperHandsPlayed = Math.max(0, Math.min(6, Math.floor(missingCount ? inferred : state.sixPackUpperHandsPlayed)));
  state.sixPackXMult = missingCount ? sixPackMultiplierAfterUpperHands(startingFactor, state.sixPackUpperHandsPlayed)
    : Math.max(1, state.sixPackXMult ?? 1);
}

function normalizeHandFamilyFlameRuntime(state: Pick<Board, 'flameSlots' | 'handFamilyFlameStages'>): void {
  const stages = state.handFamilyFlameStages ?? {};
  const owned = ownedFlameIds(state);
  state.handFamilyFlameStages = Object.fromEntries(HAND_FAMILY_FLAME_IDS.filter(id => owned.has(id)).map(id => {
    const stage = stages[id];
    return [id, stage === 'payoff' || stage === 'spent' ? stage : 'setup'];
  }));
}

function normalizeSilencedBossGoal(state: GameState): void {
  if (state.phase !== 'round' || !state.bossSilenced || !state.boss) return;
  const breakdown = getEncounterGoalBreakdown(state.round, state.boss.type, true);
  state.target = breakdown.finalGoal;
  const currentRound = [...state.stats.rounds].reverse().find(round =>
    round.round === state.round && round.attempt === state.roundAttemptNumber && !round.cleared);
  if (currentRound) currentRound.target = breakdown.finalGoal;
  const started = [...state.historyV2].reverse().find(event => event.kind === 'round_attempt_started'
    && event.timelineId === state.historyV2TimelineId && event.round === state.round
    && event.attempt === state.roundAttemptNumber);
  if (started?.kind === 'round_attempt_started') {
    const { chapter: _chapter, localRound: _localRound, ...target } = breakdown;
    started.target = target;
  }
}

export function normalizeGameState(state: GameState): GameState {
  const next = structuredClone(state);
  next.temper = Math.max(0, Math.floor(next.temper ?? 0));
  next.forgeUnlocked = next.forgeUnlocked === true || next.temper > 0;
  next.roundTemper ??= { overkill: 0, boardRefresh: 0, miniBoss: 0, boss: 0 };
  if (!next.diceInventory || !Array.isArray(next.encounterDice))
    throw new Error('Saved run does not match the current collectible-dice schema.');
  assertDiceInventory(next.diceInventory, next.encounterDice);
  syncActiveDiceProjection(next);
  next.dieRoundState ??= {};
  next.dieRoundState = Object.fromEntries(ownedDice(next).filter(die => next.diceInventory.roster.includes(die.id))
    .map(die => [die.id, normalizeDieRoundRuntime(die, next.dieRoundState[die.id])]));
  if (typeof next.target === 'number' && !Number.isSafeInteger(next.target))
    next.target = targetForRound(next.round, next.boss?.type ?? next.bossSchedule?.[next.round] ?? null);
  normalizeBoardScores(next);
  normalizeHistoricalScores(next);
  next.engulfmentLevel = Math.max(0, Math.floor(next.engulfmentLevel ?? 0));
  next.infernoProgress ??= { evaluationIndex: 0, previousReadiness: null, recentMessageIds: [], recentAction: 'none' };
  next.infernoProgress.evaluationIndex = Math.max(0, Math.floor(next.infernoProgress.evaluationIndex ?? 0));
  next.infernoProgress.previousReadiness = next.infernoProgress.previousReadiness === null ? null
    : Math.max(0, Math.min(1, next.infernoProgress.previousReadiness));
  next.infernoProgress.recentMessageIds = (next.infernoProgress.recentMessageIds ?? []).slice(-3);
  next.infernoProgress.recentAction ??= 'none';
  next.infernoEvaluation ??= null;
  next.infernoEvaluationSuspendedUntilNewFlame = !!next.infernoEvaluationSuspendedUntilNewFlame;
  next.bustPresentationDice ??= null;
  if (next.infernoEvaluation) {
    next.infernoEvaluation.engulfed ??= false;
    next.infernoEvaluation.maximumPossibleReadiness ??= next.infernoEvaluation.threshold;
    next.infernoEvaluation.currentCollectionTheoreticallySufficient ??= true;
    next.infernoEvaluation.suspendAfterContinue ??= false;
  }
  next.nextShopVisitId = Math.max(1, Math.floor(next.nextShopVisitId ?? 1));
  next.nextFlameInstanceId = Math.max(1, Math.floor(next.nextFlameInstanceId ?? 1));
  normalizeFlameInstanceRuntime(next);
  next.nextPlaybackEventId = Math.max(0, Math.floor(next.nextPlaybackEventId
    ?? (next.history.length ? Math.max(...next.history.map(record => record.id)) + 1 : 0)));
  next.historyV2 ??= [];
  for (const event of next.historyV2) if (event.kind === 'hand_scored') event.score.infernoMultiplier ??= 1n;
  for (const score of next.stats.handScores) score.infernoMultiplier ??= 1n;
  next.historyV2TimelineId = Math.max(0, Math.floor(next.historyV2TimelineId ?? 0));
  next.historyV2Coverage ??= next.historyV2.some(event => event.kind === 'run_started')
    ? { complete: true, firstRound: 1, firstActionId: 0, firstSeq: 0 }
    : { complete: false, firstRound: next.historyV2[0]?.round ?? next.round,
      firstActionId: next.historyV2[0]?.actionId ?? next.actionJournal.length,
      firstSeq: next.historyV2[0]?.seq ?? 0 };
  next.debugTrace = normalizeDebugTrace(next.debugTrace);
  normalizeBossRuntime(next);
  next.scorecardCycleConsumed ??= next.consumed.filter(hand =>
    next.bossSilenced || next.boss?.type !== 'neglected' || next.boss.restored || !next.boss.neglectedHands.includes(hand));
  normalizeSpecialRuntime(next);
  normalizeSilencedBossGoal(next);
  normalizeChapterLifecycle(next);
  if (next.shop) {
    next.shop.offers = next.shop.offers.filter(offer => offer.dieType && offer.rarity && offer.price !== undefined);
    normalizeShop(next.shop, next);
    if (!next.shop.kind && next.phase === 'shop' && !next.bust && isBigBossRound(next.round)) next.shop.kind = 'post_boss';
  }
  if (next.roundCheckpoint) {
    if (!isRollbackState(next.roundCheckpoint))
      throw new Error('Saved checkpoint does not match the current rollback schema.');
    assertDiceInventory(next.roundCheckpoint.diceInventory, next.roundCheckpoint.encounterDice);
    const checkpoint = next.roundCheckpoint.board;
    if (typeof checkpoint.target === 'number' && !Number.isSafeInteger(checkpoint.target))
      checkpoint.target = targetForRound(checkpoint.round,
        checkpoint.boss?.type ?? checkpoint.bossSchedule?.[checkpoint.round] ?? null);
    normalizeBoardScores(checkpoint);
    checkpoint.engulfmentLevel = Math.max(0, Math.floor(checkpoint.engulfmentLevel ?? 0));
    checkpoint.infernoProgress ??= structuredClone(next.infernoProgress);
    checkpoint.infernoEvaluation ??= null;
    if (checkpoint.infernoEvaluation) checkpoint.infernoEvaluation.engulfed ??= false;
    checkpoint.infernoEvaluationSuspendedUntilNewFlame = !!checkpoint.infernoEvaluationSuspendedUntilNewFlame;
    checkpoint.bustPresentationDice ??= null;
    checkpoint.nextShopVisitId = Math.max(1, Math.floor(checkpoint.nextShopVisitId ?? 1));
    checkpoint.nextFlameInstanceId = Math.max(1, Math.floor(checkpoint.nextFlameInstanceId ?? next.nextFlameInstanceId));
    normalizeFlameInstanceRuntime(checkpoint);
    normalizeBossRuntime(checkpoint);
    checkpoint.scorecardCycleConsumed ??= checkpoint.consumed.filter(hand =>
      checkpoint.bossSilenced || checkpoint.boss?.type !== 'neglected'
      || checkpoint.boss.restored || !checkpoint.boss.neglectedHands.includes(hand));
    checkpoint.chapterPlans ??= structuredClone(next.chapterPlans ?? {});
    checkpoint.presentedChapters ??= Array.from(
      { length: chapterNumberForRound(checkpoint.round) }, (_, index) => index + 1,
    );
    ensureChapterPlan({ ...checkpoint, seed: next.seed }, chapterNumberForRound(checkpoint.round));
    normalizeSpecialRuntime(checkpoint);
    if (checkpoint.specialOfferEffects.silence && checkpoint.bossSchedule[checkpoint.round])
      checkpoint.target = targetForRound(checkpoint.round);
    normalizeChapterLifecycle(checkpoint);
    if (checkpoint.shop) normalizeShop(checkpoint.shop, checkpoint);
    recalculateMaxCharge(checkpoint);
    checkpoint.decisionId = Math.max(0, Math.floor(checkpoint.decisionId ?? 0));
    normalizeSixPackRuntime(checkpoint);
    normalizeHandFamilyFlameRuntime(checkpoint);
  }
  if (next.flameSelection) next.flameSelection.offers = next.flameSelection.offers
    .map(offer => ({ ...offer, flame: (offer.flame as string) === 'charge' ? 'momentum' as const : offer.flame }))
    .filter(offer => isFlame(offer.flame));
  next.roundSummary ??= null;
  next.fetchTarget ??= null;
  next.stats.jumpingBeanFreePlays ??= [];
  next.bossSchedule ??= bossSchedule(next.seed);
  next.chapterPlans ??= {};
  next.presentedChapters ??= Array.from({ length: chapterNumberForRound(next.round) }, (_, index) => index + 1);
  ensureChapterPlan(next, chapterNumberForRound(next.round));
  next.boss ??= null;
  if (next.boss?.type === 'warden') next.boss.unlockCosts ??= [];
  if (next.boss?.type === 'caller') {
    next.boss.manualHandsPlayed ??= Math.max(0, 3 - next.boss.playsRemaining);
    next.boss.callDeadline ??= next.boss.manualHandsPlayed + next.boss.playsRemaining;
  }
  if (next.roundCheckpoint?.board.boss?.type === 'warden') next.roundCheckpoint.board.boss.unlockCosts ??= [];
  next.currentNodeId ??= '';
  next.lives = Math.max(0, Math.min(CONFIG.maxLives, Math.floor(next.lives ?? CONFIG.maxLives)));
  next.roundAttemptNumber = Math.max(1, Math.floor(next.roundAttemptNumber ?? 1));
  next.bust ??= null;
  next.flameTutorial ??= { pendingFlameInstanceId: null, completed: false };
  next.roundCheckpoint ??= null;
  next.badDreamCheckpoint ??= null;
  next.stats.mapTransitions ??= [];
  next.stats.bossEncounters ??= [];
  next.stats.callerEvents ??= [];
  next.stats.wardenEvents ??= [];
  next.stats.hexerEvents ??= [];
  next.stats.scoreBySource.boss ??= 0n;
  next.stats.busts ??= [];
  next.stats.busts = next.stats.busts.map(bust => ({ ...bust,
    checkpointRestored: bust.checkpointRestored ?? true,
    returnedToShop: bust.returnedToShop ?? bust.livesAfter > 0 }));
  next.stats.lifeRestores ??= [];
  next.stats.rounds = next.stats.rounds.map(round => ({ ...round, attempt: round.attempt ?? 1,
    goldBefore: round.goldBefore ?? next.gold,
    goldBySourceBefore: round.goldBySourceBefore ?? structuredClone(next.stats.goldBySource) }));
  next.stats.flameStokes ??= [];
  next.stats.flameStokes = next.stats.flameStokes.map(stoke => ({ ...stoke,
    from: stoke.from ?? Math.max(0, stoke.total - stoke.amount),
    source: stoke.source ?? 'flame_selection' }));
  next.stats.goldBySource.diceSale ??= 0;
  next.stats.goldBySource.specialOffer ??= 0;
  next.stats.goldSpentBySource.lifeRestore ??= 0;
  next.stats.goldSpentBySource.dicePurchase ??= 0;
  next.stats.goldSpentBySource.diceOfferReroll ??= 0;
  next.stats.diceOfferRerolls ??= 0;
  next.stats.temperEarned ??= 0;
  next.stats.temperSpent ??= 0;
  next.stats.temperBySource ??= { overkill: 0, boardRefresh: 0, miniBoss: 0, boss: 0, bonfire: 0, engulfment: 0 };
  next.stats.temperSpentBySource ??= { fusion: 0, forge: 0 };
  next.stats.temperTransactions ??= [];
  next.stats.fusions ??= 0; next.stats.forges ??= 0;
  next.stats.highestEffectCount ??= 0; next.stats.highestForgeRating ??= '0'; next.stats.mostValuableDieSold ??= 0;
  next.decisionId = Math.max(0, Math.floor(next.decisionId ?? 0));
  normalizeSixPackRuntime(next);
  normalizeHandFamilyFlameRuntime(next);
  recalculateMaxCharge(next);
  return next;
}

export function availableShopStages(state: Pick<Board, 'forgeUnlocked' | 'flameSlots'>): ShopStage[] {
  return ['shop', ...(state.forgeUnlocked ? ['forge' as const] : []), 'train',
    ...(state.flameSlots.some(Boolean) ? ['flames' as const] : [])];
}

export function validateAction(state: Board | GameState, action: Action): string | null {
  if (action.type === 'CONTINUE_ROUND_SUMMARY') return state.phase === 'roundSummary' && !!state.roundSummary
    ? null : 'A completed encounter summary is required.';
  if (action.type === 'CONTINUE_INFERNO_EVALUATION') return state.phase === 'inferno' && !!state.infernoEvaluation
    && (!state.infernoEvaluation.success || state.infernoEvaluation.engulfed)
    ? null : 'A completed or insufficient Inferno evaluation is required.';
  if (action.type === 'ENGULF_NOW') return state.phase === 'inferno' && !!state.infernoEvaluation?.success
    && !state.infernoEvaluation.engulfed ? null : 'A ready Inferno evaluation is required.';
  if (action.type === 'NOT_YET') return state.phase === 'inferno' && !!state.infernoEvaluation?.success
    && !state.infernoEvaluation.engulfed ? null : 'A pending ready Inferno evaluation is required.';
  if (action.type === 'MANUAL_REROLL') {
    if (state.phase !== 'round') return 'Manual rerolls can only be used during a gameplay round.';
    if (!state.bossSilenced && state.boss?.type === 'warden' && state.boss.pendingReinforcements > 0) return 'Unlock a Warden die before taking another action.';
    if (!action.dieIds.length) return 'Select at least one die to reroll.';
    if (new Set(action.dieIds).size !== action.dieIds.length
      || action.dieIds.some(id => !Number.isInteger(id) || !activeEncounterDice(state).some(die => die.id === id))) return 'Select distinct unlocked dice that are on the board.';
    const paidDice = action.dieIds.length;
    if (paidDice > usableManualRerolls(state)) return 'Not enough manual rerolls for these dice.';
    return null;
  }
  if (action.type === 'INVOKE_JUMPING_BEAN' || action.type === 'INVOKE_CHAMELEON'
    || action.type === 'INVOKE_FLYWHEEL' || action.type === 'ARM_MAGIC' || action.type === 'DISARM_MAGIC' || action.type === 'FEED_FURNACE') {
    if (state.phase !== 'round') return 'Special die commands can only be used during an active Round.';
    const die = 'diceInventory' in state ? collectibleDieById(state, action.dieId)
      : state.dice.find(item => item.id === action.dieId && item.owner === 'player');
    if (!die || die.owner !== 'player') return 'Choose an equipped collectible die.';
    const expected = action.type === 'INVOKE_JUMPING_BEAN' ? 'jumpingBean'
      : action.type === 'INVOKE_CHAMELEON' ? 'chameleon'
        : action.type === 'INVOKE_FLYWHEEL' ? 'flywheel'
          : action.type === 'ARM_MAGIC' || action.type === 'DISARM_MAGIC' ? 'magic' : 'furnace';
    const effect = effectOf(die, expected);
    if (!effect) return `That die cannot perform ${action.type}.`;
    const runtime = effectRuntime(state.dieRoundState[die.id], effect);
    if (!runtime) return 'That die has no active Round state.';
    if (action.type !== 'DISARM_MAGIC' && wholeDieEffectSuppressed(die))
      return "That die's special effect is suppressed while its infected face is exposed.";
    if (action.type !== 'FEED_FURNACE' && action.type !== 'DISARM_MAGIC' && runtime.invocationsRemaining <= 0) return 'That die has no Uses remaining.';
    if (action.type === 'INVOKE_CHAMELEON' && !state.dice.some(item => item.owner === 'player' && item.id !== die.id))
      return 'Chameleon requires another equipped die.';
    if (action.type === 'ARM_MAGIC') {
      if (![1, 2, 3, 4, 5, 6].includes(action.face)) return 'Choose a valid Magic face.';
      if (runtime.magicArmedFace !== null) return 'Magic is already armed for its next Reroll.';
    }
    if (action.type === 'DISARM_MAGIC' && runtime.magicArmedFace === null) return 'Magic is not armed.';
    if (action.type === 'FEED_FURNACE') {
      if (!Number.isSafeInteger(action.amount) || action.amount <= 0) return 'Feed Furnace a positive whole Gold amount.';
      if (runtime.furnaceUnits + action.amount > 5) return 'Furnace can hold at most 5 units.';
      if (state.gold < action.amount) return 'Not enough Gold to feed Furnace.';
    }
    return null;
  }
  if (action.type === 'SET_WEIGHTED_FACE') {
    if (state.phase !== 'shop') return 'Choose the Weighted face before the next Round.';
    if (!state.shop || state.shop.stage !== 'shop') return 'Configure Weighted dice from the Shop stage.';
    const die = 'diceInventory' in state ? collectibleDieById(state, action.dieId)
      : state.dice.find(item => item.id === action.dieId && item.owner === 'player');
    if (!die || die.owner !== 'player' || !hasEffect(die, 'weighted')) return 'Choose an owned Weighted die.';
    if (![1, 2, 3, 4, 5, 6].includes(action.face)) return 'Choose a valid Weighted face.';
    return null;
  }
  if (action.type === 'PLAY') {
    if (state.phase !== 'round') return 'Hands can only be played during a round.';
    if (!state.bossSilenced && state.boss?.type === 'warden' && state.boss.pendingReinforcements > 0) return 'Unlock a Warden die before committing another hand.';
    if (action.decisionMs !== undefined && (!Number.isFinite(action.decisionMs) || action.decisionMs < 0)) return 'Decision time must be a nonnegative number.';
    if (unavailableEncounterHands(state).includes(action.hand)) return state.boss?.type === 'marathon'
      ? 'That hand is still cooling down.' : state.boss?.type === 'quickdraw' ? 'Quickdraw has no Lower shot remaining.' : 'That hand has already been consumed.';
    if (!state.bossSilenced && state.boss?.type === 'hexer' && !action.dieIds.includes(state.boss.cursedDieId)) return 'The Cursed Die must participate in every hand.';
    const qualification = planQualification(activeEncounterDice(state), action.hand, action.dieIds,
      { roundState: state.dieRoundState, claims: action.qualificationClaims });
    if (!qualification.legal) return 'Select a complete valid set of participating dice.';
    if (qualification.ambiguousClaims) return 'Choose which qualification die should spend its Use.';
    return null;
  }
  if (action.type === 'UNLOCK_WARDEN_DIE') {
    if (state.phase !== 'round' || state.bossSilenced || state.boss?.type !== 'warden') return 'Dice can only be unlocked during The Warden encounter.';
    if (state.boss.pendingReinforcements <= 0) return 'No Warden reinforcement is ready.';
    const die = state.dice.find(item => item.id === action.dieId && item.owner === 'player');
    if (!die || state.boss.activeDieIds.includes(die.id)) return 'Choose a locked player die.';
    return null;
  }
  if (action.type === 'TOGGLE_CHARGE') {
    if (state.phase !== 'round') return 'Charge can only be armed during a gameplay round.';
    if (!hasOwnedChargeFlame(state)) return 'This run does not own a Charge Flame.';
    if (!state.chargeArmed && state.chargeXMult <= 1) return 'Charge has no stored bonus yet.';
    return null;
  }
  if (action.type === 'STOKE_FLAME') {
    if (state.phase !== 'shop' || !state.shop) return 'Flames can only be Stoked in a normal Shop.';
    if (state.shop.stage !== 'flames') return 'Flames can only be Stoked during Flames.';
    const flame = flameInstances(state).find(item => item.instanceId === action.flameInstanceId);
    if (!flame) return 'Choose an active Flame to invest in.';
    if (flame.stage !== 'ember') return 'That Flame is already a Bonfire.';
    if (!Number.isInteger(action.amount) || action.amount <= 0) return 'Stoking requires a positive whole Gold amount.';
    const limits = flameStokeLimits(state, action.flameInstanceId);
    if (action.amount > limits.affordableAmount) return 'Not enough Gold to Stoke that Ember.';
    if (action.amount > limits.remainingCapacity) return 'A Flame cannot hold more than 100 invested Gold.';
    return null;
  }
  if (action.type === 'CHOOSE_FLAME' || action.type === 'CONTINUE_FLAME_SELECTION' || action.type === 'SKIP_FLAME_SELECTION') {
    if (state.phase !== 'flameSelection' || !state.flameSelection) return 'This action requires an open Flame Selection.';
    if (action.type === 'CHOOSE_FLAME') {
      if (state.flameSelection.acquired) return 'Only one new Flame may be acquired per selection.';
      const offer = state.flameSelection.offers.find(item => item.id === action.offerId);
      if (!offer) return 'Choose an available Flame.';
      if (hasOwnedFlame(state as GameState, offer.flame)) return 'That Flame type is already owned by this run.';
      const firstEmpty = state.flameSlots.findIndex(slot => slot === null);
      if (firstEmpty < 0) {
        if (action.replaceSlot === undefined) return 'Choose a Flame slot to replace.';
        if (action.replaceSlot < 0 || action.replaceSlot >= 5 || !state.flameSlots[action.replaceSlot])
          return 'Choose an occupied Flame slot to replace.';
      } else if (action.replaceSlot !== undefined) return 'An empty Flame slot is available.';
    } else if (action.type === 'CONTINUE_FLAME_SELECTION' && !state.flameSelection.acquired)
      return 'Choose a Flame or skip the Flame reward before continuing.';
    else if (action.type === 'SKIP_FLAME_SELECTION' && state.flameSelection.acquired)
      return 'The Flame reward has already been claimed.';
    return null;
  }
  if (action.type === 'CHOOSE_SPECIAL_OFFER' || action.type === 'CONTINUE_SPECIAL_OFFER' || action.type === 'SKIP_SPECIAL_OFFER') {
    if (state.phase !== 'specialOffer' || !state.specialOffer) return 'This action requires an open Special Offer.';
    if (action.type === 'CHOOSE_SPECIAL_OFFER') {
      if (state.specialOffer.acquired) return 'Only one Special Offer may be chosen.';
      if (!state.specialOffer.offers.some(offer => offer.id === action.offerId)) return 'Choose an available Special Offer.';
    } else if (action.type === 'CONTINUE_SPECIAL_OFFER' && !state.specialOffer.acquired)
      return 'Choose one Special Offer before continuing.';
    else if (action.type === 'SKIP_SPECIAL_OFFER' && state.specialOffer.acquired)
      return 'The Special Offer reward has already been claimed.';
    return null;
  }
  if (state.phase !== 'shop' || !state.shop) return 'This action requires an open shop.';
  if (action.type === 'SET_SHOP_STAGE') {
    if (action.stage === state.shop.stage) return 'That Shop stage is already open.';
    if (!availableShopStages(state).includes(action.stage)) return 'That Shop section is not available.';
    return null;
  }
  if (action.type === 'UNLOCK_SHOP_EXIT') {
    if (state.shop.exitUnlocked !== false) return 'Shop progression is already available.';
    return null;
  }
  if (state.shop.exitUnlocked === false
    && (action.type === 'NEXT_CHAPTER' || action.type === 'NEXT_ROUND' || action.type === 'RETRY_ROUND'))
    return 'Shop progression is available one second after entry.';
  if ((action.type === 'NEXT_CHAPTER' || action.type === 'NEXT_ROUND' || action.type === 'RETRY_ROUND')
    && state.shop.stage !== availableShopStages(state).at(-1))
    return `Finish the Shop from ${availableShopStages(state).at(-1)?.toUpperCase()}.`;
  if (action.type === 'RETRY_ROUND' && (!state.bust || state.lives <= 0))
    return 'A returned Bust Shop is required to retry the round.';
  if (action.type === 'NEXT_CHAPTER') {
    if (state.bust || state.shop.kind !== 'post_boss' || !isBigBossRound(state.round))
      return 'Next Chapter is only available from the final post-Boss Shop.';
  }
  if (action.type === 'NEXT_ROUND' && state.shop.kind === 'post_boss' && !state.bust)
    return 'Use Next Chapter after the final post-Boss Shop.';
  if (action.type === 'NEXT_ROUND' && state.bust) return 'Use Retry Round after preparing for the failed round.';
  if ((action.type === 'NEXT_ROUND' || action.type === 'NEXT_CHAPTER' || action.type === 'RETRY_ROUND')
    && 'diceInventory' in state && rosterDice(state).length === 0) return 'Equip at least one die before starting a Round.';
  if (action.type === 'BUY_DIE') {
    if (state.shop.stage !== 'shop') return 'Dice can only be purchased during Shop.';
    if (!('diceInventory' in state)) return 'The authoritative Dice inventory is required.';
    const offer = state.shop.offers.find(item => item.id === action.offerId);
    if (!offer || offer.purchased || !offer.dieType || !offer.rarity || offer.price === undefined)
      return 'Choose an available Dice offer.';
    if (!firstPurchaseSlot(state.diceInventory)) return 'Collection full.';
    const cost = dicePurchaseIsFree(state.shop) ? 0 : offer.price;
    if (state.gold < cost) return 'Not enough Gold for this die.';
    return null;
  }
  if (action.type === 'MOVE_DIE') {
    if (state.shop.stage !== 'shop') return 'The collection can only be reorganized during Shop.';
    if (!('diceInventory' in state)) return 'The authoritative Dice inventory is required.';
    if (!slotExists(state.diceInventory, action.source) || !slotExists(state.diceInventory, action.destination))
      return 'Choose valid collection slots.';
    const sourceId = slotValue(state.diceInventory, action.source);
    const destinationId = slotValue(state.diceInventory, action.destination);
    if (sourceId !== action.expectedSourceDieId || destinationId !== action.expectedDestinationDieId)
      return 'The collection changed before that action could be completed.';
    if (sourceId === null || sourceId === undefined) return 'Choose a die to move.';
    if (action.source.area === action.destination.area && action.source.index === action.destination.index)
      return 'Choose a different destination slot.';
    const rosterAfter = [...state.diceInventory.roster];
    if (action.source.area === 'roster') rosterAfter[action.source.index] = destinationId ?? null;
    if (action.destination.area === 'roster') rosterAfter[action.destination.index] = sourceId;
    if (!rosterAfter.some(id => id !== null)) return 'At least one die must remain equipped.';
    return null;
  }
  if (action.type === 'SET_FORGE_INGREDIENT' || action.type === 'SWAP_FORGE_INGREDIENTS' || action.type === 'CONFIRM_FORGE') {
    if (state.shop.stage !== 'forge' || !state.forgeUnlocked) return 'Forge actions require the Forge section.';
    if (!('diceInventory' in state)) return 'The authoritative Dice inventory is required.';
    const selection = state.shop.forgeSelection ?? { dieAId: null, dieBId: null };
    if (action.type === 'SET_FORGE_INGREDIENT') {
      if (action.dieId === null) return null;
      const die = collectibleDieById(state, action.dieId);
      if (!die || !die.effects.length) return 'Normal dice cannot be Forged.';
      const other = action.socket === 'A' ? selection.dieBId : selection.dieAId;
      if (other === action.dieId) return 'Choose two different physical dice.';
      return null;
    }
    if (selection.dieAId === null || selection.dieBId === null) return 'Choose Die A and Die B.';
    const dieA = collectibleDieById(state, selection.dieAId);
    const dieB = collectibleDieById(state, selection.dieBId);
    if (!dieA || !dieB || !dieA.effects.length || !dieB.effects.length || dieA.id === dieB.id) return 'Choose two eligible special dice.';
    if (action.type === 'CONFIRM_FORGE') {
      const preview = previewForge(dieA, dieB);
      if (preview.cost > BigInt(state.temper)) return `Not enough Temper; ${formatForgeValue(preview.cost)} required.`;
      const rosterAfter = state.diceInventory.roster.filter(id => id !== dieB.id);
      if (!rosterAfter.length) return 'At least one die must remain equipped.';
    }
    return null;
  }
  if (action.type === 'SELL_DIE') {
    if (state.shop.stage !== 'shop') return 'Dice can only be sold during Shop.';
    if (!('diceInventory' in state)) return 'The authoritative Dice inventory is required.';
    if (!slotExists(state.diceInventory, action.slot) || slotValue(state.diceInventory, action.slot) !== action.expectedDieId)
      return 'The collection changed before that sale could be completed.';
    const die = collectibleDieById(state, action.expectedDieId);
    if (!die) return 'Choose an owned die.';
    if (action.slot.area === 'roster' && rosterDice(state).length <= 1) return 'The final equipped die cannot be sold.';
    return null;
  }
  if (action.type === 'RESTORE_LIFE') {
    if (state.lives >= CONFIG.maxLives) return 'All lives are already restored.';
    if (state.gold < lifeRestoreCost(state.shop.lifeRestores)) return 'Not enough Gold to restore a Life.';
  }
  if (action.type === 'TRAIN_HAND') {
    if (state.shop.stage !== 'train') return 'Hands can only be trained during Train.';
    const quote = quoteTraining(state.shop.trainingSession ?? createTrainingSession(state.handLevels), state.handLevels, action.hand);
    if (quote.actualPrice === null) return 'This hand is too specialized to train safely.';
    if (state.gold < quote.actualPrice) return 'Not enough Gold to train this hand.';
  }
  if (action.type === 'REROLL_OFFERS') {
    if (state.shop.stage !== 'shop') return 'Dice offers can only be rerolled during Shop.';
    if (state.gold < offerRerollCost(state.shop.offerRerolls)) return 'Not enough Gold to reroll offers.';
  }
  return null;
}

function execute(state: GameState, run: (resolver: Resolver) => void, random?: RandomSource, rngStateOverride?: number,
  options?: ResolverOptions): Resolution {
  const next = structuredClone(state);
  assertDiceInventory(next.diceInventory, next.encounterDice);
  syncActiveDiceProjection(next);
  if (rngStateOverride !== undefined) next.rngState = rngStateOverride;
  const rngBefore = next.rngState;
  const seeded = new SeededRng(next.rngState);
  const resolver = new Resolver(next, random ?? seeded, options);
  try {
    run(resolver);
    assertDiceInventory(next.diceInventory, next.encounterDice);
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Roll Call engine] ${message}`);
    next.phase = 'error';
    next.stats.resolutionError = message;
    const record = { id: next.nextPlaybackEventId++, round: next.round, type: 'RESOLUTION_ERROR' as const, message };
    resolver.events.push({ ...record, board: boardSnapshot(next) });
    resolver.emitV2Error(message);
    appendCriticalDiagnostic(next.debugTrace, { round: next.round, attempt: next.roundAttemptNumber,
      actionId: next.actionJournal.length }, { kind: 'error', detail: message });
  }
  next.rngState = resolver.rngStateAfterResolution ?? seeded.state;
  appendDebugTrace(next.debugTrace, { round: next.round, attempt: next.roundAttemptNumber,
    actionId: next.actionJournal.length }, { kind: 'resolution', rngBefore, rngAfter: next.rngState,
    playbackEvents: resolver.events.length });
  return { state: next, events: resolver.events };
}

function rejectedActionHasLegacyMigration(state: GameState, normalized: GameState): boolean {
  const comparable = structuredClone(normalized);
  if (state.shop && comparable.shop) {
    const allocatedVisit = !Object.hasOwn(state.shop, 'visitId');
    const allocatedStage = !Object.hasOwn(state.shop, 'stage');
    if (allocatedVisit) delete comparable.shop.visitId;
    if (allocatedStage) delete comparable.shop.stage;
    // Hand-built current-state fixtures and pre-feature callers may omit only
    // the new Shop lifecycle fields. Those additions are not a reason for a
    // rejected action to return a different object.
    if (allocatedVisit && Object.hasOwn(state, 'nextShopVisitId'))
      comparable.nextShopVisitId = state.nextShopVisitId;
  }
  const exactJson = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
  return exactJson(comparable) !== exactJson(state);
}

export function newRun(seed: string, random?: RandomSource, options?: { debugTraceMode?: DebugTraceMode }): Resolution {
  const diceInventory = createDiceInventory();
  const state: GameState = {
    phase: 'round', seed, rngState: hashSeed(seed), round: 1, target: BigInt(CONFIG.baseTarget),
    score: 0n, gold: CONFIG.startingGold, temper: 0, forgeUnlocked: false,
    roundTemper: { overkill: 0, boardRefresh: 0, miniBoss: 0, boss: 0 },
    lives: CONFIG.maxLives, engulfmentLevel: 0, nextShopVisitId: 1,
    nextFlameInstanceId: 1, roundAttemptNumber: 1,
    bossSchedule: {}, chapterPlans: {}, presentedChapters: [], chapterLifecycle: {}, boss: null, bossSilenced: false, currentNodeId: '',
    bust: null, bustPresentationDice: null, flameTutorial: { pendingFlameInstanceId: null, completed: false },
    diceInventory, encounterDice: [], dice: [], dieRoundState: resetDieRoundState(Object.values(diceInventory.instances)), flameSlots: emptyFlameSlots(),
    chargeAttribution: {}, infernoProgress: { evaluationIndex: 0, previousReadiness: null, recentMessageIds: [], recentAction: 'none' },
    infernoEvaluation: null, infernoEvaluationSuspendedUntilNewFlame: false, chargeXMult: 1, maxCharge: 1,
    chargeArmed: false, decisionId: 0, sixPackXMult: 1, sixPackUpperHandsPlayed: 0, hotStreakGoal: null, hotStreakCharges: 0, handFamilyFlameStages: {}, lifetimeNormalShopGoldSpent: 0, consumed: [], scorecardCycleConsumed: [], shop: null,
    fetchTarget: null,
    handLevels: initialHandLevels(), handPlayCounts: initialHandPlayCounts(), targetPracticeHand: null,
    scoreByHand: {}, effectScore: 0n, lastRoundPayout: null, roundSummary: null, flameSelection: null, specialOffer: null,
    manualRerollsRemaining: CONFIG.manualRerollsPerRound, specialOfferEffects: initialSpecialOfferEffects(),
    nextOfferId: 0, nextPlaybackEventId: 0, stats: createStats(seed), actionJournal: [], history: [], historyV2: [], historyV2TimelineId: 0,
    historyV2Coverage: { complete: true, firstRound: 1, firstActionId: 0, firstSeq: 0 },
    debugTrace: createDebugTrace(options?.debugTraceMode),
    roundCheckpoint: null, badDreamCheckpoint: null,
  };
  return execute(state, resolver => { resolver.emitRunStarted(); resolver.startRound(); }, random, random ? undefined : attemptSeed(seed, 1, 1));
}

export function dispatch(state: GameState, action: Action, random?: RandomSource, options?: ResolverOptions): Resolution {
  const normalized = normalizeGameState(state);
  const error = validateAction(normalized, action);
  if (error) return {
    state: rejectedActionHasLegacyMigration(state, normalized) ? normalized : state,
    events: [], error,
  };
  const chosenSpecialOffer = action.type === 'CHOOSE_SPECIAL_OFFER'
    ? normalized.specialOffer?.offers.find(offer => offer.id === action.offerId) : null;
  const rngStateOverride = random ? undefined : action.type === 'NEXT_ROUND' || action.type === 'NEXT_CHAPTER'
    ? attemptSeed(normalized.seed, normalized.round + 1, 1)
    : action.type === 'RETRY_ROUND' ? attemptSeed(normalized.seed, normalized.round, normalized.roundAttemptNumber)
      : (action.type === 'CONTINUE_SPECIAL_OFFER' && normalized.specialOffer?.chosen?.type === 'timeTravel')
        || chosenSpecialOffer?.type === 'timeTravel'
        ? attemptSeed(normalized.seed, normalized.round, 1) : undefined;
  return execute(normalized, resolver => {
    const next = resolver.state;
    next.actionJournal.push(structuredClone(action));
    switch (action.type) {
      case 'PLAY': resolver.play(action.hand, action.dieIds, 'manual', action.decisionMs ?? null,
        action.qualificationClaims?.map(claim => {
          const die = collectibleDieById(next, claim.dieId)!;
          return { ...claim, effectInstanceId: claim.effectInstanceId ?? requireEffect(die, claim.effect).id,
            resource: 'invocation' as const, amount: 1 };
        }) ?? []); break;
      case 'MANUAL_REROLL': resolver.manualReroll(action.dieIds); break;
      case 'INVOKE_JUMPING_BEAN': resolver.invokeJumpingBean(action.dieId); break;
      case 'INVOKE_CHAMELEON': resolver.invokeChameleon(action.dieId); break;
      case 'INVOKE_FLYWHEEL': resolver.invokeFlywheel(action.dieId); break;
      case 'ARM_MAGIC': resolver.armMagic(action.dieId, action.face); break;
      case 'DISARM_MAGIC': {
        const die = collectibleDieById(next, action.dieId)!;
        effectRuntime(next.dieRoundState[action.dieId], requireEffect(die, 'magic'))!.magicArmedFace = null;
        break;
      }
      case 'FEED_FURNACE': resolver.feedFurnace(action.dieId, action.amount); break;
      case 'SET_WEIGHTED_FACE': {
        const die = collectibleDieById(next, action.dieId)!;
        const effect = requireEffect(die, 'weighted');
        effect.persistent.weightedFace = action.face;
        resolver.emit({ type: 'SPECIAL_DIE_EFFECT', dieIds: [die.id], dieType: effect.type, effectInstanceId: effect.id, dieLevel: effect.level,
          face: action.face, effectCause: 'configuration', message: `${rosterDieLabel(next, die.id)} Weighted target set to ${action.face}` });
        break;
      }
      case 'UNLOCK_WARDEN_DIE': resolver.unlockWardenDie(action.dieId); break;
      case 'TOGGLE_CHARGE':
        next.chargeArmed = !next.chargeArmed;
        if (next.chargeArmed) next.stats.chargeArmed++;
        resolver.emit({ type: 'CHARGE_ARMED', xMult: next.chargeXMult,
          message: `Charge ${next.chargeArmed ? `armed at ×${resolver.format(next.chargeXMult)}` : 'disarmed'}` });
        break;
      case 'BUY_DIE': {
        const offer = next.shop!.offers.find(item => item.id === action.offerId)!;
        const cost = dicePurchaseIsFree(next.shop!) ? 0 : offer.price!;
        if (cost) resolver.spendGold(cost, `Bought ${SPECIAL_DICE[offer.dieType!].name}: −${formatPlayerNumber(cost)} Gold`, 'dicePurchase');
        next.shop!.freeDicePurchaseAvailable = false;
        const { die, slot } = purchaseDie(next.diceInventory, offer.dieType!);
        offer.purchased = true;
        syncActiveDiceProjection(next);
        resolver.emitV2({ kind: 'shop_transaction', transaction: { type: 'dice_purchased',
          shopVisitId: next.shop!.visitId!, offerId: offer.id, dieId: die.id, dieType: offer.dieType, level: 1,
          rarity: offer.rarity!, listedPrice: offer.price!, pricePaid: cost, destination: slot } });
        break;
      }
      case 'MOVE_DIE': {
        const sourceId = slotValue(next.diceInventory, action.source)!;
        const destinationId = slotValue(next.diceInventory, action.destination) ?? null;
        setSlotValue(next.diceInventory, action.source, destinationId);
        setSlotValue(next.diceInventory, action.destination, sourceId);
        syncActiveDiceProjection(next);
        resolver.emitV2({ kind: 'shop_transaction', transaction: { type: 'dice_moved', source: action.source,
          destination: action.destination, sourceDieId: sourceId, destinationDieId: destinationId } });
        break;
      }
      case 'SET_FORGE_INGREDIENT':
        next.shop!.forgeSelection ??= { dieAId: null, dieBId: null };
        if (action.socket === 'A') next.shop!.forgeSelection.dieAId = action.dieId;
        else next.shop!.forgeSelection.dieBId = action.dieId;
        break;
      case 'SWAP_FORGE_INGREDIENTS': {
        next.shop!.forgeSelection ??= { dieAId: null, dieBId: null };
        const a = next.shop!.forgeSelection.dieAId;
        next.shop!.forgeSelection.dieAId = next.shop!.forgeSelection.dieBId;
        next.shop!.forgeSelection.dieBId = a;
        break;
      }
      case 'CONFIRM_FORGE': {
        const selection = next.shop!.forgeSelection!;
        const destination = collectibleDieById(next, selection.dieAId!)!;
        const source = collectibleDieById(next, selection.dieBId!)!;
        const preview = previewForge(destination, source);
        const cost = Number(preview.cost);
        resolver.spendTemper(cost, preview.kind);
        destination.effects = mergedEffects(destination, source);
        const rosterIndex = next.diceInventory.roster.indexOf(source.id);
        const storageIndex = next.diceInventory.storage.indexOf(source.id);
        const sourceSlot = rosterIndex >= 0 ? { area: 'roster' as const, index: rosterIndex }
          : { area: 'storage' as const, index: storageIndex };
        const destinationRosterIndex = next.diceInventory.roster.indexOf(destination.id);
        const destinationSlot = destinationRosterIndex >= 0 ? { area: 'roster' as const, index: destinationRosterIndex }
          : { area: 'storage' as const, index: next.diceInventory.storage.indexOf(destination.id) };
        delete next.diceInventory.instances[source.id];
        delete next.dieRoundState[source.id];
        setSlotValue(next.diceInventory, sourceSlot, null);
        next.stats[preview.kind === 'fusion' ? 'fusions' : 'forges']++;
        next.stats.highestEffectCount = Math.max(next.stats.highestEffectCount, destination.effects.length);
        const rating = dieForgeRating(destination);
        if (rating > BigInt(next.stats.highestForgeRating)) next.stats.highestForgeRating = rating.toString();
        selection.dieAId = null; selection.dieBId = null;
        syncActiveDiceProjection(next);
        resolver.emit({ type: 'DICE_FORGED', dieIds: [destination.id, source.id], amount: cost,
          message: `${preview.kind === 'fusion' ? 'Fusion' : 'Forge'} completed for ${formatForgeValue(preview.cost)} Temper` });
        resolver.emitV2({ kind: 'shop_transaction', transaction: { type: 'dice_fused', sourceId: source.id,
          destinationId: destination.id, destination: destinationSlot, effects: structuredClone(destination.effects),
          temperCost: preview.cost.toString(), forgeRating: rating.toString(), operation: preview.kind } });
        break;
      }
      case 'SELL_DIE': {
        const die = collectibleDieById(next, action.expectedDieId)!;
        const sale = dieSellBreakdown(die);
        setSlotValue(next.diceInventory, action.slot, null);
        delete next.diceInventory.instances[die.id];
        delete next.dieRoundState[die.id];
        syncActiveDiceProjection(next);
        const label = die.effects.length ? die.effects.map(effect => `${SPECIAL_DICE[effect.type].name} ${formatEffectLevel(effect.level)}`).join(' + ') : 'Normal';
        resolver.addGold(sale.total, `Sold ${label}: +${sale.total} Gold`, 'diceSale', die.id);
        next.stats.mostValuableDieSold = Math.max(next.stats.mostValuableDieSold, sale.total);
        resolver.emitV2({ kind: 'shop_transaction', transaction: { type: 'dice_sold', dieId: die.id,
          effects: structuredClone(die.effects), source: action.slot, componentSalvage: sale.componentSalvage,
          complexityPremium: sale.complexityPremium,
          vintageAppreciation: sale.vintageAppreciation, proceeds: sale.total } });
        break;
      }
      case 'CHOOSE_FLAME': {
        const offer = next.flameSelection!.offers.find(item => item.id === action.offerId)!;
        const firstFlame = ownedFlameIds(next).size === 0;
        const emptySlot = next.flameSlots.findIndex(item => item === null);
        const slot = (emptySlot >= 0 ? emptySlot : action.replaceSlot!) as FlameSlotIndex;
        const replaced = next.flameSlots[slot] ? structuredClone(next.flameSlots[slot]!) : null;
        const flame = createFlameInstance(next, offer.flame);
        next.flameSlots[slot] = flame;
        const instanceId = flame.instanceId;
        if (next.infernoEvaluationSuspendedUntilNewFlame) {
          next.infernoEvaluationSuspendedUntilNewFlame = false;
          resolver.emitV2({ kind: 'inferno_suspension_changed', suspended: false,
            reason: 'new_flame_acquired', flame: offer.flame, instanceId });
        }
        next.infernoProgress.recentAction = 'flame_acquired';
        if (replaced?.type === 'fetch') next.fetchTarget = null;
        if (offer.flame === 'fetch') resolver.setFetchTarget(null);
        normalizeHandFamilyFlameRuntime(next);
        recalculateMaxCharge(next);
        next.flameSelection!.acquired = true;
        next.stats.flameAcquisitions.push({ round: next.round, slot, instanceId, flame: offer.flame,
          replaced: replaced ? { instanceId: replaced.instanceId, flame: replaced.type,
            stage: replaced.stage, investedGold: replaced.investedGold } : null });
        if (firstFlame && !next.flameTutorial.completed) next.flameTutorial.pendingFlameInstanceId = instanceId;
        resolver.emit({ type: replaced ? 'FLAME_REPLACED' : 'FLAME_ACQUIRED', flame: offer.flame, rarity: FLAMES[offer.flame].rarity,
          message: replaced ? `Flame slot ${slot + 1} replaced ${FLAMES[replaced.type].name} with ${FLAMES[offer.flame].name}; prior investment was lost`
            : `Flame slot ${slot + 1} acquired ${FLAMES[offer.flame].name} as a 0-Gold Ember` });
        resolver.openShop();
        break;
      }
      case 'STOKE_FLAME': {
        const flame = flameInstances(next).find(item => item.instanceId === action.flameInstanceId)!;
        const id = flame.type;
        const slot = next.flameSlots.findIndex(item => item?.instanceId === flame.instanceId) as FlameSlotIndex;
        const source = 'shop' as const;
        const from = flame.investedGold;
        resolver.spendGold(action.amount, `Stoked ${FLAMES[id].name}: −${formatPlayerNumber(action.amount)} Gold (Shop)`, 'flameInvestment');
        flame.investedGold += action.amount;
        next.infernoProgress.recentAction = 'flame_invested';
        recalculateMaxCharge(next);
        next.stats.flameStokes.push({ round: next.round, slot, instanceId: flame.instanceId, flame: id, amount: action.amount,
          from, total: flame.investedGold, source });
        next.stats.totalFlameInvestment += action.amount;
        resolver.emit({ type: 'FLAME_INVESTED', flame: id, amount: action.amount,
          message: `Stoked ${FLAMES[id].name}: ${formatPlayerNumber(from)} → ${formatPlayerNumber(flame.investedGold)} / 100 · ${flameEffectText(id, flame.investedGold, next)}` });
        if (flame.investedGold === 100) {
          flame.stage = 'bonfire';
          next.infernoProgress.recentAction = 'bonfire_created';
          recalculateMaxCharge(next);
          resolver.emit({ type: 'BONFIRE_CREATED', flame: id,
            message: `${FLAMES[id].name} became a Bonfire in Flame slot ${slot + 1} · +10 Temper` });
          resolver.addTemper(10, 'bonfire', 'BONFIRE CREATED');
        }
        break;
      }
      case 'CONTINUE_ROUND_SUMMARY': resolver.continueRoundSummary(); break;
      case 'CONTINUE_INFERNO_EVALUATION': resolver.continueInfernoEvaluation(); break;
      case 'ENGULF_NOW': resolver.engulfNow(); break;
      case 'NOT_YET': resolver.deferEngulfment(); break;
      case 'CONTINUE_FLAME_SELECTION': resolver.openShop(); break;
      case 'SKIP_FLAME_SELECTION':
        resolver.emit({ type: 'FLAME_SKIPPED', message: `Skipped Flame acquisition for round ${formatPlayerNumber(next.round)}` });
        resolver.openShop();
        break;
      case 'CHOOSE_SPECIAL_OFFER':
        resolver.chooseSpecialOffer(action.offerId);
        resolver.continueSpecialOffer();
        break;
      case 'CONTINUE_SPECIAL_OFFER': resolver.continueSpecialOffer(); break;
      case 'SKIP_SPECIAL_OFFER': {
        const chapter = chapterNumberForRound(next.round);
        next.chapterLifecycle[chapter] = { specialOfferConsumed: true };
        resolver.emit({ type: 'SPECIAL_OFFER_SKIPPED', message: `Skipped Special Offer for round ${formatPlayerNumber(next.round)}` });
        resolver.openShop();
        break;
      }
      case 'REROLL_OFFERS': {
        const cost = offerRerollCost(next.shop!.offerRerolls);
        const oldOfferIds = next.shop!.offers.map(offer => offer.id);
        resolver.spendGold(cost, 'Paid for Dice offer reroll', 'diceOfferReroll');
        next.shop!.offerRerolls++;
        next.stats.diceOfferRerolls++;
        resolver.freshOffers('reroll');
        resolver.emitV2({ kind: 'shop_transaction', transaction: { type: 'dice_offers_rerolled', cost,
          oldOfferIds, newOfferIds: next.shop!.offers.map(offer => offer.id), rerollCount: next.shop!.offerRerolls } });
        resolver.emit({ type: 'OFFERS_REFRESHED', message: 'Three fresh Dice offers' });
        break;
      }
      case 'SET_SHOP_STAGE': {
        const from = next.shop!.stage ?? 'shop';
        next.shop!.stage = action.stage;
        resolver.emitV2({ kind: 'shop_stage_changed', shopVisitId: next.shop!.visitId!, from, to: action.stage });
        break;
      }
      case 'UNLOCK_SHOP_EXIT': next.shop!.exitUnlocked = true; break;
      case 'TRAIN_HAND': {
        const session = next.shop!.trainingSession ??= createTrainingSession(next.handLevels);
        const fromLevel = next.handLevels[action.hand];
        const toLevel = fromLevel + 1;
        const quote = quoteTraining(session, next.handLevels, action.hand);
        const cost = quote.actualPrice!;
        if (cost) resolver.spendGold(cost, `Trained ${HANDS[action.hand].name} to level ${formatPlayerNumber(toLevel)}: −${formatPlayerNumber(cost)} gold`, 'handTraining');
        session.freeTrainingAvailable = false;
        next.handLevels[action.hand] = toLevel;
        session.purchasesByHand[action.hand] = quote.purchaseCount + 1;
        next.stats.trainingPurchases.push({ round: next.round, hand: action.hand, fromLevel, toLevel, cost,
          shopVisitId: next.shop!.visitId, family: quote.family, frozenBaseline: quote.frozenBaseline,
          relativeTier: quote.relativeTier, normalPrice: quote.normalPrice,
          waivedByOnTheHouse: quote.waivedByOnTheHouse, purchaseCount: quote.purchaseCount + 1 });
        next.stats.trainingPurchasesTotal++;
        next.stats.trainingGoldSpent += cost;
        resolver.emit({ type: 'TRAINING_PURCHASED', hand: action.hand, goldSpendSource: 'handTraining', amount: cost,
          message: `${HANDS[action.hand].name} trained to level ${formatPlayerNumber(toLevel)}` });
        break;
      }
      case 'RESTORE_LIFE': {
        const purchaseNumber = next.stats.lifeRestores.length + 1;
        const cost = lifeRestoreCost(next.shop!.lifeRestores);
        const goldBefore = next.gold;
        const livesBefore = next.lives;
        const lifetimeSpendBefore = next.lifetimeNormalShopGoldSpent;
        resolver.spendGold(cost, `Restored life #${formatPlayerNumber(purchaseNumber)}: −${formatPlayerNumber(cost)} Gold`, 'lifeRestore');
        next.lives++;
        next.shop!.lifeRestores++;
        next.stats.lifeRestores.push({ round: next.round, purchaseNumber, cost, goldBefore, goldAfter: next.gold,
          livesBefore, livesAfter: next.lives, lifetimeSpendBefore, lifetimeSpendAfter: next.lifetimeNormalShopGoldSpent });
        resolver.emit({ type: 'LIFE_RESTORED', amount: cost,
          message: `Restore #${formatPlayerNumber(purchaseNumber)}: ${formatPlayerNumber(cost)} Gold · lives ${formatPlayerNumber(livesBefore)} → ${formatPlayerNumber(next.lives)} · lifetime shop spend +${formatPlayerNumber(cost)}` });
        break;
      }
      case 'DISMISS_FLAME_TUTORIAL':
        next.flameTutorial = { pendingFlameInstanceId: null, completed: true };
        resolver.emit({ type: 'FLAME_TUTORIAL_COMPLETED', message: 'First-Flame shop tutorial completed' });
        break;
      case 'RETRY_ROUND':
        resolver.emitV2({ kind: 'shop_visit_completed', shopVisitId: next.shop!.visitId!,
          stage: next.shop!.stage as Exclude<NonNullable<Shop['stage']>, 'shop'>, progression: 'retry_round' });
        resolver.startRound(true); break;
      case 'NEXT_CHAPTER':
        resolver.emitV2({ kind: 'shop_visit_completed', shopVisitId: next.shop!.visitId!,
          stage: next.shop!.stage as Exclude<NonNullable<Shop['stage']>, 'shop'>, progression: 'next_chapter' });
        if (next.flameTutorial.pendingFlameInstanceId !== null && !next.flameTutorial.completed) next.flameTutorial = { pendingFlameInstanceId: null, completed: true };
        next.round++; next.roundAttemptNumber = 1; resolver.startRound(); break;
      case 'NEXT_ROUND':
        resolver.emitV2({ kind: 'shop_visit_completed', shopVisitId: next.shop!.visitId!,
          stage: next.shop!.stage as Exclude<NonNullable<Shop['stage']>, 'shop'>, progression: 'next_round' });
        if (next.flameTutorial.pendingFlameInstanceId !== null && !next.flameTutorial.completed) next.flameTutorial = { pendingFlameInstanceId: null, completed: true };
        next.round++; next.roundAttemptNumber = 1; resolver.startRound(); break;
    }
  }, random, rngStateOverride, options);
}
