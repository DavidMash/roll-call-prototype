import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { HAND_IDS } from './hands';
import {
  beginChallengeRound, challengeRoundsRemaining, CHALLENGE_IDS, CHALLENGES, completeChallengeRound, createActiveChallenge,
  fullyLoadedEligible, observeManualHand, observeManualReroll, observeScoringEvent,
} from './hoodedFigure';
import { loadPersistedRun, savePersistedRun } from './persistence';
import { captureRollbackState } from './rollback';
import type { ActiveHoodedChallenge, ChallengeId, Enhancement, GameState, RandomSource, Rank } from './types';

const constant = (value: number): RandomSource => ({ next: () => value });
const fresh = (seed = 'hooded-rebalance') => newRun(seed, constant(.99)).state;

function challenge(state: GameState, id: ChallengeId, target = 99): ActiveHoodedChallenge {
  const active = createActiveChallenge({ ...CHALLENGES[id], target: () => target }, state, 5, 'rebalance');
  beginChallengeRound(active);
  state.hoodedFigure.active = active;
  return active;
}

function addFaces(state: GameState, enhancement: Enhancement, count: number, stacks = 1): void {
  for (let index = 0; index < count; index++)
    state.dice[Math.floor(index / 6)].faces[index % 6].enhancements[enhancement] = stacks;
}

function scoringState(id: ChallengeId, enhancement: Enhancement, stacks = 1): GameState {
  const state = fresh(`double-time-${id}`);
  state.target = 1_000_000n;
  state.stats.rounds[0].target = state.target;
  state.dice.forEach((die, index) => { die.value = ([4, 4, 4, 2, 6] as Rank[])[index]; });
  activeFace(state.dice[0]).enhancements[enhancement] = stacks;
  activeFace(state.dice[0]).enhancements.doubleTime = 1;
  challenge(state, id);
  return state;
}

describe('final Hooded challenge library', () => {
  it('defines all 19 final scopes and issuance targets', () => {
    const state = fresh('all-final-targets');
    addFaces(state, 'jumpingBean', 1);
    addFaces(state, 'bonus', 3);
    addFaces(state, 'golden', 3);
    state.dice[0].faces[3].enhancements.vintage = 1;
    state.dice[0].faces[4].enhancements.magnetic = 1;
    state.dice[1].faces[4].enhancements.magnetic = 1;
    state.dice[0].faces[5].enhancements.workout = 3;
    const expected: Record<ChallengeId, { target: number; scope: 'chapter' | 'round' }> = {
      fiveAlive: { target: 3, scope: 'chapter' },
      theLongWay: { target: 4, scope: 'chapter' },
      upperClass: { target: 6, scope: 'round' },
      lowerClass: { target: 8, scope: 'chapter' },
      varietyPack: { target: 5, scope: 'round' },
      closeCall: { target: 1, scope: 'round' },
      noTakebacks: { target: 2, scope: 'chapter' },
      upperManagement: { target: 3, scope: 'round' },
      rollCall: { target: 6, scope: 'round' },
      lowProfile: { target: 1, scope: 'round' },
      oppositesAttract: { target: 6, scope: 'chapter' },
      beanSalad: { target: 10, scope: 'chapter' },
      bonusRound: { target: 5, scope: 'round' },
      goldRush: { target: 5, scope: 'round' },
      agedToPerfection: { target: 6, scope: 'chapter' },
      magneticPersonality: { target: 10, scope: 'chapter' },
      jackpot: { target: 2, scope: 'chapter' },
      getYourRepsIn: { target: 15, scope: 'chapter' },
      fullyLoaded: { target: 3, scope: 'chapter' },
    };
    expect(CHALLENGE_IDS).toHaveLength(19);
    for (const id of CHALLENGE_IDS) expect({ target: CHALLENGES[id].target(state), scope: CHALLENGES[id].scope })
      .toEqual(expected[id]);
  });

  it.each([
    ['bonusRound', 'bonus'], ['goldRush', 'golden'],
  ] as const)('rounds %s targets upward from 1.5 times physical faces', (id, enhancement) => {
    for (const [faces, target] of [[3, 5], [4, 6], [5, 8], [6, 9]] as const) {
      const state = fresh(`${id}-${faces}`);
      addFaces(state, enhancement, faces, 3);
      expect(CHALLENGES[id].target(state)).toBe(target);
    }
  });

  it('locks every dynamic target against later purchases and sales, including save/load', () => {
    const state = fresh('locked-targets');
    addFaces(state, 'jumpingBean', 1);
    addFaces(state, 'bonus', 3);
    addFaces(state, 'golden', 3);
    addFaces(state, 'vintage', 1);
    state.dice[0].faces[4].enhancements.magnetic = 1;
    state.dice[1].faces[4].enhancements.magnetic = 1;
    state.dice[0].faces[5].enhancements.workout = 3;
    const ids = ['beanSalad', 'bonusRound', 'goldRush', 'agedToPerfection', 'magneticPersonality', 'getYourRepsIn'] as const;
    const locked = Object.fromEntries(ids.map(id => [id, createActiveChallenge(CHALLENGES[id], state, 5, 'locked')])) as
      Record<(typeof ids)[number], ActiveHoodedChallenge>;
    for (const die of state.dice) for (const face of die.faces) face.enhancements = {};
    addFaces(state, 'jumpingBean', 4); addFaces(state, 'bonus', 5); addFaces(state, 'golden', 5);
    addFaces(state, 'vintage', 4); addFaces(state, 'magnetic', 6); addFaces(state, 'workout', 1, 8);
    expect(Object.fromEntries(ids.map(id => [id, locked[id].target]))).toEqual({
      beanSalad: 10, bonusRound: 5, goldRush: 5, agedToPerfection: 6, magneticPersonality: 10, getYourRepsIn: 15,
    });

    state.hoodedFigure.active = locked.magneticPersonality;
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(savePersistedRun(storage, state)).toBe(true);
    expect(loadPersistedRun(storage, state.seed)?.hoodedFigure.active?.target).toBe(10);
  });

  it('reports the Chapter-relative R1-R6 deadline', () => {
    const state = fresh('challenge-rounds-remaining');
    expect([25, 26, 27, 28, 29, 30].map(round => {
      state.round = round;
      return challengeRoundsRemaining(state);
    })).toEqual([6, 5, 4, 3, 2, 1]);
  });
});

