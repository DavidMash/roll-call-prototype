import { describe, expect, it } from 'vitest';
import { activeFace } from '../game/dice';
import { dispatch, newRun } from '../game/engine';
import { combinationsForHand } from '../game/hands';
import type { Action, GameState } from '../game/types';
import { dispatchTutorial, newTutorialSession, tutorialActionError } from './scenario';
import { curateTutorialOffers } from './curatedOffers';
import { buildRound2Plan, reconcileTutorialBindings } from './tutorialBindings';

function act(session: ReturnType<typeof newTutorialSession>['session'], action: Action) {
  const next = dispatchTutorial(session, action);
  expect(next.error).toBeUndefined();
  return next.session;
}

describe('tutorial scenario', () => {
  it('runs the authored C1 R1 sequence through real scoring and payout mechanics', () => {
    let { session } = newTutorialSession();
    expect(session.game.dice.map(die => activeFace(die).rank)).toEqual([1, 2, 1, 5, 6]);
    expect(session.game.bossSchedule).toMatchObject({ 3: 'capitalReturn', 6: 'quickdraw', 9: 'juggler', 12: 'warden' });

    session = act(session, { type: 'MANUAL_REROLL', dieIds: [1] });
    expect(session.game.dice.map(die => activeFace(die).rank)).toEqual([1, 1, 1, 5, 6]);
    expect(session.game.manualRerollsRemaining).toBe(2);

    session = act(session, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] });
    expect(session.game.dice.map(die => activeFace(die).rank)).toEqual([4, 4, 2, 5, 6]);
    session = act(session, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] });
    expect(session.game.dice.map(die => activeFace(die).rank)).toEqual([3, 1, 2, 5, 6]);
    session = act(session, { type: 'PLAY', hand: 'sixes', dieIds: [4] });
    session = act(session, { type: 'PLAY', hand: 'fives', dieIds: [3] });
    expect(session.game.dice.map(die => activeFace(die).rank)).toEqual([3, 1, 2, 4, 6]);
    session = act(session, { type: 'PLAY', hand: 'smallStraight', dieIds: [0, 1, 2, 3] });

    expect(session.game.phase).toBe('roundSummary');
    expect(session.game.dice.map(die => activeFace(die).rank)).toEqual([2, 4, 5, 1, 6]);
    expect(session.game.lastRoundPayout).toMatchObject({ baseGold: 5, unusedRerollGold: 2, totalRoundRewardGold: 7 });
    expect(session.game.gold).toBe(7);
  });

  it('curates Shop 1 and C1 R2 while purchases and enhancement triggers stay authoritative', () => {
    let { session } = newTutorialSession();
    session = act(session, { type: 'MANUAL_REROLL', dieIds: [1] });
    session = act(session, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] });
    session = act(session, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] });
    session = act(session, { type: 'PLAY', hand: 'sixes', dieIds: [4] });
    session = act(session, { type: 'PLAY', hand: 'fives', dieIds: [3] });
    session = act(session, { type: 'PLAY', hand: 'smallStraight', dieIds: [0, 1, 2, 3] });
    session = act(session, { type: 'CONTINUE_ROUND_SUMMARY' });

    expect(session.game.shop?.trainingOffers).toContainEqual({ kind: 'hand', hand: 'fullHouse', purchases: 0 });
    expect(session.game.shop?.offers.map(offer => offer.enhancement)).toEqual(['bonus', 'magnetic', 'jackpot']);
    const bonus = session.game.shop?.offers.find(offer => offer.enhancement === 'bonus');
    expect(bonus).toBeDefined();
    session = act(session, { type: 'TRAIN_HAND', hand: 'fullHouse' });
    expect(session.game.handLevels.fullHouse).toBe(2);
    expect(session.game.gold).toBe(5);
    session = act(session, { type: 'BUY', offerId: bonus!.id, dieId: 1 });
    expect(activeFace(session.game.dice[1]).enhancements.bonus).toBe(1);
    expect(session.game.gold).toBe(2);

    session = act(session, { type: 'NEXT_ROUND' });
    const round2Plan = session.scenario.round2Plan!;
    expect(round2Plan.pairRanks).toContain(session.scenario.bonusBinding!.faceRank);
    expect(combinationsForHand(session.game.dice, 'twoPair')).not.toHaveLength(0);
    session = act(session, { type: 'PLAY', hand: round2Plan.upperHand, dieIds: [round2Plan.singletonDieId] });
    expect(combinationsForHand(session.game.dice, 'fullHouse')).not.toHaveLength(0);
    expect(session.game.manualRerollsRemaining).toBe(3);
    session = act(session, { type: 'PLAY', hand: 'fullHouse', dieIds: [0, 1, 2, 3, 4] });
    expect(session.game.phase).toBe('roundSummary');
    expect(session.game.stats.triggers.bonus).toBe(1);
    expect(session.game.stats.handScores.at(-1)?.handLevel).toBe(2);
  });

  it.each([1, 2, 3, 4, 5, 6] as const)('binds Bonus to D2\'s actual exposed face %i', rank => {
    const { session } = newTutorialSession();
    session.game.round = 1;
    session.game.phase = 'shop';
    session.game.gold = 100;
    session.game.dice[1].value = rank;
    session.game.shop = {
      offers: [{ id: 91, enhancement: 'bonus', purchased: false }],
      trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0,
    };
    session.scenario.completedBeatIds.push('shop1-train-full-house');
    reconcileTutorialBindings(session);
    expect(session.scenario.bonusBinding).toEqual({ dieId: 1, faceRank: rank });

    const result = dispatchTutorial(session, { type: 'BUY', offerId: 91, dieId: 1 });
    expect(result.error).toBeUndefined();
    expect(result.session.scenario.bonusBinding).toEqual({ dieId: 1, faceRank: rank });
    expect(result.session.game.dice[1].faces.find(face => face.rank === rank)?.enhancements.bonus).toBe(1);
  });

  it('reconciles a stale expected face before validation instead of trapping placement', () => {
    const { session } = newTutorialSession();
    session.game.round = 1;
    session.game.phase = 'shop';
    session.game.gold = 100;
    session.game.dice[1].value = 2;
    session.game.shop = {
      offers: [{ id: 92, enhancement: 'bonus', purchased: false }],
      trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0,
    };
    session.scenario.completedBeatIds.push('shop1-train-full-house');
    session.scenario.bonusBinding = { dieId: 1, faceRank: 4 };

    const result = dispatchTutorial(session, { type: 'BUY', offerId: 92, dieId: 1 });
    expect(result.error).toBeUndefined();
    expect(result.session.scenario.bonusBinding).toEqual({ dieId: 1, faceRank: 2 });
  });

  it('releases rank-relative validation when the required authored hand no longer exists', () => {
    const { session } = newTutorialSession();
    session.game.round = 2;
    session.game.phase = 'round';
    session.scenario.bonusBinding = { dieId: 1, faceRank: 4 };
    session.scenario.round2Plan = buildRound2Plan(session.game.dice, session.scenario.bonusBinding);
    session.game.dice.forEach(die => { die.value = 6; });

    expect(tutorialActionError(session, { type: 'PLAY', hand: 'sixes', dieIds: session.game.dice.map(die => die.id) })).toBeNull();
  });

  it.each([2, 4, 6] as const)('builds C1 R2 relative to Bonus face %i', bonusRank => {
    let { session } = newTutorialSession();
    const binding = { dieId: 1, faceRank: bonusRank } as const;
    session.game.dice[1].faces.find(face => face.rank === bonusRank)!.enhancements.bonus = 1;
    const plan = buildRound2Plan(session.game.dice, binding)!;
    session.scenario.bonusBinding = binding;
    session.scenario.round2Plan = plan;
    session.game.round = 2;
    session.game.phase = 'round';
    session.game.target = 999_999;
    session.game.score = 0;
    session.game.consumed = [];
    plan.opening.forEach(({ dieId, rank }) => { session.game.dice[dieId].value = rank; });

    expect(new Set(plan.opening.map(item => item.rank)).size).toBe(3);
    expect(combinationsForHand(session.game.dice, 'twoPair')).not.toHaveLength(0);
    session = act(session, { type: 'PLAY', hand: plan.upperHand, dieIds: [plan.singletonDieId] });
    expect(combinationsForHand(session.game.dice, 'fullHouse')).not.toHaveLength(0);
    session = act(session, { type: 'PLAY', hand: 'fullHouse', dieIds: session.game.dice.map(die => die.id) });
    expect(session.game.stats.triggers.bonus).toBe(1);
  });

  it('intercepts only tutorial final-life busts in Chapters 1 and 2', () => {
    const fresh = newTutorialSession().session;
    const prepare = (state: GameState) => {
      state.round = 5;
      state.target = 10_000;
      state.lives = 1;
      state.manualRerollsRemaining = 0;
      state.consumed = ['twos', 'threes', 'fours', 'fives', 'sixes', 'pair', 'twoPair', 'threeKind', 'fullHouse', 'fourKind', 'fiveKind', 'smallStraight', 'largeStraight'];
      state.dice.forEach(die => { die.value = 1; });
      const current = state.stats.rounds.at(-1)!;
      current.round = 5;
      current.target = state.target;
    };
    prepare(fresh.game);
    const protectedResult = dispatchTutorial(fresh, { type: 'PLAY', hand: 'ones', dieIds: [0, 1, 2, 3, 4] });
    expect(protectedResult.session.game.phase).toBe('round');
    expect(protectedResult.session.game.lives).toBe(1);
    expect(protectedResult.session.game.manualRerollsRemaining).toBe(3);
    expect(protectedResult.session.game.consumed).toEqual([]);
    expect(protectedResult.resolution.events.some(event => event.type === 'TUTORIAL_SAFEGUARD')).toBe(true);

    const normal = newRun('normal-safeguard-check').state;
    prepare(normal);
    const normalResult = dispatch(normal, { type: 'PLAY', hand: 'ones', dieIds: [0, 1, 2, 3, 4] }, { next: () => 0.99 });
    expect(normalResult.state.phase).toBe('lost');
    expect(normalResult.state.lives).toBe(0);
    expect(normalResult.events.some(event => event.type === 'TUTORIAL_SAFEGUARD')).toBe(false);
  });

  it('releases Warden dice and suppresses only the current tutorial encounter', () => {
    const { session } = newTutorialSession();
    session.game.round = 12;
    session.game.target = 100_000;
    session.game.lives = 1;
    session.game.manualRerollsRemaining = 0;
    session.game.dice.forEach(die => { die.value = 1; });
    session.game.consumed = ['twos', 'threes', 'fours', 'fives', 'sixes', 'pair', 'twoPair', 'threeKind', 'fullHouse', 'fourKind', 'fiveKind', 'smallStraight', 'largeStraight'];
    session.game.boss = { type: 'warden', activeDieIds: [0], startingDieId: 0, nextUnlockTarget: null,
      unlockCosts: [20, 40, 60, 80], unlockTargets: [], pendingReinforcements: 0 };
    const current = session.game.stats.rounds.at(-1)!;
    current.round = 12;
    current.target = session.game.target;

    const result = dispatchTutorial(session, { type: 'PLAY', hand: 'ones', dieIds: [0] });
    expect(result.error).toBeUndefined();
    expect(result.session.game.bossSilenced).toBe(true);
    expect(result.session.game.boss?.type).toBe('warden');
    if (result.session.game.boss?.type !== 'warden') throw new Error('Expected Warden');
    expect(result.session.game.boss.activeDieIds).toEqual([0, 1, 2, 3, 4]);
    expect(result.session.game.boss.pendingReinforcements).toBe(0);
    expect(result.session.scenario.suppressedEncounterRound).toBe(12);
    expect(result.session.game.specialOfferEffects.silence).toBe(false);
  });

  it.each([
    ['doubleDown', 'pair', 'twoPair'],
    ['straightShooter', 'smallStraight', 'largeStraight'],
    ['minigun', null, 'sixes'],
  ] as const)('builds the C2 R1 %s lesson and applies its real XMult', (flame, setupHand, payoffHand) => {
    let { session } = newTutorialSession();
    session.game.round = 6;
    session.game.phase = 'shop';
    session.game.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    session.scenario.firstFlame = flame;
    session.scenario.firstFlameDieId = 4;
    session.game.dice[4].flame = { id: flame, investedGold: 1 };
    session = act(session, { type: 'NEXT_ROUND' });

    const values = session.game.dice.map(die => activeFace(die).rank);
    if (flame === 'doubleDown') expect(values.sort()).toEqual([2, 4, 5, 6, 6]);
    if (flame === 'straightShooter') expect(new Set(values)).toEqual(new Set([1, 2, 3, 4, 6]));
    if (flame === 'minigun') expect(values.filter(value => value === 6)).toHaveLength(2);

    if (setupHand === 'pair') {
      const pair = session.game.dice.filter(die => activeFace(die).rank === 6).map(die => die.id);
      session = act(session, { type: 'PLAY', hand: setupHand, dieIds: pair });
    } else if (setupHand === 'smallStraight') {
      const straight = session.game.dice.filter(die => activeFace(die).rank !== 6).map(die => die.id);
      session = act(session, { type: 'PLAY', hand: setupHand, dieIds: straight });
    }

    const payoffIds = payoffHand === 'twoPair'
      ? session.game.dice.filter(die => [2, 4].includes(activeFace(die).rank)).map(die => die.id)
      : payoffHand === 'largeStraight' ? session.game.dice.map(die => die.id)
        : session.game.dice.filter(die => activeFace(die).rank === 6).map(die => die.id);
    session = act(session, { type: 'PLAY', hand: payoffHand, dieIds: payoffIds });
    expect(session.game.stats.flameTriggers[flame]).toBe(1);
    expect(session.game.stats.handScores.at(-1)?.xMultFactors.some(factor => factor.source === flame)).toBe(true);
  });

  it('uses the authored second Flame pools and keeps Vintage seeding initial-shop-only', () => {
    const pools = {
      doubleDown: ['missingPair', 'threesCompany', 'minigun'],
      straightShooter: ['oneShort', 'threesCompany', 'minigun'],
      minigun: ['threesCompany', 'missingPair', 'oneShort'],
    } as const;
    for (const [first, expected] of Object.entries(pools)) {
      const { session } = newTutorialSession();
      session.game.round = 12;
      session.game.phase = 'flameSelection';
      session.game.flameSelection = { offers: [], acquired: false };
      session.scenario.firstFlame = first as keyof typeof pools;
      curateTutorialOffers(session.game, session.scenario);
      expect(session.game.flameSelection.offers.map(offer => offer.flame)).toEqual(expected);
    }

    const { session } = newTutorialSession();
    session.game.round = 2;
    session.game.phase = 'shop';
    session.game.shop = { offers: [
      { id: 1, enhancement: 'bonus', purchased: false },
      { id: 2, enhancement: 'golden', purchased: false },
      { id: 3, enhancement: 'sticky', purchased: false },
    ], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    curateTutorialOffers(session.game, session.scenario);
    expect(session.game.shop.offers.some(offer => offer.enhancement === 'vintage')).toBe(true);
    session.game.shop.offerRerolls = 1;
    session.game.shop.offers[0].enhancement = 'bonus';
    curateTutorialOffers(session.game, session.scenario);
    expect(session.game.shop.offers.some(offer => offer.enhancement === 'vintage')).toBe(false);
    session.game.shop.offerRerolls = 0;
    session.scenario.vintagePurchased = true;
    curateTutorialOffers(session.game, session.scenario);
    expect(session.game.shop.offers.some(offer => offer.enhancement === 'vintage')).toBe(false);
  });

  it('places Workout on a real physical face and uses its increment in the C1 R4 route', () => {
    let { session } = newTutorialSession();
    session.game.round = 3;
    session.game.phase = 'specialOffer';
    session.game.gold = 10;
    session.game.handLevels.fullHouse = 2;
    session.game.specialOffer = { offers: [{ id: 80, type: 'carePackage' }], acquired: true, chosen: { id: 80, type: 'carePackage' } };
    session.game.dice[1].faces[3].enhancements.bonus = 1;
    session.game.dice[0].value = 5;
    session = act(session, { type: 'CONTINUE_SPECIAL_OFFER' });

    const workoutBinding = session.scenario.workoutBinding!;
    const workoutDieId = workoutBinding.dieId;
    expect(workoutBinding.faceRank).toBe(5);
    expect(activeFace(session.game.dice[workoutDieId]).rank).toBe(workoutBinding.faceRank);
    const workout = session.game.shop?.offers.find(offer => offer.enhancement === 'workout');
    expect(workout).toBeDefined();
    session = act(session, { type: 'BUY', offerId: workout!.id, dieId: workoutDieId });
    expect(activeFace(session.game.dice[workoutDieId]).enhancements.workout).toBe(1);
    session = act(session, { type: 'NEXT_ROUND' });
    const round4Plan = session.scenario.round4Plan!;
    expect(round4Plan.singletonRank).toBe(workoutBinding.faceRank);
    session = act(session, { type: 'PLAY', hand: round4Plan.upperHand, dieIds: [workoutDieId] });
    expect(session.game.dice[workoutDieId].faces.find(face => face.rank === workoutBinding.faceRank)?.workoutPips).toBe(1);
    expect(combinationsForHand(session.game.dice, 'fullHouse')).not.toHaveLength(0);
    const fullHouseIds = session.game.dice.map(die => die.id);
    session = act(session, { type: 'PLAY', hand: 'fullHouse', dieIds: fullHouseIds });
    expect(session.game.stats.handScores.at(-1)?.handLevel).toBe(2);
  });
});
