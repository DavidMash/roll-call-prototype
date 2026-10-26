import { describe, expect, it } from 'vitest';
import { Resolver } from './effects';
import { dispatch, newRun, validateAction } from './engine';
import { allInMultiplier, doubleOrNothingMultiplier, FLAME_IDS, placeFlameInstance } from './flames';
import { HAND_IDS } from './hands';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { compactGameStateForPersistence, RUN_STORAGE_VERSION } from './persistence';
import { createDieEffect, effectOf, effectRuntime, resetDieRoundState } from './specialDice';
import type { Flame, GameState, RandomSource, Rank, SpecialDieType } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });

function game(values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const state = newRun('flame-update-pass-3b', constant(.8)).state;
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
  values.forEach((value, index) => { state.diceInventory.instances[index].value = value; });
  syncActiveDiceProjection(state);
  return state;
}

function own(state: GameState, flame: Flame, investment = 100): void {
  placeFlameInstance(state, flame, investment);
}

function effects(state: GameState, dieIndex: number, values: Array<[SpecialDieType, number]>): void {
  const die = rosterDice(state)[dieIndex];
  die.effects = values.map(([type, level]) => createDieEffect(die.id, type, level));
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
}

function setFace(state: GameState, dieIndex: number, value: Exclude<Rank, 7>): number {
  const die = rosterDice(state)[dieIndex];
  die.value = value;
  syncActiveDiceProjection(state);
  return die.id;
}

function lastPackage(state: GameState) {
  return state.scoreWagers.packages.at(-1)!;
}

function factor(state: GameState, flame: Flame): number | undefined {
  return state.stats.handScores.at(-1)?.xMultFactors.find(item => item.source === flame)?.value;
}

describe('Flame Update Pass 3B catalog and scaling', () => {
  it('adds exactly Double or Nothing and All In, without later wager Flames', () => {
    expect(FLAME_IDS).toEqual(expect.arrayContaining(['doubleOrNothing', 'allIn']));
    expect(doubleOrNothingMultiplier(100)).toBe(9);
    expect(allInMultiplier(100)).toBe(12);
  });
});

describe('canonical score packages', () => {
  it('creates one stable root package per Play and records actual canonical Score additions', () => {
    const state = game();
    const resolver = new Resolver(state, constant());
    resolver.play('ones', [0]);
    const first = lastPackage(state);
    expect(first).toMatchObject({ initiatingHand: 'ones', initiatingSource: 'manual', complete: true,
      allIn: false, doubleOrNothingRedemption: false });
    expect(first.plays).toEqual([{ playId: first.rootPlayId, parentPlayId: null, hand: 'ones', source: 'manual' }]);
    expect(first.score).toBe(state.score);
    expect(first.score).toBe(first.contributions.reduce((sum, contribution) => sum + contribution.amount, 0n));
    const handEvent = state.historyV2.find(event => event.kind === 'hand_scored');
    expect(handEvent).toMatchObject({ kind: 'hand_scored', scorePackageId: first.id,
      rootPlayId: first.rootPlayId, parentPlayId: null });

    const id = setFace(state, 1, 2);
    resolver.play('twos', [id]);
    expect(state.scoreWagers.packages).toHaveLength(2);
    expect(lastPackage(state).id).not.toBe(first.id);
  });

  it('keeps every Double Time Score occurrence in the root package', () => {
    const state = game();
    effects(state, 0, [['doubleTime', 8]]);
    new Resolver(state, constant(.99)).play('ones', [0]);
    const score = state.stats.handScores.at(-1)!;
    expect(score.score).toBe(lastPackage(state).score);
    const hand = state.historyV2.find(event => event.kind === 'hand_scored');
    expect(hand?.kind === 'hand_scored' ? hand.scoreOccurrences.length : 0).toBeGreaterThan(1);
  });

  it('keeps Jumping Bean Free Plays and chained descendants under their initiating manual Play', () => {
    const state = game([1, 1, 1, 1, 1]);
    effects(state, 0, [['jumpingBean', 1]]);
    const die = rosterDice(state)[0];
    die.faces.forEach(face => { face.rank = 1; });
    die.effects[0].persistent.jumpingBeanNumber = 1;
    syncActiveDiceProjection(state);
    new Resolver(state, constant()).play('pair', [die.id, 1]);
    const scorePackage = lastPackage(state);
    expect(scorePackage.plays[0]).toMatchObject({ parentPlayId: null, source: 'manual' });
    expect(scorePackage.plays.filter(play => play.source === 'jumpingBean')).toHaveLength(3);
    expect(scorePackage.plays.slice(1).every(play => play.parentPlayId !== null)).toBe(true);
    expect(scorePackage.score).toBe(scorePackage.contributions.reduce((sum, item) => sum + item.amount, 0n));
  });

  it('gives a Curtain Call Free Play explicit package lineage without treating it as a manual wager offer', () => {
    const state = game([5, 2, 3, 4, 6]);
    effects(state, 0, [['freePlay', 2]]);
    own(state, 'doubleOrNothing');
    new Resolver(state, constant()).manualReroll([0]);
    const scorePackage = state.scoreWagers.packages.find(item => item.initiatingSource === 'freePlay');
    expect(scorePackage).toMatchObject({ initiatingHand: 'fives', complete: true });
    expect(scorePackage?.plays[0]).toMatchObject({ parentPlayId: null, source: 'freePlay' });
    expect(state.scoreWagers.pendingDoubleOrNothing).toBeNull();
  });
});

