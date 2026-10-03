import { bossRewardForRound, CONFIG, interestForGold, roundReward, targetForRound } from './config';
import { activeFace, rollPhysicalDie, scoringPips, weightedSourceFace } from './dice';
import { diminishingHalfChance, ENHANCEMENTS, ENHANCEMENT_IDS, personalTrainerChance, stacks } from './enhancements';
import {
  activeFlameId, activeFlameInvestment, captureHandStart, FLAMES, FLAME_IDS, handXMultContributions,
  fluxCapacitorChargeMultiplier, HAND_FAMILY_FLAME_IDS, HAND_FAMILY_FLAMES, hasChargeBonfire, HOT_STREAK_SEQUENCE,
  initialHandFamilyFlameStages, jumpStartChargeGain, momentumChargeGain, ownedFlameIds, recalculateMaxCharge,
  sixPackMultiplierAfterUpperHands, sixPackStartingMultiplier, thirdRailChargeGain,
} from './flames';
import { hasPlayableHand, HANDS, HAND_IDS, LOWER_HAND_IDS, UPPER_HAND_IDS } from './hands';
import { probabilityCheck, randomIndex } from './rng';
import { applyHandContribution, applyXMult, createHandAccumulator, finalizeHandScore, handContributions } from './scoring';
import { boardSnapshot } from './telemetry';
import { activeEncounterDice, bossTypeForRound, CALLER_HAND_POOL, cleanupTemporaryBossFaces, createBossRuntime, createCursedDie,
  isCursedDie, requiredEncounterDieIds, targetForBoss, unavailableEncounterHands, wardenUnlockCosts } from './bosses';
import { encounterNode, flameNodeAfter, postBossRewardForRound, shopNodeBefore, specialOfferNodeAfter } from './progression';
import { formatPercentage, formatPlayerNumber } from './copy';
import { eligibleSpecialOfferTypes, specialOfferDescription, specialOfferName, trainingOfferKey } from './specialOffers';
import type { ChargeFlame } from './flames';
import type { Enhancement, EventRecord, Face, Flame, GameEvent, GameState, GameStateBase, GoldSource, GoldSpendSource, HandId, HandPlaySource, HandScoreAccumulator, RandomSource, RunNode, ScoreSource, SpecialOffer } from './types';

