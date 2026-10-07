import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import {
  beginChallengeRound, CHALLENGES, completeChallengeRound, createActiveChallenge, displayedChallengeProgress,
  eligibleChallenges, observeManualHand, observeManualReroll, observeScoringEvent, projectWildfire,
  observeClearingJackpot, observeMagneticPulls, rankedRecipients, rankedSacrifices, resolveWildfire, selectChallenge, transferMultiplier, weightedRoundFactor,
  wildfireFactor,
} from './hoodedFigure';
import type { ChallengeId, Flame, GameState, RandomSource } from './types';
import { HAND_IDS } from './hands';
import type { Rank } from './types';

const constant = (value: number): RandomSource => ({ next: () => value });
const state = () => newRun('hooded-tests', constant(.2)).state;

function active(game: GameState, id: ChallengeId, target = CHALLENGES[id].baseTarget || 1) {
  const challenge = createActiveChallenge({ ...CHALLENGES[id], target: () => target }, game, 5, 'test');
  beginChallengeRound(challenge);
  return challenge;
}

describe('Hooded Figure challenge selection and targets', () => {
  it('uses build-aware eligibility and excludes Tightrope conflicts', () => {
    const game = state();
    expect(eligibleChallenges(game, 'tightrope').some(item => item.id === 'noTakebacks')).toBe(false);
    expect(eligibleChallenges(game, 'juggler').some(item => item.id === 'beanSalad')).toBe(false);
    game.dice[0].faces[0].enhancements.jumpingBean = 1;
    expect(eligibleChallenges(game, 'juggler').some(item => item.id === 'beanSalad')).toBe(true);
    expect(CHALLENGES.beanSalad.target(game)).toBe(6);
    game.dice[1].faces[2].enhancements.jumpingBean = 3;
    expect(CHALLENGES.beanSalad.target(game)).toBe(12);
  });

  it('requires Magnetic source and destination faces on two distinct player dice', () => {
    const game = state();
    game.dice[0].faces[0].enhancements.magnetic = 1;
    expect(CHALLENGES.magneticPersonality.eligible(game, 'juggler')).toBe(false);
    // Even malformed legacy data with two Magnetic faces on one die cannot make a pull.
    game.dice[0].faces[1].enhancements.magnetic = 1;
    expect(CHALLENGES.magneticPersonality.eligible(game, 'juggler')).toBe(false);
    game.dice[1].faces[2].enhancements.magnetic = 1;
    expect(CHALLENGES.magneticPersonality.eligible(game, 'juggler')).toBe(true);
    for (const die of [game.dice[0], game.dice[1]]) for (const face of die.faces) face.enhancements.bump = 1;
    expect(CHALLENGES.magneticPersonality.eligible(game, 'juggler')).toBe(false);
    delete game.dice[1].faces[0].enhancements.bump;
    expect(CHALLENGES.magneticPersonality.eligible(game, 'juggler')).toBe(true);
    game.dice[1].owner = 'boss';
    expect(CHALLENGES.magneticPersonality.eligible(game, 'juggler')).toBe(false);
  });

  it('deterministically avoids the immediately previous eligible challenge', () => {
    const game = state();
    const first = selectChallenge(game, 'juggler', null, constant(0))!;
    const second = selectChallenge(game, 'juggler', first.id, constant(0))!;
    expect(second.id).not.toBe(first.id);
    expect(selectChallenge(game, 'juggler', first.id, constant(0))!.id).toBe(second.id);
  });

  it('snapshots scalable targets without following later purchases', () => {
    const game = state();
    game.dice[0].faces[0].enhancements.vintage = 1;
    const challenge = createActiveChallenge(CHALLENGES.agedToPerfection, game, 5, 'test');
    expect(challenge.target).toBe(4);
    game.dice[1].faces[0].enhancements.vintage = 1;
    expect(challenge.target).toBe(4);
    expect(CHALLENGES.agedToPerfection.target(game)).toBe(8);
  });

  it('builds every scalable target from physical faces or actual stack count', () => {
    const game = state();
    for (let index = 0; index < 3; index++) {
      game.dice[index].faces[0].enhancements.bonus = index + 1;
      game.dice[index].faces[1].enhancements.golden = index + 1;
      game.dice[index].faces[2].enhancements.magnetic = 1;
    }
    game.dice[0].faces[3].enhancements.workout = 3;
    expect(CHALLENGES.bonusRound.target(game)).toBe(3);
    expect(CHALLENGES.goldRush.target(game)).toBe(3);
    expect(CHALLENGES.magneticPersonality.target(game)).toBe(9);
    expect(CHALLENGES.getYourRepsIn.target(game)).toBe(9);
  });
});

