import { chapterNumberForRound } from './chapters';
import { activeFlameId, currentFlameInstanceId } from './flames';
import { LOWER_HAND_IDS, UPPER_HAND_IDS } from './hands';
import { canonicalRunHistoryV2Events } from './runHistoryV2Timeline';
import { finalizeScore, infernoMultiplier, INFERNO_BASE, scoreWeightedMultiplier } from './scoring';
import type { EngulfmentEvidenceRoundTelemetry, EngulfmentOfferingTelemetry, HandScoredEvent } from './runHistoryV2';
import type { Board, EngulfmentAssetRef, GameState, HandId, HandLevels } from './types';

export const ENGULFMENT_EVIDENCE_ROUNDS = 6;
export const ENGULFMENT_REQUIRED_MULTIPLIER = 20;
export { infernoMultiplier, INFERNO_BASE };

export const engulfmentAssetKey = (asset: EngulfmentAssetRef): string => asset.kind === 'ember'
  ? `ember:${asset.instanceId}:${asset.flame}:${asset.dieId}`
  : `${asset.kind}:${asset.instanceId}:${asset.flame}`;

export function ownedEngulfmentAssets(state: Pick<Board, 'dice' | 'bonfires' | 'wildfires' | 'flameInstanceIds'>): EngulfmentAssetRef[] {
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
    ...state.wildfires.flatMap(item => {
      const instanceId = currentFlameInstanceId(state, item.flame);
      return instanceId === null ? [] : [{ kind: 'wildfire' as const, flame: item.flame, instanceId }];
    }),
  ];
}

export const engulfmentAvailable = (state: Pick<Board, 'phase' | 'shop' | 'bonfires' | 'wildfires'>): boolean =>
  state.phase === 'shop' && !!state.shop && !state.shop.engulfmentAttemptUsed
  && (state.bonfires.length > 0 || state.wildfires.length > 0);

export const engulfmentHasQuestWarning = (state: Pick<Board, 'round' | 'hoodedFigure'>): boolean => {
  const quest = state.hoodedFigure.active;
  return !!quest && !quest.complete && quest.issuedChapter === chapterNumberForRound(state.round);
};

export const engulfmentSucceeds = (offeringMultiplier: number): boolean =>
  offeringMultiplier >= ENGULFMENT_REQUIRED_MULTIPLIER;

function attemptKey(event: { timelineId: number; round: number; attempt: number }): string {
  return `${event.timelineId}:${event.round}:${event.attempt}`;
}

/** Resolved local factor supplied by all selected Flame instances together. */
export function selectedOfferingFactor(event: HandScoredEvent, selectedInstanceIds: ReadonlySet<number>): number {
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

export function offeringHandObservation(event: HandScoredEvent, selectedInstanceIds: ReadonlySet<number>): { factor: number; weight: number } {
  const resolvedFactor = selectedOfferingFactor(event, selectedInstanceIds);
  const counterfactualScore = resolvedFactor > 1
    ? finalizeScore(event.score.finalPips, event.score.finalMult,
      (event.score.finalXMult / resolvedFactor) * event.score.bossFactor, event.score.infernoMultiplier ?? 1).finalScore
    : event.score.awarded;
  const factor = counterfactualScore > 0
    ? Math.max(1, event.score.awarded / counterfactualScore) : 1;
  return { factor, weight: Math.max(0, counterfactualScore) };
}

export interface EngulfmentOfferingEvaluation {
  offerings: EngulfmentOfferingTelemetry[];
  evidenceRounds: EngulfmentEvidenceRoundTelemetry[];
  offeringMultiplier: number;
}

/**
 * Evaluates the selected Flame instances jointly over the six most recent
 * canonical clears: score-weighted within each Round, then equal-weighted
 * across Rounds.
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

export interface EngulfmentAnimationProfile {
  success: boolean;
  strength: 'very_weak' | 'moderate' | 'near' | 'bare' | 'strong' | 'massive';
  peakPercent: number;
  durationMs: number;
}

export function engulfmentAnimationProfile(offeringMultiplier: number): EngulfmentAnimationProfile {
  const progress = Math.max(0, offeringMultiplier) / ENGULFMENT_REQUIRED_MULTIPLIER;
  const success = progress >= 1;
  const strength = progress < .45 ? 'very_weak' : progress < .9 ? 'moderate' : progress < 1 ? 'near'
    : progress < 1.2 ? 'bare' : progress < 1.75 ? 'strong' : 'massive';
  const durationMs = strength === 'near' ? 4000 : strength === 'bare' ? 3800
    : strength === 'moderate' ? 2700 : strength === 'very_weak' ? 2100 : strength === 'strong' ? 2300 : 1400;
  return { success, strength, peakPercent: success ? 100 : Math.min(99, progress * 100), durationMs };
}

export function infernoRoman(level: number): string {
  if (level <= 0) return '0';
  const values: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let remaining = Math.floor(level);
  let result = '';
  for (const [value, symbol] of values) while (remaining >= value) { result += symbol; remaining -= value; }
  return result;
}
