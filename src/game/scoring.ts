import { CONFIG } from './config';
import { activeFace, baseScoringPips, scoringPips } from './dice';
import { stacks } from './enhancements';
import { handStats } from './hands';
import type { Die, Face, HandId, HandScoreAccumulator } from './types';

export interface HandScoreContribution {
  kind: 'base' | 'bonus' | 'multiplier' | 'hitchhiker';
  dieId: number;
  face: Face;
  amount: number;
}

export function createHandAccumulator(hand: HandId, dieIds: number[], level = 1): HandScoreAccumulator {
  const stats = handStats(hand, level);
  return { hand, handLevel: level, dieIds: [...dieIds].sort((a, b) => a - b),
    basePips: stats.basePips, baseMultiplier: stats.baseMultiplier,
    currentPips: stats.basePips, currentMultiplier: stats.baseMultiplier,
    bonusPips: 0, hitchhikerPips: 0, rawScore: null, finalScore: null };
}

export function finalizeScore(pips: number, multiplier: number) {
  const rawScore = pips * multiplier;
  return { rawScore, finalScore: Math.round(rawScore) };
}

// Capture all scoring faces before Workout changes any physical face.
export function handContributions(dice: Die[], dieIds: number[]): HandScoreContribution[] {
  const faces = [...dice].sort((a, b) => a.id - b.id)
    .map(die => ({ dieId: die.id, face: structuredClone(activeFace(die)) }));
  const participants = faces.filter(item => dieIds.includes(item.dieId));
  return [
    ...participants.map(item => ({ ...item, kind: 'base' as const, amount: baseScoringPips(item.face) })),
    ...participants.filter(item => stacks(item.face, 'bonus')).map(item => ({
      ...item, kind: 'bonus' as const, amount: stacks(item.face, 'bonus') * CONFIG.bonusPips,
    })),
    ...participants.filter(item => stacks(item.face, 'multiplier')).map(item => ({
      ...item, kind: 'multiplier' as const, amount: stacks(item.face, 'multiplier') * CONFIG.multiplierIncrement,
    })),
    ...faces.filter(item => !dieIds.includes(item.dieId) && stacks(item.face, 'hitchhiker')).map(item => ({
      ...item, kind: 'hitchhiker' as const, amount: scoringPips(item.face),
    })),
  ];
}

export function applyHandContribution(accumulator: HandScoreAccumulator, contribution: HandScoreContribution): void {
  if (accumulator.finalScore !== null) throw new Error('Cannot change a finalized hand score.');
  if (contribution.kind === 'multiplier') accumulator.currentMultiplier += contribution.amount;
  else accumulator.currentPips += contribution.amount;
  if (contribution.kind === 'bonus') accumulator.bonusPips += contribution.amount;
  if (contribution.kind === 'hitchhiker') {
    accumulator.hitchhikerPips += contribution.amount;
    accumulator.bonusPips += stacks(contribution.face, 'bonus') * CONFIG.bonusPips;
  }
}

export function finalizeHandScore(accumulator: HandScoreAccumulator) {
  if (accumulator.finalScore !== null) throw new Error('Hand score already finalized.');
  const { rawScore, finalScore } = finalizeScore(accumulator.currentPips, accumulator.currentMultiplier);
  accumulator.rawScore = rawScore;
  accumulator.finalScore = finalScore;
  return { pips: accumulator.currentPips, multiplier: accumulator.currentMultiplier, rawScore, score: finalScore };
}

export function handScore(dice: Die[], hand: HandId, dieIds: number[], level = 1) {
  const accumulator = createHandAccumulator(hand, dieIds, level);
  for (const contribution of handContributions(dice, dieIds)) applyHandContribution(accumulator, contribution);
  return finalizeHandScore(accumulator);
}
export function standaloneScore(face: Face) {
  const pips = scoringPips(face);
  const multiplier = CONFIG.standaloneMultiplier + stacks(face, 'multiplier') * CONFIG.multiplierIncrement;
  const { rawScore, finalScore } = finalizeScore(pips, multiplier);
  return { pips, multiplier, rawScore, score: finalScore };
}
