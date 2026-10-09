import { chapterNumberForRound, chapterRoundForRound } from './chapters';
import { activeFlameId } from './flames';
import { ENHANCEMENTS } from './enhancements';
import { classifyRunHistoryV2Timelines } from './runHistoryV2Timeline';
import type {
  Enhancement, Flame, GoldSource, GoldSpendSource, HandId, Rarity, SpecialOfferType, GameState,
} from './types';
import type { RunHistoryV2Coverage, RunHistoryV2Event } from './runHistoryV2';

type Counts<Key extends string> = Partial<Record<Key, number>>;
type LargestHand = null | { round: number; attempt: number; hand: HandId; score: number; timelineId: number; abandoned: boolean };

export interface OfferImpressions {
  total: number;
  byRarity: Counts<Rarity>;
  bySource: Record<string, number>;
}

export interface LargestHandShareSummary {
  samples: number;
  median: number | null;
  p90: number | null;
  maximum: number | null;
  over50Percent: number;
  over80Percent: number;
}

export interface ExperiencedRunMetrics {
  roundsCleared: number;
  attempts: number;
  busts: number;
  bustsByChapter: Record<number, number>;
  livesLost: number;
  livesRestored: number;
  largestHand: LargestHand;
  largestCanonicalTimelineHand: LargestHand;
  highestRoundScore: number;
  highestClearedRoundScore: number;
  handUsage: Counts<HandId>;
  scoreByHand: Counts<HandId>;
  highestHandLevels: Counts<HandId>;
  goldEarnedBySource: Counts<GoldSource>;
  goldSpentByCategory: Counts<GoldSpendSource>;
  offerImpressions: Record<'enhancement' | 'flame' | 'special_offer', OfferImpressions>;
  enhancementPurchasesByRarity: Counts<Rarity>;
  trainingPurchases: number;
  trainingGoldSpent: number;
  individualTrainingGoldSpent: number;
  teamTrainingGoldSpent: number;
  vintageRevenue: number;
  shopRerollSpend: number;
  flameTimeline: { round: number; attempt: number; type: string; flame?: Flame; sacrificedFlame?: Flame; abandoned: boolean }[];
  flameActivations: Counts<Flame>;
  charge: { gains: number; arms: number; consumes: number; resets: number };
  specialOffers: Counts<SpecialOfferType>;
  probabilityChecks: Record<string, { checks: number; successes: number }>;
  hoodedOutcomes: Record<string, number>;
  bossOutcomes: Record<string, number>;
  largestHandShare: LargestHandShareSummary;
}

export interface CanonicalRunMetrics {
  outcome: 'active' | 'lost' | 'completed';
  finalChapter: number;
  finalRound: number;
  finalLocalRound: number;
  finalBoss: string | null;
  roundsCleared: number;
  finalGold: number;
  finalLives: number;
  finalHandLevels: Record<HandId, number>;
  scoreByHand: Counts<HandId>;
  highestClearedRoundScore: number;
  goldEarnedBySource: Record<GoldSource, number>;
  goldSpentByCategory: Record<GoldSpendSource, number>;
  retainedEnhancements: { dieId: number; side: number; rank: number; enhancements: Partial<Record<Enhancement, number>> }[];
  currentEmbers: { dieId: number; flame: Flame; investedGold: number }[];
  bonfires: Flame[];
  wildfires: GameState['wildfires'];
  sacrificedFlames: Flame[];
  retainedPurchases: number;
  retainedTrainingPurchases: number;
  trainingGoldSpent: { individual: number; team: number };
  retainedOffers: { enhancements: { enhancement: Enhancement; rarity: Rarity }[]; training: number };
}

export interface RunHistoryV2Summary {
  identity: { schemaVersion: number | null; ruleset: string | null; seed: string | null };
  coverage: RunHistoryV2Coverage & { metricsComplete: boolean };
  timelines: { count: number; abandonedRanges: ReturnType<typeof classifyRunHistoryV2Timelines>['ranges'] };
  experienced: ExperiencedRunMetrics;
  canonical: CanonicalRunMetrics;
}

const add = <Key extends string>(record: Counts<Key>, key: Key, amount: number) => {
  record[key] = (record[key] ?? 0) + amount;
};
const emptyOffers = (): OfferImpressions => ({ total: 0, byRarity: {}, bySource: {} });
const percentile = (values: number[], position: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(position * sorted.length) - 1))];
};

