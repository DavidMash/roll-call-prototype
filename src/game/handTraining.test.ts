import { describe, expect, it } from 'vitest';
import { dispatch, newRun, validateAction } from './engine';
import {
  HAND_IDS, HAND_MULT_EXPONENT, handStats, LOWER_HAND_IDS, roundToNearestQuarter,
  startingBasePips, UPPER_HAND_IDS,
} from './hands';
import { handScore } from './scoring';
import { createTrainingSession, quoteTraining, roundedTrainingBaseline } from './training';
import { resetDieRoundState } from './specialDice';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import type { GameState, HandId, HandLevels, Rank } from './types';

const constant = (value = 0.99) => ({ next: () => value });
const expectedLevelOne: Record<HandId, [number, number]> = {
  ones: [7, 1], twos: [7, 1], threes: [7, 1], fours: [7, 1], fives: [7, 1], sixes: [7, 1],
  pair: [8, 1.5], twoPair: [9, 2], threeKind: [10, 2.5], smallStraight: [10, 2.5],
  fullHouse: [12, 3.5], fourKind: [13, 4], largeStraight: [13, 4], fiveKind: [15, 5],
};

function shopState(gold = 200, levels?: Partial<HandLevels>): GameState {
  const game = newRun('training-shop', constant()).state;
  game.phase = 'shop'; game.gold = gold;
  Object.assign(game.handLevels, levels);
  game.shop = { visitId: 7, stage: 'training', offers: [],
    offerRerolls: 0, lifeRestores: 0, trainingSession: createTrainingSession(game.handLevels) };
  return game;
}

describe('derived hand levels', () => {
  it('preserves every exact Level 1 Base Pips and Base Mult value', () => {
    expect(HAND_IDS).toHaveLength(14);
    for (const hand of HAND_IDS) {
      const [basePips, baseMultiplier] = expectedLevelOne[hand];
      expect(startingBasePips(hand), hand).toBe(basePips);
      expect(handStats(hand, 1), hand).toEqual({ level: 1, basePips, baseMultiplier });
    }
  });

  it.each([[1.12, 1], [1.125, 1.25], [1.37, 1.25], [1.375, 1.5], [4.26, 4.25], [7.73, 7.75]])
  ('rounds %s to the nearest quarter as %s', (value, expected) => expect(roundToNearestQuarter(value)).toBe(expected));

  it.each([
    ['ones', [[7, 1], [9, 1.5], [12, 2], [15, 2.5], [18, 3.25]]],
    ['pair', [[8, 1.5], [11, 2.25], [14, 3], [17, 3.75], [20, 4.75]]],
    ['fullHouse', [[12, 3.5], [16, 5], [20, 6.75], [24, 9], [28, 11.25]]],
    ['fiveKind', [[15, 5], [20, 7.25], [25, 9.75], [30, 12.75], [35, 16.25]]],
  ] as [HandId, [number, number][]][])('%s follows the universal rounded progression', (hand, expected) => {
    expect(expected.map((_, index) => {
      const stats = handStats(hand, index + 1); return [stats.basePips, stats.baseMultiplier];
    })).toEqual(expected);
  });

  it('uses exponent 2.3, quarter steps, and never decreases a level-up increase', () => {
    expect(HAND_MULT_EXPONENT).toBe(2.3);
    for (const hand of HAND_IDS) {
      let previous = handStats(hand, 1); let previousPipsIncrease = 0; let previousMultiplierIncrease = .25;
      for (let level = 2; level <= 100; level++) {
        const current = handStats(hand, level);
        const pipsIncrease = current.basePips - previous.basePips;
        const multiplierIncrease = current.baseMultiplier - previous.baseMultiplier;
        expect(pipsIncrease, `${hand} Pips at ${level}`).toBeGreaterThanOrEqual(previousPipsIncrease);
        expect(multiplierIncrease, `${hand} Mult at ${level}`).toBeGreaterThanOrEqual(previousMultiplierIncrease);
        expect(current.baseMultiplier * 4).toBe(Math.round(current.baseMultiplier * 4));
        previous = current; previousPipsIncrease = pipsIncrease; previousMultiplierIncrease = multiplierIncrease;
      }
    }
  });

  it('uses trained stats as the live accumulator base with existing effects layered afterward', () => {
    const game = newRun('trained-score', constant()).state;
    const values: Rank[] = [4, 4, 2, 3, 6];
    game.dice.forEach((die, index) => { die.value = values[index]; });
    game.handLevels.pair = 3;
    expect(handScore(game.dice, 'pair', [0, 1], 3)).toEqual({ pips: 22, multiplier: 3, rawScore: '66', score: 66n });
    rosterDice(game)[0].type = 'bonus';
    rosterDice(game)[4].type = 'hitchhiker';
    syncActiveDiceProjection(game);
    game.dieRoundState = resetDieRoundState(rosterDice(game));
    const result = dispatch(game, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(0));
    expect(result.state.score).toBe(114n);
    expect(result.state.stats.handScores[0]).toMatchObject({ handLevel: 3, basePips: 14, baseMultiplier: 3,
      pips: 38, multiplier: 3, rawScore: '114', score: 114n });
  });
});

