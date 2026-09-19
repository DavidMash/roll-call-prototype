import { describe, expect, it, vi } from 'vitest';
import { activeFace, rollDie } from './dice';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { composeXMult, FLAME_IDS, handXMultContributions, captureHandStart, hasXMultFlame } from './flames';
import { LOWER_HAND_IDS } from './hands';
import { finalizeScore } from './scoring';
import type { Enhancement, Flame, GameState, HandId, RandomSource, Rank } from './types';

const constant = (value = 0.99): RandomSource => ({ next: () => value });
function sequence(...values: number[]): RandomSource { let index = 0; return { next: () => values[index++] ?? 0.99 }; }
function game(values: Rank[] = [4, 4, 4, 2, 6]): GameState {
  const state = newRun('flame-test', constant()).state;
  state.dice.forEach((die, index) => { die.value = values[index]; });
  state.target = 100000;
  state.stats.rounds[0].target = state.target;
  return state;
}
function flame(state: GameState, dieId: number, value: Flame) { state.dice[dieId].flame = value; }
function enhance(state: GameState, dieId: number, value: Enhancement, count = 1, rank?: Rank) {
  state.dice[dieId].faces[(rank ?? state.dice[dieId].value) - 1].enhancements[value] = count;
}
const play = (state: GameState, hand: HandId = 'threeKind', dieIds = [0, 1, 2], rng = constant()) =>
  dispatch(state, { type: 'PLAY', hand, dieIds }, rng);
function clearRound(round: number, ownedFlame?: Flame) {
  const state = game();
  state.round = round;
  state.stats.rounds[0].round = round;
  state.target = 1;
  state.stats.rounds[0].target = 1;
  if (ownedFlame) flame(state, 4, ownedFlame);
  return play(state, 'threeKind', [0, 1, 2], constant(0.25));
}

describe('XMult domain', () => {
  it('defaults to 1 and composes additive bonuses before multiplicative effects', () => {
    expect(composeXMult(0, 1)).toBe(1);
    expect(composeXMult(1.5, 2)).toBe(5);
    expect(finalizeScore(20, 3, 5)).toEqual({ rawScore: 300, finalScore: 300 });
    expect(finalizeScore(13, 1.5, 1.25)).toEqual({ rawScore: 24.375, finalScore: 24 });
  });

  it('compounds multiple multiplicative Flames and records final XMult', () => {
    const state = game();
    state.handLevels.threeKind = 3;
    flame(state, 0, 'ultimate');
    flame(state, 1, 'ultimate');
    const result = play(state);
    expect(result.state.stats.handScores[0]).toMatchObject({ xMult: 4, score: 420 });
    expect(result.events.filter(event => event.type === 'FLAME_TRIGGERED' && event.flame === 'ultimate')).toHaveLength(2);
  });

  it('reveals XMult only for Flames that can affect it', () => {
    const state = game();
    expect(hasXMultFlame(state.dice)).toBe(false);
    flame(state, 0, 'clockwork');
    expect(hasXMultFlame(state.dice)).toBe(false);
    flame(state, 1, 'charge');
    expect(hasXMultFlame(state.dice)).toBe(true);
  });
});

