import { bossRewardForEncounter, CONFIG, interestForGold, roundReward } from './config';
import { activeFace, rollPhysicalDie, scoringPips, weightedSelectedFaceWeight, wholeDieEffectSuppressed } from './dice';
import {
  captureHandStart, currentFlameInstanceId, eligibleFlameIds, flameByType, flameInstances, flameSlotOf, FLAMES, handXMultContributions,
  allHandsOnDeckChargeGain, countScoringDiceEnhancementComponents, fluxCapacitorChargeMultiplier, HAND_FAMILY_FLAME_IDS, HAND_FAMILY_FLAMES, HOT_STREAK_SEQUENCE,
  initialHandFamilyFlameStages, jumpStartChargeGain, momentumChargeGain, normalizeFlameInstanceRuntime, ownedFlameIds, recalculateMaxCharge,
  potentialEnergyChargeGain, removeFlameInstance,
  sixPackMultiplierAfterUpperHands, sixPackStartingMultiplier, thirdRailChargeGain,
  burnItDownChargeGain, dareDevilMultiplier, FLAME_SCALING, greaseTheEngineChargeGain, greaseTheEngineCost,
  hotPotatoClockChargeGain, lightningStrikeChargeGain, allInMultiplier, doubleOrNothingMultiplier, hotStreakMultiplier,
  doubleOrNothingEligibleHands, PROGRESSIVE_FLAME_SEQUENCES, progressiveSequenceMultiplier, type ProgressiveSequenceFlame,
  briberyFactor, briberyNextCost, briberyXMultIncrement,
} from './flames';
import { benchWarmerHand, encounterHandIds, handIsStructurallyImpossible, handOptions, hasPlayableHand, HANDS, HAND_IDS, LOWER_HAND_IDS, planQualification, ultimateHands, upperBaselineLevel, UPPER_HAND_IDS } from './hands';
import { probabilityCheck, randomIndex } from './rng';
import { OFFER_RARITY_WEIGHTS, rarityFirstSelection, rarityLabel } from './rarity';
import { createDiceOffers } from './diceEconomy';
import { applyHandContribution, applyXMult, createHandAccumulator, finalizeHandScore, resolvedDiePipsContributions, type HandScoreContribution, type ScoringParticipant } from './scoring';
import { boardSnapshot } from './telemetry';
import { activeEncounterDice, bossTypeForRound, CALLER_HAND_POOL, cleanupTemporaryBossFaces, createBossRuntime, createCursedDie, currentlyPlayableManualHands, handIsPhysicallyAttainable,
  isBigBossRound, isCursedDie, isMiniBossType, requiredEncounterDieIds, scorecardCycleRelevantHands, unavailableEncounterHands, wardenUnlockCosts,
  wouldCompleteScorecardCycle } from './bosses';
import { getEncounterGoalBreakdown } from './goals';
import { encounterNode, flameNodeAfter, postBossShopNodeAfter, shopNodeBefore, specialOfferNodeAfter, timeTravelDestinationRound } from './progression';
import { formatExactDecimal, formatExactScore, formatPlayerNumber } from './copy';
import { chapterEncounterRounds, chapterNumberForRound, chapterPosition, ensureChapterPlan } from './chapters';
import { chapterRoundForRound } from './chapters';
import { RUN_HISTORY_V2_RULESET, RUN_HISTORY_V2_SCHEMA_VERSION } from './runHistoryV2';
import {
  createInfernoEvaluation,
  engulfmentAssetKey,
  infernoMultiplier,
  ownedEngulfmentAssets,
} from './engulfment';
import { appendCriticalDiagnostic, appendDebugTrace } from './debugTrace';
import { captureRollbackState, restoreRollbackState } from './rollback';
import {
  captureBustPersistentSpecialOfferState, eligibleSpecialOfferTypes, fireKeeperInvestment, restoreSpecialOfferEffectsAfterBust,
  SPECIAL_OFFERS, specialOfferDescription, specialOfferName, usableManualRerolls,
} from './specialOffers';
import { createTrainingSession } from './training';
import { forgeRevealEligible } from './forge';
import type { ChargeFlame, HandStartSnapshot } from './flames';
import type { CollectibleDie, DieEffectInstance, EventRecord, Face, Flame, FlameInstanceId, GameEvent, GameState, GoldSource, GoldSpendSource, HandId, HandPlaySource, HandScoreAccumulator, RandomSource, Rank, ResolvedDiePips, RunNode, ScorePackage, ScoreSource, SpecialDieType, SpecialOffer, TemperSource, TemperSpendSource } from './types';
import type {
  FlameOrigin, HandSideEffect, HistoryDieState, MultContribution, PipsContribution,
  RollEffect, RollReason, RunHistoryV2Event, RunHistoryV2EventInput, XMultContribution,
} from './runHistoryV2';
import { Decimal, exactRatioNumber, roundPositiveScoreHalf, type ExactScore } from './scoreMath';
import { createPlayIntent, createRollBatchIntent, createRollIntent } from './resolution';
import { activeDieLabel, orderDieIdsByEncounter, rosterDice, rosterSlotOf, syncActiveDiceProjection } from './inventory';
import type { PlayIntent, QualificationPlan, RollBatchIntent, RollContext, RollIntent, RollResolution, ScoreOccurrence } from './resolution';
import { effectOf, effectRuntime, hasEffect, requireEffect, resetDieRoundState, runtimeFor, SPECIAL_DICE } from './specialDice';

type RollTrigger = { dieId: number; face: Face; kind: 'jumpingBean'; rerollEventId: string; selectedNumber: Exclude<Rank, 7> };
type CurtainCallContext = { dieId: number; multiplier: number; manualRerollEventId: string };
type V2HandDraft = {
  parentSeq?: number;
  hand: HandId;
  level: number;
  playSource: HandPlaySource;
  selectedDice: number[];
  consumed: boolean;
  roundScoreBefore: ExactScore;
  pipsContributions: PipsContribution[];
  resolvedDicePips: ResolvedDiePips[];
  multContributions: MultContribution[];
  xMultContributions: XMultContribution[];
  sideEffects: HandSideEffect[];
};
type V2RollDraft = { effects: RollEffect[] };
type HandResolution = {
  intent: PlayIntent;
  qualification: QualificationPlan;
  selectedParticipants: ScoringParticipant[];
  scoringParticipants: ScoringParticipant[];
  scoreOccurrences: ScoreOccurrence[];
  resolvedDicePips: ResolvedDiePips[];
  accumulator: HandScoreAccumulator;
  wouldConsumeHand: boolean;
  consumesHand: boolean;
};
export interface ResolverOptions {
  tutorialFinalLifeSafeguard?: boolean;
  nonPayingManualRerolls?: number;
  /** Test-only parity switch; gameplay and playback instrumentation must remain identical when V2 is disabled. */
  disableHistoryV2?: boolean;
}
const NORMAL_SHOP_SPEND = new Set<GoldSpendSource>([
  'dicePurchase', 'diceOfferReroll', 'handTraining', 'lifeRestore',
]);
const UPPER_HAND_BY_FACE: Partial<Record<import('./types').Rank, HandId>> = {
  1: 'ones', 2: 'twos', 3: 'threes', 4: 'fours', 5: 'fives', 6: 'sixes',
};

// Rules resolve synchronously into immutable snapshots. Playback speed only changes how React reads them.
export class Resolver {
  readonly events: GameEvent[] = [];
  rngStateAfterResolution: number | null = null;
  private queue: RollTrigger[] = [];
  private handAccumulator: HandScoreAccumulator | null = null;
  private v2Hand: V2HandDraft | null = null;
  private v2Roll: V2RollDraft | null = null;
  private v2ManualSpend: import('./runHistoryV2').RollBatchEvent['spend'] = null;
  private v2ParentSeq: number | undefined;
  private lastV2RollSeq: number | undefined;
  private v2LastCharge: number;
  private curtainCallContext: CurtainCallContext | null = null;
  private activeScorePackage: ScorePackage | null = null;
  private playStack: string[] = [];
  constructor(readonly state: GameState, readonly rng: RandomSource, readonly options: ResolverOptions = {}) {
    state.historyV2 ??= [];
    state.historyV2TimelineId = Math.max(0, Math.floor(state.historyV2TimelineId ?? 0));
    normalizeFlameInstanceRuntime(state);
    this.v2LastCharge = state.chargeXMult;
    recalculateMaxCharge(state);
  }

  private collectible(dieId: number): CollectibleDie | null {
    const die = this.state.dice.find(item => item.id === dieId);
    return die?.owner === 'player' ? die : null;
  }

  private dieLabel(dieId: number): string { return activeDieLabel(this.state, dieId); }

  private specialRuntime(die: CollectibleDie, type: SpecialDieType) {
    return runtimeFor(die, this.state.dieRoundState[die.id], type);
  }

  private emitSpecial(die: CollectibleDie, effect: DieEffectInstance, detail: string, effectCause: string,
    invocationBefore?: number, invocationAfter?: number, extra: Partial<EventRecord> = {}): void {
    this.v2Hand?.sideEffects.push({ type: 'special_die', dieId: die.id, dieType: effect.type, effectInstanceId: effect.id, detail,
      ...(invocationBefore === undefined ? {} : { invocationBefore }),
      ...(invocationAfter === undefined ? {} : { invocationAfter }) });
    this.emitV2({ kind: 'special_die_activated', dieId: die.id, dieType: effect.type, effectInstanceId: effect.id, level: effect.level,
      context: this.v2Hand ? 'hand' : this.v2Roll ? 'roll' : effectCause === 'on_command' ? 'command' : 'other',
      effectCause, detail,
      ...(invocationBefore === undefined ? {} : { invocationBefore }),
      ...(invocationAfter === undefined ? {} : { invocationAfter }) });
    this.emit({ type: 'SPECIAL_DIE_EFFECT', dieIds: [die.id], dieType: effect.type, effectInstanceId: effect.id, dieLevel: effect.level,
      effectCause, invocationBefore, invocationAfter, message: `${this.dieLabel(die.id)} ${detail}`, ...extra });
  }

  private spendInvocation(die: CollectibleDie, effect: DieEffectInstance, detail: string, effectCause: string): void {
    const runtime = effectRuntime(this.state.dieRoundState[die.id], effect);
    if (!runtime || runtime.invocationsRemaining <= 0) throw new Error(`${effect.type} has no Uses remaining.`);
    const before = runtime.invocationsRemaining;
    runtime.invocationsRemaining--;
    this.emitSpecial(die, effect, detail, effectCause, before, runtime.invocationsRemaining);
  }

  private historyDie(dieId: number, faceSnapshot?: Face): HistoryDieState {
    const die = this.state.dice.find(item => item.id === dieId)!;
    const face = faceSnapshot ?? activeFace(die);
    return { dieId, owner: die.owner, rosterSlot: die.owner === 'player' ? rosterSlotOf(this.state, dieId) : null,
      ...(die.owner === 'player' ? { effects: structuredClone(die.effects) } : { encounterId: die.encounterId }),
      physicalFace: die.value, face: face.rank, pips: scoringPips(face),
      bossMutation: face.bossMutation ? structuredClone(face.bossMutation) : null,
      ...(die.owner === 'player' && die.effects.length && this.state.dieRoundState[die.id]
        ? { specialRuntime: structuredClone(this.state.dieRoundState[die.id]) } : {}) };
  }

  emitV2(input: RunHistoryV2EventInput): RunHistoryV2Event {
    const { parentSeq, ...payload } = input;
    const event = { ...payload, seq: this.state.nextHistorySeq++, round: this.state.round,
      attempt: this.state.roundAttemptNumber, actionId: this.state.nextActionId,
      timelineId: this.state.historyV2TimelineId, ...(parentSeq === undefined ? {} : { parentSeq }) } as RunHistoryV2Event;
    if (!this.options.disableHistoryV2) this.state.historyV2.push(event);
    return event;
  }

  emitRunStarted(): void {
    this.emitV2({ kind: 'run_started', schemaVersion: RUN_HISTORY_V2_SCHEMA_VERSION, ruleset: RUN_HISTORY_V2_RULESET,
      seed: this.state.seed, initialLives: this.state.lives, initialGold: this.state.gold,
      initialHandLevels: structuredClone(this.state.handLevels),
      ...(this.state.runMode === 'scenario' && this.state.scenario ? { runMode: 'scenario' as const,
        scenarioId: this.state.scenario.id, scenarioVersion: this.state.scenario.version,
        scenarioName: this.state.scenario.name } : {}) });
  }

  emitV2Error(detail: string): void {
    this.emitV2({ kind: 'error', code: 'resolution_error', detail });
  }

  private trace(input: Parameters<typeof appendDebugTrace>[2]): void {
    appendDebugTrace(this.state.debugTrace, { round: this.state.round, attempt: this.state.roundAttemptNumber,
      actionId: this.state.nextActionId }, input);
  }

  private flameOrigin(flame: Flame): FlameOrigin {
    return flameByType(this.state, flame)?.stage ?? 'external';
  }

  private emitV2FlameActivation(flame: Flame, factor?: number,
    diagnostics?: import('./types').FlameActivationDiagnostics): void {
    const instanceId = currentFlameInstanceId(this.state, flame);
    const slot = instanceId === null ? null : flameSlotOf(this.state, instanceId);
    if (instanceId === null || slot === null) return;
    this.emitV2({ kind: 'flame_changed', change: { type: 'activated', flame, instanceId, slot,
      origin: this.flameOrigin(flame), ...(factor === undefined ? {} : { factor }),
      ...(diagnostics ? { diagnostics: structuredClone(diagnostics) } : {}) } });
  }

  private nextTimeline(reason: 'bust' | 'bad_dream' | 'time_travel', canonicalRound: number, canonicalAttempt: number,
    relocation?: 'chapter_start' | 'post_r3_shop'): void {
    const fromTimelineId = this.state.historyV2TimelineId;
    const abandonedThroughSeq = Math.max(-1, this.state.nextHistorySeq - 1);
    const sameTimeline = this.state.historyV2.filter(event => event.timelineId === fromTimelineId);
    const latestAttempt = [...sameTimeline].reverse().find(event => event.kind === 'round_attempt_started');
    const badDreamSelection = [...sameTimeline].reverse().find(event => event.kind === 'shop_transaction'
      && event.transaction.type === 'special_offer_selected' && event.transaction.offer === 'badDream');
    const timeTravelStart = sameTimeline.find(event => event.kind === 'round_attempt_started' && event.round >= canonicalRound);
    const abandonedFromSeq = reason === 'bad_dream' && badDreamSelection ? badDreamSelection.seq + 1
      : reason === 'time_travel' && timeTravelStart ? timeTravelStart.seq
        : latestAttempt?.seq ?? sameTimeline[0]?.seq ?? abandonedThroughSeq;
    const retainedSeqs = reason === 'bust' ? [] : sameTimeline.filter(event => event.seq >= abandonedFromSeq
      && event.seq <= abandonedThroughSeq && (event.kind === 'shop_transaction' || event.kind === 'flame_changed'))
      .map(event => event.seq);
    const rewoundEvents = sameTimeline.filter(event => event.seq >= abandonedFromSeq && event.seq <= abandonedThroughSeq);
    const retainedHandSideEffects = reason === 'bust' ? [] : rewoundEvents.flatMap(event => event.kind === 'hand_scored'
      ? [{ sourceSeq: event.seq, sideEffects: event.sideEffects.filter(effect =>
        ['gold', 'special_die'].includes(effect.type)) }]
      : []).filter(item => item.sideEffects.length > 0);
    const retainedCarePackageSpends = reason === 'bust' ? [] : rewoundEvents.flatMap(event =>
      event.kind === 'roll_batch' && (event.spend?.carePackageCharges ?? 0) > 0
        ? [{ sourceSeq: event.seq, charges: event.spend!.carePackageCharges }] : []);
    this.state.historyV2TimelineId++;
    this.emitV2({ kind: 'checkpoint_restored', reason, fromTimelineId, toTimelineId: this.state.historyV2TimelineId,
      abandonedFromSeq, abandonedThroughSeq, canonicalRound, canonicalAttempt, retainedSeqs, relocation,
      ...(reason === 'bust' ? {} : { preservedState: 'current_build' as const, retainedHandSideEffects,
        retainedCarePackageSpends }) });
    appendCriticalDiagnostic(this.state.debugTrace, { round: this.state.round, attempt: this.state.roundAttemptNumber,
      actionId: this.state.nextActionId }, { kind: 'checkpoint_restore', reason, fromTimelineId,
      toTimelineId: this.state.historyV2TimelineId });
  }

  private captureContextForV2(record: EventRecord): boolean {
    if (this.v2Hand) {
      if (record.type === 'CHARGE_CHANGED') {
        const after = this.state.chargeXMult;
        const operation = after === 1 && this.v2LastCharge > 1 ? 'consume_reset' : 'gain';
        this.v2Hand.sideEffects.push({ type: 'charge', operation, before: this.v2LastCharge, after, source: record.flame });
        this.v2LastCharge = after;
      } else if (record.type === 'GOLD_ADDED' && record.goldSource && typeof record.amount === 'number')
        this.v2Hand.sideEffects.push({ type: 'gold', source: record.goldSource, amount: record.amount, dieId: record.dieIds?.[0] });
      else if (record.type === 'FLAME_TRIGGERED' && record.flame) {
        if (record.xMult === undefined) this.v2Hand.sideEffects.push({ type: 'flame_activation', flame: record.flame,
          origin: this.flameOrigin(record.flame), dieId: record.dieIds?.[0] });
        this.emitV2FlameActivation(record.flame, record.xMult, record.flameDiagnostics);
      }
      else if ((record.type === 'BOSS_HAND_CHANGED' || record.type === 'BOSS_FACE_CHANGED'
        || record.type === 'CALLER_CALLED' || record.type === 'CALLER_CHANGED') && record.boss)
        this.v2Hand.sideEffects.push({ type: 'boss_state', boss: record.boss, change: record.type, amount: record.amount,
          hand: record.hand, hands: record.hands, dieIds: record.dieIds, state: record.bossState });
      return true;
    }
    if (this.v2Roll) {
      if (record.type === 'CHARGE_CHANGED' && record.flame) {
        const after = this.state.chargeXMult;
        this.v2Roll.effects.push({ type: 'charge', source: record.flame, before: this.v2LastCharge, after });
        this.v2LastCharge = after;
      } else if (record.type === 'FLAME_TRIGGERED' && record.flame) {
        this.v2Roll.effects.push({ type: 'flame_activation', flame: record.flame,
          origin: this.flameOrigin(record.flame), dieIds: record.dieIds ?? [] });
        this.emitV2FlameActivation(record.flame, record.xMult, record.flameDiagnostics);
      }
      else if ((record.type === 'BOSS_FACE_CHANGED' || record.type === 'CURSED_DIE_ROLLED') && record.boss)
        this.v2Roll.effects.push({ type: 'boss', boss: record.boss, change: record.type, dieIds: record.dieIds ?? [] });
      else if (record.type === 'SPECIAL_DIE_EFFECT' && record.dieType && record.dieIds?.[0] !== undefined)
        this.v2Roll.effects.push({ type: 'special_die', dieId: record.dieIds[0], dieType: record.dieType as SpecialDieType,
          effectInstanceId: record.effectInstanceId ?? `${record.dieIds[0]}:${record.dieType}`,
          detail: record.message, invocationBefore: record.invocationBefore, invocationAfter: record.invocationAfter });
      return true;
    }
    return false;
  }

  private recordV2FromPlaybackEvent(record: EventRecord): void {
    if (this.captureContextForV2(record)) return;
    switch (record.type) {
      case 'MAP_TRANSITION':
        if (record.toNode && record.nodeType) this.emitV2({ kind: 'map_transition', fromNode: record.fromNode ?? null,
          toNode: record.toNode, nodeType: record.nodeType, direction: record.direction ?? 'forward' });
        break;
      case 'CHAPTER_STARTED':
        if (record.chapterNumber && record.chapterMiniBoss && record.chapterBoss) this.emitV2({ kind: 'chapter_started',
          chapter: record.chapterNumber, miniBoss: record.chapterMiniBoss, boss: record.chapterBoss });
        break;
      case 'GOLD_ADDED':
        if (record.goldSource && ['roundBase', 'unusedRerolls', 'interest', 'bossReward'].includes(record.goldSource)) break;
        if (record.goldSource && typeof record.amount === 'number') this.emitV2({ kind: 'shop_transaction',
          transaction: { type: 'gold_earned', source: record.goldSource, amount: record.amount } });
        break;
      case 'ROUND_SUMMARY_SHOWN':
        if (record.roundSummary) this.emitV2({ kind: 'shop_transaction', transaction: { type: 'round_payout',
          sources: { roundBase: record.roundSummary.sources.baseRewardGold,
            unusedRerolls: record.roundSummary.sources.unusedRerollGold,
            interest: record.roundSummary.sources.interestGold,
            bossReward: record.roundSummary.sources.bossRewardGold },
          total: record.roundSummary.sources.baseRewardGold + record.roundSummary.sources.unusedRerollGold
            + record.roundSummary.sources.interestGold + record.roundSummary.sources.bossRewardGold } });
        break;
      case 'GOLD_SPENT':
        if (record.goldSpendSource && typeof record.amount === 'number') this.emitV2({ kind: 'shop_transaction',
          transaction: { type: 'gold_spent', source: record.goldSpendSource, amount: record.amount } });
        break;
      case 'TRAINING_PURCHASED': {
        const training = this.state.stats.trainingPurchases.at(-1);
        if (training && training.hand !== 'all' && training.shopVisitId !== undefined && training.family
          && training.fromLevel !== undefined && training.toLevel !== undefined && training.frozenBaseline !== undefined
          && training.relativeTier !== undefined && training.normalPrice !== undefined && training.purchaseCount !== undefined)
          this.emitV2({ kind: 'shop_transaction', transaction: { type: 'training', shopVisitId: training.shopVisitId,
            hand: training.hand, family: training.family, fromLevel: training.fromLevel, toLevel: training.toLevel,
            frozenBaseline: training.frozenBaseline, relativeTier: training.relativeTier,
            normalPrice: training.normalPrice, cost: training.cost,
            waivedByOnTheHouse: training.waivedByOnTheHouse === true, purchaseCount: training.purchaseCount } });
        break;
      }
      case 'SPECIAL_OFFER_SELECTED': {
        const offer = this.state.specialOffer?.chosen;
        if (offer && record.rarity && record.rarity !== 'legendary') this.emitV2({ kind: 'shop_transaction', transaction: {
          type: 'special_offer_selected', offer: offer.type, rarity: record.rarity, hand: offer.hand } });
        break;
      }
      case 'LIFE_RESTORED': {
        const restore = this.state.stats.lifeRestores.at(-1);
        if (restore) this.emitV2({ kind: 'shop_transaction', transaction: { type: 'life_restored', cost: restore.cost,
          livesBefore: restore.livesBefore, livesAfter: restore.livesAfter } });
        break;
      }
      case 'FLAME_ACQUIRED':
      case 'FLAME_REPLACED': {
        const acquisition = this.state.stats.flameAcquisitions.at(-1);
        if (record.flame && record.rarity && record.rarity !== 'legendary' && acquisition) this.emitV2({ kind: 'flame_changed',
          change: { type: record.type === 'FLAME_ACQUIRED' ? 'acquired' : 'replaced', flame: record.flame,
            instanceId: acquisition.instanceId, slot: acquisition.slot,
            rarity: record.rarity, ...(acquisition.replaced ? { replaced: acquisition.replaced } : {}) } });
        break;
      }
      case 'FLAME_SKIPPED': this.emitV2({ kind: 'flame_changed', change: { type: 'skipped' } }); break;
      case 'FLAME_INVESTED': {
        const stoke = this.state.stats.flameStokes.at(-1);
        if (stoke) this.emitV2({ kind: 'flame_changed', change: { type: 'stoked', flame: stoke.flame,
          instanceId: stoke.instanceId, slot: stoke.slot, amount: stoke.amount, from: stoke.from, to: stoke.total } });
        break;
      }
      case 'BONFIRE_CREATED':
        if (record.flame) this.emitV2({ kind: 'flame_changed',
          change: { type: 'bonfire_created', flame: record.flame,
            instanceId: currentFlameInstanceId(this.state, record.flame)!,
            slot: flameSlotOf(this.state, currentFlameInstanceId(this.state, record.flame)!)! } });
        break;
      case 'FLAME_TRIGGERED':
        if (record.flame) this.emitV2FlameActivation(record.flame, record.xMult, record.flameDiagnostics);
        break;
      case 'CHARGE_ARMED':
        this.emitV2({ kind: 'charge_changed', operation: this.state.chargeArmed ? 'arm' : 'disarm',
          before: this.state.chargeXMult, after: this.state.chargeXMult, dieIds: record.dieIds ?? [] });
        break;
      case 'CHARGE_CHANGED': {
        const after = this.state.chargeXMult;
        const operation = after === 1 && this.v2LastCharge > 1 ? 'consume_reset' : 'gain';
        this.emitV2({ kind: 'charge_changed', operation, before: this.v2LastCharge, after,
          source: record.flame,
          ...(record.flame ? { sourceInstanceId: currentFlameInstanceId(this.state, record.flame) ?? undefined } : {}),
          dieIds: record.dieIds ?? [] });
        this.v2LastCharge = after;
        break;
      }
      case 'BOSS_STARTED':
      case 'BOSS_CLEARED':
      case 'BOSS_HAND_CHANGED':
      case 'BOSS_FACE_CHANGED':
      case 'CALLER_CALLED':
      case 'CALLER_CHANGED':
      case 'WARDEN_UNLOCK_TARGET':
      case 'WARDEN_REINFORCEMENT':
        if (record.boss) this.emitV2({ kind: 'boss_state_changed', boss: record.boss,
          change: record.type === 'BOSS_STARTED' ? 'started' : record.type === 'BOSS_CLEARED' ? 'cleared'
            : record.type === 'WARDEN_UNLOCK_TARGET' ? 'warden_target' : record.type === 'WARDEN_REINFORCEMENT' ? 'warden_unlock'
              : record.type === 'BOSS_FACE_CHANGED' ? 'face' : record.type === 'CALLER_CALLED' ? 'called'
                : record.boss === 'fly' && record.bossState === 'target' ? 'target'
                  : record.boss === 'fly' && record.bossState === 'caught' ? 'caught'
                    : record.boss === 'pendulum' && record.bossState?.startsWith('requested_') ? 'requested'
                      : record.boss === 'pendulum' && record.bossState?.startsWith('remained_') ? 'remained' : 'state',
          hand: record.hand, hands: record.hands, dieIds: record.dieIds ?? [], amount: record.amount,
          state: record.bossState });
        break;
      case 'SCORECARD_REFRESHED':
        this.emitV2({ kind: 'scorecard_refreshed', refreshedHands: [...HAND_IDS] });
        break;
      case 'ROUND_CLEARED':
        this.emitV2({ kind: 'round_attempt_finished', outcome: 'cleared', score: this.state.score,
          target: this.state.target, boss: this.state.boss?.type ?? null, livesBefore: this.state.lives, livesAfter: this.state.lives });
        break;
      case 'RUN_LOST':
        this.emitV2({ kind: 'run_finished', outcome: 'lost', finalChapter: chapterNumberForRound(this.state.round),
          finalRound: this.state.round, finalBoss: record.boss ?? null, score: this.state.bust?.score ?? this.state.score,
          target: this.state.bust?.target ?? this.state.target, finalHandLevels: structuredClone(this.state.handLevels) });
        break;
    }
  }