describe('Double or Nothing', () => {
  it('offers only after the full manual package resolves, then removes it and reopens only the initiating Hand', () => {
    const state = game([1, 1, 1, 1, 1]);
    own(state, 'doubleOrNothing');
    effects(state, 0, [['jumpingBean', 1]]);
    const bean = rosterDice(state)[0];
    bean.faces.forEach(face => { face.rank = 1; });
    bean.effects[0].persistent.jumpingBeanNumber = 1;
    syncActiveDiceProjection(state);
    const gold = state.gold;
    new Resolver(state, constant()).play('pair', [bean.id, 1]);
    const scorePackage = lastPackage(state);
    expect(scorePackage.plays.length).toBe(4);
    expect(state.scoreWagers.pendingDoubleOrNothing).toMatchObject({ packageId: scorePackage.id,
      hand: 'pair', packageScore: scorePackage.score, factor: 9 });
    const scoreAfter = state.score;
    new Resolver(state, constant()).acceptDoubleOrNothing();
    expect(state.score).toBe(scoreAfter - scorePackage.score);
    expect(state.consumed).not.toContain('pair');
    expect(state.scoreWagers.doubleOrNothing).toMatchObject({ hand: 'pair', acceptedPackageId: scorePackage.id, factor: 9 });
    expect(state.gold).toBe(gold);
    expect(state.handPlayCounts.ones).toBe(3);
    expect(state.handPlayCounts.pair).toBe(1);
    expect(scorePackage.removedScore).toBe(scorePackage.score);
  });

  it('expires or is ignored without changing Score and suppresses overlapping offers', () => {
    for (const reason of ['expired', 'ignored'] as const) {
      const state = game(); own(state, 'doubleOrNothing');
      new Resolver(state, constant()).play('ones', [0]);
      const score = state.score;
      new Resolver(state, constant()).declineDoubleOrNothing(reason);
      expect(state.score).toBe(score);
      expect(state.scoreWagers.pendingDoubleOrNothing).toBeNull();
      expect(state.historyV2).toContainEqual(expect.objectContaining({ kind: 'double_or_nothing', phase: reason }));
    }

    const active = game(); own(active, 'doubleOrNothing');
    new Resolver(active, constant()).play('ones', [0]);
    new Resolver(active, constant()).acceptDoubleOrNothing();
    setFace(active, 1, 2);
    new Resolver(active, constant()).play('twos', [1]);
    expect(active.scoreWagers.pendingDoubleOrNothing).toBeNull();
    expect(active.scoreWagers.doubleOrNothing?.hand).toBe('ones');
  });

  it('redeems only on a manual replay, applies ×9, and permits a later offer after redemption', () => {
    const state = game(); own(state, 'doubleOrNothing');
    new Resolver(state, constant()).play('ones', [0]);
    new Resolver(state, constant()).acceptDoubleOrNothing();
    setFace(state, 0, 1);
    new Resolver(state, constant()).play('ones', [0], 'freePlay');
    expect(state.scoreWagers.doubleOrNothing?.hand).toBe('ones');
    setFace(state, 0, 1);
    new Resolver(state, constant()).play('ones', [0]);
    expect(factor(state, 'doubleOrNothing')).toBe(9);
    expect(state.scoreWagers.doubleOrNothing).toBeNull();
    expect(state.scoreWagers.pendingDoubleOrNothing).toBeNull();

    setFace(state, 1, 2);
    new Resolver(state, constant()).play('twos', [1]);
    expect(state.scoreWagers.pendingDoubleOrNothing?.hand).toBe('twos');
  });

  it('preserves accepted wagers across persistence and removes ephemeral timed offers', () => {
    const state = game(); own(state, 'doubleOrNothing');
    new Resolver(state, constant()).play('ones', [0]);
    const pending = compactGameStateForPersistence(state);
    expect(pending.scoreWagers.pendingDoubleOrNothing).toBeNull();
    new Resolver(state, constant()).acceptDoubleOrNothing();
    own(state, 'allIn');
    new Resolver(state, constant()).armAllIn();
    const accepted = compactGameStateForPersistence(state);
    expect(accepted.scoreWagers.doubleOrNothing).toEqual(state.scoreWagers.doubleOrNothing);
    expect(accepted.scoreWagers.allInArmed).toBe(true);
    expect(RUN_STORAGE_VERSION).toBeGreaterThanOrEqual(25);
  });

  it('preserves an active wager through refresh, Marathon cooldown, and temporary unavailability', () => {
    const refresh = game(); own(refresh, 'doubleOrNothing');
    new Resolver(refresh, constant()).play('ones', [0]);
    new Resolver(refresh, constant()).acceptDoubleOrNothing();
    refresh.consumed = HAND_IDS.filter(hand => hand !== 'twos');
    refresh.scorecardCycleConsumed = HAND_IDS.filter(hand => hand !== 'twos');
    setFace(refresh, 1, 2);
    new Resolver(refresh, constant()).play('twos', [1]);
    expect(refresh.historyV2.some(event => event.kind === 'scorecard_refreshed')).toBe(true);
    expect(refresh.scoreWagers.doubleOrNothing?.hand).toBe('ones');

    const marathon = game(); own(marathon, 'doubleOrNothing');
    new Resolver(marathon, constant()).play('ones', [0]);
    new Resolver(marathon, constant()).acceptDoubleOrNothing();
    marathon.boss = { type: 'marathon', cooldowns: { ones: 2 } };
    setFace(marathon, 1, 2);
    new Resolver(marathon, constant()).play('twos', [1]);
    expect(marathon.scoreWagers.doubleOrNothing?.hand).toBe('ones');
    marathon.consumed.push('ones');
    expect(marathon.scoreWagers.doubleOrNothing?.hand).toBe('ones');
  });

  it('clears pending and active wager state at a new attempt', () => {
    const state = game(); own(state, 'doubleOrNothing'); own(state, 'allIn');
    new Resolver(state, constant()).play('ones', [0]);
    new Resolver(state, constant()).acceptDoubleOrNothing();
    new Resolver(state, constant()).armAllIn();
    state.phase = 'shop';
    state.shop = { stage: 'shop', offers: [], offerRerolls: 0, lifeRestores: 0 };
    new Resolver(state, constant()).startRound(true);
    expect(state.scoreWagers).toMatchObject({ nextPackageId: 1, packages: [],
      pendingDoubleOrNothing: null, doubleOrNothing: null, allInArmed: false });
  });
});

