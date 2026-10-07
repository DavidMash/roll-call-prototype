import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { finalizeScore } from './scoring';
import { HAND_IDS } from './hands';
import {
  beginChallengeRound, CHALLENGE_IDS, CHALLENGES, completeChallengeRound, createActiveChallenge,
  observeClearingJackpot, observeMagneticPulls, observeManualHand, observeManualReroll,
  observeScoringEvent, projectWildfire, rankedRecipients, rankedSacrifices, resolveWildfire,
  transferMultiplier, wildfireFactor, wildfirePreview,
} from './hoodedFigure';
import type { ActiveHoodedChallenge, ChallengeId, Flame, GameState, RandomSource, Rank } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });
const game = (seed = 'hooded-audit') => newRun(seed, constant(.2)).state;
const setValues = (state: GameState, values: Rank[]) => values.forEach((value, index) => { state.dice[index].value = value; });

function playWithoutClearing(state: GameState, hand: Parameters<Resolver['play']>[0], ids: number[], source: 'manual' | 'jumpingBean' = 'manual') {
  state.target = 999_999_999;
  state.stats.rounds.at(-1)!.target = state.target;
  const resolver = new Resolver(state, constant(.2));
  resolver.play(hand, ids, source);
  return state.stats.handScores.at(-1)!;
}

function challenge(id: ChallengeId, target = CHALLENGES[id].baseTarget || 1): ActiveHoodedChallenge {
  const state = game(`challenge-${id}`);
  const result = createActiveChallenge({ ...CHALLENGES[id], target: () => target }, state, 5, 'audit');
  beginChallengeRound(result);
  return result;
}