describe('conditional hand XMult Flames', () => {
  it('Ultimate accepts every hand tied for highest level and rejects lower levels', () => {
    const state = game();
    state.handLevels.threeKind = 3;
    state.handLevels.pair = 3;
    flame(state, 0, 'ultimate');
    expect(handXMultContributions(captureHandStart(state, 'threeKind'), 'threeKind', 3, [0])).toMatchObject([{ value: 2 }]);
    expect(handXMultContributions(captureHandStart(state, 'fours'), 'fours', 1, [0])).toEqual([]);
  });

  it('Minigun applies to Upper hands, including a successful Hitchhiker, but not Lower hands', () => {
    const upper = game([4, 4, 2, 3, 6]);
    flame(upper, 4, 'minigun');
    enhance(upper, 4, 'hitchhiker');
    const upperResult = play(upper, 'fours', [0], constant(0));
    expect(upperResult.state.stats.handScores[0].xMult).toBe(2);
    const lower = game([4, 4, 2, 3, 6]);
    flame(lower, 0, 'minigun');
    expect(play(lower, 'pair', [0, 1]).state.stats.handScores[0].xMult).toBe(1);
  });

  it('Hail Mary uses the hand-start reroll snapshot and Hitchhikers qualify', () => {
    const ready = game([4, 4, 2, 3, 6]);
    ready.manualRerollsRemaining = 0;
    flame(ready, 4, 'hailMary');
    enhance(ready, 4, 'hitchhiker');
    expect(play(ready, 'fours', [0], constant(0)).state.stats.handScores[0].xMult).toBe(2);
    const notReady = game();
    flame(notReady, 0, 'hailMary');
    expect(play(notReady).state.stats.handScores[0].xMult).toBe(1);
  });

  it("Dragon's Hoard snapshots Gold before Golden income and multiple dice add", () => {
    const state = game();
    state.gold = 10;
    flame(state, 0, 'dragonsHoard');
    flame(state, 1, 'dragonsHoard');
    enhance(state, 0, 'golden');
    const result = play(state);
    expect(result.state.gold).toBe(11);
    expect(result.state.stats.handScores[0].xMult).toBe(2);
  });

  it('Bloated counts enhancement stacks across all faces but not its Flame', () => {
    const state = game();
    flame(state, 0, 'bloated');
    enhance(state, 0, 'bonus', 3, 1);
    enhance(state, 0, 'sticky', 2, 2);
    enhance(state, 0, 'mirror', 1, 3);
    expect(play(state).state.stats.handScores[0].xMult).toBe(1.6);
  });

  it('lets a successful Hitchhiker activate Bloated from its whole physical die', () => {
    const state = game([4, 4, 4, 2, 6]);
    flame(state, 4, 'bloated');
    enhance(state, 4, 'hitchhiker', 2);
    enhance(state, 4, 'bonus', 3, 1);
    expect(play(state, 'threeKind', [0, 1, 2], constant(0)).state.stats.handScores[0].xMult).toBe(1.5);
  });

  it('Well Trained uses previous plays, excludes the current play, and adds across dice', () => {
    const state = game();
    state.handPlayCounts.threeKind = 5;
    state.stats.handsPlayed.threeKind = 5;
    flame(state, 0, 'wellTrained');
    flame(state, 1, 'wellTrained');
    const result = play(state);
    expect(result.state.stats.handScores[0].xMult).toBe(2);
    expect(result.state.handPlayCounts.threeKind).toBe(6);
    expect(result.events.filter(event => event.type === 'FLAME_TRIGGERED' && event.flame === 'wellTrained').map(event => event.xMult)).toEqual([0.5, 0.5]);
  });

  it.each([[0, 1], [10, 2]] as const)('Well Trained maps %s previous plays to x%s with a successful Hitchhiker', (previous, expected) => {
    const state = game([4, 4, 4, 2, 6]);
    state.handPlayCounts.threeKind = previous;
    flame(state, 4, 'wellTrained');
    enhance(state, 4, 'hitchhiker');
    const result = play(state, 'threeKind', [0, 1, 2], constant(0));
    expect(result.state.stats.handScores[0].xMult).toBe(expected);
    expect(result.state.handPlayCounts.threeKind).toBe(previous + 1);
  });

  it('Target Practice is shared, fixed, Lower-only, and compounds qualifying dice', () => {
    const state = game([4, 4, 2, 3, 6]);
    state.targetPracticeHand = 'pair';
    flame(state, 0, 'targetPractice');
    flame(state, 1, 'targetPractice');
    expect(play(state, 'pair', [0, 1]).state.stats.handScores[0].xMult).toBe(9);
    const miss = game();
    miss.targetPracticeHand = 'fullHouse';
    flame(miss, 0, 'targetPractice');
    expect(play(miss).state.stats.handScores[0].xMult).toBe(1);
  });

  it('lets a successful Hitchhiker activate Target Practice without helping qualify the target', () => {
    const state = game([4, 4, 4, 2, 6]);
    state.targetPracticeHand = 'threeKind';
    flame(state, 4, 'targetPractice');
    enhance(state, 4, 'hitchhiker');
    expect(play(state, 'threeKind', [0, 1, 2], constant(0)).state.stats.handScores[0].xMult).toBe(3);
  });
});