describe('Magnetic and Fully Loaded eligibility', () => {
  it('requires 2 Magnetic faces and locks the 10/15/20/25 capped target curve', () => {
    for (const [faces, eligible, target] of [[0, false, 0], [1, false, 5], [2, true, 10], [3, true, 15],
      [4, true, 20], [5, true, 25], [6, true, 25]] as const) {
      const state = fresh(`magnetic-${faces}`);
      for (let index = 0; index < faces; index++)
        state.dice[index % 2].faces[Math.floor(index / 2)].enhancements.magnetic = 1;
      expect(CHALLENGES.magneticPersonality.eligible(state, 'juggler')).toBe(eligible);
      expect(CHALLENGES.magneticPersonality.target(state)).toBe(target);
    }
  });

  it('retains the Bump feasibility safeguard for Magnetic attraction', () => {
    const state = fresh('magnetic-bump-feasibility');
    state.dice[0].faces[0].enhancements.magnetic = 1;
    state.dice[1].faces[0].enhancements.magnetic = 1;
    for (const die of [state.dice[0], state.dice[1]]) for (const face of die.faces) face.enhancements.bump = 1;
    expect(CHALLENGES.magneticPersonality.eligible(state, 'juggler')).toBe(false);
    delete state.dice[1].faces[5].enhancements.bump;
    expect(CHALLENGES.magneticPersonality.eligible(state, 'juggler')).toBe(true);
  });

  it('requires a legal co-scoring arrangement and ignores Infected-disabled types', () => {
    const illegal = fresh('fully-loaded-illegal');
    illegal.dice[0].faces[0].enhancements.bonus = 1;
    illegal.dice[1].faces[1].enhancements.golden = 1;
    illegal.dice[2].faces[5].enhancements.vintage = 1;
    expect(fullyLoadedEligible(illegal)).toBe(false);

    const legal = fresh('fully-loaded-legal');
    legal.dice[0].faces[0].enhancements.bonus = 1;
    legal.dice[1].faces[1].enhancements.golden = 1;
    legal.dice[2].faces[2].enhancements.vintage = 1;
    expect(fullyLoadedEligible(legal)).toBe(true);
    legal.dice[2].faces[2].infected = true;
    expect(fullyLoadedEligible(legal)).toBe(false);

    const stacked = fresh('fully-loaded-one-face');
    Object.assign(stacked.dice[0].faces[0].enhancements, { bonus: 1, golden: 1, vintage: 1 });
    expect(fullyLoadedEligible(stacked)).toBe(true);

    const progress = challenge(legal, 'fullyLoaded', 3);
    observeScoringEvent(progress, [{ printed: 1, enhancements: { bonus: 1, golden: 1, vintage: 1 },
      enhancementsActive: false }], 'manual');
    expect(progress.attempt.value).toBe(0);
  });
});

