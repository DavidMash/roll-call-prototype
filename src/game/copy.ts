import type { LastPlayDanger } from './bosses';
import { Decimal, scoreFromString, type ExactScore } from './scoreMath';

export const EMPTY_TEXT = {
  none: 'None',
  value: '—',
  enhancements: 'No Enhancements',
  flameSlot: 'Empty Flame Slot',
  score: 'No Score',
} as const;

const PLAYER_NUMBER_FORMAT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 3,
  useGrouping: true,
});

/** Formats a bounded ordinary number for player-facing copy. */
export const formatPlayerNumber = (value: number) => PLAYER_NUMBER_FORMAT.format(Object.is(value, -0) ? 0 : value);
/** Formats an exact score without any conversion through Number. */
export const formatExactScore = (value: ExactScore | string) => PLAYER_NUMBER_FORMAT.format(
  typeof value === 'bigint' ? value : scoreFromString(value),
);
export function formatExactDecimal(value: string): string {
  const rounded = new Decimal(value).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed();
  const [integer, fraction] = rounded.split('.');
  const grouped = formatExactScore(integer);
  return fraction ? `${grouped}.${fraction}` : grouped;
}
export const formatPercentage = (chance: number) => `${formatPlayerNumber(chance * 100)}%`;
export const formatScore = formatExactScore;
export const formatScoreProgress = (score: ExactScore, goal: ExactScore) => `${formatScore(score)} / ${formatScore(goal)}`;
export const formatScoreEquation = (pips: number, mult: number, xMult: number, total: ExactScore, inferno: ExactScore = 1n) =>
  `${inferno > 1n ? `${formatExactScore(inferno)} × ` : ''}${formatPlayerNumber(pips)} × ${formatPlayerNumber(mult)} × ${formatPlayerNumber(xMult)} = ${formatScore(total)}`;

export function playActionLabel(danger: LastPlayDanger, guaranteedWin: boolean): 'PLAY' | 'LAST PLAY?' | 'LAST PLAY.' {
  if (guaranteedWin || danger === 'none') return 'PLAY';
  return danger === 'definite' ? 'LAST PLAY.' : 'LAST PLAY?';
}