describe('all 19 challenge specifications', () => {
  it('contains the complete, typed V1 challenge library', () => {
    expect(CHALLENGE_IDS).toEqual([
      'fiveAlive', 'theLongWay', 'upperClass', 'lowerClass', 'varietyPack', 'closeCall',
      'noTakebacks', 'upperManagement', 'rollCall', 'lowProfile', 'oppositesAttract',
      'beanSalad', 'bonusRound', 'goldRush', 'agedToPerfection', 'magneticPersonality',
      'jackpot', 'getYourRepsIn', 'fullyLoaded',
    ]);
  });

  it('counts Five Alive and The Long Way only for manual plays across R1-R3', () => {
    for (const [id, hand] of [['fiveAlive', 'fiveKind'], ['theLongWay', 'largeStraight']] as const) {
      const active = challenge(id, 3);
      observeScoringEvent(active, [{ printed: 1, enhancements: {} }], 'jumpingBean');
      observeManualHand(active, hand); observeManualHand(active, hand);
      expect(completeChallengeRound(active, 100, 100)).toBe(false);
      beginChallengeRound(active); observeManualHand(active, hand);
      expect(completeChallengeRound(active, 100, 100)).toBe(true);
    }
  });

  it('requires all six Upper hands in one Round and all eight Lower hands across R1-R3', () => {
    const upper = challenge('upperClass', 6);
    for (const hand of ['ones', 'twos', 'threes', 'fours', 'fives'] as const) observeManualHand(upper, hand);
    expect(completeChallengeRound(upper, 100, 100)).toBe(false);
    beginChallengeRound(upper);
    expect(upper.attempt.value).toBe(0);
    for (const hand of ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const) observeManualHand(upper, hand);
    expect(completeChallengeRound(upper, 100, 100)).toBe(true);

    const lower = challenge('lowerClass', 8);
    for (const hand of ['pair', 'twoPair', 'threeKind', 'fullHouse'] as const) observeManualHand(lower, hand);
    expect(completeChallengeRound(lower, 100, 100)).toBe(false);
    beginChallengeRound(lower);
    for (const hand of ['fourKind', 'fiveKind', 'smallStraight', 'largeStraight'] as const) observeManualHand(lower, hand);
    expect(completeChallengeRound(lower, 100, 100)).toBe(true);
  });

  it('requires five distinct manual Lower hands for Variety Pack in one Round', () => {
    const active = challenge('varietyPack', 5);
    for (const hand of ['pair', 'pair', 'twoPair', 'threeKind', 'fullHouse'] as const) observeManualHand(active, hand);
    expect(completeChallengeRound(active, 100, 100)).toBe(false);
    beginChallengeRound(active);
    for (const hand of ['pair', 'twoPair', 'threeKind', 'fullHouse', 'fourKind'] as const) observeManualHand(active, hand);
    expect(completeChallengeRound(active, 100, 100)).toBe(true);
  });

  it('accepts Close Call at exactly 100%-110% and rejects both outside boundaries', () => {
    for (const [score, expected] of [[99, false], [100, true], [110, true], [111, false]] as const)
      expect(completeChallengeRound(challenge('closeCall'), score, 100)).toBe(expected);
  });

  it('applies clear-condition rules only to player choices and genuine scoring participants', () => {
    const noTakebacks = challenge('noTakebacks');
    expect(completeChallengeRound(noTakebacks, 100, 100)).toBe(true);
    const rerolled = challenge('noTakebacks'); observeManualReroll(rerolled);
    expect(completeChallengeRound(rerolled, 100, 100)).toBe(false);

    const upper = challenge('upperManagement');
    observeScoringEvent(upper, [{ printed: 2, enhancements: {} }], 'jumpingBean');
    observeManualHand(upper, 'ones');
    expect(completeChallengeRound(upper, 100, 100)).toBe(true);
    const lowerSpoils = challenge('upperManagement'); observeManualHand(lowerSpoils, 'pair');
    expect(completeChallengeRound(lowerSpoils, 100, 100)).toBe(false);

    const low = challenge('lowProfile');
    observeScoringEvent(low, [{ printed: 5, enhancements: {} }], 'jumpingBean');
    expect(completeChallengeRound(low, 100, 100)).toBe(false);
    const hitchhiker = challenge('lowProfile');
    observeScoringEvent(hitchhiker, [{ printed: 1, enhancements: {} }, { printed: 6, enhancements: {} }], 'manual');
    expect(completeChallengeRound(hitchhiker, 100, 100)).toBe(false);
  });

  it('keeps Roll Call in one Round and counts printed free-play/Hitchhiker participants', () => {
    const split = challenge('rollCall', 6);
    observeScoringEvent(split, [1, 2, 3].map(printed => ({ printed, enhancements: {} })), 'manual');
    expect(completeChallengeRound(split, 100, 100)).toBe(false);
    beginChallengeRound(split);
    observeScoringEvent(split, [4, 5, 6].map(printed => ({ printed, enhancements: {} })), 'jumpingBean');
    expect(completeChallengeRound(split, 100, 100)).toBe(false);
    beginChallengeRound(split);
    observeScoringEvent(split, [1, 2, 3, 4, 5, 6].map(printed => ({ printed, enhancements: {} })), 'jumpingBean');
    expect(completeChallengeRound(split, 100, 100)).toBe(true);
  });

  it('counts each Opposites Attract scoring event, including free plays', () => {
    const active = challenge('oppositesAttract', 4);
    for (const source of ['manual', 'jumpingBean', 'manual', 'jumpingBean'] as const)
      observeScoringEvent(active, [{ printed: 1, enhancements: {} }, { printed: 6, enhancements: {} }], source);
    expect(completeChallengeRound(active, 100, 100)).toBe(true);
  });

  it('locks all six scaled targets while allowing later acquisitions to contribute', () => {
    const state = game('scaled-targets');
    for (let index = 0; index < 3; index++) {
      state.dice[index].faces[0].enhancements.bonus = 2;
      state.dice[index].faces[1].enhancements.golden = 2;
      state.dice[index].faces[2].enhancements.magnetic = 1;
    }
    state.dice[0].faces[3].enhancements.jumpingBean = 1;
    state.dice[0].faces[4].enhancements.vintage = 1;
    state.dice[0].faces[5].enhancements.workout = 3;
    const expected = { beanSalad: 6, bonusRound: 3, goldRush: 3, agedToPerfection: 4,
      magneticPersonality: 9, getYourRepsIn: 9 } as const;
    for (const id of Object.keys(expected) as (keyof typeof expected)[]) {
      const active = createActiveChallenge(CHALLENGES[id], state, 5, 'audit');
      expect(active.target).toBe(expected[id]);
      state.dice[4].faces[0].enhancements[id === 'beanSalad' ? 'jumpingBean'
        : id === 'bonusRound' ? 'bonus' : id === 'goldRush' ? 'golden'
          : id === 'agedToPerfection' ? 'vintage' : id === 'magneticPersonality' ? 'magnetic' : 'workout'] = 1;
      expect(active.target).toBe(expected[id]);
      beginChallengeRound(active);
      if (id === 'magneticPersonality') observeMagneticPulls(active, 1);
      else observeScoringEvent(active, [{ printed: 1, enhancements: {
        [id === 'beanSalad' ? 'jumpingBean' : id === 'bonusRound' ? 'bonus' : id === 'goldRush' ? 'golden'
          : id === 'agedToPerfection' ? 'vintage' : 'workout']: 1,
      } }], id === 'beanSalad' ? 'jumpingBean' : 'manual');
      expect(active.attempt.value).toBe(1);
    }
  });

  it('counts Bonus/Golden per face activation, Vintage by scoring, and Workout by active stacks', () => {
    for (const id of ['bonusRound', 'goldRush', 'agedToPerfection'] as const) {
      const enhancement = id === 'bonusRound' ? 'bonus' : id === 'goldRush' ? 'golden' : 'vintage';
      const active = challenge(id, 2);
      observeScoringEvent(active, [{ printed: 2, enhancements: { [enhancement]: 5 } }], 'manual');
      observeScoringEvent(active, [{ printed: 2, enhancements: { [enhancement]: 5 } }], 'jumpingBean');
      expect(active.attempt.value).toBe(2);
    }
    const workout = challenge('getYourRepsIn', 3);
    observeScoringEvent(workout, [{ printed: 2, enhancements: { workout: 3 } }], 'manual');
    expect(workout.attempt.value).toBe(3);
  });

  it('counts Jackpot once per distinct cleared Round and actual Magnetic destinations pulled', () => {
    const jackpot = challenge('jackpot', 2);
    observeClearingJackpot(jackpot, true); observeClearingJackpot(jackpot, true);
    expect(completeChallengeRound(jackpot, 100, 100)).toBe(false);
    beginChallengeRound(jackpot); observeClearingJackpot(jackpot, true);
    expect(completeChallengeRound(jackpot, 100, 100)).toBe(true);
    const magnetic = challenge('magneticPersonality', 3);
    observeMagneticPulls(magnetic, 2); observeMagneticPulls(magnetic, 1);
    expect(completeChallengeRound(magnetic, 100, 100)).toBe(true);
  });

  it('requires three distinct Enhancement types on each Fully Loaded scoring event', () => {
    const active = challenge('fullyLoaded', 3);
    observeScoringEvent(active, [{ printed: 1, enhancements: { bonus: 3, golden: 2 } }], 'manual');
    expect(active.attempt.value).toBe(0);
    for (const source of ['manual', 'jumpingBean', 'manual'] as const)
      observeScoringEvent(active, [{ printed: 1, enhancements: { bonus: 1, golden: 1, vintage: 1 } }], source);
    expect(completeChallengeRound(active, 100, 100)).toBe(true);
  });
});

