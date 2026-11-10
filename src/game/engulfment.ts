import { chapterNumberForRound } from './chapters';
import {
  assemblyLineMultiplier, benchWarmerMultiplier, blackHoleMultiplier, casualMultiplier, cleanSweepMultiplier,
  epinephrineMultiplier, fatCatMultiplier, freeRealEstateMultiplier, frankensteinMultiplier, gymBrosMultiplier,
  handFamilyFlameMultiplier, heavyHittersMultiplier, highRollerMultiplier, dareDevilMultiplier,
  allInMultiplier, doubleOrNothingMultiplier,
  PROGRESSIVE_FLAME_SEQUENCES, progressiveSequenceMultiplier,
  HOT_STREAK_SEQUENCE, hotStreakMultiplier, isChargeFlame, isHandFamilyFlame, lowballMultiplier,
  minigunMultiplier, missingPairMultiplier, sixPackStartingMultiplier, speedDemonMultiplier,
  punchCardMultiplier, standardFlameMultiplier, targetPracticeMultiplier, vineyardMultiplier, oneShortMultiplier,
  calculateMaxChargeForInstances,
  FLAMES,
} from './flames';
import { availableHandIds, availableLowerHandIds, availableUpperHandIds, upperHand } from './hands';
import { canonicalRunHistoryV2Events } from './runHistoryV2Timeline';
import { finalizeScore, infernoMultiplier, INFERNO_BASE, scoreWeightedMultiplier } from './scoring';
import { exactRatioNumber, type ExactScore } from './scoreMath';
import { formatPlayerNumber } from './copy';
import type { EngulfmentEvidenceRoundTelemetry, EngulfmentOfferingTelemetry, HandScoredEvent, RoundAttemptFinishedEvent } from './runHistoryV2';
import type {
  Board, EngulfmentAssetRef, Flame, GameState, HandId, HandLevels, InfernoEvaluationState,
  InfernoTrend, InfernoWeakness,
} from './types';

export const ENGULFMENT_EVIDENCE_ROUNDS = 6;
export const ENGULFMENT_REQUIRED_MULTIPLIER = 15;
export const INFERNO_TREND_DEAD_ZONE = 0.05;
export const INFERNO_CLOSE_READINESS = 0.8;
export const INFERNO_INSIGHT_UTILIZATION_DELTA = 2;
export const INFERNO_INSIGHT_POWER_RELATIVE_DELTA = .25;
export const INFERNO_INSIGHT_LIMIT = 3;
export { infernoMultiplier, INFERNO_BASE };

export const engulfmentAssetKey = (asset: EngulfmentAssetRef): string =>
  `${asset.kind}:${asset.instanceId}:${asset.flame}:${asset.slot}`;

export function ownedEngulfmentAssets(state: Pick<Board, 'flameSlots'>): EngulfmentAssetRef[] {
  return state.flameSlots.flatMap((flame, slot) => flame
    ? [{ kind: flame.stage, flame: flame.type, instanceId: flame.instanceId, slot: slot as import('./types').FlameSlotIndex }]
    : []);
}

export const engulfmentSucceeds = (offeringMultiplier: number): boolean =>
  offeringMultiplier >= ENGULFMENT_REQUIRED_MULTIPLIER;

function attemptKey(event: { timelineId: number; round: number; attempt: number }): string {
  return `${event.timelineId}:${event.round}:${event.attempt}`;
}

