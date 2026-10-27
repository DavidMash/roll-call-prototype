import { CONFIG } from './config';
import { activeFace, scoringPips } from './dice';
import { handStats } from './hands';
import { exactInferno, exactWeightedFactorAverage, finalizeExactScore, type ExactScore } from './scoreMath';
import type { CollectibleDie, Die, DieRoundRuntime, Face, HandId, HandScoreAccumulator, SpecialDieType } from './types';
import { effectOf, effectRuntime } from './specialDice';

export const INFERNO_BASE = 25;
export const infernoMultiplier = (level: number): ExactScore => exactInferno(Math.max(0, Math.floor(level)));

export interface HandScoreContribution {
  kind: 'base' | 'special' | 'teamPlayer';
  role: 'selected' | 'hitchhiker';
  dieId: number;
  face: Face;
  amount: number;
  effectType?: SpecialDieType;
  /** Effect owners when another die's Score receives this contribution. */
  sourceDieIds?: number[];
}

export type ScoringParticipant = { id: number; face: Face; role: 'selected' | 'hitchhiker' };

/** Pips intrinsic to one genuine face-scoring activation, before terminal Teamwork copies. */
export function ordinaryFaceContributions(participant: ScoringParticipant, scoringDice: number): HandScoreContribution[] {
  void scoringDice;
  return [{ kind: 'base', role: participant.role, dieId: participant.id,
    face: participant.face, amount: scoringPips(participant.face) }];
}

export const resolvedOrdinaryPips = (participant: ScoringParticipant, scoringDice: number): number =>
  ordinaryFaceContributions(participant, scoringDice).reduce((sum, contribution) => sum + contribution.amount, 0);

export interface DiePipsContext {
  die?: CollectibleDie;
  runtime?: DieRoundRuntime;
  selectedDice?: readonly CollectibleDie[];
  playSource?: 'manual' | 'freePlay' | 'jumpingBean';
  curtainCallMultiplier?: number;
}

/**
 * Canonical Pips contributed by one scoring occurrence. Both resolution and the
 * pre-Play view use this helper so UI never re-implements enhancement arithmetic.
 */
export function resolvedDiePipsContributions(participant: ScoringParticipant, scoringDice: number,
  context: DiePipsContext = {}): HandScoreContribution[] {
  const contributions = ordinaryFaceContributions(participant, scoringDice);
  const { die, runtime } = context;
  if (die) {
    const basic = effectOf(die, 'basic');
    const bonus = effectOf(die, 'bonus');
    const furnace = effectOf(die, 'furnace');
    const specialParts: [SpecialDieType, number][] = [
      ['basic', basic ? participant.face.rank * (basic.level - 1) : 0],
      ['bonus', bonus ? CONFIG.bonusPips * bonus.level : 0],
      ['furnace', furnace ? (effectRuntime(runtime, furnace)?.furnacePips ?? 0) : 0],
      ['workout', effectRuntime(runtime, effectOf(die, 'workout'))?.temporaryPips ?? 0],
      ['tank', effectRuntime(runtime, effectOf(die, 'tank'))?.temporaryPips ?? 0],
    ];
    for (const [effectType, amount] of specialParts) if (amount) contributions.push({
      kind: 'special', role: participant.role, dieId: participant.id, face: participant.face, amount, effectType,
    });
  }
  if (context.playSource === 'freePlay' && (context.curtainCallMultiplier ?? 1) > 1) {
    const amount = contributions.reduce((sum, contribution) => sum + contribution.amount, 0)
      * ((context.curtainCallMultiplier ?? 1) - 1);
    contributions.push({ kind: 'special', role: participant.role, dieId: participant.id,
      face: participant.face, amount, effectType: 'freePlay' });
  }
  if (context.playSource === 'manual' && participant.role === 'selected' && context.selectedDice?.some(item => item.id === participant.id)) {
    const teamPlayers = context.selectedDice.filter(item => item.id !== participant.id && !!effectOf(item, 'teamPlayer'));
    const teamFactor = 1 + teamPlayers.reduce((levels, teamPlayer) => levels + effectOf(teamPlayer, 'teamPlayer')!.level, 0);
    if (teamFactor > 1) {
      const subtotal = contributions.reduce((sum, contribution) => sum + contribution.amount, 0);
      contributions.push({ kind: 'teamPlayer', role: participant.role, dieId: participant.id,
        face: participant.face, amount: subtotal * (teamFactor - 1), sourceDieIds: teamPlayers.map(item => item.id) });
    }
  }
  return contributions;
}