describe('non-XMult Flames', () => {
  function shopState(): GameState {
    const state = game();
    state.phase = 'shop';
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0 };
    state.gold = 100;
    return state;
  }

  it('Triple-Up applies 3 stackable stacks, one binary stack, is not retroactive, and charges once', () => {
    let state = shopState();
    flame(state, 0, 'tripleUp');
    activeFace(state.dice[0]).enhancements.bonus = 2;
    state.shop!.offers = [{ id: 1, enhancement: 'bonus', purchased: false }];
    state = dispatch(state, { type: 'BUY', offerId: 1, dieId: 0 }).state;
    expect(activeFace(state.dice[0]).enhancements.bonus).toBe(5);
    expect(state.gold).toBe(97);
    state.shop!.offers = [{ id: 2, enhancement: 'mirror', purchased: false }];
    state = dispatch(state, { type: 'BUY', offerId: 2, dieId: 0 }).state;
    expect(activeFace(state.dice[0]).enhancements.mirror).toBe(1);
    expect(state.stats.purchases.map(item => item.stacksApplied)).toEqual([3, 1]);
    state.dice[0].value = 2;
    state.shop!.offers = [{ id: 3, enhancement: 'sticky', purchased: false }];
    state = dispatch(state, { type: 'BUY', offerId: 3, dieId: 0 }).state;
    expect(activeFace(state.dice[0]).enhancements.sticky).toBe(3);
    expect(state.gold).toBe(94); // One normal offer price per purchase, never three prices.
  });

  it('Clockwork advances every transition without consuming RNG and ignores Weighted', () => {
    const state = game();
    flame(state, 0, 'clockwork');
    state.dice[0].faces[0].enhancements.weighted = 10;
    const rng = { next: vi.fn(() => 0) };
    for (const [before, after] of [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 1]] as [Rank, Rank][]) {
      state.dice[0].value = before;
      expect(rollDie(state.dice[0], rng)).toEqual({ value: after, weighted: false });
    }
    expect(rng.next).not.toHaveBeenCalled();
  });

  it('routes gameplay, manual, scored, Slippy, Jumping Bean, shop, and reward rolls through Clockwork', () => {
    const manual = game([1, 4, 4, 4, 6]);
    flame(manual, 0, 'clockwork');
    expect(dispatch(manual, { type: 'MANUAL_REROLL', dieIds: [0] }).state.dice[0].value).toBe(2);

    const scored = game([1, 4, 4, 2, 6]);
    flame(scored, 0, 'clockwork');
    expect(play(scored, 'ones', [0]).state.dice[0].value).toBe(2);

    const slippy = game([1, 4, 4, 2, 6]);
    flame(slippy, 0, 'clockwork');
    enhance(slippy, 0, 'slippy');
    expect(play(slippy, 'fours', [1]).state.dice[0].value).toBe(2);

    const bean = game([5, 4, 4, 2, 6]);
    flame(bean, 0, 'clockwork');
    enhance(bean, 0, 'jumpingBean', 1, 6);
    const beanResolver = new Resolver(bean, constant());
    beanResolver.rollBatch([0], 'Clockwork Bean path', 'gameplay');
    beanResolver.drain();
    expect(beanResolver.state.dice[0].value).toBe(1); // 5→6 triggers Bean; its reroll advances 6→1.

    const shop = shopState();
    shop.dice[0].value = 1;
    flame(shop, 0, 'clockwork');
    expect(dispatch(shop, { type: 'REROLL_DICE' }).state.dice[0].value).toBe(2);

    const reward = clearRound(3, 'clockwork').state;
    expect(reward.dice[4].value).toBe(1);
  });

  it('treats Magnetic as a flip, so it neither advances Clockwork nor builds Charge', () => {
    const state = game([5, 1, 4, 4, 6]);
    enhance(state, 0, 'magnetic', 1, 6);
    flame(state, 1, 'charge');
    state.dice[1].faces[3].enhancements.magnetic = 1;
    const resolver = new Resolver(state, constant(0.99));
    resolver.rollBatch([0], 'Magnetic source', 'gameplay');
    resolver.drain();
    expect(resolver.state.dice[1].value).toBe(4);
    expect(resolver.state.dice[1].chargeXMult).toBe(0);
  });

  it('Charge accumulates only on gameplay rolls, applies without scoring, sums, and resets after a hand', () => {
    let state = game([2, 4, 4, 4, 6]);
    flame(state, 0, 'charge');
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant()).state;
    expect(state.dice[0].chargeXMult).toBe(0.5);
    flame(state, 4, 'charge');
    state.dice[4].chargeXMult = 1;
    const result = play(state, 'fours', [1, 2, 3]);
    expect(result.state.stats.handScores[0].xMult).toBe(2.5);
    expect(result.state.dice[0].chargeXMult).toBe(0);
    expect(result.state.dice[4].chargeXMult).toBe(0);
  });

  it('builds Charge on a round-start roll but not a shop roll', () => {
    const state = shopState();
    flame(state, 0, 'charge');
    const shopRoll = dispatch(state, { type: 'REROLL_DICE' }, constant(0));
    expect(shopRoll.state.dice[0].chargeXMult).toBe(0);
    const next = dispatch(shopRoll.state, { type: 'NEXT_ROUND' }, constant(0));
    expect(next.state.dice[0].chargeXMult).toBe(0.5);
  });

  it('Double Encore grants finite uses once per die per round, then allows normal consumption', () => {
    let state = game([4, 4, 4, 2, 6]);
    flame(state, 0, 'doubleEncore');
    for (let attempt = 0; attempt < 3; attempt++) {
      state.dice[0].value = state.dice[1].value = state.dice[2].value = 4;
      state = play(state).state;
      expect(state.handPlayCounts.threeKind).toBe(attempt + 1);
      if (attempt < 2) expect(state.consumed).not.toContain('threeKind');
    }
    expect(state.consumed).toContain('threeKind');
    expect(state.stats.doubleEncoreUsesGranted).toBe(2);
    expect(state.stats.flameTriggers.doubleEncore).toBe(1);
  });

  it('checks Sustainable only after Encore bonus uses and resets Encore activation next round', () => {
    let state = game([4, 4, 4, 2, 6]);
    flame(state, 0, 'doubleEncore');
    enhance(state, 0, 'sustainable');
    for (let attempt = 0; attempt < 3; attempt++) {
      state.dice[0].value = state.dice[1].value = state.dice[2].value = 4;
      state = play(state, 'threeKind', [0, 1, 2], constant(0)).state;
    }
    expect(state.stats.probabilityProcs.sustainable.checks).toBe(1);
    expect(state.consumed).not.toContain('threeKind');
    state.phase = 'shop';
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0 };
    const next = dispatch(state, { type: 'NEXT_ROUND' }, constant(0)).state;
    expect(next.doubleEncoreUsedDieIds).toEqual([]);
  });

  it('Personal Trainer levels only a winning played hand after scoring and stacks across scorers', () => {
    const state = game();
    state.target = 1;
    state.stats.rounds[0].target = 1;
    flame(state, 0, 'personalTrainer');
    flame(state, 1, 'personalTrainer');
    const result = play(state);
    expect(result.state.stats.handScores[0]).toMatchObject({ handLevel: 1, basePips: 10 });
    expect(result.state.handLevels.threeKind).toBe(3);
    expect(result.state.stats.personalTrainerLevelsGranted).toBe(2);
  });

  it('does not train on a non-winning hand or standalone clear, but a successful Hitchhiker can train', () => {
    const nonWinning = game();
    flame(nonWinning, 0, 'personalTrainer');
    expect(play(nonWinning).state.handLevels.threeKind).toBe(1);

    const hitch = game([4, 4, 4, 2, 6]);
    hitch.target = 1;
    hitch.stats.rounds[0].target = 1;
    flame(hitch, 4, 'personalTrainer');
    enhance(hitch, 4, 'hitchhiker');
    expect(play(hitch, 'threeKind', [0, 1, 2], constant(0)).state.handLevels.threeKind).toBe(2);

    const standalone = game([5, 4, 4, 2, 6]);
    standalone.target = 1;
    standalone.stats.rounds[0].target = 1;
    flame(standalone, 0, 'personalTrainer');
    enhance(standalone, 0, 'jumpingBean', 1, 6);
    const cleared = dispatch(standalone, { type: 'MANUAL_REROLL', dieIds: [0] }, sequence(0.99, 0));
    expect(cleared.state.handLevels.threeKind).toBe(1);
  });

  it('Loose Cannon doubles standalone XMult but not normal hand scoring', () => {
    const state = game();
    flame(state, 0, 'looseCannon');
    expect(play(structuredClone(state)).state.stats.handScores[0].xMult).toBe(1);
    activeFace(state.dice[0]).enhancements.jumpingBean = 1;
    state.dice[0].value = 4;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, sequence(0.55, 0.99));
    const standalone = result.events.find(event => event.type === 'STANDALONE_SCORE_CALCULATED');
    expect(standalone?.xMult).toBe(2);
    expect(standalone?.amount).toBe(Math.round(standalone!.pips! * standalone!.multiplier! * 2));
  });
});