/** Resolved local factor supplied by all selected Flame instances together. */
export function selectedOfferingFactor(event: Pick<HandScoredEvent, 'xMultContributions'>,
  selectedInstanceIds: ReadonlySet<number>): number {
  let factor = 1;
  for (const contribution of event.xMultContributions) {
    if (contribution.sourceId === 'charge') {
      const replay = contribution.chargeReplay;
      if (replay) {
        const remaining = replay.flames.filter(flame => !selectedInstanceIds.has(flame.instanceId));
        const counterfactualCap = calculateMaxChargeForInstances(remaining.map(flame => ({
          type: flame.flame, investedGold: flame.investedGold,
        })));
        const counterfactualCharge = replay.events.reduce((charge, chargeEvent) =>
          selectedInstanceIds.has(chargeEvent.sourceInstanceId) ? charge
            : Math.min(counterfactualCap, charge * Math.max(1, chargeEvent.factorRequested)), 1);
        factor *= Math.max(1, contribution.factor) / Math.max(1, counterfactualCharge);
      } else {
        // Legacy schema fallback for histories recorded before multiplicative Charge replay.
        const selectedAttributed = (contribution.chargeSources ?? []).reduce((sum, source) =>
          source.instanceId !== undefined && selectedInstanceIds.has(source.instanceId)
            ? sum + Math.max(0, source.attributed ?? 0) : sum, 0);
        if (selectedAttributed > 0) {
          const charge = Math.max(1, contribution.factor);
          factor *= charge / Math.max(1, charge - selectedAttributed);
        }
      }
    } else if (contribution.sourceInstanceId !== undefined && selectedInstanceIds.has(contribution.sourceInstanceId)) {
      factor *= Math.max(1, contribution.factor);
    }
  }
  return Number(Math.max(1, factor).toFixed(12));
}

export function offeringHandObservation(event: HandScoredEvent, selectedInstanceIds: ReadonlySet<number>): { factor: number; weight: ExactScore } {
  const resolvedFactor = selectedOfferingFactor(event, selectedInstanceIds);
  const counterfactualScore = resolvedFactor > 1
    ? finalizeScore(event.score.finalPips, event.score.finalMult,
      (event.score.finalXMult / resolvedFactor) * event.score.bossFactor, event.score.infernoMultiplier ?? 1n).finalScore
    : event.score.awarded;
  const factor = counterfactualScore > 0n
    ? Math.max(1, exactRatioNumber(event.score.awarded, counterfactualScore)) : 1;
  return { factor, weight: counterfactualScore > 0n ? counterfactualScore : 0n };
}

export interface EngulfmentOfferingEvaluation {
  offerings: EngulfmentOfferingTelemetry[];
  evidenceRounds: EngulfmentEvidenceRoundTelemetry[];
  offeringMultiplier: number;
}

interface FlameWindowMetrics {
  asset: EngulfmentAssetRef;
  clears: number;
  utilized: number;
  power: number;
}

function flameWindowMetrics(
  clearEvents: RoundAttemptFinishedEvent[],
  handsByAttempt: Map<string, HandScoredEvent[]>,
  removedPackagesByAttempt: Map<string, Set<string>>,
  lastBurnByAttempt: Map<string, number>,
  asset: EngulfmentAssetRef,
): FlameWindowMetrics {
  const selected = new Set([asset.instanceId]);
  let utilized = 0;
  const powers = clearEvents.map(clear => {
    const key = attemptKey(clear);
    const removed = removedPackagesByAttempt.get(key) ?? new Set<string>();
    const lastBurn = lastBurnByAttempt.get(key) ?? -1;
    const hands = (handsByAttempt.get(key) ?? []).filter(hand => hand.seq > lastBurn && !removed.has(hand.scorePackageId));
    if (hands.some(hand => selectedOfferingFactor(hand, selected) > 1 + 1e-9)) utilized++;
    return scoreWeightedMultiplier(hands.map(hand => offeringHandObservation(hand, selected)));
  });
  const power = powers.length ? powers.reduce((sum, value) => sum + value, 0) / powers.length : 1;
  return { asset, clears: clearEvents.length, utilized, power: Number(power.toFixed(12)) };
}