describe('challenge progress semantics', () => {
  it('separates manual hand progress from free-play scoring', () => {
    const game = state();
    const challenge = active(game, 'fiveAlive', 3);
    observeScoringEvent(challenge, [{ printed: 5, enhancements: {} }], 'jumpingBean');
    expect(displayedChallengeProgress(challenge)).toBe(0);
    observeManualHand(challenge, 'fiveKind');
    expect(displayedChallengeProgress(challenge)).toBe(1);
  });

  it('tracks printed values and free-play participants for Roll Call and Low Profile', () => {
    const game = state();
    const rollCall = active(game, 'rollCall', 6);
    observeScoringEvent(rollCall, [1, 2, 3, 4, 5, 6].map(printed => ({ printed, enhancements: {} })), 'jumpingBean');
    expect(completeChallengeRound(rollCall, 100, 100)).toBe(true);
    const lowProfile = active(game, 'lowProfile', 1);
    observeScoringEvent(lowProfile, [{ printed: 6, enhancements: {} }], 'jumpingBean');
    expect(completeChallengeRound(lowProfile, 100, 100)).toBe(false);
  });

  it('resets one-Round attempts but retains committed across-Chapter progress', () => {
    const game = state();
    const single = active(game, 'upperClass', 6);
    observeManualHand(single, 'ones');
    beginChallengeRound(single);
    expect(single.attempt.value).toBe(0);
    const across = active(game, 'theLongWay', 3);
    observeManualHand(across, 'largeStraight');
    completeChallengeRound(across, 100, 100);
    beginChallengeRound(across);
    expect(across.attempt.value).toBe(1);
  });

  it('invalidates only player-initiated rerolls for No Takebacks', () => {
    const game = state();
    const challenge = active(game, 'noTakebacks', 1);
    observeManualReroll(challenge);
    expect(completeChallengeRound(challenge, 100, 100)).toBe(false);
  });

  it('counts Enhancement face activations and stacks with the specified models', () => {
    const game = state();
    const bonus = active(game, 'bonusRound', 2);
    observeScoringEvent(bonus, [{ printed: 2, enhancements: { bonus: 4 } }, { printed: 3, enhancements: { bonus: 1 } }], 'manual');
    expect(bonus.attempt.value).toBe(2);
    const workout = active(game, 'getYourRepsIn', 4);
    observeScoringEvent(workout, [{ printed: 2, enhancements: { workout: 3 } }], 'manual');
    expect(workout.attempt.value).toBe(3);
    observeScoringEvent(workout, [{ printed: 2, enhancements: { workout: 3 }, enhancementsActive: false }], 'manual');
    expect(workout.attempt.value).toBe(3);
  });

  it('handles set, clear-condition, opposite-face, and Fully Loaded families', () => {
    const game = state();
    const lower = active(game, 'lowerClass', 8);
    for (const hand of ['pair', 'twoPair', 'threeKind', 'fullHouse', 'fourKind', 'fiveKind', 'smallStraight', 'largeStraight'] as const)
      observeManualHand(lower, hand);
    expect(completeChallengeRound(lower, 100, 100)).toBe(true);

    const close = active(game, 'closeCall', 1);
    expect(completeChallengeRound(close, 111, 100)).toBe(false);
    beginChallengeRound(close);
    expect(completeChallengeRound(close, 110, 100)).toBe(true);

    const upperOnly = active(game, 'upperManagement', 1);
    observeScoringEvent(upperOnly, [{ printed: 2, enhancements: {} }], 'jumpingBean');
    observeManualHand(upperOnly, 'ones');
    expect(completeChallengeRound(upperOnly, 100, 100)).toBe(true);

    const opposites = active(game, 'oppositesAttract', 2);
    observeScoringEvent(opposites, [{ printed: 1, enhancements: {} }, { printed: 6, enhancements: {} }], 'manual');
    observeScoringEvent(opposites, [{ printed: 1, enhancements: {} }, { printed: 6, enhancements: {} }], 'jumpingBean');
    expect(completeChallengeRound(opposites, 100, 100)).toBe(true);

    const loaded = active(game, 'fullyLoaded', 1);
    observeScoringEvent(loaded, [{ printed: 2, enhancements: { bonus: 1, golden: 1 } },
      { printed: 3, enhancements: { vintage: 1 } }], 'manual');
    expect(completeChallengeRound(loaded, 100, 100)).toBe(true);
  });

  it('counts Jackpot only once per successfully cleared Round and Magnetic by destinations pulled', () => {
    const game = state();
    const jackpot = active(game, 'jackpot', 2);
    observeClearingJackpot(jackpot, true); observeClearingJackpot(jackpot, true);
    expect(completeChallengeRound(jackpot, 100, 100)).toBe(false);
    beginChallengeRound(jackpot);
    observeClearingJackpot(jackpot, true);
    expect(completeChallengeRound(jackpot, 100, 100)).toBe(true);
    const magnetic = active(game, 'magneticPersonality', 4);
    observeMagneticPulls(magnetic, 3); observeMagneticPulls(magnetic, 1);
    expect(completeChallengeRound(magnetic, 100, 100)).toBe(true);
  });
});