type RollTrigger = { dieId: number; face: Face; enhancement: 'weighted' | 'jumpingBean'; weightedStacks?: number; rollWeight?: number; weightedSourceFace?: number };
type RollContext = 'gameplay' | 'wardenSetup' | 'shop' | 'flameSelection';
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
  constructor(readonly state: GameState, readonly rng: RandomSource) { recalculateMaxCharge(state); }

  format(value: number): string { return formatPlayerNumber(value); }
  emit(event: Omit<EventRecord, 'id' | 'round'>): void {
    if (this.events.length >= CONFIG.resolutionEventCap) throw new Error(`Resolution exceeded ${CONFIG.resolutionEventCap} events. Check for an infinite ability chain.`);
    const record = { ...event, ...(this.handAccumulator ? { handScore: structuredClone(this.handAccumulator) } : {}), id: this.state.history.length, round: this.state.round };
    this.state.history.push(record);
    this.events.push({ ...record, board: boardSnapshot(this.state) });
  }
  mapTransition(node: RunNode, direction: 'forward' | 'backward' = 'forward'): void {
    const fromNode = this.state.currentNodeId || null;
    this.state.currentNodeId = node.id;
    this.state.stats.mapTransitions.push({ fromNode, toNode: node.id, nodeType: node.type,
      round: node.round, boss: node.boss, direction });
    this.emit({ type: 'MAP_TRANSITION', fromNode, toNode: node.id, nodeType: node.type,
      boss: node.boss, direction, message: `${fromNode ?? 'Run start'} → ${node.id}` });
  }
  log(event: Omit<EventRecord, 'id' | 'round'>): void {
    this.state.history.push({ ...event, id: this.state.history.length, round: this.state.round });
  }
  trigger(enhancement: Enhancement, dieId: number, face?: Face, detail = '', context: Pick<EventRecord, 'hand'> = {}): void {
    this.state.stats.triggers[enhancement] = (this.state.stats.triggers[enhancement] ?? 0) + 1;
    this.emit({ ...context, type: 'ABILITY_TRIGGERED', enhancement, dieIds: [dieId], face: face?.rank,
      message: `D${dieId + 1} ${ENHANCEMENTS[enhancement].name}${detail ? `: ${detail}` : ''}` });
  }
  triggerFlame(flame: Flame, dieId: number | null, detail = '', hand?: HandId, xMult?: number): void {
    this.state.stats.flameTriggers[flame] = (this.state.stats.flameTriggers[flame] ?? 0) + 1;
    if (xMult !== undefined) (this.state.stats.xMultFactorsByFlame[flame] ??= []).push(xMult);
    this.emit({ type: 'FLAME_TRIGGERED', flame, dieIds: dieId === null ? undefined : [dieId], hand, xMult,
      message: `${dieId === null ? 'Bonfire' : `D${dieId + 1}`} ${FLAMES[flame].name}${detail ? `: ${detail}` : ''}` });
  }
  checkProbability(enhancement: 'sticky' | 'hitchhiker' | 'personalTrainer', stackCount: number, dieIds: number[], hand?: HandId, effectiveChance?: number): boolean {
    const chance = effectiveChance ?? diminishingHalfChance(stackCount);
    const succeeded = probabilityCheck(this.rng, chance);
    const stats = this.state.stats.probabilityProcs[enhancement];
    stats.checks++;
    stats[succeeded ? 'successes' : 'failures']++;
    stats.stacksAtCheck.push(stackCount);
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
  addScore(amount: number, source: Exclude<ScoreSource, 'hitchhiker'>, message: string, dieIds: number[], hand?: HandId): void {
    if (!Number.isInteger(amount) || !Number.isInteger(this.state.score)) throw new Error(`Score awards and round score must be integers (award ${amount}, current ${this.state.score}).`);
    this.state.score += amount;
    this.state.stats.scoreBySource[source] += amount;
    if (hand) {
      this.state.scoreByHand[hand] = (this.state.scoreByHand[hand] ?? 0) + amount;
      this.state.stats.scoreByHand[hand] = (this.state.stats.scoreByHand[hand] ?? 0) + amount;
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
      || boss.activeDieIds.length >= CONFIG.diceCount || this.state.score < boss.nextUnlockTarget) return;
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
      this.addGold(bonus, `Cash Bonus · Bonus ×${this.format(bonus)}: +${this.format(bonus)} Gold`, 'cashBonus', dieId, 'bonus', snapshot.rank);
      this.emit({ type: 'SPECIAL_EFFECT_TRIGGERED', enhancement: 'bonus', dieIds: [dieId], amount: bonus,
        message: `Cash Bonus paid ${this.format(bonus)} Gold` });
    }
    if (workout) {
      this.state.stats.triggers.workout = (this.state.stats.triggers.workout ?? 0) + 1;
      const live = activeFace(this.state.dice.find(die => die.id === dieId)!);
      const before = scoringPips(live);
      live.workoutPips += workout * CONFIG.workoutIncrement;
      this.emit({ type: 'WORKOUT_INCREMENTED', enhancement: 'workout', dieIds: [dieId], face: snapshot.rank,
        message: `D${dieId + 1} face ${snapshot.rank} Workout ×${this.format(workout)}: ${this.format(before)} → ${this.format(scoringPips(live))} future pips` });
    }
    if (workout && !this.state.bossSilenced && this.state.boss?.type === 'hexer' && dieId === this.state.boss.cursedDieId) this.state.stats.hexerEvents.push({
      round: this.state.round, attempt: this.state.roundAttemptNumber, kind: 'workout', face: snapshot.rank, hand, amount: workout });
    if (stacks(snapshot, 'vintage')) {
      const live = activeFace(this.state.dice.find(die => die.id === dieId)!);
      const before = Math.max(0, live.vintageSellValue ?? 0);
      live.vintageSellValue = before + 3;
      this.state.stats.triggers.vintage = (this.state.stats.triggers.vintage ?? 0) + 1;
      this.state.stats.vintageGrowth.push({ round: this.state.round, attempt: this.state.roundAttemptNumber,
        dieId, face: snapshot.rank, hand, playSource, participation, from: before, to: live.vintageSellValue });
      this.emit({ type: 'VINTAGE_GROWN', enhancement: 'vintage', dieIds: [dieId], face: snapshot.rank, hand, playSource,
        amount: 3, message: `D${dieId + 1} face ${snapshot.rank} Vintage · ${HANDS[hand].name} (${playSource === 'jumpingBean' ? 'Jumping Bean free play' : participation}) · sell value ${this.format(before)} → ${this.format(live.vintageSellValue)}` });
    }
  }
  resolveJackpot(scoringDieIds: number[]): number {
    const scoring = new Set(scoringDieIds);
    let total = 0;
    for (const die of [...this.state.dice].sort((a, b) => a.id - b.id)) {
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

  private chargeFlameSource(flame: ChargeFlame):
    { investment: number; dieId: number | null } | null {
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
    const requestedGain = before * 2;
    this.growCharge('powerSurge', requestedGain, `${HANDS[hand].name} tripled current Charge`);
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
    this.state.stats.chargeGained = Number((this.state.stats.chargeGained + gain).toFixed(12));
    if (multiplier <= 1) return;
    this.triggerFlame('fluxCapacitor', source.dieId,
      `${this.format(pulledMagneticFaces)} Magnetic face${pulledMagneticFaces === 1 ? '' : 's'} pulled · Charge ×${this.format(multiplier)} → ×${this.format(after)}`);
    this.emit({ type: 'CHARGE_CHANGED', flame: 'fluxCapacitor', dieIds, xMult: after,
      message: `${FLAMES.fluxCapacitor.name}: Charge ×${this.format(before)} × ${this.format(multiplier)} = ×${this.format(after)}` });
  }
  rollBatch(dieIds: number[], reason: string, context: RollContext, excludeStartingFace = false): void {
    const ids = [...new Set(dieIds)].sort((a, b) => a - b);
    if (!ids.length) return;
    this.emit({ type: 'DICE_REROLL_STARTED', dieIds: ids, message: `${reason}: ${ids.map(id => `D${id + 1}`).join(', ')}` });
    const rolling = new Set(ids);
    const anchors = context === 'gameplay' ? activeEncounterDice(this.state)
      .filter(die => !rolling.has(die.id) && stacks(activeFace(die), 'magnetic') && !activeFace(die).magneticSourceUsed)
      .map(die => die.id) : [];
    if (anchors.length) {
      this.state.stats.magneticAnchorBatches++;
      this.log({ type: 'ABILITY_EVALUATED', enhancement: 'magnetic', dieIds: anchors, message: `Held Magnetic anchor${anchors.length > 1 ? 's' : ''}: ${anchors.map(id => `D${id + 1}`).join(', ')}` });
    }
    const results = ids.map(dieId => {
      const die = this.state.dice.find(item => item.id === dieId)!;
      const beforePhysical = die.value;
      const before = activeFace(die).rank;
      const bumped = (context === 'gameplay' || context === 'wardenSetup') && stacks(activeFace(die), 'bump') > 0;
      if (bumped) {
        const physicalFace = (isCursedDie(die) ? Math.min(7, beforePhysical + 1) : beforePhysical === 6 ? 1 : beforePhysical + 1) as import('./types').Rank;
        return { dieId, before, beforePhysical, physicalFace, value: die.faces[physicalFace - 1].rank, weighted: false, bumped, attracted: false };
      }
      const destinations = anchors.length
        ? die.faces.map((face, index) => ({ face, physicalFace: (index + 1) as import('./types').Rank }))
          .filter(item => stacks(item.face, 'magnetic') && (!excludeStartingFace || item.physicalFace !== beforePhysical))
        : [];
      if (destinations.length) {
        const destination = destinations[randomIndex(this.rng, destinations.length)];
        return { dieId, before, beforePhysical, physicalFace: destination.physicalFace, value: destination.face.rank, weighted: false, bumped: false, attracted: true };
      }
      return { dieId, before, beforePhysical, ...rollPhysicalDie(die, this.rng, excludeStartingFace ? beforePhysical : undefined), bumped: false, attracted: false };
    });
    const attracted = results.filter(result => result.attracted);
    if (attracted.length) {
      for (const anchor of anchors) activeFace(this.state.dice.find(die => die.id === anchor)!).magneticSourceUsed = true;
    }
    const triggers: RollTrigger[] = [];
    for (const result of results) {
      const die = this.state.dice.find(item => item.id === result.dieId)!;
      die.value = result.physicalFace;
      const face = structuredClone(activeFace(die));
      this.emit({ type: 'DIE_ROLLED', dieIds: [die.id], face: face.rank,
        rollSource: excludeStartingFace ? 'manual_reroll' : 'automatic', previousFace: result.before, resultFace: face.rank,
        sameFaceExcluded: excludeStartingFace && !result.bumped,
        message: `D${die.id + 1} rolled: ${result.before} → ${face.rank}${excludeStartingFace ? ' · previous physical face excluded' : ''}` });
      if ((context === 'gameplay' || context === 'wardenSetup') && face.rank === 3) {
        const source = this.chargeFlameSource('thirdRail');
        if (source) this.growCharge('thirdRail', thirdRailChargeGain(source.investment), `D${die.id + 1} rolled a 3`, [die.id]);
      }
      if (isCursedDie(die)) {
        this.state.stats.hexerEvents.push({ round: this.state.round, attempt: this.state.roundAttemptNumber,
          kind: reason.startsWith('Manual') ? 'manual_reroll' : face.rank === 7 ? 'seven' : 'roll', face: face.rank });
        this.emit({ type: 'CURSED_DIE_ROLLED', boss: 'hexer', dieIds: [die.id], face: face.rank,
          message: `Cursed Die rolled ${face.rank}` });
      }
      if (result.bumped) {
        this.state.stats.bumpControlledRolls++;
        this.state.stats.triggers.bump = (this.state.stats.triggers.bump ?? 0) + 1;
        this.emit({ type: 'BUMP_ROLL', enhancement: 'bump', dieIds: [die.id], face: face.rank, message: `D${die.id + 1} Bump controlled the roll: ${result.before} → ${face.rank}` });
      } else if (result.attracted) {
        this.state.stats.magneticAttractions++;
        this.state.stats.triggers.magnetic = (this.state.stats.triggers.magnetic ?? 0) + 1;
        this.emit({ type: 'MAGNETIC_ATTRACTION', enhancement: 'magnetic', dieIds: [die.id, ...anchors], face: face.rank,
          message: `Held Magnetic anchor attracted D${die.id + 1} to face ${face.rank}` });
      }
      if (result.weighted) {
        const source = weightedSourceFace(die, result.physicalFace)!;
        const weightedStacks = stacks(source, 'weighted');
        triggers.push({ dieId: die.id, face, enhancement: 'weighted', weightedSourceFace: source.rank, weightedStacks, rollWeight: 1 + weightedStacks });
      }
      if (context === 'gameplay' && stacks(face, 'jumpingBean')) triggers.push({ dieId: die.id, face, enhancement: 'jumpingBean' });
    }
    if (attracted.length) this.applyFluxCapacitor(attracted.length, attracted.map(result => result.dieId));
    if (context === 'gameplay') this.queue.push(...triggers);
    else for (const item of triggers) this.trigger('weighted', item.dieId, item.face, `source face ${item.weightedSourceFace} ×${this.format(item.weightedStacks ?? 0)}; destination weight ${this.format(item.rollWeight ?? 0)}`);
  }
  drain(): void {
    let cursor = 0;
    while (cursor < this.queue.length) {
      const item = this.queue[cursor++];
      this.trigger(item.enhancement, item.dieId, item.face, item.enhancement === 'weighted'
        ? `source face ${item.weightedSourceFace} ×${this.format(item.weightedStacks ?? 0)}; destination weight ${this.format(item.rollWeight ?? 0)}` : '');
      if (item.enhancement === 'jumpingBean') {
        const hand = UPPER_HAND_BY_FACE[item.face.rank];
        if (!hand) continue;
        const outcome = this.play(hand, [item.dieId], 'jumpingBean');
        const record = outcome.beanRecordIndex === null ? null : this.state.stats.jumpingBeanFreePlays[outcome.beanRecordIndex];
        if (outcome.winning) {
          this.emit({ type: 'JUMPING_BEAN_FOLLOWUP', enhancement: 'jumpingBean', hand, dieIds: [item.dieId], playSource: 'jumpingBean',
            message: 'Jumping Bean follow-up reroll skipped because the free play cleared the round.' });
          this.queue = [];
          return;
        }
        const sticky = stacks(item.face, 'sticky');
        if (sticky && this.checkProbability('sticky', sticky, [item.dieId])) {
          if (record) record.stickyPreventedReroll = true;
          this.trigger('sticky', item.dieId, item.face, `×${sticky} prevented Jumping Bean reroll`);
          this.emit({ type: 'JUMPING_BEAN_FOLLOWUP', enhancement: 'jumpingBean', hand, dieIds: [item.dieId], playSource: 'jumpingBean',
            message: `Sticky prevented D${item.dieId + 1}'s Jumping Bean follow-up reroll.` });
        } else {
          if (record) record.followupRerolled = true;
          this.emit({ type: 'JUMPING_BEAN_FOLLOWUP', enhancement: 'jumpingBean', hand, dieIds: [item.dieId], playSource: 'jumpingBean',
            message: `D${item.dieId + 1} begins its Jumping Bean follow-up reroll.` });
          this.rollBatch([item.dieId], 'Jumping Bean reroll', 'gameplay');
        }
      }
    }
    this.queue = [];
  }

  private resolvePersonalTrainer(hand: HandId, scoringParticipants: { id: number; face: Face }[]): boolean | null {
    let attempts = 0;
    let successes = 0;
    for (const { id, face } of scoringParticipants) {
      const count = stacks(face, 'personalTrainer');
      if (!count) continue;
      attempts++;
      this.state.stats.personalTrainerAttempts++;
      const chance = personalTrainerChance(count, this.state.handLevels[hand], Object.values(this.state.handLevels));
      if (!this.checkProbability('personalTrainer', count, [id], hand, chance)) continue;
      const before = this.state.handLevels[hand]++;
      successes++;
      this.state.stats.personalTrainerSuccesses++;
      this.state.stats.personalTrainerLevelsGranted++;
      this.trigger('personalTrainer', id, face, `${HANDS[hand].name} Lv. ${this.format(before)} → ${this.format(this.state.handLevels[hand])}`, { hand });
    }
    return attempts === 0 ? null : successes > 0;
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
    let candidates = CALLER_HAND_POOL.filter(hand => !this.state.consumed.includes(hand));
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
    const after = Math.round(before / 2);
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
    let candidates = LOWER_HAND_IDS.filter(hand => !this.state.consumed.includes(hand));
    if (candidates.length > 1) candidates = candidates.filter(hand => hand !== previous);
    if (!candidates.length) { boss.flyHand = null; return; }
    boss.flyHand = candidates[randomIndex(this.rng, candidates.length)];
    boss.moves++;
    this.emit({ type: 'BOSS_HAND_CHANGED', boss: 'fly', hand: boss.flyHand,
      message: `The Fly moved from ${HANDS[previous].name} to ${HANDS[boss.flyHand].name}` });
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
        message: `D${die.id + 1} physical face ${physicalFace} became Snake-Eyed (1)` });
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
      boss.unlockCosts = wardenUnlockCosts(this.state.handLevels, this.state.consumed, this.state.target);
    }
    boss.nextUnlockTarget = boss.activeDieIds.length < CONFIG.diceCount
      ? boss.unlockCosts.slice(0, boss.activeDieIds.length).reduce((sum, cost) => sum + cost, 0)
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
    const freeBean = playSource === 'jumpingBean';
    const consumesHand = !freeBean && (this.state.bossSilenced || this.state.boss?.type !== 'marathon');
    const ids = [...dieIds].sort((a, b) => a - b);
    const handLevel = this.state.handLevels[hand];
    const handStart = captureHandStart(this.state, hand, ids, playSource === 'manual' ? decisionMs : null);
    if (freeBean) handStart.chargeArmed = false;
    const shapeParticipants = ids.map(id => ({ id, face: structuredClone(activeFace(this.state.dice.find(die => die.id === id)!)), role: 'selected' as const }));
    if (freeBean) this.emit({ type: 'JUMPING_BEAN_FREE_PLAY', enhancement: 'jumpingBean', hand, dieIds: ids,
      face: shapeParticipants[0].face.rank, playSource, handConsumed: false,
      message: `Jumping Bean free-play: ${HANDS[hand].name}; scoring dice: D${ids[0] + 1}; normal hand availability unchanged` });
    this.handAccumulator = createHandAccumulator(hand, ids, handLevel);
    this.emit({ type: 'HAND_STARTED', hand, dieIds: ids, playSource, handConsumed: consumesHand,
      message: `${freeBean ? 'Free-played' : 'Played'} ${HANDS[hand].name} Lv. ${this.format(handLevel)}` });
    const round = this.state.stats.rounds.at(-1)!;
    round.lastHand = hand; round.lastAction = freeBean ? 'JUMPING_BEAN' : 'PLAY';
    const hitchhikers: { id: number; face: Face; role: 'hitchhiker' }[] = [];
    for (const die of freeBean ? [] : [...activeEncounterDice(this.state)].sort((a, b) => a.id - b.id)) {
      if (ids.includes(die.id)) continue;
      const face = structuredClone(activeFace(die));
      const count = stacks(face, 'hitchhiker');
      if (!count || !this.checkProbability('hitchhiker', count, [die.id], hand)) continue;
      hitchhikers.push({ id: die.id, face, role: 'hitchhiker' });
      this.trigger('hitchhiker', die.id, face, `×${this.format(count)} joined ${HANDS[hand].name}`, { hand });
    }
    const scoringParticipants = [...shapeParticipants, ...hitchhikers].sort((a, b) => a.id - b.id);
    const scoringIds = scoringParticipants.map(item => item.id);
    const contributions = handContributions(this.state.dice, ids, hitchhikers.map(item => item.id));
    for (const { id, face } of shapeParticipants) {
      const wild: Enhancement | null = hand === 'smallStraight' || hand === 'largeStraight' ? 'missingLink' : HANDS[hand].rank ? null : 'mirror';
      if (wild && stacks(face, wild)) this.trigger(wild, id, face, 'wild qualification; actual printed pips score');
    }
    for (const contribution of contributions) {
      const { dieId, face, kind, role, amount } = contribution;
      if (kind !== 'base') this.trigger(kind, dieId, face, `+${this.format(amount)} hand pips`, { hand });
      applyHandContribution(this.handAccumulator, contribution);
      this.emit({ type: role === 'hitchhiker' ? 'HITCHHIKER_ADDED_PIPS' : 'HAND_PIPS_CHANGED',
        hand, dieIds: [dieId], face: face.rank, amount, enhancement: kind === 'base' ? undefined : kind, source: freeBean ? 'jumpingBean' : 'hand', playSource,
        pips: this.handAccumulator.currentPips, multiplier: this.handAccumulator.currentMultiplier,
        message: `D${dieId + 1}${role === 'hitchhiker' ? ' Hitchhiker' : ''} added ${this.format(amount)} Pips` });
    }
    for (const { id, face, role } of scoringParticipants) this.whenScored(id, face, hand, playSource, role === 'hitchhiker' ? 'hitchhiker' : 'selected');
    const xMultFactors = handXMultContributions(handStart, hand, handLevel, scoringIds);
    for (const factor of xMultFactors) {
      if (factor.source === 'speedDemon') this.emit({ type: 'SPEED_DEMON_REVEALED', flame: 'speedDemon', hand,
        dieIds: factor.dieId === null ? undefined : [factor.dieId], xMult: factor.value, xMultFactor: factor,
        decisionMs: handStart.speedDemonDecisionMs ?? undefined,
        message: `Speed Demon ×${this.format(factor.value)}` });
      const beforeXMult = this.handAccumulator.currentXMult;
      applyXMult(this.handAccumulator, factor);
      if (factor.source === 'moneyToBurn') this.state.stats.moneyToBurnMultipliers.push(factor.value);
      if (factor.source === 'lowball' && factor.input !== undefined) this.state.stats.lowballAverages.push(factor.input);
      if (factor.source !== 'charge') this.triggerFlame(factor.source, factor.dieId, `factor ×${this.format(factor.value)}`, hand, factor.value);
      this.emit({ type: 'HAND_XMULT_CHANGED', flame: factor.source === 'charge' ? undefined : factor.source, hand,
        dieIds: factor.dieId === null ? undefined : [factor.dieId], xMult: this.handAccumulator.currentXMult, xMultFactor: factor,
        message: `${factor.source === 'charge' ? 'Charge' : FLAMES[factor.source].name}: XMult ×${this.format(beforeXMult)} × factor ×${this.format(factor.value)} = ×${this.format(this.handAccumulator.currentXMult)}` });
    }
    this.advanceHandFamilyFlames(hand, xMultFactors);
    const bossFactor = this.flyFactor(hand, playSource);
    const { pips, multiplier, xMult, rawScore, score } = finalizeHandScore(this.handAccumulator, bossFactor);
    this.state.stats.handScores.push({ round: this.state.round, hand, handLevel, dieIds: scoringIds,
      basePips: this.handAccumulator.basePips, baseMultiplier: this.handAccumulator.baseMultiplier,
      pips, multiplier, xMult, bossFactor, xMultFactors: structuredClone(this.handAccumulator.xMultFactors), rawScore, score,
      bonusPips: this.handAccumulator.bonusPips, hitchhikerPips: this.handAccumulator.hitchhikerPips,
      playSource, consumedHand: consumesHand });
    this.state.stats.handBonusPips += this.handAccumulator.bonusPips;
    this.state.stats.hitchhikerPipsContributed += this.handAccumulator.hitchhikerPips;
    this.log({ type: 'SCORE_ROUNDING_AUDIT', hand, dieIds: scoringIds, pips, multiplier, xMult, rawScore, amount: score, source: freeBean ? 'jumpingBean' : 'hand', playSource,
      message: `Final: ${this.format(pips)} × ${this.format(multiplier)} × ${this.format(xMult)}${bossFactor !== 1 ? ` × boss ${this.format(bossFactor)}` : ''} = ${this.format(rawScore)}; rounded ${this.format(score)}` });
    this.emit({ type: 'HAND_SCORE_FINALIZED', hand, dieIds: scoringIds, pips, multiplier, xMult, rawScore, amount: score,
      source: freeBean ? 'jumpingBean' : 'hand', playSource, handConsumed: consumesHand, message: `Final awarded hand score: ${this.format(score)}` });
    this.addScore(score, freeBean ? 'jumpingBean' : 'hand', `${freeBean ? 'Jumping Bean free-play: ' : ''}${HANDS[hand].name}: round score +${this.format(score)}`, scoringIds, hand);
    if (!freeBean && handStart.chargeArmed) {
      const consumed = this.state.chargeXMult;
      this.state.chargeXMult = 1; this.state.chargeArmed = false;
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
    if (!freeBean) this.advanceHotStreak(hand, scoringIds);
    const personalTrainerSucceeded = this.resolvePersonalTrainer(hand, scoringParticipants);
    this.state.handPlayCounts[hand]++;
    this.state.stats.handsPlayed[hand] = (this.state.stats.handsPlayed[hand] ?? 0) + 1;
    this.log({ type: 'ABILITY_EVALUATED', enhancement: freeBean ? 'jumpingBean' : undefined, hand, dieIds: scoringIds, playSource,
      message: `${HANDS[hand].name} hand history incremented: ${this.format(handStart.previousPlays)} → ${this.format(this.state.handPlayCounts[hand])}` });
    this.handAccumulator = null;
    if (consumesHand) {
      this.state.consumed.push(hand);
      this.emit({ type: 'HAND_CONSUMED', hand, playSource, handConsumed: true, message: `${HANDS[hand].name} consumed for round ${this.format(this.state.round)}` });
    }
    this.advanceMarathon(hand, playSource);
    this.resolveQuickdraw(hand, playSource);
    this.resolveCallerCall(hand, playSource);
    this.resolveSnakeEyes(scoringIds);
    this.resolveInfected(scoringIds);
    this.moveFly();
    const winning = this.state.score >= this.state.target;
    let jackpotPayout = 0;
    if (winning) {
      jackpotPayout = this.resolveJackpot(scoringIds);
      this.emit({ type: 'POST_HAND_REROLLS_SKIPPED', hand, playSource, message: 'Post-hand rerolls skipped because the target was reached.' });
    }
    const beanRecordIndex = freeBean ? this.state.stats.jumpingBeanFreePlays.push({
      round: this.state.round, dieId: ids[0], face: shapeParticipants[0].face.rank, hand, handLevel,
      basePips: this.state.stats.handScores.at(-1)!.basePips, baseMultiplier: this.state.stats.handScores.at(-1)!.baseMultiplier,
      score, xMultFactors: structuredClone(this.state.stats.handScores.at(-1)!.xMultFactors),
      previousPlayCount: handStart.previousPlays, handPlayCountAfter: this.state.handPlayCounts[hand], consumedHand: false,
      stickyPreventedReroll: false, followupRerolled: false, roundCleared: winning, jackpotPayout, personalTrainerSucceeded,
    }) - 1 : null;
    if (winning) {
      if (!freeBean) this.evaluate();
      return { winning, beanRecordIndex };
    }
    if (freeBean) return { winning, beanRecordIndex };
    const rerolls = new Set<number>();
    for (const { id, face } of shapeParticipants) {
      const sticky = stacks(face, 'sticky');
      if (sticky && this.checkProbability('sticky', sticky, [id])) this.trigger('sticky', id, face, `×${this.format(sticky)} stayed after scoring`);
      else rerolls.add(id);
    }
    for (const die of activeEncounterDice(this.state)) if (stacks(activeFace(die), 'slippy')) { this.trigger('slippy', die.id, activeFace(die), 'joined post-hand reroll'); rerolls.add(die.id); }
    this.rollBatch([...rerolls], 'Post-hand reroll', 'gameplay');
    this.drain();
    this.evaluate();
    if (this.state.phase === 'round') this.state.decisionId++;
    return { winning: this.state.score >= this.state.target, beanRecordIndex: null };
  }

  manualReroll(dieIds: number[]): void {
    const ids = [...dieIds].sort((a, b) => a - b);
    const requiredDieIds = requiredEncounterDieIds(this.state);
    const startedDeadBoard = !hasPlayableHand(activeEncounterDice(this.state), unavailableEncounterHands(this.state), requiredDieIds);
    const normalSpent = Math.min(this.state.manualRerollsRemaining, ids.length);
    this.state.manualRerollsRemaining -= normalSpent;
    this.state.specialOfferEffects.carePackageRerolls -= ids.length - normalSpent;
    const round = this.state.stats.rounds.at(-1)!;
    round.lastAction = 'MANUAL_REROLL'; round.manualRerollChargesSpent += ids.length; round.manualRerollActions++;
    this.state.stats.manualRerollActions++; this.state.stats.manualDiceRerolled += ids.length;
    const record = { round: this.state.round, dieIds: ids, charges: ids.length, remaining: this.state.manualRerollsRemaining, startedDeadBoard, rescuedDeadBoard: false };
    this.state.stats.manualRerolls.push(record);
    const totalRemaining = this.state.manualRerollsRemaining + this.state.specialOfferEffects.carePackageRerolls;
    this.emit({ type: 'MANUAL_REROLL_STARTED', dieIds: ids, amount: ids.length, message: `Manual reroll; ${this.format(totalRemaining)} remaining` });
    if (this.state.chargeArmed && !hasChargeBonfire(this.state)) {
      this.state.chargeArmed = false;
      this.emit({ type: 'CHARGE_ARMED', xMult: this.state.chargeXMult,
        message: 'Charge disarmed because its intended hand selection was cleared.' });
    }
    const jumpStart = this.chargeFlameSource('jumpStart');
    if (jumpStart) for (const dieId of ids) this.growCharge('jumpStart', jumpStartChargeGain(jumpStart.investment),
      `1 Reroll spent on D${dieId + 1}`, [dieId]);
    this.rollBatch(ids, 'Manual gameplay reroll', 'gameplay', true);
    this.drain();
    if (startedDeadBoard && (this.state.score >= this.state.target || hasPlayableHand(activeEncounterDice(this.state), unavailableEncounterHands(this.state), requiredDieIds))) {
      record.rescuedDeadBoard = true; round.deadBoardRescues++; this.state.stats.deadBoardRescues++;
      this.emit({ type: 'DEAD_BOARD_RESCUED', dieIds: ids, message: 'Dead board rescued' });
    }
    this.evaluate();
    if (this.state.phase === 'round') this.state.decisionId++;
  }
  private captureRoundCheckpoint(): void {
    const clone = structuredClone(this.state);
    const { roundCheckpoint: _checkpoint, badDreamCheckpoint: _badDream, ...base } = clone;
    // The checkpoint is a round-ready gameplay baseline plus the exact Shop
    // session that launched it. Bust restoration reopens this Shop without
    // generating offers, reroll allowances, exposed faces, or rewards.
    base.phase = 'shop';
    base.shop ??= { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0,
      freeEnhancementOfferIds: [], freeTrainingOfferKeys: [] };
    if (base.bossSilenced) base.specialOfferEffects.silence = true;
    base.bossSilenced = false;
    base.flameSelection = null;
    base.specialOffer = null;
    base.roundSummary = null;
    base.bust = null;
    base.boss = null;
    base.dice = base.dice.filter(die => die.owner === 'player');
    // History snapshots and the action audit are retained across Bust separately;
    // omitting them here keeps the checkpoint compact without weakening rollback.
    base.history = [];
    base.stats.actions = [];
    this.state.roundCheckpoint = base as GameStateBase;
  }
  private resolveBust(): void {
    const checkpoint = this.state.roundCheckpoint;
    if (!checkpoint) throw new Error('Bust occurred without a round-start checkpoint.');
    const current = this.state.stats.rounds.at(-1)!;
    const failure = {
      round: this.state.round, attempt: this.state.roundAttemptNumber, score: this.state.score, target: this.state.target,
      shortfall: Math.max(0, this.state.target - this.state.score), livesBefore: this.state.lives,
      livesAfter: Math.max(0, this.state.lives - 1),
    };
    const failureValues = this.state.dice.map(die => activeFace(die).rank);
    const failureConsumed = [...this.state.consumed];
    const failureLastHand = current.lastHand;
    const failureLastAction = current.lastAction;
    const failedBoss = structuredClone(this.state.boss);
    const failedNodeId = this.state.currentNodeId;
    const bottledFairyAlreadyTriggered = this.state.specialOfferEffects.bottledFairyTriggeredThisRound;
    const badDreamCheckpoint = this.state.badDreamCheckpoint;
    if (failure.livesAfter === 0 && this.state.specialOfferEffects.badDreamRounds > 0 && badDreamCheckpoint) {
      Object.assign(this.state, structuredClone(badDreamCheckpoint));
      this.state.roundCheckpoint = null;
      this.state.badDreamCheckpoint = null;
      this.state.specialOfferEffects.badDreamRounds = 0;
      this.state.lives = 1;
      this.rngStateAfterResolution = this.state.rngState;
      this.state.bust = null;
      this.emit({ type: 'SPECIAL_EFFECT_TRIGGERED', message: 'Bad Dream returned the run to its checkpoint with 1 Life' });
      return;
    }
    const progressionTelemetry = {
      mapTransitions: structuredClone(this.state.stats.mapTransitions),
      bossEncounters: structuredClone(this.state.stats.bossEncounters),
      callerEvents: structuredClone(this.state.stats.callerEvents),
      wardenEvents: structuredClone(this.state.stats.wardenEvents),
      hexerEvents: structuredClone(this.state.stats.hexerEvents),
    };
    const history = this.state.history;
    const actions = this.state.stats.actions;
    Object.assign(this.state, structuredClone(checkpoint));
    this.state.specialOfferEffects.bottledFairyTriggeredThisRound ||= bottledFairyAlreadyTriggered;
    this.state.roundCheckpoint = structuredClone(checkpoint);
    this.state.shop ??= { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0,
      freeEnhancementOfferIds: [], freeTrainingOfferKeys: [] };
    this.state.shop.lifeRestores ??= 0;
    this.state.history = history;
    this.state.stats.actions = actions;
    Object.assign(this.state.stats, progressionTelemetry);
    this.state.lives = failure.livesAfter;
    this.state.roundAttemptNumber = failure.livesAfter > 0 ? failure.attempt + 1 : failure.attempt;
    this.state.bust = failure;
    this.state.stats.busts.push({ ...failure, checkpointRestored: true, returnedToShop: failure.livesAfter > 0,
      retryStarted: false, runEndedNoLives: failure.livesAfter === 0 });
    this.state.phase = failure.livesAfter > 0 ? 'bust' : 'lost';
    if (failure.livesAfter === 0) { this.state.shop = null; this.state.roundCheckpoint = null; }
    this.emit({ type: 'ROUND_BUST', amount: failure.shortfall,
      message: `BUST · Round ${this.format(failure.round)} attempt ${this.format(failure.attempt)} · ${this.format(failure.score)} / ${this.format(failure.target)} · ${this.format(failure.shortfall)} short · lives ${this.format(failure.livesBefore)} → ${this.format(failure.livesAfter)}` });
    if (failure.livesAfter > 0) {
      this.state.phase = 'shop';
      this.state.currentNodeId = failedNodeId;
      this.mapTransition(shopNodeBefore(failure.round), 'backward');
      this.emit({ type: 'SHOP_REOPENED_AFTER_BUST',
        message: `Round ${this.format(failure.round)} attempt ${this.format(failure.attempt)} checkpoint restored · returned to the same Shop · prepare for attempt ${this.format(failure.attempt + 1)}` });
    } else {
      this.state.stats.loss = { round: failure.round, afterHand: failureLastHand, score: failure.score, afterAction: failureLastAction,
        manualRerollsRemaining: 0, values: failureValues, consumed: failureConsumed };
      this.emit({ type: 'RUN_LOST', message: `Run Over: ${this.format(failure.score)} / ${this.format(failure.target)}; no Lives remain` });
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
  startRound(retry = false): void {
    if (retry) {
      const priorBust = this.state.stats.busts.at(-1);
      if (priorBust?.round === this.state.round && !priorBust.retryStarted) priorBust.retryStarted = true;
    }
    if (this.state.chargeXMult !== 1 || this.state.chargeArmed) this.state.stats.chargeResets++;
    this.state.phase = 'round'; this.state.score = 0; this.state.scoreByHand = {}; this.state.effectScore = 0;
    if (!retry) this.state.specialOfferEffects.bottledFairyTriggeredThisRound = false;
    this.state.manualRerollsRemaining = CONFIG.manualRerollsPerRound; this.state.target = targetForRound(this.state.round);
    this.state.consumed = []; this.state.targetPracticeHand = null; this.state.lastRoundPayout = null; this.state.roundSummary = null;
    this.state.chargeXMult = 1; this.state.chargeArmed = false; this.state.hotStreakCharges = 0;
    const sixPackInvestment = this.state.bonfires.includes('sixPack') ? 100
      : activeFlameInvestment(this.state.dice.find(die => activeFlameId(die.flame) === 'sixPack')?.flame ?? null);
    this.state.sixPackXMult = sixPackStartingMultiplier(sixPackInvestment);
    this.state.sixPackUpperHandsPlayed = 0;
    this.state.hotStreakGoal = ownedFlameIds(this.state).has('hotStreak') ? 'pair' : null;
    this.state.handFamilyFlameStages = initialHandFamilyFlameStages(this.state);
    this.state.flameSelection = null; this.state.specialOffer = null; this.state.bust = null; this.state.stats.roundReached = this.state.round;
    this.state.dice = this.state.dice.filter(die => die.owner === 'player');
    for (const die of this.state.dice) for (const face of die.faces) delete face.magneticSourceUsed;
    const bossType = this.state.bossSchedule[this.state.round]
      ?? (this.state.round > 60 ? bossTypeForRound(this.state.seed, this.state.round) : null);
    if (bossType) this.state.bossSchedule[this.state.round] = bossType;
    if (bossType) this.state.target = targetForBoss(bossType, this.state.target);
    this.state.boss = bossType ? createBossRuntime(this.state.seed, this.state.round, bossType) : null;
    this.state.bossSilenced = !!this.state.boss && this.state.specialOfferEffects.silence;
    if (this.state.bossSilenced) this.state.specialOfferEffects.silence = false;
    if (!this.state.bossSilenced && this.state.boss?.type === 'warden') {
      this.state.boss.unlockCosts = wardenUnlockCosts(this.state.handLevels, [], this.state.target);
    }
    this.captureRoundCheckpoint();
    this.state.shop = null;
    this.mapTransition(encounterNode(this.state.round, bossType));
    this.state.stats.rounds.push({ round: this.state.round, attempt: this.state.roundAttemptNumber, target: this.state.target, firstCrossedScore: null,
      finalScore: 0, clearMargin: null, cleared: false, lastHand: null, lastAction: null,
      manualRerollsGranted: CONFIG.manualRerollsPerRound, manualRerollChargesSpent: 0,
      manualRerollsRemainingAtClear: null, manualRerollActions: 0, deadBoardRescues: 0, scoreByHand: {}, effectScore: 0,
      goldBefore: this.state.gold, goldBySourceBefore: structuredClone(this.state.stats.goldBySource), payout: null });
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
    }
    if (!this.state.boss) this.emit({ type: retry ? 'ROUND_RETRY_STARTED' : 'ROUND_STARTED',
      message: `Round ${this.format(this.state.round)} — Attempt ${this.format(this.state.roundAttemptNumber)} — goal ${this.format(this.state.target)}; Charge reset to ×1` });
    this.selectTargetPractice();
    if (!this.state.bossSilenced && this.state.boss?.type === 'hexer') this.state.dice.push(createCursedDie());
    if (!this.state.bossSilenced && this.state.boss?.type === 'warden') {
      const playerDice = this.state.dice.filter(die => die.owner === 'player').sort((a, b) => a.id - b.id);
      if (!playerDice.length) throw new Error('The Warden requires at least one player die.');
      this.rollBatch(playerDice.map(die => die.id), 'Warden opening roll', 'wardenSetup');
    } else this.rollBatch(activeEncounterDice(this.state).map(die => die.id), 'Initial round roll', 'gameplay');
    this.drain(); this.evaluate();
    if (this.state.phase === 'round') this.state.decisionId++;
  }
  freshOffers(): void {
    const pool = [...ENHANCEMENT_IDS];
    this.state.shop!.offers = Array.from({ length: Math.min(3, pool.length) }, () => {
      const [enhancement] = pool.splice(randomIndex(this.rng, pool.length), 1);
      return { id: this.state.nextOfferId++, enhancement, purchased: false };
    });
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
    const pool = FLAME_IDS.filter(id => !owned.has(id));
    this.state.flameSelection!.offers = Array.from({ length: Math.min(3, pool.length) }, () => {
      const [flame] = pool.splice(randomIndex(this.rng, pool.length), 1); return { id: this.state.nextOfferId++, flame };
    });
  }
  freshSpecialOffers(): void {
    const pool = eligibleSpecialOfferTypes(this.state);
    this.state.specialOffer!.offers = Array.from({ length: Math.min(3, pool.length) }, () => {
      const [type] = pool.splice(randomIndex(this.rng, pool.length), 1);
      const offer: SpecialOffer = { id: this.state.nextOfferId++, type };
      if (type === 'focus') offer.hand = HAND_IDS[randomIndex(this.rng, HAND_IDS.length)];
      return offer;
    });
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
    this.state.stats.targetPracticeTargets.push({ round: this.state.round, hand: this.state.targetPracticeHand });
    this.emit({ type: 'TARGET_PRACTICE_SELECTED', flame: 'targetPractice', hand: this.state.targetPracticeHand,
      message: `Target Practice: ${HANDS[this.state.targetPracticeHand].name}` });
  }
  openShop(rollDice = true, direction: 'forward' | 'backward' = 'forward'): void {
    cleanupTemporaryBossFaces(this.state.dice);
    this.state.dice = this.state.dice.filter(die => die.owner === 'player');
    this.state.boss = null; this.state.bossSilenced = false;
    this.state.phase = 'shop'; this.state.flameSelection = null; this.state.specialOffer = null; this.state.roundSummary = null;
    this.state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0,
      freeEnhancementOfferIds: [], freeTrainingOfferKeys: [] };
    const upcomingBoss = this.state.round + 1 > 60 ? bossTypeForRound(this.state.seed, this.state.round + 1) : null;
    if (upcomingBoss) this.state.bossSchedule[this.state.round + 1] = upcomingBoss;
    this.mapTransition(shopNodeBefore(this.state.round + 1), direction);
    if (rollDice) this.rollBatch(this.state.dice.map(die => die.id), 'Free shop roll', 'shop');
    this.freshOffers(); this.freshTrainingOffers();
    if (this.state.specialOfferEffects.onTheHouse) {
      this.state.shop.freeEnhancementOfferIds = this.state.shop.offers.map(offer => offer.id);
      this.state.shop.freeTrainingOfferKeys = this.state.shop.trainingOffers.map(trainingOfferKey);
      this.state.specialOfferEffects.onTheHouse = false;
      this.emit({ type: 'SPECIAL_EFFECT_TRIGGERED', message: 'On The House made this Shop’s initial displayed purchases free' });
    }
    this.emit({ type: 'SHOP_OPENED', message: `Shop opened${rollDice ? '' : '; Flame Selection faces preserved'}` });
  }
  openFlameSelection(): void {
    cleanupTemporaryBossFaces(this.state.dice);
    this.state.dice = this.state.dice.filter(die => die.owner === 'player');
    this.state.boss = null; this.state.bossSilenced = false;
    this.state.phase = 'flameSelection'; this.state.shop = null; this.state.specialOffer = null; this.state.roundSummary = null;
    this.state.flameSelection = { offers: [], acquired: false };
    this.mapTransition(flameNodeAfter(this.state.round));
    this.rollBatch(this.state.dice.map(die => die.id), 'Flame Selection roll', 'flameSelection');
    this.freshFlameOffers();
    this.emit({ type: 'FLAME_SELECTION_OPENED', message: 'Flame Selection — choose and assign one new Flame, or skip' });
  }
  openSpecialOffer(): void {
    cleanupTemporaryBossFaces(this.state.dice);
    this.state.dice = this.state.dice.filter(die => die.owner === 'player');
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
        const repeatedBossRound = this.state.round;
        if (!this.state.suppressedPostBossRewardRounds.includes(repeatedBossRound))
          this.state.suppressedPostBossRewardRounds.push(repeatedBossRound);
        timeTravelDestination = Math.max(0, this.state.round - 3);
        break;
      }
      case 'carePackage': this.state.specialOfferEffects.carePackageRerolls += 3; break;
      case 'silence': this.state.specialOfferEffects.silence = true; break;
      case 'sommelier':
        for (const die of this.state.dice.filter(item => item.owner === 'player')) for (const face of die.faces)
          if (stacks(face, 'vintage')) face.vintageSellValue = Math.max(0, face.vintageSellValue ?? 0) * 2;
        break;
      case 'taxEvasion': this.state.specialOfferEffects.taxEvasionRounds += 3; break;
      case 'fireKeeper': {
        const embers = this.state.dice.filter(die => die.owner === 'player' && die.flame && die.flame.investedGold < 100);
        const die = embers[randomIndex(this.rng, embers.length)];
        const flame = die.flame!;
        const from = flame.investedGold;
        flame.investedGold = from + Math.ceil((100 - from) / 2);
        this.emit({ type: 'FLAME_INVESTED', flame: flame.id, dieIds: [die.id], amount: flame.investedGold - from,
          message: `Fire Keeper stoked ${FLAMES[flame.id].name}: ${this.format(from)} → ${this.format(flame.investedGold)} / 100` });
        if (flame.investedGold === 100) {
          const id = flame.id;
          die.flame = null;
          if (!this.state.bonfires.includes(id)) this.state.bonfires.push(id);
          this.state.stats.bonfiresCreated.push({ round: this.state.round, flame: id });
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
    }
    this.emit({ type: 'SPECIAL_OFFER_SELECTED', hand: offer.hand,
      message: `${specialOfferName(offer)} — ${specialOfferDescription(offer)}` });
    if (timeTravelDestination !== null) this.state.round = timeTravelDestination;
    if (captureBadDream) {
      const clone = structuredClone(this.state);
      const { roundCheckpoint: _round, badDreamCheckpoint: _dream, ...base } = clone;
      this.state.badDreamCheckpoint = base as GameStateBase;
    }
  }
  continueSpecialOffer(): void {
    const timeTravel = this.state.specialOffer?.chosen?.type === 'timeTravel';
    this.openShop(false, timeTravel ? 'backward' : 'forward');
  }
  continueRoundSummary(): void {
    const summary = this.state.roundSummary;
    if (!summary) throw new Error('Round Summary is not available.');
    if (summary.encounterType === 'boss') {
      const suppressed = this.state.suppressedPostBossRewardRounds.includes(summary.round);
      if (suppressed) {
        this.state.suppressedPostBossRewardRounds = this.state.suppressedPostBossRewardRounds.filter(round => round !== summary.round);
        this.openShop();
      } else if (postBossRewardForRound(summary.round) === 'flame') this.openFlameSelection();
      else this.openSpecialOffer();
    }
    else this.openShop();
  }
  private completeSpecialOfferRound(): void {
    const effects = this.state.specialOfferEffects;
    for (const key of ['taxEvasionRounds', 'cashBonusRounds', 'powerballRounds', 'bottledFairyRounds', 'badDreamRounds'] as const)
      if (effects[key] > 0) effects[key]--;
    if (effects.powerballRounds === 0) effects.powerballAvailable = false;
    if (effects.badDreamRounds === 0) this.state.badDreamCheckpoint = null;
  }
  evaluate(): void {
    const current = this.state.stats.rounds.at(-1)!;
    current.finalScore = this.state.score;
    if (this.state.score >= this.state.target) {
      current.cleared = true; current.clearMargin = this.state.score - this.state.target;
      current.manualRerollsRemainingAtClear = this.state.manualRerollsRemaining;
      if (this.state.boss) {
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
      const heldGoldSnapshot = this.state.gold;
      const payout = { baseGold: roundReward(), unusedRerollGold: this.state.manualRerollsRemaining,
        interestGold: interestForGold(heldGoldSnapshot) * (this.state.specialOfferEffects.taxEvasionRounds > 0 ? 2 : 1),
        bossRewardGold: bossType ? bossRewardForRound(this.state.round) : 0, heldGoldSnapshot, totalRoundRewardGold: 0 };
      payout.totalRoundRewardGold = payout.baseGold + payout.unusedRerollGold + payout.interestGold + payout.bossRewardGold;
      current.payout = payout; this.state.lastRoundPayout = payout;
      this.addGold(payout.baseGold, `Round clear base: +${this.format(payout.baseGold)} gold`, 'roundBase');
      if (payout.unusedRerollGold) this.addGold(payout.unusedRerollGold, `Unused rerolls: +${this.format(payout.unusedRerollGold)} gold`, 'unusedRerolls');
      if (payout.interestGold) this.addGold(payout.interestGold, `Interest on ${this.format(heldGoldSnapshot)} held Gold: +${this.format(payout.interestGold)}`, 'interest');
      if (payout.bossRewardGold) this.addGold(payout.bossRewardGold, `Boss Reward: +${this.format(payout.bossRewardGold)} gold`, 'bossReward');
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
      this.state.phase = 'roundSummary';
      this.completeSpecialOfferRound();
      this.state.stats.roundSummaries.push({ ...structuredClone(summary), shown: true });
      this.emit({ type: 'ROUND_SUMMARY_SHOWN', boss: bossType ?? undefined, roundSummary: structuredClone(summary), amount: totalGoldEarned,
        encounterType: summary.encounterType, goldBefore: summary.goldBefore, goldAfter: summary.goldAfter,
        goldEarnedTotal: totalGoldEarned, baseRewardGold: payout.baseGold, unusedRerollGold: payout.unusedRerollGold,
        interestGold: payout.interestGold, bossRewardGold: payout.bossRewardGold, goldenGold, jackpotGold,
        message: `${bossType ? 'Boss defeated' : `Round ${this.format(this.state.round)} cleared`} · Gold ${this.format(summary.goldBefore)} → ${this.format(summary.goldAfter)} (+${this.format(totalGoldEarned)})` });
    } else if (this.state.bossSilenced || this.state.boss?.type !== 'warden' || (this.state.boss.startingDieId !== null && this.state.boss.pendingReinforcements === 0)) {
      if (hasPlayableHand(activeEncounterDice(this.state), unavailableEncounterHands(this.state), requiredEncounterDieIds(this.state))) return;
      const rerolls = this.state.manualRerollsRemaining + this.state.specialOfferEffects.carePackageRerolls;
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
