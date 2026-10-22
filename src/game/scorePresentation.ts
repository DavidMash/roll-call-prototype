import { formatExactScore, formatPlayerNumber } from './copy';
import { FLAMES } from './flames';
import { HANDS } from './hands';
import { isSpecialDieType, SPECIAL_DICE } from './specialDice';
import { activeDieLabel } from './inventory';
import { BOSSES } from './bosses';
import type { GameEvent } from './types';
import type { ExactScore } from './scoreMath';

export type ScoreMetric = 'pips' | 'mult' | 'xmult' | 'final' | null;

export interface ScorePresentation {
  inferno: ExactScore;
  pips: number;
  mult: number;
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
    if (event.type === 'HAND_STARTED') callout = `${HANDS[accumulator.hand].name.toUpperCase()} · LV. ${formatPlayerNumber(accumulator.handLevel)} · BASE`;
    else if (event.type === 'HAND_PIPS_CHANGED') {
      activeMetric = 'pips';
      callout = isSpecialDieType(event.dieType)
        ? `${SPECIAL_DICE[event.dieType].name.toUpperCase()} +${amount(event.amount)}`
        : `${event.dieIds?.[0] === undefined ? 'DIE' : activeDieLabel(event.board, event.dieIds[0])} +${amount(event.amount)} PIPS`;
    } else if (event.type === 'HITCHHIKER_ADDED_PIPS') {
      activeMetric = 'pips';
      callout = isSpecialDieType(event.dieType)
        ? `${SPECIAL_DICE[event.dieType].name.toUpperCase()} +${amount(event.amount)}`
        : `HITCHHIKER +${amount(event.amount)}`;
    } else if (event.type === 'HAND_MULTIPLIER_CHANGED') {
      activeMetric = 'mult';
      callout = isSpecialDieType(event.dieType) ? SPECIAL_DICE[event.dieType].name.toUpperCase() : 'MULT UPDATED';
    } else if (event.type === 'SPECIAL_DIE_EFFECT') {
      callout = isSpecialDieType(event.dieType) ? SPECIAL_DICE[event.dieType].name.toUpperCase() : 'DIE EFFECT';
    } else if (event.type === 'HAND_XMULT_CHANGED') {
      activeMetric = 'xmult';
      const source = event.xMultFactor?.source;
      callout = `${source === 'charge' ? 'CHARGE' : source ? FLAMES[source].name.toUpperCase() : 'XMULT'} ×${amount(event.xMultFactor?.value)}`;
    } else if (event.type === 'HAND_SCORE_FINALIZED' || (event.type === 'SCORE_ADDED' && event.source === 'hand')) {
      activeMetric = 'final';
      callout = `+${amount(accumulator.finalScore ?? event.amount)}`;
    }
    return {
      inferno: accumulator.infernoMultiplier,
      pips: accumulator.currentPips,
      mult: accumulator.currentMultiplier,
      xMult: accumulator.currentXMult,
      bossFactor: accumulator.bossFactor,
      bossLabel: event.board.boss ? BOSSES[event.board.boss.type].name.replace(/^THE /, '') : 'BOSS MODIFIER',
      finalScore: accumulator.finalScore,
      showXMult: Math.abs(accumulator.currentXMult - 1) > 1e-9,
      activeMetric,
      callout,
    };
  }
  if (event.type !== 'STANDALONE_SCORE_CALCULATED') return null;
  const xMult = event.xMult ?? 1;
  return {
    inferno: 1n,
    pips: event.pips ?? 0,
    mult: event.multiplier ?? 0,
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
  const parts = score.inferno > 1n ? [`Inferno ${formatExactScore(score.inferno)}`] : [];
  parts.push(`Pips ${formatPlayerNumber(score.pips)}`, `Mult ${formatPlayerNumber(score.mult)}`);
  if (score.showXMult) parts.push(`XMult ${formatPlayerNumber(score.xMult)}`);
  if (score.bossFactor !== 1) parts.push(`Boss modifier ${formatPlayerNumber(score.bossFactor)}`);
  if (score.finalScore !== null) parts.push(`Final score ${formatExactScore(score.finalScore)}`);
  return parts.join('. ');
}
