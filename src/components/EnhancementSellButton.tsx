import { Button } from '@mantine/core';
import { formatPlayerNumber } from '../game/copy';

export function EnhancementSellButton({ value, ariaLabel, disabled = false, variant = 'light', onClick }: {
  value: number;
  ariaLabel: string;
  disabled?: boolean;
  variant?: 'filled' | 'light';
  onClick: () => void;
}) {
  return <Button className="enhancement-sell-button" size="compact-sm" variant={variant} color="red"
    disabled={disabled} aria-label={ariaLabel} onClick={onClick}>
    <span className="enhancement-sell-button-content">
      <span className="enhancement-sell-button-label">Sell</span>
      <span className="enhancement-sell-button-value">{formatPlayerNumber(value)} Gold</span>
    </span>
  </Button>;
}
