import { CONFIG, roundReward, targetForRound } from './config';
import { activeFace, oppositeFace, rollDie, scoringPips } from './dice';
import { diminishingHalfChance, ENHANCEMENTS, ENHANCEMENT_IDS, stacks } from './enhancements';
import {
  activeFlameId, activeFlameInvestment, captureHandStart, chargeGainPerRoll, composeXMult,
  FLAMES, FLAME_IDS, handXMultContributions, HOT_STREAK_SEQUENCE, independentXMultFactors,
  ownedFlameIds, trainerChance,
} from './flames';
import { hasPlayableHand, HANDS, HAND_IDS, LOWER_HAND_IDS } from './hands';
import { probabilityCheck, randomIndex } from './rng';
import { applyHandContribution, applyXMult, createHandAccumulator, finalizeHandScore, handContributions, standaloneScore } from './scoring';
import { boardSnapshot } from './telemetry';
import type { Enhancement, EventRecord, Face, Flame, GameEvent, GameState, GoldSource, GoldSpendSource, HandId, HandScoreAccumulator, RandomSource, ScoreSource } from './types';

type RollTrigger = { dieId: number; face: Face; enhancement: 'weighted' | 'jumpingBean'; weightedStacks?: number; rollWeight?: number; weightedSourceFace?: number };
type RollContext = 'gameplay' | 'shop' | 'flameReward';
const NORMAL_SHOP_SPEND = new Set<GoldSpendSource>(['enhancement', 'shopDiceReroll', 'enhancementReroll', 'handTraining']);

// Rules resolve synchronously into immutable snapshots. Playback speed only changes how React reads them.
export class Resolver {
  readonly events: GameEvent[] = [];
  private queue: RollTrigger[] = [];
  private handAccumulator: HandScoreAccumulator | null = null;
  constructor(readonly state: GameState, readonly rng: RandomSource) {}

