import { describe, expect, it } from 'vitest';
import { handTrainingCost, teamTrainingCost } from './config';
import { activeFace } from './dice';
import { dispatch, newRun, validateAction } from './engine';
import {
  HAND_IDS,
  handStats,
  roundToNearestHalf,
  startingBasePips,
} from './hands';
import { handScore } from './scoring';
import { exportRun } from './telemetry';
import type { GameState, HandId, Rank, TrainingOffer } from './types';

const constant = (value = 0.99) => ({ next: () => value });
const expectedLevelOne: Record<HandId, [number, number]> = {
  ones: [7, 1], twos: [7, 1], threes: [7, 1], fours: [7, 1], fives: [7, 1], sixes: [7, 1],
  pair: [8, 1.5], twoPair: [9, 2], threeKind: [10, 2.5], smallStraight: [10, 2.5],
  fullHouse: [12, 3.5], fourKind: [13, 4], largeStraight: [13, 4], fiveKind: [15, 5],
};

function shopState(gold = 200, includeTeam = false): GameState {
  const game = newRun('training-shop', constant()).state;
  game.phase = 'shop';
  game.gold = gold;
  const trainingOffers: TrainingOffer[] = ['pair', 'fullHouse', 'fiveKind']
    .map(hand => ({ kind: 'hand', hand: hand as HandId, purchases: 0 }));
  if (includeTeam) trainingOffers[2] = { kind: 'team', purchases: 0 };
  game.shop = {
    offers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0,
    trainingOffers,
  };
  return game;
}

function trainingOfferKey(offer: TrainingOffer): string {
  return offer.kind === 'team' ? 'team' : offer.hand;
}

function forceBust(state: GameState): GameState {
  state.dice.forEach((die, index) => { die.value = ([1, 2, 2, 4, 5] as Rank[])[index]; });
  state.score = 0;
  state.manualRerollsRemaining = 0;
  state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
  return dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant()).state;
}

function winningState(seed: string): GameState {
  const game = newRun(seed).state;
  game.dice.forEach(die => { die.value = 6; });
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
    expect(HAND_IDS.map(startingBasePips)).not.toEqual(Array(14).fill(10));
  });

  it.each([
    [1.24, 1], [1.25, 1.5], [1.74, 1.5], [1.75, 2], [4.26, 4.5], [7.73, 7.5],
  ])('rounds %s to the nearest half as %s', (value, expected) => {
    expect(roundToNearestHalf(value)).toBe(expected);
  });

  it.each([
    ['ones', [[7, 1], [9, 1.5], [12, 2], [15, 2.5], [18, 3]]],
    ['pair', [[8, 1.5], [11, 2], [14, 2.5], [17, 3], [20, 3.5]]],
    ['fullHouse', [[12, 3.5], [16, 4.5], [20, 5.5], [24, 6.5], [28, 7.5]]],
    ['fiveKind', [[15, 5], [20, 6], [25, 7.5], [30, 9], [35, 10.5]]],
  ] as [HandId, [number, number][]][])('%s follows the universal rounded progression', (hand, expected) => {
    expect(expected.map((_, index) => {
      const stats = handStats(hand, index + 1);
      return [stats.basePips, stats.baseMultiplier];
    })).toEqual(expected);
  });

  it('rounds Pip formula targets to whole numbers', () => {
    expect(handStats('ones', 2).basePips).toBe(9); // 7 × 4/3 = 9.333...
    expect(handStats('pair', 2).basePips).toBe(11); // 8 × 4/3 = 10.666...
    for (const hand of HAND_IDS) {
      for (let level = 1; level <= 30; level++) expect(Number.isInteger(handStats(hand, level).basePips)).toBe(true);
    }
  });

  it('never decreases either level-up increase and always grants at least 0.5 Mult', () => {
    for (const hand of HAND_IDS) {
      let previous = handStats(hand, 1);
      let previousPipsIncrease = 0;
      let previousMultiplierIncrease = 0.5;
      for (let level = 2; level <= 100; level++) {
        const current = handStats(hand, level);
        const pipsIncrease = current.basePips - previous.basePips;
        const multiplierIncrease = current.baseMultiplier - previous.baseMultiplier;
        expect(pipsIncrease, `${hand} Pips at level ${level}`).toBeGreaterThanOrEqual(previousPipsIncrease);
        expect(multiplierIncrease, `${hand} Mult at level ${level}`).toBeGreaterThanOrEqual(previousMultiplierIncrease);
        expect(multiplierIncrease, `${hand} Mult at level ${level}`).toBeGreaterThanOrEqual(0.5);
        previous = current;
        previousPipsIncrease = pipsIncrease;
        previousMultiplierIncrease = multiplierIncrease;
      }
    }
  });

  it('accelerates Mult growth at higher levels when the formula requires it', () => {
    expect(handStats('fullHouse', 10).baseMultiplier).toBe(12.5);
    expect(handStats('fullHouse', 11).baseMultiplier).toBe(14);
    expect(handStats('fullHouse', 12).baseMultiplier).toBe(15.5);
    expect(handStats('fullHouse', 11).baseMultiplier - handStats('fullHouse', 10).baseMultiplier).toBe(1.5);
    expect(handStats('fullHouse', 12).baseMultiplier - handStats('fullHouse', 11).baseMultiplier).toBe(1.5);
  });

  it('uses trained stats as the live accumulator base with existing effects layered afterward', () => {
    const game = newRun('trained-score', constant()).state;
    const values: Rank[] = [4, 4, 2, 3, 6];
    game.dice.forEach((die, index) => { die.value = values[index]; });
    game.handLevels.pair = 3;
    expect(handScore(game.dice, 'pair', [0, 1], 3)).toEqual({ pips: 22, multiplier: 2.5, rawScore: 55, score: 55 });

    activeFace(game.dice[0]).enhancements.bonus = 1;
    activeFace(game.dice[4]).enhancements.hitchhiker = 1;
    const result = dispatch(game, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(0));
    expect(result.state.score).toBe(95);
    expect(result.state.stats.handScores[0]).toMatchObject({
      hand: 'pair', handLevel: 3, basePips: 14, baseMultiplier: 2.5,
      pips: 38, multiplier: 2.5, rawScore: 95, score: 95, bonusPips: 10, hitchhikerPips: 6,
    });
    expect(result.events.find(event => event.type === 'HAND_STARTED')?.handScore).toMatchObject({
      handLevel: 3, basePips: 14, baseMultiplier: 2.5, currentPips: 14, currentMultiplier: 2.5,
    });
  });
});