describe('Bonfire scoring-event counterfactual audit', () => {
  it('removes only the audited Bonfire when two fixed Bonfires activate together', () => {
    const state = game('two-fixed');
    state.handLevels.pair = 10;
    state.bonfires = ['ultimate', 'missingPair'];
    state.bonfireRoundContributions = { ultimate: { observations: [] }, missingPair: { observations: [] } };
    setValues(state, [1, 1, 3, 4, 6]);
    const score = playWithoutClearing(state, 'pair', [0, 1]);
    const expectedWithoutOne = finalizeScore(score.pips, score.multiplier, 5).finalScore;
    expect(score.xMult).toBe(25);
    expect(state.bonfireRoundContributions.ultimate?.observations).toEqual([{ factor: 5, weight: expectedWithoutOne }]);
    expect(state.bonfireRoundContributions.missingPair?.observations).toEqual([{ factor: 5, weight: expectedWithoutOne }]);
  });

  it('records an inactive Bonfire at ×1 with the complete event score as weight', () => {
    const state = game('active-inactive');
    state.handLevels.ones = 10;
    state.bonfires = ['ultimate', 'vineyard'];
    state.bonfireRoundContributions = { ultimate: { observations: [] }, vineyard: { observations: [] } };
    setValues(state, [1, 2, 3, 4, 6]);
    const score = playWithoutClearing(state, 'ones', [0]);
    expect(state.bonfireRoundContributions.ultimate?.observations[0]).toEqual({ factor: 5,
      weight: finalizeScore(score.pips, score.multiplier, 1).finalScore });
    expect(state.bonfireRoundContributions.vineyard?.observations[0]).toEqual({ factor: 1, weight: score.score });
  });

  it('uses the actual variable factor and integer-rounded absent-only counterfactual', () => {
    const state = game('variable-rounding');
    state.bonfires = ['lowball', 'missingPair'];
    state.bonfireRoundContributions = { lowball: { observations: [] }, missingPair: { observations: [] } };
    setValues(state, [5, 5, 2, 3, 6]);
    const score = playWithoutClearing(state, 'pair', [0, 1]);
    const lowball = state.bonfireRoundContributions.lowball!.observations[0];
    const fixed = state.bonfireRoundContributions.missingPair!.observations[0];
    expect(lowball.factor).toBe(2);
    expect(fixed.factor).toBe(5);
    expect(lowball.weight).toBe(finalizeScore(score.pips, score.multiplier, 5).finalScore);
    expect(fixed.weight).toBe(finalizeScore(score.pips, score.multiplier, 2).finalScore);
    expect(Number.isInteger(lowball.weight)).toBe(true);
    expect(Number.isInteger(fixed.weight)).toBe(true);
  });

  it('includes Jumping Bean free-play scoring in active and inactive Bonfire observations', () => {
    const state = game('free-play-contribution');
    state.bonfires = ['minigun', 'vineyard'];
    state.bonfireRoundContributions = { minigun: { observations: [] }, vineyard: { observations: [] } };
    setValues(state, [6, 2, 3, 4, 5]);
    const score = playWithoutClearing(state, 'sixes', [0], 'jumpingBean');
    expect(state.bonfireRoundContributions.minigun?.observations[0]).toEqual({ factor: 5,
      weight: finalizeScore(score.pips, score.multiplier, 1).finalScore });
    expect(state.bonfireRoundContributions.vineyard?.observations[0]).toEqual({ factor: 1, weight: score.score });
  });

  it('commits ×1 for a never-active Bonfire and exactly one lifetime observation for the Round', () => {
    const state = game('one-round-observation');
    state.bonfires = ['vineyard'];
    state.bonfireRoundContributions = { vineyard: { observations: [] } };
    state.target = 1; state.stats.rounds.at(-1)!.target = 1;
    setValues(state, [1, 2, 3, 4, 6]);
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.2));
    expect(result.state.bonfireContributions.vineyard).toEqual({ roundCount: 1, factorSum: 1 });
  });
});