/** Deterministic, factual observations about the Flames that remain relevant to the player. */
export function infernoEvidenceInsights(
  state: Pick<GameState, 'historyV2' | 'historyV2Coverage'>,
  assets: readonly EngulfmentAssetRef[],
): string[] {
  if (!assets.length) return ['No Flames remain after this Engulfment.'];
  const canonical = canonicalRunHistoryV2Events(state.historyV2, state.historyV2Coverage);
  const clears = canonical.filter((event): event is RoundAttemptFinishedEvent =>
    event.kind === 'round_attempt_finished' && event.outcome === 'cleared');
  const latestClears = clears.slice(-ENGULFMENT_EVIDENCE_ROUNDS);
  const previousClears = clears.length >= ENGULFMENT_EVIDENCE_ROUNDS * 2
    ? clears.slice(-ENGULFMENT_EVIDENCE_ROUNDS * 2, -ENGULFMENT_EVIDENCE_ROUNDS) : [];
  const handsByAttempt = new Map<string, HandScoredEvent[]>();
  const removedPackagesByAttempt = new Map<string, Set<string>>();
  const lastBurnByAttempt = new Map<string, number>();
  for (const event of canonical) if (event.kind === 'hand_scored') {
    const key = attemptKey(event);
    const hands = handsByAttempt.get(key) ?? [];
    hands.push(event); handsByAttempt.set(key, hands);
  } else if (event.kind === 'score_package_removed') {
    const key = attemptKey(event);
    const removed = removedPackagesByAttempt.get(key) ?? new Set<string>();
    removed.add(event.packageId); removedPackagesByAttempt.set(key, removed);
  } else if (event.kind === 'flame_action' && event.action.type === 'burn_it_down') {
    lastBurnByAttempt.set(attemptKey(event), event.seq);
  }
  const recent = assets.map(asset => flameWindowMetrics(latestClears, handsByAttempt,
    removedPackagesByAttempt, lastBurnByAttempt, asset));
  const previous = new Map(previousClears.length ? assets.map(asset => {
    const metrics = flameWindowMetrics(previousClears, handsByAttempt, removedPackagesByAttempt, lastBurnByAttempt, asset);
    return [asset.instanceId, metrics] as const;
  }) : []);
  const insights: { priority: number; magnitude: number; instanceId: number; text: string }[] = [];
  for (const current of recent) {
    const name = FLAMES[current.asset.flame].name;
    const before = previous.get(current.asset.instanceId);
    if (before) {
      const utilizationDelta = current.utilized - before.utilized;
      if (Math.abs(utilizationDelta) >= INFERNO_INSIGHT_UTILIZATION_DELTA) insights.push({
        priority: 1, magnitude: Math.abs(utilizationDelta), instanceId: current.asset.instanceId,
        text: `${name} was used in ${current.utilized}/${current.clears} recent clears, ${utilizationDelta > 0 ? 'up from' : 'down from'} ${before.utilized}/${before.clears}.`,
      });
      const relativePowerDelta = (current.power - before.power) / Math.max(1, before.power);
      if (Math.abs(relativePowerDelta) >= INFERNO_INSIGHT_POWER_RELATIVE_DELTA) insights.push({
        priority: 2, magnitude: Math.abs(relativePowerDelta), instanceId: current.asset.instanceId,
        text: `${name} contributed ${relativePowerDelta > 0 ? 'more' : 'less'} effective power than in the previous six clears.`,
      });
    }
  }
  const strongest = recent.slice().sort((left, right) => right.power - left.power
    || right.utilized - left.utilized || left.asset.instanceId - right.asset.instanceId)[0];
  if (strongest && strongest.power > 1 + 1e-9) insights.push({ priority: 0, magnitude: strongest.power,
    instanceId: strongest.asset.instanceId,
    text: `${FLAMES[strongest.asset.flame].name} is your strongest remaining Flame at Recent Power ×${formatPlayerNumber(strongest.power)}.` });
  for (const current of recent.filter(item => item.utilized > 0)) insights.push({
    priority: 3, magnitude: current.utilized, instanceId: current.asset.instanceId,
    text: `${FLAMES[current.asset.flame].name} contributed in ${current.utilized} of your last ${current.clears} clears.`,
  });
  const selected: string[] = [];
  const perFlame = new Map<number, number>();
  for (const insight of insights.sort((left, right) => left.priority - right.priority
    || right.magnitude - left.magnitude || left.instanceId - right.instanceId || left.text.localeCompare(right.text))) {
    if (selected.includes(insight.text) || (perFlame.get(insight.instanceId) ?? 0) >= 2) continue;
    selected.push(insight.text);
    perFlame.set(insight.instanceId, (perFlame.get(insight.instanceId) ?? 0) + 1);
    if (selected.length === INFERNO_INSIGHT_LIMIT) break;
  }
  if (!selected.length) selected.push(latestClears.length
    ? `Your ${assets.length} remaining Flame${assets.length === 1 ? '' : 's'} recorded no effective-power contribution in the last ${latestClears.length} canonical clears.`
    : `No canonical cleared-Round Flame evidence is available yet for your ${assets.length} remaining Flame${assets.length === 1 ? '' : 's'}.`);
  if (selected.length === 1 && latestClears.length > 0 && latestClears.length < ENGULFMENT_EVIDENCE_ROUNDS)
    selected.push(`Recent evidence currently covers ${latestClears.length} canonical clear${latestClears.length === 1 ? '' : 's'}.`);
  return selected.slice(0, INFERNO_INSIGHT_LIMIT);
}

