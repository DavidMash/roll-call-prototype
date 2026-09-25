import type { Board, BossType } from './types';

export type ScreenThemeId = 'round' | 'shop' | 'flame' | BossType;
export interface ScreenTheme {
  id: ScreenThemeId;
  label: string;
  icon: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  backgroundGlow: string;
  border: string;
  progress: string;
  nodeColor: string;
}

const theme = (id: ScreenThemeId, label: string, icon: string, accent: string, secondary: string): ScreenTheme => ({
  id, label, icon, accent, accentStrong: secondary,
  accentSoft: `color-mix(in srgb, ${accent} 16%, transparent)`,
  backgroundGlow: `color-mix(in srgb, ${accent} 13%, transparent)`,
  border: `color-mix(in srgb, ${accent} 36%, transparent)`,
  progress: accent,
  nodeColor: accent,
});

export const SCREEN_THEMES: Record<ScreenThemeId, ScreenTheme> = {
  round: theme('round', 'NORMAL ROUND', '◈', '#3B82F6', '#60A5FA'),
  shop: theme('shop', 'SHOP', '●', '#F59E0B', '#FBBF24'),
  flame: theme('flame', 'FLAME SELECTION', '🔥', '#EF4444', '#F97316'),
  caller: theme('caller', 'THE CALLER', '◉', '#A855F7', '#D946EF'),
  warden: theme('warden', 'THE WARDEN', '🔒', '#06B6D4', '#14B8A6'),
  hexer: theme('hexer', 'THE HEXER', '⦿', '#84CC16', '#D9F99D'),
  marathon: theme('marathon', 'THE MARATHON', '↻', '#F97316', '#FDBA74'),
  quickdraw: theme('quickdraw', 'QUICKDRAW', '✦', '#EAB308', '#FDE047'),
  fly: theme('fly', 'THE FLY', '●', '#92400E', '#D97706'),
  snakeEyes: theme('snakeEyes', 'SNAKE EYES', '⚁', '#16A34A', '#4ADE80'),
  infected: theme('infected', 'THE INFECTED', '✣', '#DC2626', '#FB7185'),
};

export function screenThemeId(board: Pick<Board, 'phase' | 'boss' | 'roundSummary'>): ScreenThemeId {
  if (board.phase === 'shop') return 'shop';
  if (board.phase === 'flameSelection') return 'flame';
  if (board.phase === 'roundSummary' && board.roundSummary?.bossType) return board.roundSummary.bossType;
  if (board.phase === 'round' && board.boss) return board.boss.type;
  return 'round';
}
export const screenTheme = (board: Pick<Board, 'phase' | 'boss' | 'roundSummary'>) => SCREEN_THEMES[screenThemeId(board)];