describe('rebalanced completion conditions', () => {
  it('completes No Takebacks only after two distinct cleared Rounds and resets Round invalidity', () => {
    const state = fresh('two-no-takebacks');
    const active = challenge(state, 'noTakebacks', 2);
    expect(completeChallengeRound(active, 100n, 100n)).toBe(false);
    expect(active.committed.value).toBe(1);
    beginChallengeRound(active);
    expect(completeChallengeRound(active, 100n, 100n)).toBe(true);

    const invalid = challenge(state, 'noTakebacks', 2);
    observeManualReroll(invalid);
    expect(completeChallengeRound(invalid, 100n, 100n)).toBe(false);
    beginChallengeRound(invalid);
    expect(invalid.attempt.invalid).toBe(false);
    expect(completeChallengeRound(invalid, 100n, 100n)).toBe(false);
    expect(invalid.committed.value).toBe(1);
  });

  it('counts Care Package rerolls as manual but not automatic post-hand rerolls', () => {
    let state = fresh('care-package-no-takebacks');
    challenge(state, 'noTakebacks', 2);
    state.manualRerollsRemaining = 0;
    state.specialOfferEffects.carePackageRerolls = 1;
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(.2)).state;
    expect(state.hoodedFigure.active?.attempt.invalid).toBe(true);

    state = fresh('automatic-no-takebacks');
    challenge(state, 'noTakebacks', 2);
    state.target = 1_000_000n; state.stats.rounds[0].target = state.target;
    state.dice.forEach((die, index) => { die.value = ([1, 2, 3, 4, 6] as Rank[])[index]; });
    state = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.2)).state;
    expect(state.hoodedFigure.active?.attempt.invalid).toBe(false);
  });

  it('requires three distinct manual Upper hands and rejects any manual Lower hand', () => {
    const state = fresh('upper-management-three');
    const active = challenge(state, 'upperManagement', 3);
    observeManualHand(active, 'ones'); observeManualHand(active, 'ones'); observeManualHand(active, 'twos');
    expect(completeChallengeRound(active, 100n, 100n)).toBe(false);
    beginChallengeRound(active);
    observeManualHand(active, 'ones'); observeManualHand(active, 'twos'); observeManualHand(active, 'threes');
    expect(completeChallengeRound(active, 100n, 100n)).toBe(true);

    const spoiled = challenge(state, 'upperManagement', 3);
    observeManualHand(spoiled, 'ones'); observeManualHand(spoiled, 'twos'); observeManualHand(spoiled, 'threes');
    observeManualHand(spoiled, 'pair');
    expect(completeChallengeRound(spoiled, 100n, 100n)).toBe(false);
  });
});

