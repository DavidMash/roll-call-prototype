import { chapterNumberForRound } from './chapters';
import {
  activeFlameId, activeFlameInvestment, currentFlameInstanceId, handFamilyFlameMultiplier,
  HOT_STREAK_SEQUENCE, hotStreakMultiplier, isChargeFlame, lowballMultiplier, maxChargeContribution,
  sixPackStartingMultiplier, speedDemonMultiplier, standardFlameMultiplier, targetPracticeMultiplier,
} from './flames';
import { HAND_IDS, LOWER_HAND_IDS, UPPER_HAND_IDS } from './hands';
import { canonicalRunHistoryV2Events } from './runHistoryV2Timeline';
import { finalizeScore, infernoMultiplier, INFERNO_BASE, scoreWeightedMultiplier } from './scoring';
import { exactRatioNumber, type ExactScore } from './scoreMath';
import type { EngulfmentEvidenceRoundTelemetry, EngulfmentOfferingTelemetry, HandScoredEvent } from './runHistoryV2';
import type {
  Board, EngulfmentAssetRef, Flame, GameState, HandId, HandLevels, InfernoEvaluationState, InfernoRecentAction,
  InfernoTrend, InfernoWeakness,
} from './types';

export const ENGULFMENT_EVIDENCE_ROUNDS = 6;
export const ENGULFMENT_REQUIRED_MULTIPLIER = 25;
export const INFERNO_TREND_DEAD_ZONE = 0.05;
export const INFERNO_CLOSE_READINESS = 0.8;
export const INFERNO_SUSPENSION_MESSAGE = 'The Inferno will return when you have more Flames to offer.';
export { infernoMultiplier, INFERNO_BASE };

export const engulfmentAssetKey = (asset: EngulfmentAssetRef): string => asset.kind === 'ember'
  ? `ember:${asset.instanceId}:${asset.flame}:${asset.dieId}`
  : `bonfire:${asset.instanceId}:${asset.flame}`;