  format(value: number | ExactScore | string): string {
    return typeof value === 'bigint' ? formatExactScore(value)
      : typeof value === 'string' ? formatExactDecimal(value) : formatPlayerNumber(value);
  }
  emit(event: Omit<EventRecord, 'id' | 'round'>): void {
    if (this.events.length >= CONFIG.resolutionEventCap) throw new Error(`Resolution exceeded ${CONFIG.resolutionEventCap} events. Check for an infinite ability chain.`);
    const record = { ...event, ...(this.handAccumulator ? { handScore: structuredClone(this.handAccumulator) } : {}),
      id: this.state.nextPlaybackEventId++, round: this.state.round };
    this.events.push({ ...record, board: boardSnapshot(this.state) });
    this.recordV2FromPlaybackEvent(record);
  }
  mapTransition(node: RunNode, direction: 'forward' | 'backward' = 'forward'): void {
    const fromNode = this.state.currentNodeId || null;
    this.state.currentNodeId = node.id;
    this.state.stats.mapTransitions.push({ fromNode, toNode: node.id, nodeType: node.type,
      round: node.round, boss: node.boss, direction });
    this.emit({ type: 'MAP_TRANSITION', fromNode, toNode: node.id, nodeType: node.type,
      boss: node.boss, direction, message: `${fromNode ?? 'Run start'} → ${node.id}` });
  }
  enterChapterIfNeeded(round: number): void {
    const chapterNumber = chapterNumberForRound(round);
    const plan = ensureChapterPlan(this.state, chapterNumber);
    if (this.state.presentedChapters.includes(chapterNumber)) return;
    this.state.presentedChapters.push(chapterNumber);
    this.emit({
      type: 'CHAPTER_STARTED', chapterNumber, chapterMiniBoss: plan.miniBoss, chapterBoss: plan.boss,
      message: `Chapter ${chapterNumber} entered`,
    });
  }
  log(event: Omit<EventRecord, 'id' | 'round'>): void {
    const record = { ...event, id: this.state.nextPlaybackEventId++, round: this.state.round };
    this.recordV2FromPlaybackEvent(record);
  }
  triggerFlame(flame: Flame, detail = '', hand?: HandId, xMult?: number,
    flameDiagnostics?: import('./types').FlameActivationDiagnostics): void {
    this.state.stats.flameTriggers[flame] = (this.state.stats.flameTriggers[flame] ?? 0) + 1;
    this.emit({ type: 'FLAME_TRIGGERED', flame, hand, xMult, flameDiagnostics,
      message: `${FLAMES[flame].name}${detail ? `: ${detail}` : ''}` });
  }
  recordUltimateTargets(reason: Extract<RunHistoryV2EventInput, { kind: 'ultimate_targets_changed' }>['reason'], force = false): void {
    if (!flameByType(this.state, 'ultimate')) return;
    const targets = ultimateHands(this.state.handLevels);
    const prior = [...this.state.historyV2].reverse().find(event => event.kind === 'ultimate_targets_changed');
    if (!force && prior?.kind === 'ultimate_targets_changed'
      && prior.targets.length === targets.length && prior.targets.every((hand, index) => hand === targets[index])) return;
    this.emitV2({ kind: 'ultimate_targets_changed', targets, reason });
  }
  recordBenchWarmerTarget(reason: Extract<RunHistoryV2EventInput, { kind: 'bench_warmer_target_changed' }>['reason'], force = false): void {
    if (!flameByType(this.state, 'benchWarmer')) return;
    const target = benchWarmerHand(this.state.handLevels);
    const prior = [...this.state.historyV2].reverse().find(event => event.kind === 'bench_warmer_target_changed');
    if (!force && prior?.kind === 'bench_warmer_target_changed' && prior.target === target) return;
    this.emitV2({ kind: 'bench_warmer_target_changed', target, reason });
  }
  setFetchTarget(previous = this.state.fetchTarget): void {
    const dice = flameByType(this.state, 'fetch') ? rosterDice(this.state) : [];
    const targets = dice.flatMap(die => die.faces.slice(0, 6).map((_, index) => ({ dieId: die.id, physicalFace: (index + 1) as import('./types').Rank })))
      .filter(target => !previous || target.dieId !== previous.dieId || target.physicalFace !== previous.physicalFace);
    if (!targets.length) { this.state.fetchTarget = null; return; }
    this.state.fetchTarget = targets[randomIndex(this.rng, targets.length)];
    this.emit({ type: 'FETCH_TARGET_CHANGED', flame: 'fetch', dieIds: [this.state.fetchTarget.dieId], face: this.state.fetchTarget.physicalFace,
      message: `Fetch target: ${this.dieLabel(this.state.fetchTarget.dieId)} face ${this.state.fetchTarget.physicalFace}` });
  }
  addGold(amount: number, message: string, goldSource: GoldSource, dieId?: number): void {
    this.state.gold += amount;
    this.state.stats.goldEarned += amount;
    this.state.stats.goldBySource[goldSource] += amount;
    this.emit({ type: 'GOLD_ADDED', amount, message, goldSource, dieIds: dieId === undefined ? undefined : [dieId] });
  }
  spendGold(amount: number, message: string, goldSpendSource: GoldSpendSource): void {
    if (this.state.phase !== 'shop') throw new Error('Gold may only be spent in a normal Shop.');
    this.state.gold -= amount;
    this.state.stats.goldSpent += amount;
    this.state.stats.goldSpentBySource[goldSpendSource] += amount;
    if (NORMAL_SHOP_SPEND.has(goldSpendSource)) {
      this.state.stats.lifetimeNormalShopGoldSpent += amount;
      this.state.lifetimeNormalShopGoldSpent += amount;
    }
    this.emit({ type: 'GOLD_SPENT', amount, message, goldSpendSource });
  }
  addTemper(amount: number, source: TemperSource, message: string): void {
    if (!Number.isSafeInteger(amount) || amount <= 0) return;
    this.state.temper += amount;
    this.state.forgeUnlocked ||= forgeRevealEligible(this.state.diceInventory, this.state.temper);
    if (this.state.phase === 'round' && (source === 'overkill' || source === 'boardRefresh' || source === 'miniBoss' || source === 'boss')) {
      this.state.roundTemper[source] += amount;
      this.emitV2({ kind: 'temper_changed', operation: 'earned', source, amount, balance: this.state.temper,
        shopVisitId: this.state.shop?.visitId ?? null });
      this.emit({ type: 'TEMPER_CHANGED', amount, temperSource: source, temperBalance: this.state.temper,
        message: `${message} · +${amount} Temper` });
      return;
    }
    this.state.stats.temperEarned += amount;
    this.state.stats.temperBySource[source] += amount;
    this.state.stats.temperTransactions.push({ round: this.state.round, shopVisitId: this.state.shop?.visitId ?? null,
      kind: 'earned', source, amount, balance: this.state.temper });
    this.emitV2({ kind: 'temper_changed', operation: 'earned', source, amount, balance: this.state.temper,
      shopVisitId: this.state.shop?.visitId ?? null });
    this.emit({ type: 'TEMPER_CHANGED', amount, temperSource: source, temperBalance: this.state.temper,
      message: `${message} · +${amount} Temper` });
  }
  private commitRoundTemper(): void {
    for (const source of ['overkill', 'boardRefresh', 'miniBoss', 'boss'] as const) {
      const amount = this.state.roundTemper[source];
      if (!amount) continue;
      this.state.stats.temperEarned += amount;
      this.state.stats.temperBySource[source] += amount;
      this.state.stats.temperTransactions.push({ round: this.state.round, shopVisitId: null,
        kind: 'earned', source, amount, balance: this.state.temper });
    }
  }
  spendTemper(amount: number, source: TemperSpendSource): void {
    if (this.state.phase !== 'shop' || !Number.isSafeInteger(amount) || amount <= 0 || amount > this.state.temper)
      throw new Error('Invalid Temper spend.');
    this.state.temper -= amount;
    this.state.stats.temperSpent += amount;
    this.state.stats.temperSpentBySource[source] += amount;
    this.state.stats.temperTransactions.push({ round: this.state.round, shopVisitId: this.state.shop?.visitId ?? null,
      kind: 'spent', source, amount, balance: this.state.temper });
    this.emitV2({ kind: 'temper_changed', operation: 'spent', source, amount, balance: this.state.temper,
      shopVisitId: this.state.shop?.visitId ?? null });
    this.emit({ type: 'TEMPER_CHANGED', amount, temperSpendSource: source, temperBalance: this.state.temper,
      message: `Forge spent ${amount} Temper` });
  }
  private spendRoundGold(amount: number, message: string, goldSpendSource: 'furnace' | 'greaseTheEngine' | 'bribery'): void {
    if (this.state.phase !== 'round') throw new Error('This Gold may only be spent during an active Round.');
    this.state.gold -= amount;
    this.state.stats.goldSpent += amount;
    this.state.stats.goldSpentBySource[goldSpendSource] += amount;
    this.emit({ type: 'GOLD_SPENT', amount, message, goldSpendSource });
  }
  addScore(amount: ExactScore, source: Exclude<ScoreSource, 'hitchhiker'>, message: string, dieIds: number[], hand?: HandId): void {
    this.state.score += amount;
    if (amount > 0n && this.activeScorePackage) {
      this.activeScorePackage.score += amount;
      this.activeScorePackage.contributions.push({ playId: this.playStack.at(-1) ?? this.activeScorePackage.rootPlayId,
        hand: hand ?? null, source, amount });
    }
    this.state.stats.scoreBySource[source] += amount;
    if (hand) {
      this.state.scoreByHand[hand] = (this.state.scoreByHand[hand] ?? 0n) + amount;
      this.state.stats.rounds.at(-1)!.scoreByHand[hand] = this.state.scoreByHand[hand];
    } else {
      this.state.effectScore += amount;
      this.state.stats.rounds.at(-1)!.effectScore = this.state.effectScore;
    }
    const round = this.state.stats.rounds.at(-1)!;
    if (round.firstCrossedScore === null && this.state.score >= this.state.target) round.firstCrossedScore = this.state.score;
    round.finalScore = this.state.score;
    this.emit({ type: 'SCORE_ADDED', amount, source, hand, dieIds, message });
    this.updateWardenUnlockTarget();
  }
  private updateWardenUnlockTarget(): void {
    if (this.state.bossSilenced) return;
    const boss = this.state.boss;
    if (boss?.type !== 'warden' || boss.nextUnlockTarget === null || boss.pendingReinforcements > 0
      || boss.activeDieIds.length >= boss.encounterDieIds.length || this.state.score < boss.nextUnlockTarget) return;
    boss.pendingReinforcements++;
    this.state.stats.wardenEvents.push({ round: this.state.round, attempt: this.state.roundAttemptNumber,
      kind: 'target', threshold: boss.nextUnlockTarget, activeDice: boss.activeDieIds.length });
    this.emit({ type: 'WARDEN_UNLOCK_TARGET', boss: 'warden', amount: boss.nextUnlockTarget,
      message: `Warden unlock target ${this.format(boss.nextUnlockTarget)} reached · next reinforcement released` });
  }
  whenScored(dieId: number, snapshot: Face, hand: HandId, playSource: HandPlaySource, participation: 'selected' | 'hitchhiker'): void {
    if (!this.state.bossSilenced && this.state.boss?.type === 'hexer' && dieId === this.state.boss.cursedDieId) {
      this.state.stats.hexerEvents.push({ round: this.state.round, attempt: this.state.roundAttemptNumber,
        kind: playSource === 'jumpingBean' ? 'jumping_bean' : 'hand', face: snapshot.rank, hand });
    }
    void participation;
  }
  private applyScoringContribution(contribution: HandScoreContribution, occurrenceId: string): void {
    const { dieId, face, kind, role, amount, sourceDieIds } = contribution;
    applyHandContribution(this.handAccumulator!, contribution);
    if (kind === 'special' && contribution.effectType === 'bonus') this.handAccumulator!.bonusPips += amount;
    this.v2Hand?.pipsContributions.push({
      source: kind === 'base' ? 'die_base' : kind === 'special' ? 'special_die' : 'team_player',
      amount, occurrenceId, dieId, face: face.rank, role, ...(contribution.effectType ? { effectType: contribution.effectType } : {}),
      ...(sourceDieIds?.length ? { sourceDieIds: [...sourceDieIds] } : {}),
    });
  }

  private scoringContributions(participant: ScoringParticipant, scoringDice: number,
    intent?: PlayIntent): HandScoreContribution[] {
    const die = this.collectible(participant.id);
    const activeDie = die && !wholeDieEffectSuppressed(die) ? die : undefined;
    const curtainCall = intent?.source === 'freePlay' && this.curtainCallContext?.dieId === participant.id
      ? this.curtainCallContext : null;
    const selectedDice = intent?.playerSelectedDieIds.map(id => this.collectible(id))
      .filter((item): item is CollectibleDie => !!item && !wholeDieEffectSuppressed(item));
    return resolvedDiePipsContributions(participant, scoringDice, {
      die: activeDie,
      runtime: activeDie ? this.state.dieRoundState[activeDie.id] : undefined,
      selectedDice,
      playSource: intent?.source,
      curtainCallMultiplier: curtainCall?.multiplier,
    });
  }

  private resolveScoreOccurrence(occurrence: ScoreOccurrence, participants: ScoringParticipant[]): {
    additionalOccurrences: ScoreOccurrence[];
  } {
    const participant: ScoringParticipant = { id: occurrence.dieId, face: occurrence.face, role: occurrence.role };
    const { hand, playSource } = occurrence;
    void participants;
    this.whenScored(participant.id, participant.face, hand, playSource, participant.role);
    const collectible = this.collectible(participant.id);
    if (collectible && !wholeDieEffectSuppressed(collectible)) {
      const golden = effectOf(collectible, 'golden');
      const goldenRuntime = this.specialRuntime(collectible, 'golden');
      if (golden && goldenRuntime && goldenRuntime.goldenGoldEarned < golden.level * 3) {
        goldenRuntime.goldenGoldEarned++;
        this.addGold(1, `${this.dieLabel(collectible.id)} Golden: +1 Gold`, 'golden', collectible.id);
        this.emitSpecial(collectible, golden, `Golden earned 1 Gold (${goldenRuntime.goldenGoldEarned}/${golden.level * 3})`, 'score');
      }
      const workout = effectOf(collectible, 'workout');
      const workoutRuntime = this.specialRuntime(collectible, 'workout');
      if (workout && workoutRuntime) {
        const growth = CONFIG.workoutPipsPerScore * workout.level;
        const before = workoutRuntime.temporaryPips;
        workoutRuntime.temporaryPips += growth;
        this.emitSpecial(collectible, workout, `Workout future Pips ${before} → ${workoutRuntime.temporaryPips}`, 'score');
      }
      const vintage = effectOf(collectible, 'vintage');
      if (vintage) {
        const before = vintage.persistent.vintageAppreciation;
        vintage.persistent.vintageAppreciation = Math.min(90 * vintage.level, before + vintage.level);
        this.emitSpecial(collectible, vintage, `Vintage appreciation ${before} → ${vintage.persistent.vintageAppreciation}`, 'score');
      }
      const tank = effectOf(collectible, 'tank');
      const tankRuntime = this.specialRuntime(collectible, 'tank');
      if (tank && tankRuntime) {
        const before = tankRuntime.temporaryPips;
        tankRuntime.temporaryPips += CONFIG.tankPipsPerTrigger * tank.level;
        this.emitSpecial(collectible, tank, `Tank future Pips ${before} → ${tankRuntime.temporaryPips}`, 'score');
      }
    }
    return { additionalOccurrences: [] };
  }

  private decayFurnacesAfterPlay(): void {
    for (const die of rosterDice(this.state)) {
      if (wholeDieEffectSuppressed(die)) continue;
      const furnace = effectOf(die, 'furnace');
      const runtime = furnace ? this.specialRuntime(die, 'furnace') : undefined;
      if (!runtime || runtime.furnacePips <= 0) continue;
      runtime.furnacePips = Math.max(0, runtime.furnacePips - 1);
    }
  }

  private resolveScoreOccurrences(resolution: HandResolution): ScoringParticipant[] {
    const { intent, scoringParticipants } = resolution;
    const scoringDice = scoringParticipants.length;
    for (const participant of scoringParticipants) {
      const runningPipsBefore = this.handAccumulator!.currentPips;
      const rootId = `${intent.id}:score:${participant.id}`;
      const root: ScoreOccurrence = {
        id: rootId,
        rootId,
        playId: intent.id,
        hand: intent.hand,
        playSource: intent.source,
        dieId: participant.id,
        face: participant.face,
        role: participant.role,
        cause: participant.role === 'hitchhiker' ? 'hitchhiker' : 'play_selection',
        originallySelected: intent.originalSelectedDieIds.includes(participant.id),
        playerSelected: intent.playerSelectedDieIds.includes(participant.id),
        additional: false,
        suppressedEffects: [],
      };
      let branches: ScoreOccurrence[] = [root];
      const collectible = this.collectible(participant.id);
      if (resolution.qualification.effects.some(effect => effect.effect === 'conjoined' && effect.dieId === participant.id)) {
        branches.push({ ...root, id: `${rootId}:conjoined`, cause: 'conjoined', additional: true });
      }
      const doubleTime = collectible && !wholeDieEffectSuppressed(collectible) ? effectOf(collectible, 'doubleTime') : undefined;
      if (doubleTime) branches = branches.flatMap((branch, branchIndex) => {
        const guaranteed = Math.floor(doubleTime.level / 4);
        const remainder = doubleTime.level % 4;
        const extras = guaranteed + (remainder > 0 && probabilityCheck(this.rng, remainder * .25) ? 1 : 0);
        this.emitSpecial(collectible!, doubleTime, `Double Time created ${extras} additional Score${extras === 1 ? '' : 's'}`,
          'score', undefined, undefined, { amount: extras });
        return [branch, ...Array.from({ length: extras }, (_, index) => ({ ...branch,
          id: `${rootId}:double-time:${branchIndex + 1}:${index + 1}`, cause: 'double_time' as const,
          additional: true, suppressedEffects: [...branch.suppressedEffects, 'wholeDieDoubleTime' as const] }))];
      });
      const loneWolf = collectible && !wholeDieEffectSuppressed(collectible) ? effectOf(collectible, 'loneWolf') : undefined;
      if (loneWolf && intent.source === 'manual' && intent.playerSelectedDieIds.length === 1
        && intent.playerSelectedDieIds[0] === participant.id) branches = branches.flatMap((branch, branchIndex) =>
          [branch, ...Array.from({ length: loneWolf.level }, (_, index) => ({ ...branch,
            id: `${rootId}:lone-wolf:${branchIndex + 1}:${index + 1}`, cause: 'lone_wolf' as const, additional: true }))]);
      const components: ResolvedDiePips['components'] = [];
      for (const occurrence of branches) {
        resolution.scoreOccurrences.push(occurrence);
        const scoreParticipant: ScoringParticipant = { id: occurrence.dieId, face: occurrence.face, role: occurrence.role };
        for (const contribution of this.scoringContributions(scoreParticipant, scoringDice, intent)) {
          this.applyScoringContribution(contribution, occurrence.id);
          components.push({ occurrenceId: occurrence.id, kind: contribution.kind, amount: contribution.amount,
            ...(contribution.effectType ? { effectType: contribution.effectType } : {}),
            ...(contribution.sourceDieIds?.length ? { sourceDieIds: [...contribution.sourceDieIds] } : {}) });
        }
        this.resolveScoreOccurrence(occurrence, scoringParticipants);
      }
      const resolved: ResolvedDiePips = {
        resolutionId: `${intent.id}:pips:${participant.id}`,
        dieId: participant.id,
        role: participant.role,
        face: structuredClone(participant.face),
        occurrenceIds: branches.map(item => item.id),
        components,
        totalPips: this.handAccumulator!.currentPips - runningPipsBefore,
        runningPipsBefore,
        runningPipsAfter: this.handAccumulator!.currentPips,
      };
      resolution.resolvedDicePips.push(resolved);
      this.v2Hand!.resolvedDicePips.push(structuredClone(resolved));
      this.emit({ type: 'DIE_PIPS_RESOLVED', hand: intent.hand, dieIds: [participant.id], face: participant.face.rank,
        amount: resolved.totalPips, pips: resolved.runningPipsAfter, multiplier: this.handAccumulator!.currentMultiplier,
        playSource: intent.source, resolvedDiePips: structuredClone(resolved),
        message: `${this.dieLabel(participant.id)}${participant.role === 'hitchhiker' ? ' Hitchhiker' : ''} contributed ${this.format(resolved.totalPips)} Pips` });
    }
    return [];
  }