/**
 * Authoritative realized-score evaluator: six latest canonical clears,
 * score-weighted inside each Round and equal-weighted between Rounds. Score
 * packages later removed by a wager and score destroyed by Burn It Down are
 * excluded because they did not survive into the cleared Round score.
 */
export function evaluateEngulfmentOffering(
  state: Pick<GameState, 'historyV2' | 'historyV2Coverage'>,
  assets: readonly EngulfmentAssetRef[],
): EngulfmentOfferingEvaluation {
  const canonical = canonicalRunHistoryV2Events(state.historyV2, state.historyV2Coverage);
  const clears = canonical.filter(event => event.kind === 'round_attempt_finished' && event.outcome === 'cleared')
    .slice(-ENGULFMENT_EVIDENCE_ROUNDS);
  const selectedInstanceIds = new Set(assets.map(asset => asset.instanceId));
  const handsByAttempt = new Map<string, HandScoredEvent[]>();
  const removedPackagesByAttempt = new Map<string, Set<string>>();
  const lastBurnByAttempt = new Map<string, number>();
  for (const event of canonical) if (event.kind === 'hand_scored') {
    const key = attemptKey(event);
    const hands = handsByAttempt.get(key) ?? [];
    hands.push(event);
    handsByAttempt.set(key, hands);
  } else if (event.kind === 'score_package_removed') {
    const key = attemptKey(event);
    const removed = removedPackagesByAttempt.get(key) ?? new Set<string>();
    removed.add(event.packageId);
    removedPackagesByAttempt.set(key, removed);
  } else if (event.kind === 'flame_action' && event.action.type === 'burn_it_down') {
    lastBurnByAttempt.set(attemptKey(event), event.seq);
  }
  const evidenceRounds = clears.map(clear => {
    const key = attemptKey(clear);
    const removed = removedPackagesByAttempt.get(key) ?? new Set<string>();
    const lastBurn = lastBurnByAttempt.get(key) ?? -1;
    const hands = (handsByAttempt.get(key) ?? []).filter(hand => hand.seq > lastBurn && !removed.has(hand.scorePackageId));
    const multiplier = scoreWeightedMultiplier(hands.map(hand => offeringHandObservation(hand, selectedInstanceIds)));
    return { round: clear.round, attempt: clear.attempt, timelineId: clear.timelineId,
      handCount: hands.length, multiplier: Number(multiplier.toFixed(12)) };
  });
  const offeringMultiplier = evidenceRounds.length
    ? evidenceRounds.reduce((sum, round) => sum + round.multiplier, 0) / evidenceRounds.length : 1;
  return {
    offerings: assets.map(asset => ({ asset: structuredClone(asset) })),
    evidenceRounds,
    offeringMultiplier: Number(offeringMultiplier.toFixed(12)),
  };
}

const HAND_FAMILY_PAYOFFS: Partial<Record<Flame, HandId>> = {
  straightShooter: 'largeStraight', doubleDown: 'twoPair', threesCompany: 'fullHouse', boxSet: 'fiveKind',
};

/**
 * A perfect legal activation for one fully-developed Flame on a given hand.
 * Values come from the same formula functions used by live Flame resolution.
 */
