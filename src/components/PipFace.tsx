import type { Rank } from '../game/types';

const PIP_POSITIONS: Record<Rank, string[]> = {
  1: ['center'],
  2: ['top-left', 'bottom-right'],
  3: ['top-left', 'center', 'bottom-right'],
  4: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  5: ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'],
  6: ['top-left', 'middle-left', 'bottom-left', 'top-right', 'middle-right', 'bottom-right'],
  7: ['top-left', 'middle-left', 'bottom-left', 'center', 'top-right', 'middle-right', 'bottom-right'],
};

export function PipFace({ value, label, compact = false }: { value: Rank; label: string; compact?: boolean }) {
  return <span className={`pip-face pip-face-${value}${compact ? ' compact' : ''}`} role="img" aria-label={label} data-value={value}>
    {PIP_POSITIONS[value].map(position => <span key={position} className={`pip pip-${position}`} aria-hidden="true" />)}
  </span>;
}

export const pipPositions = (value: Rank) => [...PIP_POSITIONS[value]];