function initialExperienced(): ExperiencedRunMetrics {
  return {
    roundsCleared: 0, attempts: 0, busts: 0, bustsByChapter: {}, livesLost: 0, livesRestored: 0,
    largestHand: null, largestCanonicalTimelineHand: null, highestRoundScore: 0, highestClearedRoundScore: 0,
    handUsage: {}, scoreByHand: {}, highestHandLevels: {}, goldEarnedBySource: {}, goldSpentByCategory: {},
    offerImpressions: { enhancement: emptyOffers(), flame: emptyOffers(), special_offer: emptyOffers() },
    enhancementPurchasesByRarity: {}, trainingPurchases: 0, trainingGoldSpent: 0,
    individualTrainingGoldSpent: 0, teamTrainingGoldSpent: 0, vintageRevenue: 0,
    shopRerollSpend: 0, flameTimeline: [], flameActivations: {},
    charge: { gains: 0, arms: 0, consumes: 0, resets: 0 }, specialOffers: {}, probabilityChecks: {},
    hoodedOutcomes: {}, bossOutcomes: {},
    largestHandShare: { samples: 0, median: null, p90: null, maximum: null, over50Percent: 0, over80Percent: 0 },
  };
}

function canonicalFromState(state: GameState | undefined, events: readonly RunHistoryV2Event[],
  coverage: RunHistoryV2Coverage): CanonicalRunMetrics {
  const canonical = classifyRunHistoryV2Timelines(events, coverage).canonicalEvents();
  const finished = [...canonical].reverse().find(event => event.kind === 'run_finished');
  const finalRound = state?.round ?? finished?.round ?? events.at(-1)?.round ?? 1;
  const cleared = canonical.filter((event): event is Extract<RunHistoryV2Event, { kind: 'round_attempt_finished' }> =>
    event.kind === 'round_attempt_finished' && event.outcome === 'cleared');
  const scoreByHand: Counts<HandId> = {};
  const earned: Record<GoldSource, number> = { golden: 0, jackpot: 0, enhancementSale: 0, roundBase: 0,
    unusedRerolls: 0, interest: 0, bossReward: 0, specialOffer: 0, cashBonus: 0 };
  const spent: Record<GoldSpendSource, number> = { enhancement: 0, shopDiceReroll: 0, enhancementReroll: 0,
    handTraining: 0, flameInvestment: 0, lifeRestore: 0 };
  let retainedPurchases = 0;
  let retainedTrainingPurchases = 0;
  let individualTraining = 0;
  let teamTraining = 0;
  for (const event of canonical) {
    if (event.kind === 'hand_scored') add(scoreByHand, event.hand, event.score.awarded);
    if (event.kind !== 'shop_transaction') continue;
    const transaction = event.transaction;
    if (transaction.type === 'gold_earned') earned[transaction.source] += transaction.amount;
    if (transaction.type === 'round_payout') for (const [source, amount] of Object.entries(transaction.sources) as [GoldSource, number][])
      earned[source] += amount;
    if (transaction.type === 'gold_spent') spent[transaction.source] += transaction.amount;
    if (transaction.type === 'enhancement_purchased') retainedPurchases++;
    if (transaction.type === 'training') {
      retainedTrainingPurchases++;
      if (transaction.hand === 'all') teamTraining += transaction.cost;
      else individualTraining += transaction.cost;
    }
  }
  return {
    outcome: finished?.kind === 'run_finished' ? finished.outcome : state?.phase === 'lost' ? 'lost' : 'active',
    finalChapter: chapterNumberForRound(finalRound), finalRound, finalLocalRound: chapterRoundForRound(finalRound),
    finalBoss: state?.boss?.type ?? (finished?.kind === 'run_finished' ? finished.finalBoss : null),
    roundsCleared: cleared.length,
    finalGold: state?.gold ?? 0, finalLives: state?.lives ?? 0,
    finalHandLevels: structuredClone(state?.handLevels ?? (finished?.kind === 'run_finished' ? finished.finalHandLevels : {})) as Record<HandId, number>,
    scoreByHand,
    highestClearedRoundScore: Math.max(0, ...cleared.map(round => round.score)),
    goldEarnedBySource: earned,
    goldSpentByCategory: spent,
    retainedEnhancements: state?.dice.filter(die => die.owner === 'player').flatMap(die => die.faces.flatMap((face, index) =>
      Object.keys(face.enhancements).length ? [{ dieId: die.id, side: index + 1, rank: face.rank,
        enhancements: structuredClone(face.enhancements) }] : [])) ?? [],
    currentEmbers: state?.dice.flatMap(die => {
      const flame = activeFlameId(die.flame);
      return die.owner === 'player' && flame ? [{ dieId: die.id, flame, investedGold: die.flame?.investedGold ?? 0 }] : [];
    }) ?? [],
    bonfires: [...(state?.bonfires ?? [])], wildfires: structuredClone(state?.wildfires ?? []),
    sacrificedFlames: (state?.wildfires ?? []).map(item => item.sacrificedFlame),
    retainedPurchases, retainedTrainingPurchases,
    trainingGoldSpent: { individual: individualTraining, team: teamTraining },
    retainedOffers: {
      enhancements: state?.shop?.offers.filter(offer => !offer.purchased).map(offer => ({ enhancement: offer.enhancement,
        rarity: ENHANCEMENTS[offer.enhancement].rarity })) ?? [],
      training: state?.shop?.trainingOffers.length ?? 0,
    },
  };
}

