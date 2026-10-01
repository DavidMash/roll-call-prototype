import type { LastPlayDanger } from './bosses';

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

/** Formats a number for player-facing copy without changing the underlying value. */
export const formatPlayerNumber = (value: number) => PLAYER_NUMBER_FORMAT.format(Object.is(value, -0) ? 0 : value);
export const formatPercentage = (chance: number) => `${formatPlayerNumber(chance * 100)}%`;
export const formatScore = formatPlayerNumber;
export const formatScoreProgress = (score: number, goal: number) => `${formatScore(score)} / ${formatScore(goal)}`;
export const formatScoreEquation = (pips: number, mult: number, xMult: number, total: number) =>
  `${formatPlayerNumber(pips)} × ${formatPlayerNumber(mult)} × ${formatPlayerNumber(xMult)} = ${formatScore(total)}`;

export function playActionLabel(danger: LastPlayDanger, guaranteedWin: boolean): 'PLAY' | 'LAST PLAY?' | 'LAST PLAY.' {
  if (guaranteedWin || danger === 'none') return 'PLAY';
  return danger === 'definite' ? 'LAST PLAY.' : 'LAST PLAY?';
}