describe('Charge source-attribution audit', () => {
  it('attributes Momentum and Power Surge independently and only credits Surge with its increment', () => {
    const state = game('momentum-surge');
    state.handLevels.ones = 10;
    state.bonfires = ['momentum', 'powerSurge'];
    setValues(state, [1, 2, 3, 4, 6]);
    playWithoutClearing(state, 'ones', [0]);
    expect(state.chargeXMult).toBe(4.5);
    expect(state.chargeAttribution).toEqual({ momentum: .5, powerSurge: 3 });
    expect(Object.values(state.chargeAttribution).reduce((sum, amount) => sum + amount, 0)).toBe(state.chargeXMult - 1);
  });

  it('attributes Third Rail, Jump Start, and Flux only to their triggering sources', () => {
    const thirdRail = game('third-rail-source');
    thirdRail.bonfires = ['thirdRail'];
    const railResolver = new Resolver(thirdRail, constant(.4));
    railResolver.rollBatch([0], 'audit 3', 'gameplay');
    expect(thirdRail.chargeAttribution).toEqual({ thirdRail: .5 });

    const jumpStart = game('jump-start-source');
    jumpStart.bonfires = ['jumpStart'];
    const jumpResolver = new Resolver(jumpStart, constant(.9));
    jumpResolver.manualReroll([0]);
    expect(jumpStart.chargeAttribution).toEqual({ jumpStart: 2 });

    const flux = game('flux-source');
    flux.bonfires = ['fluxCapacitor']; flux.chargeXMult = 2;
    flux.dice[4].value = 6; flux.dice[4].faces[5].enhancements.magnetic = 1;
    flux.dice[0].faces[2].enhancements.magnetic = 1;
    const fluxResolver = new Resolver(flux, constant(.9));
    fluxResolver.rollBatch([0], 'audit pull', 'gameplay');
    expect(flux.chargeXMult).toBe(4);
    expect(flux.chargeAttribution).toEqual({ fluxCapacitor: 2 });
  });

  it('credits only unclipped Charge at the cap', () => {
    const state = game('charge-cap');
    state.bonfires = ['momentum']; state.chargeXMult = 4.8;
    setValues(state, [1, 2, 3, 4, 6]);
    playWithoutClearing(state, 'ones', [0]);
    expect(state.maxCharge).toBe(5);
    expect(state.chargeXMult).toBe(5);
    expect(state.chargeAttribution.momentum).toBeCloseTo(.2);
  });

  it('gives a later Power Surge no credit when an earlier source already reached the cap', () => {
    const state = game('charge-cap-order');
    state.bonfires = ['momentum', 'powerSurge']; state.chargeXMult = 9.8;
    setValues(state, [1, 2, 3, 4, 6]);
    playWithoutClearing(state, 'ones', [0]);
    expect(state.chargeXMult).toBe(10);
    expect(state.chargeAttribution.momentum).toBeCloseTo(.2);
    expect(state.chargeAttribution.powerSurge).toBeUndefined();
  });

  it('uses sensible source-marginal factors on consumption without double attribution', () => {
    const state = game('charge-consumption');
    state.handLevels.ones = 10;
    state.bonfires = ['momentum', 'powerSurge'];
    state.bonfireRoundContributions = { momentum: { observations: [] }, powerSurge: { observations: [] } };
    state.chargeXMult = 4.5; state.chargeArmed = true;
    state.chargeAttribution = { momentum: .5, powerSurge: 3 };
    setValues(state, [1, 2, 3, 4, 6]);
    const score = playWithoutClearing(state, 'ones', [0]);
    const momentum = state.bonfireRoundContributions.momentum!.observations[0];
    const surge = state.bonfireRoundContributions.powerSurge!.observations[0];
    expect(momentum.factor).toBeCloseTo(4.5 / 4);
    expect(surge.factor).toBeCloseTo(4.5 / 1.5);
    expect(momentum.weight).toBe(finalizeScore(score.pips, score.multiplier, 4).finalScore);
    expect(surge.weight).toBe(finalizeScore(score.pips, score.multiplier, 1.5).finalScore);
    // The consumed ledger is gone; only newly generated post-hand Charge remains.
    expect(state.chargeAttribution).toEqual({ momentum: .5, powerSurge: 3 });
  });

  it('discards attempt attribution and contribution observations on Bust', () => {
    let state = game('charge-bust');
    state.phase = 'shop'; state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    state.bonfires = ['momentum'];
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant(.2)).state;
    setValues(state, [1, 2, 2, 4, 5]);
    state.manualRerollsRemaining = 0; state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    const busted = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    expect(busted.state.phase).toBe('shop');
    expect(busted.state.chargeAttribution).toEqual({});
    expect(busted.state.bonfireRoundContributions.momentum?.observations).toEqual([]);
    expect(busted.state.bonfireContributions.momentum).toBeUndefined();
  });

  it('Time Travel restores charge-source Bonfire observations to the Chapter checkpoint', () => {
    const state = game('charge-time-travel');
    state.round = 25; state.presentedChapters = [1, 2, 3, 4, 5]; state.phase = 'specialOffer';
    state.specialOffer = { offers: [{ id: 1, type: 'timeTravel' }], acquired: true, chosen: { id: 1, type: 'timeTravel' } };
    state.hoodedFigure.active = {
      id: 'theLongWay', issuedChapter: 5, target: 3,
      committed: { value: 3, keys: [], invalid: false, jackpotPaid: false },
      attempt: { value: 3, keys: [], invalid: false, jackpotPaid: false }, complete: true, dialogueLine: 'audit',
    };
    state.hoodedFigure.contributionCheckpoint = { momentum: { roundCount: 2, factorSum: 3 } };
    state.bonfireContributions = { momentum: { roundCount: 5, factorSum: 12 }, powerSurge: { roundCount: 3, factorSum: 8 } };
    const rewound = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant(.2));
    expect(rewound.state.bonfireContributions).toEqual({ momentum: { roundCount: 2, factorSum: 3 } });
    expect(rewound.state.hoodedFigure.active?.complete).toBe(false);
  });
});

