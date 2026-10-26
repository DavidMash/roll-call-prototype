import { formatExactScore, formatPlayerNumber } from './copy';
import { FLAMES } from './flames';
import { HANDS } from './hands';
import { isSpecialDieType, SPECIAL_DICE } from './specialDice';
import { activeDieLabel } from './inventory';
import { BOSSES } from './bosses';
import type { GameEvent } from './types';
import type { ExactScore } from './scoreMath';

export type ScoreMetric = 'pips' | 'mult' | 'xmult' | 'inferno' | 'final' | null;

export interface ScorePresentation {
  inferno: ExactScore;
  showInferno: boolean;
  pips: number;
  mult: number;
  showHandMult: boolean;
  xMult: number;
  bossFactor: number;
  bossLabel: string;
  finalScore: ExactScore | null;
  showXMult: boolean;
  activeMetric: ScoreMetric;
  callout: string;
}

const amount = (value: number | ExactScore | undefined) => typeof value === 'bigint'
  ? formatExactScore(value) : formatPlayerNumber(value ?? 0);

export function scorePresentation(event: GameEvent | null): ScorePresentation | null {
  if (!event) return null;
  const accumulator = event.handScore;
  if (accumulator) {
    let activeMetric: ScoreMetric = null;
    let callout = '';
    if (event.type === 'HAND_STARTED') callout = `${HANDS[accumulator.hand].name.toUpperCase()} · LV. ${formatPlayerNumber(accumulator.handLevel)}`;
    else if (event.type === 'DIE_PIPS_RESOLVED') {
      activeMetric = 'pips';
      const prefix = event.resolvedDiePips?.role === 'hitchhiker' ? 'HITCHHIKER' : event.dieIds?.[0] === undefined
        ? 'DIE' : activeDieLabel(event.board, event.dieIds[0]);
      callout = `${prefix} +${amount(event.amount)} PIPS`;
    } else if (event.type === 'HAND_MULTIPLIER_CHANGED') {
      activeMetric = 'mult';
      callout = isSpecialDieType(event.dieType) ? SPECIAL_DICE[event.dieType].name.toUpperCase() : 'MULT UPDATED';
    } else if (event.type === 'SPECIAL_DIE_EFFECT') {
      callout = isSpecialDieType(event.dieType) ? SPECIAL_DICE[event.dieType].name.toUpperCase() : 'DIE EFFECT';
    } else if (event.type === 'HAND_XMULT_CHANGED') {
      activeMetric = 'xmult';
      const source = event.xMultFactor?.source;
      callout = `${source === 'charge' ? 'CHARGE' : source ? FLAMES[source].name.toUpperCase() : 'XMULT'} ×${amount(event.xMultFactor?.value)}`;
    } else if (event.type === 'HAND_INFERNO_APPLIED') {
      activeMetric = 'inferno';
      callout = `INFERNO ×${amount(accumulator.infernoMultiplier)}`;
    } else if (event.type === 'HAND_SCORE_FINALIZED' || (event.type === 'SCORE_ADDED' && event.source === 'hand')) {
      activeMetric = 'final';
      callout = `+${amount(accumulator.finalScore ?? event.amount)}`;
    }
    return {
      inferno: accumulator.infernoMultiplier,
      showInferno: event.type === 'HAND_INFERNO_APPLIED' || event.type === 'HAND_SCORE_FINALIZED' || event.type === 'SCORE_ADDED',
      pips: accumulator.currentPips,
      mult: accumulator.currentMultiplier,
      showHandMult: event.type === 'HAND_MULTIPLIER_CHANGED' || event.type === 'HAND_XMULT_CHANGED'
        || event.type === 'HAND_SCORE_FINALIZED' || event.type === 'SCORE_ADDED',
      xMult: accumulator.currentXMult,
      bossFactor: accumulator.bossFactor,
      bossLabel: event.board.boss ? BOSSES[event.board.boss.type].name.replace(/^THE /, '') : 'BOSS MODIFIER',
      finalScore: event.type === 'HAND_SCORE_FINALIZED' || event.type === 'SCORE_ADDED' ? accumulator.finalScore : null,
      showXMult: Math.abs(accumulator.currentXMult - 1) > 1e-9,
      activeMetric,
      callout,
    };
  }
  if (event.type !== 'STANDALONE_SCORE_CALCULATED') return null;
  const xMult = event.xMult ?? 1;
  return {
    inferno: 1n,
    showInferno: false,
    pips: event.pips ?? 0,
    mult: event.multiplier ?? 0,
    showHandMult: true,
    xMult,
    bossFactor: 1,
    bossLabel: 'BOSS MODIFIER',
    finalScore: typeof event.amount === 'bigint' ? event.amount : event.amount === undefined ? null : BigInt(event.amount),
    showXMult: Math.abs(xMult - 1) > 1e-9,
    activeMetric: 'final',
    callout: `+${amount(event.amount)}`,
  };
}

export function scoreAnnouncement(score: ScorePresentation): string {
  const parts = [`Pips ${formatPlayerNumber(score.pips)}`];
  if (score.showHandMult) parts.push(`Mult ${formatPlayerNumber(score.mult)}`);
  if (score.showXMult) parts.push(`XMult ${formatPlayerNumber(score.xMult)}`);
  if (score.showInferno && score.inferno > 1n) parts.push(`Inferno ${formatExactScore(score.inferno)}`);
  if (score.bossFactor !== 1) parts.push(`Boss modifier ${formatPlayerNumber(score.bossFactor)}`);
  if (score.finalScore !== null) parts.push(`Final score ${formatExactScore(score.finalScore)}`);
  return parts.join('. ');
}
