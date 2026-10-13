import { describe, expect, it } from 'vitest';
import { formatExactDecimal, formatExactScore } from './copy';
import {
  canonicalFactor, canonicalPips, exactDecimalRatio, exactInferno, exactWeightedFactorAverage,
  finalizeExactScore, roundPositiveRatioToStep, roundPositiveScoreHalf, roundScoreToStep,
  scoreFromLegacyNumber, scoreFromString, stringifyExactJson,
} from './scoreMath';

describe('exact score arithmetic', () => {
  it('computes exact Inferno powers through and beyond the old safe-integer boundary', () => {
    const expected = [
      '1', '25', '625', '15625', '390625', '9765625', '244140625', '6103515625',
      '152587890625', '3814697265625', '95367431640625', '2384185791015625',
      '59604644775390625', '1490116119384765625', '37252902984619140625',
    ];
    expect(expected.map((_, level) => exactInferno(level).toString())).toEqual(expected);
    const level221 = exactInferno(221);
    expect(typeof level221).toBe('bigint');
    expect(level221.toString()).toHaveLength(309);
  });

  it('imports only canonical half-Pips and 12-place score factors', () => {
    expect(canonicalPips(10.5)).toBe('10.5');
    expect(() => canonicalPips(10.25)).toThrow(/half-Pip/);
    expect(canonicalFactor(1.23456789012349)).toBe('1.234567890123');
    expect(canonicalFactor(2.25)).toBe('2.25');
  });

  it('multiplies huge fractional score inputs and rounds exactly once at the end', () => {
    const result = finalizeExactScore(exactInferno(12), .5, 1.25, 1.1);
    expect(result).toEqual({ rawScore: '40978193283081054.6875', finalScore: 40_978_193_283_081_055n });
  });

  it('keeps single-point increments and repeated accumulation above MAX_SAFE_INTEGER', () => {
    let score = 59_604_644_775_390_625n;
    for (let index = 0; index < 100; index++) score += 1n;
    expect(score).toBe(59_604_644_775_390_725n);
  });

  it('rounds huge scores, ratios, and halves without Number conversion', () => {
    const huge = 59_604_644_775_390_627n;
    expect(roundScoreToStep(huge, 5n)).toBe(59_604_644_775_390_625n);
    expect(roundPositiveRatioToStep(huge, 2n, 5n)).toBe(29_802_322_387_695_315n);
    expect(roundPositiveScoreHalf(huge)).toBe(29_802_322_387_695_314n);
  });

  it('calculates ratios and weighted averages from exact huge integer weights', () => {
    const a = 9_007_199_254_740_993n;
    const b = 900_719_925_474_099_300n;
    expect(exactDecimalRatio(a, b)).toBe('0.01');
    expect(exactWeightedFactorAverage([{ factor: 20, weight: b }, { factor: 1, weight: a }]))
      .toBeCloseTo((2000 + 1) / 101, 12);
  });

  it('serializes exact integers as canonical decimal strings', () => {
    const raw = stringifyExactJson({ score: exactInferno(12), nested: [0n, 10n ** 30n] });
    expect(raw).toBe('{"score":"59604644775390625","nested":["0","1000000000000000000000000000000"]}');
    expect(JSON.parse(raw)).toEqual({ score: '59604644775390625', nested: ['0', '1000000000000000000000000000000'] });
  });

  it('preserves legacy unsafe-number approximations without inventing lost digits', () => {
    const legacy = Number('59604644775390625');
    expect(legacy.toString()).toBe('59604644775390620');
    expect(scoreFromLegacyNumber(legacy)).toBe(59_604_644_775_390_620n);
    expect(scoreFromString('59604644775390625')).toBe(59_604_644_775_390_625n);
  });
});

describe('exact score formatting', () => {
  it.each([
    [0n, '0'], [1n, '1'], [1_000n, '1,000'], [1_000_000n, '1,000,000'],
    [BigInt(Number.MAX_SAFE_INTEGER), '9,007,199,254,740,991'],
    [BigInt(Number.MAX_SAFE_INTEGER) + 1n, '9,007,199,254,740,992'],
    [59_604_644_775_390_625n, '59,604,644,775,390,625'],
    [10n ** 30n, '1,000,000,000,000,000,000,000,000,000,000'],
  ])('formats %s without scientific notation or dropped digits', (value, expected) => {
    expect(formatExactScore(value)).toBe(expected);
  });

  it('formats exact decimal audit values without converting the integer portion to Number', () => {
    expect(formatExactDecimal('59604644775390625.6875')).toBe('59,604,644,775,390,625.688');
  });
});
