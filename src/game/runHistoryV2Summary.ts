import { chapterNumberForRound, chapterRoundForRound } from './chapters';
import { classifyRunHistoryV2Timelines } from './runHistoryV2Timeline';
import { infernoMultiplier } from './scoring';
import { ownedDice } from './inventory';
import { HAND_IDS } from './hands';
import type {
  DiceRarity, DieEffectInstance, Flame, FlameInstance, GoldSource, GoldSpendSource, HandId, SpecialDieType, SpecialOfferType,
  TemperSource, TemperSpendSource, GameState,
} from './types';
import type { RunHistoryV2Coverage, RunHistoryV2Event } from './runHistoryV2';
import { exactRatioNumber, scoreMax, type ExactScore } from './scoreMath';

type Counts<Key extends string> = Partial<Record<Key, number>>;
type ScoreCounts<Key extends string> = Partial<Record<Key, ExactScore>>;
type LargestHand = null | { round: number; attempt: number; hand: HandId; score: ExactScore; timelineId: number; abandoned: boolean };

export interface OfferImpressions {
  total: number;
  byRarity: Counts<DiceRarity>;
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
  highestRoundScore: ExactScore;
  highestClearedRoundScore: ExactScore;
  handUsage: Counts<HandId>;
  scoreByHand: ScoreCounts<HandId>;
  highestHandLevels: Counts<HandId>;
  goldEarnedBySource: Counts<GoldSource>;
  goldSpentByCategory: Counts<GoldSpendSource>;
  offerImpressions: Record<'dice' | 'flame' | 'special_offer', OfferImpressions>;
  trainingPurchases: number;
  trainingGoldSpent: number;
  individualTrainingGoldSpent: number;
  trainingByHand: Partial<Record<HandId, { purchases: number; goldSpent: number; waived: number;
    catchUpPurchases: number; relativeTierTotal: number; maximumRelativeTier: number; maximumNormalPrice: number }>>;
  diceEconomy: {
    purchases: number; sales: number; moves: number; fusions: number; purchaseGold: number; saleGold: number;
    byType: Partial<Record<SpecialDieType, { purchased: number; sold: number; fused: number }>>;
  };
  specialDice: Partial<Record<SpecialDieType, { activations: number; invocationsSpent: number;
    commandUses: number; scoreOccurrences: number; additionalScores: number }>>;
  shopRerollSpend: number;
  temperEarned: number;
  temperSpent: number;
  temperBySource: Counts<TemperSource>;
  temperSpentBySource: Counts<TemperSpendSource>;
  flameTimeline: { round: number; attempt: number; type: string; flame?: Flame; abandoned: boolean }[];
  flameActivations: Counts<Flame>;
  flameLifecycle: { acquired: number; replaced: number; stokedGold: number; bonfires: number; engulfed: number };
  charge: { gains: number; arms: number; consumes: number; resets: number };
  specialOffers: Counts<SpecialOfferType>;
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
  finalTemper: number;
  finalLives: number;
  infernoLevel: number;
  infernoMultiplier: ExactScore;
  finalHandLevels: Record<HandId, number>;
  scoreByHand: ScoreCounts<HandId>;
  highestClearedRoundScore: ExactScore;
  goldEarnedBySource: Record<GoldSource, number>;
  goldSpentByCategory: Record<GoldSpendSource, number>;
  ownedDice: { dieId: number; effects: DieEffectInstance[];
    rosterSlot: number | null; storageSlot: number | null }[];
  flameSlots: Array<{ slot: number; flame: FlameInstance }>;
  retainedPurchases: number;
  retainedTrainingPurchases: number;
  trainingGoldSpent: number;
  retainedOffers: { dice: { dieType: SpecialDieType; rarity: DiceRarity; price: number }[]; trainableHands: number };
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
const addScore = <Key extends string>(record: ScoreCounts<Key>, key: Key, amount: ExactScore) => {
  record[key] = (record[key] ?? 0n) + amount;
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
    largestHand: null, largestCanonicalTimelineHand: null, highestRoundScore: 0n, highestClearedRoundScore: 0n,
    handUsage: {}, scoreByHand: {}, highestHandLevels: {}, goldEarnedBySource: {}, goldSpentByCategory: {},
    offerImpressions: { dice: emptyOffers(), flame: emptyOffers(), special_offer: emptyOffers() },
    trainingPurchases: 0, trainingGoldSpent: 0,
    individualTrainingGoldSpent: 0,
    trainingByHand: {},
    diceEconomy: { purchases: 0, sales: 0, moves: 0, fusions: 0, purchaseGold: 0, saleGold: 0, byType: {} },
    specialDice: {},
    shopRerollSpend: 0, temperEarned: 0, temperSpent: 0, temperBySource: {}, temperSpentBySource: {},
    flameTimeline: [], flameActivations: {},
    flameLifecycle: { acquired: 0, replaced: 0, stokedGold: 0, bonfires: 0, engulfed: 0 },
    charge: { gains: 0, arms: 0, consumes: 0, resets: 0 }, specialOffers: {},
    bossOutcomes: {},
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
  const scoreByHand: ScoreCounts<HandId> = {};
  const earned: Record<GoldSource, number> = { golden: 0, jackpot: 0, diceSale: 0, roundBase: 0,
    unusedRerolls: 0, interest: 0, bossReward: 0, specialOffer: 0 };
  const spent: Record<GoldSpendSource, number> = { dicePurchase: 0, diceOfferReroll: 0,
    handTraining: 0, flameInvestment: 0, lifeRestore: 0, furnace: 0, greaseTheEngine: 0 };
  let retainedPurchases = 0;
  let retainedTrainingPurchases = 0;
  let individualTraining = 0;
  for (const event of canonical) {
    if (event.kind === 'hand_scored') addScore(scoreByHand, event.hand, event.score.awarded);
    if (event.kind !== 'shop_transaction') continue;
    const transaction = event.transaction;
    if (transaction.type === 'gold_earned') earned[transaction.source] += transaction.amount;
    if (transaction.type === 'round_payout') for (const [source, amount] of Object.entries(transaction.sources) as [GoldSource, number][])
      earned[source] += amount;
    if (transaction.type === 'gold_spent') spent[transaction.source] += transaction.amount;
    if (transaction.type === 'dice_purchased') retainedPurchases++;
    if (transaction.type === 'training') {
      retainedTrainingPurchases++;
      individualTraining += transaction.cost;
    }
  }
  return {
    outcome: finished?.kind === 'run_finished' ? finished.outcome : state?.phase === 'lost' ? 'lost' : 'active',
    finalChapter: chapterNumberForRound(finalRound), finalRound, finalLocalRound: chapterRoundForRound(finalRound),
    finalBoss: state?.boss?.type ?? (finished?.kind === 'run_finished' ? finished.finalBoss : null),
    roundsCleared: cleared.length,
    finalGold: state?.gold ?? 0, finalTemper: state?.temper ?? 0, finalLives: state?.lives ?? 0,
    infernoLevel: state?.engulfmentLevel ?? 0, infernoMultiplier: infernoMultiplier(state?.engulfmentLevel ?? 0),
    finalHandLevels: structuredClone(state?.handLevels ?? (finished?.kind === 'run_finished' ? finished.finalHandLevels : {})) as Record<HandId, number>,
    scoreByHand,
    highestClearedRoundScore: cleared.reduce((highest, round) => round.score > highest ? round.score : highest, 0n),
    goldEarnedBySource: earned,
    goldSpentByCategory: spent,
    ownedDice: state ? ownedDice(state).map(die => ({ dieId: die.id, effects: structuredClone(die.effects),
      rosterSlot: state.diceInventory.roster.indexOf(die.id) >= 0 ? state.diceInventory.roster.indexOf(die.id) : null,
      storageSlot: state.diceInventory.storage.indexOf(die.id) >= 0 ? state.diceInventory.storage.indexOf(die.id) : null })) : [],
    flameSlots: state ? state.flameSlots.flatMap((flame, slot) => flame ? [{ slot, flame: structuredClone(flame) }] : []) : [],
    retainedPurchases, retainedTrainingPurchases,
    trainingGoldSpent: individualTraining,
    retainedOffers: {
      dice: state?.shop?.offers.filter(offer => !offer.purchased).map(offer => ({ dieType: offer.dieType,
        rarity: offer.rarity, price: offer.price })) ?? [],
      trainableHands: state?.shop ? HAND_IDS.length : 0,
    },
  };
}

export function summarizeRunHistoryV2(events: readonly RunHistoryV2Event[], state?: GameState,
  coverage: RunHistoryV2Coverage = state?.historyV2Coverage ?? { complete: true, firstRound: 1, firstActionId: 0, firstSeq: 0 }): RunHistoryV2Summary {
  const experienced = initialExperienced();
  const classification = classifyRunHistoryV2Timelines(events, coverage);
  const start = events.find(event => event.kind === 'run_started');
  const handMaxByAttempt = new Map<string, ExactScore>();
  for (const event of events) {
    const abandoned = !classification.isCanonical(event);
    const attemptKey = `${event.timelineId}:${event.round}:${event.attempt}`;
    switch (event.kind) {
      case 'round_attempt_started': experienced.attempts++; break;
      case 'hand_scored': {
        add(experienced.handUsage, event.hand, 1); addScore(experienced.scoreByHand, event.hand, event.score.awarded);
        experienced.highestHandLevels[event.hand] = Math.max(experienced.highestHandLevels[event.hand] ?? 0, event.level);
        const candidate: NonNullable<LargestHand> = { round: event.round, attempt: event.attempt, hand: event.hand,
          score: event.score.awarded, timelineId: event.timelineId, abandoned };
        if (!experienced.largestHand || candidate.score > experienced.largestHand.score) experienced.largestHand = candidate;
        if (!abandoned && (!experienced.largestCanonicalTimelineHand || candidate.score > experienced.largestCanonicalTimelineHand.score))
          experienced.largestCanonicalTimelineHand = candidate;
        handMaxByAttempt.set(attemptKey, scoreMax(handMaxByAttempt.get(attemptKey) ?? 0n, event.score.awarded));
        for (const effect of event.sideEffects) {
          if (effect.type === 'gold') add(experienced.goldEarnedBySource, effect.source, effect.amount);
          if (effect.type === 'charge') {
            if (effect.operation === 'gain') experienced.charge.gains += Math.max(0, effect.after - effect.before);
            else if (effect.operation === 'arm') experienced.charge.arms++;
            else if (effect.operation === 'consume_reset') experienced.charge.consumes++;
          }
        }
        for (const occurrence of event.scoreOccurrences) {
          const effects = event.scoringDice.find(die => die.dieId === occurrence.dieId)?.effects ?? [];
          for (const effect of effects) {
            const metric = experienced.specialDice[effect.type] ??= {
              activations: 0, invocationsSpent: 0, commandUses: 0, scoreOccurrences: 0, additionalScores: 0 };
            metric.scoreOccurrences++;
            if (occurrence.additional) metric.additionalScores++;
          }
        }
        break;
      }
      case 'special_die_activated': {
        const metric = experienced.specialDice[event.dieType] ??= {
          activations: 0, invocationsSpent: 0, commandUses: 0, scoreOccurrences: 0, additionalScores: 0 };
        metric.activations++;
        metric.invocationsSpent += Math.max(0, (event.invocationBefore ?? 0) - (event.invocationAfter ?? event.invocationBefore ?? 0));
        if (event.context === 'command') metric.commandUses++;
        break;
      }
      case 'round_attempt_finished': {
        experienced.highestRoundScore = scoreMax(experienced.highestRoundScore, event.score);
        if (event.outcome === 'cleared') {
          experienced.roundsCleared++;
          experienced.highestClearedRoundScore = scoreMax(experienced.highestClearedRoundScore, event.score);
          const largest = handMaxByAttempt.get(attemptKey) ?? 0n;
          if (event.score > 0n) {
            const share = exactRatioNumber(largest, event.score);
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
          if (transaction.source === 'diceOfferReroll')
            experienced.shopRerollSpend += transaction.amount;
        }
        if (transaction.type === 'training') {
          experienced.trainingPurchases++; experienced.trainingGoldSpent += transaction.cost;
          experienced.individualTrainingGoldSpent += transaction.cost;
          const metric = experienced.trainingByHand[transaction.hand] ??= { purchases: 0, goldSpent: 0, waived: 0,
            catchUpPurchases: 0, relativeTierTotal: 0, maximumRelativeTier: 0, maximumNormalPrice: 0 };
          metric.purchases++; metric.goldSpent += transaction.cost;
          metric.waived += transaction.waivedByOnTheHouse ? 1 : 0;
          metric.catchUpPurchases += transaction.relativeTier === 0 ? 1 : 0;
          metric.relativeTierTotal += transaction.relativeTier;
          metric.maximumRelativeTier = Math.max(metric.maximumRelativeTier, transaction.relativeTier);
          metric.maximumNormalPrice = Math.max(metric.maximumNormalPrice, transaction.normalPrice ?? 0);
        }
        if (transaction.type === 'dice_purchased') {
          experienced.diceEconomy.purchases++; experienced.diceEconomy.purchaseGold += transaction.pricePaid;
          const type = experienced.diceEconomy.byType[transaction.dieType] ??= { purchased: 0, sold: 0, fused: 0 };
          type.purchased++;
        } else if (transaction.type === 'dice_sold') {
          experienced.diceEconomy.sales++; experienced.diceEconomy.saleGold += transaction.proceeds;
          for (const effect of transaction.effects) {
            const type = experienced.diceEconomy.byType[effect.type] ??= { purchased: 0, sold: 0, fused: 0 };
            type.sold++;
          }
        } else if (transaction.type === 'dice_moved') experienced.diceEconomy.moves++;
        else if (transaction.type === 'dice_fused') {
          experienced.diceEconomy.fusions++;
          for (const effect of transaction.effects) {
            const type = experienced.diceEconomy.byType[effect.type] ??= { purchased: 0, sold: 0, fused: 0 };
            type.fused++;
          }
        }
        if (transaction.type === 'life_restored') experienced.livesRestored += transaction.livesAfter - transaction.livesBefore;
        if (transaction.type === 'special_offer_selected') add(experienced.specialOffers, transaction.offer, 1);
        break;
      }
      case 'flame_changed': {
        const change = event.change;
        experienced.flameTimeline.push({ round: event.round, attempt: event.attempt, type: change.type, abandoned,
          ...('flame' in change ? { flame: change.flame } : {}) });
        if (change.type === 'activated') add(experienced.flameActivations, change.flame, 1);
        if (change.type === 'acquired') experienced.flameLifecycle.acquired++;
        else if (change.type === 'replaced') { experienced.flameLifecycle.acquired++; experienced.flameLifecycle.replaced++; }
        else if (change.type === 'stoked') experienced.flameLifecycle.stokedGold += change.amount;
        else if (change.type === 'bonfire_created') experienced.flameLifecycle.bonfires++;
        break;
      }
      case 'temper_changed':
        if (event.operation === 'earned') {
          experienced.temperEarned += event.amount;
          add(experienced.temperBySource, event.source as TemperSource, event.amount);
        } else {
          experienced.temperSpent += event.amount;
          add(experienced.temperSpentBySource, event.source as TemperSpendSource, event.amount);
        }
        break;
      case 'engulfment_attempted':
        if (event.success && !abandoned) experienced.flameLifecycle.engulfed++;
        break;
      case 'charge_changed':
        if (event.operation === 'gain') experienced.charge.gains += Math.max(0, event.after - event.before);
        else if (event.operation === 'arm') experienced.charge.arms++;
        else if (event.operation === 'consume_reset') experienced.charge.consumes++;
        else if (event.operation === 'round_reset') experienced.charge.resets++;
        break;
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
  'counterfactual effect attribution beyond emitted score contributions',
] as const;
