import { activeEncounterDice } from './bosses';
import { activeFace, wholeDieEffectSuppressed } from './dice';
import { captureHandStart, composeXMult, countScoringDiceEnhancementComponents, handXMultContributions } from './flames';
import { handStats, planQualification } from './hands';
import { finalizeScore, resolvedDiePipsContributions, type ScoringParticipant } from './scoring';
import { effectOf, effectRuntime } from './specialDice';
import type { Board, CollectibleDie, HandId, XMultFactor } from './types';

export interface CanonicalPlayPreview {
  hand: HandId;
  pips: number;
  multiplier: number;
  xMult: number;
  bossFactor: number;
  effectiveXMult: number;
  infernoMultiplier: bigint;
  score: bigint;
  diePips: { dieId: number; pips: number; role: 'selected' | 'hitchhiker' }[];
  xMultFactors: XMultFactor[];
}

/** Read-only projection of the same contribution primitives used by resolution. */
export function canonicalPlayPreview(board: Board, hand: HandId, selectedDieIds: number[], decisionMs = 0): CanonicalPlayPreview {
  const dice = activeEncounterDice(board);
  const selectedSet = new Set(selectedDieIds);
  const selectedDice = dice.filter((die): die is CollectibleDie => selectedSet.has(die.id) && die.owner === 'player'
    && !wholeDieEffectSuppressed(die));
  const participants: ScoringParticipant[] = dice.filter(die => selectedSet.has(die.id)).map(die => ({
    id: die.id, face: structuredClone(activeFace(die)), role: 'selected' as const,
  }));
  for (const die of dice) {
    if (selectedSet.has(die.id) || die.owner !== 'player' || wholeDieEffectSuppressed(die)) continue;
    const hitchhiker = effectOf(die, 'hitchhiker');
    if (hitchhiker && (effectRuntime(board.dieRoundState[die.id], hitchhiker)?.invocationsRemaining ?? 0) > 0) {
      participants.push({ id: die.id, face: structuredClone(activeFace(die)), role: 'hitchhiker' });
    }
  }
  const pipsByDie = new Map<number, { pips: number; role: 'selected' | 'hitchhiker' }>();
  const qualification = planQualification(dice, hand, selectedDieIds, { roundState: board.dieRoundState });
  for (const participant of participants) {
    const die = dice.find(item => item.id === participant.id);
    const collectible = die?.owner === 'player' && !wholeDieEffectSuppressed(die) ? die : undefined;
    const contributions = resolvedDiePipsContributions(participant, participants.length, {
      die: collectible, runtime: collectible ? board.dieRoundState[collectible.id] : undefined,
      selectedDice, playSource: 'manual',
    });
    let occurrences = 1;
    if (qualification.effects.some(effect => effect.dieId === participant.id && effect.effect === 'conjoined')) occurrences++;
    if (collectible) {
      const doubleTime = effectOf(collectible, 'doubleTime');
      if (doubleTime) occurrences += Math.floor(doubleTime.level / 4);
      const loneWolf = effectOf(collectible, 'loneWolf');
      if (loneWolf && selectedDieIds.length === 1 && participant.role === 'selected') occurrences += loneWolf.level;
    }
    const amount = contributions.reduce((sum, contribution) => sum + contribution.amount, 0) * occurrences;
    pipsByDie.set(participant.id, { pips: amount, role: participant.role });
  }
  const stats = handStats(hand, board.handLevels[hand]);
  const pips = [...pipsByDie.values()].reduce((sum, item) => sum + item.pips, 0);
  const snapshot = captureHandStart(board, hand, selectedDieIds, decisionMs, 'manual', {
    allIn: board.scoreWagers.allInArmed,
    doubleOrNothingRedemption: board.scoreWagers.doubleOrNothing?.hand === hand,
  });
  snapshot.playedDiceScoringPips = [...pipsByDie.entries()].filter(([id]) => selectedSet.has(id))
    .reduce((sum, [, item]) => sum + item.pips, 0);
  snapshot.scoringDiceEnhancementCount = countScoringDiceEnhancementComponents(snapshot, participants.map(item => item.id));
  const xMultFactors = handXMultContributions(snapshot, hand, board.handLevels[hand], participants.map(item => item.id));
  const xMult = composeXMult(xMultFactors);
  const effectiveXMult = Number((xMult * snapshot.bossFactor).toFixed(12));
  const score = finalizeScore(pips, stats.handMultiplier, effectiveXMult, snapshot.infernoMultiplier).finalScore;
  return { hand, pips, multiplier: stats.handMultiplier, xMult, bossFactor: snapshot.bossFactor, effectiveXMult,
    infernoMultiplier: snapshot.infernoMultiplier, score,
    diePips: [...pipsByDie.entries()].map(([dieId, item]) => ({ dieId, ...item })), xMultFactors };
}