function maximumFlameFactorOnHand(flame: Flame, hand: HandId): number {
  if (isChargeFlame(flame)) return 1;
  if (flame === 'minigun' && !upperHand(hand)) return 1;
  if (flame === 'hotStreak' && !HOT_STREAK_SEQUENCE.includes(hand)) return 1;
  if (flame === 'missingPair' && hand !== 'pair' && hand !== 'threeKind') return 1;
  if (flame === 'oneShort' && hand !== 'smallStraight' && hand !== 'fourKind') return 1;
  if (HAND_FAMILY_PAYOFFS[flame] && HAND_FAMILY_PAYOFFS[flame] !== hand) return 1;
  if (flame === 'targetPractice') return targetPracticeMultiplier(100);
  if (flame === 'hotStreak') return hotStreakMultiplier(100, HOT_STREAK_SEQUENCE.length);
  if (flame === 'speedDemon') return speedDemonMultiplier(100, 0);
  if (flame === 'sixPack') return sixPackStartingMultiplier(100);
  if (flame === 'minigun') return minigunMultiplier(100, 6);
  if (flame === 'lowball') return lowballMultiplier(100);
  if (flame === 'fatCat') return fatCatMultiplier(100, 5);
  if (flame === 'vineyard') return vineyardMultiplier(100, 5);
  if (flame === 'missingPair') return missingPairMultiplier(100);
  if (flame === 'oneShort') return oneShortMultiplier(100);
  if (flame === 'casual') return casualMultiplier(100);
  if (flame === 'freeRealEstate') return freeRealEstateMultiplier(100);
  if (flame === 'heavyHitters') return heavyHittersMultiplier(100);
  if (flame === 'frankenstein') return frankensteinMultiplier(100);
  if (flame === 'highRoller') return highRollerMultiplier(100);
  if (flame === 'cleanSweep') return cleanSweepMultiplier(100);
  if (flame === 'benchWarmer') return benchWarmerMultiplier(100);
  if (flame === 'epinephrine') return epinephrineMultiplier(100);
  if (flame === 'punchCard') return punchCardMultiplier(100);
  if (flame === 'blackHole') return blackHoleMultiplier(100, 4);
  if (flame === 'assemblyLine') return assemblyLineMultiplier(100, 5);
  if (flame === 'gymBros') return gymBrosMultiplier(100, 5);
  if (flame === 'dareDevil') return dareDevilMultiplier(100, 4);
  if (flame === 'doubleOrNothing') return doubleOrNothingMultiplier(100);
  if (flame === 'allIn') return allInMultiplier(100);
  if (flame === 'topDown' || flame === 'countDown') {
    const step = PROGRESSIVE_FLAME_SEQUENCES[flame].hands.indexOf(hand as never);
    return step < 0 ? 1 : progressiveSequenceMultiplier(flame, 100, step);
  }
  if (isHandFamilyFlame(flame)) return handFamilyFlameMultiplier(flame, 100);
  return standardFlameMultiplier(100);
}

/**
 * Diagnostic upper bound for this exact set of Flame instance IDs. Each Ember
 * is treated as its reachable 100-Gold Bonfire, every legal condition is
 * optimally satisfied, and the resulting simultaneous factors are composed by
 * selectedOfferingFactor -- the contribution-v2 evaluator's non-additive
 * attribution rule. The best legal hand is the collection's ceiling.
 */
export function maximumPossibleEngulfmentReadiness(
  state: Pick<Board, 'flameSlots'> & Partial<Pick<Board, 'infernoRewards'>>,
  assets: readonly EngulfmentAssetRef[] = ownedEngulfmentAssets(state),
): number {
  if (!assets.length) return 0;
  const chargeAssets = assets.filter(asset => isChargeFlame(asset.flame));
  const chargeFactor = calculateMaxChargeForInstances(chargeAssets.map(asset => ({
    type: asset.flame, investedGold: 100,
  })));
  const best = availableHandIds(state).reduce((maximum, hand) => {
    const directFactor = assets.reduce((product, asset) => {
      if (isChargeFlame(asset.flame)) return product;
      return product * maximumFlameFactorOnHand(asset.flame, hand);
    }, 1);
    return Math.max(maximum, directFactor * chargeFactor);
  }, 1);
  return Number(best.toFixed(12));
}

export interface HandLevelNormalization {
  levelsBefore: { hand: HandId; level: number }[];
  average: number;
  unifiedLevel: number;
}

export function handLevelNormalization(levels: HandLevels, hands: readonly HandId[]): HandLevelNormalization {
  const levelsBefore = hands.map(hand => ({ hand, level: levels[hand] }));
  const average = levelsBefore.reduce((sum, item) => sum + item.level, 0) / hands.length;
  return { levelsBefore, average, unifiedLevel: Math.max(1, Math.round(average)) };
}

export function engulfmentTrainingNormalization(levels: HandLevels, unlockedHands: readonly HandId[] = []) {
  return { upper: handLevelNormalization(levels, availableUpperHandIds({ unlockedHands })),
    lower: handLevelNormalization(levels, availableLowerHandIds({ unlockedHands })) };
}

