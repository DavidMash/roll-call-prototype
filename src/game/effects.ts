import { bossRewardForEncounter, CONFIG, interestForGold, roundReward } from './config';
import { activeFace, rollPhysicalDie, scoringPips, weightedSourceFace } from './dice';
import { diminishingHalfChance, eligibleEnhancements, ENHANCEMENTS, enhancementsUnlockedInChapter, highestUnlockedEnhancementTier, loneWolfPipsFactor, maxEnhancementTypesPerFace, personalTrainerChance, stacks, tankMultiplierFactor, VINTAGE_BASE_SELL_CAP } from './enhancements';
import {
  activeFlameId, activeFlameInvestment, captureHandStart, currentFlameInstanceId, eligibleFlameIds, FLAMES, handXMultContributions,
  fluxCapacitorChargeMultiplier, HAND_FAMILY_FLAME_IDS, HAND_FAMILY_FLAMES, hasChargeBonfire, HOT_STREAK_SEQUENCE,
  initialHandFamilyFlameStages, jumpStartChargeGain, momentumChargeGain, normalizeFlameInstanceRuntime, ownedFlameIds, recalculateMaxCharge,
  removeFlameInstance,
  sixPackMultiplierAfterUpperHands, sixPackStartingMultiplier, thirdRailChargeGain,
} from './flames';
import { combinationsForHand, hasPlayableHand, HANDS, HAND_IDS, LOWER_HAND_IDS, planQualification, rankedHands, UPPER_HAND_IDS } from './hands';
import { probabilityCheck, randomIndex } from './rng';
import { OFFER_RARITY_WEIGHTS, rarityFirstSelection, rarityLabel } from './rarity';
import { applyHandContribution, applyHandMultiplier, applyXMult, createHandAccumulator, finalizeHandScore, ordinaryFaceContributions, resolvedOrdinaryPips, type HandScoreContribution, type ScoringParticipant } from './scoring';
import { boardSnapshot } from './telemetry';
import { activeEncounterDice, bossTypeForRound, CALLER_HAND_POOL, cleanupTemporaryBossFaces, createBossRuntime, createCursedDie, handIsPhysicallyAttainable,
  isBigBossRound, isCursedDie, isMiniBossType, requiredEncounterDieIds, unavailableEncounterHands, wardenUnlockCosts } from './bosses';
import { getEncounterGoalBreakdown } from './goals';
import { encounterNode, flameNodeAfter, postBossShopNodeAfter, shopNodeBefore, specialOfferNodeAfter, timeTravelDestinationRound } from './progression';
import { formatExactDecimal, formatExactScore, formatPercentage, formatPlayerNumber } from './copy';
import { chapterEncounterRounds, chapterNumberForRound, ensureChapterPlan } from './chapters';
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
  captureBustPersistentSpecialOfferState, eligibleSpecialOfferTypes, restoreSpecialOfferEffectsAfterBust,
  SPECIAL_OFFERS, specialOfferDescription, specialOfferName, trainingOfferKey, usableManualRerolls,
} from './specialOffers';
import type { ChargeFlame, HandStartSnapshot } from './flames';
import type { Enhancement, EngulfmentAssetRef, EventRecord, Face, Flame, GameEvent, GameState, GoldSource, GoldSpendSource, HandId, HandPlaySource, HandScoreAccumulator, RandomSource, RunNode, ScoreSource, SpecialOffer } from './types';
import type {
  FlameOrigin, HandSideEffect, HistoryDieState, MultContribution, PipsContribution,
  ProbabilityCheck, RollEffect, RollReason, RunHistoryV2Event, RunHistoryV2EventInput, XMultContribution,
} from './runHistoryV2';
import { Decimal, roundPositiveScoreHalf, type ExactScore } from './scoreMath';
import { createPlayIntent, createRollBatchIntent, createRollIntent } from './resolution';
import { grantChapterStorageSlot, orderDieIdsByEncounter, rosterDice, rosterSlotOf, syncActiveDiceProjection } from './inventory';
import type { PlayIntent, QualificationPlan, RollBatchIntent, RollContext, RollIntent, RollResolution, ScoreOccurrence } from './resolution';