describe('exactly-five ordinary Bonfire interaction', () => {
  const setup = () => {
    const state = game('exactly-five');
    state.phase = 'hoodedFigure';
    state.bonfires = ['ultimate', 'minigun', 'hailMary', 'fullOfGrace', 'vineyard'];
    state.bonfireContributions = {
      ultimate: { roundCount: 1, factorSum: 1 }, minigun: { roundCount: 1, factorSum: 2 },
      hailMary: { roundCount: 1, factorSum: 3 }, fullOfGrace: { roundCount: 1, factorSum: 4 },
      vineyard: { roundCount: 1, factorSum: 5 },
    };
    state.hoodedFigure.interaction = { kind: 'return', stage: 'recipient', lines: [], lineIndex: 0,
      recipient: null, sacrifice: null };
    return state;
  };

  it('selects low three first, then recomputes the high three after excluding the recipient', () => {
    let state = setup();
    expect(rankedRecipients(state)).toEqual(['ultimate', 'minigun', 'hailMary']);
    state = dispatch(state, { type: 'SELECT_WILDFIRE_RECIPIENT', flame: 'ultimate' }, constant(.2)).state;
    expect(rankedSacrifices(state, 'ultimate')).toEqual(['vineyard', 'fullOfGrace', 'hailMary']);
    state = dispatch(state, { type: 'BACK_WILDFIRE' }, constant(.2)).state;
    state = dispatch(state, { type: 'SELECT_WILDFIRE_RECIPIENT', flame: 'hailMary' }, constant(.2)).state;
    expect(rankedSacrifices(state, 'hailMary')).toEqual(['vineyard', 'fullOfGrace', 'minigun']);
  });

  it('excludes Wildfires from both pools and breaks contribution ties deterministically', () => {
    const state = setup();
    state.bonfireContributions = {};
    state.wildfires = [{ flame: 'fatCat', sacrificedFlame: 'momentum', sacrificedAverage: 5,
      transferMultiplier: 6, resolved: { kind: 'xMult', baseMax: 5, max: 30 } }];
    const firstRecipients = rankedRecipients(state);
    expect(firstRecipients).toEqual(['fullOfGrace', 'hailMary', 'minigun']);
    expect(rankedRecipients(state)).toEqual(firstRecipients);
    expect(rankedSacrifices(state, 'fullOfGrace')).toEqual(['hailMary', 'minigun', 'ultimate']);
    expect([...rankedRecipients(state), ...rankedSacrifices(state, 'fullOfGrace')]).not.toContain('fatCat');
  });
});

