import Decimal from 'decimal.js';

/** Authoritative finalized score-domain integer. Never coerce this to number. */
export type ExactScore = bigint;
/** Stable decimal representation for fractional audit/history values. */
export type ExactDecimal = string;

export const SCORE_ZERO: ExactScore = 0n;
export const SCORE_ONE: ExactScore = 1n;
/** Resource ceiling only; normal and tested deep runs are many orders below it. */
export const MAX_EXACT_DIGITS = 1_000_000;

const INTEGER_TEXT = /^-?(?:0|[1-9]\d*)$/;

export function scoreFromString(value: string): ExactScore {
  if (!INTEGER_TEXT.test(value)) throw new Error(`Invalid canonical score integer: ${value}`);
  return BigInt(value);
}

export const scoreToString = (value: ExactScore): string => value.toString(10);
export const scoreCompare = (left: ExactScore, right: ExactScore): -1 | 0 | 1 => left < right ? -1 : left > right ? 1 : 0;
export const scoreMin = (...values: ExactScore[]): ExactScore => values.reduce((best, value) => value < best ? value : best);
export const scoreMax = (...values: ExactScore[]): ExactScore => values.reduce((best, value) => value > best ? value : best);
export const scoreAbs = (value: ExactScore): ExactScore => value < 0n ? -value : value;
export const scoreIsZero = (value: ExactScore): boolean => value === 0n;

/**
 * Converts a numeric fixture/input without claiming to recover already-lost bits.
 * Safe integers are exact. Unsafe values preserve Number's shortest serialized
 * decimal approximation, expanded out of scientific notation.
 */
export function scoreFromLegacyNumber(value: number): ExactScore {
  if (!Number.isFinite(value) || !Number.isInteger(value)) throw new Error(`Invalid score integer: ${value}`);
  if (Number.isSafeInteger(value)) return BigInt(value);
  return BigInt(new Decimal(value.toString()).toFixed(0));
}

export function scoreFromUnknown(value: unknown): ExactScore {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') return scoreFromString(value);
  if (typeof value === 'number') return scoreFromLegacyNumber(value);
  throw new Error('Expected an exact score integer.');
}

export const exactJsonReplacer = (_key: string, value: unknown) => typeof value === 'bigint' ? value.toString(10) : value;
export const stringifyExactJson = (value: unknown, space?: number): string => JSON.stringify(value, exactJsonReplacer, space);

export function toExactJsonValue<T>(value: T): T {
  if (typeof value === 'bigint') return value.toString(10) as T;
  if (Array.isArray(value)) return value.map(item => toExactJsonValue(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, toExactJsonValue(item)]),
  ) as T;
  return value;
}

