import { describe, expect, it } from 'vitest';
import { formatPercentage, formatPlayerNumber, formatScoreEquation } from './copy';

describe('shared player-facing number formatting', () => {
  it.each([
    [234294572965, '234,294,572,965'],
    [7.9137, '7.914'],
    [2.6667, '2.667'],
    [4.500, '4.5'],
    [5.000, '5'],
    [3, '3'],
    [3.5, '3.5'],
    [3.25, '3.25'],
    [3.75, '3.75'],
    [10, '10'],
    [10.5, '10.5'],
    [-0, '0'],
  ] as const)('formats %s as %s', (value, expected) => {
    expect(formatPlayerNumber(value)).toBe(expected);
  });

  it('uses the same rules for percentages and score equations', () => {
    expect(formatPercentage(0.079137)).toBe('7.914%');
    expect(formatScoreEquation(1234.5, 2.6667, 4.5, 14814)).toBe('1,234.5 × 2.667 × 4.5 = 14,814');
  });
});
