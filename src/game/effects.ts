import { CONFIG, roundReward, targetForRound } from './config';
import { activeFace, oppositeFace, rollDie, scoringPips } from './dice';
import { diminishingHalfChance, ENHANCEMENTS, ENHANCEMENT_IDS, stacks } from './enhancements';
import { captureHandStart, FLAMES, FLAME_IDS, handXMultContributions } from './flames';
import { hasPlayableHand, HANDS, HAND_IDS, LOWER_HAND_IDS } from './hands';
import { probabilityCheck, randomIndex } from './rng';
import { applyHandContribution, applyXMult, createHandAccumulator, finalizeHandScore, handContributions, standaloneScore } from './scoring';
import { boardSnapshot } from './telemetry';
import type { Enhancement, EventRecord, Face, Flame, GameEvent, GameState, GoldSource, GoldSpendSource, HandId, HandScoreAccumulator, RandomSource, ScoreSource } from './types';

type RollTrigger = { dieId: number; face: Face; enhancement: 'weighted' | 'magnetic' | 'jumpingBean';
  weightedStacks?: number; rollWeight?: number; weightedSourceFace?: number };
type RollContext = 'gameplay' | 'shop' | 'flameReward';

// Synchronous rules produce a complete ordered trace. UI playback only reads snapshots.
export class Resolver {
  readonly events: GameEvent[] = [];
  private queue: RollTrigger[] = [];
  private handAccumulator: HandScoreAccumulator | null = null;
  constructor(readonly state: GameState, readonly rng: RandomSource) {}