  resolveJackpot(scoringDieIds: number[]): number {
    const scoring = new Set(scoringDieIds);
    let total = 0;
    for (const die of this.state.dice) {
      if (die.owner !== 'player') continue;
      const jackpot = effectOf(die, 'jackpot');
      const specialPayout = jackpot && !wholeDieEffectSuppressed(die) ? 3 * jackpot.level : 0;
      if (!specialPayout) continue;
      if (!scoring.has(die.id)) {
        this.log({ type: 'ABILITY_EVALUATED', dieType: 'jackpot', dieIds: [die.id], face: activeFace(die).rank,
          message: `${this.dieLabel(die.id)} Jackpot did not trigger: die did not score in winning hand` });
        continue;
      }
      this.addGold(specialPayout, `${this.dieLabel(die.id)} Jackpot: +${this.format(specialPayout)} Gold`, 'jackpot', die.id);
      this.emitSpecial(die, jackpot!, `Jackpot paid ${specialPayout} Gold`, 'winning_play');
      total += specialPayout;
    }
    if (total) this.log({ type: 'ABILITY_EVALUATED', dieType: 'jackpot', message: `Total Jackpot payout: +${this.format(total)} Gold` });
    return total;
  }

  private chargeFlameSource(flame: ChargeFlame): { investment: number; instanceId: FlameInstanceId } | null {
    const instance = flameByType(this.state, flame);
    return instance ? { investment: instance.investedGold, instanceId: instance.instanceId } : null;
  }
  private growCharge(flame: ChargeFlame, requestedGain: number,
    detail: string, dieIds?: number[], diagnostics?: import('./types').FlameActivationDiagnostics): number {
    const source = this.chargeFlameSource(flame);
    if (!source || requestedGain <= 0) return 0;
    const before = this.state.chargeXMult;
    const after = Number(Math.min(this.state.maxCharge, before + requestedGain).toFixed(12));
    const gain = Number((after - before).toFixed(12));
    this.emitV2({ kind: 'flame_charge_generated', flame, requested: requestedGain, gained: gain,
      lostToCap: Number(Math.max(0, requestedGain - gain).toFixed(12)), before, after, diagnostics });
    if (gain <= 0) return 0;
    this.state.chargeXMult = after;
    this.state.chargeAttribution[source.instanceId] = Number(((this.state.chargeAttribution[source.instanceId] ?? 0) + gain).toFixed(12));
    this.state.stats.chargeGained = Number((this.state.stats.chargeGained + gain).toFixed(12));
    const flameDiagnostics = { ...diagnostics, chargeGained: gain };
    this.triggerFlame(flame, `${detail} · Charge +${this.format(gain)} → ×${this.format(after)}`, undefined, undefined,
      flameDiagnostics);
    this.emit({ type: 'CHARGE_CHANGED', flame, dieIds, xMult: after, flameDiagnostics,
      message: `${FLAMES[flame].name}: Charge +${this.format(gain)} → ×${this.format(after)}` });
    return gain;
  }
  private addMomentumCharge(hand: HandId): void {
    const source = this.chargeFlameSource('momentum');
    if (!source) return;
    this.growCharge('momentum', momentumChargeGain(source.investment), `${HANDS[hand].name} played`);
  }
  private applyPowerSurge(hand: HandId, isHighestLevelHand: boolean): void {
    const source = this.chargeFlameSource('powerSurge');
    if (!source || !isHighestLevelHand) return;
    const before = this.state.chargeXMult;
    const ratio = 3;
    const requestedGain = before * (ratio - 1);
    this.growCharge('powerSurge', requestedGain, `${HANDS[hand].name} multiplied current Charge by ${this.format(ratio)}`);
  }
  private advanceHandFamilyFlames(hand: HandId, appliedFactors: readonly import('./types').XMultFactor[]): void {
    const applied = new Set(appliedFactors.map(factor => factor.source));
    for (const id of HAND_FAMILY_FLAME_IDS) {
      const stage = this.state.handFamilyFlameStages[id];
      if (stage === 'setup' && hand === HAND_FAMILY_FLAMES[id].setup) {
        this.setHandFamilyFlameStage(id, 'payoff', 'setup_play', hand);
      } else if (stage === 'payoff' && hand === HAND_FAMILY_FLAMES[id].payoff && applied.has(id)) {
        this.setHandFamilyFlameStage(id, 'spent', 'payoff_play', hand);
      }
    }
  }
  private addPotentialEnergyCharge(snapshot: HandStartSnapshot, hand: HandId, source: HandPlaySource): void {
    const flame = this.chargeFlameSource('potentialEnergy');
    const ultimate = snapshot.ultimateHands[0];
    if (!flame || source !== 'manual' || !ultimate || !snapshot.ultimatePlayable || snapshot.ultimateHands.includes(hand)) return;
    this.growCharge('potentialEnergy', potentialEnergyChargeGain(flame.investment),
      `${HANDS[ultimate].name} was playable; ${HANDS[hand].name} played`, undefined,
      { ultimateHand: ultimate, alternativeHand: hand });
  }
  private addAllHandsOnDeckCharge(snapshot: HandStartSnapshot): void {
    const flame = this.chargeFlameSource('allHandsOnDeck');
    if (!flame || !snapshot.availablePlayableDieIds.length) return;
    const selected = new Set(snapshot.selectedDieIds);
    if (!snapshot.availablePlayableDieIds.every(id => selected.has(id))
      || selected.size !== snapshot.availablePlayableDieIds.length) return;
    const count = snapshot.availablePlayableDieIds.length;
    this.growCharge('allHandsOnDeck', allHandsOnDeckChargeGain(flame.investment, count),
      `all ${count} available dice Played`, snapshot.selectedDieIds,
      { availableDiceCount: count, playedDiceCount: snapshot.selectedDieIds.length });
  }
  private hotPotatoCandidates(): CollectibleDie[] {
    return activeEncounterDice(this.state).filter((die): die is CollectibleDie => die.owner === 'player');
  }
  private ensureHotPotatoTarget(): number | null {
    if (!flameByType(this.state, 'hotPotatoClock')) {
      this.state.interactiveFlames.hotPotatoDieId = null;
      return null;
    }
    const candidates = this.hotPotatoCandidates();
    const current = this.state.interactiveFlames.hotPotatoDieId;
    if (current !== null && candidates.some(die => die.id === current)) return current;
    const next = candidates.length ? candidates[randomIndex(this.rng, candidates.length)].id : null;
    this.state.interactiveFlames.hotPotatoDieId = next;
    return next;
  }
  private moveHotPotato(previous: number | null): number | null {
    const candidates = this.hotPotatoCandidates();
    if (!flameByType(this.state, 'hotPotatoClock') || !candidates.length) {
      this.state.interactiveFlames.hotPotatoDieId = null;
      return null;
    }
    const pool = candidates.length > 1 ? candidates.filter(die => die.id !== previous) : candidates;
    const next = pool[randomIndex(this.rng, pool.length)].id;
    this.state.interactiveFlames.hotPotatoDieId = next;
    return next;
  }
  private resolveHotPotatoPlay(targetBefore: number | null, playedDieIds: readonly number[]): void {
    const flame = this.chargeFlameSource('hotPotatoClock');
    if (!flame || targetBefore === null) return;
    const played = playedDieIds.includes(targetBefore);
    if (played) this.state.interactiveFlames.hotPotatoStreak = 0;
    else this.state.interactiveFlames.hotPotatoStreak++;
    const streak = this.state.interactiveFlames.hotPotatoStreak;
    const requested = played ? 0 : hotPotatoClockChargeGain(flame.investment, streak);
    const chargeBefore = this.state.chargeXMult;
    const gained = this.growCharge('hotPotatoClock', requested,
      `Hot Potato ${played ? 'was Played; streak reset' : `avoided for ${streak} consecutive Plays`}`,
      [...playedDieIds], { hotPotatoBefore: targetBefore, hotPotatoPlayed: played, hotPotatoStreak: streak,
        chargeBefore, chargeRequested: requested });
    const targetAfter = this.moveHotPotato(targetBefore);
    this.emitV2({ kind: 'flame_action', flame: 'hotPotatoClock', action: { type: 'hot_potato_play',
      targetBefore, played, streak, chargeRequested: requested, chargeGained: gained, targetAfter } });
  }
  private advanceMinigun(hand: HandId): void {
    if (!ownedFlameIds(this.state).has('minigun')) return;
    if (UPPER_HAND_IDS.includes(hand)) {
      this.state.minigunUpperStreak = Math.min(6, this.state.minigunUpperStreak + 1);
      return;
    }
    const before = this.state.minigunUpperStreak;
    if (before <= 0) return;
    this.state.minigunUpperStreak = 0;
    this.emitV2({ kind: 'flame_runtime_changed', flame: 'minigun', change: 'streak_reset', hand,
      from: before, to: 0, reason: 'lower_play' });
  }
  private setHandFamilyFlameStage(id: (typeof HAND_FAMILY_FLAME_IDS)[number],
    to: import('./types').HandFamilyFlameStage,
    reason: 'setup_play' | 'payoff_play' | 'scorecard_refresh' | 'marathon_reuse', hand?: HandId): void {
    const from = this.state.handFamilyFlameStages[id];
    if (!from || from === to) return;
    this.state.handFamilyFlameStages[id] = to;
    this.emitV2({ kind: 'flame_runtime_changed', flame: id, change: 'sequence_stage',
      ...(hand ? { hand } : {}), from, to, reason });
  }
  private resetSpentHandFamilyFlames(reason: 'scorecard_refresh' | 'marathon_reuse', availableSetupHand?: HandId): void {
    for (const id of HAND_FAMILY_FLAME_IDS) {
      if (this.state.handFamilyFlameStages[id] !== 'spent') continue;
      const setup = HAND_FAMILY_FLAMES[id].setup;
      if (availableSetupHand && setup !== availableSetupHand) continue;
      this.setHandFamilyFlameStage(id, 'setup', reason, setup);
    }
  }
  private applyFluxCapacitor(pulledMagneticFaces: number, dieIds: number[]): void {
    const source = this.chargeFlameSource('fluxCapacitor');
    if (!source || pulledMagneticFaces <= 0) return;
    const before = this.state.chargeXMult;
    const multiplier = fluxCapacitorChargeMultiplier(source.investment, pulledMagneticFaces);
    const after = Number(Math.min(this.state.maxCharge, before * multiplier).toFixed(12));
    const gain = Number((after - before).toFixed(12));
    const requested = Number((before * (multiplier - 1)).toFixed(12));
    this.emitV2({ kind: 'flame_charge_generated', flame: 'fluxCapacitor', requested, gained: gain,
      lostToCap: Number(Math.max(0, requested - gain).toFixed(12)), before, after,
      diagnostics: { availableDiceCount: pulledMagneticFaces } });
    this.state.chargeXMult = after;
    if (gain > 0) this.state.chargeAttribution[source.instanceId] = Number(((this.state.chargeAttribution[source.instanceId] ?? 0) + gain).toFixed(12));
    this.state.stats.chargeGained = Number((this.state.stats.chargeGained + gain).toFixed(12));
    if (multiplier <= 1) return;
    this.triggerFlame('fluxCapacitor',
      `${this.format(pulledMagneticFaces)} Roll${pulledMagneticFaces === 1 ? '' : 's'} pulled by Magnetic dice · Charge ×${this.format(multiplier)} → ×${this.format(after)}`);
    this.emit({ type: 'CHARGE_CHANGED', flame: 'fluxCapacitor', dieIds, xMult: after,
      message: `${FLAMES.fluxCapacitor.name}: Charge ×${this.format(before)} × ${this.format(multiplier)} = ×${this.format(after)}` });
  }
  private resolveRoll(intent: RollIntent, rolling: ReadonlySet<number>): RollResolution {
    const die = this.state.dice.find(item => item.id === intent.dieId)!;
    const beforePhysical = die.value;
    const before = activeFace(die).rank;
    const origin = structuredClone(activeFace(die));
    const collectible = die.owner === 'player' ? die : null;
    const specialAllowed = intent.context === 'gameplay' || intent.context === 'settle' || intent.context === 'wardenSetup';
    const ownEffectActive = !!collectible && !wholeDieEffectSuppressed(collectible);
    const forced = (controller: RollResolution['controller'], target: Rank, controllerDieId: number,
      locked = true): RollResolution => {
      const physicalFace = (die.faces.findIndex(face => face.rank === target) + 1 || target) as Rank;
      return { intent, dieId: die.id, before, beforePhysical, physicalFace, value: target,
        weighted: false, attracted: false, controller, controllerDieId, locked, origin,
        specialDieType: collectible?.effects[0]?.type };
    };
    // Locked controller phase: Magic → Magnetic → Clockwork → Tank → Boss → Random.
    // Weighted is applied only inside the final randomized physical-face selection.
    const magic = collectible && ownEffectActive ? effectOf(collectible, 'magic') : undefined;
    const magicRuntime = collectible ? this.specialRuntime(collectible, 'magic') : undefined;
    if (specialAllowed && collectible && magic && magicRuntime && intent.reroll && magicRuntime.magicArmedFace !== null
      && magicRuntime.invocationsRemaining > 0) {
      const target = magicRuntime.magicArmedFace;
      magicRuntime.magicArmedFace = null;
      this.spendInvocation(collectible, magic, `Magic forced Reroll to ${target}`, 'roll_controller');
      return forced('magicDie', target, die.id);
    }
    if (specialAllowed) {
      const magnetic = activeEncounterDice(this.state).find((candidate): candidate is CollectibleDie => candidate.owner === 'player'
        && hasEffect(candidate, 'magnetic') && !rolling.has(candidate.id) && !wholeDieEffectSuppressed(candidate)
        && (this.specialRuntime(candidate, 'magnetic')?.invocationsRemaining ?? 0) > 0);
      if (magnetic) {
        const magneticEffect = requireEffect(magnetic, 'magnetic');
        const target = activeFace(magnetic).rank;
        this.spendInvocation(magnetic, magneticEffect, `Magnetic forced ${this.dieLabel(die.id)} to ${target}`, 'external_roll_controller');
        return { ...forced('magneticDie', target, magnetic.id, false), attracted: true, specialDieType: magneticEffect.type };
      }
    }
    const clockwork = collectible && ownEffectActive ? effectOf(collectible, 'clockwork') : undefined;
    const clockworkRuntime = collectible ? this.specialRuntime(collectible, 'clockwork') : undefined;
    if (specialAllowed && collectible && clockwork && clockworkRuntime && intent.reroll
      && clockworkRuntime.clockworkRolls < 3 * clockwork.level) {
      clockworkRuntime.clockworkRolls++;
      const target = (before === 6 ? 1 : before + 1) as Rank;
      this.emitSpecial(collectible, clockwork, `Clockwork advanced ${before} → ${target} (${clockworkRuntime.clockworkRolls}/${3 * clockwork.level})`,
        'roll_controller');
      return forced('clockworkDie', target, die.id);
    }
    const tank = collectible && ownEffectActive ? effectOf(collectible, 'tank') : undefined;
    const tankRuntime = collectible ? this.specialRuntime(collectible, 'tank') : undefined;
    if (specialAllowed && collectible && tank && tankRuntime && intent.reroll) {
      const beforePips = tankRuntime.temporaryPips;
      tankRuntime.temporaryPips += CONFIG.tankPipsPerTrigger * tank.level;
      this.emitSpecial(collectible, tank, `Tank intercepted Reroll; future Pips ${beforePips} → ${tankRuntime.temporaryPips}`,
        'reroll_intercept');
      return { ...forced('tank', before, die.id), physicalFace: beforePhysical, intercepted: true };
    }
    const previousFaceExcluded = intent.excludeStartingFace;
    const weighted = specialAllowed && collectible && ownEffectActive ? effectOf(collectible, 'weighted') : undefined;
    const weightedConfig = weighted ? { selectedNumber: weighted.persistent.weightedFace, level: weighted.level } : undefined;
    const randomResult = rollPhysicalDie(die, this.rng, previousFaceExcluded ? beforePhysical : undefined, weightedConfig);
    const matchingPhysicalFaces = weightedConfig
      ? die.faces.filter(face => face.rank === weightedConfig.selectedNumber).length : 0;
    return {
      intent, dieId: die.id, before, beforePhysical,
      ...randomResult,
      attracted: false,
      controller: 'rng',
      origin, previousFaceExcluded,
      ...(weightedConfig ? { weightedBias: { selectedNumber: weightedConfig.selectedNumber, matchingPhysicalFaces,
        selectedFaceWeight: weightedSelectedFaceWeight(weightedConfig.level) } } : {}),
    };
  }

  private applyPostRollReactions(batch: RollBatchIntent, results: RollResolution[]): void {
    const triggers: RollTrigger[] = [];
    for (const result of results) {
      const die = this.state.dice.find(item => item.id === result.dieId)!;
      const face = structuredClone(activeFace(die));
      if (result.intercepted) continue;
      this.emit({ type: 'DIE_ROLLED', dieIds: [die.id], face: face.rank,
        rollSource: batch.manual ? 'manual_reroll' : 'automatic', previousFace: result.before, resultFace: face.rank,
        sameFaceExcluded: batch.manual,
        message: `${this.dieLabel(die.id)} rolled: ${result.before} → ${face.rank}${result.controller === 'rng' && result.previousFaceExcluded ? ' · previous face excluded' : ''}` });
      if ((batch.context === 'gameplay' || batch.context === 'wardenSetup') && face.rank === 3) {
        const source = this.chargeFlameSource('thirdRail');
        if (source) this.growCharge('thirdRail', thirdRailChargeGain(source.investment), `${this.dieLabel(die.id)} rolled a 3`, [die.id]);
      }
      if (isCursedDie(die)) {
        this.state.stats.hexerEvents.push({ round: this.state.round, attempt: this.state.roundAttemptNumber,
          kind: batch.reasonText.startsWith('Manual') ? 'manual_reroll' : face.rank === 7 ? 'seven' : 'roll', face: face.rank });
        this.emit({ type: 'CURSED_DIE_ROLLED', boss: 'hexer', dieIds: [die.id], face: face.rank,
          message: `Cursed Die rolled ${face.rank}` });
      }
      const jumpingBean = die.owner === 'player' ? effectOf(die, 'jumpingBean') : undefined;
      const jumpingBeanRoll = batch.context === 'gameplay' || batch.context === 'wardenSetup' || batch.context === 'settle';
      if (jumpingBeanRoll && die.owner === 'player' && jumpingBean && !wholeDieEffectSuppressed(die)
        && face.rank !== 7 && face.rank === jumpingBean.persistent.jumpingBeanNumber) {
        const runtime = this.specialRuntime(die, 'jumpingBean');
        if (runtime && runtime.invocationsRemaining > 0) {
          const beforeUses = runtime.invocationsRemaining;
          runtime.invocationsRemaining--;
          this.emitSpecial(die, jumpingBean,
            `Jumping Bean rolled selected number ${face.rank}; use ${beforeUses} to ${runtime.invocationsRemaining}`,
            'post_roll', beforeUses, runtime.invocationsRemaining, { face: face.rank });
          triggers.push({ dieId: die.id, face, kind: 'jumpingBean', rerollEventId: batch.id,
            selectedNumber: jumpingBean.persistent.jumpingBeanNumber });
        }
      }
    }
    const attracted = results.filter(result => result.attracted);
    if (attracted.length && batch.context === 'gameplay')
      this.applyFluxCapacitor(attracted.length, attracted.map(result => result.dieId));
    if (batch.context === 'gameplay' || batch.context === 'wardenSetup' || batch.context === 'settle') this.queue.push(...triggers);
  }

  rollBatch(dieIds: number[], reason: string, context: RollContext, _excludeStartingFace = false,
    reasonId: RollReason = 'other'): void {
    const ids = orderDieIdsByEncounter(this.state, [...new Set(dieIds)]);
    if (!ids.length) return;
    const batchId = `${this.state.historyV2TimelineId}:${this.state.round}:${this.state.nextActionId}:${this.state.nextHistorySeq}`;
    const batch = createRollBatchIntent(batchId, ids, reason, context, reasonId);
    if (batch.manual) this.resolveCurtainCallsBeforeManualReroll(batch);
    const parentSeq = this.v2ParentSeq;
    this.v2ParentSeq = undefined;
    this.v2Roll = { effects: [] };
    this.emit({ type: 'DICE_REROLL_STARTED', dieIds: ids, rollReason: reasonId,
      message: `${reason}: ${ids.map(id => this.dieLabel(id)).join(', ')}` });
    const rolling = new Set(ids);
    const results = ids.map(dieId => this.resolveRoll(createRollIntent(batch, dieId), rolling));
    const magician = !this.state.bossSilenced && this.state.boss?.type === 'magician' ? this.state.boss : null;
    const finalOpportunity = (reasonId === 'manual' || reasonId === 'post_hand')
      && magician && magician.completedHands.length < magician.calledHands.length
      && usableManualRerolls(this.state) === 0 && currentlyPlayableManualHands(this.state).length === 0;
    if (finalOpportunity) {
      const outstanding = magician.calledHands.filter(hand => !magician.completedHands.includes(hand))
        .map(hand => HANDS[hand].rank!).filter((rank): rank is Rank => rank !== undefined);
      const candidates = results.flatMap((result, resultIndex) => result.controller === 'rng' && !result.intercepted
        ? this.state.dice.find(die => die.id === result.dieId)!.faces.flatMap((face, faceIndex) =>
          outstanding.includes(face.rank) && (!result.previousFaceExcluded || faceIndex + 1 !== result.beforePhysical)
            ? [{ resultIndex, faceIndex, rank: face.rank }] : []) : []);
      if (candidates.length) {
        const eligibleRanks = outstanding.filter(rank => candidates.some(item => item.rank === rank));
        const chosenRank = eligibleRanks[randomIndex(this.rng, eligibleRanks.length)];
        const matching = candidates.filter(item => item.rank === chosenRank);
        const chosen = matching.length ? matching[randomIndex(this.rng, matching.length)] : candidates[randomIndex(this.rng, candidates.length)];
        results[chosen.resultIndex] = { ...results[chosen.resultIndex], physicalFace: chosen.faceIndex + 1 as Rank,
          value: chosen.rank, weighted: false, weightedBias: undefined };
      }
    }
    for (const result of results) if (!result.intercepted)
      this.state.dice.find(item => item.id === result.dieId)!.value = result.physicalFace;
    this.applyPostRollReactions(batch, results);
    const effects = this.v2Roll.effects;
    this.v2Roll = null;
    const event = this.emitV2({ kind: 'roll_batch', parentSeq, reason: reasonId,
      context: context === 'wardenSetup' ? 'warden_setup' : context === 'flameSelection' ? 'flame_selection' : context,
      dieIds: ids, heldDieIds: [...new Set(results.flatMap(result => result.controller === 'magneticDie' && result.controllerDieId !== undefined
        ? [result.controllerDieId] : []))], spend: this.v2ManualSpend, effects,
      results: results.map(result => {
        const die = this.state.dice.find(item => item.id === result.dieId)!;
        return { dieId: result.dieId, beforePhysicalFace: result.beforePhysical, afterPhysicalFace: result.physicalFace,
          beforeFace: result.before, afterFace: activeFace(die).rank,
          previousFaceExcluded: batch.manual,
          weighted: result.weightedBias ? { sourceFace: result.weightedBias.selectedNumber,
            stacks: result.weightedBias.matchingPhysicalFaces,
            destinationWeight: die.faces[result.physicalFace - 1].rank === result.weightedBias.selectedNumber
              ? result.weightedBias.selectedFaceWeight : 1,
            selectedNumber: result.weightedBias.selectedNumber,
            matchingPhysicalFaces: result.weightedBias.matchingPhysicalFaces } : null,
          magneticAnchorIds: result.attracted
            ? result.controllerDieId !== undefined ? [result.controllerDieId] : []
            : [], controller: result.controller,
          ...(result.controllerDieId === undefined ? {} : { controllerDieId: result.controllerDieId }),
          ...(result.locked === undefined ? {} : { locked: result.locked }),
          ...(result.intercepted === undefined ? {} : { intercepted: result.intercepted }),
          };
      }) });
    this.v2ManualSpend = null;
    this.lastV2RollSeq = event.seq;
    if (event.kind === 'roll_batch') this.trace({ kind: 'roll_batch', reason: reasonId, dieIds: [...ids],
      results: event.results.map(result => ({ dieId: result.dieId, before: result.beforeFace, after: result.afterFace })) });
  }
  drain(): void {
    let cursor = 0;
    while (cursor < this.queue.length) {
      const item = this.queue[cursor++];
      if (item.kind === 'jumpingBean') {
        const hand = UPPER_HAND_BY_FACE[item.selectedNumber];
        if (!hand) continue;
        this.v2ParentSeq = this.lastV2RollSeq;
        this.play(hand, [item.dieId], 'jumpingBean');
        this.emit({ type: 'JUMPING_BEAN_FREE_PLAY', dieType: 'jumpingBean', hand, dieIds: [item.dieId],
          playSource: 'jumpingBean', handConsumed: false,
          message: `Jumping Bean ${item.selectedNumber}: Free Played ${HANDS[hand].name}; automatic follow-up Roll` });
        this.rollBatch([item.dieId], 'Jumping Bean automatic follow-up Roll', 'gameplay', false, 'jumping_bean_followup');
      }
    }
    this.queue = [];
  }