export function classifyInfernoTrend(readiness: number, previousReadiness: number | null): InfernoTrend {
  if (previousReadiness === null) return 'first';
  const delta = readiness - previousReadiness;
  return delta >= INFERNO_TREND_DEAD_ZONE ? 'improving'
    : delta <= -INFERNO_TREND_DEAD_ZONE ? 'worsening' : 'stable';
}

export function classifyInfernoWeakness(
  assets: readonly EngulfmentAssetRef[], readiness: number, state: Pick<GameState, 'flameSlots'>,
): InfernoWeakness {
  if (readiness >= INFERNO_CLOSE_READINESS) return 'close';
  if (assets.length <= 1) return 'quantity';
  const averageInvestment = assets.reduce((sum, asset) => sum
    + (state.flameSlots[asset.slot]?.instanceId === asset.instanceId ? state.flameSlots[asset.slot]!.investedGold : 0), 0) / assets.length;
  return averageInvestment < 60 ? 'investment' : 'utilization';
}

/** Freezes one authoritative whole-collection evaluation for player-directed sacrifice selection. */
export function createInfernoEvaluation(state: GameState): InfernoEvaluationState | null {
  const assets = ownedEngulfmentAssets(state);
  if (!assets.length) return null;
  const evaluationIndex = state.infernoProgress.evaluationIndex + 1;
  const full = evaluateEngulfmentOffering(state, assets);
  const readiness = Math.max(0, Math.min(1, full.offeringMultiplier / ENGULFMENT_REQUIRED_MULTIPLIER));
  const previousReadiness = state.infernoProgress.previousReadiness;
  const trend = classifyInfernoTrend(readiness, previousReadiness);
  const weakness = classifyInfernoWeakness(assets, readiness, state);
  const recentAction = trend === 'improving' && state.infernoProgress.recentAction === 'none'
    ? 'contribution_improved' : trend === 'worsening' && state.infernoProgress.recentAction === 'none'
      ? 'contribution_declined' : state.infernoProgress.recentAction;
  const diagnostics = assets.map(asset => ({ asset: structuredClone(asset), status: asset.kind,
    investment: state.flameSlots[asset.slot]?.instanceId === asset.instanceId ? state.flameSlots[asset.slot]!.investedGold : 0,
    hiddenStrength: evaluateEngulfmentOffering(state, [asset]).offeringMultiplier }));
  const strongestFirst = diagnostics.slice().sort((left, right) =>
    right.hiddenStrength - left.hiddenStrength || left.asset.instanceId - right.asset.instanceId).map(item => item.asset);
  const success = engulfmentSucceeds(full.offeringMultiplier);
  const maximumPossibleReadiness = maximumPossibleEngulfmentReadiness(state, assets);
  const currentCollectionTheoreticallySufficient = engulfmentSucceeds(maximumPossibleReadiness);
  const suspendAfterContinue = !success && !currentCollectionTheoreticallySufficient;
  const feedbackMessages = infernoEvidenceInsights(state, assets);
  const normalization = engulfmentTrainingNormalization(state.handLevels, state.infernoRewards.unlockedHands);
  const infernoLevelBefore = state.engulfmentLevel;
  return {
    evaluationIndex, round: state.round, chapter: chapterNumberForRound(state.round), flames: diagnostics,
    evidenceRounds: full.evidenceRounds, effectiveValue: full.offeringMultiplier,
    threshold: ENGULFMENT_REQUIRED_MULTIPLIER, readiness, maximumPossibleReadiness,
    currentCollectionTheoreticallySufficient, suspendAfterContinue, previousReadiness, trend, weakness, recentAction,
    feedbackMessageId: 'inferno-evidence', feedbackMessage: feedbackMessages[0] ?? null,
    feedbackMessages, engulfed: false, success,
    strongestFirst, prefixEvaluations: [], flamesSnuffed: [],
    flamesPreserved: assets.map(asset => structuredClone(asset)), selectedFlameInstanceIds: [],
    selectedEffectiveValue: 1, earnedInfernoFactor: 1,
    engulfmentCountBefore: infernoLevelBefore, engulfmentCountAfter: infernoLevelBefore,
    infernoLevelBefore, infernoLevelAfter: infernoLevelBefore,
    infernoMultiplierBefore: state.infernoMultiplier,
    infernoMultiplierAfter: state.infernoMultiplier,
    upper: normalization.upper, lower: normalization.lower,
    consumedFinalFlame: false,
  };
}