describe('Target Practice selection and Flame Reward lifecycle', () => {
  it('chooses a seeded target from the three least-played Lower hands and keeps it fixed', () => {
    const state = game();
    flame(state, 0, 'targetPractice');
    LOWER_HAND_IDS.forEach((hand, index) => { state.handPlayCounts[hand] = index < 3 ? 0 : 10; });
    state.phase = 'shop';
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0 };
    const next = dispatch(state, { type: 'NEXT_ROUND' }, constant(0));
    expect(LOWER_HAND_IDS.slice(0, 3)).toContain(next.state.targetPracticeHand);
    expect(next.state.stats.targetPracticeTargets.at(-1)).toEqual({ round: 2, hand: next.state.targetPracticeHand });
  });

  it('does not rotate Target Practice after play or consumption and selects anew next round', () => {
    let state = game([4, 4, 2, 3, 6]);
    flame(state, 0, 'targetPractice');
    state.targetPracticeHand = 'pair';
    const played = play(state, 'pair', [0, 1], constant(0.99));
    expect(played.state.targetPracticeHand).toBe('pair');
    expect(played.state.consumed).toContain('pair');
    played.state.phase = 'shop';
    played.state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0 };
    const next = dispatch(played.state, { type: 'NEXT_ROUND' }, constant(0));
    expect(next.state.targetPracticeHand).not.toBeNull();
    expect(LOWER_HAND_IDS).toContain(next.state.targetPracticeHand!);
    expect(next.state.stats.targetPracticeTargets.at(-1)?.round).toBe(2);
  });

  it('opens only after every third clear, awards Gold first, rolls once, and offers 3 distinct Flames', () => {
    expect(clearRound(1).state.phase).toBe('shop');
    expect(clearRound(2).state.phase).toBe('shop');
    const result = clearRound(3);
    expect(result.state.phase).toBe('flameReward');
    expect(result.state.gold).toBe(7);
    expect(new Set(result.state.flameReward!.offers.map(offer => offer.flame))).toHaveLength(3);
    expect(result.events.findIndex(event => event.goldSource === 'roundClear')).toBeLessThan(result.events.findIndex(event => event.type === 'FLAME_REWARD_OPENED'));
  });

  it('rerolls only offers for 5, 10, then 20 Gold and preserves reward dice into the shop', () => {
    let state = clearRound(3).state;
    state.gold = 100;
    const faces = state.dice.map(die => die.value);
    const firstOffers = state.flameReward!.offers.map(offer => offer.flame);
    state = dispatch(state, { type: 'REROLL_FLAMES' }, constant(0.4)).state;
    expect(state.gold).toBe(95);
    expect(state.dice.map(die => die.value)).toEqual(faces);
    expect(state.flameReward!.offers.map(offer => offer.flame)).not.toEqual(firstOffers);
    state = dispatch(state, { type: 'REROLL_FLAMES' }, constant(0.7)).state;
    expect(state.gold).toBe(85);
    state = dispatch(state, { type: 'REROLL_FLAMES' }, constant(0.2)).state;
    expect(state.gold).toBe(65);
    const offer = state.flameReward!.offers[0];
    const beforeChoose = state.dice.map(die => die.value);
    const chosen = dispatch(state, { type: 'CHOOSE_FLAME', offerId: offer.id, dieId: 0 }, constant(0));
    expect(chosen.state.phase).toBe('shop');
    expect(chosen.state.dice[0].flame).toBe(offer.flame);
    expect(chosen.state.dice.map(die => die.value)).toEqual(beforeChoose);
    expect(chosen.events.filter(event => event.type === 'DIE_ROLLED')).toHaveLength(0);
    expect(chosen.state.stats.flameRerollGoldSpent).toBe(35);
  });

  it('acquires one free Flame per die slot, records replacement, and resets reroll count on a future reward', () => {
    let state = clearRound(3).state;
    state.gold = 20;
    const first = state.flameReward!.offers[0];
    state.dice[0].flame = 'clockwork';
    const chosen = dispatch(state, { type: 'CHOOSE_FLAME', offerId: first.id, dieId: 0 });
    expect(chosen.state.gold).toBe(20);
    expect(chosen.state.dice[0].flame).toBe(first.flame);
    expect(chosen.state.stats.flameAcquisitions.at(-1)).toMatchObject({ dieId: 0, flame: first.flame, replaced: 'clockwork' });
    expect(chosen.events.some(event => event.type === 'FLAME_REPLACED')).toBe(true);
    const future = clearRound(6).state;
    expect(future.flameReward!.offerRerolls).toBe(0);
  });

  it('Flame Reward rolls obey Clockwork and do not build Charge', () => {
    const clockwork = clearRound(3, 'clockwork').state;
    expect(clockwork.dice[4].value).toBe(1); // Winning board showed 6, reward advances to 1.
    const charge = clearRound(3, 'charge').state;
    expect(charge.dice[4].chargeXMult).toBe(0);
  });

  it('covers the complete stable Flame pool', () => {
    expect(FLAME_IDS).toHaveLength(13);
    expect(new Set(FLAME_IDS)).toHaveLength(13);
  });
});
