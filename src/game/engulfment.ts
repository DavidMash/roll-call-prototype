import { activeFlameId } from './flames';
import { chapterNumberForRound } from './chapters';
import { LOWER_HAND_IDS, UPPER_HAND_IDS } from './hands';
import { canonicalRunHistoryV2Events } from './runHistoryV2Timeline';
import { infernoMultiplier, INFERNO_BASE } from './scoring';
import type { EngulfmentOfferingTelemetry, HandScoredEvent } from './runHistoryV2';
import type { Board, EngulfmentAssetRef, Flame, GameState, HandId, HandLevels } from './types';

export const ENGULFMENT_REQUIRED_FUEL = 100;
export { infernoMultiplier, INFERNO_BASE };

export const engulfmentAssetKey = (asset: EngulfmentAssetRef): string => asset.kind === 'ember'
  ? `ember:${asset.dieId}:${asset.flame}` : `${asset.kind}:${asset.flame}`;

export function ownedEngulfmentAssets(state: Pick<Board, 'dice' | 'bonfires' | 'wildfires'>): EngulfmentAssetRef[] {
  return [
    ...state.dice.filter(die => die.owner === 'player' && activeFlameId(die.flame) !== null)
      .map(die => ({ kind: 'ember' as const, flame: activeFlameId(die.flame)!, dieId: die.id })),
    ...state.bonfires.map(flame => ({ kind: 'bonfire' as const, flame })),
    ...state.wildfires.map(item => ({ kind: 'wildfire' as const, flame: item.flame })),
  ];
}

export const engulfmentAvailable = (state: Pick<Board, 'phase' | 'shop' | 'bonfires' | 'wildfires'>): boolean =>
  state.phase === 'shop' && !!state.shop && !state.shop.engulfmentAttemptUsed
  && (state.bonfires.length > 0 || state.wildfires.length > 0);

export const engulfmentHasQuestWarning = (state: Pick<Board, 'round' | 'hoodedFigure'>): boolean => {
  const quest = state.hoodedFigure.active;
  return !!quest && !quest.complete && quest.issuedChapter === chapterNumberForRound(state.round);
};

export function engulfmentImportance(contribution: number, totalContribution: number): number {
  if (totalContribution <= 0 || contribution <= 0) return 0;
  return Math.min(1, Math.max(0, (contribution / totalContribution) / 0.35));
}

export function engulfmentFuel(kind: EngulfmentAssetRef['kind'], investment: number, importance: number): number {
  const normalizedImportance = Math.min(1, Math.max(0, importance));
  if (kind === 'ember') return Math.round(20 * Math.min(1, Math.max(0, investment / 100)) + 10 * normalizedImportance);
  if (kind === 'bonfire') return Math.round(35 + 25 * normalizedImportance);
  return Math.round(70 + 40 * normalizedImportance);
}

export const engulfmentSucceeds = (totalFuel: number): boolean => totalFuel >= ENGULFMENT_REQUIRED_FUEL;

function attemptKey(event: { timelineId: number; round: number; attempt: number }): string {
  return `${event.timelineId}:${event.round}:${event.attempt}`;
}

function counterfactualContribution(event: HandScoredEvent, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 1) return 0;
  return Math.max(0, event.score.awarded - Math.round(event.score.raw / factor));
}

/**
 * Extends the Hooded/Wildfire score-without-factor semantics over the last six
 * canonical cleared rounds. Shared Charge is split through its frozen producer
 * attribution, so generation matters only when that Charge later scores.
 */
export function recentFlameContributions(state: Pick<GameState, 'historyV2' | 'historyV2Coverage' | 'dice' | 'bonfires' | 'wildfires'>): Partial<Record<Flame, number>> {
  const canonical = canonicalRunHistoryV2Events(state.historyV2, state.historyV2Coverage);
  const cleared = canonical.filter(event => event.kind === 'round_attempt_finished' && event.outcome === 'cleared').slice(-6);
  const retainedAttempts = new Set(cleared.map(attemptKey));
  const owned = new Set(ownedEngulfmentAssets(state).map(asset => asset.flame));
  const contributions: Partial<Record<Flame, number>> = {};
  for (const event of canonical) {
    if (event.kind !== 'hand_scored' || !retainedAttempts.has(attemptKey(event))) continue;
    for (const item of event.xMultContributions) {
      if (item.sourceId === 'charge') {
        for (const source of item.chargeSources ?? []) if (owned.has(source.flame))
          contributions[source.flame] = (contributions[source.flame] ?? 0) + counterfactualContribution(event, source.factor);
      } else if (item.sourceId in contributions || owned.has(item.sourceId as Flame)) {
        const flame = item.sourceId as Flame;
        if (owned.has(flame)) contributions[flame] = (contributions[flame] ?? 0) + counterfactualContribution(event, item.factor);
      }
    }
  }
  return contributions;
}

export function valueEngulfmentOffering(state: Pick<GameState, 'historyV2' | 'historyV2Coverage' | 'dice' | 'bonfires' | 'wildfires'>,
  assets: readonly EngulfmentAssetRef[]): EngulfmentOfferingTelemetry[] {
  const contributionByFlame = recentFlameContributions(state);
  const ownedFlames = new Set(ownedEngulfmentAssets(state).map(asset => asset.flame));
  const totalContribution = [...ownedFlames].reduce((sum, flame) => sum + (contributionByFlame[flame] ?? 0), 0);
  return assets.map(asset => {
    const contribution = contributionByFlame[asset.flame] ?? 0;
    const contributionShare = totalContribution > 0 ? contribution / totalContribution : 0;
    const importance = engulfmentImportance(contribution, totalContribution);
    const investment = asset.kind === 'ember'
      ? state.dice.find(die => die.id === asset.dieId && activeFlameId(die.flame) === asset.flame)?.flame?.investedGold ?? 0
      : 100;
    return { asset: structuredClone(asset), investment, recentContribution: contribution,
      contributionShare, importance, fuel: engulfmentFuel(asset.kind, investment, importance) };
  });
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

export function engulfmentAnimationProfile(totalFuel: number): EngulfmentAnimationProfile {
  const fuel = Math.max(0, totalFuel);
  const success = engulfmentSucceeds(fuel);
  const strength = fuel < 45 ? 'very_weak' : fuel < 90 ? 'moderate' : fuel < 100 ? 'near'
    : fuel < 120 ? 'bare' : fuel < 175 ? 'strong' : 'massive';
  return {
    success,
    strength,
    peakPercent: success ? 100 : Math.min(99, fuel),
    durationMs: Math.round(Math.min(4000, Math.max(850, 4600 - fuel * 22))),
  };
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