  private resolveCurtainCallsBeforeManualReroll(batch: RollBatchIntent): void {
    for (const dieId of batch.dieIds) {
      const die = this.collectible(dieId);
      const curtainCall = die ? effectOf(die, 'freePlay') : undefined;
      if (!die || !curtainCall || wholeDieEffectSuppressed(die)) continue;
      const face = structuredClone(activeFace(die));
      const hand = UPPER_HAND_BY_FACE[face.rank];
      if (!hand) continue;
      const detail = `Curtain Call before Manual Reroll · Free Played ${HANDS[hand].name} · ×${curtainCall.level} die Pips`;
      this.emitSpecial(die, curtainCall, detail, 'manual_reroll', undefined, undefined, { face: face.rank });
      this.curtainCallContext = { dieId, multiplier: curtainCall.level, manualRerollEventId: batch.id };
      try {
        this.play(hand, [dieId], 'freePlay');
      } finally {
        this.curtainCallContext = null;
      }
      this.emit({ type: 'JUMPING_BEAN_FREE_PLAY', dieType: 'freePlay', hand, dieIds: [dieId], face: face.rank,
        playSource: 'freePlay', handConsumed: false,
        message: `Curtain Call Free Played ${HANDS[hand].name} at ×${curtainCall.level} die Pips before Manual Reroll` });
    }
  }

  private advanceHotStreak(hand: HandId, _scoringIds: number[]): void {
    if (this.state.hotStreakGoal !== hand) return;
    const qualified = flameByType(this.state, 'hotStreak') !== null;
    if (qualified) { this.state.hotStreakCharges++; this.state.stats.hotStreakCharges++; }
    let index = HOT_STREAK_SEQUENCE.indexOf(hand) + 1;
    while (index < HOT_STREAK_SEQUENCE.length && this.state.consumed.includes(HOT_STREAK_SEQUENCE[index])) {
      this.state.stats.hotStreakSkippedHands.push({ round: this.state.round, hand: HOT_STREAK_SEQUENCE[index] });
      index++;
    }
    this.state.hotStreakGoal = HOT_STREAK_SEQUENCE[index] ?? null;
    this.emitV2({ kind: 'flame_sequence', flame: 'hotStreak', stepIndex: index - 1,
      requiredHandBefore: hand, playedHand: hand, advanced: true,
      factorApplied: qualified ? hotStreakMultiplier(flameByType(this.state, 'hotStreak')?.investedGold ?? 0,
        this.state.hotStreakCharges) : undefined,
      newRequiredHand: this.state.hotStreakGoal, completed: this.state.hotStreakGoal === null, playSource: 'manual' });
    this.emit({ type: 'HOT_STREAK_CHANGED', flame: 'hotStreak', hand, amount: this.state.hotStreakCharges,
      message: `Hot Streak ${qualified ? `gained charge ${this.format(this.state.hotStreakCharges)}` : 'advanced without charge'}; next ${this.state.hotStreakGoal ? HANDS[this.state.hotStreakGoal].name : 'complete'}` });
  }
  private issueCallerCall(previous?: HandId): void {
    if (this.state.bossSilenced) return;
    const boss = this.state.boss;
    if (boss?.type !== 'caller') return;
    boss.manualHandsPlayed ??= Math.max(0, 3 - boss.playsRemaining);
    boss.callDeadline ??= boss.manualHandsPlayed + boss.playsRemaining;
    let candidates = CALLER_HAND_POOL.filter(hand => !this.state.consumed.includes(hand)
      && handIsPhysicallyAttainable(hand, rosterDice(this.state).length));
    if (previous && candidates.length > 1) candidates = candidates.filter(hand => hand !== previous);
    if (!candidates.length) return;
    boss.calledHand = candidates[randomIndex(this.rng, candidates.length)];
    boss.callDeadline += 3;
    boss.playsRemaining = Math.max(0, boss.callDeadline - boss.manualHandsPlayed);
    boss.satisfied = false;
    boss.satisfyingSource = null;
    this.emit({ type: 'CALLER_CALLED', boss: 'caller', hand: boss.calledHand, amount: boss.playsRemaining,
      message: `The Caller demands ${HANDS[boss.calledHand].name} by manual hand ${this.format(boss.callDeadline)}` });
  }
  private resolveCallerCall(hand: HandId, source: HandPlaySource): void {
    if (this.state.bossSilenced) return;
    const boss = this.state.boss;
    if (boss?.type !== 'caller') return;
    boss.manualHandsPlayed ??= Math.max(0, 3 - boss.playsRemaining);
    boss.callDeadline ??= boss.manualHandsPlayed + boss.playsRemaining;
    const previous = boss.calledHand;
    if (source === 'manual') {
      boss.manualHandsPlayed++;
      boss.playsRemaining = Math.max(0, boss.callDeadline - boss.manualHandsPlayed);
    }
    if (hand === boss.calledHand) {
      boss.satisfied = true;
      boss.satisfyingSource = source;
      boss.callsCompleted = (boss.callsCompleted ?? 0) + 1;
      this.state.stats.callerEvents.push({ round: this.state.round, attempt: this.state.roundAttemptNumber,
        calledHand: boss.calledHand, playsRemaining: boss.playsRemaining, satisfied: true, source, expired: false });
      this.emit({ type: 'CALLER_CHANGED', boss: 'caller', hand, playSource: source,
        message: `${HANDS[hand].name} answered The Caller${source === 'jumpingBean' ? ' via Jumping Bean' : ''}` });
      this.issueCallerCall(previous);
      return;
    }
    if (source === 'jumpingBean') return;
    const expired = boss.manualHandsPlayed >= boss.callDeadline;
    this.state.stats.callerEvents.push({ round: this.state.round, attempt: this.state.roundAttemptNumber,
      calledHand: boss.calledHand, playsRemaining: boss.playsRemaining, satisfied: false, source, expired });
    this.emit({ type: 'CALLER_CHANGED', boss: 'caller', hand, playSource: source, amount: boss.playsRemaining,
      message: `${HANDS[hand].name} did not answer ${HANDS[boss.calledHand].name} · ${this.format(Math.max(0, boss.playsRemaining))} plays remain` });
    if (!expired) return;
    boss.callsMissed = (boss.callsMissed ?? 0) + 1;
    if (this.state.score >= this.state.target) {
      this.emit({ type: 'CALLER_CHANGED', boss: 'caller', amount: 0,
        message: 'The Caller missed call, but the scored hand cleared the encounter before the penalty.' });
      return;
    }
    const before = this.state.score;
    const after = roundPositiveScoreHalf(before);
    const penalty = after - before;
    if (penalty) this.addScore(penalty, 'boss', `The Caller missed call: ${this.format(before)} → ${this.format(after)}`, [], undefined);
    else this.emit({ type: 'CALLER_CHANGED', boss: 'caller', amount: 0, message: 'The Caller missed call; round score remains 0' });
    this.issueCallerCall(previous);
  }