/** Recomputes the selected subset jointly. Individual powers are diagnostics only and are never summed. */
export function withInfernoSelection(state: GameState, evaluation: InfernoEvaluationState,
  selectedFlameInstanceIds: readonly number[]): InfernoEvaluationState {
  const selectedIds = new Set(selectedFlameInstanceIds);
  const allAssets = evaluation.flames.map(item => item.asset);
  const flamesSnuffed = allAssets.filter(asset => selectedIds.has(asset.instanceId));
  const flamesPreserved = allAssets.filter(asset => !selectedIds.has(asset.instanceId));
  const selectedEffectiveValue = flamesSnuffed.length
    ? evaluateEngulfmentOffering(state, flamesSnuffed).offeringMultiplier : 1;
  const selectedSuccess = engulfmentSucceeds(selectedEffectiveValue);
  const earnedInfernoFactor = selectedSuccess ? Math.max(1, Math.floor(selectedEffectiveValue)) : 1;
  const engulfmentCountAfter = evaluation.engulfmentCountBefore + (selectedSuccess ? 1 : 0);
  const infernoMultiplierAfter = selectedSuccess
    ? evaluation.infernoMultiplierBefore * BigInt(earnedInfernoFactor) : evaluation.infernoMultiplierBefore;
  const feedbackMessages = infernoEvidenceInsights(state, flamesPreserved);
  return {
    ...evaluation,
    feedbackMessageId: 'inferno-evidence',
    feedbackMessage: feedbackMessages[0] ?? null,
    feedbackMessages,
    selectedFlameInstanceIds: flamesSnuffed.map(asset => asset.instanceId),
    flamesSnuffed: structuredClone(flamesSnuffed),
    flamesPreserved: structuredClone(flamesPreserved),
    selectedEffectiveValue,
    earnedInfernoFactor,
    engulfmentCountAfter,
    infernoLevelAfter: engulfmentCountAfter,
    infernoMultiplierAfter,
    consumedFinalFlame: selectedSuccess && flamesSnuffed.length === allAssets.length,
  };
}

export interface EngulfmentAnimationProfile {
  success: boolean;
  strength: 'very_weak' | 'moderate' | 'near' | 'bare' | 'strong' | 'massive';
  durationMs: number;
}

export const visibleInfernoMeterPercent = (readiness: number | null): number =>
  Math.max(0, Math.min(100, (readiness ?? 0) * 100));

export function infernoMeterTransition(
  evaluation: Pick<InfernoEvaluationState, 'previousReadiness' | 'readiness'>,
): { startPercent: number; endPercent: number } {
  return {
    startPercent: visibleInfernoMeterPercent(evaluation.previousReadiness),
    endPercent: visibleInfernoMeterPercent(evaluation.readiness),
  };
}

export function engulfmentAnimationProfile(offeringMultiplier: number): EngulfmentAnimationProfile {
  const progress = Math.max(0, offeringMultiplier) / ENGULFMENT_REQUIRED_MULTIPLIER;
  const success = progress >= 1;
  const strength = progress < .45 ? 'very_weak' : progress < .9 ? 'moderate' : progress < 1 ? 'near'
    : progress < 1.2 ? 'bare' : progress < 1.75 ? 'strong' : 'massive';
  const durationMs = strength === 'near' ? 4000 : strength === 'bare' ? 3800
    : strength === 'moderate' ? 2700 : strength === 'very_weak' ? 2100 : strength === 'strong' ? 2300 : 1400;
  return { success, strength, durationMs };
}

export const infernoEvaluationDuration = (offeringMultiplier: number): number =>
  engulfmentAnimationProfile(offeringMultiplier).durationMs;

export function infernoRoman(level: number): string {
  if (level <= 0) return '0';
  const values: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let remaining = Math.floor(level);
  let result = '';
  for (const [value, symbol] of values) while (remaining >= value) { result += symbol; remaining -= value; }
  return result;
}
