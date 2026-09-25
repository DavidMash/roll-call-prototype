import { CONFIG } from './config';
import { activeFace, baseScoringPips, scoringPips } from './dice';
import { stacks } from './enhancements';
import { handStats } from './hands';
import type { Die, Face, HandId, HandScoreAccumulator } from './types';

export interface HandScoreContribution {
  kind: 'base' | 'bonus';
  role: 'selected' | 'hitchhiker';
  dieId: number;
  face: Face;
  amount: number;
}

export function createHandAccumulator(hand: HandId, dieIds: number[], level = 1): HandScoreAccumulator {
  const stats = handStats(hand, level);
  return {
    hand, handLevel: level, dieIds: [...dieIds].sort((a, b) => a - b),
    basePips: stats.basePips, baseMultiplier: stats.baseMultiplier,
    currentPips: stats.basePips, currentMultiplier: stats.baseMultiplier,
    xMultFactors: [], currentXMult: 1, bossFactor: 1,
    bonusPips: 0, hitchhikerPips: 0, rawScore: null, finalScore: null,
  };
}

export function finalizeScore(pips: number, multiplier: number, xMult = 1) {
  const rawScore = pips * multiplier * xMult;
  return { rawScore, finalScore: Math.round(rawScore) };
}

// Capture all scoring faces before Workout changes any physical face.
export function handContributions(dice: Die[], selectedIds: number[], hitchhikerIds: number[] = []): HandScoreContribution[] {
  const selected = new Set(selectedIds);
  const hitchhikers = new Set(hitchhikerIds);
  const scorers = [...dice].sort((a, b) => a.id - b.id)
    .filter(die => selected.has(die.id) || hitchhikers.has(die.id))
    .map(die => ({ dieId: die.id, face: structuredClone(activeFace(die)), role: selected.has(die.id) ? 'selected' as const : 'hitchhiker' as const }));
  return [
    ...scorers.map(item => ({ ...item, kind: 'base' as const, amount: baseScoringPips(item.face) })),
    ...scorers.filter(item => stacks(item.face, 'bonus')).map(item => ({
      ...item, kind: 'bonus' as const, amount: stacks(item.face, 'bonus') * CONFIG.bonusPips,
    })),
  ];
}

export function applyHandContribution(accumulator: HandScoreAccumulator, contribution: HandScoreContribution): void {
  if (accumulator.finalScore !== null) throw new Error('Cannot change a finalized hand score.');
  accumulator.currentPips += contribution.amount;
  if (contribution.kind === 'bonus') accumulator.bonusPips += contribution.amount;
  if (contribution.role === 'hitchhiker') accumulator.hitchhikerPips += contribution.amount;
}

export function applyXMult(accumulator: HandScoreAccumulator, factor: import('./types').XMultFactor): void {
  if (accumulator.finalScore !== null) throw new Error('Cannot change a finalized hand score.');
  accumulator.xMultFactors.push(structuredClone(factor));
  accumulator.currentXMult = Number(accumulator.xMultFactors.map(item => item.value).sort((a, b) => a - b)
    .reduce((product, value) => product * value, 1).toFixed(12));
}

export function finalizeHandScore(accumulator: HandScoreAccumulator, bossFactor = 1) {
  if (accumulator.finalScore !== null) throw new Error('Hand score already finalized.');
  accumulator.bossFactor = bossFactor;
  const { rawScore, finalScore } = finalizeScore(accumulator.currentPips, accumulator.currentMultiplier, accumulator.currentXMult * bossFactor);
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
