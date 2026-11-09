import { describe, expect, it } from 'vitest';
import { createCollectibleDie } from './dice';
import { combinationsForHand, handStats } from './hands';
import type { Die, HandId, Rank } from './types';
import { createBossRuntime, wardenNaturalHands } from './bosses';
import { HAND_FAMILY_FLAMES, PROGRESSIVE_FLAME_SEQUENCES } from './flames';

const dice = (values: number[]): Die[] => values.map((value, index) => {
  const die = createCollectibleDie(index);
  die.value = value as Rank;
  return die;
});
const qualifies = (values: number[], hand: HandId) => combinationsForHand(dice(values), hand).length > 0;

describe('Inferno bonus Hands', () => {
  it.each([
    ['miniStraight', [2, 3, 4], true], ['miniStraight', [2, 4, 5], false],
    ['oddStraight', [1, 3, 5], true], ['oddStraight', [1, 3, 6], false],
    ['evenStraight', [2, 4, 6], true], ['evenStraight', [1, 4, 6], false],
    ['threePair', [1, 1, 3, 3, 6, 6], true], ['threePair', [1, 1, 1, 3, 6, 6], false],
    ['wideStraight', [2, 2, 3, 3, 4, 4], true], ['wideStraight', [1, 1, 3, 3, 4, 4], false],
    ['doubleTriple', [2, 2, 2, 5, 5, 5], true], ['doubleTriple', [2, 2, 2, 2, 5, 5], false],
    ['fullerHouse', [2, 2, 2, 2, 5, 5], true], ['fullerHouse', [2, 2, 2, 5, 5, 5], false],
    ['xlStraight', [1, 2, 3, 4, 5, 6], true], ['xlStraight', [1, 2, 3, 4, 5, 5], false],
    ['sixKind', [4, 4, 4, 4, 4, 4], true], ['sixKind', [4, 4, 4, 4, 4, 5], false],
  ] as [HandId, number[], boolean][])('%s qualification on %j is %s', (hand, values, expected) => {
    expect(qualifies(values, hand)).toBe(expected);
  });

  it('Odds and Evens require at least three and score every qualifying die', () => {
    expect(combinationsForHand(dice([1, 3, 5, 2, 4]), 'odds')).toEqual([[0, 1, 2]]);
    expect(combinationsForHand(dice([1, 3, 5, 2, 4, 6, 2]), 'evens')).toEqual([[3, 4, 5, 6]]);
    expect(qualifies([1, 3, 2, 4, 6], 'odds')).toBe(false);
  });

  it('Chance scores every player roster die and excludes temporary boss dice', () => {
    const roster = dice([1, 2, 3, 4, 5, 6, 1]);
    const boss = { ...createCollectibleDie(99), owner: 'boss' as const, encounterId: 'boss' } as Die;
    expect(combinationsForHand([...roster, boss], 'chance')).toEqual([[0, 1, 2, 3, 4, 5, 6]]);
  });

  it('six-die Hands choose exactly six qualifying dice from a seven-die roster', () => {
    const sevens = dice([1, 2, 3, 4, 5, 6, 6]);
    expect(combinationsForHand(sevens, 'xlStraight').every(combo => combo.length === 6)).toBe(true);
    expect(combinationsForHand(dice([3, 3, 3, 3, 3, 3, 4]), 'sixKind')).toEqual([[0, 1, 2, 3, 4, 5]]);
  });

  it('uses the existing multiplier progression for every starting Mult', () => {
    for (const hand of ['odds', 'chance', 'miniStraight', 'threePair', 'xlStraight', 'sixKind'] as HandId[]) {
      expect(handStats(hand, 2).handMultiplier).toBeGreaterThan(handStats(hand, 1).handMultiplier);
    }
  });

  it('includes unlocked Hands in generic boss pools', () => {
    const mugger = createBossRuntime('inferno-hands', 6, 'mugger', { eligibleHands: ['miniStraight'] });
    expect(mugger.type === 'mugger' && mugger.hiddenHand).toBe('miniStraight');
    expect(wardenNaturalHands(6, ['pair', 'sixKind'])).toEqual(['pair', 'sixKind']);
  });

  it('preserves every explicitly designed Flame identity and sequence', () => {
    expect(HAND_FAMILY_FLAMES).toEqual({
      doubleDown: { setup: 'pair', payoff: 'twoPair' },
      threesCompany: { setup: 'threeKind', payoff: 'fullHouse' },
      straightShooter: { setup: 'smallStraight', payoff: 'largeStraight' },
      boxSet: { setup: 'fourKind', payoff: 'fiveKind' },
    });
    expect(PROGRESSIVE_FLAME_SEQUENCES.countDown.hands).toEqual(['sixes', 'fives', 'fours', 'threes', 'twos', 'ones']);
    expect(PROGRESSIVE_FLAME_SEQUENCES.topDown.hands).toEqual([
      'fiveKind', 'largeStraight', 'fourKind', 'fullHouse', 'smallStraight', 'threeKind', 'twoPair', 'pair',
    ]);
  });
});