  format(value: number): string { return Number(value.toFixed(4)).toString(); }
  emit(event: Omit<EventRecord, 'id' | 'round'>): void {
    if (this.events.length >= CONFIG.resolutionEventCap) throw new Error(`Resolution exceeded ${CONFIG.resolutionEventCap} events. Check for an infinite ability chain.`);
    const record = { ...event, ...(this.handAccumulator ? { handScore: structuredClone(this.handAccumulator) } : {}), id: this.state.history.length, round: this.state.round };
    this.state.history.push(record);
    this.events.push({ ...record, board: boardSnapshot(this.state) });
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
  checkProbability(enhancement: 'sticky' | 'hitchhiker', stackCount: number, dieIds: number[], hand?: HandId): boolean {
    const chance = diminishingHalfChance(stackCount);
    const succeeded = probabilityCheck(this.rng, chance);
    const stats = this.state.stats.probabilityProcs[enhancement];
    stats.checks++;
    stats[succeeded ? 'successes' : 'failures']++;
    stats.stacksAtCheck.push(stackCount);
    this.log({ type: 'ABILITY_CHECKED', dieIds, hand, probability: { enhancement, stacks: stackCount, chance, succeeded },
      message: `${dieIds.map(id => `D${id + 1}`).join(', ')} ${ENHANCEMENTS[enhancement].name} ×${stackCount}: ${this.format(chance * 100)}% — ${succeeded ? 'succeeded' : 'failed'}` });
    return succeeded;
  }
  addGold(amount: number, message: string, goldSource: GoldSource, dieId?: number, enhancement?: Enhancement, face?: import('./types').Rank): void {
    this.state.gold += amount;
    this.state.stats.goldEarned += amount;
    this.state.stats.goldBySource[goldSource] += amount;
    this.emit({ type: 'GOLD_ADDED', amount, message, goldSource, enhancement, face, dieIds: dieId === undefined ? undefined : [dieId] });
  }
  spendGold(amount: number, message: string, goldSpendSource: GoldSpendSource): void {
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
  }
  modifiers(dieId: number, face: Face): void {
    if (stacks(face, 'bonus')) this.trigger('bonus', dieId, face, `+${stacks(face, 'bonus') * CONFIG.bonusPips} pips`);
    if (stacks(face, 'multiplier')) this.trigger('multiplier', dieId, face, `+${stacks(face, 'multiplier') * CONFIG.multiplierIncrement} multiplier`);
  }
  whenScored(dieId: number, snapshot: Face): void {
    const golden = stacks(snapshot, 'golden');
    if (golden) {
      this.state.stats.triggers.golden = (this.state.stats.triggers.golden ?? 0) + 1;
      this.addGold(golden * CONFIG.goldenGold, `D${dieId + 1} Golden ×${golden}: +${golden * CONFIG.goldenGold} gold`, 'golden', dieId);
    }
    const workout = stacks(snapshot, 'workout');
    if (workout) {
      this.state.stats.triggers.workout = (this.state.stats.triggers.workout ?? 0) + 1;
      const live = this.state.dice[dieId].faces[snapshot.rank - 1];
      const before = scoringPips(live);
      live.workoutPips += workout * CONFIG.workoutIncrement;
      this.emit({ type: 'WORKOUT_INCREMENTED', enhancement: 'workout', dieIds: [dieId], face: snapshot.rank,
        message: `D${dieId + 1} face ${snapshot.rank} Workout ×${workout}: ${before} → ${scoringPips(live)} future pips` });
    }
  }
  standalone(dieId: number, face: Face): void {
    const source = 'jumpingBean';
    this.modifiers(dieId, face);
    const xMultFactors = independentXMultFactors(this.state, dieId);
    for (const factor of xMultFactors) this.triggerFlame('looseCannon', factor.dieId, `×${this.format(factor.value)} independent XMult`, undefined, factor.value);
    const xMult = composeXMult(xMultFactors);
    const { pips, multiplier, rawScore, score } = standaloneScore(face, xMult);
    this.state.stats.standaloneScores.push({ round: this.state.round, dieId, pips, multiplier, xMult, xMultFactors: structuredClone(xMultFactors), rawScore, score });
    this.log({ type: 'SCORE_ROUNDING_AUDIT', dieIds: [dieId], face: face.rank, pips, multiplier, xMult, rawScore, amount: score, source,
      message: `D${dieId + 1} Jumping Bean: ${this.format(pips)} × ${this.format(multiplier)} × ${this.format(xMult)} = ${this.format(rawScore)}; rounded ${score}` });
    this.emit({ type: 'STANDALONE_SCORE_CALCULATED', dieIds: [dieId], face: face.rank, pips, multiplier, xMult, rawScore, amount: score, source,
      message: `D${dieId + 1} Jumping Bean awarded ${score}` });
    this.addScore(score, source, `D${dieId + 1} Jumping Bean scored ${score}`, [dieId]);
    this.whenScored(dieId, face);
  }

  resolveJackpot(scoringDieIds: number[]): void {
    const scoring = new Set(scoringDieIds);
    let total = 0;
    for (const die of [...this.state.dice].sort((a, b) => a.id - b.id)) {
      const face = activeFace(die);
      const count = stacks(face, 'jackpot');
      if (!count) continue;
      if (scoring.has(die.id)) {
        this.log({ type: 'ABILITY_EVALUATED', enhancement: 'jackpot', dieIds: [die.id], face: face.rank,
          message: `D${die.id + 1} Jackpot did not trigger: die scored in winning hand` });
        continue;
      }
      const payout = count * CONFIG.jackpotGold;
      this.state.stats.triggers.jackpot = (this.state.stats.triggers.jackpot ?? 0) + 1;
      this.addGold(payout, `D${die.id + 1} Jackpot ×${count}: +${payout} gold`, 'jackpot', die.id, 'jackpot', face.rank);
      total += payout;
    }
    if (total) this.log({ type: 'ABILITY_EVALUATED', enhancement: 'jackpot', message: `Total Jackpot payout: +${total} gold` });
  }

  private addChargeForRoll(dieId: number): void {
    let gain = 0;
    let sourceDie: number | null = dieId;
    if (this.state.bonfires.includes('charge')) { gain = 0.5; sourceDie = null; }
    else {
      const flame = this.state.dice[dieId].flame;
      if (activeFlameId(flame) === 'charge') gain = chargeGainPerRoll(activeFlameInvestment(flame));
    }
    if (gain <= 0) return;
    this.state.chargeXMult = Number((this.state.chargeXMult + gain).toFixed(12));
    this.state.stats.chargeGained = Number((this.state.stats.chargeGained + gain).toFixed(12));
    this.triggerFlame('charge', sourceDie, `+${this.format(gain)}; stored ×${this.format(this.state.chargeXMult)}`);
    this.emit({ type: 'CHARGE_CHANGED', flame: 'charge', dieIds: [dieId], xMult: this.state.chargeXMult,
      message: `Charge gained +${this.format(gain)} from D${dieId + 1}; stored ×${this.format(this.state.chargeXMult)}` });
  }
  rollBatch(dieIds: number[], reason: string, context: RollContext): void {
    const ids = [...new Set(dieIds)].sort((a, b) => a - b);
    if (!ids.length) return;
    this.emit({ type: 'DICE_REROLL_STARTED', dieIds: ids, message: `${reason}: ${ids.map(id => `D${id + 1}`).join(', ')}` });
    const rolling = new Set(ids);
    const anchors = context === 'gameplay' ? this.state.dice.filter(die => !rolling.has(die.id) && stacks(activeFace(die), 'magnetic')).map(die => die.id) : [];
    if (anchors.length) {
      this.state.stats.magneticAnchorBatches++;
      this.log({ type: 'ABILITY_EVALUATED', enhancement: 'magnetic', dieIds: anchors, message: `Held Magnetic anchor${anchors.length > 1 ? 's' : ''}: ${anchors.map(id => `D${id + 1}`).join(', ')}` });
    }
    const results = ids.map(dieId => {
      const die = this.state.dice[dieId];
      const before = die.value;
      const bumped = context === 'gameplay' && stacks(activeFace(die), 'bump') > 0;
      if (bumped) return { dieId, before, value: (before === 6 ? 1 : before + 1) as import('./types').Rank, weighted: false, bumped, attracted: false };
      const destinations = anchors.length ? die.faces.filter(face => stacks(face, 'magnetic')) : [];
      if (destinations.length) return { dieId, before, value: destinations[randomIndex(this.rng, destinations.length)].rank, weighted: false, bumped: false, attracted: true };
      return { dieId, before, ...rollDie(die, this.rng), bumped: false, attracted: false };
    });
    const triggers: RollTrigger[] = [];
    for (const result of results) {
      const die = this.state.dice[result.dieId];
      die.value = result.value;
      const face = structuredClone(activeFace(die));
      this.emit({ type: 'DIE_ROLLED', dieIds: [die.id], face: die.value, message: `D${die.id + 1} rolled: ${result.before} → ${die.value}` });
      if (result.bumped) {
        this.state.stats.bumpControlledRolls++;
        this.state.stats.triggers.bump = (this.state.stats.triggers.bump ?? 0) + 1;
        this.emit({ type: 'BUMP_ROLL', enhancement: 'bump', dieIds: [die.id], face: die.value, message: `D${die.id + 1} Bump controlled the roll: ${result.before} → ${die.value}` });
      } else if (result.attracted) {
        this.state.stats.magneticAttractions++;
        this.state.stats.triggers.magnetic = (this.state.stats.triggers.magnetic ?? 0) + 1;
        this.emit({ type: 'MAGNETIC_ATTRACTION', enhancement: 'magnetic', dieIds: [die.id, ...anchors], face: die.value,
          message: `Held Magnetic anchor attracted D${die.id + 1} to face ${die.value}` });
      }
      if (context === 'gameplay') this.addChargeForRoll(die.id);
      if (result.weighted) {
        const weightedSourceFace = oppositeFace(result.value);
        const weightedStacks = stacks(die.faces[weightedSourceFace - 1], 'weighted');
        triggers.push({ dieId: die.id, face, enhancement: 'weighted', weightedSourceFace, weightedStacks, rollWeight: 1 + weightedStacks });
      }
      if (context === 'gameplay' && stacks(face, 'jumpingBean')) triggers.push({ dieId: die.id, face, enhancement: 'jumpingBean' });
    }
    if (context === 'gameplay') this.queue.push(...triggers);
    else for (const item of triggers) this.trigger('weighted', item.dieId, item.face, `source face ${item.weightedSourceFace} ×${item.weightedStacks}; destination weight ${item.rollWeight}`);
  }
  drain(): void {
    let cursor = 0;
    while (cursor < this.queue.length) {
      const item = this.queue[cursor++];
      this.trigger(item.enhancement, item.dieId, item.face, item.enhancement === 'weighted'
        ? `source face ${item.weightedSourceFace} ×${item.weightedStacks}; destination weight ${item.rollWeight}` : '');
      if (item.enhancement === 'jumpingBean') {
        this.standalone(item.dieId, item.face);
        const sticky = stacks(item.face, 'sticky');
        if (sticky && this.checkProbability('sticky', sticky, [item.dieId])) this.trigger('sticky', item.dieId, item.face, `×${sticky} prevented Jumping Bean reroll`);
        else this.rollBatch([item.dieId], 'Jumping Bean reroll', 'gameplay');
      }
    }
    this.queue = [];
  }

  private resolvePersonalTrainer(hand: HandId, scoringIds: number[]): void {
    let chance = 0;
    let dieId: number | null = null;
    if (this.state.bonfires.includes('personalTrainer')) chance = 0.75;
    else {
      const trainer = this.state.dice.find(die => scoringIds.includes(die.id) && activeFlameId(die.flame) === 'personalTrainer');
      if (trainer) { chance = trainerChance(activeFlameInvestment(trainer.flame)); dieId = trainer.id; }
    }
    if (chance <= 0) return;
    this.state.stats.personalTrainerAttempts++;
    const success = probabilityCheck(this.rng, chance);
    this.log({ type: 'ABILITY_CHECKED', flame: 'personalTrainer', dieIds: dieId === null ? undefined : [dieId], hand,
      message: `Personal Trainer ${this.format(chance * 100)}%: ${success ? 'succeeded' : 'failed'}` });
    if (!success) return;
    const before = this.state.handLevels[hand]++;
    this.state.stats.personalTrainerSuccesses++;
    this.state.stats.personalTrainerLevelsGranted++;
    this.triggerFlame('personalTrainer', dieId, `${HANDS[hand].name} Lv. ${before} → ${this.state.handLevels[hand]}`, hand);
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
      message: `Hot Streak ${qualified ? `gained charge ${this.state.hotStreakCharges}` : 'advanced without charge'}; next ${this.state.hotStreakGoal ? HANDS[this.state.hotStreakGoal].name : 'complete'}` });
  }
  play(hand: HandId, dieIds: number[]): void {
    const ids = [...dieIds].sort((a, b) => a - b);
    const handLevel = this.state.handLevels[hand];
    const handStart = captureHandStart(this.state, hand);
    const shapeParticipants = ids.map(id => ({ id, face: structuredClone(activeFace(this.state.dice[id])), role: 'selected' as const }));
    this.handAccumulator = createHandAccumulator(hand, ids, handLevel);
    this.emit({ type: 'HAND_STARTED', hand, dieIds: ids, message: `Played ${HANDS[hand].name} Lv. ${handLevel}` });
    this.state.handPlayCounts[hand]++;
    this.state.stats.handsPlayed[hand] = (this.state.stats.handsPlayed[hand] ?? 0) + 1;
    const round = this.state.stats.rounds.at(-1)!;
    round.lastHand = hand; round.lastAction = 'PLAY';
    const hitchhikers: { id: number; face: Face; role: 'hitchhiker' }[] = [];
    for (const die of [...this.state.dice].sort((a, b) => a.id - b.id)) {
      if (ids.includes(die.id)) continue;
      const face = structuredClone(activeFace(die));
      const count = stacks(face, 'hitchhiker');
      if (!count || !this.checkProbability('hitchhiker', count, [die.id], hand)) continue;
      hitchhikers.push({ id: die.id, face, role: 'hitchhiker' });
      this.trigger('hitchhiker', die.id, face, `×${count} joined ${HANDS[hand].name}`, { hand });
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
      if (kind !== 'base') this.trigger(kind, dieId, face, `+${amount} ${kind === 'multiplier' ? 'hand multiplier' : 'hand pips'}`);
      applyHandContribution(this.handAccumulator, contribution);
      this.emit({ type: kind === 'multiplier' ? 'HAND_MULTIPLIER_CHANGED' : role === 'hitchhiker' ? 'HITCHHIKER_ADDED_PIPS' : 'HAND_PIPS_CHANGED',
        hand, dieIds: [dieId], face: face.rank, amount, enhancement: kind === 'base' ? undefined : kind, source: 'hand',
        pips: this.handAccumulator.currentPips, multiplier: this.handAccumulator.currentMultiplier,
        message: `D${dieId + 1}${role === 'hitchhiker' ? ' Hitchhiker' : ''} added ${amount} ${kind === 'multiplier' ? 'Mult' : 'Pips'}` });
    }
    for (const { id, face } of scoringParticipants) this.whenScored(id, face);
    for (const factor of handXMultContributions(handStart, hand, handLevel, scoringIds)) {
      applyXMult(this.handAccumulator, factor);
      if (factor.source === 'moneyToBurn') this.state.stats.moneyToBurnMultipliers.push(factor.value);
      if (factor.source === 'lowball' && factor.input !== undefined) this.state.stats.lowballAverages.push(factor.input);
      if (factor.source !== 'charge') this.triggerFlame(factor.source, factor.dieId, `×${this.format(factor.value)} XMult`, hand, factor.value);
      this.emit({ type: 'HAND_XMULT_CHANGED', flame: factor.source === 'charge' ? 'charge' : factor.source, hand,
        dieIds: factor.dieId === null ? undefined : [factor.dieId], xMult: this.handAccumulator.currentXMult, xMultFactor: factor,
        message: `${factor.source === 'charge' ? 'Charge' : FLAMES[factor.source].name}: ×${this.format(factor.value)}; hand XMult ×${this.format(this.handAccumulator.currentXMult)}` });
    }
    const { pips, multiplier, xMult, rawScore, score } = finalizeHandScore(this.handAccumulator);
    this.state.stats.handScores.push({ round: this.state.round, hand, handLevel, dieIds: scoringIds,
      basePips: this.handAccumulator.basePips, baseMultiplier: this.handAccumulator.baseMultiplier,
      pips, multiplier, xMult, xMultFactors: structuredClone(this.handAccumulator.xMultFactors), rawScore, score,
      bonusPips: this.handAccumulator.bonusPips, hitchhikerPips: this.handAccumulator.hitchhikerPips });
    this.state.stats.handBonusPips += this.handAccumulator.bonusPips;
    this.state.stats.hitchhikerPipsContributed += this.handAccumulator.hitchhikerPips;
    this.log({ type: 'SCORE_ROUNDING_AUDIT', hand, dieIds: scoringIds, pips, multiplier, xMult, rawScore, amount: score, source: 'hand',
      message: `Final: ${this.format(pips)} × ${this.format(multiplier)} × ${this.format(xMult)} = ${this.format(rawScore)}; rounded ${score}` });
    this.emit({ type: 'HAND_SCORE_FINALIZED', hand, dieIds: scoringIds, pips, multiplier, xMult, rawScore, amount: score, source: 'hand', message: `Final awarded hand score: ${score}` });
    this.addScore(score, 'hand', `${HANDS[hand].name}: round score +${score}`, scoringIds, hand);
    if (handStart.chargeArmed) {
      const consumed = this.state.chargeXMult;
      this.state.chargeXMult = 1; this.state.chargeArmed = false;
      this.state.stats.chargeConsumed = Number((this.state.stats.chargeConsumed + Math.max(0, consumed - 1)).toFixed(12));
      this.emit({ type: 'CHARGE_CHANGED', flame: 'charge', xMult: 1, message: `Charge ×${this.format(consumed)} consumed; meter reset to ×1` });
    }
    this.advanceHotStreak(hand, scoringIds);
    this.resolvePersonalTrainer(hand, scoringIds);
    this.handAccumulator = null;
    this.state.consumed.push(hand);
    this.emit({ type: 'HAND_CONSUMED', hand, message: `${HANDS[hand].name} consumed for round ${this.state.round}` });
    const winning = this.state.score >= this.state.target;
    if (winning) {
      this.resolveJackpot(scoringIds);
      this.emit({ type: 'POST_HAND_REROLLS_SKIPPED', hand, message: 'Post-hand rerolls skipped because the target was reached.' });
      this.evaluate();
      return;
    }
    const rerolls = new Set<number>();
    for (const { id, face } of shapeParticipants) {
      const sticky = stacks(face, 'sticky');
      if (sticky && this.checkProbability('sticky', sticky, [id])) this.trigger('sticky', id, face, `×${sticky} stayed after scoring`);
      else rerolls.add(id);
    }
    for (const die of this.state.dice) if (stacks(activeFace(die), 'slippy')) { this.trigger('slippy', die.id, activeFace(die), 'joined post-hand reroll'); rerolls.add(die.id); }
    this.rollBatch([...rerolls], 'Post-hand reroll', 'gameplay');
    this.drain();
    this.evaluate();
  }

  manualReroll(dieIds: number[]): void {
    const ids = [...dieIds].sort((a, b) => a - b);
    const startedDeadBoard = !hasPlayableHand(this.state.dice, this.state.consumed);
    this.state.manualRerollsRemaining -= ids.length;
    const round = this.state.stats.rounds.at(-1)!;
    round.lastAction = 'MANUAL_REROLL'; round.manualRerollChargesSpent += ids.length; round.manualRerollActions++;
    this.state.stats.manualRerollActions++; this.state.stats.manualDiceRerolled += ids.length;
    const record = { round: this.state.round, dieIds: ids, charges: ids.length, remaining: this.state.manualRerollsRemaining, startedDeadBoard, rescuedDeadBoard: false };
    this.state.stats.manualRerolls.push(record);
    this.emit({ type: 'MANUAL_REROLL_STARTED', dieIds: ids, amount: ids.length, message: `Manual reroll; ${this.state.manualRerollsRemaining} remaining` });
    this.rollBatch(ids, 'Manual gameplay reroll', 'gameplay');
    this.drain();
    if (startedDeadBoard && (this.state.score >= this.state.target || hasPlayableHand(this.state.dice, this.state.consumed))) {
      record.rescuedDeadBoard = true; round.deadBoardRescues++; this.state.stats.deadBoardRescues++;
      this.emit({ type: 'DEAD_BOARD_RESCUED', dieIds: ids, message: 'Dead board rescued' });
    }
    this.evaluate();
  }
  startRound(): void {
    if (this.state.chargeXMult !== 1 || this.state.chargeArmed) this.state.stats.chargeResets++;
    this.state.phase = 'round'; this.state.score = 0; this.state.scoreByHand = {}; this.state.effectScore = 0;
    this.state.manualRerollsRemaining = CONFIG.manualRerollsPerRound; this.state.target = targetForRound(this.state.round);
    this.state.consumed = []; this.state.targetPracticeHand = null; this.state.lastRoundPayout = null;
    this.state.chargeXMult = 1; this.state.chargeArmed = false; this.state.hotStreakCharges = 0;
    this.state.hotStreakGoal = ownedFlameIds(this.state).has('hotStreak') ? 'pair' : null;
    this.state.shop = null; this.state.flameReward = null; this.state.stats.roundReached = this.state.round;
    this.state.stats.rounds.push({ round: this.state.round, target: this.state.target, firstCrossedScore: null,
      finalScore: 0, clearMargin: null, cleared: false, lastHand: null, lastAction: null,
      manualRerollsGranted: CONFIG.manualRerollsPerRound, manualRerollChargesSpent: 0,
      manualRerollsRemainingAtClear: null, manualRerollActions: 0, deadBoardRescues: 0, scoreByHand: {}, effectScore: 0, payout: null });
    this.emit({ type: 'ROUND_STARTED', message: `Round ${this.state.round} — goal ${this.state.target}; Charge reset to ×1` });
    this.selectTargetPractice();
    this.rollBatch(this.state.dice.map(die => die.id), 'Initial round roll', 'gameplay');
    this.drain(); this.evaluate();
  }
  freshOffers(): void {
    const pool = [...ENHANCEMENT_IDS];
    this.state.shop!.offers = Array.from({ length: Math.min(3, pool.length) }, () => {
      const [enhancement] = pool.splice(randomIndex(this.rng, pool.length), 1);
      return { id: this.state.nextOfferId++, enhancement, purchased: false };
    });
  }
  freshTrainingOffers(): void {
    const pool = [...HAND_IDS];
    this.state.shop!.trainingOffers = Array.from({ length: 3 }, () => {
      const [hand] = pool.splice(randomIndex(this.rng, pool.length), 1); return { hand, purchased: false };
    });
  }
  freshFlameOffers(): void {
    const owned = ownedFlameIds(this.state);
    const pool = FLAME_IDS.filter(id => !owned.has(id));
    this.state.flameReward!.offers = Array.from({ length: Math.min(3, pool.length) }, () => {
      const [flame] = pool.splice(randomIndex(this.rng, pool.length), 1); return { id: this.state.nextOfferId++, flame };
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
  openShop(rollDice = true): void {
    this.state.phase = 'shop'; this.state.flameReward = null;
    this.state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0 };
    if (rollDice) this.rollBatch(this.state.dice.map(die => die.id), 'Free shop roll', 'shop');
    this.freshOffers(); this.freshTrainingOffers();
    this.emit({ type: 'SHOP_OPENED', message: `Shop opened${rollDice ? '' : '; Flame Reward faces preserved'}` });
  }
  openFlameReward(): void {
    this.state.phase = 'flameReward'; this.state.shop = null;
    this.state.flameReward = { offers: [], offerRerolls: 0, acquired: false };
    this.rollBatch(this.state.dice.map(die => die.id), 'Flame Reward roll', 'flameReward');
    this.freshFlameOffers();
    this.emit({ type: 'FLAME_REWARD_OPENED', message: 'Flame Reward — optionally acquire one Flame and invest in active embers' });
  }
  evaluate(): void {
    const current = this.state.stats.rounds.at(-1)!;
    current.finalScore = this.state.score;
    if (this.state.score >= this.state.target) {
      current.cleared = true; current.clearMargin = this.state.score - this.state.target;
      current.manualRerollsRemainingAtClear = this.state.manualRerollsRemaining;
      this.emit({ type: 'ROUND_CLEARED', message: `Round ${this.state.round} cleared with ${this.state.score} / ${this.state.target}` });
      const heldGoldSnapshot = this.state.gold;
      const payout = { base: roundReward(), unusedRerolls: this.state.manualRerollsRemaining,
        interest: Math.min(5, Math.floor(heldGoldSnapshot / 5)), heldGoldSnapshot, total: 0 };
      payout.total = payout.base + payout.unusedRerolls + payout.interest;
      current.payout = payout; this.state.lastRoundPayout = payout;
      this.addGold(payout.base, `Round clear base: +${payout.base} gold`, 'roundBase');
      if (payout.unusedRerolls) this.addGold(payout.unusedRerolls, `Unused rerolls: +${payout.unusedRerolls} gold`, 'unusedRerolls');
      if (payout.interest) this.addGold(payout.interest, `Interest on ${heldGoldSnapshot} held Gold: +${payout.interest}`, 'interest');
      if (this.state.round % 3 === 0) this.openFlameReward(); else this.openShop();
    } else if (!hasPlayableHand(this.state.dice, this.state.consumed)) {
      if (this.state.manualRerollsRemaining > 0) { this.emit({ type: 'DEAD_BOARD', message: `No playable hands — ${this.state.manualRerollsRemaining} rerolls remain` }); return; }
      this.state.phase = 'lost';
      this.state.stats.loss = { round: this.state.round, afterHand: current.lastHand, score: this.state.score, afterAction: current.lastAction,
        manualRerollsRemaining: this.state.manualRerollsRemaining, values: this.state.dice.map(die => die.value), consumed: [...this.state.consumed] };
      this.emit({ type: 'RUN_LOST', message: `Run over: ${this.state.score} / ${this.state.target}` });
    }
  }
}
