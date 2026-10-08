import { formatPlayerNumber } from './copy';
import { ENHANCEMENTS } from './enhancements';
import { FLAMES } from './flames';
import { HANDS } from './hands';
import type { GameEvent } from './types';

export type ScoreMetric = 'pips' | 'mult' | 'xmult' | 'final' | null;

export interface ScorePresentation {
  pips: number;
  mult: number;
  xMult: number;
  bossFactor: number;
  finalScore: number | null;
  showXMult: boolean;
  activeMetric: ScoreMetric;
  callout: string;
}

const amount = (value: number | undefined) => formatPlayerNumber(value ?? 0);

export function scorePresentation(event: GameEvent | null): ScorePresentation | null {
  if (!event) return null;
  const accumulator = event.handScore;
  if (accumulator) {
    let activeMetric: ScoreMetric = null;
    let callout = '';
    if (event.type === 'HAND_STARTED') callout = `${HANDS[accumulator.hand].name.toUpperCase()} · LV. ${formatPlayerNumber(accumulator.handLevel)} · BASE`;
    else if (event.type === 'HAND_PIPS_CHANGED') {
      activeMetric = 'pips';
      callout = event.enhancement
        ? `${ENHANCEMENTS[event.enhancement].name.toUpperCase()} +${amount(event.amount)}`
        : `${event.dieIds?.[0] === undefined ? 'DIE' : `D${event.dieIds[0] + 1}`} +${amount(event.amount)} PIPS`;
    } else if (event.type === 'HITCHHIKER_ADDED_PIPS') {
      activeMetric = 'pips';
      callout = event.enhancement
        ? `${ENHANCEMENTS[event.enhancement].name.toUpperCase()} +${amount(event.amount)}`
        : `HITCHHIKER +${amount(event.amount)}`;
    } else if (event.type === 'HAND_MULTIPLIER_CHANGED') {
      activeMetric = 'mult';
      callout = event.enhancement ? ENHANCEMENTS[event.enhancement].name.toUpperCase() : 'MULT UPDATED';
    } else if (event.type === 'WORKOUT_INCREMENTED') {
      callout = `WORKOUT +${amount(event.amount)} FUTURE ${event.amount === 1 ? 'PIP' : 'PIPS'}`;
    } else if (event.type === 'HAND_XMULT_CHANGED') {
      activeMetric = 'xmult';
      const source = event.xMultFactor?.source;
      callout = `${source === 'charge' ? 'CHARGE' : source ? FLAMES[source].name.toUpperCase() : 'XMULT'} ×${amount(event.xMultFactor?.value)}`;
    } else if (event.type === 'HAND_SCORE_FINALIZED' || (event.type === 'SCORE_ADDED' && event.source === 'hand')) {
      activeMetric = 'final';
      callout = `+${amount(accumulator.finalScore ?? event.amount)}`;
    }
    return {
      pips: accumulator.currentPips,
      mult: accumulator.currentMultiplier,
      xMult: accumulator.currentXMult,
      bossFactor: accumulator.bossFactor,
      finalScore: accumulator.finalScore,
      showXMult: Math.abs(accumulator.currentXMult - 1) > 1e-9,
      activeMetric,
      callout,
    };
  }
  if (event.type !== 'STANDALONE_SCORE_CALCULATED') return null;
  const xMult = event.xMult ?? 1;
  return {
    pips: event.pips ?? 0,
    mult: event.multiplier ?? 0,
    xMult,
    bossFactor: 1,
    finalScore: event.amount ?? null,
    showXMult: Math.abs(xMult - 1) > 1e-9,
    activeMetric: 'final',
    callout: `+${amount(event.amount)}`,
  };
}

export function scoreAnnouncement(score: ScorePresentation): string {
  const parts = [`Pips ${formatPlayerNumber(score.pips)}`, `Mult ${formatPlayerNumber(score.mult)}`];
  if (score.showXMult) parts.push(`XMult ${formatPlayerNumber(score.xMult)}`);
  if (score.bossFactor !== 1) parts.push(`Boss modifier ${formatPlayerNumber(score.bossFactor)}`);
  if (score.finalScore !== null) parts.push(`Final score ${formatPlayerNumber(score.finalScore)}`);
  return parts.join('. ');
}
