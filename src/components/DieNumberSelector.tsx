import { Button, Text } from '@mantine/core';
import type { Rank } from '../game/types';

const NUMBERS = [1, 2, 3, 4, 5, 6] as const;

/** Shared compact control for independently configurable die-effect numbers. */
export function DieNumberSelector({ label, value, onChange, disabled = false, optionDisabled, testId }: {
  label: string;
  value: Exclude<Rank, 7> | null;
  onChange: (number: Exclude<Rank, 7>) => void;
  disabled?: boolean;
  optionDisabled?: (number: Exclude<Rank, 7>) => boolean;
  testId?: string;
}) {
  return <fieldset className="die-number-selector" disabled={disabled} data-testid={testId}>
    <Text component="legend" size="xs" fw={800}>{label}</Text>
    <div className="die-number-options">
      {NUMBERS.map(number => <Button key={number} type="button" size="compact-sm"
        variant={value === number ? 'filled' : 'default'} aria-pressed={value === number}
        aria-label={`${label}: ${number}`} disabled={disabled || optionDisabled?.(number)}
        onClick={() => onChange(number)}>{number}</Button>)}
    </div>
  </fieldset>;
}