/** Current gameplay deliberately quantizes Mult/XMult paths to 12 places. */
export function canonicalFactor(value: number, decimalPlaces = 12): string {
  if (!Number.isFinite(value)) throw new Error(`Invalid score factor: ${value}`);
  const fixed = value.toFixed(decimalPlaces);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** Pips currently have exact half-unit semantics. */
export function canonicalPips(value: number): string {
  if (!Number.isFinite(value) || Math.round(value * 2) !== value * 2) throw new Error(`Invalid half-Pip value: ${value}`);
  return value.toFixed(1).replace(/\.0$/, '');
}

function significantDigits(value: string): number {
  return Math.max(1, value.replace(/[-+.eE]/g, '').replace(/^0+/, '').length);
}

function decimalContext(values: readonly string[], extra = 24): typeof Decimal {
  const precision = Math.max(80, values.reduce((sum, value) => sum + significantDigits(value), 0) + extra);
  if (precision > MAX_EXACT_DIGITS) throw new Error('Exact score exceeds the supported resource guard.');
  return Decimal.clone({ precision, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -1_000_000, toExpPos: 1_000_000 });
}

export function exactInferno(level: number): ExactScore {
  if (!Number.isSafeInteger(level) || level < 0) throw new Error('Inferno level must be a non-negative safe integer.');
  if (level > Math.floor((MAX_EXACT_DIGITS - 1) / Math.log10(25)))
    throw new Error('Inferno exceeds the supported resource guard.');
  return 25n ** BigInt(level);
}

/** Preserves the existing logical multiplication order and one final positive round. */
export function finalizeExactScore(
  inferno: ExactScore,
  pips: number,
  multiplier: number,
  xMult: number,
): { rawScore: ExactDecimal; finalScore: ExactScore } {
  if (inferno < 0n) throw new Error('Inferno cannot be negative.');
  const parts = [scoreToString(inferno), canonicalPips(pips), canonicalFactor(multiplier), canonicalFactor(xMult)];
  const D = decimalContext(parts);
  const raw = new D(parts[0]).times(parts[1]).times(parts[2]).times(parts[3]);
  return { rawScore: raw.toFixed(), finalScore: BigInt(raw.toDecimalPlaces(0, D.ROUND_HALF_UP).toFixed(0)) };
}

export function exactDecimalRatio(numerator: ExactScore, denominator: ExactScore, precision = 40): string {
  if (denominator === 0n) throw new Error('Cannot divide by zero.');
  const D = Decimal.clone({ precision: Math.max(precision, 24), rounding: Decimal.ROUND_HALF_UP,
    toExpNeg: -1_000_000, toExpPos: 1_000_000 });
  return new D(numerator.toString()).div(denominator.toString()).toSignificantDigits(precision).toFixed();
}

export function exactRatioNumber(numerator: ExactScore, denominator: ExactScore): number {
  return Number(exactDecimalRatio(numerator, denominator));
}

export function exactWeightedFactorAverage(observations: readonly { factor: number; weight: ExactScore }[]): number {
  const positive = observations.filter(item => item.weight > 0n);
  if (!positive.length) return 1;
  const values = positive.flatMap(item => [item.weight.toString(), canonicalFactor(Math.max(1, item.factor))]);
  const D = decimalContext(values);
  const totalWeight = positive.reduce((sum, item) => sum + item.weight, 0n);
  const weighted = positive.reduce((sum, item) =>
    sum.plus(new D(item.weight.toString()).times(canonicalFactor(Math.max(1, item.factor)))), new D(0));
  return Number(weighted.div(totalWeight.toString()).toDecimalPlaces(12, D.ROUND_HALF_UP).toFixed());
}

/** Nearest positive step with ties rounded upward, matching Math.round for non-negative values. */
export function roundScoreToStep(value: ExactScore, step: ExactScore): ExactScore {
  if (value < 0n || step <= 0n) throw new Error('Nearest-step score rounding requires a non-negative value and positive step.');
  const quotient = value / step;
  const remainder = value % step;
  return (remainder * 2n >= step ? quotient + 1n : quotient) * step;
}

export function roundPositiveRatioToStep(numerator: ExactScore, denominator: ExactScore, step: ExactScore): ExactScore {
  if (numerator < 0n || denominator <= 0n || step <= 0n)
    throw new Error('Ratio-to-step rounding requires non-negative numerator and positive denominator/step.');
  const scaledDenominator = denominator * step;
  const quotient = numerator / scaledDenominator;
  const remainder = numerator % scaledDenominator;
  return (remainder * 2n >= scaledDenominator ? quotient + 1n : quotient) * step;
}

/** Positive score division by two using Math.round-compatible half-up behavior. */
export function roundPositiveScoreHalf(value: ExactScore): ExactScore {
  if (value < 0n) throw new Error('Score halving requires a non-negative score.');
  return (value + 1n) / 2n;
}

export function decimalConstructorForDigits(integerDigits: number, guardDigits = 64): typeof Decimal {
  if (!Number.isSafeInteger(integerDigits) || integerDigits < 1 || integerDigits + guardDigits > MAX_EXACT_DIGITS)
    throw new Error('Requested decimal precision is outside the supported resource guard.');
  return Decimal.clone({ precision: Math.max(80, integerDigits + guardDigits), rounding: Decimal.ROUND_HALF_UP,
    toExpNeg: -1_000_000, toExpPos: 1_000_000 });
}

export { Decimal };