describe('Hand Training purchases and persistence', () => {
  it('starts every new run at Level 1 and resets trained state on restart', () => {
    const first = newRun('levels-start').state;
    expect(first.handLevels).toEqual(Object.fromEntries(HAND_IDS.map(hand => [hand, 1])));
    first.handLevels.pair = 8;
    expect(newRun('levels-start').state.handLevels.pair).toBe(1);
  });

  it('escalates an individual offer 2 → 4 → 8 while immediately applying every level and stat change', () => {
    const game = shopState();
    game.handLevels.fullHouse = 3;
    const beforeStats = handStats('fullHouse', 3);
    const first = dispatch(game, { type: 'TRAIN_HAND', hand: 'fullHouse' });
    const second = dispatch(first.state, { type: 'TRAIN_HAND', hand: 'fullHouse' });
    const third = dispatch(second.state, { type: 'TRAIN_HAND', hand: 'fullHouse' });

    expect(beforeStats).toEqual({ level: 3, basePips: 20, baseMultiplier: 5.5 });
    expect(first.state.handLevels.fullHouse).toBe(4);
    expect(handStats('fullHouse', first.state.handLevels.fullHouse)).toEqual({ level: 4, basePips: 24, baseMultiplier: 6.5 });
    expect(second.state.handLevels.fullHouse).toBe(5);
    expect(third.state.handLevels.fullHouse).toBe(6);
    expect(third.state.gold).toBe(186);
    expect(third.state.shop!.trainingOffers.find(offer => offer.kind === 'hand' && offer.hand === 'fullHouse'))
      .toMatchObject({ purchases: 3 });
    expect(handTrainingCost(3)).toBe(16);
    expect(third.state.stats).toMatchObject({ trainingPurchasesTotal: 3, trainingGoldSpent: 14, goldSpent: 14 });
    expect(third.state.stats.goldSpentBySource.handTraining).toBe(14);
    expect(third.state.stats.trainingPurchases).toEqual([
      { round: 1, hand: 'fullHouse', fromLevel: 3, toLevel: 4, cost: 2 },
      { round: 1, hand: 'fullHouse', fromLevel: 4, toLevel: 5, cost: 4 },
      { round: 1, hand: 'fullHouse', fromLevel: 5, toLevel: 6, cost: 8 },
    ]);
    expect(first.events.map(event => event.type)).toEqual(['GOLD_SPENT', 'TRAINING_PURCHASED']);
  });

  it('tracks individual escalation independently per hand and rejects the current unaffordable price', () => {
    let game = shopState(20);
    game = dispatch(game, { type: 'TRAIN_HAND', hand: 'pair' }).state;
    game = dispatch(game, { type: 'TRAIN_HAND', hand: 'pair' }).state;
    game = dispatch(game, { type: 'TRAIN_HAND', hand: 'fullHouse' }).state;
    const pair = game.shop!.trainingOffers.find(offer => offer.kind === 'hand' && offer.hand === 'pair')!;
    const house = game.shop!.trainingOffers.find(offer => offer.kind === 'hand' && offer.hand === 'fullHouse')!;
    const five = game.shop!.trainingOffers.find(offer => offer.kind === 'hand' && offer.hand === 'fiveKind')!;
    expect([pair.purchases, house.purchases, five.purchases]).toEqual([2, 1, 0]);
    expect([handTrainingCost(pair.purchases), handTrainingCost(house.purchases), handTrainingCost(five.purchases)]).toEqual([8, 4, 2]);
    expect(game.handLevels).toMatchObject({ pair: 3, fullHouse: 2, fiveKind: 1 });
    expect(game.gold).toBe(12);

    const poor = shopState(1);
    expect(validateAction(poor, { type: 'TRAIN_HAND', hand: 'pair' })).toContain('Not enough Gold');
    const rejected = dispatch(poor, { type: 'TRAIN_HAND', hand: 'pair' });
    expect(rejected.state).toBe(poor);
    expect(rejected.state.handLevels.pair).toBe(1);
  });

  it('Team Training raises every hand exactly once per purchase and escalates 15 → 30 → 60', () => {
    let game = shopState(200, true);
    const startingLevels = Object.fromEntries(HAND_IDS.map((hand, index) => [hand, index + 1])) as Record<HandId, number>;
    game.handLevels = structuredClone(startingLevels);
    game = dispatch(game, { type: 'TRAIN_ALL_HANDS' }).state;
    for (const hand of HAND_IDS) expect(game.handLevels[hand], hand).toBe(startingLevels[hand] + 1);
    game = dispatch(game, { type: 'TRAIN_ALL_HANDS' }).state;
    for (const hand of HAND_IDS) expect(game.handLevels[hand], hand).toBe(startingLevels[hand] + 2);
    const team = game.shop!.trainingOffers.find(offer => offer.kind === 'team')!;
    expect(team.purchases).toBe(2);
    expect(teamTrainingCost(team.purchases)).toBe(60);
    expect(game.gold).toBe(155);
    expect(game.stats.trainingPurchases).toEqual([
      { round: 1, hand: 'all', cost: 15 },
      { round: 1, hand: 'all', cost: 30 },
    ]);
  });

  it('keeps Team and individual escalation counters independent', () => {
    let game = shopState(100, true);
    game = dispatch(game, { type: 'TRAIN_ALL_HANDS' }).state;
    game = dispatch(game, { type: 'TRAIN_HAND', hand: 'pair' }).state;
    const team = game.shop!.trainingOffers.find(offer => offer.kind === 'team')!;
    const pair = game.shop!.trainingOffers.find(offer => offer.kind === 'hand' && offer.hand === 'pair')!;
    expect([team.purchases, teamTrainingCost(team.purchases)]).toEqual([1, 30]);
    expect([pair.purchases, handTrainingCost(pair.purchases)]).toEqual([1, 4]);
    expect(game.gold).toBe(83);
  });

  it('preserves escalation on a Bust return to the same Shop', () => {
    let game = shopState(100, true);
    game = dispatch(game, { type: 'TRAIN_HAND', hand: 'pair' }).state;
    game = dispatch(game, { type: 'TRAIN_HAND', hand: 'pair' }).state;
    game = dispatch(game, { type: 'TRAIN_ALL_HANDS' }).state;
    game = dispatch(game, { type: 'NEXT_ROUND' }, constant()).state;
    game = forceBust(game);
    expect(game.phase).toBe('shop');
    expect(game.bust).not.toBeNull();
    expect(game.shop!.trainingOffers.find(offer => offer.kind === 'hand' && offer.hand === 'pair')).toMatchObject({ purchases: 2 });
    expect(game.shop!.trainingOffers.find(offer => offer.kind === 'team')).toMatchObject({ purchases: 1 });
    expect(handTrainingCost(2)).toBe(8);
    expect(teamTrainingCost(1)).toBe(30);
    expect(game.gold).toBe(79);
  });

  it('resets every offer price in a newly reached Shop while preserving trained levels', () => {
    let game = shopState(100, true);
    game = dispatch(game, { type: 'TRAIN_HAND', hand: 'pair' }).state;
    game = dispatch(game, { type: 'TRAIN_ALL_HANDS' }).state;
    game = dispatch(game, { type: 'NEXT_ROUND' }, constant()).state;
    game.dice.forEach(die => { die.value = 6; });
    game = dispatch(game, { type: 'PLAY', hand: 'fiveKind', dieIds: [0, 1, 2, 3, 4] }, constant()).state;
    expect(game.phase).toBe('roundSummary');
    game = dispatch(game, { type: 'CONTINUE_ROUND_SUMMARY' }, constant()).state;
    expect(game.phase).toBe('shop');
    expect(game.handLevels.pair).toBe(3);
    expect(game.shop!.trainingOffers).toHaveLength(3);
    expect(game.shop!.trainingOffers.every(offer => offer.purchases === 0)).toBe(true);
    for (const offer of game.shop!.trainingOffers) {
      expect(offer.kind === 'team' ? teamTrainingCost(offer.purchases) : handTrainingCost(offer.purchases))
        .toBe(offer.kind === 'team' ? 15 : 2);
    }
    const exported = exportRun(game);
    expect(exported.finalHandLevels).toEqual(game.handLevels);
    expect(exported.board.handLevels).toEqual(game.handLevels);
  });
});