describe('frozen relative-level Training', () => {
  it('captures complete independent family snapshots with rounded arithmetic means', () => {
    const levels = newRun('baselines').state.handLevels;
    Object.assign(levels, { ones: 8, twos: 9, threes: 10, fours: 11, fives: 12, sixes: 13,
      pair: 6, twoPair: 8, threeKind: 9, smallStraight: 10, fullHouse: 11, fourKind: 12, largeStraight: 13, fiveKind: 15 });
    const session = createTrainingSession(levels);
    expect(session.upperLevelsAtEntry).toEqual(Object.fromEntries(UPPER_HAND_IDS.map(hand => [hand, levels[hand]])));
    expect(session.lowerLevelsAtEntry).toEqual(Object.fromEntries(LOWER_HAND_IDS.map(hand => [hand, levels[hand]])));
    expect(session.upperBaseline).toBe(11); // 10.5 rounds upward deterministically.
    expect(session.lowerBaseline).toBe(11);
    expect(roundedTrainingBaseline({ a: 1, b: 2 })).toBe(2);
  });

  it.each([[8, 2], [9, 2], [10, 2], [11, 4], [12, 8], [13, 16], [14, 32], [15, 64]])
  ('prices a current level %s against baseline 10 at %s Gold', (level, price) => {
    const game = shopState(200, { pair: 10 });
    game.shop!.trainingSession!.lowerBaseline = 10; game.handLevels.pair = level;
    expect(quoteTraining(game.shop!.trainingSession!, game.handLevels, 'pair').normalPrice).toBe(price);
  });

  it('treats theoretical prices beyond safe integer Gold as unaffordable', () => {
    const game = shopState(Number.MAX_SAFE_INTEGER, { pair: 63 });
    game.shop!.trainingSession!.lowerBaseline = 10;
    expect(quoteTraining(game.shop!.trainingSession!, game.handLevels, 'pair').normalPrice).toBeNull();
    expect(validateAction(game, { type: 'TRAIN_HAND', hand: 'pair' })).toContain('too specialized');
  });

  it('supports repeated specialization and cheap catch-up against the unchanged baseline', () => {
    let game = shopState(100, { pair: 10, fullHouse: 8 });
    game.shop!.trainingSession!.lowerBaseline = 10;
    const costs: number[] = [];
    for (let index = 0; index < 4; index++) {
      const before = game.gold; game = dispatch(game, { type: 'TRAIN_HAND', hand: 'fullHouse' }).state;
      costs.push(before - game.gold);
    }
    expect(costs).toEqual([2, 2, 2, 4]);
    expect(game.handLevels.fullHouse).toBe(12);
    expect(quoteTraining(game.shop!.trainingSession!, game.handLevels, 'fullHouse').normalPrice).toBe(8);
    expect(game.shop!.trainingSession!.purchasesByHand.fullHouse).toBe(4);
  });

  it('does not change any other hand price across or within families', () => {
    let game = shopState(100, { pair: 10, twoPair: 14, fullHouse: 8, ones: 12 });
    game.shop!.trainingSession!.lowerBaseline = 10;
    const session = game.shop!.trainingSession!;
    const before = { pair: quoteTraining(session, game.handLevels, 'pair').normalPrice,
      twoPair: quoteTraining(session, game.handLevels, 'twoPair').normalPrice,
      ones: quoteTraining(session, game.handLevels, 'ones').normalPrice };
    game = dispatch(game, { type: 'TRAIN_HAND', hand: 'fullHouse' }).state;
    expect({ pair: quoteTraining(session, game.handLevels, 'pair').normalPrice,
      twoPair: quoteTraining(session, game.handLevels, 'twoPair').normalPrice,
      ones: quoteTraining(session, game.handLevels, 'ones').normalPrice }).toEqual(before);
  });

  it('applies only the first On The House Training purchase for free and records the waived price', () => {
    let game = shopState(10, { pair: 11 });
    game.shop!.trainingSession!.lowerBaseline = 10;
    game.shop!.trainingSession!.freeTrainingAvailable = true;
    game = dispatch(game, { type: 'TRAIN_HAND', hand: 'pair' }).state;
    expect(game.gold).toBe(10); expect(game.handLevels.pair).toBe(12);
    expect(game.shop!.trainingSession!.freeTrainingAvailable).toBe(false);
    expect(game.stats.trainingPurchases[0]).toMatchObject({ normalPrice: 4, cost: 0, waivedByOnTheHouse: true, purchaseCount: 1 });
    game = dispatch(game, { type: 'TRAIN_HAND', hand: 'pair' }).state;
    expect(game.gold).toBe(2);
  });

  it('rejects unaffordable purchases without changing state', () => {
    const poor = shopState(1);
    expect(validateAction(poor, { type: 'TRAIN_HAND', hand: 'pair' })).toContain('Not enough Gold');
    const rejected = dispatch(poor, { type: 'TRAIN_HAND', hand: 'pair' });
    expect(rejected.error).toContain('Not enough Gold');
    expect(rejected.state.handLevels).toEqual(poor.handLevels);
    expect(rejected.state.gold).toBe(1);
  });

  it('emits enough structured history to reconstruct the session and purchase', () => {
    const game = shopState(20);
    const trained = dispatch(game, { type: 'TRAIN_HAND', hand: 'pair' }).state;
    expect(trained.historyV2.find(event => event.kind === 'shop_transaction' && event.transaction.type === 'training'))
      .toMatchObject({ transaction: { shopVisitId: 7, hand: 'pair', family: 'lower', fromLevel: 1, toLevel: 2,
        frozenBaseline: 1, relativeTier: 0, normalPrice: 2, cost: 2, waivedByOnTheHouse: false, purchaseCount: 1 } });
  });
});