describe('contribution ranking and Wildfire formulas', () => {
  it('calculates score-weighted Round factors and defaults no-history to neutral', () => {
    expect(weightedRoundFactor([{ factor: 5, weight: 100 }, { factor: 1, weight: 300 }])).toBe(2);
    const game = state();
    game.bonfires = ['ultimate', 'minigun', 'hailMary', 'fullOfGrace', 'vineyard'];
    game.bonfireContributions = {
      ultimate: { roundCount: 2, factorSum: 8 }, minigun: { roundCount: 1, factorSum: 2 },
      hailMary: { roundCount: 1, factorSum: 5 }, fullOfGrace: { roundCount: 1, factorSum: 3 },
    };
    expect(rankedRecipients(game)).toEqual(['vineyard', 'minigun', 'fullOfGrace']);
    expect(rankedSacrifices(game, 'vineyard')).toEqual(['hailMary', 'ultimate', 'fullOfGrace']);
  });

  it('uses the 25% premium, required rounding, and neutral-preserving variable curve', () => {
    expect(transferMultiplier(5)).toBe(6);
    expect(resolveWildfire('vineyard', 8.5)).toEqual({ kind: 'xMult', baseMax: 5, max: 43 });
    const projected = { flame: 'speedDemon', sacrificedFlame: 'vineyard', sacrificedAverage: 5,
      transferMultiplier: 6, resolved: resolveWildfire('speedDemon', 6) } as const;
    expect(wildfireFactor(projected, 1)).toBe(1);
    expect(wildfireFactor(projected, 9)).toBe(54);
  });

  it('scales every Charge family effect and Max Charge to half steps', () => {
    expect(resolveWildfire('momentum', 6)).toEqual({ kind: 'charge', gain: 3, maxCharge: 30 });
    expect(resolveWildfire('thirdRail', 6)).toEqual({ kind: 'charge', gain: 3, maxCharge: 30 });
    expect(resolveWildfire('jumpStart', 6)).toEqual({ kind: 'charge', gain: 12, maxCharge: 30 });
    expect(resolveWildfire('powerSurge', 6)).toEqual({ kind: 'charge', ratio: 13, maxCharge: 30 });
    expect(resolveWildfire('fluxCapacitor', 6)).toEqual({ kind: 'charge', coefficient: 6, maxCharge: 30 });
  });

  it('converts exactly once and leaves the sacrificed Flame eligible for future offers', () => {
    const game = state();
    const bonfires: Flame[] = ['ultimate', 'minigun', 'hailMary', 'fullOfGrace', 'vineyard'];
    game.bonfires = bonfires;
    game.bonfireContributions.vineyard = { roundCount: 1, factorSum: 5 };
    game.phase = 'hoodedFigure';
    game.hoodedFigure.interaction = { kind: 'return', stage: 'confirm', lines: [], lineIndex: 0,
      recipient: 'ultimate', sacrifice: 'vineyard' };
    const result = dispatch(game, { type: 'CONFIRM_WILDFIRE' }, constant(.2));
    expect(result.error).toBeUndefined();
    expect(result.state.bonfires).toHaveLength(3);
    expect(result.state.wildfires).toHaveLength(1);
    expect(result.state.wildfires[0]).toMatchObject(projectWildfire(game, 'ultimate', 'vineyard'));
    expect(result.state.bonfireContributions.vineyard).toBeUndefined();
    expect(dispatch(result.state, { type: 'CONFIRM_WILDFIRE' }, constant(.2)).error).toBeTruthy();
  });

  it('uses persisted Wildfire strength in authoritative scoring and Charge generation', () => {
    const xmult = state();
    xmult.target = 999999;
    xmult.handLevels.ones = 10;
    xmult.dice.forEach(die => { die.value = 1; });
    xmult.wildfires = [{ flame: 'ultimate', sacrificedFlame: 'vineyard', sacrificedAverage: 7,
      transferMultiplier: 8.5, resolved: { kind: 'xMult', baseMax: 5, max: 43 } }];
    const scored = dispatch(xmult, { type: 'PLAY', hand: 'ones', dieIds: xmult.dice.map(die => die.id) }, constant(0));
    expect(scored.state.stats.handScores.at(-1)?.xMultFactors).toContainEqual(expect.objectContaining({ source: 'ultimate', value: 43 }));

    const charge = state();
    charge.target = 999999; charge.dice[0].value = 1;
    charge.wildfires = [{ flame: 'momentum', sacrificedFlame: 'vineyard', sacrificedAverage: 5,
      transferMultiplier: 6, resolved: { kind: 'charge', gain: 3, maxCharge: 30 } }];
    const charged = dispatch(charge, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    expect(charged.state.chargeXMult).toBe(4);
    expect(charged.state.maxCharge).toBe(30);
  });

  it('commits one contribution observation per cleared Round', () => {
    const game = state();
    game.bonfires = ['ultimate'];
    game.handLevels.ones = 10;
    game.bonfireRoundContributions = { ultimate: { observations: [] } };
    game.target = 1; game.stats.rounds.at(-1)!.target = 1;
    game.dice[0].value = 1;
    const result = dispatch(game, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    expect(result.state.bonfireContributions.ultimate?.roundCount).toBe(1);
    expect(result.state.bonfireContributions.ultimate?.factorSum).toBe(5);
  });
});

describe('Time Travel integration', () => {
  it('retains the same challenge, resets it, rewinds contribution history, and skips the opening cinematic', () => {
    const game = state();
    game.round = 25;
    game.presentedChapters = [1, 2, 3, 4, 5];
    game.phase = 'specialOffer';
    game.specialOffer = { offers: [{ id: 1, type: 'timeTravel' }], acquired: true, chosen: { id: 1, type: 'timeTravel' } };
    const challenge = active(game, 'theLongWay', 3);
    challenge.committed.value = 3; challenge.attempt.value = 3; challenge.complete = true;
    game.hoodedFigure.active = challenge;
    game.hoodedFigure.contributionCheckpoint = { ultimate: { roundCount: 1, factorSum: 2 } };
    game.bonfireContributions = { ultimate: { roundCount: 4, factorSum: 12 } };
    const result = dispatch(game, { type: 'CONTINUE_SPECIAL_OFFER' }, constant(.2));
    expect(result.error).toBeUndefined();
    expect(result.state.hoodedFigure.active?.id).toBe('theLongWay');
    expect(result.state.hoodedFigure.active?.complete).toBe(false);
    expect(result.state.hoodedFigure.active?.attempt.value).toBe(0);
    expect(result.state.bonfireContributions.ultimate).toEqual({ roundCount: 1, factorSum: 2 });
    expect(result.state.hoodedFigure.interaction).toBeNull();
    expect(result.state.phase).toBe('round');
  });
});

describe('encounter and checkpoint lifecycle', () => {
  it('issues once at a genuinely new Chapter 5 with exactly five ordinary Bonfires', () => {
    const game = state();
    game.round = 24;
    game.presentedChapters = [1, 2, 3, 4];
    game.phase = 'shop';
    game.shop = { kind: 'post_boss', offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    game.bonfires = ['ultimate', 'minigun', 'hailMary', 'fullOfGrace', 'vineyard'];
    const result = dispatch(game, { type: 'NEXT_CHAPTER' }, constant(.2));
    expect(result.state.phase).toBe('hoodedFigure');
    expect(result.state.hoodedFigure.seen).toBe(true);
    expect(result.state.hoodedFigure.active?.issuedChapter).toBe(5);
    expect(result.events.filter(event => event.type === 'HOODED_CHALLENGE_ISSUED')).toHaveLength(1);
  });

  it('does not count a Wildfire toward the five ordinary Bonfires threshold', () => {
    const game = state();
    game.round = 24; game.presentedChapters = [1, 2, 3, 4]; game.phase = 'shop';
    game.shop = { kind: 'post_boss', offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    game.bonfires = ['ultimate', 'minigun', 'hailMary', 'fullOfGrace'];
    game.wildfires = [{ flame: 'vineyard', sacrificedFlame: 'fatCat', sacrificedAverage: 2,
      transferMultiplier: 2.25, resolved: { kind: 'xMult', baseMax: 5, max: 11 } }];
    const result = dispatch(game, { type: 'NEXT_CHAPTER' }, constant(.2));
    expect(result.state.phase).toBe('round');
    expect(result.state.hoodedFigure.active).toBeNull();
  });

  it('restores apparent attempt completion on Bust while retaining committed progress', () => {
    let game = state();
    game.phase = 'shop';
    game.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    const challenge = active(game, 'theLongWay', 3);
    challenge.committed.value = 1; challenge.attempt.value = 1;
    game.hoodedFigure.active = challenge;
    game = dispatch(game, { type: 'NEXT_ROUND' }, constant(.2)).state;
    game.hoodedFigure.active!.attempt.value = 3;
    game.hoodedFigure.active!.complete = true;
    game.dice.forEach((die, index) => { die.value = ([1, 2, 2, 4, 5] as Rank[])[index]; });
    game.score = 0; game.manualRerollsRemaining = 0; game.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    const busted = dispatch(game, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    expect(busted.state.phase).toBe('shop');
    expect(busted.state.hoodedFigure.active?.complete).toBe(false);
    expect(busted.state.hoodedFigure.active?.attempt.value).toBe(1);
    expect(busted.state.hoodedFigure.active?.committed.value).toBe(1);
    expect(busted.events.some(event => event.type === 'HOODED_CHALLENGE_ROLLED_BACK')).toBe(true);
  });
});