  private advanceMarathon(hand: HandId, source: HandPlaySource): void {
    if (this.state.bossSilenced) return;
    const boss = this.state.boss;
    if (boss?.type !== 'marathon' || source !== 'manual') return;
    const reusedHands: HandId[] = [];
    for (const id of HAND_IDS) {
      const remaining = boss.cooldowns[id];
      if (!remaining) continue;
      if (remaining <= 1) { delete boss.cooldowns[id]; reusedHands.push(id); }
      else boss.cooldowns[id] = remaining - 1;
    }
    for (const reused of reusedHands) this.resetSpentHandFamilyFlames('marathon_reuse', reused);
    boss.cooldowns[hand] = 6;
    this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'marathon', hand, amount: 6,
      message: `${HANDS[hand].name} entered a 6-play cooldown` });
  }

  private refreshScorecardIfFilled(): boolean {
    // Marathon owns hand availability through cooldowns, not ordinary Used state.
    if (this.state.boss?.type === 'marathon') return false;
    const cycle = new Set(this.state.scorecardCycleConsumed);
    const relevantHands = scorecardCycleRelevantHands(this.state);
    if (!relevantHands.length || !relevantHands.every(hand => cycle.has(hand))) return false;
    const encounterLocks = !this.state.bossSilenced && this.state.boss?.type === 'neglected' && !this.state.boss.restored
      ? this.state.boss.neglectedHands : [];
    this.state.consumed = [...encounterLocks];
    this.state.scorecardCycleConsumed = [];
    this.resetSpentHandFamilyFlames('scorecard_refresh');
    this.resetCompletedFullSequences();
    this.addTemper(2, 'boardRefresh', 'BOARD REFRESH');
    this.emit({ type: 'SCORECARD_REFRESHED', amount: 2, message: 'BOARD REFRESH \u00b7 +2 TEMPER \u00b7 all Hands refreshed' });
    return true;
  }

  private resolveQuickdraw(hand: HandId, _source: HandPlaySource): void {
    if (this.state.bossSilenced) return;
    const boss = this.state.boss;
    if (boss?.type !== 'quickdraw' || !LOWER_HAND_IDS.includes(hand)) return;
    const first = !boss.lowerShotUsed;
    boss.lowerShotUsed = true;
    boss.playedLowerHand = hand;
    this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'quickdraw', hand,
      message: first ? `${HANDS[hand].name} used Quickdraw's full-value Lower Play`
        : `${HANDS[hand].name} scored with Quickdraw ×0.25` });
  }
  private advanceProgressiveFlames(hand: HandId, source: HandPlaySource): void {
    for (const id of ['topDown', 'countDown'] as const satisfies readonly ProgressiveSequenceFlame[]) {
      const flame = flameByType(this.state, id);
      if (!flame) continue;
      const definition = PROGRESSIVE_FLAME_SEQUENCES[id];
      const before = Math.max(0, Math.min(definition.hands.length, this.state.progressiveFlames[id]));
      const required = definition.hands[before] ?? null;
      const advanced = required === hand;
      let after = before;
      if (advanced) {
        after++;
        while (after < definition.hands.length && this.state.consumed.includes(definition.hands[after])) after++;
        this.state.progressiveFlames[id] = after;
      }
      this.emitV2({ kind: 'flame_sequence', flame: id, stepIndex: before,
        requiredHandBefore: required, playedHand: hand, advanced,
        ...(advanced ? { factorApplied: progressiveSequenceMultiplier(id, flame.investedGold, before) } : {}),
        newRequiredHand: definition.hands[after] ?? null, completed: after >= definition.hands.length,
        playSource: source });
    }
  }

  private resetCompletedFullSequences(): void {
    if (this.state.hotStreakGoal === null && flameByType(this.state, 'hotStreak')) {
      this.state.hotStreakGoal = HOT_STREAK_SEQUENCE[0];
      this.state.hotStreakCharges = 0;
      this.emitV2({ kind: 'flame_sequence', flame: 'hotStreak', stepIndex: HOT_STREAK_SEQUENCE.length,
        requiredHandBefore: null, playedHand: null, advanced: false, newRequiredHand: HOT_STREAK_SEQUENCE[0],
        completed: false, resetReason: 'scorecard_refresh' });
    }
    for (const id of ['topDown', 'countDown'] as const satisfies readonly ProgressiveSequenceFlame[]) {
      const sequence = PROGRESSIVE_FLAME_SEQUENCES[id];
      if (!flameByType(this.state, id) || this.state.progressiveFlames[id] < sequence.hands.length) continue;
      this.state.progressiveFlames[id] = 0;
      this.emitV2({ kind: 'flame_sequence', flame: id, stepIndex: sequence.hands.length,
        requiredHandBefore: null, playedHand: null, advanced: false, newRequiredHand: sequence.hands[0],
        completed: false, resetReason: 'scorecard_refresh' });
    }
  }

  private resolvePendulum(hand: HandId): void {
    if (this.state.bossSilenced || this.state.boss?.type !== 'pendulum') return;
    const section = HANDS[hand].rank ? 'upper' : 'lower';
    if (section !== this.state.boss.requestedSection) {
      this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'pendulum', hand, amount: .5,
        bossState: `remained_${this.state.boss.requestedSection}`,
        message: `${HANDS[hand].name} missed the requested ${this.state.boss.requestedSection.toUpperCase()} section · Pendulum ×0.5` });
      return;
    }
    this.state.boss.requestedSection = section === 'upper' ? 'lower' : 'upper';
    this.state.boss.switches++;
    this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'pendulum', hand, amount: 1,
      bossState: `requested_${this.state.boss.requestedSection}`,
      message: `${HANDS[hand].name} satisfied The Pendulum · now requests ${this.state.boss.requestedSection.toUpperCase()}` });
  }

  private flyFactor(hand: HandId, source: HandPlaySource): number {
    if (this.state.bossSilenced) return 1;
    const boss = this.state.boss;
    if (boss?.type !== 'fly' || boss.caught) return 1;
    if (source === 'manual' && hand === boss.flyHand) {
      boss.caught = true;
      boss.flyHand = null;
      this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'fly', hand, amount: 1, bossState: 'caught',
        message: `The Fly was caught on ${HANDS[hand].name}; this hand scores at full value` });
      return 1;
    }
    return .5;
  }

  private moveFly(): void {
    if (this.state.bossSilenced) return;
    const boss = this.state.boss;
    if (boss?.type !== 'fly' || boss.caught || boss.flyHand === null) return;
    const previous = boss.flyHand;
    const activeDice = activeEncounterDice(this.state);
    boss.mercyActive ||= this.state.manualRerollsRemaining === 0
      || UPPER_HAND_IDS.filter(hand => this.state.consumed.includes(hand)).length >= 4;
    let candidates = LOWER_HAND_IDS.filter(hand => !unavailableEncounterHands(this.state).includes(hand)
      && handIsPhysicallyAttainable(hand, activeDice.length));
    if (boss.mercyActive) {
      const qualified = handOptions(activeDice, unavailableEncounterHands(this.state), [], this.state.dieRoundState)
        .filter(option => LOWER_HAND_IDS.includes(option.id) && !option.consumed && candidates.includes(option.id))
        .map(option => option.id);
      if (qualified.length) candidates = qualified;
    }
    if (candidates.length > 1) candidates = candidates.filter(hand => hand !== previous);
    if (!candidates.length) { boss.flyHand = null; return; }
    boss.flyHand = candidates[randomIndex(this.rng, candidates.length)];
    boss.moves++;
    this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'fly', hand: boss.flyHand, bossState: 'target',
      message: `The Fly moved from ${HANDS[previous].name} to ${HANDS[boss.flyHand].name}` });
  }

  private resolveMiniBossHand(hand: HandId): boolean {
    if (this.state.bossSilenced) return false;
    const boss = this.state.boss;
    if (!boss) return false;
    if (boss.type === 'capitalReturn' && LOWER_HAND_IDS.includes(hand)) {
      const lost = Math.min(1, this.state.gold);
      this.state.gold -= lost;
      this.emit({ type: 'BOSS_HAND_CHANGED', boss: boss.type, hand, amount: lost,
        message: `Capital Return charged ${this.format(lost)} Gold for ${HANDS[hand].name}` });
    }
    if (boss.type === 'mugger' && !boss.spent && hand === boss.hiddenHand) {
      const stolen = Math.min(5, this.state.gold);
      this.state.gold -= stolen;
      boss.spent = true;
      boss.revealedHand = hand;
      this.emit({ type: 'BOSS_HAND_CHANGED', boss: boss.type, hand, amount: stolen,
        message: `The Mugger revealed ${HANDS[hand].name} and stole ${this.format(stolen)} Gold` });
    }
    if (boss.type !== 'magician' || boss.returned || !boss.calledHands.includes(hand)
      || boss.completedHands.includes(hand)) return false;
    boss.completedHands.push(hand);
    this.emit({ type: 'BOSS_HAND_CHANGED', boss: boss.type, hand, amount: boss.completedHands.length,
      message: `The Magician call completed: ${HANDS[hand].name} (${this.format(boss.completedHands.length)} / 3)` });
    if (boss.completedHands.length < boss.calledHands.length) return false;
    const die = boss.missingDieId === null ? undefined : this.state.dice.find(item => item.id === boss.missingDieId);
    if (!die) throw new Error('The Magician could not return its missing die.');
    boss.returned = true;
    this.emit({ type: 'BOSS_HAND_CHANGED', boss: boss.type, dieIds: [die.id],
      message: `The Magician returned ${this.dieLabel(die.id)}` });
    this.rollBatch([die.id], 'The Magician return roll', 'gameplay', false, 'magician_return');
    return true;
  }

  private restoreMagicianDie(): void {
    const boss = this.state.boss;
    if (boss?.type !== 'magician' || boss.returned) return;
    boss.returned = true;
  }

  private jugglerExtraReroll(hand: HandId, alreadyRolling: ReadonlySet<number>): number | null {
    if (this.state.bossSilenced || this.state.boss?.type !== 'juggler' || !UPPER_HAND_IDS.includes(hand)) return null;
    const eligible = rosterDice(this.state).map(die => die.id).filter(id => !alreadyRolling.has(id));
    if (!eligible.length) return null;
    const dieId = eligible[randomIndex(this.rng, eligible.length)];
    this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'juggler', hand, dieIds: [dieId], bossState: 'triggered',
      message: `The Juggler added ${this.dieLabel(dieId)} to the Roll after ${HANDS[hand].name}` });
    return dieId;
  }

  private resolveHandScore(resolution: HandResolution, handStart: HandStartSnapshot, handLevel: number,
    chargeAttributionAtHandStart: Partial<Record<FlameInstanceId, number>>) {
    const { hand, source: playSource } = resolution.intent;
    const scoringIds = resolution.scoringParticipants.map(participant => participant.id);
    const xMultFactors = handXMultContributions(handStart, hand, handLevel, scoringIds);
    for (const factor of xMultFactors) {
      const origin: FlameOrigin = factor.source === 'charge' ? 'charge'
        : handStart.flames.find(flame => flame.instanceId === factor.flameInstanceId)?.stage ?? 'external';
      const chargeSources = factor.source === 'charge' ? Object.entries(chargeAttributionAtHandStart)
        .filter((entry): entry is [string, number] => (entry[1] ?? 0) > 0)
        .flatMap(([rawInstanceId, attributed]) => {
          const instanceId = Number(rawInstanceId);
          const instance = handStart.flames.find(flame => flame.instanceId === instanceId);
          return instance ? [{ flame: instance.type, instanceId,
          origin: instance.stage,
          attributed,
          factor: handStart.chargeXMult / Math.max(1, handStart.chargeXMult - attributed) }] : [];
        }) : undefined;
      const sourceInstanceId = factor.source === 'charge' ? null : factor.flameInstanceId ?? null;
      this.v2Hand!.xMultContributions.push({ sourceId: factor.source, origin, factor: factor.value,
        ...(sourceInstanceId === null ? {} : { sourceInstanceId }),
        ...(factor.dieId === null ? {} : { dieId: factor.dieId }),
        ...(factor.input === undefined ? {} : { input: factor.input }),
        ...(factor.diagnostics ? { diagnostics: structuredClone(factor.diagnostics) } : {}),
        ...(chargeSources?.length ? { chargeSources } : {}) });
      if (factor.source === 'speedDemon') this.emit({ type: 'SPEED_DEMON_REVEALED', flame: 'speedDemon', hand,
        dieIds: factor.dieId === null ? undefined : [factor.dieId], xMult: factor.value, xMultFactor: factor,
        decisionMs: handStart.speedDemonDecisionMs ?? undefined,
        message: `Speed Demon ×${this.format(factor.value)}` });
      const beforeXMult = resolution.accumulator.currentXMult;
      applyXMult(resolution.accumulator, factor);
      if (factor.source !== 'charge')
        this.triggerFlame(factor.source, `factor ×${this.format(factor.value)}`, hand, factor.value, factor.diagnostics);
      this.emit({ type: 'HAND_XMULT_CHANGED', flame: factor.source === 'charge' ? undefined : factor.source, hand,
        dieIds: factor.dieId === null ? undefined : [factor.dieId], xMult: resolution.accumulator.currentXMult,
        xMultFactor: factor,
        message: `${factor.source === 'charge' ? 'Charge' : FLAMES[factor.source].name}: XMult ×${this.format(beforeXMult)} × factor ×${this.format(factor.value)} = ×${this.format(resolution.accumulator.currentXMult)}` });
    }
    if (xMultFactors.some(factor => factor.source === 'fetch')) {
      const completed = this.state.fetchTarget;
      this.setFetchTarget(completed);
      if (completed && this.state.fetchTarget) this.log({ type: 'ABILITY_EVALUATED', flame: 'fetch',
        dieIds: [completed.dieId, this.state.fetchTarget.dieId], face: completed.physicalFace,
        message: `Fetch hit on ${this.dieLabel(completed.dieId)} face ${completed.physicalFace} · new target ${this.dieLabel(this.state.fetchTarget.dieId)} face ${this.state.fetchTarget.physicalFace}` });
    }
    this.advanceHandFamilyFlames(hand, xMultFactors);
    const bossFactor = this.flyFactor(hand, playSource)
      * (!this.state.bossSilenced && this.state.boss?.type === 'quickdraw'
        && LOWER_HAND_IDS.includes(hand) && this.state.boss.lowerShotUsed ? .25 : 1)
      * (!this.state.bossSilenced && this.state.boss?.type === 'pendulum'
        && (HANDS[hand].rank ? 'upper' : 'lower') !== this.state.boss.requestedSection ? .5 : 1);
    return { ...finalizeHandScore(resolution.accumulator, bossFactor), bossFactor };
  }

  private advanceNeglected(): void {
    if (this.state.bossSilenced || this.state.boss?.type !== 'neglected' || this.state.boss.restored) return;
    const boss = this.state.boss;
    boss.handsPlayed = Math.min(6, boss.handsPlayed + 1);
    if (boss.handsPlayed < 6) {
      this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'neglected', hands: [...boss.neglectedHands],
        amount: boss.handsPlayed, bossState: 'restricted',
        message: `The Neglected remains active (${this.format(boss.handsPlayed)} / 6 hands played)` });
      return;
    }
    boss.restored = true;
    this.state.consumed = this.state.consumed.filter(hand => !boss.neglectedHands.includes(hand));
    this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'neglected', hands: [...boss.neglectedHands], amount: boss.handsPlayed,
      bossState: 'restored', message: `The Neglected restored ${boss.neglectedHands.map(hand => HANDS[hand].name).join(' and ')}` });
  }

  private ensureNeglectedOpeningPlay(): void {
    if (this.state.bossSilenced || this.state.boss?.type !== 'neglected' || this.state.boss.restored) return;
    const boss = this.state.boss;
    const dice = activeEncounterDice(this.state);
    const hasPlay = (locks: HandId[]) => handOptions(dice, locks, [], this.state.dieRoundState)
      .some(option => !option.consumed && !handIsStructurallyImpossible(option.id, dice.length));
    if (hasPlay(boss.neglectedHands)) return;
    const eligible = HAND_IDS.filter(hand => !handIsStructurallyImpossible(hand, dice.length));
    for (let first = 0; first < eligible.length; first++) for (let second = first + 1; second < eligible.length; second++) {
      const locks = [eligible[first], eligible[second]];
      if (!hasPlay(locks)) continue;
      this.state.consumed = this.state.consumed.filter(hand => !boss.neglectedHands.includes(hand));
      boss.neglectedHands = locks;
      this.state.consumed.push(...locks);
      return;
    }
  }

  private postHandRerolls(shapeParticipants: { id: number; face: Face }[]): Set<number> {
    const normalRerolls = shapeParticipants.map(({ id }) => id);
    const crawlerRerolls = !this.state.bossSilenced && this.state.boss?.type === 'crawler' && normalRerolls.length > 1
      ? [normalRerolls[randomIndex(this.rng, normalRerolls.length)]] : normalRerolls;
    const rerolls = new Set(crawlerRerolls);
    if (crawlerRerolls.length !== normalRerolls.length) this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'crawler', dieIds: crawlerRerolls,
      message: `The Crawler limited the scoring reroll to ${this.dieLabel(crawlerRerolls[0])}` });
    return rerolls;
  }

  private resolvePostPlayRerolls(resolution: HandResolution, winning: boolean,
    beanRecordIndex: number | null): { winning: boolean; beanRecordIndex: number | null } {
    const freePlay = resolution.intent.source !== 'manual';
    const baseRerolls = freePlay ? new Set<number>() : this.postHandRerolls(resolution.selectedParticipants);
    const jugglerExtra = this.jugglerExtraReroll(resolution.intent.hand, baseRerolls);
    if (jugglerExtra !== null) baseRerolls.add(jugglerExtra);
    const rerolls = [...baseRerolls];
    const reason = jugglerExtra !== null ? 'The Juggler post-hand roll' : 'Post-hand reroll';
    const reasonId = jugglerExtra !== null ? 'juggler' as const : 'post_hand' as const;
    if (winning) {
      if (rerolls.length) {
        this.rollBatch(rerolls, jugglerExtra !== null ? reason : 'Winning hand settle reroll',
          'settle', false, jugglerExtra !== null ? 'juggler' : 'winning_settle');
        this.drain();
        if (!this.activeScorePackage || this.activeScorePackage.initiatingSource !== 'manual') this.evaluate();
      }
      return { winning, beanRecordIndex };
    }
    if (freePlay) {
      if (rerolls.length) {
        this.rollBatch(rerolls, reason, 'gameplay', false, reasonId);
        this.drain();
      }
      this.moveFly();
      return { winning, beanRecordIndex };
    }
    this.rollBatch(rerolls, reason, 'gameplay', false, reasonId);
    this.drain();
    this.moveFly();
    if (this.state.score < this.state.target) this.refreshScorecardIfFilled();
    if (!this.activeScorePackage || this.activeScorePackage.initiatingSource !== 'manual') this.evaluate();
    if (this.state.phase === 'round') this.state.decisionId++;
    return { winning: this.state.score >= this.state.target, beanRecordIndex: null };
  }

  private resolveSnakeEyes(scoringIds: number[]): void {
    if (this.state.bossSilenced) return;
    const boss = this.state.boss;
    if (boss?.type !== 'snakeEyes') return;
    const scoredDice = [...new Set(scoringIds)].map(id => this.state.dice.find(die => die.id === id)!)
      .filter(die => die.owner === 'player' && !activeFace(die).bossMutation && activeFace(die).rank !== 1);
    for (const die of scoredDice) {
      const physicalFace = die.value;
      const face = activeFace(die);
      face.bossMutation = { kind: 'snakeEyes', originalRank: face.rank };
      face.rank = 1;
      boss.mutatedFaces.push({ dieId: die.id, physicalFace });
      this.emit({ type: 'BOSS_FACE_CHANGED', boss: 'snakeEyes', dieIds: [die.id], face: 1,
        message: `${this.dieLabel(die.id)} face ${physicalFace} became Snake-Eyed (1)` });
    }
  }
  private resolveInfected(scoringIds: number[]): void {
    if (this.state.bossSilenced) return;
    const boss = this.state.boss;
    if (boss?.type !== 'infected') return;
    for (const die of [...new Set(scoringIds)].map(id => this.state.dice.find(item => item.id === id)!)
      .filter(item => item.owner === 'player' && activeFace(item).bossMutation?.kind !== 'infected')) {
      const physicalFace = die.value;
      activeFace(die).bossMutation = { kind: 'infected' };
      boss.infectedFaces.push({ dieId: die.id, physicalFace });
      this.emit({ type: 'BOSS_FACE_CHANGED', boss: 'infected', dieIds: [die.id], face: activeFace(die).rank,
        message: `${this.dieLabel(die.id)} face ${physicalFace} became infected after scoring` });
    }
  }
  unlockWardenDie(dieId: number): void {
    const boss = this.state.boss;
    if (boss?.type !== 'warden' || boss.pendingReinforcements <= 0) throw new Error('Warden unlock attempted without a pending choice.');
    const starting = boss.startingDieId === null;
    boss.activeDieIds.push(dieId);
    this.ensureHotPotatoTarget();
    if (starting) boss.startingDieId = dieId;
    boss.pendingReinforcements--;
    if (!boss.unlockCosts.length) {
      boss.unlockCosts = wardenUnlockCosts(this.state.handLevels, this.state.consumed, this.state.target, boss.encounterDieIds.length);
    }
    boss.nextUnlockTarget = boss.activeDieIds.length < boss.encounterDieIds.length
      ? boss.unlockCosts.slice(0, boss.activeDieIds.length).reduce((sum, cost) => sum + cost, 0n)
      : null;
    if (boss.nextUnlockTarget !== null) boss.unlockTargets.push(boss.nextUnlockTarget);
    this.state.stats.wardenEvents.push({ round: this.state.round, attempt: this.state.roundAttemptNumber,
      kind: starting ? 'starting_die' : 'reinforcement', dieId, activeDice: boss.activeDieIds.length });
    const encounter = this.state.stats.bossEncounters.at(-1);
    if (encounter?.boss === 'warden') {
      if (starting) encounter.wardenStartingDieId = dieId;
      encounter.wardenUnlockTargets = [...boss.unlockTargets];
    }
    this.emit({ type: 'WARDEN_REINFORCEMENT', boss: 'warden', dieIds: [dieId],
      message: `${starting ? 'Starting die' : 'Reinforcement'} ${this.dieLabel(dieId)} unlocked · face ${this.state.dice.find(die => die.id === dieId)!.value} retained` });
    this.updateWardenUnlockTarget();
    this.evaluate();
    if (this.state.phase === 'round' && boss.pendingReinforcements === 0) this.state.decisionId++;
  }

  private beginScorePackage(playId: string, hand: HandId, source: HandPlaySource): ScorePackage {
    const allIn = source === 'manual' && this.state.scoreWagers.allInArmed;
    const doubleOrNothingRedemption = source === 'manual' && this.state.scoreWagers.doubleOrNothing?.hand === hand;
    if (allIn) this.state.scoreWagers.allInArmed = false;
    const scorePackage: ScorePackage = {
      id: `score-package:${this.state.historyV2TimelineId}:${this.state.round}:${this.state.roundAttemptNumber}:${this.state.scoreWagers.nextPackageId++}`,
      rootPlayId: playId,
      initiatingHand: hand,
      initiatingSource: source,
      scoreBefore: this.state.score,
      score: 0n,
      plays: [],
      contributions: [],
      complete: false,
      removedScore: 0n,
      allIn,
      doubleOrNothingRedemption,
      doubleOrNothingEligibleAtStart: source === 'manual' && doubleOrNothingEligibleHands(this.state).includes(hand),
    };
    this.state.scoreWagers.packages.push(scorePackage);
    this.activeScorePackage = scorePackage;
    return scorePackage;
  }

  private removeScorePackage(scorePackage: ScorePackage, reason: 'double_or_nothing' | 'all_in_failure'): ExactScore {
    const roundScoreBefore = this.state.score;
    const removed = scorePackage.score > roundScoreBefore ? roundScoreBefore : scorePackage.score;
    this.state.score = roundScoreBefore - removed;
    for (const contribution of scorePackage.contributions) {
      if (contribution.hand) {
        this.state.scoreByHand[contribution.hand] = (this.state.scoreByHand[contribution.hand] ?? 0n) - contribution.amount;
        if (this.state.scoreByHand[contribution.hand]! < 0n) this.state.scoreByHand[contribution.hand] = 0n;
        this.state.stats.rounds.at(-1)!.scoreByHand[contribution.hand] = this.state.scoreByHand[contribution.hand];
      } else {
        this.state.effectScore -= contribution.amount;
        if (this.state.effectScore < 0n) this.state.effectScore = 0n;
        this.state.stats.rounds.at(-1)!.effectScore = this.state.effectScore;
      }
    }
    scorePackage.removedScore += removed;
    this.state.stats.rounds.at(-1)!.finalScore = this.state.score;
    this.emitV2({ kind: 'score_package_removed', packageId: scorePackage.id, reason, amount: removed,
      roundScoreBefore, roundScoreAfter: this.state.score });
    return removed;
  }

  private canOfferDoubleOrNothing(scorePackage: ScorePackage): boolean {
    const flame = flameByType(this.state, 'doubleOrNothing');
    return scorePackage.initiatingSource === 'manual' && !scorePackage.allIn && !scorePackage.doubleOrNothingRedemption
      && scorePackage.doubleOrNothingEligibleAtStart
      && scorePackage.score > 0n
      && this.state.phase === 'round' && this.state.score < this.state.target
      && !!flame && flame.investedGold > 0
      && this.state.scoreWagers.doubleOrNothing === null
      && this.state.scoreWagers.pendingDoubleOrNothing === null
      && !handIsStructurallyImpossible(scorePackage.initiatingHand, activeEncounterDice(this.state).length);
  }

  private finalizeScorePackage(scorePackage: ScorePackage): void {
    scorePackage.complete = true;
    this.emitV2({ kind: 'score_package_completed', packageId: scorePackage.id, rootPlayId: scorePackage.rootPlayId,
      hand: scorePackage.initiatingHand, initiatingSource: scorePackage.initiatingSource,
      score: scorePackage.score, playIds: scorePackage.plays.map(play => play.playId), allIn: scorePackage.allIn,
      doubleOrNothingRedemption: scorePackage.doubleOrNothingRedemption });

    if (scorePackage.doubleOrNothingRedemption) {
      const wager = this.state.scoreWagers.doubleOrNothing;
      if (wager) {
        this.state.scoreWagers.doubleOrNothing = null;
        this.emitV2({ kind: 'double_or_nothing', phase: 'redeemed', packageId: scorePackage.id,
          hand: wager.hand, packageScore: scorePackage.score, factor: wager.factor, roundScore: this.state.score,
          target: this.state.target, clearedRound: this.state.score >= this.state.target,
          playsToRedemption: Math.max(0, this.state.roundPlayCount - wager.acceptedAtPlayCount) });
      }
    }

    if (scorePackage.allIn) {
      const factor = allInMultiplier(flameByType(this.state, 'allIn')?.investedGold ?? 0);
      const temporaryRoundScore = this.state.score;
      const success = temporaryRoundScore >= this.state.target;
      const removed = success ? 0n : this.removeScorePackage(scorePackage, 'all_in_failure');
      this.emitV2({ kind: 'all_in', phase: 'resolved', hand: scorePackage.initiatingHand,
        packageId: scorePackage.id, factor, packageScore: scorePackage.score,
        prePackageRoundScore: scorePackage.scoreBefore, temporaryRoundScore, success, scoreRemoved: removed });
    } else if (this.canOfferDoubleOrNothing(scorePackage)) {
      const factor = doubleOrNothingMultiplier(flameByType(this.state, 'doubleOrNothing')!.investedGold);
      this.state.scoreWagers.pendingDoubleOrNothing = { packageId: scorePackage.id,
        hand: scorePackage.initiatingHand, packageScore: scorePackage.score, factor,
        roundScore: this.state.score, target: this.state.target };
      this.emitV2({ kind: 'double_or_nothing', phase: 'offered', packageId: scorePackage.id,
        hand: scorePackage.initiatingHand, packageScore: scorePackage.score, factor,
        roundScore: this.state.score, target: this.state.target });
    }

    if (scorePackage.initiatingSource === 'manual' && !this.state.scoreWagers.pendingDoubleOrNothing
      && this.state.phase === 'round') this.evaluate();
  }

  play(hand: HandId, dieIds: number[], playSource: HandPlaySource = 'manual', decisionMs: number | null = null,
    qualificationClaims: import('./resolution').QualificationResourceClaim[] = []): { winning: boolean; beanRecordIndex: number | null } {
    const root = this.activeScorePackage === null;
    if (root && playSource === 'manual' && this.state.scoreWagers.pendingDoubleOrNothing)
      this.dismissDoubleOrNothing('ignored');
    let legalDieIds = dieIds;
    if (playSource !== 'manual') {
      const dice = activeEncounterDice(this.state);
      const required = requiredEncounterDieIds(this.state);
      const option = !handIsStructurallyImpossible(hand, dice.length)
        ? handOptions(dice, unavailableEncounterHands(this.state), dieIds, this.state.dieRoundState, encounterHandIds(this.state))
          .find(candidate => candidate.id === hand && !candidate.consumed) : undefined;
      const combination = option?.combinations.find(ids => required.every(id => ids.includes(id)));
      if (!combination) {
        this.log({ type: 'ABILITY_EVALUATED', hand, dieIds, playSource,
          message: `${playSource === 'jumpingBean' ? 'Jumping Bean' : 'Curtain Call'} Free Play blocked by encounter Hand legality` });
        return { winning: this.state.score >= this.state.target, beanRecordIndex: null };
      }
      legalDieIds = combination;
    }
    const playId = `${this.state.historyV2TimelineId}:${this.state.round}:${this.state.nextActionId}:${this.state.nextHistorySeq}:${playSource}`;
    const scorePackage = this.activeScorePackage ?? this.beginScorePackage(playId, hand, playSource);
    const parentPlayId = this.playStack.at(-1) ?? null;
    const isRootPlay = playId === scorePackage.rootPlayId;
    scorePackage.plays.push({ playId, parentPlayId, hand, source: playSource });
    const intent = createPlayIntent(playId, hand, orderDieIdsByEncounter(this.state, legalDieIds), playSource, decisionMs,
      qualificationClaims, { scorePackageId: scorePackage.id, rootPlayId: scorePackage.rootPlayId, parentPlayId,
        allIn: isRootPlay && scorePackage.allIn,
        doubleOrNothingRedemption: isRootPlay && scorePackage.doubleOrNothingRedemption });
    this.playStack.push(playId);
    let result: { winning: boolean; beanRecordIndex: number | null };
    try {
      result = this.resolvePlay(intent);
    } finally {
      this.playStack.pop();
    }
    if (root) {
      this.activeScorePackage = null;
      this.finalizeScorePackage(scorePackage);
      result.winning = this.state.score >= this.state.target;
    }
    return result;
  }

  private resolvePlay(intent: PlayIntent): { winning: boolean; beanRecordIndex: number | null } {
    const { hand, source: playSource, selectedDieIds: ids } = intent;
    const qualification = planQualification(activeEncounterDice(this.state), hand, ids,
      { roundState: this.state.dieRoundState, claims: intent.qualificationClaims });
    if (!qualification.legal || qualification.ambiguousClaims)
      throw new Error('Committed Play has no unambiguous Qualification plan.');
    const freeBean = playSource === 'jumpingBean';
    const freePlay = playSource !== 'manual';
    const hotPotatoBefore = this.ensureHotPotatoTarget();
    const wouldConsumeHand = !freePlay && (this.state.bossSilenced || this.state.boss?.type !== 'marathon');
    const consumesHand = wouldConsumeHand;
    const handLevel = this.state.handLevels[hand];
    const currentInfernoMultiplier = infernoMultiplier(this.state.engulfmentLevel);
    const handStart = captureHandStart(this.state, hand, ids, playSource === 'manual' ? intent.decisionMs : null, playSource,
      { allIn: intent.allIn, doubleOrNothingRedemption: intent.doubleOrNothingRedemption });
    const chargeAttributionAtHandStart = structuredClone(this.state.chargeAttribution);
    if (freePlay) handStart.chargeArmed = false;
    const shapeParticipants = ids.map(id => ({ id, face: structuredClone(activeFace(this.state.dice.find(die => die.id === id)!)), role: 'selected' as const }));
    this.v2Hand = {
      parentSeq: this.v2ParentSeq,
      hand, level: handLevel, playSource, consumed: consumesHand, roundScoreBefore: this.state.score,
      selectedDice: shapeParticipants.map(item => item.id),
      pipsContributions: [], resolvedDicePips: [],
      multContributions: [{ source: 'hand', factor: createHandAccumulator(hand, ids, handLevel).handMultiplier,
        before: 0, after: createHandAccumulator(hand, ids, handLevel).handMultiplier }],
      xMultContributions: [], sideEffects: playSource === 'freePlay'
        ? [{ type: 'free_play', dieId: ids[0], rerollEventId: this.curtainCallContext?.manualRerollEventId ?? 'unknown',
          pipsMultiplier: this.curtainCallContext?.multiplier }] : [],
    };
    this.v2ParentSeq = undefined;
    if (freeBean) this.emit({ type: 'JUMPING_BEAN_FREE_PLAY', dieType: 'jumpingBean', hand, dieIds: ids,
      face: shapeParticipants[0].face.rank, playSource, handConsumed: false,
      message: `Jumping Bean free-play: ${HANDS[hand].name}; scoring dice: ${this.dieLabel(ids[0])}; normal hand availability unchanged` });
    this.handAccumulator = createHandAccumulator(hand, ids, handLevel, currentInfernoMultiplier);
    const round = this.state.stats.rounds.at(-1)!;
    round.lastHand = hand; round.lastAction = freeBean ? 'JUMPING_BEAN' : 'PLAY';
    const hitchhikers: { id: number; face: Face; role: 'hitchhiker' }[] = [];
    for (const die of freePlay ? [] : activeEncounterDice(this.state)) {
      if (ids.includes(die.id)) continue;
      const face = structuredClone(activeFace(die));
      const hitchhiker = die.owner === 'player' ? effectOf(die, 'hitchhiker') : undefined;
      if (die.owner === 'player' && hitchhiker && !wholeDieEffectSuppressed(die)) {
        const runtime = this.specialRuntime(die, 'hitchhiker');
        if (runtime?.invocationsRemaining) {
          const before = runtime.invocationsRemaining;
          runtime.invocationsRemaining--;
          hitchhikers.push({ id: die.id, face, role: 'hitchhiker' });
          this.emitSpecial(die, hitchhiker, `Hitchhiker joined ${HANDS[hand].name}`, 'play', before, runtime.invocationsRemaining);
          continue;
        }
      }
    }
    const scoringParticipants = [...shapeParticipants, ...hitchhikers];
    const scoringIds = scoringParticipants.map(item => item.id);
    const resolution: HandResolution = {
      intent,
      qualification,
      selectedParticipants: shapeParticipants,
      scoringParticipants,
      scoreOccurrences: [],
      resolvedDicePips: [],
      accumulator: this.handAccumulator,
      wouldConsumeHand,
      consumesHand,
    };
    const sustainableParticipant = resolution.wouldConsumeHand ? scoringParticipants.find(participant => {
      const die = this.collectible(participant.id);
      return participant.role === 'selected' && intent.source === 'manual' && intent.playerSelectedDieIds.includes(participant.id)
        && !!die && hasEffect(die, 'sustainable') && !wholeDieEffectSuppressed(die)
        && (this.specialRuntime(die, 'sustainable')?.invocationsRemaining ?? 0) > 0;
    }) : undefined;
    if (sustainableParticipant) {
      const die = this.collectible(sustainableParticipant.id)!;
      const sustainable = requireEffect(die, 'sustainable');
      const runtime = this.specialRuntime(die, 'sustainable')!;
      const before = runtime.invocationsRemaining;
      runtime.invocationsRemaining--;
      const remaining = runtime.invocationsRemaining;
      this.emitSpecial(die, sustainable, `${HANDS[hand].name} preserved`, 'hand_consumption', before, remaining);
      resolution.consumesHand = false;
      this.v2Hand.consumed = false;
      this.v2Hand.sideEffects.push({ type: 'sustainable', dieId: sustainableParticipant.id, hand,
        chargesRemaining: remaining });
    }
    handStart.cleanSweepCompletesCycle = wouldCompleteScorecardCycle(this.state, hand, resolution.consumesHand);
    this.emit({ type: 'HAND_STARTED', hand, dieIds: ids, playSource, handConsumed: resolution.consumesHand,
      message: `${freePlay ? 'Free-played' : 'Played'} ${HANDS[hand].name} Lv. ${this.format(handLevel)}` });
    for (const claim of resolution.qualification.resourceClaims) {
      const die = this.collectible(claim.dieId);
      if (!die) throw new Error('Qualification claim references a non-collectible die.');
      const effect = requireEffect(die, claim.effect);
      this.spendInvocation(die, effect, `${claim.effect} Qualification Use spent`, 'qualification');
    }
    for (const participation of resolution.qualification.effects) {
      if (participation.effect === 'conjoined') {
        this.v2Hand.sideEffects.push({ type: 'conjoined', dieId: participation.dieId, hand });
      } else if (participation.effect === 'hexerWild') {
        this.emit({ type: 'SPECIAL_EFFECT_TRIGGERED', boss: 'hexer', hand, dieIds: [participation.dieId],
          face: participation.face, message: 'Cursed Die supplied wild Qualification; printed Pips still scored' });
      }
    }
    this.resolveScoreOccurrences(resolution);
    this.emit({ type: 'HAND_MULTIPLIER_CHANGED', hand, dieIds: scoringIds, multiplier: this.handAccumulator.currentMultiplier,
      message: `${HANDS[hand].name} applies ×${this.format(this.handAccumulator.currentMultiplier)} Mult` });
    handStart.playedDiceScoringPips = this.v2Hand.pipsContributions
      .filter(contribution => contribution.role === 'selected' && contribution.dieId !== undefined
        && ids.includes(contribution.dieId))
      .reduce((sum, contribution) => sum + contribution.amount, 0);
    handStart.scoringDiceEnhancementCount = countScoringDiceEnhancementComponents(handStart, scoringIds);
    const { pips, multiplier, xMult, rawScore, score, bossFactor } =
      this.resolveHandScore(resolution, handStart, handLevel, chargeAttributionAtHandStart);
    if (currentInfernoMultiplier > 1n) this.emit({ type: 'HAND_INFERNO_APPLIED', hand, dieIds: scoringIds,
      amount: currentInfernoMultiplier, message: `Inferno applies ×${this.format(currentInfernoMultiplier)}` });
    this.state.stats.handScores.push({ round: this.state.round, hand, handLevel, dieIds: scoringIds,
      handMultiplier: this.handAccumulator.handMultiplier,
      infernoMultiplier: currentInfernoMultiplier,
      pips, multiplier, xMult, bossFactor, xMultFactors: structuredClone(this.handAccumulator.xMultFactors), rawScore, score,
      bonusPips: this.handAccumulator.bonusPips, hitchhikerPips: this.handAccumulator.hitchhikerPips,
      playSource, consumedHand: resolution.consumesHand });
    this.state.stats.handBonusPips += this.handAccumulator.bonusPips;
    this.state.stats.hitchhikerPipsContributed += this.handAccumulator.hitchhikerPips;
    const scoreSource = playSource === 'jumpingBean' ? 'jumpingBean' as const
      : playSource === 'freePlay' ? 'curtainCall' as const : 'hand' as const;
    const effectiveXMult = Number((xMult * bossFactor).toFixed(12));
    this.log({ type: 'SCORE_ROUNDING_AUDIT', hand, dieIds: scoringIds, pips, multiplier, xMult, rawScore, amount: score, source: scoreSource, playSource,
      message: `Final: ${this.format(pips)} Pips × ${this.format(multiplier)} Mult${effectiveXMult !== 1 ? ` × ${this.format(effectiveXMult)} XMult` : ''}${currentInfernoMultiplier > 1n ? ` × ${this.format(currentInfernoMultiplier)} Inferno` : ''} = ${this.format(rawScore)}; rounded ${this.format(score)}` });
    this.emit({ type: 'HAND_SCORE_FINALIZED', hand, dieIds: scoringIds, pips, multiplier, xMult, rawScore, amount: score,
      resolvedDicePips: structuredClone(resolution.resolvedDicePips),
      source: scoreSource, playSource, handConsumed: resolution.consumesHand, message: `Final awarded hand score: ${this.format(score)}` });
    this.addScore(score, scoreSource, `${freePlay ? 'Free play: ' : ''}${HANDS[hand].name}: round score +${this.format(score)}`, scoringIds, hand);
    const roundScoreAfterAward = this.state.score;
    if (playSource === 'manual' && handStart.briberyPendingCount > 0) {
      const flame = flameByType(this.state, 'bribery');
      const factor = briberyFactor(flame?.investedGold ?? 0, handStart.briberyPendingCount);
      this.state.interactiveFlames.briberyPendingCount = 0;
      this.emitV2({ kind: 'flame_action', flame: 'bribery', action: { type: 'bribery_consumed',
        hand, pendingCount: handStart.briberyPendingCount, factor } });
    }
    if (handStart.dareDevilCount > 0 && handStart.ultimateHands.includes(hand)) {
      const flame = flameByType(this.state, 'dareDevil');
      const factor = dareDevilMultiplier(flame?.investedGold ?? 0, handStart.dareDevilCount);
      this.state.interactiveFlames.dareDevilCount = 0;
      this.emitV2({ kind: 'flame_action', flame: 'dareDevil', action: { type: 'dare_payoff',
        dareCount: handStart.dareDevilCount, hand, factor } });
    }
    if (!freePlay && handStart.chargeArmed) {
      const consumed = this.state.chargeXMult;
      this.state.chargeXMult = 1; this.state.chargeArmed = false;
      this.state.chargeAttribution = {};
      this.state.stats.chargeConsumed = Number((this.state.stats.chargeConsumed + Math.max(0, consumed - 1)).toFixed(12));
      this.emit({ type: 'CHARGE_CHANGED', xMult: 1, message: `Charge ×${this.format(consumed)} consumed; meter reset to ×1` });
    }
    this.addMomentumCharge(hand);
    this.applyPowerSurge(hand, handStart.ultimateHands.includes(hand));
    this.addPotentialEnergyCharge(handStart, hand, playSource);
    this.addAllHandsOnDeckCharge(handStart);
    this.advanceMinigun(hand);
    if (UPPER_HAND_IDS.includes(hand) && ownedFlameIds(this.state).has('sixPack')) {
      const before = this.state.sixPackXMult;
      const startingFactor = sixPackStartingMultiplier(flameByType(this.state, 'sixPack')?.investedGold ?? 0);
      this.state.sixPackUpperHandsPlayed = Math.min(6, this.state.sixPackUpperHandsPlayed + 1);
      this.state.sixPackXMult = sixPackMultiplierAfterUpperHands(startingFactor, this.state.sixPackUpperHandsPlayed);
      this.emit({ type: 'SIX_PACK_CHANGED', flame: 'sixPack', hand, xMult: this.state.sixPackXMult,
        flameDiagnostics: { currentFactor: this.state.sixPackXMult,
          upperDecayStep: this.state.sixPackUpperHandsPlayed },
        message: `Six Pack ×${this.format(before)} → ×${this.format(this.state.sixPackXMult)}` });
    }
    if (!freePlay) this.advanceHotStreak(hand, scoringIds);
    this.advanceProgressiveFlames(hand, playSource);
    this.state.handPlayCounts[hand]++;
    this.state.roundPlayCount++;
    this.log({ type: 'ABILITY_EVALUATED', dieType: freeBean ? 'jumpingBean' : undefined, hand, dieIds: scoringIds, playSource,
      message: `${HANDS[hand].name} hand history incremented: ${this.format(handStart.previousPlays)} → ${this.format(this.state.handPlayCounts[hand])}` });
    this.handAccumulator = null;
    if (resolution.consumesHand) {
      if (!this.state.consumed.includes(hand)) this.state.consumed.push(hand);
      if (!this.state.scorecardCycleConsumed.includes(hand)) this.state.scorecardCycleConsumed.push(hand);
      this.emit({ type: 'HAND_CONSUMED', hand, playSource, handConsumed: true, message: `${HANDS[hand].name} consumed for round ${this.format(this.state.round)}` });
    }
    this.advanceMarathon(hand, playSource);
    this.resolveQuickdraw(hand, playSource);
    this.resolvePendulum(hand);
    this.resolveCallerCall(hand, playSource);
    this.resolveSnakeEyes(scoringIds);
    this.resolveInfected(scoringIds);
    const magicianReturned = this.resolveMiniBossHand(hand);
    this.resolveHotPotatoPlay(hotPotatoBefore, ids);
    let winning = this.state.score >= this.state.target;
    if (magicianReturned && winning) {
      this.drain();
      winning = this.state.score >= this.state.target;
    }
    let jackpotPayout = 0;
    if (winning) jackpotPayout = this.resolveJackpot(scoringIds);
    const beanRecordIndex = freeBean ? this.state.stats.jumpingBeanFreePlays.push({
      round: this.state.round, dieId: ids[0], face: shapeParticipants[0].face.rank, hand, handLevel,
      handMultiplier: this.state.stats.handScores.at(-1)!.handMultiplier,
      score, xMultFactors: structuredClone(this.state.stats.handScores.at(-1)!.xMultFactors),
      previousPlayCount: handStart.previousPlays, handPlayCountAfter: this.state.handPlayCounts[hand], consumedHand: false,
      followupRerolled: false, roundCleared: winning, jackpotPayout,
    }) - 1 : null;
    if (bossFactor !== 1) this.v2Hand!.xMultContributions.push({ sourceId: this.state.boss?.type ?? 'other',
      origin: 'boss', factor: bossFactor });
    const draft = this.v2Hand!;
    this.trace({ kind: 'scoring_step', hand, stage: 'final', before: draft.roundScoreBefore,
      after: this.state.score, source: playSource });
    const handEvent = this.emitV2({ kind: 'hand_scored', parentSeq: draft.parentSeq, hand, level: handLevel,
      scorePackageId: intent.scorePackageId, rootPlayId: intent.rootPlayId, parentPlayId: intent.parentPlayId,
      playSource, selectedDice: draft.selectedDice,
      scoringDice: scoringParticipants.map(participant => ({ ...this.historyDie(participant.id, participant.face), role: participant.role })),
      scoreOccurrences: resolution.scoreOccurrences.map(occurrence => ({ id: occurrence.id, rootId: occurrence.rootId,
        dieId: occurrence.dieId, cause: occurrence.cause, originallySelected: occurrence.originallySelected,
        playerSelected: occurrence.playerSelected, additional: occurrence.additional,
        suppressedEffects: [...occurrence.suppressedEffects] })),
      consumed: resolution.consumesHand,
      score: { infernoMultiplier: currentInfernoMultiplier, finalPips: pips,
        handMult: this.state.stats.handScores.at(-1)!.handMultiplier,
        finalMult: multiplier, finalXMult: xMult, bossFactor, raw: rawScore, awarded: score,
        rounding: { mode: 'nearest_integer', delta: new Decimal(score.toString()).minus(rawScore).toFixed() } },
      roundScore: { before: draft.roundScoreBefore, afterAward: roundScoreAfterAward, after: this.state.score },
      pipsContributions: draft.pipsContributions, resolvedDicePips: draft.resolvedDicePips,
      multContributions: draft.multContributions,
      xMultContributions: draft.xMultContributions, sideEffects: draft.sideEffects });
    this.decayFurnacesAfterPlay();
    this.v2Hand = null;
    this.v2ParentSeq = handEvent.seq;
    this.advanceNeglected();
    return this.resolvePostPlayRerolls(resolution, winning, beanRecordIndex);
  }

  invokeFlywheel(dieId: number): void {
    const die = this.collectible(dieId);
    if (!die || !hasEffect(die, 'flywheel')) throw new Error('Flywheel command requires its equipped die.');
    const effect = requireEffect(die, 'flywheel');
    if (wholeDieEffectSuppressed(die)) throw new Error('Flywheel is suppressed while its infected face is exposed.');
    this.spendInvocation(die, effect, 'Flywheel free Reroll', 'on_command');
    this.rollBatch([die.id], 'Flywheel free reroll', 'gameplay', false, 'other');
    this.drain();
    this.evaluate();
  }

  invokeChameleon(dieId: number): void {
    const die = this.collectible(dieId);
    if (!die || !hasEffect(die, 'chameleon')) throw new Error('Chameleon command requires its equipped die.');
    const effect = requireEffect(die, 'chameleon');
    if (wholeDieEffectSuppressed(die)) throw new Error('Chameleon is suppressed while its infected face is exposed.');
    const others = rosterDice(this.state).filter(item => item.id !== die.id);
    if (!others.length) throw new Error('Chameleon requires another equipped die.');
    const values = others.map(item => activeFace(item).rank);
    const counts = new Map<Rank, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    const maximum = Math.max(...counts.values());
    const leaders = [...counts].filter(([, count]) => count === maximum).map(([rank]) => rank);
    const target = leaders.length === 1 ? leaders[0] : leaders[randomIndex(this.rng, leaders.length)];
    const before = activeFace(die).rank;
    this.spendInvocation(die, effect, `Chameleon changed ${before} → ${target}`, 'on_command');
    const physicalFace = die.value;
    const changedFace = die.faces[physicalFace - 1];
    changedFace.rank = target;
    if (changedFace.bossMutation?.kind === 'snakeEyes') changedFace.bossMutation.originalRank = target;
    this.emit({ type: 'DIE_FLIPPED', dieIds: [die.id], previousFace: before, resultFace: target, face: target,
      message: `${this.dieLabel(die.id)} Chameleon changed face: ${before} → ${target}` });
    this.evaluate();
  }

  armMagic(dieId: number, face: Exclude<Rank, 7>): void {
    const die = this.collectible(dieId);
    if (!die || !hasEffect(die, 'magic')) throw new Error('Magic command requires its equipped die.');
    const effect = requireEffect(die, 'magic');
    if (wholeDieEffectSuppressed(die)) throw new Error('Magic is suppressed while its infected face is exposed.');
    const runtime = this.specialRuntime(die, 'magic')!;
    runtime.magicArmedFace = face;
    this.emitSpecial(die, effect, `Magic armed face ${face} for the next Reroll`, 'on_command',
      runtime.invocationsRemaining, runtime.invocationsRemaining, { face });
  }

  feedFurnace(dieId: number, amount: number): void {
    const die = this.collectible(dieId);
    if (!die || !hasEffect(die, 'furnace')) throw new Error('Furnace command requires its equipped die.');
    const effect = requireEffect(die, 'furnace');
    if (wholeDieEffectSuppressed(die)) throw new Error('Furnace is suppressed while its infected face is exposed.');
    const runtime = this.specialRuntime(die, 'furnace')!;
    this.spendRoundGold(amount, `Fed ${this.dieLabel(die.id)} Furnace: -${amount} Gold`, 'furnace');
    const before = runtime.furnacePips;
    runtime.furnaceGoldFed += amount;
    runtime.furnacePips += amount * CONFIG.furnacePipsPerGoldPerLevel * effect.level;
    this.emitSpecial(die, effect, `Furnace reserve ${before} → ${runtime.furnacePips} Pips`, 'on_command',
      undefined, undefined, { amount: runtime.furnacePips - before });
  }

  burnItDown(): void {
    const flame = this.chargeFlameSource('burnItDown');
    if (!flame) throw new Error('Burn It Down requires its active Flame.');
    if (this.state.scoreWagers.pendingDoubleOrNothing) this.dismissDoubleOrNothing('ignored');
    const sacrificed = this.state.score;
    const fraction = this.state.target > 0n ? Math.max(0, Math.min(1, exactRatioNumber(sacrificed, this.state.target))) : 0;
    const requested = burnItDownChargeGain(flame.investment, fraction);
    const chargeBefore = this.state.chargeXMult;
    this.state.score = 0n;
    this.state.interactiveFlames.burnItDownUses++;
    const gained = this.growCharge('burnItDown', requested,
      `sacrificed ${this.format(sacrificed)} Score (${this.format(fraction * 100)}% of target)`, undefined,
      { scoreSacrificed: sacrificed, targetFraction: fraction, chargeBefore, chargeRequested: requested,
        useCount: this.state.interactiveFlames.burnItDownUses });
    this.emitV2({ kind: 'flame_action', flame: 'burnItDown', action: { type: 'burn_it_down',
      scoreSacrificed: sacrificed, target: this.state.target, fraction, chargeBefore,
      chargeRequested: requested, chargeGained: gained, useCount: this.state.interactiveFlames.burnItDownUses } });
    this.state.decisionId++;
  }

  greaseTheEngine(): void {
    const flame = this.chargeFlameSource('greaseTheEngine');
    if (!flame) throw new Error('Grease the Engine requires its active Flame.');
    const useCount = this.state.interactiveFlames.greaseTheEngineUses + 1;
    const cost = greaseTheEngineCost(this.state.interactiveFlames.greaseTheEngineUses);
    const goldBefore = this.state.gold;
    const chargeBefore = this.state.chargeXMult;
    const requested = greaseTheEngineChargeGain(flame.investment);
    this.spendRoundGold(cost, `Grease the Engine bribe: -${this.format(cost)} Gold`, 'greaseTheEngine');
    this.state.interactiveFlames.greaseTheEngineUses = useCount;
    const gained = this.growCharge('greaseTheEngine', requested, `paid ${this.format(cost)} Gold`, undefined,
      { goldCost: cost, goldBefore, goldAfter: this.state.gold, useCount, chargeBefore, chargeRequested: requested });
    this.emitV2({ kind: 'flame_action', flame: 'greaseTheEngine', action: { type: 'grease_the_engine',
      cost, goldBefore, goldAfter: this.state.gold, useCount, chargeRequested: requested, chargeGained: gained } });
    this.state.decisionId++;
  }

  bribe(): void {
    const flame = flameByType(this.state, 'bribery');
    if (!flame) throw new Error('Bribery requires its active Flame.');
    const ordinal = this.state.interactiveFlames.briberyPurchasedThisRound + 1;
    const cost = briberyNextCost(this.state.interactiveFlames.briberyPurchasedThisRound);
    const goldBefore = this.state.gold;
    const pendingCount = this.state.interactiveFlames.briberyPendingCount + 1;
    const increment = briberyXMultIncrement(flame.investedGold);
    const pendingFactor = briberyFactor(flame.investedGold, pendingCount);
    this.spendRoundGold(cost, `Bribery payment #${this.format(ordinal)}: -${this.format(cost)} Gold`, 'bribery');
    this.state.interactiveFlames.briberyPurchasedThisRound = ordinal;
    this.state.interactiveFlames.briberyPendingCount = pendingCount;
    this.emitV2({ kind: 'flame_action', flame: 'bribery', action: { type: 'bribe_purchased', cost, ordinal,
      increment, pendingCount, pendingFactor, goldBefore, goldAfter: this.state.gold } });
    this.state.decisionId++;
  }

  lightningStrike(dieId: number, predictedFace: Exclude<Rank, 7>): void {
    const flame = this.chargeFlameSource('lightningStrike');
    if (!flame) throw new Error('Lightning Strike requires its active Flame.');
    const source = this.state.manualRerollsRemaining > 0 ? 'normal' as const : 'carePackage' as const;
    const requested = lightningStrikeChargeGain(flame.investment);
    this.manualReroll([dieId]);
    const die = this.state.dice.find(item => item.id === dieId);
    if (!die) throw new Error('Lightning Strike die disappeared during its Manual Reroll.');
    const actualFace = activeFace(die).rank;
    const hit = actualFace === predictedFace;
    const chargeBefore = this.state.chargeXMult;
    const gained = hit ? this.growCharge('lightningStrike', requested,
      `predicted ${predictedFace}; ${this.dieLabel(dieId)} landed on ${actualFace}`, [dieId],
      { predictedDieId: dieId, predictedFace, actualFace, predictionHit: true,
        manualRerollSource: source, chargeBefore, chargeRequested: requested }) : 0;
    if (!hit) this.triggerFlame('lightningStrike',
      `predicted ${predictedFace}; ${this.dieLabel(dieId)} landed on ${actualFace}; no Charge`, undefined, undefined,
      { predictedDieId: dieId, predictedFace, actualFace, predictionHit: false, manualRerollSource: source,
        chargeBefore, chargeRequested: requested, chargeGained: 0 });
    this.emitV2({ kind: 'flame_action', flame: 'lightningStrike', action: { type: 'lightning_strike',
      dieId, predictedFace, actualFace, hit, manualRerollSource: source, chargeGained: gained } });
  }

  dareDevil(): void {
    const flame = flameByType(this.state, 'dareDevil');
    if (!flame) throw new Error('Dare Devil requires its active Flame.');
    const dice = activeEncounterDice(this.state).filter(die => die.owner === 'player');
    this.state.interactiveFlames.dareDevilCount++;
    const dareCount = this.state.interactiveFlames.dareDevilCount;
    const storedFactor = dareDevilMultiplier(flame.investedGold, dareCount);
    const dieIds = dice.map(die => die.id);
    this.triggerFlame('dareDevil', `Dare ${dareCount}/${FLAME_SCALING.dareDevil.maximumDares}; next Ultimate ×${this.format(storedFactor)}`,
      undefined, undefined, { dareCount, availableDieIds: dieIds, storedUltimateFactor: storedFactor });
    this.emitV2({ kind: 'flame_action', flame: 'dareDevil', action: { type: 'dare_activated',
      dareCount, dieIds, storedFactor } });
    this.rollBatch(dieIds, 'Dare Devil Roll', 'gameplay', false, 'dare_devil');
    this.drain();
    this.evaluate();
    if (this.state.phase === 'round') this.state.decisionId++;
  }

  acceptDoubleOrNothing(): void {
    const offer = this.state.scoreWagers.pendingDoubleOrNothing;
    if (!offer) throw new Error('Double or Nothing acceptance requires a pending offer.');
    const scorePackage = this.state.scoreWagers.packages.find(item => item.id === offer.packageId && item.complete);
    if (!scorePackage) throw new Error('Double or Nothing score package is unavailable.');
    const removed = this.removeScorePackage(scorePackage, 'double_or_nothing');
    const consumedBefore = this.state.consumed.includes(offer.hand) || this.state.scorecardCycleConsumed.includes(offer.hand);
    if (this.state.bossSilenced || this.state.boss?.type !== 'marathon') {
      this.state.consumed = this.state.consumed.filter(hand => hand !== offer.hand);
      this.state.scorecardCycleConsumed = this.state.scorecardCycleConsumed.filter(hand => hand !== offer.hand);
    }
    this.state.scoreWagers.doubleOrNothing = { hand: offer.hand, acceptedPackageId: offer.packageId,
      factor: offer.factor, acceptedAtPlayCount: this.state.roundPlayCount };
    this.state.scoreWagers.pendingDoubleOrNothing = null;
    this.emitV2({ kind: 'double_or_nothing', phase: 'accepted', packageId: offer.packageId, hand: offer.hand,
      packageScore: offer.packageScore, factor: offer.factor, roundScore: this.state.score, target: offer.target,
      handReopened: consumedBefore && (this.state.bossSilenced || this.state.boss?.type !== 'marathon'),
      scoreRemoved: removed });
    this.state.decisionId++;
    if (this.state.phase === 'round') this.evaluate();
  }

  private dismissDoubleOrNothing(reason: 'expired' | 'ignored'): void {
    const offer = this.state.scoreWagers.pendingDoubleOrNothing;
    if (!offer) throw new Error('Double or Nothing dismissal requires a pending offer.');
    this.state.scoreWagers.pendingDoubleOrNothing = null;
    this.emitV2({ kind: 'double_or_nothing', phase: reason, packageId: offer.packageId, hand: offer.hand,
      packageScore: offer.packageScore, factor: offer.factor, roundScore: this.state.score, target: offer.target });
  }

  declineDoubleOrNothing(reason: 'expired' | 'ignored'): void {
    this.dismissDoubleOrNothing(reason);
    this.state.decisionId++;
    if (this.state.phase === 'round') this.evaluate();
  }

  armAllIn(): void {
    const flame = flameByType(this.state, 'allIn');
    if (!flame) throw new Error('All In requires its active Flame.');
    this.state.scoreWagers.allInArmed = true;
    const factor = allInMultiplier(flame.investedGold);
    this.emitV2({ kind: 'all_in', phase: 'armed', factor });
    this.log({ type: 'ABILITY_EVALUATED', flame: 'allIn', xMult: factor,
      message: `All In armed · next manual Play ×${this.format(factor)} · failed package Score will be removed` });
    this.state.decisionId++;
  }

  manualReroll(dieIds: number[]): void {
    const ids = orderDieIdsByEncounter(this.state, [...dieIds]);
    const requiredDieIds = requiredEncounterDieIds(this.state);
    const startedDeadBoard = !hasPlayableHand(activeEncounterDice(this.state), unavailableEncounterHands(this.state), requiredDieIds,
      this.state.dieRoundState);
    const paidDice = ids.length;
    const normalSpent = Math.min(this.state.manualRerollsRemaining, paidDice);
    const carePackageSpent = paidDice - normalSpent;
    this.state.manualRerollsRemaining -= normalSpent;
    this.state.specialOfferEffects.carePackageRerolls -= carePackageSpent;
    const round = this.state.stats.rounds.at(-1)!;
    round.lastAction = 'MANUAL_REROLL'; round.manualRerollChargesSpent += paidDice; round.manualRerollActions++;
    this.state.manualRerollsUsedThisRound++;
    this.state.stats.manualRerollActions++; this.state.stats.manualDiceRerolled += ids.length;
    const record = { round: this.state.round, dieIds: ids, charges: paidDice, remaining: this.state.manualRerollsRemaining, startedDeadBoard, rescuedDeadBoard: false };
    this.state.stats.manualRerolls.push(record);
    const normalRemaining = this.state.manualRerollsRemaining;
    const carePackageRemaining = this.state.specialOfferEffects.carePackageRerolls;
    const message = carePackageSpent > 0
      ? carePackageRemaining > 0
        ? `Care Package Manual Reroll${carePackageSpent === 1 ? '' : 's'} used · ${this.format(carePackageRemaining)} remaining · ${this.format(normalRemaining)} normal Rerolls left`
        : `Care Package depleted · ${this.format(normalRemaining)} normal Rerolls left`
      : `Manual reroll · ${this.format(normalRemaining)} Rerolls left · Care Package ${this.format(carePackageRemaining)}`;
    this.emit({ type: 'MANUAL_REROLL_STARTED', dieIds: ids, amount: ids.length, message });
    const jumpStart = this.chargeFlameSource('jumpStart');
    if (jumpStart) for (const dieId of ids) this.growCharge('jumpStart', jumpStartChargeGain(jumpStart.investment),
      `1 Reroll spent on ${this.dieLabel(dieId)}`, [dieId]);
    this.v2ManualSpend = { normalCharges: normalSpent, carePackageCharges: carePackageSpent,
      remaining: this.state.manualRerollsRemaining };
    this.rollBatch(ids, 'Manual gameplay reroll', 'gameplay', true, 'manual');
    this.drain();
    if (startedDeadBoard && (this.state.score >= this.state.target || hasPlayableHand(activeEncounterDice(this.state),
      unavailableEncounterHands(this.state), requiredDieIds, this.state.dieRoundState))) {
      record.rescuedDeadBoard = true; round.deadBoardRescues++; this.state.stats.deadBoardRescues++;
      this.emit({ type: 'DEAD_BOARD_RESCUED', dieIds: ids, message: 'Dead board rescued' });
    }
    this.evaluate();
    if (this.state.phase === 'round') this.state.decisionId++;
  }
  private captureRoundCheckpoint(): void {
    const checkpoint = captureRollbackState(this.state);
    const base = checkpoint.board;
    // The checkpoint is a round-ready gameplay baseline plus the exact Shop
    // session that launched it. Bust restoration reopens this Shop without
    // generating offers, reroll allowances, exposed faces, or rewards.
    base.phase = 'shop';
    base.shop ??= { visitId: base.nextShopVisitId++, stage: 'shop',
      offers: [], offerRerolls: 0, lifeRestores: 0,
      freeDicePurchaseAvailable: false, trainingSession: createTrainingSession(base.handLevels) };
    // Once the next Chapter has started, a Bust restores this as that Round's
    // retry Shop even when its contents originated in the prior post-Boss Shop.
    if (base.shop.kind) base.shop.kind = 'between_rounds';
    if (base.bossSilenced) base.specialOfferEffects.silence = true;
    base.bossSilenced = false;
    base.flameSelection = null;
    base.specialOffer = null;
    base.roundSummary = null;
    base.bust = null;
    base.boss = null;
    base.dice = base.dice.filter(die => die.owner === 'player');
    checkpoint.encounterDice = [];
    this.state.roundCheckpoint = checkpoint;
  }
  retreat(): void {
    this.resolveBust('retreat');
  }

  private resolveBust(reason: 'bust' | 'retreat' = 'bust'): void {
    const checkpoint = this.state.roundCheckpoint;
    if (!checkpoint) throw new Error('Bust occurred without a round-start checkpoint.');
    const current = this.state.stats.rounds.at(-1)!;
    const failure = {
      round: this.state.round, attempt: this.state.roundAttemptNumber, score: this.state.score, target: this.state.target,
      shortfall: this.state.target > this.state.score ? this.state.target - this.state.score : 0n, livesBefore: this.state.lives,
      livesAfter: Math.max(0, this.state.lives - 1),
    };
    const terminalDice = structuredClone(this.state.dice);
    const terminalDiceTelemetry = terminalDice.map(die => ({ dieId: die.id, physicalFace: die.value,
      face: activeFace(die).rank, pips: scoringPips(activeFace(die)) }));
    const failureValues = terminalDice.map(die => activeFace(die).rank);
    const failureConsumed = [...this.state.consumed];
    const failureLastHand = current.lastHand;
    const failureLastAction = current.lastAction;
    const failedBoss = structuredClone(this.state.boss);
    const failedNodeId = this.state.currentNodeId;
    const persistentSpecialOfferState = captureBustPersistentSpecialOfferState(this.state.specialOfferEffects);
    const badDreamCheckpoint = this.state.badDreamCheckpoint;
    if (failure.livesAfter === 0 && this.state.specialOfferEffects.badDreamRounds > 0 && badDreamCheckpoint) {
      this.emitV2({ kind: 'round_attempt_finished', outcome: 'bust', score: failure.score, target: failure.target,
        boss: this.state.boss?.type ?? null, livesBefore: failure.livesBefore, livesAfter: failure.livesAfter });
      const deathChapter = chapterNumberForRound(this.state.round);
      const destination = chapterEncounterRounds(deathChapter).miniBossRound;
      this.state.round = destination;
      this.state.roundAttemptNumber = 1;
      this.state.roundCheckpoint = null;
      this.state.badDreamCheckpoint = null;
      this.state.specialOfferEffects.badDreamRounds = 0;
      this.state.lives = 1;
      this.state.bust = null;
      this.nextTimeline('bad_dream', destination, 1, 'post_r3_shop');
      this.openShop('backward');
      this.emit({ type: 'SPECIAL_EFFECT_TRIGGERED', message: 'Bad Dream returned the current build to the post-R3 Shop with 1 Life' });
      return;
    }
    if (failure.livesAfter === 0 && this.options.tutorialFinalLifeSafeguard) {
      this.state.manualRerollsRemaining = CONFIG.manualRerollsPerRound;
      this.state.consumed = [];
      this.state.scorecardCycleConsumed = [];
      if (this.state.boss) {
        this.state.bossSilenced = true;
        if (this.state.boss.type === 'warden') {
          this.state.boss.activeDieIds = this.state.dice.filter(die => die.owner === 'player').map(die => die.id);
          this.state.boss.startingDieId ??= this.state.boss.activeDieIds[0] ?? null;
          this.state.boss.pendingReinforcements = 0;
          this.state.boss.nextUnlockTarget = null;
        }
      }
      current.manualRerollsGranted += CONFIG.manualRerollsPerRound;
      this.emit({ type: 'TUTORIAL_SAFEGUARD', amount: CONFIG.manualRerollsPerRound,
        boss: this.state.boss?.type,
        message: `Tutorial safety refill: ${this.format(CONFIG.manualRerollsPerRound)} Rerolls; Used hands refreshed${this.state.boss ? `; ${this.state.boss.type.toUpperCase()} suppressed` : ''}` });
      this.state.decisionId++;
      return;
    }
    this.emitV2({ kind: 'round_attempt_finished', outcome: 'bust', score: failure.score, target: failure.target,
      boss: this.state.boss?.type ?? null, livesBefore: failure.livesBefore, livesAfter: failure.livesAfter });
    restoreRollbackState(this.state, checkpoint);
    this.state.specialOfferEffects = restoreSpecialOfferEffectsAfterBust(
      this.state.specialOfferEffects,
      persistentSpecialOfferState,
    );
    this.state.roundCheckpoint = structuredClone(checkpoint);
    this.state.roundCheckpoint.board.specialOfferEffects = restoreSpecialOfferEffectsAfterBust(
      this.state.roundCheckpoint.board.specialOfferEffects,
      persistentSpecialOfferState,
    );
    this.state.shop ??= { stage: 'shop', offers: [], offerRerolls: 0, lifeRestores: 0,
      freeDicePurchaseAvailable: false, trainingSession: createTrainingSession(this.state.handLevels) };
    this.state.shop.lifeRestores ??= 0;
    this.nextTimeline('bust', this.state.round, failure.livesAfter > 0 ? failure.attempt + 1 : failure.attempt);
    this.state.lives = failure.livesAfter;
    this.state.roundAttemptNumber = failure.livesAfter > 0 ? failure.attempt + 1 : failure.attempt;
    this.state.bust = failure;
    this.state.bustPresentationDice = terminalDice;
    this.state.stats.busts.push({ ...failure, checkpointRestored: true, returnedToShop: failure.livesAfter > 0,
      retryStarted: false, runEndedNoLives: failure.livesAfter === 0 });
    this.state.phase = failure.livesAfter > 0 ? 'bust' : 'lost';
    if (failure.livesAfter === 0) { this.state.shop = null; this.state.roundCheckpoint = null; }
    this.emit({ type: 'ROUND_BUST', amount: failure.shortfall, boss: failedBoss?.type,
      terminalDice: terminalDiceTelemetry, bustPresentationUsedFrozenDice: true,
      message: `${reason === 'retreat' ? 'RETREAT' : 'BUST'} · Round ${this.format(failure.round)} attempt ${this.format(failure.attempt)} · ${this.format(failure.score)} / ${this.format(failure.target)} · ${this.format(failure.shortfall)} short · lives ${this.format(failure.livesBefore)} → ${this.format(failure.livesAfter)}` });
    if (failure.livesAfter > 0) {
      this.state.bustPresentationDice = null;
      this.state.phase = 'shop';
      const priorStage = this.state.shop!.stage ?? 'shop';
      this.state.shop!.stage = 'shop';
      this.state.currentNodeId = failedNodeId;
      this.mapTransition(shopNodeBefore(failure.round), 'backward');
      if (priorStage !== 'shop') this.emitV2({ kind: 'shop_stage_changed', shopVisitId: this.state.shop!.visitId!,
        from: priorStage, to: 'shop' });
      this.emit({ type: 'SHOP_REOPENED_AFTER_BUST',
        message: `Round ${this.format(failure.round)} attempt ${this.format(failure.attempt)} checkpoint restored · ${this.format(this.state.manualRerollsRemaining)} Rerolls left · Care Package ${this.format(this.state.specialOfferEffects.carePackageRerolls)} · returned to the same Shop · prepare for attempt ${this.format(failure.attempt + 1)}` });
    } else {
      this.state.stats.loss = { round: failure.round, afterHand: failureLastHand, score: failure.score, afterAction: failureLastAction,
        manualRerollsRemaining: 0, values: failureValues, consumed: failureConsumed };
      this.emit({ type: 'RUN_LOST', boss: failedBoss?.type,
        message: `Run Over: ${this.format(failure.score)} / ${this.format(failure.target)}; no Lives remain` });
    }
    if (failedBoss) {
      const encounter = [...this.state.stats.bossEncounters].reverse().find(item =>
        item.round === failure.round && item.attempt === failure.attempt && item.boss === failedBoss.type);
      if (encounter) {
        encounter.busted = true;
        encounter.calledHand = failedBoss.type === 'caller' ? failedBoss.calledHand : undefined;
        encounter.callerManualPlays = failedBoss.type === 'caller' ? failedBoss.manualHandsPlayed ?? Math.max(0, 3 - failedBoss.playsRemaining) : undefined;
        encounter.callerSatisfied = failedBoss.type === 'caller' ? failedBoss.satisfied : undefined;
        encounter.callerSatisfyingSource = failedBoss.type === 'caller' ? failedBoss.satisfyingSource : undefined;
        encounter.wardenUnlockTargets = failedBoss.type === 'warden' ? failedBoss.unlockTargets : undefined;
        encounter.wardenStartingDieId = failedBoss.type === 'warden' ? failedBoss.startingDieId : undefined;
        encounter.wardenActiveDiceAtEnd = failedBoss.type === 'warden' ? failedBoss.activeDieIds.length : undefined;
      }
    }
  }

  private continuePostRoundFlow(): void {
    const localRound = chapterRoundForRound(this.state.round);
    const bossReward = this.state.roundSummary?.encounterType === 'boss';
    if (!bossReward) this.openShop();
    else if (localRound === 3) {
      const lifecycle = this.state.chapterLifecycle[chapterNumberForRound(this.state.round)];
      if (lifecycle?.specialOfferConsumed) this.openShop();
      else this.openSpecialOffer();
    } else if (localRound === 6) this.openFlameSelection();
    else this.openShop();
  }

  startRound(retry = false, direction: 'forward' | 'backward' = 'forward'): void {
    if (retry) {
      const priorBust = this.state.stats.busts.at(-1);
      if (priorBust?.round === this.state.round && !priorBust.retryStarted) priorBust.retryStarted = true;
    }
    const precedingShopDiePurchase = this.state.shop?.diePurchased === true;
    const roundStartLives = this.state.lives;
    const roundStartRosterSize = rosterDice(this.state).length;
    this.enterChapterIfNeeded(this.state.round);
    const chargeBeforeRoundReset = this.state.chargeXMult;
    const chargeWasArmed = this.state.chargeArmed;
    const priorBribery = { purchasedCount: this.state.interactiveFlames.briberyPurchasedThisRound ?? 0,
      pendingCount: this.state.interactiveFlames.briberyPendingCount ?? 0 };
    if (this.state.chargeXMult !== 1 || this.state.chargeArmed) this.state.stats.chargeResets++;
    this.state.phase = 'round'; this.state.score = 0n; this.state.scoreByHand = {}; this.state.effectScore = 0n;
    this.state.roundTemper = { overkill: 0, boardRefresh: 0, miniBoss: 0, boss: 0 };
    if (!retry) this.state.specialOfferEffects.bottledFairyTriggeredThisRound = false;
    this.state.manualRerollsRemaining = CONFIG.manualRerollsPerRound;
    this.state.manualRerollsUsedThisRound = 0;
    this.state.consumed = []; this.state.scorecardCycleConsumed = []; this.state.targetPracticeHand = null; this.state.lastRoundPayout = null; this.state.roundSummary = null;
    this.state.chargeXMult = 1; this.state.chargeArmed = false; this.state.chargeAttribution = {}; this.state.hotStreakCharges = 0;
    this.state.minigunUpperStreak = 0;
    this.state.roundPlayCount = 0;
    this.state.roundStartLives = roundStartLives;
    this.state.roundStartRosterSize = roundStartRosterSize;
    this.state.precedingShopDiePurchase = precedingShopDiePurchase;
    this.state.interactiveFlames = { burnItDownUses: 0, greaseTheEngineUses: 0,
      hotPotatoDieId: null, hotPotatoStreak: 0, dareDevilCount: 0,
      briberyPurchasedThisRound: 0, briberyPendingCount: 0 };
    this.state.scoreWagers = { nextPackageId: 1, packages: [], pendingDoubleOrNothing: null,
      doubleOrNothing: null, allInArmed: false };
    if (chargeBeforeRoundReset !== 1 || chargeWasArmed) this.emitV2({ kind: 'charge_changed', operation: 'round_reset',
      before: chargeBeforeRoundReset, after: 1, dieIds: [] });
    if (priorBribery.purchasedCount > 0 || priorBribery.pendingCount > 0)
      this.emitV2({ kind: 'flame_action', flame: 'bribery', action: { type: 'bribery_round_reset', ...priorBribery } });
    this.v2LastCharge = 1;
    this.state.flameSelection = null; this.state.specialOffer = null; this.state.bust = null; this.state.stats.roundReached = this.state.round;
    this.state.encounterDice = [];
    syncActiveDiceProjection(this.state);
    this.state.dieRoundState = resetDieRoundState(rosterDice(this.state));
    const bossType = this.state.bossSchedule[this.state.round]
      ?? (this.state.round > 60 ? bossTypeForRound(this.state.seed, this.state.round) : null);
    if (bossType) this.state.bossSchedule[this.state.round] = bossType;
    const bossSilenced = !!bossType && this.state.specialOfferEffects.silence;
    const goalRound = this.state.round + this.state.goalProgressionOffset;
    const bossForGoalRound = (candidateGoalRound: number) => {
      const scenarioRound = candidateGoalRound - this.state.goalProgressionOffset;
      return this.state.bossSchedule[scenarioRound]
        ?? (scenarioRound > 60 ? bossTypeForRound(this.state.seed, scenarioRound) : null);
    };
    const targetBreakdown = getEncounterGoalBreakdown(
      goalRound, bossType ?? null, bossSilenced, bossForGoalRound,
    );
    const { chapter: _targetChapter, localRound: _targetLocalRound, ...historyTargetBreakdown } = targetBreakdown;
    const { chapterNumber: scenarioChapter, chapterRound: scenarioChapterRound } = chapterPosition(this.state.round);
    this.state.target = targetBreakdown.finalGoal;
    this.state.boss = bossType ? createBossRuntime(this.state.seed, this.state.round, bossType, {
      handPlayCounts: this.state.handPlayCounts,
      playerDieIds: rosterDice(this.state).map(die => die.id),
      eligibleHands: HAND_IDS.filter(hand => HANDS[hand].rank !== undefined || HANDS[hand].size! <= rosterDice(this.state).length),
    }) : null;
    this.state.bossSilenced = bossSilenced;
    if (this.state.bossSilenced) this.state.specialOfferEffects.silence = false;
    if (!this.state.bossSilenced && this.state.boss?.type === 'neglected')
      this.state.consumed.push(...this.state.boss.neglectedHands);
    if (!this.state.bossSilenced && this.state.boss?.type === 'tightrope') this.state.manualRerollsRemaining = 0;
    if (!this.state.bossSilenced && (this.state.boss?.type === 'magician' || this.state.boss?.type === 'fly'))
      this.state.manualRerollsRemaining *= 2;
    if (!this.state.bossSilenced && this.state.boss?.type === 'magician') {
      const missingDieId = this.state.boss.missingDieId;
      if (missingDieId !== null) {
        const missingDie = this.state.dice.find(die => die.id === missingDieId);
        if (!missingDie) throw new Error('The Magician requires an equipped player die to disappear.');
      }
    }
    if (!this.state.bossSilenced && this.state.boss?.type === 'warden') {
      this.state.boss.unlockCosts = wardenUnlockCosts(this.state.handLevels, [], this.state.target,
        this.state.boss.encounterDieIds.length);
    }
    const sixPackInvestment = flameByType(this.state, 'sixPack')?.investedGold ?? 0;
    this.state.sixPackXMult = sixPackStartingMultiplier(sixPackInvestment);
    this.state.sixPackUpperHandsPlayed = 0;
    this.state.hotStreakGoal = ownedFlameIds(this.state).has('hotStreak') ? 'pair' : null;
    this.state.handFamilyFlameStages = initialHandFamilyFlameStages(this.state);
    this.state.progressiveFlames = { topDown: 0, countDown: 0 };
    this.captureRoundCheckpoint();
    this.state.shop = null;
    this.mapTransition(encounterNode(this.state.round, bossType), direction);
    this.state.stats.rounds.push({ round: this.state.round, attempt: this.state.roundAttemptNumber, target: this.state.target, firstCrossedScore: null,
      finalScore: 0n, clearMargin: null, cleared: false, lastHand: null, lastAction: null,
      manualRerollsGranted: this.state.manualRerollsRemaining, manualRerollChargesSpent: 0,
      manualRerollsRemainingAtClear: null, manualRerollActions: 0, deadBoardRescues: 0, scoreByHand: {}, effectScore: 0n,
      goldBefore: this.state.gold, goldBySourceBefore: structuredClone(this.state.stats.goldBySource), payout: null });
    const v2RoundStarted = this.emitV2({ kind: 'round_attempt_started', chapter: scenarioChapter,
      chapterRound: scenarioChapterRound, retry, target: historyTargetBreakdown,
      boss: this.state.boss?.type ?? null, lives: this.state.lives,
      dice: activeEncounterDice(this.state).map(die => this.historyDie(die.id)),
      flames: structuredClone(flameInstances(this.state)) });
    this.recordUltimateTargets(retry ? 'retry' : 'round_start', retry);
    this.recordBenchWarmerTarget(retry ? 'retry' : 'round_start', retry);
    if (this.state.boss) {
      const boss = this.state.boss;
      this.state.stats.bossEncounters.push({ boss: boss.type, round: this.state.round, attempt: this.state.roundAttemptNumber,
        started: true, cleared: false, busted: false,
        calledHand: boss.type === 'caller' ? boss.calledHand : undefined,
        wardenUnlockTargets: boss.type === 'warden' ? boss.unlockTargets : undefined,
        wardenStartingDieId: boss.type === 'warden' ? boss.startingDieId : undefined });
      this.emit({ type: 'BOSS_STARTED', boss: boss.type,
        message: `${boss.type.toUpperCase()} · Round ${this.format(this.state.round)} · Attempt ${this.format(this.state.roundAttemptNumber)} · goal ${this.format(this.state.target)}` });
      if (this.state.bossSilenced) this.emit({ type: 'SPECIAL_EFFECT_TRIGGERED', boss: boss.type,
        message: `Silence disabled ${boss.type.toUpperCase()} for this encounter` });
      if (!this.state.bossSilenced && boss.type === 'caller') this.emit({ type: 'CALLER_CALLED', boss: 'caller', hand: boss.calledHand, amount: 3,
        message: `The Caller demands ${HANDS[boss.calledHand].name} within 3 plays` });
      if (!this.state.bossSilenced && boss.type === 'fly' && boss.flyHand) this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'fly', hand: boss.flyHand,
        bossState: 'target', message: `The Fly started on ${HANDS[boss.flyHand].name}` });
      if (!this.state.bossSilenced && boss.type === 'magician') this.emit({ type: 'BOSS_HAND_CHANGED', boss: boss.type,
        message: boss.missingDieId === null
          ? `The Magician calls ${boss.calledHands.map(hand => HANDS[hand].name).join(', ')}; the final die remains`
          : `The Magician calls ${boss.calledHands.map(hand => HANDS[hand].name).join(', ')}; ${this.dieLabel(boss.missingDieId)} disappeared` });
      if (!this.state.bossSilenced && boss.type === 'neglected') this.emit({ type: 'BOSS_HAND_CHANGED', boss: boss.type,
        hands: [...boss.neglectedHands], amount: 0, bossState: 'restricted',
        message: `The Neglected disabled ${boss.neglectedHands.map(hand => HANDS[hand].name).join(' and ')} until 6 hands have been played` });
    }
    if (!this.state.boss) this.emit({ type: retry ? 'ROUND_RETRY_STARTED' : 'ROUND_STARTED',
      message: `Round ${this.format(this.state.round)} — Attempt ${this.format(this.state.roundAttemptNumber)} — goal ${this.format(this.state.target)}; Charge reset to ×1` });
    this.selectTargetPractice();
    if (!this.state.bossSilenced && this.state.boss?.type === 'hexer') {
      this.state.handLevels.sevens = upperBaselineLevel(this.state.handLevels);
      this.state.encounterDice.push(createCursedDie());
      syncActiveDiceProjection(this.state);
    }
    this.ensureHotPotatoTarget();
    this.v2ParentSeq = v2RoundStarted.seq;
    if (!this.state.bossSilenced && this.state.boss?.type === 'warden') {
      const playerDice = rosterDice(this.state);
      if (!playerDice.length) throw new Error('The Warden requires at least one player die.');
      this.rollBatch(playerDice.map(die => die.id), 'Warden opening roll', 'wardenSetup', false, 'warden_opening');
    } else this.rollBatch(activeEncounterDice(this.state).map(die => die.id), 'Initial round roll', 'gameplay', false, 'initial_round');
    this.drain();
    this.ensureNeglectedOpeningPlay();
    this.evaluate();
    if (v2RoundStarted.kind === 'round_attempt_started')
      v2RoundStarted.dice = activeEncounterDice(this.state).map(die => this.historyDie(die.id));
    if (this.state.phase === 'round') this.state.decisionId++;
  }
  freshOffers(reason: 'initial' | 'reroll' = 'initial'): void {
    this.state.shop!.offers = createDiceOffers(this.rng, () => this.state.nextOfferId++);
    const offerSet = this.state.shop!.offers.map(offer => ({ name: SPECIAL_DICE[offer.dieType!].name, rarity: offer.rarity! }));
    this.log({ type: 'OFFERS_REFRESHED', offerSet,
      message: `Dice offers: ${offerSet.map(item => `${item.name} [${item.rarity}]`).join(', ')}` });
    this.emitV2({ kind: 'shop_offers_presented', pool: 'dice', reason, shopVisitId: this.state.shop!.visitId,
      offers: this.state.shop!.offers.map(offer => ({ id: offer.id, contentId: offer.dieType!,
        rarity: offer.rarity!, price: offer.price! })) });
  }
  freshFlameOffers(): void {
    const owned = ownedFlameIds(this.state);
    const pool = eligibleFlameIds(this.state).filter(id => !owned.has(id));
    const selected = rarityFirstSelection(pool, 3, id => FLAMES[id].rarity, OFFER_RARITY_WEIGHTS.flame, this.rng);
    this.state.flameSelection!.offers = selected.map(flame => ({ id: this.state.nextOfferId++, flame }));
    const offerSet = selected.map(id => ({ name: FLAMES[id].name, rarity: FLAMES[id].rarity }));
    this.log({ type: 'FLAME_OFFERS_REFRESHED', offerSet,
      message: `Flame offers: ${offerSet.map(item => `${item.name} [${rarityLabel(item.rarity)}]`).join(', ')}` });
    this.emitV2({ kind: 'shop_offers_presented', pool: 'flame', reason: 'reward',
      offers: this.state.flameSelection!.offers.map(offer => ({ id: offer.id, contentId: offer.flame,
        rarity: FLAMES[offer.flame].rarity })) });
  }
  freshSpecialOffers(): void {
    const pool = eligibleSpecialOfferTypes(this.state);
    const selected = rarityFirstSelection(pool, 3, type => SPECIAL_OFFERS[type].rarity,
      OFFER_RARITY_WEIGHTS.specialOffer, this.rng);
    this.state.specialOffer!.offers = selected.map(type => {
      const offer: SpecialOffer = { id: this.state.nextOfferId++, type };
      if (type === 'focus') offer.hand = HAND_IDS[randomIndex(this.rng, HAND_IDS.length)];
      return offer;
    });
    const offerSet = this.state.specialOffer!.offers.map(offer => ({ name: specialOfferName(offer), rarity: SPECIAL_OFFERS[offer.type].rarity }));
    this.log({ type: 'SPECIAL_OFFER_OPENED', offerSet,
      message: `Special Offers: ${offerSet.map(item => `${item.name} [${rarityLabel(item.rarity)}]`).join(', ')}` });
    this.emitV2({ kind: 'shop_offers_presented', pool: 'special_offer', reason: 'reward',
      offers: this.state.specialOffer!.offers.map(offer => ({ id: offer.id, contentId: offer.type,
        rarity: SPECIAL_OFFERS[offer.type].rarity })) });
  }
  selectTargetPractice(): void {
    if (!ownedFlameIds(this.state).has('targetPractice')) return;
    const candidates: HandId[] = [];
    const counts = [...new Set(LOWER_HAND_IDS.map(hand => this.state.handPlayCounts[hand]))].sort((a, b) => a - b);
    for (const count of counts) {
      const tied = LOWER_HAND_IDS.filter(hand => this.state.handPlayCounts[hand] === count);
      while (tied.length && candidates.length < 3) candidates.push(tied.splice(randomIndex(this.rng, tied.length), 1)[0]);
      if (candidates.length === 3) break;
    }
    this.state.targetPracticeHand = candidates[randomIndex(this.rng, candidates.length)];
    this.emit({ type: 'TARGET_PRACTICE_SELECTED', flame: 'targetPractice', hand: this.state.targetPracticeHand,
      message: `Target Practice: ${HANDS[this.state.targetPracticeHand].name}` });
  }
  private performInfernoEvaluation(): void {
    if (this.state.infernoEvaluationSuspendedUntilNewFlame) {
      this.state.infernoEvaluation = null;
      return;
    }
    const evaluation = createInfernoEvaluation(this.state);
    if (!evaluation) { this.state.infernoEvaluation = null; return; }
    this.state.infernoProgress.evaluationIndex = evaluation.evaluationIndex;
    this.state.infernoProgress.previousReadiness = evaluation.readiness;
    this.state.infernoProgress.recentAction = 'none';
    if (evaluation.feedbackMessageId && !evaluation.suspendAfterContinue) this.state.infernoProgress.recentMessageIds = [
      ...this.state.infernoProgress.recentMessageIds.filter(id => id !== evaluation.feedbackMessageId),
      evaluation.feedbackMessageId,
    ].slice(-3);
    this.state.infernoEvaluation = evaluation;
    this.emitV2({ kind: 'inferno_evaluated', evaluation: structuredClone(evaluation) });
  }
  engulfNow(): void {
    const evaluation = this.state.infernoEvaluation;
    if (!evaluation?.success || evaluation.engulfed) throw new Error('A ready Inferno evaluation is required.');
    const ownedKeys = new Set(ownedEngulfmentAssets(this.state).map(engulfmentAssetKey));
    if (evaluation.flamesSnuffed.some(asset => !ownedKeys.has(engulfmentAssetKey(asset))))
      throw new Error('The frozen Inferno offering no longer matches the current build.');

    for (const asset of evaluation.flamesSnuffed) {
      delete this.state.chargeAttribution[asset.instanceId];
      removeFlameInstance(this.state, asset.instanceId);
    }
    this.state.engulfmentLevel = evaluation.infernoLevelAfter;
    for (const item of evaluation.upper.levelsBefore) this.state.handLevels[item.hand] = evaluation.upper.unifiedLevel;
    for (const item of evaluation.lower.levelsBefore) this.state.handLevels[item.hand] = evaluation.lower.unifiedLevel;
    if (!ownedFlameIds(this.state).has('fetch')) this.state.fetchTarget = null;
    if (!ownedFlameIds(this.state).has('targetPractice')) this.state.targetPracticeHand = null;
    this.state.handFamilyFlameStages = Object.fromEntries(Object.entries(this.state.handFamilyFlameStages)
      .filter(([flame]) => ownedFlameIds(this.state).has(flame as Flame)));
    recalculateMaxCharge(this.state);
    evaluation.engulfed = true;
    if (this.state.runMode === 'scenario' && this.state.scenario && !this.state.scenario.completionAcknowledged)
      this.state.scenario.completionPending = true;
    this.emitV2({ kind: 'engulfment_attempted', shopVisitId: this.state.nextShopVisitId, attemptNumber: 1,
      infernoLevelBefore: evaluation.infernoLevelBefore, infernoLevelAfter: evaluation.infernoLevelAfter,
      infernoMultiplierBefore: evaluation.infernoMultiplierBefore, infernoMultiplierAfter: evaluation.infernoMultiplierAfter,
      offerings: evaluation.flames.map(item => ({ asset: structuredClone(item.asset) })),
      evidenceRounds: structuredClone(evaluation.evidenceRounds), offeringMultiplier: evaluation.effectiveValue,
      requiredMultiplier: evaluation.threshold, success: true,
      overqualification: Math.max(0, evaluation.effectiveValue - evaluation.threshold),
      upper: structuredClone(evaluation.upper), lower: structuredClone(evaluation.lower),
      flamesSnuffed: structuredClone(evaluation.flamesSnuffed), questForfeited: false, returnedToShop: true });
    this.recordUltimateTargets('engulfment');
    this.recordBenchWarmerTarget('engulfment');
    this.addTemper(25, 'engulfment', 'Successful Engulfment');
    this.state.infernoProgress.previousReadiness = 0;
    this.emit({ type: 'INFERNO_EVALUATED',
      message: `Engulfment accepted: Inferno ${this.format(evaluation.infernoMultiplierBefore)} to ${this.format(evaluation.infernoMultiplierAfter)}; ${this.format(evaluation.flamesSnuffed.length)} Flame${evaluation.flamesSnuffed.length === 1 ? '' : 's'} snuffed` });
  }
  deferEngulfment(): void {
    const evaluation = this.state.infernoEvaluation;
    if (!evaluation?.success || evaluation.engulfed) throw new Error('A pending ready Inferno evaluation is required.');
    this.emit({ type: 'INFERNO_EVALUATED', message: 'Engulfment postponed; the current build was preserved' });
    this.state.infernoEvaluation = null;
    this.continuePostRoundFlow();
  }
  private clearEncounterDice(): void {
    cleanupTemporaryBossFaces(this.state.dice);
    this.state.encounterDice = [];
    syncActiveDiceProjection(this.state);
  }
  openShop(direction: 'forward' | 'backward' = 'forward'): void {
    this.restoreMagicianDie();
    this.clearEncounterDice();
    this.state.boss = null; this.state.bossSilenced = false;
    this.state.phase = 'shop'; this.state.flameSelection = null; this.state.specialOffer = null; this.state.roundSummary = null;
    const postBoss = isBigBossRound(this.state.round);
    const visitId = this.state.nextShopVisitId++;
    const onTheHouse = this.state.specialOfferEffects.onTheHouse;
    this.state.shop = { visitId, stage: 'shop', kind: postBoss ? 'post_boss' : 'between_rounds', exitUnlocked: false,
      offers: [], offerRerolls: 0, lifeRestores: 0,
      freeDicePurchaseAvailable: onTheHouse,
      diePurchased: false,
      trainingSession: createTrainingSession(this.state.handLevels, onTheHouse),
      forgeSelection: { dieAId: null, dieBId: null } };
    const upcomingRound = this.state.round + 1;
    const upcomingBoss = this.state.bossSchedule[upcomingRound];
    if (upcomingBoss) this.state.bossSchedule[upcomingRound] = upcomingBoss;
    this.mapTransition(postBoss ? postBossShopNodeAfter(this.state.round) : shopNodeBefore(upcomingRound), direction);
    this.emitV2({ kind: 'shop_visit_started', shopVisitId: visitId,
      reason: direction === 'backward' ? 'bad_dream' : 'normal', initialStage: 'shop' });
    const trainingSession = this.state.shop.trainingSession!;
    this.emitV2({ kind: 'training_session_started', shopVisitId: visitId,
      upperLevelsAtEntry: structuredClone(trainingSession.upperLevelsAtEntry),
      lowerLevelsAtEntry: structuredClone(trainingSession.lowerLevelsAtEntry),
      upperBaseline: trainingSession.upperBaseline,
      lowerBaseline: trainingSession.lowerBaseline });
    this.freshOffers();
    if (onTheHouse) {
      this.state.specialOfferEffects.onTheHouse = false;
      this.emit({ type: 'SPECIAL_EFFECT_TRIGGERED', message: 'On The House made the first Dice and individual Training purchases free' });
    }
    this.emit({ type: 'SHOP_OPENED', message: 'Shop opened; gameplay faces preserved' });
  }
  openFlameSelection(): void {
    this.restoreMagicianDie();
    this.clearEncounterDice();
    this.state.boss = null; this.state.bossSilenced = false;
    this.state.phase = 'flameSelection'; this.state.shop = null; this.state.specialOffer = null; this.state.roundSummary = null;
    this.state.flameSelection = { offers: [], acquired: false };
    this.mapTransition(flameNodeAfter(this.state.round));
    this.freshFlameOffers();
    this.emit({ type: 'FLAME_SELECTION_OPENED', message: 'Flame Selection — choose and assign one new Flame, or skip' });
  }
  openSpecialOffer(): void {
    const chapter = chapterNumberForRound(this.state.round);
    if (this.state.chapterLifecycle[chapter]?.specialOfferConsumed) {
      this.openShop();
      return;
    }
    this.restoreMagicianDie();
    this.clearEncounterDice();
    this.state.boss = null; this.state.bossSilenced = false;
    this.state.phase = 'specialOffer'; this.state.shop = null; this.state.flameSelection = null; this.state.roundSummary = null;
    this.state.specialOffer = { offers: [], acquired: false };
    this.mapTransition(specialOfferNodeAfter(this.state.round));
    this.freshSpecialOffers();
    this.emit({ type: 'SPECIAL_OFFER_OPENED', message: 'Special Offer — choose one' });
  }
  chooseSpecialOffer(offerId: number): void {
    const selection = this.state.specialOffer!;
    const offer = selection.offers.find(item => item.id === offerId)!;
    selection.acquired = true;
    selection.chosen = structuredClone(offer);
    const chapter = chapterNumberForRound(this.state.round);
    this.state.chapterLifecycle[chapter] = { specialOfferConsumed: true };
    let captureBadDream = false;
    let timeTravelDestination: number | null = null;
    switch (offer.type) {
      case 'onTheHouse': this.state.specialOfferEffects.onTheHouse = true; break;
      case 'greatFairy':
        if (this.state.lives >= CONFIG.maxLives) this.addGold(15, 'Great Fairy: +15 Gold', 'specialOffer');
        else this.state.lives = CONFIG.maxLives;
        break;
      case 'focus':
        if (!offer.hand) throw new Error('Focus offer is missing its fixed hand.');
        this.state.handLevels[offer.hand] += 4;
        this.recordUltimateTargets('focus');
        this.recordBenchWarmerTarget('focus');
        break;
      case 'timeTravel': {
        timeTravelDestination = timeTravelDestinationRound(this.state.round);
        break;
      }
      case 'carePackage': this.state.specialOfferEffects.carePackageRerolls += 3; break;
      case 'silence': this.state.specialOfferEffects.silence = true; break;
      case 'taxEvasion': this.state.specialOfferEffects.taxEvasionRounds += 3; break;
      case 'fireKeeper': {
        const embers = flameInstances(this.state).filter(flame => flame.stage === 'ember');
        const flame = embers[randomIndex(this.rng, embers.length)];
        const from = flame.investedGold;
        flame.investedGold = fireKeeperInvestment(from);
        this.state.infernoProgress.recentAction = 'flame_invested';
        this.emit({ type: 'FLAME_INVESTED', flame: flame.type, amount: flame.investedGold - from,
          message: `Fire Keeper stoked ${FLAMES[flame.type].name}: ${this.format(from)} → ${this.format(flame.investedGold)} / 100` });
        if (flame.investedGold === 100) {
          flame.stage = 'bonfire';
          this.state.infernoProgress.recentAction = 'bonfire_created';
          this.addTemper(10, 'bonfire', 'BONFIRE CREATED');
          this.emit({ type: 'BONFIRE_CREATED', flame: flame.type, message: `${FLAMES[flame.type].name} became a Bonfire` });
        }
        recalculateMaxCharge(this.state);
        break;
      }
      case 'bottledFairy': this.state.specialOfferEffects.bottledFairyRounds += 3; break;
      case 'badDream':
        this.state.specialOfferEffects.badDreamRounds = 3;
        captureBadDream = true;
        break;
      case 'teamTraining': {
        const levelsBefore = structuredClone(this.state.handLevels);
        for (const hand of HAND_IDS) this.state.handLevels[hand]++;
        this.emitV2({ kind: 'team_training_applied', offerId: offer.id, levelsBefore,
          levelsAfter: structuredClone(this.state.handLevels) });
        this.recordUltimateTargets('team_training');
        this.recordBenchWarmerTarget('team_training');
        break;
      }
    }
    const rarity = SPECIAL_OFFERS[offer.type].rarity;
    this.emit({ type: 'SPECIAL_OFFER_SELECTED', hand: offer.hand, rarity,
      message: `${specialOfferName(offer)} [${rarityLabel(rarity)}] selected — ${specialOfferDescription(offer)}` });
    if (timeTravelDestination !== null) {
      this.nextTimeline('time_travel', timeTravelDestination, 1, 'chapter_start');
      this.state.round = timeTravelDestination;
    }
    if (captureBadDream) {
      this.state.badDreamCheckpoint = { chapter };
    }
  }
  continueSpecialOffer(): void {
    const timeTravel = this.state.specialOffer?.chosen?.type === 'timeTravel';
    if (timeTravel) {
      this.state.roundAttemptNumber = 1;
      this.startRound(false, 'backward');
    }
    else this.openShop();
  }
  continueRoundSummary(): void {
    const summary = this.state.roundSummary;
    if (!summary) throw new Error('Round Summary is not available.');
    if (this.state.infernoEvaluation) this.state.phase = 'inferno';
    else this.continuePostRoundFlow();
  }
  continueInfernoEvaluation(): void {
    if (!this.state.infernoEvaluation) throw new Error('Inferno evaluation is not available.');
    if (this.state.infernoEvaluation.success && !this.state.infernoEvaluation.engulfed)
      throw new Error('Choose whether to Engulf now or not yet.');
    if (this.state.runMode === 'scenario' && this.state.scenario?.completionPending) {
      this.state.phase = 'scenarioComplete';
      return;
    }
    if (this.state.infernoEvaluation.suspendAfterContinue) {
      this.state.infernoEvaluationSuspendedUntilNewFlame = true;
      this.emitV2({ kind: 'inferno_suspension_changed', suspended: true, reason: 'collection_insufficient' });
    }
    this.state.infernoEvaluation = null;
    this.continuePostRoundFlow();
  }
  continueScenarioRun(): void {
    if (this.state.phase !== 'scenarioComplete' || !this.state.scenario?.completionPending || !this.state.infernoEvaluation?.engulfed)
      throw new Error('Scenario completion is not awaiting continuation.');
    this.state.scenario.completionPending = false;
    this.state.scenario.completionAcknowledged = true;
    this.state.phase = 'inferno';
    this.continueInfernoEvaluation();
  }
  private completeSpecialOfferRound(): void {
    const effects = this.state.specialOfferEffects;
    for (const key of ['taxEvasionRounds', 'bottledFairyRounds', 'badDreamRounds'] as const)
      if (effects[key] > 0) effects[key]--;
    if (effects.badDreamRounds === 0) this.state.badDreamCheckpoint = null;
  }
  evaluate(): void {
    if (this.state.phase !== 'round') return;
    const current = this.state.stats.rounds.at(-1)!;
    current.finalScore = this.state.score;
    if (this.state.score >= this.state.target) {
      current.cleared = true; current.clearMargin = this.state.score - this.state.target;
      current.manualRerollsRemainingAtClear = this.state.manualRerollsRemaining;
      if (this.state.boss) {
        this.restoreMagicianDie();
        cleanupTemporaryBossFaces(this.state.dice);
        const encounter = this.state.stats.bossEncounters.at(-1);
        if (encounter?.round === this.state.round && encounter.attempt === this.state.roundAttemptNumber) {
          encounter.cleared = true;
          if (this.state.boss.type === 'caller') {
            encounter.callerManualPlays = this.state.boss.manualHandsPlayed ?? Math.max(0, 3 - this.state.boss.playsRemaining);
            encounter.callerSatisfied = this.state.boss.satisfied;
            encounter.callerSatisfyingSource = this.state.boss.satisfyingSource;
          }
          if (this.state.boss.type === 'warden') encounter.wardenActiveDiceAtEnd = this.state.boss.activeDieIds.length;
        }
        this.emit({ type: 'BOSS_CLEARED', boss: this.state.boss.type,
          message: `${this.state.boss.type.toUpperCase()} cleared with ${this.format(this.state.score)} / ${this.format(this.state.target)}` });
      }
      this.emit({ type: 'ROUND_CLEARED', message: `Round ${this.format(this.state.round)} cleared with ${this.format(this.state.score)} / ${this.format(this.state.target)}` });
      const bossType = this.state.boss?.type ?? null;
      const bossRewardLabel = bossType && isMiniBossType(bossType) ? 'Mini-Boss Reward' : 'Boss Reward';
      const heldGoldSnapshot = this.state.gold;
      const payout = { baseGold: roundReward(), unusedRerollGold: Math.max(0, this.state.manualRerollsRemaining - Math.max(0, this.options.nonPayingManualRerolls ?? 0)),
        interestGold: interestForGold(heldGoldSnapshot) * (this.state.specialOfferEffects.taxEvasionRounds > 0 ? 2 : 1),
        bossRewardGold: bossType ? bossRewardForEncounter(isMiniBossType(bossType)) : 0,
        heldGoldSnapshot, totalRoundRewardGold: 0 };
      payout.totalRoundRewardGold = payout.baseGold + payout.unusedRerollGold + payout.interestGold + payout.bossRewardGold;
      current.payout = payout; this.state.lastRoundPayout = payout;
      this.addGold(payout.baseGold, `Round clear base: +${this.format(payout.baseGold)} gold`, 'roundBase');
      if (payout.unusedRerollGold) this.addGold(payout.unusedRerollGold, `Unused rerolls: +${this.format(payout.unusedRerollGold)} gold`, 'unusedRerolls');
      if (payout.interestGold) this.addGold(payout.interestGold, `Interest on ${this.format(heldGoldSnapshot)} held Gold: +${this.format(payout.interestGold)}`, 'interest');
      if (payout.bossRewardGold) this.addGold(payout.bossRewardGold, `${bossRewardLabel}: +${this.format(payout.bossRewardGold)} gold`, 'bossReward');
      const overkill = this.state.target > 0n
        ? Number(((this.state.score - this.state.target) * 5n) / this.state.target) : 0;
      this.addTemper(Math.max(0, Math.min(5, overkill)), 'overkill', 'Overkill');
      if (bossType) this.addTemper(isMiniBossType(bossType) ? 2 : 3,
        isMiniBossType(bossType) ? 'miniBoss' : 'boss', isMiniBossType(bossType) ? 'Mini-Boss defeated' : 'Boss defeated');
      this.commitRoundTemper();
      const goldenGold = this.state.stats.goldBySource.golden - current.goldBySourceBefore.golden;
      const jackpotGold = this.state.stats.goldBySource.jackpot - current.goldBySourceBefore.jackpot;
      const knownGold = payout.baseGold + payout.unusedRerollGold + payout.interestGold + payout.bossRewardGold + goldenGold + jackpotGold;
      const totalGoldEarned = Object.entries(this.state.stats.goldBySource)
        .reduce((total, [source, amount]) => total + amount - (current.goldBySourceBefore[source as GoldSource] ?? 0), 0);
      const temperTotal = Object.values(this.state.roundTemper).reduce((sum, amount) => sum + amount, 0);
      const summary = this.state.roundSummary = {
        round: this.state.round, encounterType: bossType ? 'boss' : 'normal', bossType,
        score: this.state.score, target: this.state.target, goldBefore: current.goldBefore, goldAfter: this.state.gold,
        totalGoldEarned, sources: {
          baseRewardGold: payout.baseGold, unusedRerollGold: payout.unusedRerollGold, interestGold: payout.interestGold,
          bossRewardGold: payout.bossRewardGold, goldenGold, jackpotGold, otherGold: totalGoldEarned - knownGold,
        },
        temper: { ...this.state.roundTemper, total: temperTotal },
      };
      if (Object.values(summary.sources).reduce((sum, amount) => sum + amount, 0) !== totalGoldEarned)
        throw new Error('Round Summary Gold sources do not reconcile.');
      this.state.phase = 'roundSummary';
      this.completeSpecialOfferRound();
      this.emit({ type: 'ROUND_SUMMARY_SHOWN', boss: bossType ?? undefined, roundSummary: structuredClone(summary), amount: totalGoldEarned,
        encounterType: summary.encounterType, goldBefore: summary.goldBefore, goldAfter: summary.goldAfter,
        goldEarnedTotal: totalGoldEarned, baseRewardGold: payout.baseGold, unusedRerollGold: payout.unusedRerollGold,
        interestGold: payout.interestGold, bossRewardGold: payout.bossRewardGold, goldenGold, jackpotGold,
        message: `${bossType ? `${isMiniBossType(bossType) ? 'Mini-Boss' : 'Boss'} defeated` : `Round ${this.format(this.state.round)} cleared`} · Gold ${this.format(summary.goldBefore)} → ${this.format(summary.goldAfter)} (+${this.format(totalGoldEarned)})` });
      this.performInfernoEvaluation();
    } else if (this.state.bossSilenced || this.state.boss?.type !== 'warden' || (this.state.boss.startingDieId !== null && this.state.boss.pendingReinforcements === 0)) {
      if (hasPlayableHand(activeEncounterDice(this.state), unavailableEncounterHands(this.state),
        requiredEncounterDieIds(this.state), this.state.dieRoundState)) return;
      const rerolls = usableManualRerolls(this.state);
      if (rerolls > 0) { this.emit({ type: 'DEAD_BOARD', message: `No playable hands — ${this.format(rerolls)} rerolls remain` }); return; }
      if (this.state.scoreWagers.pendingDoubleOrNothing) return;
      if (this.state.specialOfferEffects.bottledFairyRounds > 0 && !this.state.specialOfferEffects.bottledFairyTriggeredThisRound) {
        this.state.manualRerollsRemaining = CONFIG.manualRerollsPerRound;
        this.state.specialOfferEffects.bottledFairyTriggeredThisRound = true;
        this.emit({ type: 'SPECIAL_EFFECT_TRIGGERED', amount: CONFIG.manualRerollsPerRound,
          message: `Bottled Fairy refilled ${this.format(CONFIG.manualRerollsPerRound)} Manual Rerolls` });
        return;
      }
      this.resolveBust();
    }
  }
}