  emit(event: Omit<EventRecord, 'id' | 'round'>): void {
    if (this.events.length >= CONFIG.resolutionEventCap) throw new Error(`Resolution exceeded ${CONFIG.resolutionEventCap} events. Check for an infinite ability chain.`);
    const record = { ...event,
      ...(this.handAccumulator ? { handScore: structuredClone(this.handAccumulator) } : {}),
      id: this.state.history.length, round: this.state.round };
    this.state.history.push(record);
    this.events.push({ ...record, board: boardSnapshot(this.state) });
  }
  log(event: Omit<EventRecord, 'id' | 'round'>): void {
    const record = { ...event, id: this.state.history.length, round: this.state.round };
    this.state.history.push(record);
  }
  trigger(enhancement: Enhancement, dieId: number, face?: Face, detail = '',
    context: Pick<EventRecord, 'hand'> = {}): void {
    this.triggerMany(enhancement, [dieId], face, detail, context);
  }
  triggerMany(enhancement: Enhancement, dieIds: number[], face?: Face, detail = '',
    context: Pick<EventRecord, 'hand'> = {}, visible = true): void {
    this.state.stats.triggers[enhancement] = (this.state.stats.triggers[enhancement] ?? 0) + 1;
    if (!visible) return;
    this.emit({ ...context, type: 'ABILITY_TRIGGERED', enhancement, dieIds, face: face?.rank,
      message: `${dieIds.map(id => `D${id + 1}`).join(', ')} ${ENHANCEMENTS[enhancement].name}${detail ? `: ${detail}` : ''}` });
  }
  triggerFlame(flame: Flame, dieId: number, detail = '', hand?: HandId, xMult?: number,
    xMultMode?: 'additive' | 'multiplicative'): void {
    this.state.stats.flameTriggers[flame] = (this.state.stats.flameTriggers[flame] ?? 0) + 1;
    if (xMultMode === 'additive') this.state.stats.additiveXMultByFlame[flame] =
      (this.state.stats.additiveXMultByFlame[flame] ?? 0) + (xMult ?? 0);
    if (xMultMode === 'multiplicative') (this.state.stats.multiplicativeXMultByFlame[flame] ??= []).push(xMult ?? 1);
    this.emit({ type: 'FLAME_TRIGGERED', flame, dieIds: [dieId], hand, xMult, xMultMode,
      message: `D${dieId + 1} ${FLAMES[flame].name}${detail ? `: ${detail}` : ''}` });
  }
  checkProbability(enhancement: 'sticky' | 'sustainable' | 'hitchhiker', stackCount: number, dieIds: number[], hand?: HandId): boolean {
    const chance = diminishingHalfChance(stackCount);
    const succeeded = probabilityCheck(this.rng, chance);
    const stats = this.state.stats.probabilityProcs[enhancement];
    stats.checks++;
    stats[succeeded ? 'successes' : 'failures']++;
    stats.stacksAtCheck.push(stackCount);
    const percentage = chance * 100;
    const subject = enhancement === 'sticky'
      ? `${dieIds.map(id => `D${id + 1}`).join(', ')} Sticky x${stackCount} check: ${percentage}%`
      : enhancement === 'sustainable'
        ? `${HANDS[hand!].name} Sustainable stacks: ${stackCount}. Preserve chance: ${percentage}%`
        : `${dieIds.map(id => `D${id + 1}`).join(', ')} Hitchhiker x${stackCount} check: ${percentage}%`;
    this.log({ type: 'ABILITY_CHECKED', dieIds, hand,
      probability: { enhancement, stacks: stackCount, chance, succeeded },
      message: `${subject}. ${ENHANCEMENTS[enhancement].name} ${succeeded ? 'succeeded' : 'failed'}.` });
    return succeeded;
  }
  addGold(amount: number, message: string, goldSource: GoldSource, dieId?: number): void {
    this.state.gold += amount;
    this.state.stats.goldEarned += amount;
    this.state.stats.goldBySource[goldSource] += amount;
    this.emit({ type: 'GOLD_ADDED', amount, message, goldSource, dieIds: dieId === undefined ? undefined : [dieId] });
  }
  spendGold(amount: number, message: string, goldSpendSource: GoldSpendSource): void {
    this.state.gold -= amount;
    this.state.stats.goldSpent += amount;
    this.state.stats.goldSpentBySource[goldSpendSource] += amount;
    this.emit({ type: 'GOLD_SPENT', amount, message, goldSpendSource });
  }
  addScore(amount: number, source: Exclude<ScoreSource, 'hitchhiker'>, message: string, dieIds: number[], hand?: HandId): void {
    if (!Number.isInteger(amount) || !Number.isInteger(this.state.score)) {
      throw new Error(`Score awards and the authoritative round score must be integers (award ${amount}, current ${this.state.score}).`);
    }
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
      this.trigger('golden', dieId, snapshot, `+${golden * CONFIG.goldenGold} gold`);
      this.addGold(golden * CONFIG.goldenGold, `D${dieId + 1} Golden: +${golden * CONFIG.goldenGold} gold`, 'golden', dieId);
    }
    const workout = stacks(snapshot, 'workout');
    if (workout) {
      const live = this.state.dice[dieId].faces[snapshot.rank - 1];
      const before = scoringPips(live);
      this.trigger('workout', dieId, snapshot, `+${workout * CONFIG.workoutIncrement} future pips`);
      live.workoutPips += workout * CONFIG.workoutIncrement;
      this.emit({ type: 'WORKOUT_INCREMENTED', dieIds: [dieId], face: snapshot.rank,
        message: `D${dieId + 1} face ${snapshot.rank} Workout: ${before} → ${scoringPips(live)}` });
    }
  }
  standalone(dieId: number, face: Face): void {
    const source = 'jumpingBean';
    this.modifiers(dieId, face);
    const xMult = this.state.dice[dieId].flame === 'looseCannon' ? 2 : 1;
    if (xMult > 1) this.triggerFlame('looseCannon', dieId, '×2 XMult for independent score', undefined, 2, 'multiplicative');
    const { pips, multiplier, rawScore, score } = standaloneScore(face, xMult);
    this.state.stats.standaloneScores.push({ round: this.state.round, dieId, pips, multiplier, xMult, rawScore, score });
    this.log({ type: 'SCORE_ROUNDING_AUDIT', dieIds: [dieId], face: face.rank, pips, multiplier, xMult, rawScore,
      amount: score, source, message: `D${dieId + 1} ${ENHANCEMENTS[source].name} calculation: ${pips} × ${multiplier} × ${xMult} = ${rawScore}. Rounded Score: ${score}` });
    this.emit({ type: 'STANDALONE_SCORE_CALCULATED', dieIds: [dieId], face: face.rank, pips, multiplier, xMult, rawScore,
      amount: score, source, message: `D${dieId + 1} ${ENHANCEMENTS[source].name}: ${pips} Pips × ${multiplier} Mult × ${xMult} XMult. Awarded ${score}` });
    this.addScore(score, source, `D${dieId + 1} ${ENHANCEMENTS[source].name} scored ${score}`, [dieId]);
    this.whenScored(dieId, face);
  }

  resolveJackpot(scoringDieIds: number[], hand: HandId): void {
    const scoringDice = new Set(scoringDieIds);
    const showing = [...this.state.dice].sort((a, b) => a.id - b.id)
      .filter(die => stacks(activeFace(die), 'jackpot'));
    if (!showing.length) return;
    this.log({ type: 'ABILITY_EVALUATED', enhancement: 'jackpot', hand,
      message: `Winning hand: ${HANDS[hand].name}` });
    this.log({ type: 'ABILITY_EVALUATED', enhancement: 'jackpot', hand,
      message: `Round score: ${this.state.score} / ${this.state.target}` });
    let total = 0;
    for (const die of showing) {
      const face = activeFace(die);
      const stackCount = stacks(face, 'jackpot');
      if (!stackCount) continue;
      if (scoringDice.has(die.id)) {
        this.log({ type: 'ABILITY_EVALUATED', enhancement: 'jackpot', dieIds: [die.id], face: face.rank, hand,
          message: `D${die.id + 1} Jackpot x${stackCount} did not trigger: die scored in winning hand` });
        continue;
      }
      const payout = stackCount * CONFIG.jackpotGold;
      this.log({ type: 'ABILITY_EVALUATED', enhancement: 'jackpot', dieIds: [die.id], face: face.rank, hand,
        message: `D${die.id + 1} Jackpot x${stackCount} eligible: did not score in winning hand` });
      this.trigger('jackpot', die.id, face, `x${stackCount} +${payout} gold`, { hand });
      this.addGold(payout, `D${die.id + 1} Jackpot x${stackCount}: +${payout} gold`, 'jackpot', die.id);
      total += payout;
    }
    if (total) this.log({ type: 'ABILITY_EVALUATED', enhancement: 'jackpot', hand,
      message: `Total Jackpot payout: +${total} gold` });
  }

  rollBatch(dieIds: number[], reason: string, context: RollContext): void {
    const ids = [...new Set(dieIds)].sort((a, b) => a - b);
    if (!ids.length) return;
    this.emit({ type: 'DICE_REROLL_STARTED', dieIds: ids, message: `${reason}: ${ids.map(id => `D${id + 1}`).join(', ')}` });
    // Draw the whole batch before any effect consumes RNG or changes the board.
    const results = ids.map(dieId => ({ dieId, before: this.state.dice[dieId].value, ...rollDie(this.state.dice[dieId], this.rng) }));
    const triggers: RollTrigger[] = [];
    for (const result of results) {
      const die = this.state.dice[result.dieId];
      die.value = result.value;
      const face = structuredClone(activeFace(die));
      this.emit({ type: 'DIE_ROLLED', dieIds: [die.id], face: die.value, message: `D${die.id + 1} rolled: ${result.before} → ${die.value}` });
      if (die.flame === 'clockwork') this.triggerFlame('clockwork', die.id, `${result.before} → ${die.value}`);
      if (context === 'gameplay' && die.flame === 'charge') {
        die.chargeXMult = Number((die.chargeXMult + 0.5).toFixed(12));
        this.state.stats.chargeAccumulated += 0.5;
        this.triggerFlame('charge', die.id, `+0.5 stored XMult; stored +${die.chargeXMult}`);
        this.emit({ type: 'CHARGE_CHANGED', flame: 'charge', dieIds: [die.id], xMult: die.chargeXMult,
          message: `D${die.id + 1} stored Charge: +${die.chargeXMult} XMult` });
      }
      if (result.weighted) {
        const weightedSourceFace = oppositeFace(result.value);
        const weightedStacks = stacks(die.faces[weightedSourceFace - 1], 'weighted');
        triggers.push({ dieId: die.id, face, enhancement: 'weighted', weightedSourceFace,
          weightedStacks, rollWeight: 1 + weightedStacks });
      }
      if (context === 'gameplay') {
        if (stacks(face, 'magnetic')) triggers.push({ dieId: die.id, face, enhancement: 'magnetic' });
        if (stacks(face, 'jumpingBean')) triggers.push({ dieId: die.id, face, enhancement: 'jumpingBean' });
      }
    }
    if (context === 'gameplay') this.queue.push(...triggers);
    else for (const item of triggers) this.trigger('weighted', item.dieId, item.face,
      `source face ${item.weightedSourceFace} has Weighted x${item.weightedStacks}; face ${item.face.rank} roll weight ${item.rollWeight}; influenced result`);
  }
  drain(): void {
    let cursor = 0;
    while (cursor < this.queue.length) {
      const item = this.queue[cursor++];
      const { dieId, face, enhancement } = item;
      this.trigger(enhancement, dieId, face, enhancement === 'weighted'
        ? `source face ${item.weightedSourceFace} has Weighted x${item.weightedStacks}; face ${face.rank} roll weight ${item.rollWeight}; influenced result`
        : '');
      if (enhancement === 'magnetic') {
        for (const die of this.state.dice) {
          const destinations = die.faces.filter(candidate => stacks(candidate, 'magnetic'));
          if (!destinations.length) continue;
          die.value = destinations[randomIndex(this.rng, destinations.length)].rank;
          this.emit({ type: 'DIE_FLIPPED', dieIds: [die.id], face: die.value,
            message: `D${die.id + 1} flipped to Magnetic face ${die.value} (not a roll)` });
        }
      } else if (enhancement === 'jumpingBean') {
        // Use the landed snapshot even if preceding Magnetic effects changed the die.
        this.standalone(dieId, face);
        const stickyStacks = stacks(face, 'sticky');
        if (stickyStacks && this.checkProbability('sticky', stickyStacks, [dieId])) {
          this.trigger('sticky', dieId, face, `x${stickyStacks} succeeded; prevented Jumping Bean reroll`);
        } else this.rollBatch([dieId], 'Jumping Bean reroll', 'gameplay');
      }
    }
    this.queue = [];
  }
  play(hand: HandId, dieIds: number[]): void {
    const ids = [...dieIds].sort((a, b) => a - b);
    const handLevel = this.state.handLevels[hand];
    const handStart = captureHandStart(this.state, hand);
    const shapeParticipants = ids.map(id => ({ id, face: structuredClone(activeFace(this.state.dice[id])), role: 'selected' as const }));
    this.handAccumulator = createHandAccumulator(hand, ids, handLevel);
    this.emit({ type: 'HAND_STARTED', hand, dieIds: ids,
      message: `Played ${HANDS[hand].name} Lv. ${handLevel}: ${ids.map(id => `D${id + 1}`).join(', ')}. Hand Base Pips: ${this.handAccumulator.basePips}. Base Multiplier: x${this.handAccumulator.baseMultiplier}. Base XMult: x1` });
    this.state.handPlayCounts[hand]++;
    this.state.stats.handsPlayed[hand] = (this.state.stats.handsPlayed[hand] ?? 0) + 1;
    this.state.stats.rounds.at(-1)!.lastHand = hand;
    this.state.stats.rounds.at(-1)!.lastAction = 'PLAY';
    const hitchhikers: { id: number; face: Face; role: 'hitchhiker' }[] = [];
    for (const die of [...this.state.dice].sort((a, b) => a.id - b.id)) {
      if (ids.includes(die.id)) continue;
      const face = structuredClone(activeFace(die));
      const hitchhikerStacks = stacks(face, 'hitchhiker');
      if (!hitchhikerStacks || !this.checkProbability('hitchhiker', hitchhikerStacks, [die.id], hand)) continue;
      hitchhikers.push({ id: die.id, face, role: 'hitchhiker' });
      this.trigger('hitchhiker', die.id, face, `x${hitchhikerStacks} succeeded; joined ${HANDS[hand].name}`, { hand });
    }
    const scoringParticipants = [...shapeParticipants, ...hitchhikers].sort((a, b) => a.id - b.id);
    const scoringIds = scoringParticipants.map(item => item.id);
    const contributions = handContributions(this.state.dice, ids, hitchhikers.map(item => item.id));
    for (const { id, face } of shapeParticipants) {
      const wild: Enhancement | null = hand === 'smallStraight' || hand === 'largeStraight' ? 'missingLink'
        : HANDS[hand].rank ? null : 'mirror';
      if (wild && stacks(face, wild)) this.trigger(wild, id, face, 'qualification uses wild rank; scoring uses actual pips');
    }
    for (const contribution of contributions) {
      const { dieId, face, kind, role, amount } = contribution;
      if (kind !== 'base') this.trigger(kind, dieId, face,
        `+${amount} ${kind === 'multiplier' ? 'hand multiplier' : 'hand pips'}`);
      applyHandContribution(this.handAccumulator, contribution);
      this.emit({ type: kind === 'multiplier' ? 'HAND_MULTIPLIER_CHANGED'
        : role === 'hitchhiker' ? 'HITCHHIKER_ADDED_PIPS' : 'HAND_PIPS_CHANGED',
        hand, dieIds: [dieId], face: face.rank, amount,
        enhancement: kind === 'base' ? undefined : kind, source: 'hand',
        pips: this.handAccumulator.currentPips, multiplier: this.handAccumulator.currentMultiplier,
        message: kind === 'multiplier'
          ? `D${dieId + 1}${role === 'hitchhiker' ? ' Hitchhiker' : ''} Multiplier: +${amount}; hand multiplier: x${this.handAccumulator.currentMultiplier}`
          : `D${dieId + 1}${role === 'hitchhiker' ? ' Hitchhiker' : ''} ${kind === 'base' ? 'contributed' : ENHANCEMENTS[kind].name + ':'} +${amount} Pips; hand pips: ${this.handAccumulator.currentPips}` });
    }
    for (const { id, face } of scoringParticipants) this.whenScored(id, face);
    for (const contribution of handXMultContributions(handStart, hand, handLevel, scoringIds)) {
      applyXMult(this.handAccumulator, contribution.mode, contribution.value);
      const detail = contribution.mode === 'additive' ? `+${contribution.value} XMult` : `×${contribution.value} XMult`;
      this.triggerFlame(contribution.flame, contribution.dieId, detail, hand, contribution.value, contribution.mode);
      this.emit({ type: 'HAND_XMULT_CHANGED', flame: contribution.flame, hand, dieIds: [contribution.dieId],
        xMult: this.handAccumulator.currentXMult, xMultMode: contribution.mode,
        message: `${FLAMES[contribution.flame].name}: ${detail}; hand XMult: x${this.handAccumulator.currentXMult}` });
    }
    for (const die of this.state.dice.filter(die => die.flame === 'charge' && die.chargeXMult > 0)) {
      const consumed = die.chargeXMult;
      die.chargeXMult = 0;
      this.state.stats.chargeConsumed += consumed;
      this.emit({ type: 'CHARGE_CHANGED', flame: 'charge', dieIds: [die.id], xMult: 0,
        message: `D${die.id + 1} Charge consumed: +${consumed} XMult; stored Charge reset` });
    }
    const { pips, multiplier, xMult, rawScore, score } = finalizeHandScore(this.handAccumulator);
    this.state.stats.handScores.push({ round: this.state.round, hand, handLevel, dieIds: scoringIds,
      basePips: this.handAccumulator.basePips, baseMultiplier: this.handAccumulator.baseMultiplier,
      pips, multiplier, xMult, rawScore, score,
      bonusPips: this.handAccumulator.bonusPips, hitchhikerPips: this.handAccumulator.hitchhikerPips });
    this.state.stats.handBonusPips += this.handAccumulator.bonusPips;
    this.state.stats.hitchhikerPipsContributed += this.handAccumulator.hitchhikerPips;
    this.log({ type: 'SCORE_ROUNDING_AUDIT', hand, dieIds: scoringIds, pips, multiplier, xMult, rawScore, amount: score, source: 'hand',
      message: `Final hand calculation: ${pips} × ${multiplier} × ${xMult} = ${rawScore}. Rounded Score: ${score}` });
    this.emit({ type: 'HAND_SCORE_FINALIZED', hand, dieIds: scoringIds, pips, multiplier, xMult, rawScore, amount: score, source: 'hand',
      message: `Final awarded hand score: ${score}` });
    this.addScore(score, 'hand',
      `${HANDS[hand].name}: round score +${score}; ${HANDS[hand].name} round total: ${(this.state.scoreByHand[hand] ?? 0) + score}`,
      scoringIds, hand);
    const encoreScorers = scoringParticipants.filter(item => this.state.dice[item.id].flame === 'doubleEncore'
      && !this.state.doubleEncoreUsedDieIds.includes(item.id));
    for (const scorer of encoreScorers) {
      this.state.doubleEncoreUsedDieIds.push(scorer.id);
      this.state.bonusHandUses[hand] = (this.state.bonusHandUses[hand] ?? 0) + 2;
      this.state.stats.doubleEncoreUsesGranted += 2;
      this.triggerFlame('doubleEncore', scorer.id, `+2 uses for ${HANDS[hand].name}`, hand);
      this.emit({ type: 'HAND_BONUS_USE_GRANTED', flame: 'doubleEncore', hand, dieIds: [scorer.id], amount: 2,
        message: `${HANDS[hand].name} gained 2 bonus uses; ${this.state.bonusHandUses[hand]} available` });
    }
    const winning = this.state.score >= this.state.target;
    if (winning) {
      for (const scorer of scoringParticipants.filter(item => this.state.dice[item.id].flame === 'personalTrainer')) {
        const before = this.state.handLevels[hand];
        this.state.handLevels[hand]++;
        this.state.stats.personalTrainerLevelsGranted++;
        this.triggerFlame('personalTrainer', scorer.id, `${HANDS[hand].name} Lv. ${before} → ${this.state.handLevels[hand]}`, hand);
      }
    }
    this.handAccumulator = null;
    const sustainableParticipants = scoringParticipants.filter(item => stacks(item.face, 'sustainable'));
    const sustainableStacks = sustainableParticipants.reduce((sum, item) => sum + stacks(item.face, 'sustainable'), 0);
    if ((this.state.bonusHandUses[hand] ?? 0) > 0) {
      this.state.bonusHandUses[hand]!--;
      this.emit({ type: 'HAND_BONUS_USE_CONSUMED', hand,
        message: `${HANDS[hand].name} used one bonus use; ${this.state.bonusHandUses[hand]} bonus uses remain before its normal use` });
    } else {
      const sustainableSucceeded = sustainableStacks > 0
        && this.checkProbability('sustainable', sustainableStacks, sustainableParticipants.map(item => item.id), hand);
      if (sustainableSucceeded) {
        this.triggerMany('sustainable', sustainableParticipants.map(item => item.id), undefined,
          `x${sustainableStacks} succeeded; ${HANDS[hand].name} remains available`, { hand }, !winning);
      } else {
        this.state.consumed.push(hand);
        this.emit({ type: 'HAND_CONSUMED', hand, message: `${HANDS[hand].name} consumed for round ${this.state.round}` });
      }
    }
    // Winning hands finish all hand-bound effects, then bypass gameplay reroll scheduling.
    if (winning) {
      this.resolveJackpot(scoringIds, hand);
      this.emit({ type: 'POST_HAND_REROLLS_SKIPPED', hand,
        message: `Round score: ${this.state.score} / ${this.state.target}. Post-hand rerolls skipped because target was reached.` });
      this.evaluate();
      return;
    }
    const rerolls = new Set<number>();
    for (const { id, face } of shapeParticipants) {
      const stickyStacks = stacks(face, 'sticky');
      if (stickyStacks && this.checkProbability('sticky', stickyStacks, [id])) {
        this.trigger('sticky', id, face, `x${stickyStacks} succeeded; stayed after scoring`);
      } else rerolls.add(id);
    }
    for (const die of this.state.dice) {
      if (stacks(activeFace(die), 'slippy')) {
        this.trigger('slippy', die.id, activeFace(die), 'included in the post-hand reroll batch');
        rerolls.add(die.id);
      }
    }
    this.rollBatch([...rerolls], 'Post-hand reroll', 'gameplay');
    this.drain();
    this.evaluate();
  }
  manualReroll(dieIds: number[]): void {
    const ids = [...dieIds].sort((a, b) => a - b);
    const startedDeadBoard = !hasPlayableHand(this.state.dice, this.state.consumed);
    this.state.manualRerollsRemaining -= ids.length;
    const round = this.state.stats.rounds.at(-1)!;
    round.lastAction = 'MANUAL_REROLL';
    round.manualRerollChargesSpent += ids.length;
    round.manualRerollActions++;
    this.state.stats.manualRerollActions++;
    this.state.stats.manualDiceRerolled += ids.length;
    const record = { round: this.state.round, dieIds: ids, charges: ids.length,
      remaining: this.state.manualRerollsRemaining, startedDeadBoard, rescuedDeadBoard: false };
    this.state.stats.manualRerolls.push(record);
    this.emit({ type: 'MANUAL_REROLL_STARTED', dieIds: ids, amount: ids.length,
      message: `Manual reroll: ${ids.map(id => `D${id + 1}`).join(', ')}. Manual rerolls remaining: ${this.state.manualRerollsRemaining}` });
    this.rollBatch(ids, 'Manual gameplay reroll', 'gameplay');
    this.drain();
    // Inspect the gameplay board after the whole chain, before clearance rolls shop dice.
    if (startedDeadBoard && (this.state.score >= this.state.target || hasPlayableHand(this.state.dice, this.state.consumed))) {
      record.rescuedDeadBoard = true;
      round.deadBoardRescues++;
      this.state.stats.deadBoardRescues++;
      this.emit({ type: 'DEAD_BOARD_RESCUED', dieIds: ids,
        message: `Dead board rescued: ${this.state.score >= this.state.target ? 'target reached' : 'a playable hand is available'}` });
    }
    this.evaluate();
  }
  startRound(): void {
    this.state.phase = 'round';
    this.state.score = 0;
    this.state.scoreByHand = {};
    this.state.effectScore = 0;
    this.state.manualRerollsRemaining = CONFIG.manualRerollsPerRound;
    this.state.target = targetForRound(this.state.round);
    this.state.consumed = [];
    this.state.bonusHandUses = {};
    this.state.doubleEncoreUsedDieIds = [];
    this.state.targetPracticeHand = null;
    this.state.shop = null;
    this.state.flameReward = null;
    this.state.stats.roundReached = this.state.round;
    this.state.stats.rounds.push({ round: this.state.round, target: this.state.target, firstCrossedScore: null,
      finalScore: 0, clearMargin: null, cleared: false, lastHand: null, lastAction: null,
      manualRerollsGranted: CONFIG.manualRerollsPerRound, manualRerollChargesSpent: 0,
      manualRerollsRemainingAtClear: null, manualRerollActions: 0, deadBoardRescues: 0,
      scoreByHand: {}, effectScore: 0 });
    this.emit({ type: 'ROUND_STARTED', message: `Round ${this.state.round} — goal ${this.state.target}; ${this.state.manualRerollsRemaining} manual die rerolls granted` });
    this.selectTargetPractice();
    this.rollBatch(this.state.dice.map(die => die.id), 'Initial round roll', 'gameplay');
    this.drain();
    this.evaluate();
  }
  freshOffers(): void {
    const pool = [...ENHANCEMENT_IDS];
    this.state.shop!.offers = Array.from({ length: 3 }, () => {
      const [enhancement] = pool.splice(randomIndex(this.rng, pool.length), 1);
      return { id: this.state.nextOfferId++, enhancement, purchased: false };
    });
  }
  freshTrainingOffers(): void {
    const pool = [...HAND_IDS];
    this.state.shop!.trainingOffers = Array.from({ length: 3 }, () => {
      const [hand] = pool.splice(randomIndex(this.rng, pool.length), 1);
      return { hand, purchased: false };
    });
  }
  freshFlameOffers(): void {
    const pool = [...FLAME_IDS];
    this.state.flameReward!.offers = Array.from({ length: 3 }, () => {
      const [flame] = pool.splice(randomIndex(this.rng, pool.length), 1);
      return { id: this.state.nextOfferId++, flame };
    });
  }
  selectTargetPractice(): void {
    if (!this.state.dice.some(die => die.flame === 'targetPractice')) return;
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
      message: `Round ${this.state.round} Target Practice: ${HANDS[this.state.targetPracticeHand].name}` });
  }
  openShop(rollDice = true): void {
    this.state.phase = 'shop';
    this.state.flameReward = null;
    this.state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0 };
    if (rollDice) this.rollBatch(this.state.dice.map(die => die.id), 'Free shop roll', 'shop');
    this.freshOffers();
    this.freshTrainingOffers();
    this.emit({ type: 'SHOP_OPENED', message: `Shop opened — enhance only the currently exposed physical faces${rollDice ? '' : '; Flame Reward faces preserved'}` });
  }
  openFlameReward(): void {
    this.state.phase = 'flameReward';
    this.state.shop = null;
    this.state.flameReward = { offers: [], offerRerolls: 0 };
    this.rollBatch(this.state.dice.map(die => die.id), 'Flame Reward roll', 'flameReward');
    this.freshFlameOffers();
    this.emit({ type: 'FLAME_REWARD_OPENED', message: `Round ${this.state.round} Flame Reward — choose one free Flame for one physical die` });
  }
  evaluate(): void {
    const current = this.state.stats.rounds.at(-1)!;
    current.finalScore = this.state.score;
    if (this.state.score >= this.state.target) {
      current.cleared = true;
      current.clearMargin = this.state.score - this.state.target;
      current.manualRerollsRemainingAtClear = this.state.manualRerollsRemaining;
      this.emit({ type: 'ROUND_CLEARED', message: `Round ${this.state.round} cleared with ${this.state.score} / ${this.state.target} (+${current.clearMargin})` });
      this.addGold(roundReward(this.state.round), `Round reward: +${roundReward(this.state.round)} gold`, 'roundClear');
      if (this.state.round % 3 === 0) this.openFlameReward();
      else this.openShop();
    } else if (!hasPlayableHand(this.state.dice, this.state.consumed)) {
      if (this.state.manualRerollsRemaining > 0) {
        this.emit({ type: 'DEAD_BOARD', message: `No playable hands — ${this.state.manualRerollsRemaining} manual reroll${this.state.manualRerollsRemaining === 1 ? ' remains' : 's remain'}. Use your remaining rerolls.` });
        return;
      }
      this.state.phase = 'lost';
      this.state.stats.loss = { round: this.state.round, afterHand: current.lastHand, score: this.state.score,
        afterAction: current.lastAction, manualRerollsRemaining: this.state.manualRerollsRemaining,
        values: this.state.dice.map(die => die.value), consumed: [...this.state.consumed] };
      this.emit({ type: 'RUN_LOST', message: `Run over: ${this.state.score} / ${this.state.target}. No playable unconsumed hands on the complete board. No manual rerolls remaining.` });
    }
  }
}