describe('real Enhancement activation observation', () => {
  it.each([
    ['bonusRound', 'bonus', 1, 2],
    ['goldRush', 'golden', 1, 2],
    ['agedToPerfection', 'vintage', 1, 2],
    ['getYourRepsIn', 'workout', 3, 6],
  ] as const)('counts successful Double Time replays for %s from actual effect execution', (id, enhancement, stacks, expected) => {
    const state = scoringState(id, enhancement, stacks);
    const result = dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant(0));
    expect(result.state.hoodedFigure.active?.attempt.value).toBe(expected);
    expect(result.state.stats.probabilityProcs.doubleTime).toMatchObject({ checks: 1, successes: 1, failures: 0 });
  });

  it.each([
    ['bonusRound', 'bonus', 1, 1],
    ['goldRush', 'golden', 1, 1],
    ['agedToPerfection', 'vintage', 1, 1],
    ['getYourRepsIn', 'workout', 3, 3],
  ] as const)('adds only the original %s activation when Double Time fails', (id, enhancement, stacks, expected) => {
    const state = scoringState(id, enhancement, stacks);
    const result = dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant(.99));
    expect(result.state.hoodedFigure.active?.attempt.value).toBe(expected);
    expect(result.state.stats.probabilityProcs.doubleTime).toMatchObject({ checks: 1, successes: 0, failures: 1 });
  });

  it('does not count disabled effects or fabricate a second unrelated scoring event', () => {
    const disabled = scoringState('getYourRepsIn', 'workout', 3);
    activeFace(disabled.dice[0]).infected = true;
    expect(dispatch(disabled, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant(0))
      .state.hoodedFigure.active?.attempt.value).toBe(0);

    const opposites = fresh('double-time-unrelated');
    opposites.target = 1_000_000n; opposites.stats.rounds[0].target = opposites.target;
    opposites.dice.forEach((die, index) => { die.value = ([1, 2, 3, 4, 6] as Rank[])[index]; });
    activeFace(opposites.dice[0]).enhancements.doubleTime = 1;
    activeFace(opposites.dice[4]).enhancements.hitchhiker = 3;
    challenge(opposites, 'oppositesAttract', 6);
    const result = dispatch(opposites, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    expect(result.state.hoodedFigure.active?.attempt.value).toBe(1);
    expect(result.state.handPlayCounts.ones).toBe(1);
  });

  it('uses genuine one-die Jumping Bean and successful Hitchhiker runtime participants', () => {
    const bean = fresh('real-jumping-bean');
    bean.target = 1_000_000n; bean.stats.rounds[0].target = bean.target;
    bean.dice[0].faces[0].enhancements.jumpingBean = 1;
    bean.dice[0].faces[0].enhancements.sticky = 3;
    challenge(bean, 'beanSalad', 10);
    const beanResolver = new Resolver(bean, constant(0));
    beanResolver.rollBatch([0], 'test Jumping Bean roll', 'gameplay');
    beanResolver.drain();
    expect(bean.hoodedFigure.active?.attempt.value).toBe(1);
    expect(bean.stats.jumpingBeanFreePlays).toHaveLength(1);
    expect(bean.stats.jumpingBeanFreePlays[0].dieId).toBe(0);

    const hitchhiker = fresh('real-hitchhiker');
    hitchhiker.target = 1_000_000n; hitchhiker.stats.rounds[0].target = hitchhiker.target;
    hitchhiker.dice.forEach((die, index) => { die.value = ([1, 2, 3, 4, 6] as Rank[])[index]; });
    activeFace(hitchhiker.dice[4]).enhancements.hitchhiker = 3;
    challenge(hitchhiker, 'oppositesAttract', 6);
    const result = dispatch(hitchhiker, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    expect(result.state.hoodedFigure.active?.attempt.value).toBe(1);
    expect(result.state.stats.hitchhikerPipsContributed).toBeGreaterThan(0);
  });
});

describe('rollback observability', () => {
  it('records committed challenge progress on a successful non-completing clear', () => {
    const state = fresh('committed-progress-history');
    state.target = 1n; state.stats.rounds[0].target = 1n;
    state.dice.forEach((die, index) => { die.value = ([1, 2, 3, 4, 6] as Rank[])[index]; });
    challenge(state, 'noTakebacks', 2);
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.99));
    expect(result.state.historyV2.find(event => event.kind === 'hooded_challenge_changed'
      && event.change === 'progress_committed')).toMatchObject({
      challengeId: 'noTakebacks', target: 2, attemptProgress: 1, committedProgress: 1, invalid: false, complete: false,
    });
  });

  it('emits an invalid-only Bust rollback even when numeric progress remains zero', () => {
    const state = fresh('invalid-only-rollback');
    const active = challenge(state, 'noTakebacks', 2);
    state.roundCheckpoint = captureRollbackState(state);
    active.attempt.invalid = true;
    state.target = 1_000_000n; state.stats.rounds[0].target = state.target;
    state.manualRerollsRemaining = 0;
    state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    state.dice.forEach((die, index) => { die.value = ([1, 2, 2, 4, 5] as Rank[])[index]; });
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.99));
    const legacy = result.events.find(event => event.type === 'HOODED_CHALLENGE_ROLLED_BACK');
    expect(legacy?.challengeRollback).toMatchObject({ attemptProgressBefore: 0, attemptProgressAfter: 0,
      invalidBefore: true, invalidAfter: false });
    const history = result.state.historyV2.find(event => event.kind === 'hooded_challenge_changed'
      && event.change === 'rolled_back');
    expect(history).toMatchObject({ attemptProgress: 0, committedProgress: 0, invalid: false,
      rollback: { attemptProgressBefore: 0, attemptProgressAfter: 0, invalidBefore: true, invalidAfter: false } });
  });
});
