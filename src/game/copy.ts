import type { LastPlayDanger } from './bosses';

export const EMPTY_TEXT = {
  none: 'None',
  value: '—',
  enhancements: 'No Enhancements',
  flameSlot: 'Empty Flame Slot',
  score: 'No Score',
} as const;

export const formatScore = (value: number) => value.toLocaleString('en-US');
export const formatScoreProgress = (score: number, goal: number) => `${formatScore(score)} / ${formatScore(goal)}`;
export const formatScoreEquation = (pips: number, mult: number, xMult: number, total: number) =>
  `${pips} × ${mult} × ${xMult} = ${formatScore(total)}`;

export function playActionLabel(danger: LastPlayDanger, guaranteedWin: boolean): 'PLAY' | 'LAST PLAY?' | 'LAST PLAY.' {
  if (guaranteedWin || danger === 'none') return 'PLAY';
  return danger === 'definite' ? 'LAST PLAY.' : 'LAST PLAY?';
}
