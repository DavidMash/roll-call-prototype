import { describe, expect, it } from 'vitest';
import { dispatch, newRun, validateAction } from './engine';
import {
  HAND_IDS, HAND_MULT_EXPONENT, handStats, LOWER_HAND_IDS, roundToNearestQuarter,
  UPPER_HAND_IDS,
} from './hands';
import { handScore } from './scoring';
import { createTrainingSession, quoteTraining, roundedTrainingBaseline } from './training';
import { createDieEffect, resetDieRoundState } from './specialDice';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import type { GameState, HandId, HandLevels, Rank } from './types';

const constant = (value = 0.99) => ({ next: () => value });
const expectedLevelOne: Record<HandId, number> = {
  ones: 1, twos: 1, threes: 1, fours: 1, fives: 1, sixes: 1, sevens: 1,
  pair: 2, twoPair: 2, threeKind: 3, smallStraight: 4,
  fullHouse: 5, fourKind: 6, largeStraight: 7, fiveKind: 8,
};

function shopState(gold = 200, levels?: Partial<HandLevels>): GameState {
  const game = newRun('training-shop', constant()).state;
  game.phase = 'shop'; game.gold = gold;
  Object.assign(game.handLevels, levels);
  game.shop = { visitId: 7, stage: 'train', offers: [],
    offerRerolls: 0, lifeRestores: 0, trainingSession: createTrainingSession(game.handLevels) };
  return game;
}

describe('derived hand levels', () => {
  it('locks every exact Level 1 Hand Mult value without Hand Pips', () => {
    expect(HAND_IDS).toHaveLength(14);
    for (const hand of HAND_IDS) {
      expect(handStats(hand, 1), hand).toEqual({ level: 1, handMultiplier: expectedLevelOne[hand] });
    }
  });

  it.each([[1.12, 1], [1.125, 1.25], [1.37, 1.25], [1.375, 1.5], [4.26, 4.25], [7.73, 7.75]])
  ('rounds %s to the nearest quarter as %s', (value, expected) => expect(roundToNearestQuarter(value)).toBe(expected));

  it.each([
    ['ones', [1, 1.75, 2.5, 3.75, 5.5]],
    ['pair', [2, 3.25, 5.25, 7.5, 10.75]],
    ['fullHouse', [5, 8.25, 13, 19, 27]],
    ['fiveKind', [8, 13.25, 20.75, 30.5, 43.25]],
  ] as [HandId, number[]][])('%s follows the universal rounded progression', (hand, expected) => {
    expect(expected.map((_, index) => handStats(hand, index + 1).handMultiplier)).toEqual(expected);
  });

  it('uses exponent 3.3, quarter steps, and never decreases a level-up increase', () => {
    expect(HAND_MULT_EXPONENT).toBe(3.3);
    for (const hand of HAND_IDS) {
      let previous = handStats(hand, 1); let previousMultiplierIncrease = .25;
      for (let level = 2; level <= 100; level++) {
        const current = handStats(hand, level);
        const multiplierIncrease = current.handMultiplier - previous.handMultiplier;
        expect(multiplierIncrease, `${hand} Mult at ${level}`).toBeGreaterThanOrEqual(previousMultiplierIncrease);
        expect(current.handMultiplier * 4).toBe(Math.round(current.handMultiplier * 4));
        previous = current; previousMultiplierIncrease = multiplierIncrease;
      }
    }
  });

  it('locks representative levels and gives every Upper Hand, including Sevens, one curve', () => {
    expect([1, 5, 10, 20, 50, 100].map(level => handStats('ones', level).handMultiplier))
      .toEqual([1, 5.5, 20.5, 111, 1497.25, 12648]);
    expect(([...UPPER_HAND_IDS, 'sevens'] as HandId[]).every(hand => [1, 5, 10, 20, 50, 100]
      .every(level => handStats(hand, level).handMultiplier === handStats('ones', level).handMultiplier))).toBe(true);
  });

  it.each([
    [1, [1, 111, 1497.25, 12648]],
    [2, [2, 222, 2994.5, 25296.25]],
    [3, [3, 333, 4491.75, 37944.25]],
    [4, [4, 444, 5989, 50592.5]],
    [5, [5, 555, 7486.25, 63240.5]],
    [6, [6, 666, 8983.5, 75888.75]],
    [7, [7, 777, 10480.75, 88536.75]],
    [8, [8, 888, 11978, 101184.75]],
  ] as [number, number[]][])('locks Levels 1/20/50/100 for the ×%s starting tier', (startingMultiplier, expected) => {
    const hand = HAND_IDS.find(id => expectedLevelOne[id] === startingMultiplier)!;
    expect([1, 20, 50, 100].map(level => handStats(hand, level).handMultiplier)).toEqual(expected);
  });

  it('uses trained stats as the live accumulator base with existing effects layered afterward', () => {
    const game = newRun('trained-score', constant()).state;
    const values: Rank[] = [4, 4, 2, 3, 6];
    game.dice.forEach((die, index) => { die.value = values[index]; });
    game.handLevels.pair = 3;
    expect(handScore(game.dice, 'pair', [0, 1], 3)).toEqual({ pips: 8, multiplier: 5.25, rawScore: '42', score: 42n });
    rosterDice(game)[0].effects = [createDieEffect(rosterDice(game)[0].id, 'bonus')];
    rosterDice(game)[4].effects = [createDieEffect(rosterDice(game)[4].id, 'hitchhiker')];
    syncActiveDiceProjection(game);
    game.dieRoundState = resetDieRoundState(rosterDice(game));
    const result = dispatch(game, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(0));
    expect(result.state.score).toBe(126n);
    expect(result.state.stats.handScores[0]).toMatchObject({ handLevel: 3, handMultiplier: 5.25,
      pips: 24, multiplier: 5.25, rawScore: '126', score: 126n });
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