describe('seeded Training offer generation', () => {
  it('creates three distinct deterministic offers and keeps them fixed during enhancement rerolls', () => {
    const action = { type: 'PLAY' as const, hand: 'fiveKind' as const, dieIds: [0, 1, 2, 3, 4] };
    const firstClear = dispatch(winningState('training-offers'), action);
    const replayClear = dispatch(winningState('training-offers'), action);
    const first = dispatch(firstClear.state, { type: 'CONTINUE_ROUND_SUMMARY' });
    const replay = dispatch(replayClear.state, { type: 'CONTINUE_ROUND_SUMMARY' });
    expect(first).toEqual(replay);
    const offers = first.state.shop!.trainingOffers;
    expect(offers).toHaveLength(3);
    expect(new Set(offers.map(trainingOfferKey)).size).toBe(3);
    expect(offers.every(offer => offer.purchases === 0)).toBe(true);

    first.state.gold = 100;
    const refreshed = dispatch(first.state, { type: 'REROLL_OFFERS' });
    expect(refreshed.state.shop!.trainingOffers).toEqual(offers);
  });

  it('can deterministically place Team Training into one of the existing three slots', () => {
    const action = { type: 'PLAY' as const, hand: 'fiveKind' as const, dieIds: [0, 1, 2, 3, 4] };
    const clear = dispatch(winningState('team-training-offer'), action);
    const first = dispatch(clear.state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant());
    const replay = dispatch(clear.state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant());
    expect(first.state.shop!.trainingOffers).toEqual(replay.state.shop!.trainingOffers);
    expect(first.state.shop!.trainingOffers).toHaveLength(3);
    expect(first.state.shop!.trainingOffers.filter(offer => offer.kind === 'team')).toHaveLength(1);
  });

  it('generates a fresh seeded offer set on the next shop from the continuing RNG stream', () => {
    const playFive = { type: 'PLAY' as const, hand: 'fiveKind' as const, dieIds: [0, 1, 2, 3, 4] };
    let a = dispatch(winningState('training-next-shop'), playFive).state;
    let b = dispatch(winningState('training-next-shop'), playFive).state;
    a = dispatch(a, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
    b = dispatch(b, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
    const firstRngState = a.rngState;
    a = dispatch(a, { type: 'NEXT_ROUND' }).state;
    b = dispatch(b, { type: 'NEXT_ROUND' }).state;
    a.dice.forEach(die => { die.value = 6; });
    b.dice.forEach(die => { die.value = 6; });
    a = dispatch(a, playFive).state;
    b = dispatch(b, playFive).state;
    a = dispatch(a, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
    b = dispatch(b, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
    expect(a.shop!.trainingOffers).toEqual(b.shop!.trainingOffers);
    expect(a.shop!.trainingOffers).toHaveLength(3);
    expect(new Set(a.shop!.trainingOffers.map(trainingOfferKey)).size).toBe(3);
    expect(a.rngState).not.toBe(firstRngState);
  });
});