describe('All In', () => {
  it('arms through the shared action path, ignores Free Plays, and gives the next manual Play ×12', () => {
    let state = game(); own(state, 'allIn');
    expect(validateAction(state, { type: 'ARM_ALL_IN' })).toBeNull();
    state = dispatch(state, { type: 'ARM_ALL_IN' }, constant()).state;
    expect(state.scoreWagers.allInArmed).toBe(true);
    new Resolver(state, constant()).play('ones', [0], 'freePlay');
    expect(state.scoreWagers.allInArmed).toBe(true);
    setFace(state, 1, 2);
    new Resolver(state, constant()).play('twos', [1]);
    expect(factor(state, 'allIn')).toBe(12);
    expect(state.scoreWagers.allInArmed).toBe(false);
  });

  it('keeps a successful full package and removes a failed package without reopening or rewinding other state', () => {
    const success = game(); own(success, 'allIn'); success.target = 1n; success.stats.rounds.at(-1)!.target = 1n;
    new Resolver(success, constant()).armAllIn();
    new Resolver(success, constant()).play('ones', [0]);
    expect(success.phase).toBe('roundSummary');
    expect(success.score).toBeGreaterThanOrEqual(1n);
    expect(lastPackage(success).removedScore).toBe(0n);

    const failure = game(); own(failure, 'allIn'); effects(failure, 0, [['golden', 1], ['workout', 1]]);
    failure.score = 400n; failure.stats.rounds.at(-1)!.finalScore = 400n;
    failure.gold = 37; failure.chargeXMult = 2;
    const dieFace = failure.dice[0].value;
    new Resolver(failure, constant()).armAllIn();
    new Resolver(failure, constant(.3)).play('ones', [0]);
    const scorePackage = lastPackage(failure);
    expect(stateScore(failure)).toBe(400n);
    expect(scorePackage.removedScore).toBe(scorePackage.score);
    expect(failure.consumed).toContain('ones');
    expect(failure.gold).toBe(38);
    expect(failure.chargeXMult).toBe(1);
    expect(rosterDice(failure)[0].value).not.toBe(dieFace);
    const workout = effectOf(rosterDice(failure)[0], 'workout')!;
    expect(effectRuntime(failure.dieRoundState[0], workout)?.temporaryPips).toBeGreaterThan(0);
  });

  it('removes Double Time and descendant Free Play Score as one failed package', () => {
    const state = game([1, 1, 1, 1, 1]); own(state, 'allIn');
    effects(state, 0, [['doubleTime', 8], ['jumpingBean', 1]]);
    const die = rosterDice(state)[0];
    die.faces.forEach(face => { face.rank = 1; });
    die.effects.find(effect => effect.type === 'jumpingBean')!.persistent.jumpingBeanNumber = 1;
    syncActiveDiceProjection(state);
    new Resolver(state, constant()).armAllIn();
    new Resolver(state, constant()).play('pair', [die.id, 1]);
    const scorePackage = lastPackage(state);
    expect(scorePackage.plays.some(play => play.source === 'jumpingBean')).toBe(true);
    expect(state.historyV2.some(event => event.kind === 'hand_scored'
      && event.scoreOccurrences.length > 1)).toBe(true);
    expect(scorePackage.removedScore).toBe(scorePackage.score);
    expect(state.score).toBe(0n);
  });
});

