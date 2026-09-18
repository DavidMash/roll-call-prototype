import { CONFIG } from './config';
import { activeFace, baseScoringPips, scoringPips } from './dice';
import { stacks } from './enhancements';
import { HANDS } from './hands';
import type { Die, Face, HandId, HandScoreAccumulator } from './types';

export interface HandScoreContribution {
  kind: 'base' | 'bonus' | 'multiplier' | 'hitchhiker';
  dieId: number;
  face: Face;
  amount: number;
}

export function createHandAccumulator(hand: HandId, dieIds: number[]): HandScoreAccumulator {
  const definition = HANDS[hand];
  return { hand, dieIds: [...dieIds].sort((a, b) => a - b),
    basePips: definition.basePips, baseMultiplier: definition.baseMultiplier,
    currentPips: definition.basePips, currentMultiplier: definition.baseMultiplier,
    bonusPips: 0, hitchhikerPips: 0, finalScore: null };
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
  accumulator.finalScore = accumulator.currentPips * accumulator.currentMultiplier;
  return { pips: accumulator.currentPips, multiplier: accumulator.currentMultiplier, score: accumulator.finalScore };
}

export function handScore(dice: Die[], hand: HandId, dieIds: number[]) {
  const accumulator = createHandAccumulator(hand, dieIds);
  for (const contribution of handContributions(dice, dieIds)) applyHandContribution(accumulator, contribution);
  return finalizeHandScore(accumulator);
}
export function standaloneScore(face: Face) {
  const pips = scoringPips(face);
  const multiplier = CONFIG.standaloneMultiplier + stacks(face, 'multiplier') * CONFIG.multiplierIncrement;
  return { pips, multiplier, score: pips * multiplier };
}