describe('Wildfire preview and persistence parameters', () => {
  it('uses hidden A, T = 1 + 1.25(A - 1), and each recipient-specific conversion', () => {
    const state = game('preview-table');
    state.bonfireContributions.vineyard = { roundCount: 2, factorSum: 10 };
    expect(transferMultiplier(5)).toBe(6);
    const expectations: [Flame, ReturnType<typeof resolveWildfire>][] = [
      ['ultimate', { kind: 'xMult', baseMax: 5, max: 30 }],
      ['speedDemon', { kind: 'xMult', baseMax: 9, max: 54 }],
      ['lowball', { kind: 'xMult', baseMax: 5, max: 30 }],
      ['momentum', { kind: 'charge', gain: 3, maxCharge: 30 }],
      ['thirdRail', { kind: 'charge', gain: 3, maxCharge: 30 }],
      ['jumpStart', { kind: 'charge', gain: 12, maxCharge: 30 }],
      ['powerSurge', { kind: 'charge', ratio: 13, maxCharge: 30 }],
      ['fluxCapacitor', { kind: 'charge', coefficient: 6, maxCharge: 30 }],
    ];
    for (const [recipient, resolved] of expectations) {
      const preview = projectWildfire(state, recipient, 'vineyard');
      expect(preview).toMatchObject({ flame: recipient, sacrificedAverage: 5, transferMultiplier: 6, resolved });
      expect(projectWildfire(state, recipient, 'vineyard')).toEqual(preview);
    }
    const variable = projectWildfire(state, 'speedDemon', 'vineyard');
    expect(wildfireFactor(variable, 1)).toBe(1);
    expect(wildfireFactor(variable, 5)).toBe(27.5);
    expect(wildfireFactor(variable, 9)).toBe(54);
    const lowball = projectWildfire(state, 'lowball', 'vineyard');
    expect(wildfireFactor(lowball, 1)).toBe(1);
    expect(wildfireFactor(lowball, 5)).toBe(30);
    expect(wildfirePreview(projectWildfire(state, 'momentum', 'vineyard'))[1]).toContain('Played hand');
    expect(wildfirePreview(projectWildfire(state, 'thirdRail', 'vineyard'))[1]).toContain('Rolled 3');
    expect(wildfirePreview(projectWildfire(state, 'jumpStart', 'vineyard'))[1]).toContain('Manual Reroll');
  });

  it('fixes resolved parameters at confirmation and cannot convert twice', () => {
    const state = game('fixed-after-confirmation');
    state.phase = 'hoodedFigure';
    state.bonfires = ['ultimate', 'vineyard', 'minigun', 'hailMary', 'fullOfGrace'];
    state.bonfireContributions.vineyard = { roundCount: 2, factorSum: 10 };
    state.hoodedFigure.interaction = { kind: 'return', stage: 'confirm', lines: [], lineIndex: 0,
      recipient: 'ultimate', sacrifice: 'vineyard' };
    const converted = dispatch(state, { type: 'CONFIRM_WILDFIRE' }, constant(.2));
    expect(converted.error).toBeUndefined();
    expect(converted.state.wildfires[0]).toEqual({ flame: 'ultimate', sacrificedFlame: 'vineyard',
      sacrificedAverage: 5, transferMultiplier: 6, resolved: { kind: 'xMult', baseMax: 5, max: 30 } });
    converted.state.bonfireContributions.vineyard = { roundCount: 1, factorSum: 99 };
    expect(converted.state.wildfires[0].resolved).toEqual({ kind: 'xMult', baseMax: 5, max: 30 });
    expect(dispatch(converted.state, { type: 'CONFIRM_WILDFIRE' }, constant(.2)).error).toBeTruthy();
  });

  it('backtracking and walking away do not mutate Flame ownership or contribution state', () => {
    const state = game('walk-away-audit');
    state.phase = 'hoodedFigure';
    state.bonfires = ['ultimate', 'vineyard', 'minigun', 'hailMary', 'fullOfGrace'];
    state.bonfireContributions.vineyard = { roundCount: 2, factorSum: 10 };
    state.hoodedFigure.active = challenge('fiveAlive', 3);
    state.hoodedFigure.interaction = { kind: 'return', stage: 'sacrifice', lines: [], lineIndex: 0,
      recipient: 'ultimate', sacrifice: null };
    const ownership = structuredClone({ bonfires: state.bonfires, wildfires: state.wildfires,
      contributions: state.bonfireContributions });
    const backed = dispatch(state, { type: 'BACK_WILDFIRE' }, constant(.2));
    expect({ bonfires: backed.state.bonfires, wildfires: backed.state.wildfires,
      contributions: backed.state.bonfireContributions }).toEqual(ownership);
    const walked = dispatch(backed.state, { type: 'WALK_AWAY_WILDFIRE' }, constant(.2));
    expect({ bonfires: walked.state.bonfires, wildfires: walked.state.wildfires,
      contributions: walked.state.bonfireContributions }).toEqual(ownership);
    expect(walked.state.hoodedFigure.active).toBeNull();
  });
});