type RollTrigger = { dieId: number; face: Face; enhancement: 'weighted' | 'jumpingBean' | 'freePlay'; weightedStacks?: number; rollWeight?: number; weightedSourceFace?: number; rerollEventId?: string };
type V2HandDraft = {
  parentSeq?: number;
  hand: HandId;
  level: number;
  playSource: HandPlaySource;
  selectedDice: number[];
  consumed: boolean;
  roundScoreBefore: ExactScore;
  pipsContributions: PipsContribution[];
  multContributions: MultContribution[];
  xMultContributions: XMultContribution[];
  checks: ProbabilityCheck[];
  sideEffects: HandSideEffect[];
};
type V2RollDraft = { effects: RollEffect[] };
type HandResolution = {
  intent: PlayIntent;
  qualification: QualificationPlan;
  selectedParticipants: ScoringParticipant[];
  scoringParticipants: ScoringParticipant[];
  scoreOccurrences: ScoreOccurrence[];
  accumulator: HandScoreAccumulator;
  wouldConsumeHand: boolean;
  consumesHand: boolean;
};
export interface ResolverOptions {
  tutorialFinalLifeSafeguard?: boolean;
  nonPayingManualRerolls?: number;
  /** Test-only parity switch; gameplay and legacy instrumentation must remain identical when V2 is disabled. */
  disableHistoryV2?: boolean;
}
const NORMAL_SHOP_SPEND = new Set<GoldSpendSource>(['enhancement', 'shopDiceReroll', 'enhancementReroll', 'handTraining', 'lifeRestore']);
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
  private v2RecentHand: import('./runHistoryV2').HandScoredEvent | null = null;
  private v2Roll: V2RollDraft | null = null;
  private v2ManualSpend: import('./runHistoryV2').RollBatchEvent['spend'] = null;
  private v2ParentSeq: number | undefined;
  private lastV2RollSeq: number | undefined;
  private v2LastCharge: number;
  private pendingFreePlayEventId: string | null = null;
  private pendingFlywheel = new Map<number, number>();
  constructor(readonly state: GameState, readonly rng: RandomSource, readonly options: ResolverOptions = {}) {
    state.historyV2 ??= [];
    state.historyV2TimelineId = Math.max(0, Math.floor(state.historyV2TimelineId ?? 0));
    normalizeFlameInstanceRuntime(state);
    this.v2LastCharge = state.chargeXMult;
    recalculateMaxCharge(state);
  }

  private historyDie(dieId: number, faceSnapshot?: Face): HistoryDieState {
    const die = this.state.dice.find(item => item.id === dieId)!;
    const face = faceSnapshot ?? activeFace(die);
    const flame = activeFlameId(die.flame);
    const flameInstanceId = flame ? currentFlameInstanceId(this.state, flame) : null;
    return { dieId, owner: die.owner, rosterSlot: die.owner === 'player' ? rosterSlotOf(this.state, dieId) : null,
      ...(die.owner === 'player' ? { collectibleType: die.type, level: die.level } : { encounterId: die.encounterId }),
      physicalFace: die.value, face: face.rank, pips: scoringPips(face),
      enhancements: { ...face.enhancements }, flame,
      ...(flameInstanceId === null ? {} : { flameInstanceId }) };
  }

  emitV2(input: RunHistoryV2EventInput): RunHistoryV2Event {
    const { parentSeq, ...payload } = input;
    const event = { ...payload, seq: this.state.historyV2.length, round: this.state.round,
      attempt: this.state.roundAttemptNumber, actionId: this.state.actionJournal.length,
      timelineId: this.state.historyV2TimelineId, ...(parentSeq === undefined ? {} : { parentSeq }) } as RunHistoryV2Event;
    if (!this.options.disableHistoryV2) this.state.historyV2.push(event);
    return event;
  }

  emitRunStarted(): void {
    this.emitV2({ kind: 'run_started', schemaVersion: RUN_HISTORY_V2_SCHEMA_VERSION, ruleset: RUN_HISTORY_V2_RULESET,
      seed: this.state.seed, initialLives: this.state.lives, initialGold: this.state.gold,
      initialHandLevels: structuredClone(this.state.handLevels) });
  }

  emitV2Error(detail: string): void {
    this.emitV2({ kind: 'error', code: 'resolution_error', detail });
  }

  private trace(input: Parameters<typeof appendDebugTrace>[2]): void {
    appendDebugTrace(this.state.debugTrace, { round: this.state.round, attempt: this.state.roundAttemptNumber,
      actionId: this.state.actionJournal.length }, input);
  }

  private flameOrigin(flame: Flame, dieId: number | null): FlameOrigin {
    if (dieId !== null) return 'ember';
    if (this.state.bonfires.includes(flame)) return 'bonfire';
    return 'external';
  }

  private nextTimeline(reason: 'bust' | 'bad_dream' | 'time_travel', canonicalRound: number, canonicalAttempt: number,
    relocation?: 'chapter_start' | 'post_r3_shop'): void {
    const fromTimelineId = this.state.historyV2TimelineId;
    const abandonedThroughSeq = Math.max(-1, this.state.historyV2.length - 1);
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
        ['workout', 'personal_trainer', 'gold', 'vintage_growth', 'enhancement'].includes(effect.type)) }]
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
      actionId: this.state.actionJournal.length }, { kind: 'checkpoint_restore', reason, fromTimelineId,
      toTimelineId: this.state.historyV2TimelineId });
  }

  private captureLegacyForV2(record: EventRecord): boolean {
    if (this.v2Hand) {
      if (record.type === 'CHARGE_CHANGED') {
        const after = this.state.chargeXMult;
        const operation = after === 1 && this.v2LastCharge > 1 ? 'consume_reset' : 'gain';
        this.v2Hand.sideEffects.push({ type: 'charge', operation, before: this.v2LastCharge, after, source: record.flame });
        this.v2LastCharge = after;
      } else if (record.type === 'GOLD_ADDED' && record.goldSource && typeof record.amount === 'number')
        this.v2Hand.sideEffects.push({ type: 'gold', source: record.goldSource, amount: record.amount, dieId: record.dieIds?.[0] });
      else if (record.type === 'FLAME_TRIGGERED' && record.flame && record.xMult === undefined)
        this.v2Hand.sideEffects.push({ type: 'flame_activation', flame: record.flame,
          origin: this.flameOrigin(record.flame, record.dieIds?.[0] ?? null), dieId: record.dieIds?.[0] });
      else if ((record.type === 'BOSS_HAND_CHANGED' || record.type === 'BOSS_FACE_CHANGED' || record.type === 'CALLER_CHANGED') && record.boss)
        this.v2Hand.sideEffects.push({ type: 'boss_state', boss: record.boss, change: record.type, amount: record.amount,
          hand: record.hand, hands: record.hands, dieIds: record.dieIds, state: record.bossState });
      return true;
    }
    if (this.v2Roll) {
      if (record.type === 'CHARGE_CHANGED' && record.flame) {
        const after = this.state.chargeXMult;
        this.v2Roll.effects.push({ type: 'charge', source: record.flame, before: this.v2LastCharge, after });
        this.v2LastCharge = after;
      } else if (record.type === 'FLAME_TRIGGERED' && record.flame)
        this.v2Roll.effects.push({ type: 'flame_activation', flame: record.flame,
          origin: this.flameOrigin(record.flame, record.dieIds?.[0] ?? null), dieIds: record.dieIds ?? [] });
      else if ((record.type === 'BOSS_FACE_CHANGED' || record.type === 'CURSED_DIE_ROLLED') && record.boss)
        this.v2Roll.effects.push({ type: 'boss', boss: record.boss, change: record.type, dieIds: record.dieIds ?? [] });
      return true;
    }
    return false;
  }

  private mirrorLegacyV2(record: EventRecord): void {
    if (this.captureLegacyForV2(record)) return;
    switch (record.type) {
      case 'MAP_TRANSITION':
        if (record.toNode && record.nodeType) this.emitV2({ kind: 'map_transition', fromNode: record.fromNode ?? null,
          toNode: record.toNode, nodeType: record.nodeType, direction: record.direction ?? 'forward' });
        break;
      case 'CHAPTER_STARTED':
        if (record.chapterNumber && record.chapterMiniBoss && record.chapterBoss) this.emitV2({ kind: 'chapter_started',
          chapter: record.chapterNumber, miniBoss: record.chapterMiniBoss, boss: record.chapterBoss,
          ...(record.enhancementCapacityBefore !== undefined && record.enhancementCapacityAfter !== undefined
            ? { enhancementProgression: { capacityBefore: record.enhancementCapacityBefore,
              capacityAfter: record.enhancementCapacityAfter,
              newlyUnlocked: [...(record.newlyUnlockedEnhancements ?? [])] } } : {}) });
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
      case 'OFFER_PURCHASED': {
        const purchase = this.state.stats.purchases.at(-1);
        if (record.enhancement && record.rarity && record.dieIds?.[0] !== undefined && record.face && purchase)
          this.emitV2({ kind: 'shop_transaction', transaction: { type: 'enhancement_purchased', enhancement: record.enhancement,
            rarity: record.rarity, dieId: record.dieIds[0], face: record.face, cost: purchase.cost } });
        break;
      }
      case 'ENHANCEMENT_SOLD':
        if (record.enhancement && record.dieIds?.[0] !== undefined && record.face && typeof record.amount === 'number')
          this.emitV2({ kind: 'shop_transaction', transaction: { type: 'enhancement_sold', enhancement: record.enhancement,
            dieId: record.dieIds[0], face: record.face, proceeds: record.amount } });
        break;
      case 'TRAINING_PURCHASED': {
        const training = this.state.stats.trainingPurchases.at(-1);
        if (training) this.emitV2({ kind: 'shop_transaction', transaction: { type: 'training', hand: training.hand,
          cost: training.cost, ...('fromLevel' in training ? { fromLevel: training.fromLevel, toLevel: training.toLevel } : {}) } });
        break;
      }
      case 'SPECIAL_OFFER_SELECTED': {
        const offer = this.state.specialOffer?.chosen;
        if (offer && record.rarity) this.emitV2({ kind: 'shop_transaction', transaction: {
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
        if (record.flame && record.rarity && record.dieIds?.[0] !== undefined) this.emitV2({ kind: 'flame_changed',
          change: { type: record.type === 'FLAME_ACQUIRED' ? 'acquired' : 'replaced', flame: record.flame,
            instanceId: currentFlameInstanceId(this.state, record.flame) ?? undefined,
            dieId: record.dieIds[0], rarity: record.rarity, ...(acquisition?.replaced ? { replaced: acquisition.replaced } : {}) } });
        break;
      }
      case 'FLAME_SKIPPED': this.emitV2({ kind: 'flame_changed', change: { type: 'skipped' } }); break;
      case 'FLAME_INVESTED': {
        const stoke = this.state.stats.flameStokes.at(-1);
        if (stoke) this.emitV2({ kind: 'flame_changed', change: { type: 'stoked', flame: stoke.flame,
          instanceId: currentFlameInstanceId(this.state, stoke.flame) ?? undefined,
          dieId: stoke.dieId, amount: stoke.amount, from: stoke.from, to: stoke.total } });
        break;
      }
      case 'BONFIRE_CREATED':
        if (record.flame && record.dieIds?.[0] !== undefined) this.emitV2({ kind: 'flame_changed',
          change: { type: 'bonfire_created', flame: record.flame,
            instanceId: currentFlameInstanceId(this.state, record.flame) ?? undefined, dieId: record.dieIds[0] } });
        break;
      case 'FLAME_TRIGGERED':
        if (record.flame) this.emitV2({ kind: 'flame_changed', change: { type: 'activated', flame: record.flame,
          origin: this.flameOrigin(record.flame, record.dieIds?.[0] ?? null), dieId: record.dieIds?.[0], factor: record.xMult } });
        break;
      case 'CHARGE_ARMED':
        this.emitV2({ kind: 'charge_changed', operation: this.state.chargeArmed ? 'arm' : 'disarm',
          before: this.state.chargeXMult, after: this.state.chargeXMult, dieIds: record.dieIds ?? [] });
        break;
      case 'CHARGE_CHANGED': {
        const after = this.state.chargeXMult;
        const operation = after === 1 && this.v2LastCharge > 1 ? 'consume_reset' : 'gain';
        this.emitV2({ kind: 'charge_changed', operation, before: this.v2LastCharge, after,
          source: record.flame, dieIds: record.dieIds ?? [] });
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
              : record.type === 'BOSS_FACE_CHANGED' ? 'face' : 'state',
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
    this.mirrorLegacyV2(record);
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
    const capacityBefore = maxEnhancementTypesPerFace(chapterNumber - 1);
    const capacityAfter = maxEnhancementTypesPerFace(chapterNumber);
    const newlyUnlockedEnhancements = enhancementsUnlockedInChapter(chapterNumber);
    const enhancementProgression = chapterNumber >= 2 && chapterNumber <= 6
      ? { enhancementCapacityBefore: capacityBefore, enhancementCapacityAfter: capacityAfter,
        newlyUnlockedEnhancements } : {};
    this.emit({
      type: 'CHAPTER_STARTED', chapterNumber, chapterMiniBoss: plan.miniBoss, chapterBoss: plan.boss,
      ...enhancementProgression,
      message: `Chapter ${chapterNumber} entered`,
    });
  }
  log(event: Omit<EventRecord, 'id' | 'round'>): void {
    const record = { ...event, id: this.state.nextPlaybackEventId++, round: this.state.round };
    this.mirrorLegacyV2(record);
  }
  trigger(enhancement: Enhancement, dieId: number, face?: Face, detail = '', context: Pick<EventRecord, 'hand'> = {}): void {
    this.state.stats.triggers[enhancement] = (this.state.stats.triggers[enhancement] ?? 0) + 1;
    this.emit({ ...context, type: 'ABILITY_TRIGGERED', enhancement, dieIds: [dieId], face: face?.rank,
      message: `D${dieId + 1} ${ENHANCEMENTS[enhancement].name}${detail ? `: ${detail}` : ''}` });
  }
  triggerFlame(flame: Flame, dieId: number | null, detail = '', hand?: HandId, xMult?: number): void {
    this.state.stats.flameTriggers[flame] = (this.state.stats.flameTriggers[flame] ?? 0) + 1;
    this.emit({ type: 'FLAME_TRIGGERED', flame, dieIds: dieId === null ? undefined : [dieId], hand, xMult,
      message: `${dieId === null ? 'Bonfire' : `D${dieId + 1}`} ${FLAMES[flame].name}${detail ? `: ${detail}` : ''}` });
  }
  setFetchTarget(attachedDieId?: number, previous = this.state.fetchTarget): void {
    const fetchDie = attachedDieId === undefined
      ? this.state.dice.find(die => die.owner === 'player' && activeFlameId(die.flame) === 'fetch')
      : this.state.dice.find(die => die.owner === 'player' && die.id === attachedDieId);
    const global = this.state.bonfires.includes('fetch');
    const dice = fetchDie ? [fetchDie] : global ? rosterDice(this.state) : [];
    const targets = dice.flatMap(die => die.faces.slice(0, 6).map((_, index) => ({ dieId: die.id, physicalFace: (index + 1) as import('./types').Rank })))
      .filter(target => !previous || target.dieId !== previous.dieId || target.physicalFace !== previous.physicalFace);
    if (!targets.length) { this.state.fetchTarget = null; return; }
    this.state.fetchTarget = targets[randomIndex(this.rng, targets.length)];
    this.emit({ type: 'FETCH_TARGET_CHANGED', flame: 'fetch', dieIds: [this.state.fetchTarget.dieId], face: this.state.fetchTarget.physicalFace,
      message: `Fetch target: D${this.state.fetchTarget.dieId + 1} face ${this.state.fetchTarget.physicalFace}` });
  }
  checkProbability(enhancement: 'sticky' | 'boomerang' | 'holiday' | 'hitchhiker' | 'personalTrainer' | 'doubleTime', stackCount: number, dieIds: number[], hand?: HandId, effectiveChance?: number): boolean {
    const chance = effectiveChance ?? diminishingHalfChance(stackCount);
    const succeeded = probabilityCheck(this.rng, chance);
    this.trace({ kind: 'probability_check', source: enhancement, chance, stacks: stackCount, succeeded,
      dieIds: [...dieIds] });
    const stats = this.state.stats.probabilityProcs[enhancement];
    stats.checks++;
    stats[succeeded ? 'successes' : 'failures']++;
    stats.stacksAtCheck.push(stackCount);
    if (this.v2Hand || (enhancement === 'sticky' && this.v2RecentHand)) {
      (this.v2Hand ?? this.v2RecentHand)!.checks.push({ source: enhancement, stacks: stackCount, chance, succeeded, dieIds: [...dieIds] });
      if (enhancement === 'doubleTime' && this.v2Hand) this.v2Hand.sideEffects.push({ type: 'double_time', dieId: dieIds[0], succeeded });
    }
    this.log({ type: 'ABILITY_CHECKED', dieIds, hand, probability: { enhancement, stacks: stackCount, chance, succeeded },
      message: `${dieIds.map(id => `D${id + 1}`).join(', ')} ${ENHANCEMENTS[enhancement].name} ×${formatPlayerNumber(stackCount)}: ${formatPercentage(chance)} — ${succeeded ? 'succeeded' : 'failed'}` });
    return succeeded;
  }
  addGold(amount: number, message: string, goldSource: GoldSource, dieId?: number, enhancement?: Enhancement, face?: import('./types').Rank): void {
    this.state.gold += amount;
    this.state.stats.goldEarned += amount;
    this.state.stats.goldBySource[goldSource] += amount;
    this.emit({ type: 'GOLD_ADDED', amount, message, goldSource, enhancement, face, dieIds: dieId === undefined ? undefined : [dieId] });
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
  addScore(amount: ExactScore, source: Exclude<ScoreSource, 'hitchhiker'>, message: string, dieIds: number[], hand?: HandId): void {
    this.state.score += amount;
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
    const golden = stacks(snapshot, 'golden');
    if (golden) {
      this.state.stats.triggers.golden = (this.state.stats.triggers.golden ?? 0) + 1;
      this.addGold(golden * CONFIG.goldenGold, `D${dieId + 1} Golden ×${this.format(golden)}: +${this.format(golden * CONFIG.goldenGold)} gold`, 'golden', dieId);
    }
    const workout = stacks(snapshot, 'workout');
    const bonus = stacks(snapshot, 'bonus');
    if (bonus && this.state.specialOfferEffects.cashBonusRounds > 0) {
      const payout = bonus * 3;
      this.addGold(payout, `Cash Bonus · Bonus ×${this.format(bonus)}: +${this.format(payout)} Gold`, 'cashBonus', dieId, 'bonus', snapshot.rank);
      this.emit({ type: 'SPECIAL_EFFECT_TRIGGERED', enhancement: 'bonus', dieIds: [dieId], amount: payout,
        message: `Cash Bonus paid ${this.format(payout)} Gold` });
    }
    if (workout) {
      this.state.stats.triggers.workout = (this.state.stats.triggers.workout ?? 0) + 1;
      const live = activeFace(this.state.dice.find(die => die.id === dieId)!);
      const before = scoringPips(live);
      live.workoutPips += workout * CONFIG.workoutIncrement;
      this.v2Hand?.sideEffects.push({ type: 'workout', dieId, face: snapshot.rank, before,
        after: scoringPips(live), amount: workout * CONFIG.workoutIncrement });
      this.emit({ type: 'WORKOUT_INCREMENTED', enhancement: 'workout', dieIds: [dieId], face: snapshot.rank,
        amount: workout * CONFIG.workoutIncrement,
        message: `D${dieId + 1} face ${snapshot.rank} Workout ×${this.format(workout)}: ${this.format(before)} → ${this.format(scoringPips(live))} future pips` });
    }
    if (workout && !this.state.bossSilenced && this.state.boss?.type === 'hexer' && dieId === this.state.boss.cursedDieId) this.state.stats.hexerEvents.push({
      round: this.state.round, attempt: this.state.roundAttemptNumber, kind: 'workout', face: snapshot.rank, hand, amount: workout });
    if (stacks(snapshot, 'vintage')) {
      const live = activeFace(this.state.dice.find(die => die.id === dieId)!);
      const before = Math.max(0, live.vintageSellValue ?? 0);
      live.vintageSellValue = Math.min(VINTAGE_BASE_SELL_CAP, before + 3);
      this.v2Hand?.sideEffects.push({ type: 'vintage_growth', dieId, face: snapshot.rank,
        before, after: live.vintageSellValue });
      this.state.stats.triggers.vintage = (this.state.stats.triggers.vintage ?? 0) + 1;
      this.state.stats.vintageGrowth.push({ round: this.state.round, attempt: this.state.roundAttemptNumber,
        dieId, face: snapshot.rank, hand, playSource, participation, from: before, to: live.vintageSellValue });
      this.emit({ type: 'VINTAGE_GROWN', enhancement: 'vintage', dieIds: [dieId], face: snapshot.rank, hand, playSource,
        amount: live.vintageSellValue - before, message: `D${dieId + 1} face ${snapshot.rank} Vintage · ${HANDS[hand].name} (${playSource === 'jumpingBean' ? 'Jumping Bean free play' : participation}) · base sell value ${this.format(before)} → ${this.format(live.vintageSellValue)}` });
    }
  }
  private applyScoringContribution(contribution: HandScoreContribution, hand: HandId, playSource: HandPlaySource,
    scoringDice: number): void {
    const { dieId, face, kind, role, amount } = contribution;
    if (kind !== 'base') {
      const detail = kind === 'loneWolf'
        ? `×${this.format(loneWolfPipsFactor(scoringDice))}: +${this.format(amount)} Pips`
        : kind === 'teamwork' ? `copied +${this.format(amount)} Pips` : `+${this.format(amount)} hand pips`;
      this.trigger(kind, dieId, face, detail, { hand });
    }
    applyHandContribution(this.handAccumulator!, contribution);
    this.v2Hand?.pipsContributions.push({
      source: kind === 'base' ? 'die_base' : kind === 'loneWolf' ? 'lone_wolf' : kind,
      amount, dieId, face: face.rank, role,
    });
    this.emit({ type: role === 'hitchhiker' ? 'HITCHHIKER_ADDED_PIPS' : 'HAND_PIPS_CHANGED',
      hand, dieIds: [dieId], face: face.rank, amount, enhancement: kind === 'base' ? undefined : kind,
      source: playSource === 'jumpingBean' ? 'jumpingBean' : 'hand', playSource,
      pips: this.handAccumulator!.currentPips, multiplier: this.handAccumulator!.currentMultiplier,
      message: `D${dieId + 1}${role === 'hitchhiker' ? ' Hitchhiker' : ''} ${kind === 'teamwork' ? 'Teamwork copied' : 'added'} ${this.format(amount)} Pips` });
  }

  private scoringContributions(participant: ScoringParticipant, scoringDice: number): HandScoreContribution[] {
    const contributions = ordinaryFaceContributions(participant, scoringDice);
    const holiday = stacks(participant.face, 'holiday');
    if (!holiday) return contributions;
    const succeeded = this.checkProbability('holiday', holiday, [participant.id]);
    const baseBonusPips = contributions.filter(contribution => contribution.kind === 'bonus')
      .reduce((sum, contribution) => sum + contribution.amount, 0);
    this.v2Hand?.sideEffects.push({ type: 'holiday', dieId: participant.id, baseBonusPips,
      finalBonusPips: succeeded ? baseBonusPips * 3 : baseBonusPips, succeeded });
    return succeeded ? contributions.map(contribution => contribution.kind === 'bonus'
      ? { ...contribution, amount: contribution.amount * 3 } : contribution) : contributions;
  }

  private resolvePersonalTrainerActivation(hand: HandId, id: number, face: Face): boolean | null {
    const count = stacks(face, 'personalTrainer');
    if (!count) return null;
    this.state.stats.personalTrainerAttempts++;
    const chance = personalTrainerChance(count, this.state.handLevels[hand], Object.values(this.state.handLevels));
    if (!this.checkProbability('personalTrainer', count, [id], hand, chance)) return false;
    const before = this.state.handLevels[hand]++;
    this.v2Hand?.sideEffects.push({ type: 'personal_trainer', dieId: id, hand,
      beforeLevel: before, afterLevel: this.state.handLevels[hand] });
    this.state.stats.personalTrainerSuccesses++;
    this.state.stats.personalTrainerLevelsGranted++;
    this.trigger('personalTrainer', id, face, `${HANDS[hand].name} Lv. ${this.format(before)} to ${this.format(this.state.handLevels[hand])}`, { hand });
    return true;
  }

  private resolveScoreOccurrence(occurrence: ScoreOccurrence, participants: ScoringParticipant[]): {
    trainerActivation: ScoringParticipant | null;
    additionalOccurrence: ScoreOccurrence | null;
  } {
    const participant: ScoringParticipant = { id: occurrence.dieId, face: occurrence.face, role: occurrence.role };
    const { hand, playSource } = occurrence;
    const scoringDice = participants.length;
    const teamwork = stacks(participant.face, 'teamwork');
    if (teamwork) {
      const copiedPips = participants.filter(other => other.id !== participant.id)
        .reduce((sum, other) => sum + resolvedOrdinaryPips(other, scoringDice), 0);
      this.applyScoringContribution({ kind: 'teamwork', role: participant.role, dieId: participant.id,
        face: participant.face, amount: copiedPips }, hand, playSource, scoringDice);
    }
    const tank = stacks(participant.face, 'tank');
    if (tank) {
      const factor = tankMultiplierFactor(tank);
      const before = this.handAccumulator!.currentMultiplier;
      this.trigger('tank', participant.id, participant.face, `Mult ×${this.format(factor)}`, { hand });
      applyHandMultiplier(this.handAccumulator!, factor);
      this.v2Hand?.multContributions.push({ source: 'tank', factor, before,
        after: this.handAccumulator!.currentMultiplier, dieId: participant.id, stacks: tank });
      this.emit({ type: 'HAND_MULTIPLIER_CHANGED', enhancement: 'tank', hand, dieIds: [participant.id],
        face: participant.face.rank, amount: factor, multiplier: this.handAccumulator!.currentMultiplier,
        message: `D${participant.id + 1} Tank ×${this.format(tank)}: Mult ${this.format(before)} × ${this.format(factor)} = ${this.format(this.handAccumulator!.currentMultiplier)}` });
    }
    if (stacks(participant.face, 'furnace')) {
      const factor = Math.max(1, participant.face.furnaceMultiplier ?? 1);
      const before = this.handAccumulator!.currentMultiplier;
      applyHandMultiplier(this.handAccumulator!, factor);
      this.trigger('furnace', participant.id, participant.face, `Mult ×${this.format(factor)}`, { hand });
      this.v2Hand?.multContributions.push({ source: 'furnace', factor, before,
        after: this.handAccumulator!.currentMultiplier, dieId: participant.id, stacks: 1 });
    }
    this.whenScored(participant.id, participant.face, hand, playSource, participant.role);
    const trainerActivation = stacks(participant.face, 'personalTrainer') ? participant : null;
    const doubleTime = occurrence.suppressedEffects.includes('doubleTime') ? 0 : stacks(participant.face, 'doubleTime');
    if (doubleTime && this.checkProbability('doubleTime', doubleTime, [participant.id], hand)) {
      this.trigger('doubleTime', participant.id, participant.face, 'scored again', { hand });
      return {
        trainerActivation,
        additionalOccurrence: {
          ...occurrence,
          id: `${occurrence.rootId}:double-time`,
          rootId: occurrence.rootId,
          cause: 'double_time',
          additional: true,
          suppressedEffects: [...occurrence.suppressedEffects, 'doubleTime'],
        },
      };
    }
    return { trainerActivation, additionalOccurrence: null };
  }

  private resolveScoreOccurrences(resolution: HandResolution): ScoringParticipant[] {
    const { intent, scoringParticipants } = resolution;
    const scoringDice = scoringParticipants.length;
    const trainerActivations: ScoringParticipant[] = [];
    for (const participant of scoringParticipants) {
      const rootId = `${intent.id}:score:${participant.id}`;
      const pending: ScoreOccurrence[] = [{
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
      }];
      while (pending.length) {
        const occurrence = pending.shift()!;
        resolution.scoreOccurrences.push(occurrence);
        if (occurrence.additional) {
          const scoreParticipant: ScoringParticipant = {
            id: occurrence.dieId,
            face: occurrence.face,
            role: occurrence.role,
          };
          for (const contribution of this.scoringContributions(scoreParticipant, scoringDice))
            this.applyScoringContribution(contribution, intent.hand, intent.source, scoringDice);
        }
        const result = this.resolveScoreOccurrence(occurrence, scoringParticipants);
        if (result.trainerActivation) trainerActivations.push(result.trainerActivation);
        if (result.additionalOccurrence) pending.push(result.additionalOccurrence);
      }
    }
    return trainerActivations;
  }

  resolveJackpot(scoringDieIds: number[]): number {
    const scoring = new Set(scoringDieIds);
    let total = 0;
    for (const die of this.state.dice) {
      const face = activeFace(die);
      const count = stacks(face, 'jackpot');
      if (!count) continue;
      if (!scoring.has(die.id)) {
        this.log({ type: 'ABILITY_EVALUATED', enhancement: 'jackpot', dieIds: [die.id], face: face.rank,
          message: `D${die.id + 1} Jackpot did not trigger: die did not score in winning hand` });
        continue;
      }
      const powerball = this.state.specialOfferEffects.powerballAvailable && this.state.specialOfferEffects.powerballRounds > 0;
      const payout = powerball ? 50 : count * CONFIG.jackpotGold;
      if (powerball) {
        this.state.specialOfferEffects.powerballAvailable = false;
        this.state.specialOfferEffects.powerballRounds = 0;
        this.emit({ type: 'SPECIAL_EFFECT_TRIGGERED', enhancement: 'jackpot', dieIds: [die.id], amount: 50,
          message: 'Powerball paid 50 Gold and was consumed' });
      }
      this.state.stats.triggers.jackpot = (this.state.stats.triggers.jackpot ?? 0) + 1;
      this.addGold(payout, `D${die.id + 1} Jackpot ×${this.format(count)}: +${this.format(payout)} gold`, 'jackpot', die.id, 'jackpot', face.rank);
      if (isCursedDie(die)) this.state.stats.hexerEvents.push({ round: this.state.round, attempt: this.state.roundAttemptNumber,
        kind: 'jackpot', face: face.rank, amount: payout });
      total += payout;
    }
    if (total) this.log({ type: 'ABILITY_EVALUATED', enhancement: 'jackpot', message: `Total Jackpot payout: +${this.format(total)} gold` });
    return total;
  }

  private chargeFlameSource(flame: ChargeFlame): { investment: number; dieId: number | null } | null {
    if (this.state.bonfires.includes(flame)) return { investment: 100, dieId: null };
    const die = this.state.dice.find(item => activeFlameId(item.flame) === flame);
    return die ? { investment: activeFlameInvestment(die.flame), dieId: die.id } : null;
  }
  private growCharge(flame: ChargeFlame, requestedGain: number,
    detail: string, dieIds?: number[]): void {
    const source = this.chargeFlameSource(flame);
    if (!source || requestedGain <= 0) return;
    const before = this.state.chargeXMult;
    const after = Number(Math.min(this.state.maxCharge, before + requestedGain).toFixed(12));
    const gain = Number((after - before).toFixed(12));
    if (gain <= 0) return;
    this.state.chargeXMult = after;
    this.state.chargeAttribution[flame] = Number(((this.state.chargeAttribution[flame] ?? 0) + gain).toFixed(12));
    this.state.stats.chargeGained = Number((this.state.stats.chargeGained + gain).toFixed(12));
    this.triggerFlame(flame, source.dieId, `${detail} · Charge +${this.format(gain)} → ×${this.format(after)}`);
    this.emit({ type: 'CHARGE_CHANGED', flame, dieIds, xMult: after,
      message: `${FLAMES[flame].name}: Charge +${this.format(gain)} → ×${this.format(after)}` });
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
        this.state.handFamilyFlameStages[id] = 'payoff';
      } else if (stage === 'payoff' && hand === HAND_FAMILY_FLAMES[id].payoff && applied.has(id)) {
        this.state.handFamilyFlameStages[id] = 'spent';
      }
    }
  }
  private applyFluxCapacitor(pulledMagneticFaces: number, dieIds: number[]): void {
    const source = this.chargeFlameSource('fluxCapacitor');
    if (!source || pulledMagneticFaces <= 0) return;
    const before = this.state.chargeXMult;
    const multiplier = fluxCapacitorChargeMultiplier(source.investment, pulledMagneticFaces);
    const after = Number(Math.min(this.state.maxCharge, before * multiplier).toFixed(12));
    const gain = Number((after - before).toFixed(12));
    this.state.chargeXMult = after;
    if (gain > 0) this.state.chargeAttribution.fluxCapacitor = Number(((this.state.chargeAttribution.fluxCapacitor ?? 0) + gain).toFixed(12));
    this.state.stats.chargeGained = Number((this.state.stats.chargeGained + gain).toFixed(12));
    if (multiplier <= 1) return;
    this.triggerFlame('fluxCapacitor', source.dieId,
      `${this.format(pulledMagneticFaces)} Magnetic face${pulledMagneticFaces === 1 ? '' : 's'} pulled · Charge ×${this.format(multiplier)} → ×${this.format(after)}`);
    this.emit({ type: 'CHARGE_CHANGED', flame: 'fluxCapacitor', dieIds, xMult: after,
      message: `${FLAMES.fluxCapacitor.name}: Charge ×${this.format(before)} × ${this.format(multiplier)} = ×${this.format(after)}` });
  }
  private magicDestination(die: import('./types').Die, rolling: ReadonlySet<number>, suppressBeanFace = false,
    excludedPhysicalFace?: import('./types').Rank): { physicalFace: import('./types').Rank; hand: HandId } | null {
    const candidates = die.faces.map((face, index) => ({ face, physicalFace: (index + 1) as import('./types').Rank }))
      .filter(candidate => candidate.physicalFace !== excludedPhysicalFace && stacks(candidate.face, 'magic')
        && (!suppressBeanFace || !stacks(candidate.face, 'jumpingBean')));
    if (!candidates.length) return null;
    const unavailable = new Set([...this.state.consumed, ...unavailableEncounterHands(this.state)]);
    const required = requiredEncounterDieIds(this.state).filter(id => !rolling.has(id) || id === die.id);
    const handOrder = rankedHands(this.state.handLevels);
    const evaluated = candidates.flatMap(candidate => {
      const simulated = activeEncounterDice(this.state).filter(item => !rolling.has(item.id) || item.id === die.id)
        .map(item => item.id === die.id ? { ...item, value: candidate.physicalFace } : item);
      const hand = handOrder.find(id => !unavailable.has(id) && combinationsForHand(simulated, id)
        .some(combination => combination.includes(die.id) && required.every(requiredId => combination.includes(requiredId))));
      return hand ? [{ ...candidate, hand }] : [];
    });
    evaluated.sort((a, b) => this.state.handLevels[b.hand] - this.state.handLevels[a.hand]
      || handOrder.indexOf(a.hand) - handOrder.indexOf(b.hand)
      || b.face.rank - a.face.rank || a.physicalFace - b.physicalFace);
    return evaluated.length ? { physicalFace: evaluated[0].physicalFace, hand: evaluated[0].hand } : null;
  }

  private applyLandedShifters(ids: readonly number[]): Map<number, { from: import('./types').Rank; to: import('./types').Rank }> {
    const landed = ids.map(id => this.state.dice.find(die => die.id === id)!)
      .filter(die => stacks(activeFace(die), 'shifter'));
    const results = new Map<number, { from: import('./types').Rank; to: import('./types').Rank }>();
    if (!landed.length) return results;
    const snapshot = new Map(activeEncounterDice(this.state).map(die => [die.id, structuredClone(activeFace(die))]));
    for (const die of landed) {
      const face = activeFace(die);
      const otherFaces = [...snapshot.entries()].filter(([id]) => id !== die.id).map(([, other]) => other);
      if (!otherFaces.length) continue;
      const counts = ([1, 2, 3, 4, 5, 6] as import('./types').Rank[]).map(rank => ({ rank,
        count: otherFaces.reduce((total, other) => total
          + (stacks(other, 'mirror') || stacks(other, 'missingLink') ? 1 : other.rank === rank ? 1 : 0), 0) }));
      counts.sort((a, b) => b.count - a.count || b.rank - a.rank);
      const from = face.rank;
      face.shifterBaseRank ??= face.rank;
      face.rank = counts[0].rank;
      results.set(die.id, { from, to: face.rank });
      this.trigger('shifter', die.id, structuredClone(face), `${from} → ${face.rank}; most common relevant value, high tie`);
    }
    return results;
  }
  private resolveRoll(intent: RollIntent, rolling: ReadonlySet<number>, anchors: readonly number[],
    allowsRollEnhancements: boolean): RollResolution {
    const die = this.state.dice.find(item => item.id === intent.dieId)!;
    const beforePhysical = die.value;
    const before = activeFace(die).rank;
    const origin = structuredClone(activeFace(die));
    const actualBump = (allowsRollEnhancements || intent.context === 'wardenSetup') && stacks(origin, 'bump') > 0;
    const clockmakerBump = (intent.context === 'gameplay' || intent.context === 'settle')
      && !this.state.bossSilenced && this.state.boss?.type === 'clockmaker';
    const bumped = clockmakerBump || actualBump;
    if (bumped) {
      const physicalFace = (isCursedDie(die) ? Math.min(7, beforePhysical + 1)
        : beforePhysical === 6 ? 1 : beforePhysical + 1) as import('./types').Rank;
      if (!intent.manual || physicalFace !== beforePhysical) return {
        intent, dieId: die.id, before, beforePhysical, physicalFace, value: die.faces[physicalFace - 1].rank,
        weighted: false, bumped, actualBump: !clockmakerBump && actualBump, clockmakerBump, attracted: false,
        controller: clockmakerBump ? 'clockmaker' : 'bump', origin, magicHand: null,
      };
    }
    const destinations = anchors.length
      ? die.faces.map((face, index) => ({ face, physicalFace: (index + 1) as import('./types').Rank }))
        .filter(item => stacks(item.face, 'magnetic') && (!intent.manual || item.physicalFace !== beforePhysical))
      : [];
    if (destinations.length) {
      const destination = destinations[randomIndex(this.rng, destinations.length)];
      return {
        intent, dieId: die.id, before, beforePhysical, physicalFace: destination.physicalFace,
        value: destination.face.rank, weighted: false, bumped: false, actualBump: false,
        clockmakerBump: false, attracted: true, controller: 'magnetic', origin, magicHand: null,
      };
    }
    const magic = allowsRollEnhancements ? this.magicDestination(die, rolling,
      intent.reason === 'jumping_bean_followup', intent.manual ? beforePhysical : undefined) : null;
    if (magic) return {
      intent, dieId: die.id, before, beforePhysical, physicalFace: magic.physicalFace,
      value: die.faces[magic.physicalFace - 1].rank, weighted: false, bumped: false, actualBump: false,
      clockmakerBump: false, attracted: false, controller: 'magic', origin, magicHand: magic.hand,
    };
    const boomerang = allowsRollEnhancements && intent.reroll && !intent.manual ? stacks(origin, 'boomerang') : 0;
    if (boomerang && this.checkProbability('boomerang', boomerang, [die.id])) return {
      intent, dieId: die.id, before, beforePhysical, physicalFace: beforePhysical, value: origin.rank,
      weighted: false, bumped: false, actualBump: false, clockmakerBump: false, attracted: false,
      controller: 'boomerang', origin, magicHand: null,
    };
    const previousFaceExcluded = intent.excludeStartingFace;
    return {
      intent, dieId: die.id, before, beforePhysical,
      ...rollPhysicalDie(die, this.rng, previousFaceExcluded ? beforePhysical : undefined, intent.manual && bumped),
      bumped: false, actualBump: false, clockmakerBump: false, attracted: false,
      controller: 'rng', origin, magicHand: null, previousFaceExcluded,
    };
  }

  private applyPostRollReactions(batch: RollBatchIntent, results: RollResolution[], anchors: readonly number[]):
    Map<number, { from: import('./types').Rank; to: import('./types').Rank }> {
    const allowsRollEnhancements = batch.context === 'gameplay' || batch.context === 'settle';
    const shifterResults = allowsRollEnhancements ? this.applyLandedShifters(batch.dieIds) : new Map();
    const triggers: RollTrigger[] = [];
    for (const result of results) {
      const die = this.state.dice.find(item => item.id === result.dieId)!;
      const face = structuredClone(activeFace(die));
      this.emit({ type: 'DIE_ROLLED', dieIds: [die.id], face: face.rank,
        rollSource: batch.manual ? 'manual_reroll' : 'automatic', previousFace: result.before, resultFace: face.rank,
        sameFaceExcluded: batch.manual,
        message: `D${die.id + 1} rolled: ${result.before} → ${face.rank}${result.controller === 'rng' && result.previousFaceExcluded ? ' · previous face excluded' : ''}` });
      if ((batch.context === 'gameplay' || batch.context === 'wardenSetup') && face.rank === 3) {
        const source = this.chargeFlameSource('thirdRail');
        if (source) this.growCharge('thirdRail', thirdRailChargeGain(source.investment), `D${die.id + 1} rolled a 3`, [die.id]);
      }
      if (isCursedDie(die)) {
        this.state.stats.hexerEvents.push({ round: this.state.round, attempt: this.state.roundAttemptNumber,
          kind: batch.reasonText.startsWith('Manual') ? 'manual_reroll' : face.rank === 7 ? 'seven' : 'roll', face: face.rank });
        this.emit({ type: 'CURSED_DIE_ROLLED', boss: 'hexer', dieIds: [die.id], face: face.rank,
          message: `Cursed Die rolled ${face.rank}` });
      }
      if (result.bumped) {
        if (result.actualBump) {
          this.state.stats.bumpControlledRolls++;
          this.state.stats.triggers.bump = (this.state.stats.triggers.bump ?? 0) + 1;
        }
        this.emit({ type: 'BUMP_ROLL', enhancement: result.actualBump ? 'bump' : undefined,
          boss: result.clockmakerBump ? 'clockmaker' : undefined, dieIds: [die.id], face: face.rank,
          message: `D${die.id + 1} ${result.clockmakerBump ? 'Clockmaker Bump' : 'Bump'} controlled the roll: ${result.before} → ${face.rank}` });
      } else if (result.attracted) {
        this.state.stats.magneticAttractions++;
        this.state.stats.triggers.magnetic = (this.state.stats.triggers.magnetic ?? 0) + 1;
        this.emit({ type: 'MAGNETIC_ATTRACTION', enhancement: 'magnetic', dieIds: [die.id, ...anchors], face: face.rank,
          message: `Held Magnetic anchor attracted D${die.id + 1} to face ${face.rank}` });
      }
      if (result.controller === 'magic') this.trigger('magic', die.id, face, `${HANDS[result.magicHand!].name} completed`);
      if (result.controller === 'boomerang') this.trigger('boomerang', die.id, face, `returned to physical face ${result.beforePhysical}`);
      if (result.weighted) {
        const source = weightedSourceFace(die, result.physicalFace)!;
        const weightedStacks = stacks(source, 'weighted');
        triggers.push({ dieId: die.id, face, enhancement: 'weighted', weightedSourceFace: source.rank,
          weightedStacks, rollWeight: 1 + weightedStacks });
      }
      if (batch.context === 'gameplay' && stacks(face, 'jumpingBean'))
        triggers.push({ dieId: die.id, face, enhancement: 'jumpingBean' });
      if (batch.context === 'gameplay' && batch.reroll && !batch.manual
        && stacks(result.origin, 'freePlay') && result.physicalFace === result.beforePhysical)
        triggers.unshift({ dieId: die.id, face, enhancement: 'freePlay', rerollEventId: batch.id });
    }
    const attracted = results.filter(result => result.attracted);
    if (attracted.length && batch.context === 'gameplay')
      this.applyFluxCapacitor(attracted.length, attracted.map(result => result.dieId));
    if (batch.context === 'gameplay') this.queue.push(...triggers);
    else if (batch.context !== 'settle') for (const item of triggers)
      this.trigger('weighted', item.dieId, item.face, `source face ${item.weightedSourceFace} ×${this.format(item.weightedStacks ?? 0)}; destination weight ${this.format(item.rollWeight ?? 0)}`);
    return shifterResults;
  }

  rollBatch(dieIds: number[], reason: string, context: RollContext, _excludeStartingFace = false,
    reasonId: RollReason = 'other'): void {
    const ids = orderDieIdsByEncounter(this.state, [...new Set(dieIds)]);
    if (!ids.length) return;
    const parentSeq = this.v2ParentSeq;
    this.v2ParentSeq = undefined;
    this.v2Roll = { effects: [] };
    this.emit({ type: 'DICE_REROLL_STARTED', dieIds: ids, rollReason: reasonId,
      message: `${reason}: ${ids.map(id => `D${id + 1}`).join(', ')}` });
    const rolling = new Set(ids);
    const physicalGameplayRoll = context === 'gameplay' || context === 'settle';
    const anchors = physicalGameplayRoll ? activeEncounterDice(this.state)
      .filter(die => !rolling.has(die.id) && stacks(activeFace(die), 'magnetic') && !activeFace(die).magneticSourceUsed)
      .map(die => die.id) : [];
    if (anchors.length) {
      this.state.stats.magneticAnchorBatches++;
      this.log({ type: 'ABILITY_EVALUATED', enhancement: 'magnetic', dieIds: anchors, message: `Held Magnetic anchor${anchors.length > 1 ? 's' : ''}: ${anchors.map(id => `D${id + 1}`).join(', ')}` });
    }
    const batchId = `${this.state.historyV2TimelineId}:${this.state.round}:${this.state.actionJournal.length}:${this.state.historyV2.length}`;
    const batch = createRollBatchIntent(batchId, ids, reason, context, reasonId);
    const allowsRollEnhancements = physicalGameplayRoll;
    const results = ids.map(dieId => this.resolveRoll(createRollIntent(batch, dieId), rolling, anchors,
      allowsRollEnhancements));
    const attracted = results.filter(result => result.attracted);
    if (attracted.length) {
      for (const anchor of anchors) activeFace(this.state.dice.find(die => die.id === anchor)!).magneticSourceUsed = true;
    }
    for (const result of results) this.state.dice.find(item => item.id === result.dieId)!.value = result.physicalFace;
    const shifterResults = this.applyPostRollReactions(batch, results, anchors);
    const effects = this.v2Roll.effects;
    this.v2Roll = null;
    const event = this.emitV2({ kind: 'roll_batch', parentSeq, reason: reasonId,
      context: context === 'wardenSetup' ? 'warden_setup' : context === 'flameSelection' ? 'flame_selection' : context,
      dieIds: ids, heldDieIds: anchors, spend: this.v2ManualSpend, effects,
      results: results.map(result => {
        const die = this.state.dice.find(item => item.id === result.dieId)!;
        const weightedSource = result.weighted ? weightedSourceFace(die, result.physicalFace) : undefined;
        const weightedStacks = weightedSource ? stacks(weightedSource, 'weighted') : 0;
        return { dieId: result.dieId, beforePhysicalFace: result.beforePhysical, afterPhysicalFace: result.physicalFace,
          beforeFace: result.before, afterFace: activeFace(die).rank,
          previousFaceExcluded: batch.manual,
          weighted: result.weighted && weightedSource ? { sourceFace: weightedSource.rank, stacks: weightedStacks,
            destinationWeight: 1 + weightedStacks } : null,
          bump: result.bumped ? { source: result.clockmakerBump ? 'clockmaker' as const : 'enhancement' as const } : null,
          magneticAnchorIds: result.attracted ? [...anchors] : [], controller: result.controller,
          ...(shifterResults.has(result.dieId) ? { shifter: shifterResults.get(result.dieId)! } : {}),
          ...(result.magicHand ? { magicHand: result.magicHand } : {}),
          ...(this.pendingFlywheel.has(result.dieId) ? { flywheel: { chargeConsumed: true as const,
            chargesRemaining: this.pendingFlywheel.get(result.dieId)! } } : {}) };
      }) });
    for (const id of ids) this.pendingFlywheel.delete(id);
    this.v2ManualSpend = null;
    this.lastV2RollSeq = event.seq;
    if (event.kind === 'roll_batch') this.trace({ kind: 'roll_batch', reason: reasonId, dieIds: [...ids],
      results: event.results.map(result => ({ dieId: result.dieId, before: result.beforeFace, after: result.afterFace })) });
  }
  drain(): void {
    let cursor = 0;
    while (cursor < this.queue.length) {
      const item = this.queue[cursor++];
      this.trigger(item.enhancement, item.dieId, item.face, item.enhancement === 'weighted'
        ? `source face ${item.weightedSourceFace} ×${this.format(item.weightedStacks ?? 0)}; destination weight ${this.format(item.rollWeight ?? 0)}` : '');
      if (item.enhancement === 'freePlay') {
        const hand = UPPER_HAND_BY_FACE[item.face.rank];
        if (!hand) continue;
        this.v2ParentSeq = this.lastV2RollSeq;
        this.pendingFreePlayEventId = item.rerollEventId ?? 'unknown';
        const outcome = this.play(hand, [item.dieId], 'freePlay');
        this.pendingFreePlayEventId = null;
        this.emit({ type: 'JUMPING_BEAN_FREE_PLAY', enhancement: 'freePlay', hand, dieIds: [item.dieId],
          playSource: 'freePlay', handConsumed: false,
          message: `Free Play ${item.rerollEventId}: reroll returned to the same physical face; ${HANDS[hand].name} scored without consumption` });
        if (outcome.winning) { this.queue = []; return; }
      }
      if (item.enhancement === 'jumpingBean') {
        const hand = UPPER_HAND_BY_FACE[item.face.rank];
        if (!hand) continue;
        this.v2ParentSeq = this.lastV2RollSeq;
        const outcome = this.play(hand, [item.dieId], 'jumpingBean');
        const record = outcome.beanRecordIndex === null ? null : this.state.stats.jumpingBeanFreePlays[outcome.beanRecordIndex];
        if (outcome.winning) {
          this.emit({ type: 'JUMPING_BEAN_FOLLOWUP', enhancement: 'jumpingBean', hand, dieIds: [item.dieId], playSource: 'jumpingBean',
            message: 'Jumping Bean follow-up reroll skipped because the free play cleared the round.' });
          this.queue = [];
          return;
        }
        if (record) record.followupRerolled = true;
        this.emit({ type: 'JUMPING_BEAN_FOLLOWUP', enhancement: 'jumpingBean', hand, dieIds: [item.dieId], playSource: 'jumpingBean',
          message: `D${item.dieId + 1} begins its Jumping Bean follow-up reroll.` });
        this.rollBatch([item.dieId], 'Jumping Bean reroll', 'gameplay', false, 'jumping_bean_followup');
      }
    }
    this.queue = [];
  }

  private advanceHotStreak(hand: HandId, scoringIds: number[]): void {
    if (this.state.hotStreakGoal !== hand) return;
    const bonfire = this.state.bonfires.includes('hotStreak');
    const flameDie = this.state.dice.find(die => scoringIds.includes(die.id) && activeFlameId(die.flame) === 'hotStreak');
    const qualified = bonfire || !!flameDie;
    if (qualified) { this.state.hotStreakCharges++; this.state.stats.hotStreakCharges++; }
    let index = HOT_STREAK_SEQUENCE.indexOf(hand) + 1;
    while (index < HOT_STREAK_SEQUENCE.length && this.state.consumed.includes(HOT_STREAK_SEQUENCE[index])) {
      this.state.stats.hotStreakSkippedHands.push({ round: this.state.round, hand: HOT_STREAK_SEQUENCE[index] });
      index++;
    }
    this.state.hotStreakGoal = HOT_STREAK_SEQUENCE[index] ?? null;
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
    for (const id of HAND_IDS) {
      const remaining = boss.cooldowns[id];
      if (!remaining) continue;
      if (remaining <= 1) delete boss.cooldowns[id];
      else boss.cooldowns[id] = remaining - 1;
    }
    boss.cooldowns[hand] = 7;
    this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'marathon', hand, amount: 7,
      message: `${HANDS[hand].name} entered a 7-play cooldown` });
  }

  private refreshScorecardIfFilled(): boolean {
    // Marathon owns hand availability through cooldowns, not ordinary Used state.
    if (this.state.boss?.type === 'marathon') return false;
    const cycle = new Set(this.state.scorecardCycleConsumed);
    if (!HAND_IDS.every(hand => cycle.has(hand))) return false;
    const encounterLocks = !this.state.bossSilenced && this.state.boss?.type === 'neglected' && !this.state.boss.restored
      ? this.state.boss.neglectedHands : [];
    this.state.consumed = [...encounterLocks];
    this.state.scorecardCycleConsumed = [];
    this.emit({ type: 'SCORECARD_REFRESHED', message: 'Scorecard filled \u00b7 all hands refreshed' });
    return true;
  }

  private resolveQuickdraw(hand: HandId, source: HandPlaySource): void {
    if (this.state.bossSilenced) return;
    const boss = this.state.boss;
    if (boss?.type !== 'quickdraw' || source !== 'manual' || !LOWER_HAND_IDS.includes(hand)) return;
    boss.lowerShotUsed = true;
    boss.playedLowerHand = hand;
    this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'quickdraw', hand,
      message: `${HANDS[hand].name} used Quickdraw's only Lower shot` });
  }

  private flyFactor(hand: HandId, source: HandPlaySource): number {
    if (this.state.bossSilenced) return 1;
    const boss = this.state.boss;
    if (boss?.type !== 'fly' || boss.caught) return 1;
    if (source === 'manual' && hand === boss.flyHand) {
      boss.caught = true;
      boss.flyHand = null;
      this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'fly', hand, amount: 1,
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
    let candidates = LOWER_HAND_IDS.filter(hand => !this.state.consumed.includes(hand)
      && handIsPhysicallyAttainable(hand, rosterDice(this.state).length));
    if (candidates.length > 1) candidates = candidates.filter(hand => hand !== previous);
    if (!candidates.length) { boss.flyHand = null; return; }
    boss.flyHand = candidates[randomIndex(this.rng, candidates.length)];
    boss.moves++;
    this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'fly', hand: boss.flyHand,
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
    die.flame = boss.hiddenFlame;
    boss.hiddenFlame = null;
    boss.returned = true;
    recalculateMaxCharge(this.state);
    this.emit({ type: 'BOSS_HAND_CHANGED', boss: boss.type, dieIds: [die.id],
      message: `The Magician returned D${die.id + 1}` });
    this.rollBatch([die.id], 'The Magician return roll', 'gameplay', false, 'magician_return');
    return true;
  }

  private restoreMagicianDie(): void {
    const boss = this.state.boss;
    if (boss?.type !== 'magician' || boss.returned) return;
    const die = boss.missingDieId === null ? undefined : this.state.dice.find(item => item.id === boss.missingDieId);
    if (die) die.flame = boss.hiddenFlame;
    boss.hiddenFlame = null;
    boss.returned = true;
    recalculateMaxCharge(this.state);
  }

  private jugglerRerolls(hand: HandId): number[] | null {
    if (this.state.bossSilenced || this.state.boss?.type !== 'juggler' || !UPPER_HAND_IDS.includes(hand)) return null;
    const dieIds = rosterDice(this.state).map(die => die.id);
    this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'juggler', hand, dieIds, bossState: 'triggered',
      message: `The Juggler rerolls all dice after ${HANDS[hand].name}` });
    return dieIds;
  }

  private resolveHandScore(resolution: HandResolution, handStart: HandStartSnapshot, handLevel: number,
    chargeAttributionAtHandStart: Partial<Record<Flame, number>>) {
    const { hand, source: playSource } = resolution.intent;
    const scoringIds = resolution.scoringParticipants.map(participant => participant.id);
    const xMultFactors = handXMultContributions(handStart, hand, handLevel, scoringIds);
    for (const factor of xMultFactors) {
      const origin: FlameOrigin = factor.source === 'charge' ? 'charge' : factor.dieId !== null ? 'ember'
        : handStart.bonfires.includes(factor.source) ? 'bonfire' : 'external';
      const chargeSources = factor.source === 'charge' ? Object.entries(chargeAttributionAtHandStart)
        .filter((entry): entry is [Flame, number] => (entry[1] ?? 0) > 0)
        .map(([flame, attributed]) => ({ flame,
          instanceId: currentFlameInstanceId(this.state, flame) ?? undefined,
          origin: this.state.bonfires.includes(flame) ? 'bonfire' as const : 'ember' as const,
          attributed,
          factor: handStart.chargeXMult / Math.max(1, handStart.chargeXMult - attributed) })) : undefined;
      const sourceInstanceId = factor.source === 'charge' ? null : currentFlameInstanceId(this.state, factor.source);
      this.v2Hand!.xMultContributions.push({ sourceId: factor.source, origin, factor: factor.value,
        ...(sourceInstanceId === null ? {} : { sourceInstanceId }),
        ...(factor.dieId === null ? {} : { dieId: factor.dieId }),
        ...(factor.input === undefined ? {} : { input: factor.input }),
        ...(chargeSources?.length ? { chargeSources } : {}) });
      if (factor.source === 'speedDemon') this.emit({ type: 'SPEED_DEMON_REVEALED', flame: 'speedDemon', hand,
        dieIds: factor.dieId === null ? undefined : [factor.dieId], xMult: factor.value, xMultFactor: factor,
        decisionMs: handStart.speedDemonDecisionMs ?? undefined,
        message: `Speed Demon ×${this.format(factor.value)}` });
      const beforeXMult = resolution.accumulator.currentXMult;
      applyXMult(resolution.accumulator, factor);
      if (factor.source !== 'charge')
        this.triggerFlame(factor.source, factor.dieId, `factor ×${this.format(factor.value)}`, hand, factor.value);
      this.emit({ type: 'HAND_XMULT_CHANGED', flame: factor.source === 'charge' ? undefined : factor.source, hand,
        dieIds: factor.dieId === null ? undefined : [factor.dieId], xMult: resolution.accumulator.currentXMult,
        xMultFactor: factor,
        message: `${factor.source === 'charge' ? 'Charge' : FLAMES[factor.source].name}: XMult ×${this.format(beforeXMult)} × factor ×${this.format(factor.value)} = ×${this.format(resolution.accumulator.currentXMult)}` });
    }
    if (xMultFactors.some(factor => factor.source === 'fetch')) {
      const completed = this.state.fetchTarget;
      this.setFetchTarget(undefined, completed);
      if (completed && this.state.fetchTarget) this.log({ type: 'ABILITY_EVALUATED', flame: 'fetch',
        dieIds: [completed.dieId, this.state.fetchTarget.dieId], face: completed.physicalFace,
        message: `Fetch hit on D${completed.dieId + 1} face ${completed.physicalFace} · new target D${this.state.fetchTarget.dieId + 1} face ${this.state.fetchTarget.physicalFace}` });
    }
    this.advanceHandFamilyFlames(hand, xMultFactors);
    const bossFactor = this.flyFactor(hand, playSource);
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

  private postHandRerolls(shapeParticipants: { id: number; face: Face }[]): Set<number> {
    const normalRerolls = shapeParticipants.map(({ id }) => id);
    const crawlerRerolls = !this.state.bossSilenced && this.state.boss?.type === 'crawler' && normalRerolls.length > 1
      ? [normalRerolls[randomIndex(this.rng, normalRerolls.length)]] : normalRerolls;
    const rerolls = new Set(crawlerRerolls);
    if (crawlerRerolls.length !== normalRerolls.length) this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'crawler', dieIds: crawlerRerolls,
      message: `The Crawler limited the scoring reroll to D${crawlerRerolls[0] + 1}` });
    return rerolls;
  }

  private resolvePostPlayRerolls(resolution: HandResolution, winning: boolean,
    beanRecordIndex: number | null): { winning: boolean; beanRecordIndex: number | null } {
    const freePlay = resolution.intent.source !== 'manual';
    const jugglerRerolls = this.jugglerRerolls(resolution.intent.hand);
    if (winning) {
      if (!freePlay || jugglerRerolls) {
        const settleRerolls = jugglerRerolls ?? [...this.postHandRerolls(resolution.selectedParticipants)];
        this.rollBatch(settleRerolls, jugglerRerolls ? 'The Juggler reroll' : 'Winning hand settle reroll',
          'settle', false, jugglerRerolls ? 'juggler' : 'winning_settle');
        this.evaluate();
      }
      return { winning, beanRecordIndex };
    }
    if (freePlay) {
      if (jugglerRerolls) this.rollBatch(jugglerRerolls, 'The Juggler reroll', 'gameplay', false, 'juggler');
      return { winning, beanRecordIndex };
    }
    const rerolls = jugglerRerolls ?? [...this.postHandRerolls(resolution.selectedParticipants)];
    this.rollBatch(rerolls, jugglerRerolls ? 'The Juggler reroll' : 'Post-hand reroll',
      'gameplay', false, jugglerRerolls ? 'juggler' : 'post_hand');
    this.drain();
    if (this.state.score < this.state.target) this.refreshScorecardIfFilled();
    this.evaluate();
    if (this.state.phase === 'round') this.state.decisionId++;
    return { winning: this.state.score >= this.state.target, beanRecordIndex: null };
  }

  private resolveSnakeEyes(scoringIds: number[]): void {
    if (this.state.bossSilenced) return;
    const boss = this.state.boss;
    if (boss?.type !== 'snakeEyes') return;
    const scoredDice = [...new Set(scoringIds)].map(id => this.state.dice.find(die => die.id === id)!)
      .filter(die => die.owner === 'player' && !activeFace(die).snakeEyed && activeFace(die).rank !== 1);
    for (const die of scoredDice) {
      const physicalFace = die.value;
      const face = activeFace(die);
      face.snakeEyesOriginalRank = face.rank;
      face.snakeEyed = true;
      face.rank = 1;
      boss.mutatedFaces.push({ dieId: die.id, physicalFace });
      this.emit({ type: 'BOSS_FACE_CHANGED', boss: 'snakeEyes', dieIds: [die.id], face: 1,
        message: `D${die.id + 1} face ${physicalFace} became Snake-Eyed (1)` });
    }
  }
  private resolveInfected(scoringIds: number[]): void {
    if (this.state.bossSilenced) return;
    const boss = this.state.boss;
    if (boss?.type !== 'infected') return;
    for (const die of [...new Set(scoringIds)].map(id => this.state.dice.find(item => item.id === id)!)
      .filter(item => item.owner === 'player' && !activeFace(item).infected)) {
      const physicalFace = die.value;
      activeFace(die).infected = true;
      boss.infectedFaces.push({ dieId: die.id, physicalFace });
      this.emit({ type: 'BOSS_FACE_CHANGED', boss: 'infected', dieIds: [die.id], face: activeFace(die).rank,
        message: `D${die.id + 1} face ${physicalFace} became infected after scoring` });
    }
  }
  unlockWardenDie(dieId: number): void {
    const boss = this.state.boss;
    if (boss?.type !== 'warden' || boss.pendingReinforcements <= 0) throw new Error('Warden unlock attempted without a pending choice.');
    const starting = boss.startingDieId === null;
    boss.activeDieIds.push(dieId);
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
      message: `${starting ? 'Starting die' : 'Reinforcement'} D${dieId + 1} unlocked · face ${this.state.dice.find(die => die.id === dieId)!.value} retained` });
    this.updateWardenUnlockTarget();
    this.evaluate();
    if (this.state.phase === 'round' && boss.pendingReinforcements === 0) this.state.decisionId++;
  }
  play(hand: HandId, dieIds: number[], playSource: HandPlaySource = 'manual', decisionMs: number | null = null): { winning: boolean; beanRecordIndex: number | null } {
    const playId = `${this.state.historyV2TimelineId}:${this.state.round}:${this.state.actionJournal.length}:${this.state.historyV2.length}:${playSource}`;
    return this.resolvePlay(createPlayIntent(playId, hand, orderDieIdsByEncounter(this.state, dieIds), playSource, decisionMs));
  }

  private resolvePlay(intent: PlayIntent): { winning: boolean; beanRecordIndex: number | null } {
    this.v2RecentHand = null;
    const { hand, source: playSource, selectedDieIds: ids } = intent;
    const qualification = planQualification(activeEncounterDice(this.state), hand, ids);
    const freeBean = playSource === 'jumpingBean';
    const freePlay = playSource !== 'manual';
    const wouldConsumeHand = !freePlay && (this.state.bossSilenced || this.state.boss?.type !== 'marathon');
    const consumesHand = wouldConsumeHand;
    const handLevel = this.state.handLevels[hand];
    const currentInfernoMultiplier = infernoMultiplier(this.state.engulfmentLevel);
    const handStart = captureHandStart(this.state, hand, ids, playSource === 'manual' ? intent.decisionMs : null);
    const chargeAttributionAtHandStart = structuredClone(this.state.chargeAttribution);
    if (freePlay) handStart.chargeArmed = false;
    const shapeParticipants = ids.map(id => ({ id, face: structuredClone(activeFace(this.state.dice.find(die => die.id === id)!)), role: 'selected' as const }));
    this.v2Hand = {
      parentSeq: this.v2ParentSeq,
      hand, level: handLevel, playSource, consumed: consumesHand, roundScoreBefore: this.state.score,
      selectedDice: shapeParticipants.map(item => item.id),
      pipsContributions: [{ source: 'hand_base', amount: createHandAccumulator(hand, ids, handLevel).basePips }],
      multContributions: [{ source: 'hand_base', factor: createHandAccumulator(hand, ids, handLevel).baseMultiplier,
        before: 0, after: createHandAccumulator(hand, ids, handLevel).baseMultiplier }],
      xMultContributions: [], checks: [], sideEffects: playSource === 'freePlay'
        ? [{ type: 'free_play', dieId: ids[0], rerollEventId: this.pendingFreePlayEventId ?? 'unknown' }] : [],
    };
    this.v2ParentSeq = undefined;
    if (freeBean) this.emit({ type: 'JUMPING_BEAN_FREE_PLAY', enhancement: 'jumpingBean', hand, dieIds: ids,
      face: shapeParticipants[0].face.rank, playSource, handConsumed: false,
      message: `Jumping Bean free-play: ${HANDS[hand].name}; scoring dice: D${ids[0] + 1}; normal hand availability unchanged` });
    this.handAccumulator = createHandAccumulator(hand, ids, handLevel, currentInfernoMultiplier);
    const round = this.state.stats.rounds.at(-1)!;
    round.lastHand = hand; round.lastAction = freeBean ? 'JUMPING_BEAN' : 'PLAY';
    const hitchhikers: { id: number; face: Face; role: 'hitchhiker' }[] = [];
    for (const die of freePlay ? [] : activeEncounterDice(this.state)) {
      if (ids.includes(die.id)) continue;
      const face = structuredClone(activeFace(die));
      const count = stacks(face, 'hitchhiker');
      if (!count || !this.checkProbability('hitchhiker', count, [die.id], hand)) continue;
      hitchhikers.push({ id: die.id, face, role: 'hitchhiker' });
      this.trigger('hitchhiker', die.id, face, `×${this.format(count)} joined ${HANDS[hand].name}`, { hand });
    }
    const scoringParticipants = [...shapeParticipants, ...hitchhikers];
    const scoringIds = scoringParticipants.map(item => item.id);
    const resolution: HandResolution = {
      intent,
      qualification,
      selectedParticipants: shapeParticipants,
      scoringParticipants,
      scoreOccurrences: [],
      accumulator: this.handAccumulator,
      wouldConsumeHand,
      consumesHand,
    };
    for (const participant of scoringParticipants) {
      if (!stacks(participant.face, 'furnace')) continue;
      const live = activeFace(this.state.dice.find(die => die.id === participant.id)!);
      const destroyedEnhancements = (Object.entries(live.enhancements) as [Enhancement, number][])
        .filter(([id, count]) => id !== 'furnace' && count > 0).map(([enhancement, count]) => ({ enhancement, stacks: count }));
      const destroyed = destroyedEnhancements.reduce((sum, item) => sum + item.stacks, 0);
      const before = live.furnaceMultiplier ?? 1;
      for (const id of Object.keys(live.enhancements) as Enhancement[]) if (id !== 'furnace') delete live.enhancements[id];
      live.furnaceMultiplier = Number(((live.furnaceMultiplier ?? 1) + destroyed * .25).toFixed(12));
      participant.face.enhancements = { furnace: 1 };
      participant.face.furnaceMultiplier = live.furnaceMultiplier;
      this.v2Hand.sideEffects.push({ type: 'furnace', dieId: participant.id, destroyed: destroyedEnhancements,
        before, after: live.furnaceMultiplier });
      this.trigger('furnace', participant.id, participant.face,
        `destroyed ${destroyed} stack(s); permanent factor ×${this.format(live.furnaceMultiplier)}`, { hand });
    }
    const sustainableParticipant = resolution.wouldConsumeHand ? scoringParticipants.find(participant => {
      const live = activeFace(this.state.dice.find(die => die.id === participant.id)!);
      return stacks(participant.face, 'sustainable') && (live.sustainableCharges ?? 0) > 0;
    }) : undefined;
    if (sustainableParticipant) {
      const live = activeFace(this.state.dice.find(die => die.id === sustainableParticipant.id)!);
      live.sustainableCharges!--;
      sustainableParticipant.face.sustainableCharges = live.sustainableCharges;
      resolution.consumesHand = false;
      this.v2Hand.consumed = false;
      this.trigger('sustainable', sustainableParticipant.id, structuredClone(live),
        `${HANDS[hand].name} preserved; ${live.sustainableCharges} charge(s) remain`, { hand });
      this.v2Hand.sideEffects.push({ type: 'sustainable', dieId: sustainableParticipant.id, hand,
        chargesRemaining: live.sustainableCharges ?? 0 });
    }
    this.emit({ type: 'HAND_STARTED', hand, dieIds: ids, playSource, handConsumed: resolution.consumesHand,
      message: `${freePlay ? 'Free-played' : 'Played'} ${HANDS[hand].name} Lv. ${this.format(handLevel)}` });
    for (const participation of resolution.qualification.effects) {
      const participant = shapeParticipants.find(item => item.id === participation.dieId)!;
      if (participation.effect === 'conjoined') {
        this.trigger('conjoined', participant.id, participant.face, 'contributed one phantom qualification copy', { hand });
        this.v2Hand.sideEffects.push({ type: 'conjoined', dieId: participant.id, hand });
      } else this.trigger(participation.effect, participant.id, participant.face, 'wild qualification; actual printed pips score');
    }
    const originalContributions = scoringParticipants.flatMap(participant =>
      this.scoringContributions(participant, scoringParticipants.length));
    for (const kind of ['base', 'bonus', 'loneWolf'] as const) for (const contribution of originalContributions)
      if (contribution.kind === kind) this.applyScoringContribution(contribution, hand, playSource, scoringParticipants.length);
    const trainerActivations = this.resolveScoreOccurrences(resolution);
    const { pips, multiplier, xMult, rawScore, score, bossFactor } =
      this.resolveHandScore(resolution, handStart, handLevel, chargeAttributionAtHandStart);
    this.state.stats.handScores.push({ round: this.state.round, hand, handLevel, dieIds: scoringIds,
      basePips: this.handAccumulator.basePips, baseMultiplier: this.handAccumulator.baseMultiplier,
      infernoMultiplier: currentInfernoMultiplier,
      pips, multiplier, xMult, bossFactor, xMultFactors: structuredClone(this.handAccumulator.xMultFactors), rawScore, score,
      bonusPips: this.handAccumulator.bonusPips, hitchhikerPips: this.handAccumulator.hitchhikerPips,
      playSource, consumedHand: resolution.consumesHand });
    this.state.stats.handBonusPips += this.handAccumulator.bonusPips;
    this.state.stats.hitchhikerPipsContributed += this.handAccumulator.hitchhikerPips;
    const scoreSource = freePlay ? 'jumpingBean' as const : 'hand' as const;
    this.log({ type: 'SCORE_ROUNDING_AUDIT', hand, dieIds: scoringIds, pips, multiplier, xMult, rawScore, amount: score, source: scoreSource, playSource,
      message: `Final: ${this.format(pips)} × ${this.format(multiplier)} × ${this.format(xMult)}${bossFactor !== 1 ? ` × boss ${this.format(bossFactor)}` : ''} = ${this.format(rawScore)}; rounded ${this.format(score)}` });
    this.emit({ type: 'HAND_SCORE_FINALIZED', hand, dieIds: scoringIds, pips, multiplier, xMult, rawScore, amount: score,
      source: scoreSource, playSource, handConsumed: resolution.consumesHand, message: `Final awarded hand score: ${this.format(score)}` });
    this.addScore(score, scoreSource, `${freePlay ? 'Free play: ' : ''}${HANDS[hand].name}: round score +${this.format(score)}`, scoringIds, hand);
    const roundScoreAfterAward = this.state.score;
    if (!freePlay && handStart.chargeArmed) {
      const consumed = this.state.chargeXMult;
      this.state.chargeXMult = 1; this.state.chargeArmed = false;
      this.state.chargeAttribution = {};
      this.state.stats.chargeConsumed = Number((this.state.stats.chargeConsumed + Math.max(0, consumed - 1)).toFixed(12));
      this.emit({ type: 'CHARGE_CHANGED', xMult: 1, message: `Charge ×${this.format(consumed)} consumed; meter reset to ×1` });
    }
    this.addMomentumCharge(hand);
    this.applyPowerSurge(hand, handStart.ultimateHands.includes(hand));
    if (UPPER_HAND_IDS.includes(hand) && ownedFlameIds(this.state).has('sixPack')) {
      const before = this.state.sixPackXMult;
      const startingFactor = this.state.bonfires.includes('sixPack') ? sixPackStartingMultiplier(100)
        : sixPackStartingMultiplier(activeFlameInvestment(this.state.dice.find(die => activeFlameId(die.flame) === 'sixPack')?.flame ?? null));
      this.state.sixPackUpperHandsPlayed = Math.min(6, this.state.sixPackUpperHandsPlayed + 1);
      this.state.sixPackXMult = sixPackMultiplierAfterUpperHands(startingFactor, this.state.sixPackUpperHandsPlayed);
      this.emit({ type: 'SIX_PACK_CHANGED', flame: 'sixPack', hand, xMult: this.state.sixPackXMult,
        message: `Six Pack ×${this.format(before)} → ×${this.format(this.state.sixPackXMult)}` });
    }
    if (!freePlay) this.advanceHotStreak(hand, scoringIds);
    let personalTrainerSucceeded: boolean | null = trainerActivations.length ? false : null;
    for (const participant of trainerActivations) {
      const succeeded = this.resolvePersonalTrainerActivation(hand, participant.id, participant.face) === true;
      if (succeeded) personalTrainerSucceeded = true;
    }
    this.state.handPlayCounts[hand]++;
    this.log({ type: 'ABILITY_EVALUATED', enhancement: freeBean ? 'jumpingBean' : undefined, hand, dieIds: scoringIds, playSource,
      message: `${HANDS[hand].name} hand history incremented: ${this.format(handStart.previousPlays)} → ${this.format(this.state.handPlayCounts[hand])}` });
    this.handAccumulator = null;
    if (resolution.consumesHand) {
      if (!this.state.consumed.includes(hand)) this.state.consumed.push(hand);
      if (!this.state.scorecardCycleConsumed.includes(hand)) this.state.scorecardCycleConsumed.push(hand);
      this.emit({ type: 'HAND_CONSUMED', hand, playSource, handConsumed: true, message: `${HANDS[hand].name} consumed for round ${this.format(this.state.round)}` });
    }
    this.advanceMarathon(hand, playSource);
    this.resolveQuickdraw(hand, playSource);
    this.resolveCallerCall(hand, playSource);
    this.resolveSnakeEyes(scoringIds);
    this.resolveInfected(scoringIds);
    this.moveFly();
    const magicianReturned = this.resolveMiniBossHand(hand);
    let winning = this.state.score >= this.state.target;
    if (magicianReturned && winning) {
      this.drain();
      winning = this.state.score >= this.state.target;
    }
    let jackpotPayout = 0;
    if (winning) jackpotPayout = this.resolveJackpot(scoringIds);
    const beanRecordIndex = freeBean ? this.state.stats.jumpingBeanFreePlays.push({
      round: this.state.round, dieId: ids[0], face: shapeParticipants[0].face.rank, hand, handLevel,
      basePips: this.state.stats.handScores.at(-1)!.basePips, baseMultiplier: this.state.stats.handScores.at(-1)!.baseMultiplier,
      score, xMultFactors: structuredClone(this.state.stats.handScores.at(-1)!.xMultFactors),
      previousPlayCount: handStart.previousPlays, handPlayCountAfter: this.state.handPlayCounts[hand], consumedHand: false,
      stickyPreventedReroll: false, followupRerolled: false, roundCleared: winning, jackpotPayout, personalTrainerSucceeded,
    }) - 1 : null;
    if (bossFactor !== 1) this.v2Hand!.xMultContributions.push({ sourceId: this.state.boss?.type ?? 'other',
      origin: 'boss', factor: bossFactor });
    const draft = this.v2Hand!;
    this.trace({ kind: 'scoring_step', hand, stage: 'final', before: draft.roundScoreBefore,
      after: this.state.score, source: playSource });
    const handEvent = this.emitV2({ kind: 'hand_scored', parentSeq: draft.parentSeq, hand, level: handLevel,
      playSource, selectedDice: draft.selectedDice,
      scoringDice: scoringParticipants.map(participant => ({ ...this.historyDie(participant.id, participant.face), role: participant.role })),
      consumed: resolution.consumesHand,
      score: { infernoMultiplier: currentInfernoMultiplier, basePips: this.state.stats.handScores.at(-1)!.basePips,
        finalPips: pips, baseMult: this.state.stats.handScores.at(-1)!.baseMultiplier,
        finalMult: multiplier, finalXMult: xMult, bossFactor, raw: rawScore, awarded: score,
        rounding: { mode: 'nearest_integer', delta: new Decimal(score.toString()).minus(rawScore).toFixed() } },
      roundScore: { before: draft.roundScoreBefore, afterAward: roundScoreAfterAward, after: this.state.score },
      pipsContributions: draft.pipsContributions, multContributions: draft.multContributions,
      xMultContributions: draft.xMultContributions, checks: draft.checks, sideEffects: draft.sideEffects });
    this.v2RecentHand = handEvent.kind === 'hand_scored' ? handEvent : null;
    this.v2Hand = null;
    this.v2ParentSeq = handEvent.seq;
    this.advanceNeglected();
    return this.resolvePostPlayRerolls(resolution, winning, beanRecordIndex);
  }

  manualReroll(dieIds: number[]): void {
    const ids = orderDieIdsByEncounter(this.state, [...dieIds]);
    const requiredDieIds = requiredEncounterDieIds(this.state);
    const startedDeadBoard = !hasPlayableHand(activeEncounterDice(this.state), unavailableEncounterHands(this.state), requiredDieIds);
    const flywheelIds = ids.filter(id => {
      const face = activeFace(this.state.dice.find(die => die.id === id)!);
      return stacks(face, 'flywheel') > 0 && (face.flywheelCharges ?? 0) > 0;
    });
    for (const id of flywheelIds) {
      const face = activeFace(this.state.dice.find(die => die.id === id)!);
      face.flywheelCharges!--;
      this.pendingFlywheel.set(id, face.flywheelCharges ?? 0);
      this.trigger('flywheel', id, structuredClone(face), `free manual reroll; ${face.flywheelCharges} charge(s) remain`);
    }
    const paidDice = ids.length - flywheelIds.length;
    const normalSpent = Math.min(this.state.manualRerollsRemaining, paidDice);
    const carePackageSpent = paidDice - normalSpent;
    this.state.manualRerollsRemaining -= normalSpent;
    this.state.specialOfferEffects.carePackageRerolls -= carePackageSpent;
    const round = this.state.stats.rounds.at(-1)!;
    round.lastAction = 'MANUAL_REROLL'; round.manualRerollChargesSpent += paidDice; round.manualRerollActions++;
    this.state.stats.manualRerollActions++; this.state.stats.manualDiceRerolled += ids.length;
    const record = { round: this.state.round, dieIds: ids, charges: paidDice, remaining: this.state.manualRerollsRemaining, startedDeadBoard, rescuedDeadBoard: false };
    this.state.stats.manualRerolls.push(record);
    const normalRemaining = this.state.manualRerollsRemaining;
    const carePackageRemaining = this.state.specialOfferEffects.carePackageRerolls;
    const message = carePackageSpent > 0
      ? carePackageRemaining > 0
        ? `Care Package reroll${carePackageSpent === 1 ? '' : 's'} used · ${this.format(carePackageRemaining)} remaining · ${this.format(normalRemaining)} Rerolls left`
        : `Care Package depleted · ${this.format(normalRemaining)} Rerolls left`
      : `Manual reroll · ${this.format(normalRemaining)} Rerolls left · Care Package ${this.format(carePackageRemaining)}`;
    this.emit({ type: 'MANUAL_REROLL_STARTED', dieIds: ids, amount: ids.length, message });
    if (this.state.chargeArmed && !hasChargeBonfire(this.state)) {
      this.state.chargeArmed = false;
      this.emit({ type: 'CHARGE_ARMED', xMult: this.state.chargeXMult,
        message: 'Charge disarmed because its intended hand selection was cleared.' });
    }
    const jumpStart = this.chargeFlameSource('jumpStart');
    if (jumpStart) for (const dieId of ids) this.growCharge('jumpStart', jumpStartChargeGain(jumpStart.investment),
      `1 Reroll spent on D${dieId + 1}`, [dieId]);
    this.v2ManualSpend = { normalCharges: normalSpent, carePackageCharges: carePackageSpent,
      remaining: this.state.manualRerollsRemaining };
    this.rollBatch(ids, 'Manual gameplay reroll', 'gameplay', true, 'manual');
    this.drain();
    if (startedDeadBoard && (this.state.score >= this.state.target || hasPlayableHand(activeEncounterDice(this.state), unavailableEncounterHands(this.state), requiredDieIds))) {
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
    base.shop ??= { visitId: base.nextShopVisitId++,
      offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0,
      freeEnhancementOfferIds: [], freeTrainingOfferKeys: [] };
    // Once the next Chapter has started, a Bust restores this as that Round's
    // retry Shop even when its contents originated in the prior post-Boss Shop.
    if (base.shop.kind) base.shop.kind = 'between_rounds';
    if (base.bossSilenced) base.specialOfferEffects.silence = true;
    base.bossSilenced = false;
    base.flameSelection = null;
    base.specialOffer = null;
    base.roundSummary = null;
    base.bust = null;
    if (base.boss?.type === 'magician' && !base.boss.returned) {
      const missingDieId = base.boss.missingDieId;
      const missingDie = missingDieId === null ? undefined : base.dice.find(die => die.id === missingDieId);
      if (missingDie) missingDie.flame = base.boss.hiddenFlame;
      const ownedMissingDie = missingDieId === null ? undefined : checkpoint.diceInventory.instances[missingDieId];
      if (ownedMissingDie) ownedMissingDie.flame = base.boss.hiddenFlame;
      recalculateMaxCharge(base);
    }
    base.boss = null;
    base.dice = base.dice.filter(die => die.owner === 'player');
    checkpoint.encounterDice = [];
    this.state.roundCheckpoint = checkpoint;
  }
  private resolveBust(): void {
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
    this.state.shop ??= { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0,
      freeEnhancementOfferIds: [], freeTrainingOfferKeys: [] };
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
      message: `BUST · Round ${this.format(failure.round)} attempt ${this.format(failure.attempt)} · ${this.format(failure.score)} / ${this.format(failure.target)} · ${this.format(failure.shortfall)} short · lives ${this.format(failure.livesBefore)} → ${this.format(failure.livesAfter)}` });
    if (failure.livesAfter > 0) {
      this.state.bustPresentationDice = null;
      this.state.phase = 'shop';
      this.state.shop!.visitId = this.state.nextShopVisitId++;
      this.state.currentNodeId = failedNodeId;
      this.mapTransition(shopNodeBefore(failure.round), 'backward');
      this.emitV2({ kind: 'shop_visit_started', shopVisitId: this.state.shop!.visitId, reason: 'bust' });
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
    this.enterChapterIfNeeded(this.state.round);
    const chargeBeforeRoundReset = this.state.chargeXMult;
    const chargeWasArmed = this.state.chargeArmed;
    if (this.state.chargeXMult !== 1 || this.state.chargeArmed) this.state.stats.chargeResets++;
    this.state.phase = 'round'; this.state.score = 0n; this.state.scoreByHand = {}; this.state.effectScore = 0n;
    if (!retry) this.state.specialOfferEffects.bottledFairyTriggeredThisRound = false;
    this.state.manualRerollsRemaining = CONFIG.manualRerollsPerRound;
    this.state.consumed = []; this.state.scorecardCycleConsumed = []; this.state.targetPracticeHand = null; this.state.lastRoundPayout = null; this.state.roundSummary = null;
    this.state.chargeXMult = 1; this.state.chargeArmed = false; this.state.chargeAttribution = {}; this.state.hotStreakCharges = 0;
    if (chargeBeforeRoundReset !== 1 || chargeWasArmed) this.emitV2({ kind: 'charge_changed', operation: 'round_reset',
      before: chargeBeforeRoundReset, after: 1, dieIds: [] });
    this.v2LastCharge = 1;
    this.state.flameSelection = null; this.state.specialOffer = null; this.state.bust = null; this.state.stats.roundReached = this.state.round;
    this.state.encounterDice = [];
    syncActiveDiceProjection(this.state);
    for (const die of rosterDice(this.state)) for (const face of die.faces) {
      delete face.magneticSourceUsed;
      if (face.shifterBaseRank !== undefined) { face.rank = face.shifterBaseRank; delete face.shifterBaseRank; }
      const flywheel = stacks(face, 'flywheel');
      const sustainable = stacks(face, 'sustainable');
      if (flywheel) face.flywheelCharges = flywheel; else delete face.flywheelCharges;
      if (sustainable) face.sustainableCharges = sustainable; else delete face.sustainableCharges;
    }
    const bossType = this.state.bossSchedule[this.state.round]
      ?? (this.state.round > 60 ? bossTypeForRound(this.state.seed, this.state.round) : null);
    if (bossType) this.state.bossSchedule[this.state.round] = bossType;
    const bossSilenced = !!bossType && this.state.specialOfferEffects.silence;
    const bossForGoalRound = (round: number) => this.state.bossSchedule[round]
      ?? (round > 60 ? bossTypeForRound(this.state.seed, round) : null);
    const targetBreakdown = getEncounterGoalBreakdown(
      this.state.round, bossType ?? null, bossSilenced, bossForGoalRound,
    );
    const { chapter: targetChapter, localRound: targetLocalRound, ...historyTargetBreakdown } = targetBreakdown;
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
    if (!this.state.bossSilenced && this.state.boss?.type === 'magician') {
      const missingDieId = this.state.boss.missingDieId;
      if (missingDieId !== null) {
        const missingDie = this.state.dice.find(die => die.id === missingDieId);
        if (!missingDie) throw new Error('The Magician requires an equipped player die to disappear.');
        this.state.boss.hiddenFlame = missingDie.flame;
        missingDie.flame = null;
        recalculateMaxCharge(this.state);
      }
    }
    if (!this.state.bossSilenced && this.state.boss?.type === 'warden') {
      this.state.boss.unlockCosts = wardenUnlockCosts(this.state.handLevels, [], this.state.target,
        this.state.boss.encounterDieIds.length);
    }
    const sixPackInvestment = this.state.bonfires.includes('sixPack') ? 100
      : activeFlameInvestment(this.state.dice.find(die => activeFlameId(die.flame) === 'sixPack')?.flame ?? null);
    this.state.sixPackXMult = sixPackStartingMultiplier(sixPackInvestment);
    this.state.sixPackUpperHandsPlayed = 0;
    this.state.hotStreakGoal = ownedFlameIds(this.state).has('hotStreak') ? 'pair' : null;
    this.state.handFamilyFlameStages = initialHandFamilyFlameStages(this.state);
    this.captureRoundCheckpoint();
    this.state.shop = null;
    this.mapTransition(encounterNode(this.state.round, bossType), direction);
    this.state.stats.rounds.push({ round: this.state.round, attempt: this.state.roundAttemptNumber, target: this.state.target, firstCrossedScore: null,
      finalScore: 0n, clearMargin: null, cleared: false, lastHand: null, lastAction: null,
      manualRerollsGranted: this.state.manualRerollsRemaining, manualRerollChargesSpent: 0,
      manualRerollsRemainingAtClear: null, manualRerollActions: 0, deadBoardRescues: 0, scoreByHand: {}, effectScore: 0n,
      goldBefore: this.state.gold, goldBySourceBefore: structuredClone(this.state.stats.goldBySource), payout: null });
    const v2RoundStarted = this.emitV2({ kind: 'round_attempt_started', chapter: targetChapter,
      chapterRound: targetLocalRound, retry, target: historyTargetBreakdown,
      boss: this.state.boss?.type ?? null, lives: this.state.lives,
      dice: activeEncounterDice(this.state).map(die => this.historyDie(die.id)) });
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
      if (!this.state.bossSilenced && boss.type === 'magician') this.emit({ type: 'BOSS_HAND_CHANGED', boss: boss.type,
        message: boss.missingDieId === null
          ? `The Magician calls ${boss.calledHands.map(hand => HANDS[hand].name).join(', ')}; the final die remains`
          : `The Magician calls ${boss.calledHands.map(hand => HANDS[hand].name).join(', ')}; D${boss.missingDieId + 1} disappeared` });
      if (!this.state.bossSilenced && boss.type === 'neglected') this.emit({ type: 'BOSS_HAND_CHANGED', boss: boss.type,
        hands: [...boss.neglectedHands], amount: 0, bossState: 'restricted',
        message: `The Neglected disabled ${boss.neglectedHands.map(hand => HANDS[hand].name).join(' and ')} until 6 hands have been played` });
    }
    if (!this.state.boss) this.emit({ type: retry ? 'ROUND_RETRY_STARTED' : 'ROUND_STARTED',
      message: `Round ${this.format(this.state.round)} — Attempt ${this.format(this.state.roundAttemptNumber)} — goal ${this.format(this.state.target)}; Charge reset to ×1` });
    this.selectTargetPractice();
    if (!this.state.bossSilenced && this.state.boss?.type === 'hexer') {
      this.state.encounterDice.push(createCursedDie());
      syncActiveDiceProjection(this.state);
    }
    this.v2ParentSeq = v2RoundStarted.seq;
    if (!this.state.bossSilenced && this.state.boss?.type === 'warden') {
      const playerDice = rosterDice(this.state);
      if (!playerDice.length) throw new Error('The Warden requires at least one player die.');
      this.rollBatch(playerDice.map(die => die.id), 'Warden opening roll', 'wardenSetup', false, 'warden_opening');
    } else this.rollBatch(activeEncounterDice(this.state).map(die => die.id), 'Initial round roll', 'gameplay', false, 'initial_round');
    this.drain(); this.evaluate();
    if (v2RoundStarted.kind === 'round_attempt_started')
      v2RoundStarted.dice = activeEncounterDice(this.state).map(die => this.historyDie(die.id));
    if (this.state.phase === 'round') this.state.decisionId++;
  }
  freshOffers(reason: 'initial' | 'reroll' = 'initial'): void {
    const chapter = chapterNumberForRound(this.state.round);
    const pool = eligibleEnhancements(chapter);
    const selected = rarityFirstSelection(pool, 3, id => ENHANCEMENTS[id].rarity,
      OFFER_RARITY_WEIGHTS.enhancement, this.rng);
    this.state.shop!.offers = selected.map(enhancement => ({ id: this.state.nextOfferId++, enhancement, purchased: false }));
    const offerSet = selected.map(id => ({ name: ENHANCEMENTS[id].name, rarity: ENHANCEMENTS[id].rarity }));
    this.log({ type: 'OFFERS_REFRESHED', offerSet,
      message: `Enhancement offers: ${offerSet.map(item => `${item.name} [${rarityLabel(item.rarity)}]`).join(', ')}` });
    this.emitV2({ kind: 'shop_offers_presented', pool: 'enhancement', reason,
      chapter, maxEnhancementTypesPerFace: maxEnhancementTypesPerFace(chapter),
      highestUnlockedEnhancementTier: highestUnlockedEnhancementTier(chapter), eligibleEnhancements: [...pool],
      offers: this.state.shop!.offers.map(offer => ({ id: offer.id, contentId: offer.enhancement,
        rarity: ENHANCEMENTS[offer.enhancement].rarity })) });
  }
  freshTrainingOffers(): void {
    const pool: (HandId | 'team')[] = [...HAND_IDS, 'team'];
    this.state.shop!.trainingOffers = Array.from({ length: 3 }, () => {
      const [selection] = pool.splice(randomIndex(this.rng, pool.length), 1);
      return selection === 'team'
        ? { kind: 'team' as const, purchases: 0 }
        : { kind: 'hand' as const, hand: selection, purchases: 0 };
    });
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

    const selectedEmbers = new Map(evaluation.flamesSnuffed
      .filter((asset): asset is Extract<EngulfmentAssetRef, { kind: 'ember' }> => asset.kind === 'ember')
      .map(asset => [asset.dieId, asset.flame]));
    for (const die of this.state.dice) if (selectedEmbers.get(die.id) === activeFlameId(die.flame)) die.flame = null;
    const selectedBonfires = new Set(evaluation.flamesSnuffed.filter(asset => asset.kind === 'bonfire').map(asset => asset.flame));
    this.state.bonfires = this.state.bonfires.filter(flame => !selectedBonfires.has(flame));
    for (const asset of evaluation.flamesSnuffed) {
      delete this.state.chargeAttribution[asset.flame];
      removeFlameInstance(this.state, asset.flame);
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
    this.state.shop = { visitId, kind: postBoss ? 'post_boss' : 'between_rounds', exitUnlocked: false,
      offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0,
      freeEnhancementOfferIds: [], freeTrainingOfferKeys: [] };
    const upcomingRound = this.state.round + 1;
    const upcomingBoss = this.state.bossSchedule[upcomingRound];
    if (upcomingBoss) this.state.bossSchedule[upcomingRound] = upcomingBoss;
    this.mapTransition(postBoss ? postBossShopNodeAfter(this.state.round) : shopNodeBefore(upcomingRound), direction);
    this.emitV2({ kind: 'shop_visit_started', shopVisitId: visitId,
      reason: direction === 'backward' ? 'bad_dream' : 'normal' });
    this.freshOffers(); this.freshTrainingOffers();
    if (this.state.specialOfferEffects.semesterShopsRemaining > 0) {
      if (!this.state.shop.trainingOffers.some(offer => offer.kind === 'team')) {
        this.state.shop.trainingOffers[this.state.shop.trainingOffers.length - 1] = { kind: 'team', purchases: 0 };
      }
      this.state.specialOfferEffects.semesterShopsRemaining--;
      this.emit({ type: 'SPECIAL_EFFECT_TRIGGERED', rarity: SPECIAL_OFFERS.semester.rarity,
        message: `Semester guaranteed Team Training · ${this.state.specialOfferEffects.semesterShopsRemaining} future Shop${this.state.specialOfferEffects.semesterShopsRemaining === 1 ? '' : 's'} left` });
    }
    if (this.state.specialOfferEffects.onTheHouse) {
      this.state.shop.freeEnhancementOfferIds = this.state.shop.offers.map(offer => offer.id);
      this.state.shop.freeTrainingOfferKeys = this.state.shop.trainingOffers.map(trainingOfferKey);
      this.state.specialOfferEffects.onTheHouse = false;
      this.emit({ type: 'SPECIAL_EFFECT_TRIGGERED', message: 'On The House made this Shop’s initial displayed purchases free' });
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
        break;
      case 'timeTravel': {
        timeTravelDestination = timeTravelDestinationRound(this.state.round);
        break;
      }
      case 'carePackage': this.state.specialOfferEffects.carePackageRerolls += 3; break;
      case 'silence': this.state.specialOfferEffects.silence = true; break;
      case 'sommelier':
        for (const die of this.state.dice.filter(item => item.owner === 'player')) for (const face of die.faces)
          if (stacks(face, 'vintage') && !face.vintageSommelierBoosted) face.vintageSommelierBoosted = true;
        break;
      case 'taxEvasion': this.state.specialOfferEffects.taxEvasionRounds += 3; break;
      case 'fireKeeper': {
        const embers = this.state.dice.filter(die => die.owner === 'player' && die.flame && die.flame.investedGold < 100);
        const die = embers[randomIndex(this.rng, embers.length)];
        const flame = die.flame!;
        const from = flame.investedGold;
        flame.investedGold = from + Math.ceil((100 - from) / 2);
        this.state.infernoProgress.recentAction = 'flame_invested';
        this.emit({ type: 'FLAME_INVESTED', flame: flame.id, dieIds: [die.id], amount: flame.investedGold - from,
          message: `Fire Keeper stoked ${FLAMES[flame.id].name}: ${this.format(from)} → ${this.format(flame.investedGold)} / 100` });
        if (flame.investedGold === 100) {
          const id = flame.id;
          die.flame = null;
          if (!this.state.bonfires.includes(id)) this.state.bonfires.push(id);
          this.state.infernoProgress.recentAction = 'bonfire_created';
          this.emit({ type: 'BONFIRE_CREATED', flame: id, dieIds: [die.id], message: `${FLAMES[id].name} became a Bonfire` });
        }
        recalculateMaxCharge(this.state);
        break;
      }
      case 'cashBonus': this.state.specialOfferEffects.cashBonusRounds += 3; break;
      case 'orangeTheory':
        for (const die of this.state.dice.filter(item => item.owner === 'player')) for (const face of die.faces) {
          const workout = stacks(face, 'workout');
          if (workout) face.workoutPips += workout * 5;
        }
        break;
      case 'powerball':
        this.state.specialOfferEffects.powerballRounds = 3;
        this.state.specialOfferEffects.powerballAvailable = true;
        break;
      case 'bottledFairy': this.state.specialOfferEffects.bottledFairyRounds += 3; break;
      case 'badDream':
        this.state.specialOfferEffects.badDreamRounds = 3;
        captureBadDream = true;
        break;
      case 'semester': this.state.specialOfferEffects.semesterShopsRemaining = 3; break;
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
    if (this.state.infernoEvaluation.suspendAfterContinue) {
      this.state.infernoEvaluationSuspendedUntilNewFlame = true;
      this.emitV2({ kind: 'inferno_suspension_changed', suspended: true, reason: 'collection_insufficient' });
    }
    this.state.infernoEvaluation = null;
    this.continuePostRoundFlow();
  }
  private completeSpecialOfferRound(): void {
    const effects = this.state.specialOfferEffects;
    for (const key of ['taxEvasionRounds', 'cashBonusRounds', 'powerballRounds', 'bottledFairyRounds', 'badDreamRounds'] as const)
      if (effects[key] > 0) effects[key]--;
    if (effects.powerballRounds === 0) effects.powerballAvailable = false;
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
      if (bossType && isBigBossRound(this.state.round))
        grantChapterStorageSlot(this.state.diceInventory, chapterNumberForRound(this.state.round));
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
      const goldenGold = this.state.stats.goldBySource.golden - current.goldBySourceBefore.golden;
      const jackpotGold = this.state.stats.goldBySource.jackpot - current.goldBySourceBefore.jackpot;
      const knownGold = payout.baseGold + payout.unusedRerollGold + payout.interestGold + payout.bossRewardGold + goldenGold + jackpotGold;
      const totalGoldEarned = this.state.gold - current.goldBefore;
      const summary = this.state.roundSummary = {
        round: this.state.round, encounterType: bossType ? 'boss' : 'normal', bossType,
        score: this.state.score, target: this.state.target, goldBefore: current.goldBefore, goldAfter: this.state.gold,
        totalGoldEarned, sources: {
          baseRewardGold: payout.baseGold, unusedRerollGold: payout.unusedRerollGold, interestGold: payout.interestGold,
          bossRewardGold: payout.bossRewardGold, goldenGold, jackpotGold, otherGold: totalGoldEarned - knownGold,
        },
      };
      if (Object.values(summary.sources).reduce((sum, amount) => sum + amount, 0) !== totalGoldEarned)
        throw new Error('Round Summary Gold sources do not reconcile.');
      for (const die of this.state.dice) for (const face of die.faces) if (face.shifterBaseRank !== undefined) {
        face.rank = face.shifterBaseRank; delete face.shifterBaseRank;
      }
      this.state.phase = 'roundSummary';
      this.completeSpecialOfferRound();
      this.emit({ type: 'ROUND_SUMMARY_SHOWN', boss: bossType ?? undefined, roundSummary: structuredClone(summary), amount: totalGoldEarned,
        encounterType: summary.encounterType, goldBefore: summary.goldBefore, goldAfter: summary.goldAfter,
        goldEarnedTotal: totalGoldEarned, baseRewardGold: payout.baseGold, unusedRerollGold: payout.unusedRerollGold,
        interestGold: payout.interestGold, bossRewardGold: payout.bossRewardGold, goldenGold, jackpotGold,
        message: `${bossType ? `${isMiniBossType(bossType) ? 'Mini-Boss' : 'Boss'} defeated` : `Round ${this.format(this.state.round)} cleared`} · Gold ${this.format(summary.goldBefore)} → ${this.format(summary.goldAfter)} (+${this.format(totalGoldEarned)})` });
      this.performInfernoEvaluation();
    } else if (this.state.bossSilenced || this.state.boss?.type !== 'warden' || (this.state.boss.startingDieId !== null && this.state.boss.pendingReinforcements === 0)) {
      if (hasPlayableHand(activeEncounterDice(this.state), unavailableEncounterHands(this.state), requiredEncounterDieIds(this.state))) return;
      const rerolls = usableManualRerolls(this.state);
      if (rerolls > 0) { this.emit({ type: 'DEAD_BOARD', message: `No playable hands — ${this.format(rerolls)} rerolls remain` }); return; }
      if (this.state.specialOfferEffects.bottledFairyRounds > 0 && !this.state.specialOfferEffects.bottledFairyTriggeredThisRound) {
        this.state.manualRerollsRemaining = CONFIG.manualRerollsPerRound;
        this.state.specialOfferEffects.bottledFairyTriggeredThisRound = true;
        this.emit({ type: 'SPECIAL_EFFECT_TRIGGERED', amount: CONFIG.manualRerollsPerRound,
          message: `Bottled Fairy refilled ${this.format(CONFIG.manualRerollsPerRound)} manual Rerolls` });
        return;
      }
      this.resolveBust();
    }
  }
}