export function createHandAccumulator(hand: HandId, dieIds: number[], level = 1, infernoMultiplier: ExactScore = 1n): HandScoreAccumulator {
  const stats = handStats(hand, level);
  return {
    hand, handLevel: level, infernoMultiplier, dieIds: [...dieIds],
    handMultiplier: stats.handMultiplier,
    currentPips: 0, currentMultiplier: stats.handMultiplier,
    xMultFactors: [], currentXMult: 1, bossFactor: 1,
    bonusPips: 0, hitchhikerPips: 0, rawScore: null, finalScore: null,
  };
}

export function finalizeScore(pips: number, multiplier: number, xMult = 1, inferno: ExactScore = 1n) {
  return finalizeExactScore(inferno, pips, multiplier, xMult);
}

/** Score-weighted effective multiplier used by Flame contribution attribution. */
export function scoreWeightedMultiplier(observations: readonly { factor: number; weight: ExactScore }[]): number {
  return exactWeightedFactorAverage(observations.map(item => ({ ...item, weight: item.weight < 0n ? 0n : item.weight })));
}

// Capture all scoring faces before Workout changes any physical face.
export function handContributions(dice: Die[], selectedIds: number[], hitchhikerIds: number[] = []): HandScoreContribution[] {
  const selected = new Set(selectedIds);
  const hitchhikers = new Set(hitchhikerIds);
  const scorers = [...dice]
    .filter(die => selected.has(die.id) || hitchhikers.has(die.id))
    .map(die => ({ dieId: die.id, face: structuredClone(activeFace(die)), role: selected.has(die.id) ? 'selected' as const : 'hitchhiker' as const }));
  const contributions = scorers.flatMap(item => ordinaryFaceContributions({ id: item.dieId, face: item.face, role: item.role }, scorers.length));
  return contributions;
}

export function applyHandContribution(accumulator: HandScoreAccumulator, contribution: HandScoreContribution): void {
  if (accumulator.finalScore !== null) throw new Error('Cannot change a finalized hand score.');
  accumulator.currentPips += contribution.amount;
  if (contribution.role === 'hitchhiker') accumulator.hitchhikerPips += contribution.amount;
}

export function applyXMult(accumulator: HandScoreAccumulator, factor: import('./types').XMultFactor): void {
  if (accumulator.finalScore !== null) throw new Error('Cannot change a finalized hand score.');
  accumulator.xMultFactors.push(structuredClone(factor));
  accumulator.currentXMult = Number(accumulator.xMultFactors.map(item => item.value).sort((a, b) => a - b)
    .reduce((product, value) => product * value, 1).toFixed(12));
}

export function applyHandMultiplier(accumulator: HandScoreAccumulator, factor: number): void {
  if (accumulator.finalScore !== null) throw new Error('Cannot change a finalized hand score.');
  accumulator.currentMultiplier = Number((accumulator.currentMultiplier * factor).toFixed(12));
}

export function finalizeHandScore(accumulator: HandScoreAccumulator, bossFactor = 1) {
  if (accumulator.finalScore !== null) throw new Error('Hand score already finalized.');
  accumulator.bossFactor = bossFactor;
  const { rawScore, finalScore } = finalizeScore(accumulator.currentPips, accumulator.currentMultiplier,
    accumulator.currentXMult * bossFactor, accumulator.infernoMultiplier);
  accumulator.rawScore = rawScore;
  accumulator.finalScore = finalScore;
  return { pips: accumulator.currentPips, multiplier: accumulator.currentMultiplier, xMult: accumulator.currentXMult, rawScore, score: finalScore };
}

export function handScore(dice: Die[], hand: HandId, dieIds: number[], level = 1) {
  const accumulator = createHandAccumulator(hand, dieIds, level);
  for (const contribution of handContributions(dice, dieIds)) applyHandContribution(accumulator, contribution);
  const { xMult: _xMult, ...score } = finalizeHandScore(accumulator);
  return score;
}
export function standaloneScore(face: Face, xMult = 1) {
  const pips = scoringPips(face);
  const multiplier = CONFIG.standaloneMultiplier;
  const { rawScore, finalScore } = finalizeScore(pips, multiplier, xMult);
  return { pips, multiplier, rawScore, score: finalScore };
}
