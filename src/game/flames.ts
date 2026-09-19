import { ENHANCEMENT_IDS } from './enhancements';
import { HAND_IDS, UPPER_HAND_IDS } from './hands';
import type { Die, Flame, GameState, HandId } from './types';

export const FLAMES: Record<Flame, { name: string; shortName: string; description: string; affectsXMult: boolean }> = {
  ultimate: { name: 'Ultimate', shortName: 'ULT', affectsXMult: true, description: 'If this die scores in a hand tied for the highest current hand level, multiply XMult by 2.' },
  minigun: { name: 'Minigun', shortName: 'MINI', affectsXMult: true, description: 'If this die scores in an Upper-section hand, multiply XMult by 2.' },
  tripleUp: { name: 'Triple-Up', shortName: '3UP', affectsXMult: false, description: 'Stackable face enhancements bought for this die apply 3 stacks instead of 1.' },
  hailMary: { name: 'Hail Mary', shortName: 'HAIL', affectsXMult: true, description: 'If this die scores with 0 manual rerolls remaining at hand start, multiply XMult by 2.' },
  clockwork: { name: 'Clockwork', shortName: 'CLOCK', affectsXMult: false, description: 'Every real roll advances this die exactly one face instead of rolling randomly.' },
  charge: { name: 'Charge', shortName: 'CHG', affectsXMult: true, description: 'Each gameplay roll stores +0.5 XMult for the next played hand, then resets.' },
  doubleEncore: { name: 'Double Encore', shortName: '2ENC', affectsXMult: false, description: 'The first hand this die scores in each round gains 2 finite bonus uses.' },
  personalTrainer: { name: 'Personal Trainer', shortName: 'TRAIN', affectsXMult: false, description: 'If this die scores in the hand that clears the round, that hand gains 1 level afterward.' },
  looseCannon: { name: 'Loose Cannon', shortName: 'LOOSE', affectsXMult: true, description: 'Independent scoring events from this die multiply XMult by 2.' },
  dragonsHoard: { name: "Dragon's Hoard", shortName: 'HOARD', affectsXMult: true, description: 'When this die scores, add 0.05 XMult per Gold held at hand start.' },
  bloated: { name: 'Bloated', shortName: 'BLOAT', affectsXMult: true, description: 'When this die scores, add 0.1 XMult per enhancement stack across all six of its faces.' },
  wellTrained: { name: 'Well Trained', shortName: 'WELL', affectsXMult: true, description: 'When this die scores, add 0.1 XMult per previous run-wide play of that hand.' },
  targetPractice: { name: 'Target Practice', shortName: 'TARGET', affectsXMult: true, description: 'If this die scores in the fixed targeted Lower hand, multiply XMult by 3.' },
};
export const FLAME_IDS = Object.keys(FLAMES) as Flame[];
export const XMult_FLAME_IDS = FLAME_IDS.filter(flame => FLAMES[flame].affectsXMult);
export const hasXMultFlame = (dice: Die[]) => dice.some(die => die.flame && FLAMES[die.flame].affectsXMult);
export const enhancementStackCount = (die: Die) => die.faces.reduce((sum, face) =>
  sum + ENHANCEMENT_IDS.reduce((faceSum, enhancement) => faceSum + (face.enhancements[enhancement] ?? 0), 0), 0);

export interface HandStartSnapshot {
  gold: number;
  manualRerollsRemaining: number;
  previousPlays: number;
  highestHandLevel: number;
  targetPracticeHand: HandId | null;
  dice: { dieId: number; flame: Flame | null; chargeXMult: number; enhancementStacks: number }[];
}
export interface XMultContribution { dieId: number; flame: Flame; mode: 'additive' | 'multiplicative'; value: number }

export function captureHandStart(state: Pick<GameState, 'gold' | 'manualRerollsRemaining' | 'handPlayCounts' | 'handLevels' | 'targetPracticeHand' | 'dice'>, hand: HandId): HandStartSnapshot {
  return {
    gold: state.gold,
    manualRerollsRemaining: state.manualRerollsRemaining,
    previousPlays: state.handPlayCounts[hand],
    highestHandLevel: Math.max(...HAND_IDS.map(id => state.handLevels[id])),
    targetPracticeHand: state.targetPracticeHand,
    dice: state.dice.map(die => ({ dieId: die.id, flame: die.flame, chargeXMult: die.chargeXMult, enhancementStacks: enhancementStackCount(die) })),
  };
}

export function handXMultContributions(snapshot: HandStartSnapshot, hand: HandId, handLevel: number, scoringDieIds: number[]): XMultContribution[] {
  const scoring = new Set(scoringDieIds);
  const upper = UPPER_HAND_IDS.includes(hand);
  const result: XMultContribution[] = [];
  for (const die of snapshot.dice) {
    if (die.flame === 'charge' && die.chargeXMult > 0) result.push({ dieId: die.dieId, flame: 'charge', mode: 'additive', value: die.chargeXMult });
    if (!scoring.has(die.dieId) || !die.flame) continue;
    switch (die.flame) {
      case 'ultimate':
        if (handLevel === snapshot.highestHandLevel) result.push({ dieId: die.dieId, flame: die.flame, mode: 'multiplicative', value: 2 });
        break;
      case 'minigun':
        if (upper) result.push({ dieId: die.dieId, flame: die.flame, mode: 'multiplicative', value: 2 });
        break;
      case 'hailMary':
        if (snapshot.manualRerollsRemaining === 0) result.push({ dieId: die.dieId, flame: die.flame, mode: 'multiplicative', value: 2 });
        break;
      case 'dragonsHoard': result.push({ dieId: die.dieId, flame: die.flame, mode: 'additive', value: snapshot.gold * 0.05 }); break;
      case 'bloated': result.push({ dieId: die.dieId, flame: die.flame, mode: 'additive', value: die.enhancementStacks * 0.1 }); break;
      case 'wellTrained': result.push({ dieId: die.dieId, flame: die.flame, mode: 'additive', value: snapshot.previousPlays * 0.1 }); break;
      case 'targetPractice':
        if (hand === snapshot.targetPracticeHand) result.push({ dieId: die.dieId, flame: die.flame, mode: 'multiplicative', value: 3 });
        break;
    }
  }
  return result;
}

export const composeXMult = (additive: number, multiplicative: number) =>
  Number(((1 + additive) * multiplicative).toFixed(12));