export function summarizeRunHistoryV2(events: readonly RunHistoryV2Event[], state?: GameState,
  coverage: RunHistoryV2Coverage = state?.historyV2Coverage ?? { complete: true, firstRound: 1, firstActionId: 0, firstSeq: 0 }): RunHistoryV2Summary {
  const experienced = initialExperienced();
  const classification = classifyRunHistoryV2Timelines(events, coverage);
  const start = events.find(event => event.kind === 'run_started');
  const handMaxByAttempt = new Map<string, number>();
  for (const event of events) {
    const abandoned = !classification.isCanonical(event);
    const attemptKey = `${event.timelineId}:${event.round}:${event.attempt}`;
    switch (event.kind) {
      case 'round_attempt_started': experienced.attempts++; break;
      case 'hand_scored': {
        add(experienced.handUsage, event.hand, 1); add(experienced.scoreByHand, event.hand, event.score.awarded);
        experienced.highestHandLevels[event.hand] = Math.max(experienced.highestHandLevels[event.hand] ?? 0, event.level);
        const candidate: NonNullable<LargestHand> = { round: event.round, attempt: event.attempt, hand: event.hand,
          score: event.score.awarded, timelineId: event.timelineId, abandoned };
        if (!experienced.largestHand || candidate.score > experienced.largestHand.score) experienced.largestHand = candidate;
        if (!abandoned && (!experienced.largestCanonicalTimelineHand || candidate.score > experienced.largestCanonicalTimelineHand.score))
          experienced.largestCanonicalTimelineHand = candidate;
        handMaxByAttempt.set(attemptKey, Math.max(handMaxByAttempt.get(attemptKey) ?? 0, event.score.awarded));
        for (const check of event.checks) {
          const totals = experienced.probabilityChecks[check.source] ??= { checks: 0, successes: 0 };
          totals.checks++; if (check.succeeded) totals.successes++;
        }
        for (const effect of event.sideEffects) {
          if (effect.type === 'gold') add(experienced.goldEarnedBySource, effect.source, effect.amount);
          if (effect.type === 'flame_activation') add(experienced.flameActivations, effect.flame, 1);
          if (effect.type === 'charge') {
            if (effect.operation === 'gain') experienced.charge.gains += Math.max(0, effect.after - effect.before);
            else if (effect.operation === 'arm') experienced.charge.arms++;
            else if (effect.operation === 'consume_reset') experienced.charge.consumes++;
          }
        }
        for (const contribution of event.xMultContributions)
          if (contribution.sourceId !== 'charge' && ['ember', 'bonfire', 'wildfire'].includes(contribution.origin))
            add(experienced.flameActivations, contribution.sourceId as Flame, 1);
        break;
      }
      case 'round_attempt_finished': {
        experienced.highestRoundScore = Math.max(experienced.highestRoundScore, event.score);
        if (event.outcome === 'cleared') {
          experienced.roundsCleared++;
          experienced.highestClearedRoundScore = Math.max(experienced.highestClearedRoundScore, event.score);
          const largest = handMaxByAttempt.get(attemptKey) ?? 0;
          if (event.score > 0) {
            const share = largest / event.score;
            const shares = (experienced.largestHandShare as LargestHandShareSummary & { values?: number[] }).values ??= [];
            shares.push(share);
          }
        } else {
          experienced.busts++;
          const chapter = chapterNumberForRound(event.round);
          experienced.bustsByChapter[chapter] = (experienced.bustsByChapter[chapter] ?? 0) + 1;
          experienced.livesLost += Math.max(0, event.livesBefore - event.livesAfter);
        }
        break;
      }
      case 'shop_offers_presented': {
        const pool = experienced.offerImpressions[event.pool];
        for (const offer of event.offers) { pool.total++; add(pool.byRarity, offer.rarity, 1); }
        pool.bySource[event.reason] = (pool.bySource[event.reason] ?? 0) + event.offers.length;
        break;
      }
      case 'shop_transaction': {
        const transaction = event.transaction;
        if (transaction.type === 'gold_earned') add(experienced.goldEarnedBySource, transaction.source, transaction.amount);
        if (transaction.type === 'round_payout') for (const [source, amount] of Object.entries(transaction.sources) as [GoldSource, number][])
          add(experienced.goldEarnedBySource, source, amount);
        if (transaction.type === 'gold_spent') {
          add(experienced.goldSpentByCategory, transaction.source, transaction.amount);
          if (transaction.source === 'shopDiceReroll' || transaction.source === 'enhancementReroll') experienced.shopRerollSpend += transaction.amount;
        }
        if (transaction.type === 'enhancement_purchased') add(experienced.enhancementPurchasesByRarity, transaction.rarity, 1);
        if (transaction.type === 'enhancement_sold' && transaction.enhancement === 'vintage') experienced.vintageRevenue += transaction.proceeds;
        if (transaction.type === 'training') {
          experienced.trainingPurchases++; experienced.trainingGoldSpent += transaction.cost;
          if (transaction.hand === 'all') experienced.teamTrainingGoldSpent += transaction.cost;
          else experienced.individualTrainingGoldSpent += transaction.cost;
        }
        if (transaction.type === 'life_restored') experienced.livesRestored += transaction.livesAfter - transaction.livesBefore;
        if (transaction.type === 'special_offer_selected') add(experienced.specialOffers, transaction.offer, 1);
        break;
      }
      case 'flame_changed': {
        const change = event.change;
        experienced.flameTimeline.push({ round: event.round, attempt: event.attempt, type: change.type, abandoned,
          ...('flame' in change ? { flame: change.flame } : {}),
          ...('sacrificedFlame' in change ? { sacrificedFlame: change.sacrificedFlame } : {}) });
        if (change.type === 'activated') add(experienced.flameActivations, change.flame, 1);
        break;
      }
      case 'charge_changed':
        if (event.operation === 'gain') experienced.charge.gains += Math.max(0, event.after - event.before);
        else if (event.operation === 'arm') experienced.charge.arms++;
        else if (event.operation === 'consume_reset') experienced.charge.consumes++;
        else if (event.operation === 'round_reset') experienced.charge.resets++;
        break;
      case 'hooded_challenge_changed': add(experienced.hoodedOutcomes, event.change, 1); break;
      case 'boss_state_changed': add(experienced.bossOutcomes, `${event.boss}:${event.change}`, 1); break;
    }
  }
  const shares = ((experienced.largestHandShare as LargestHandShareSummary & { values?: number[] }).values ?? []);
  experienced.largestHandShare = { samples: shares.length, median: percentile(shares, .5), p90: percentile(shares, .9),
    maximum: shares.length ? Math.max(...shares) : null,
    over50Percent: shares.filter(share => share > .5).length, over80Percent: shares.filter(share => share > .8).length };
  return {
    identity: { schemaVersion: start?.kind === 'run_started' ? start.schemaVersion : null,
      ruleset: start?.kind === 'run_started' ? start.ruleset : null,
      seed: start?.kind === 'run_started' ? start.seed : state?.seed ?? null },
    coverage: { ...coverage, metricsComplete: coverage.complete },
    timelines: { count: Math.max(1, classification.timelineIds.length), abandonedRanges: classification.ranges },
    experienced,
    canonical: canonicalFromState(state, events, coverage),
  };
}

export const V2_SUMMARY_RUNSTATS_DEPENDENCIES = [
  'decision-time distributions',
  'detailed standalone and Boss score attribution',
  'specialist probability and trigger telemetry',
] as const;