describe('challenge interaction timing', () => {
  it('marks success without interrupting the clearing hand or Round Summary', () => {
    const state = game('non-interrupting-success');
    state.hoodedFigure.active = challenge('lowProfile');
    state.target = 1; state.stats.rounds.at(-1)!.target = 1;
    setValues(state, [1, 2, 3, 4, 4]);
    const cleared = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.2));
    expect(cleared.state.hoodedFigure.active?.complete).toBe(true);
    expect(cleared.state.phase).toBe('roundSummary');
    expect(cleared.state.hoodedFigure.interaction).toBeNull();
  });

  it('opens no Hooded Figure interaction after a failed R3 challenge', () => {
    const state = game('silent-r3-failure');
    state.round = 27; state.phase = 'specialOffer';
    state.specialOffer = { offers: [{ id: 1, type: 'greatFairy' }], acquired: true,
      chosen: { id: 1, type: 'greatFairy' } };
    state.hoodedFigure.active = challenge('theLongWay', 3);
    const continued = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant(.2));
    expect(continued.state.phase).toBe('shop');
    expect(continued.state.hoodedFigure.interaction).toBeNull();
    expect(continued.state.hoodedFigure.active).toBeNull();
    expect(continued.events.some(event => event.type === 'HOODED_FIGURE_RETURNED')).toBe(false);
  });
});

describe('ordinary Bonfire identity audit', () => {
  it('does not treat a Wildfire as an ordinary contribution source', () => {
    const state = game('wildfire-not-ordinary');
    state.bonfires = ['minigun'];
    state.wildfires = [{ flame: 'ultimate', sacrificedFlame: 'vineyard', sacrificedAverage: 5,
      transferMultiplier: 6, resolved: { kind: 'xMult', baseMax: 5, max: 30 } }];
    state.bonfireRoundContributions = { minigun: { observations: [] } };
    setValues(state, [1, 2, 3, 4, 6]);
    playWithoutClearing(state, 'ones', [0]);
    expect(Object.keys(state.bonfireRoundContributions)).toEqual(['minigun']);
  });
});