describe('Double or Nothing and All In interaction', () => {
  it('does not offer Double or Nothing after either an All In success or failure', () => {
    for (const target of [1n, 1_000_000n]) {
      const state = game(); own(state, 'doubleOrNothing'); own(state, 'allIn');
      state.target = target; state.stats.rounds.at(-1)!.target = target;
      new Resolver(state, constant()).armAllIn();
      new Resolver(state, constant()).play('ones', [0]);
      expect(state.scoreWagers.pendingDoubleOrNothing).toBeNull();
    }
  });

  it('stacks both factors on redemption, consumes the wager, and never removes the failed package twice', () => {
    const state = game(); own(state, 'doubleOrNothing'); own(state, 'allIn');
    state.score = 100n;
    new Resolver(state, constant()).play('ones', [0]);
    new Resolver(state, constant()).acceptDoubleOrNothing();
    const priorScore = state.score;
    new Resolver(state, constant()).armAllIn();
    setFace(state, 0, 1);
    new Resolver(state, constant()).play('ones', [0]);
    const score = state.stats.handScores.at(-1)!;
    expect(score.xMultFactors).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'doubleOrNothing', value: 9 }),
      expect.objectContaining({ source: 'allIn', value: 12 }),
    ]));
    expect(state.score).toBe(priorScore);
    expect(lastPackage(state).removedScore).toBe(lastPackage(state).score);
    expect(state.scoreWagers.doubleOrNothing).toBeNull();
    expect(state.scoreWagers.pendingDoubleOrNothing).toBeNull();
  });
});

function stateScore(state: GameState): bigint {
  return state.score;
}