export function ownedEngulfmentAssets(state: Pick<Board, 'dice' | 'bonfires' | 'flameInstanceIds'>): EngulfmentAssetRef[] {
  return [
    ...state.dice.filter(die => die.owner === 'player' && activeFlameId(die.flame) !== null).flatMap(die => {
      const flame = activeFlameId(die.flame)!;
      const instanceId = currentFlameInstanceId(state, flame);
      return instanceId === null ? [] : [{ kind: 'ember' as const, flame, instanceId, dieId: die.id }];
    }),
    ...state.bonfires.flatMap(flame => {
      const instanceId = currentFlameInstanceId(state, flame);
      return instanceId === null ? [] : [{ kind: 'bonfire' as const, flame, instanceId }];
    }),
  ];
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
      const selectedAttributed = (contribution.chargeSources ?? []).reduce((sum, source) =>
        source.instanceId !== undefined && selectedInstanceIds.has(source.instanceId)
          ? sum + Math.max(0, source.attributed ?? 0) : sum, 0);
      if (selectedAttributed > 0) {
        const charge = Math.max(1, contribution.factor);
        factor *= charge / Math.max(1, charge - selectedAttributed);
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

/**
 * Authoritative engulfment-contribution-v2 evaluator. Balance behavior is
 * intentionally unchanged: six latest canonical clears, score-weighted
 * inside each Round and equal-weighted between Rounds.
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
  for (const event of canonical) if (event.kind === 'hand_scored') {
    const key = attemptKey(event);
    const hands = handsByAttempt.get(key) ?? [];
    hands.push(event);
    handsByAttempt.set(key, hands);
  }
  const evidenceRounds = clears.map(clear => {
    const hands = handsByAttempt.get(attemptKey(clear)) ?? [];
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

function minimumLegalAverageForLowball(hand: HandId): number {
  if (hand === 'ones' || hand === 'pair' || hand === 'threeKind' || hand === 'fourKind' || hand === 'fiveKind') return 1;
  if (hand === 'twos') return 2;
  if (hand === 'threes') return 3;
  if (hand === 'fours') return 4;
  if (hand === 'fives') return 5;
  if (hand === 'sixes') return 6;
  if (hand === 'twoPair') return 1.5;
  if (hand === 'fullHouse') return 1.4;
  if (hand === 'smallStraight') return 2.5;
  return 3; // Large Straight.
}

/**
 * A perfect legal activation for one fully-developed Flame on a given hand.
 * Values come from the same formula functions used by live Flame resolution.
 */
function maximumFlameFactorOnHand(flame: Flame, hand: HandId): number {
  if (isChargeFlame(flame)) return 1;
  if (flame === 'minigun' && !UPPER_HAND_IDS.includes(hand)) return 1;
  if (flame === 'hotStreak' && !HOT_STREAK_SEQUENCE.includes(hand)) return 1;
  if (flame === 'missingPair' && hand !== 'pair' && hand !== 'threeKind') return 1;
  if (flame === 'oneShort' && hand !== 'smallStraight' && hand !== 'fourKind') return 1;
  if (HAND_FAMILY_PAYOFFS[flame] && HAND_FAMILY_PAYOFFS[flame] !== hand) return 1;
  if (flame === 'targetPractice') return targetPracticeMultiplier(100);
  if (flame === 'hotStreak') return hotStreakMultiplier(100, HOT_STREAK_SEQUENCE.length);
  if (flame === 'speedDemon') return speedDemonMultiplier(100, 0);
  if (flame === 'sixPack') return sixPackStartingMultiplier(100);
  if (flame === 'lowball') return lowballMultiplier(100, minimumLegalAverageForLowball(hand));
  if (HAND_FAMILY_PAYOFFS[flame]) return handFamilyFlameMultiplier(100);
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
  state: Pick<Board, 'dice' | 'bonfires' | 'flameInstanceIds'>,
  assets: readonly EngulfmentAssetRef[] = ownedEngulfmentAssets(state),
): number {
  if (!assets.length) return 0;
  const selectedIds = new Set(assets.map(asset => asset.instanceId));
  const chargeAssets = assets.filter(asset => isChargeFlame(asset.flame));
  const chargeFactor = chargeAssets.length * maxChargeContribution(100);
  const best = HAND_IDS.reduce((maximum, hand) => {
    const xMultContributions: HandScoredEvent['xMultContributions'] = assets.flatMap(asset => {
      if (isChargeFlame(asset.flame)) return [];
      const factor = maximumFlameFactorOnHand(asset.flame, hand);
      return factor <= 1 ? [] : [{ sourceId: asset.flame, origin: 'bonfire' as const,
        factor, sourceInstanceId: asset.instanceId }];
    });
    if (chargeAssets.length) {
      const attributed = (chargeFactor - 1) / chargeAssets.length;
      xMultContributions.push({ sourceId: 'charge', origin: 'charge', factor: chargeFactor,
        chargeSources: chargeAssets.map(asset => ({ flame: asset.flame, instanceId: asset.instanceId,
          origin: 'bonfire', attributed, factor: chargeFactor })) });
    }
    const factor = selectedOfferingFactor({ xMultContributions }, selectedIds);
    return Math.max(maximum, factor);
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

export function engulfmentTrainingNormalization(levels: HandLevels) {
  return { upper: handLevelNormalization(levels, UPPER_HAND_IDS), lower: handLevelNormalization(levels, LOWER_HAND_IDS) };
}

export const INFERNO_MESSAGE_POOLS = {
  quantity: [
    ['quantity-01', 'The Inferno craves more Flames.'], ['quantity-02', 'Gather more Flames.'],
    ['quantity-03', 'More fire is needed.'], ['quantity-04', 'Build a greater fire.'],
    ['quantity-05', 'The Inferno hungers for more.'], ['quantity-06', 'Your offering lacks enough Flame.'],
    ['quantity-07', 'There is not yet enough fire.'], ['quantity-08', 'Gather strength before the Inferno calls again.'],
  ],
  investment: [
    ['investment-01', 'Grow your Flames to unleash their power.'], ['investment-02', 'Stoke your Flames further.'],
    ['investment-03', 'Your Flames have more power to unlock.'], ['investment-04', 'Feed your Flames before feeding the Inferno.'],
    ['investment-05', 'Let your Flames mature.'], ['investment-06', 'There is more power waiting in your Flames.'],
    ['investment-07', 'Your fire needs tending.'], ['investment-08', 'Strengthen what you already possess.'],
  ],
  utilization: [
    ['utilization-01', 'Utilize your Flames as much as possible.'], ['utilization-02', 'Make your Flames prove their worth.'],
    ['utilization-03', 'Power unused will not satisfy the Inferno.'], ['utilization-04', 'Put your Flames to work.'],
    ['utilization-05', 'Your Flames must burn brighter in battle.'], ['utilization-06', 'The Inferno wants power it has witnessed.'],
    ['utilization-07', 'Possessing power is not enough.'], ['utilization-08', 'Show the Inferno what your Flames can do.'],
  ],
  close: [
    ['close-01', 'You are on the right track. Keep up your efforts.'], ['close-02', 'The Inferno is beginning to stir.'],
    ['close-03', 'The heat is rising.'], ['close-04', 'Your Flames are nearly enough.'],
    ['close-05', 'The Inferno is close to awakening.'], ['close-06', 'Just a little more.'],
    ['close-07', 'The fire is almost ready.'], ['close-08', 'Engulfment draws near.'],
  ],
  improving: [
    ['improving-01', 'Your Flames grow stronger.'], ['improving-02', 'The Inferno has noticed your progress.'],
    ['improving-03', 'You are drawing closer.'], ['improving-04', 'The fire burns brighter than before.'],
    ['improving-05', 'Your efforts are feeding the Inferno.'], ['improving-06', 'Keep this momentum.'],
    ['improving-07', 'This is progress.'], ['improving-08', 'The Inferno approves of your direction.'],
  ],
  worsening: [
    ['worsening-01', 'You are losing ground.'], ['worsening-02', 'The fire has weakened.'],
    ['worsening-03', 'The Inferno was more impressed before.'], ['worsening-04', 'Your Flames have lost some of their edge.'],
    ['worsening-05', 'You stray farther from Engulfment.'], ['worsening-06', 'Reclaim the power you had.'],
    ['worsening-07', 'You were closer before.'], ['worsening-08', 'The Inferno recedes.'],
  ],
  stagnant: [
    ['stagnant-01', 'The Inferno waits.'], ['stagnant-02', 'Little has changed.'],
    ['stagnant-03', 'The fire remains unmoved.'], ['stagnant-04', 'The Inferno is still unconvinced.'],
    ['stagnant-05', 'You must do more.'], ['stagnant-06', 'Your progress has stalled.'],
    ['stagnant-07', 'The flames burn, but no brighter.'], ['stagnant-08', 'The Inferno remains unsatisfied.'],
  ],
  acquired: [
    ['acquired-01', 'A new Flame joins the fire. Make it count.'], ['acquired-02', 'Your fire has grown. Now prove its strength.'],
    ['acquired-03', 'A new Flame brings new potential.'], ['acquired-04', 'More fire. Now make it burn.'],
  ],
  invested: [
    ['invested-01', 'Your investment has been noticed.'], ['invested-02', 'The Flames are growing.'],
    ['invested-03', 'Stoking them brings you closer.'], ['invested-04', 'Their power is taking shape.'],
  ],
  contribution: [
    ['contribution-01', 'At last, your Flames are proving themselves.'], ['contribution-02', 'The Inferno sees what your Flames can do.'],
    ['contribution-03', 'That power did not go unnoticed.'], ['contribution-04', 'Your Flames burned brighter this round.'],
  ],
} as const;

export function classifyInfernoTrend(readiness: number, previousReadiness: number | null): InfernoTrend {
  if (previousReadiness === null) return 'first';
  const delta = readiness - previousReadiness;
  return delta >= INFERNO_TREND_DEAD_ZONE ? 'improving'
    : delta <= -INFERNO_TREND_DEAD_ZONE ? 'worsening' : 'stable';
}

export function classifyInfernoWeakness(
  assets: readonly EngulfmentAssetRef[], readiness: number, state: Pick<GameState, 'dice'>,
): InfernoWeakness {
  if (readiness >= INFERNO_CLOSE_READINESS) return 'close';
  if (assets.length <= 1) return 'quantity';
  const averageInvestment = assets.reduce((sum, asset) => sum + (asset.kind === 'bonfire' ? 100
    : activeFlameInvestment(state.dice.find(die => die.id === asset.dieId)?.flame ?? null)), 0) / assets.length;
  return averageInvestment < 60 ? 'investment' : 'utilization';
}

type MessagePool = keyof typeof INFERNO_MESSAGE_POOLS;
function feedbackPool(weakness: InfernoWeakness, trend: InfernoTrend, recentAction: InfernoRecentAction): MessagePool {
  if (weakness === 'close') return trend === 'worsening' ? 'worsening' : 'close';
  if (trend === 'worsening') return 'worsening';
  if (trend === 'improving') {
    if (recentAction === 'flame_acquired') return 'acquired';
    if (recentAction === 'flame_invested' || recentAction === 'bonfire_created') return 'invested';
    return 'contribution';
  }
  if (trend === 'stable' && recentAction === 'flame_acquired' && weakness === 'quantity') return 'acquired';
  return trend === 'stable' && recentAction === 'none' ? weakness : weakness;
}

function deterministicHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function selectInfernoFeedback(seed: string, evaluationIndex: number, weakness: InfernoWeakness,
  trend: InfernoTrend, recentAction: InfernoRecentAction, recentMessageIds: readonly string[]): { id: string; text: string } {
  const category = feedbackPool(weakness, trend, recentAction);
  const pool = INFERNO_MESSAGE_POOLS[category];
  const eligible = pool.filter(([id]) => !recentMessageIds.includes(id));
  const candidates = eligible.length ? eligible : pool;
  const selected = candidates[deterministicHash(`${seed}:${evaluationIndex}:${category}`) % candidates.length];
  return { id: selected[0], text: selected[1] };
}

/** Freezes one authoritative whole-collection evaluation and strongest-first prefix plan. */
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
    investment: asset.kind === 'bonfire' ? 100
      : activeFlameInvestment(state.dice.find(die => die.id === asset.dieId)?.flame ?? null),
    hiddenStrength: evaluateEngulfmentOffering(state, [asset]).offeringMultiplier }));
  const strongestFirst = diagnostics.slice().sort((left, right) =>
    right.hiddenStrength - left.hiddenStrength || left.asset.instanceId - right.asset.instanceId).map(item => item.asset);
  const success = engulfmentSucceeds(full.offeringMultiplier);
  const maximumPossibleReadiness = maximumPossibleEngulfmentReadiness(state, assets);
  const currentCollectionTheoreticallySufficient = engulfmentSucceeds(maximumPossibleReadiness);
  const prefixEvaluations: InfernoEvaluationState['prefixEvaluations'] = [];
  let flamesSnuffed: EngulfmentAssetRef[] = [];
  let selectedEffectiveValue: number | null = null;
  if (success) for (let length = 1; length <= strongestFirst.length; length++) {
    const prefix = strongestFirst.slice(0, length);
    const prefixEvaluation = evaluateEngulfmentOffering(state, prefix);
    const prefixSuccess = engulfmentSucceeds(prefixEvaluation.offeringMultiplier);
    prefixEvaluations.push({ flameInstanceIds: prefix.map(asset => asset.instanceId),
      effectiveValue: prefixEvaluation.offeringMultiplier, success: prefixSuccess });
    if (prefixSuccess) {
      flamesSnuffed = prefix;
      selectedEffectiveValue = prefixEvaluation.offeringMultiplier;
      break;
    }
  }
  if (success && !flamesSnuffed.length) throw new Error('A successful Inferno evaluation has no successful strongest-first prefix.');
  const snuffedIds = new Set(flamesSnuffed.map(asset => asset.instanceId));
  const suspendAfterContinue = !success && !currentCollectionTheoreticallySufficient;
  const feedback = success ? null : suspendAfterContinue
    ? { id: 'inferno-suspended', text: INFERNO_SUSPENSION_MESSAGE }
    : selectInfernoFeedback(state.seed, evaluationIndex, weakness, trend, recentAction,
      state.infernoProgress.recentMessageIds);
  const normalization = engulfmentTrainingNormalization(state.handLevels);
  const infernoLevelBefore = state.engulfmentLevel;
  return {
    evaluationIndex, round: state.round, chapter: chapterNumberForRound(state.round), flames: diagnostics,
    evidenceRounds: full.evidenceRounds, effectiveValue: full.offeringMultiplier,
    threshold: ENGULFMENT_REQUIRED_MULTIPLIER, readiness, maximumPossibleReadiness,
    currentCollectionTheoreticallySufficient, suspendAfterContinue, previousReadiness, trend, weakness, recentAction,
    feedbackMessageId: feedback?.id ?? null, feedbackMessage: feedback?.text ?? null, engulfed: false, success,
    strongestFirst, prefixEvaluations, flamesSnuffed: structuredClone(flamesSnuffed),
    flamesPreserved: assets.filter(asset => !snuffedIds.has(asset.instanceId)).map(asset => structuredClone(asset)),
    selectedEffectiveValue, infernoLevelBefore, infernoLevelAfter: infernoLevelBefore + (success ? 1 : 0),
    infernoMultiplierBefore: infernoMultiplier(infernoLevelBefore),
    infernoMultiplierAfter: infernoMultiplier(infernoLevelBefore + (success ? 1 : 0)),
    upper: normalization.upper, lower: normalization.lower,
    consumedFinalFlame: success && flamesSnuffed.length === assets.length,
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
