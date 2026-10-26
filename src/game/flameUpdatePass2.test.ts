import { describe, expect, it } from 'vitest';
import { scorecardCycleRelevantHands } from './bosses';
import { activeFace } from './dice';
import { Resolver } from './effects';
import { dispatch, newRun } from './engine';
import {
  allHandsOnDeckChargeGain, benchWarmerMultiplier, blackHoleMultiplier, buildCanProduceFreePlays,
  casualMultiplier, cleanSweepMultiplier, eligibleFlameIds, epinephrineMultiplier,
  freeRealEstateMultiplier, frankensteinMultiplier, gymBrosMultiplier,
  heavyHittersMultiplier, highRollerPlayedDiceCounts, highRollerMultiplier, placeFlameInstance,
  potentialEnergyChargeGain, punchCardMultiplier, recalculateMaxCharge, assemblyLineMultiplier, FLAME_IDS,
  captureHandStart,
} from './flames';
import { benchWarmerHand, HAND_IDS, initialHandLevels } from './hands';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { createDieEffect, effectOf, effectRuntime, resetDieRoundState } from './specialDice';
import type { Flame, GameState, RandomSource, Rank, SpecialDieType } from './types';

const constant = (value = .8): RandomSource => ({ next: () => value });
const PASS_2_FLAMES = ['potentialEnergy', 'allHandsOnDeck', 'casual', 'freeRealEstate', 'heavyHitters',
  'frankenstein', 'highRoller', 'cleanSweep', 'benchWarmer', 'epinephrine', 'punchCard', 'blackHole',
  'assemblyLine', 'gymBros'] as const;

function game(values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const state = newRun('flame-update-pass-2', constant()).state;
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
  values.forEach((value, index) => { state.dice[index].value = value; });
  return state;
}

function own(state: GameState, flame: Flame, investment = 100): void {
  placeFlameInstance(state, flame, investment);
  recalculateMaxCharge(state);
}

function effects(state: GameState, dieIndex: number, values: Array<[SpecialDieType, number]>): void {
  const die = rosterDice(state)[dieIndex];
  die.effects = values.map(([type, level]) => createDieEffect(die.id, type, level));
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
}

function flameFactor(state: GameState, flame: Flame): number | undefined {
  return state.stats.handScores.at(-1)?.xMultFactors.find(factor => factor.source === flame)?.value;
}

function startFromShop(state: GameState): void {
  state.phase = 'shop';
  state.shop ??= { stage: 'shop', offers: [], offerRerolls: 0, lifeRestores: 0, diePurchased: false };
  new Resolver(state, constant()).startRound();
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
}

describe('Pass 2 Charge Flames', () => {
  it('adds exactly the fourteen requested Pass 2 Flames', () => {
    expect(FLAME_IDS.filter(flame => (PASS_2_FLAMES as readonly string[]).includes(flame))).toEqual(PASS_2_FLAMES);
  });
  it('Potential Energy uses canonical Ultimate playability and manual alternative Plays only', () => {
    expect(potentialEnergyChargeGain(100)).toBe(1);
    const qualifying = game([5, 5, 5, 5, 5]);
    own(qualifying, 'potentialEnergy');
    const result = dispatch(qualifying, { type: 'PLAY', hand: 'fives', dieIds: [0] }, constant()).state;
    expect(result.chargeXMult).toBe(2);
    expect(result.historyV2).toContainEqual(expect.objectContaining({ kind: 'flame_changed',
      change: expect.objectContaining({ type: 'activated', flame: 'potentialEnergy',
        diagnostics: expect.objectContaining({ ultimateHand: 'fiveKind', alternativeHand: 'fives', chargeGained: 1 }) }) }));

    const ultimate = game([5, 5, 5, 5, 5]);
    own(ultimate, 'potentialEnergy');
    new Resolver(ultimate, constant()).play('fiveKind', [0, 1, 2, 3, 4]);
    expect(ultimate.chargeXMult).toBe(1);

    const unavailable = game([1, 2, 3, 4, 5]);
    own(unavailable, 'potentialEnergy');
    new Resolver(unavailable, constant()).play('ones', [0]);
    expect(unavailable.chargeXMult).toBe(1);

    const free = game([5, 5, 5, 5, 5]);
    own(free, 'potentialEnergy');
    new Resolver(free, constant()).play('fives', [0], 'jumpingBean');
    expect(free.chargeXMult).toBe(1);

    const consumed = game([5, 5, 5, 5, 5]);
    own(consumed, 'potentialEnergy');
    consumed.consumed.push('fiveKind');
    new Resolver(consumed, constant()).play('fives', [0]);
    expect(consumed.chargeXMult).toBe(1);

    const refreshed = game([1, 2, 3, 4, 5]);
    own(refreshed, 'potentialEnergy');
    const relevant = scorecardCycleRelevantHands(refreshed);
    refreshed.consumed = relevant.filter(hand => hand !== 'ones');
    refreshed.scorecardCycleConsumed = [...refreshed.consumed];
    new Resolver(refreshed, constant()).play('ones', [0]);
    expect(refreshed.scorecardCycleConsumed).toEqual([]);
    refreshed.dice.forEach(die => { die.value = 5; });
    new Resolver(refreshed, constant()).play('fives', [0]);
    expect(refreshed.chargeXMult).toBe(2);
  });

  it('All Hands on Deck scales with the canonical currently available dice', () => {
    expect([1, 2, 3, 4, 5].map(count => allHandsOnDeckChargeGain(100, count))).toEqual([.5, 1, 1.5, 2, 2.5]);
    const full = game([1, 2, 3, 4, 5]);
    own(full, 'allHandsOnDeck');
    new Resolver(full, constant()).play('largeStraight', [0, 1, 2, 3, 4]);
    expect(full.chargeXMult).toBe(3.5);

    const reduced = game([2, 2, 2, 4, 5]);
    reduced.diceInventory.roster[3] = null;
    reduced.diceInventory.roster[4] = null;
    syncActiveDiceProjection(reduced);
    own(reduced, 'allHandsOnDeck');
    new Resolver(reduced, constant()).play('threeKind', [0, 1, 2]);
    expect(reduced.chargeXMult).toBe(2.5);

    const warden = game([2, 2, 2, 2, 2]);
    own(warden, 'allHandsOnDeck');
    warden.boss = { type: 'warden', encounterDieIds: [0, 1, 2, 3, 4], activeDieIds: [0, 1],
      startingDieId: 0, nextUnlockTarget: null, unlockCosts: [], unlockTargets: [], pendingReinforcements: 0 };
    new Resolver(warden, constant()).play('pair', [0, 1]);
    expect(warden.chargeXMult).toBe(2);

    const magician = game([2, 2, 2, 2, 2]);
    own(magician, 'allHandsOnDeck');
    magician.boss = { type: 'magician', missingDieId: 4, calledHands: [], completedHands: [], returned: false };
    new Resolver(magician, constant()).play('fourKind', [0, 1, 2, 3]);
    expect(magician.chargeXMult).toBe(3);

    const one = game([1, 2, 3, 4, 5]);
    for (let index = 1; index < 5; index++) one.diceInventory.roster[index] = null;
    syncActiveDiceProjection(one);
    own(one, 'allHandsOnDeck');
    new Resolver(one, constant()).play('ones', [0]);
    expect(one.chargeXMult).toBe(1.5);

    const free = game([1, 2, 3, 4, 5]);
    for (let index = 1; index < 5; index++) free.diceInventory.roster[index as 1 | 2 | 3 | 4] = null;
    syncActiveDiceProjection(free); own(free, 'allHandsOnDeck');
    new Resolver(free, constant()).play('ones', [0], 'jumpingBean');
    expect(free.chargeXMult).toBe(1.5);
  });

  it('does not let an unplayed Hitchhiker satisfy All Hands on Deck', () => {
    const state = game([2, 2, 2, 2, 2]);
    effects(state, 4, [['hitchhiker', 1]]);
    own(state, 'allHandsOnDeck');
    new Resolver(state, constant()).play('fourKind', [0, 1, 2, 3]);
    expect(state.chargeXMult).toBe(1);
  });
});

describe('Ultimate, Free Play, and face-condition Flames', () => {
  it('Casual uses shared Manual Reroll accounting for normal and Care Package charges', () => {
    expect(casualMultiplier(100)).toBe(4);
    const clean = game([5, 5, 5, 5, 5]);
    own(clean, 'casual');
    new Resolver(clean, constant()).play('fiveKind', [0, 1, 2, 3, 4]);
    expect(flameFactor(clean, 'casual')).toBe(4);

    for (const carePackage of [false, true]) {
      const rerolled = game([5, 5, 5, 5, 5]);
      own(rerolled, 'casual');
      if (carePackage) {
        rerolled.manualRerollsRemaining = 0;
        rerolled.specialOfferEffects.carePackageRerolls = 1;
      }
      new Resolver(rerolled, constant()).manualReroll([0]);
      rerolled.dice.forEach(die => { die.value = 5; });
      new Resolver(rerolled, constant()).play('fiveKind', [0, 1, 2, 3, 4]);
      expect(flameFactor(rerolled, 'casual')).toBeUndefined();
    }

    const automatic = game([5, 5, 5, 5, 5]);
    own(automatic, 'casual');
    new Resolver(automatic, constant()).rollBatch([0], 'automatic', 'gameplay');
    automatic.dice.forEach(die => { die.value = 5; });
    new Resolver(automatic, constant()).play('fiveKind', [0, 1, 2, 3, 4]);
    expect(flameFactor(automatic, 'casual')).toBe(4);
    automatic.phase = 'shop'; automatic.shop = { stage: 'shop', offers: [], offerRerolls: 0, lifeRestores: 0 };
    new Resolver(automatic, constant()).startRound(true);
    expect(automatic.manualRerollsUsedThisRound).toBe(0);
  });

  it('Free Real Estate applies once to canonical Jumping Bean and Curtain Call Free Plays, never manual Plays', () => {
    expect(freeRealEstateMultiplier(100)).toBe(3);
    const bean = game([2, 2, 3, 4, 5]);
    effects(bean, 0, [['jumpingBean', 1]]); own(bean, 'freeRealEstate');
    const beanResolver = new Resolver(bean, constant(0));
    beanResolver.rollBatch([0], 'Jumping Bean test', 'gameplay'); beanResolver.drain();
    expect(flameFactor(bean, 'freeRealEstate')).toBe(3);

    const curtain = game([1, 2, 3, 4, 5]);
    effects(curtain, 0, [['freePlay', 1]]); own(curtain, 'freeRealEstate');
    new Resolver(curtain, constant()).manualReroll([0]);
    expect(flameFactor(curtain, 'freeRealEstate')).toBe(3);

    const manual = game(); own(manual, 'freeRealEstate');
    new Resolver(manual, constant()).play('ones', [0]);
    expect(flameFactor(manual, 'freeRealEstate')).toBeUndefined();
  });

  it.each([
    [[6], true], [[6, 3], false], [[6, 5], true], [[4, 2, 6], true],
    [[4, 5, 2, 3], false], [[4, 5, 6, 2], true], [[4, 5, 6, 1, 2], true],
  ] as const)('High Roller uses the shared strict majority for %j', (values, qualifies) => {
    const state = game(values as unknown as Rank[]);
    const ids = values.map((_, index) => index);
    expect(highRollerPlayedDiceCounts(captureHandStart(state, 'ones', ids)).qualifies).toBe(qualifies);
  });

  it('High Roller ignores Hitchhikers and reaches ×3', () => {
    expect(highRollerMultiplier(100)).toBe(3);
    const state = game([6, 1, 2, 3, 4]);
    own(state, 'highRoller');
    effects(state, 1, [['hitchhiker', 1]]);
    new Resolver(state, constant()).play('sixes', [0]);
    expect(flameFactor(state, 'highRoller')).toBe(3);
  });
});

describe('resolved Pips and enhancement composition Flames', () => {
  it('Heavy Hitters compares resolved Played-die Pips with face values and excludes Hitchhikers', () => {
    expect(heavyHittersMultiplier(100)).toBe(3);
    const normal = game([5, 2, 3, 4, 6]); own(normal, 'heavyHitters');
    new Resolver(normal, constant()).play('fives', [0]);
    expect(flameFactor(normal, 'heavyHitters')).toBeUndefined();

    const basicBonus = game([5, 2, 3, 4, 6]);
    effects(basicBonus, 0, [['basic', 2], ['bonus', 1]]); own(basicBonus, 'heavyHitters');
    new Resolver(basicBonus, constant()).play('fives', [0]);
    expect(flameFactor(basicBonus, 'heavyHitters')).toBe(3);

    const team = game([2, 2, 3, 4, 5]);
    effects(team, 1, [['teamPlayer', 1]]); own(team, 'heavyHitters');
    new Resolver(team, constant()).play('pair', [0, 1]);
    expect(flameFactor(team, 'heavyHitters')).toBe(3);

    const workout = game([3, 2, 4, 5, 6]);
    effects(workout, 0, [['workout', 1]]); own(workout, 'heavyHitters');
    effectRuntime(workout.dieRoundState[0], effectOf(rosterDice(workout)[0], 'workout'))!.temporaryPips = 2;
    new Resolver(workout, constant()).play('threes', [0]);
    expect(flameFactor(workout, 'heavyHitters')).toBe(3);

    const hitch = game([6, 2, 3, 4, 5]);
    effects(hitch, 1, [['hitchhiker', 1], ['bonus', 5]]); own(hitch, 'heavyHitters');
    new Resolver(hitch, constant()).play('sixes', [0]);
    expect(flameFactor(hitch, 'heavyHitters')).toBeUndefined();
  });

  it('Frankenstein counts unique scoring-die components, not levels or Score occurrences', () => {
    expect(frankensteinMultiplier(100)).toBe(4);
    const exact = game([1, 2, 3, 4, 5]);
    effects(exact, 0, [['bonus', 9], ['golden', 7]]); own(exact, 'frankenstein');
    new Resolver(exact, constant()).play('ones', [0]);
    expect(flameFactor(exact, 'frankenstein')).toBeUndefined();

    const over = game([1, 2, 3, 4, 5]);
    effects(over, 0, [['basic', 1], ['bonus', 1], ['doubleTime', 8]]); own(over, 'frankenstein');
    new Resolver(over, constant()).play('ones', [0]);
    expect(flameFactor(over, 'frankenstein')).toBe(4);
    expect(over.stats.handScores.at(-1)?.xMultFactors.find(item => item.source === 'frankenstein')?.diagnostics)
      .toMatchObject({ scoringDiceEnhancementCount: 3, playedDiceCount: 1, enhancementThreshold: 2 });

    const hitch = game([1, 2, 3, 4, 5]);
    effects(hitch, 1, [['hitchhiker', 1], ['bonus', 1], ['golden', 1]]); own(hitch, 'frankenstein');
    new Resolver(hitch, constant()).play('ones', [0]);
    expect(flameFactor(hitch, 'frankenstein')).toBe(4);
  });
});

describe('Clean Sweep and Bench Warmer', () => {
  it('Clean Sweep uses the canonical refresh set, applies before refresh, and can recur', () => {
    expect(cleanSweepMultiplier(100)).toBe(12);
    const state = game([1, 2, 3, 4, 5]); own(state, 'cleanSweep');
    const relevant = scorecardCycleRelevantHands(state);
    state.consumed = relevant.filter(hand => hand !== 'ones');
    state.scorecardCycleConsumed = [...state.consumed];
    let result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant()).state;
    expect(flameFactor(result, 'cleanSweep')).toBe(12);
    expect(result.scorecardCycleConsumed).toEqual([]);

    result.consumed = relevant.filter(hand => hand !== 'twos');
    result.scorecardCycleConsumed = [...result.consumed];
    result.dice[1].value = 2;
    result = dispatch(result, { type: 'PLAY', hand: 'twos', dieIds: [1] }, constant()).state;
    expect(flameFactor(result, 'cleanSweep')).toBe(12);
  });

  it('Clean Sweep respects impossible and Neglected exclusions but never Marathon cooldown reuse', () => {
    const reduced = game([1, 2, 3, 4, 5]);
    reduced.diceInventory.roster[2] = null; reduced.diceInventory.roster[3] = null; reduced.diceInventory.roster[4] = null;
    syncActiveDiceProjection(reduced); own(reduced, 'cleanSweep');
    const relevant = scorecardCycleRelevantHands(reduced);
    reduced.consumed = relevant.filter(hand => hand !== 'ones'); reduced.scorecardCycleConsumed = [...reduced.consumed];
    new Resolver(reduced, constant()).play('ones', [0]);
    expect(flameFactor(reduced, 'cleanSweep')).toBe(12);

    const neglected = game(); own(neglected, 'cleanSweep');
    neglected.boss = { type: 'neglected', neglectedHands: ['fiveKind', 'largeStraight'], handsPlayed: 0, restored: false };
    const allowed = scorecardCycleRelevantHands(neglected);
    neglected.consumed = [...neglected.boss.neglectedHands, ...allowed.filter(hand => hand !== 'ones')];
    neglected.scorecardCycleConsumed = allowed.filter(hand => hand !== 'ones');
    new Resolver(neglected, constant()).play('ones', [0]);
    expect(flameFactor(neglected, 'cleanSweep')).toBe(12);

    const restoring = game(); own(restoring, 'cleanSweep');
    restoring.boss = { type: 'neglected', neglectedHands: ['fiveKind', 'largeStraight'], handsPlayed: 5, restored: false };
    const preRestore = scorecardCycleRelevantHands(restoring);
    restoring.consumed = [...restoring.boss.neglectedHands, ...preRestore.filter(hand => hand !== 'ones')];
    restoring.scorecardCycleConsumed = preRestore.filter(hand => hand !== 'ones');
    new Resolver(restoring, constant()).play('ones', [0]);
    expect(flameFactor(restoring, 'cleanSweep')).toBeUndefined();

    const marathon = game(); own(marathon, 'cleanSweep'); marathon.boss = { type: 'marathon', cooldowns: {} };
    marathon.scorecardCycleConsumed = HAND_IDS.filter(hand => hand !== 'ones');
    new Resolver(marathon, constant()).play('ones', [0]);
    expect(flameFactor(marathon, 'cleanSweep')).toBeUndefined();
  });

  it('Bench Warmer uses inverse deterministic ranking, updates, activates, and records targets', () => {
    expect(benchWarmerMultiplier(100)).toBe(5);
    const levels = initialHandLevels();
    expect(benchWarmerHand(levels)).toBe('ones');
    levels.ones = 2;
    expect(benchWarmerHand(levels)).toBe('twos');

    const state = game([1, 2, 3, 4, 5]); own(state, 'benchWarmer');
    const resolver = new Resolver(state, constant());
    resolver.recordBenchWarmerTarget('acquired', true);
    resolver.play('ones', [0]);
    expect(flameFactor(state, 'benchWarmer')).toBe(5);
    state.handLevels.ones = 2;
    resolver.recordBenchWarmerTarget('training');
    expect(state.historyV2.filter(event => event.kind === 'bench_warmer_target_changed').at(-1))
      .toMatchObject({ target: 'twos', reason: 'training' });
  });
});

describe('Round-start and preceding-Shop snapshots', () => {
  it('Epinephrine snapshots 1 Life and is consumed by the first manual or Free Play', () => {
    expect(epinephrineMultiplier(100)).toBe(7);
    for (const source of ['manual', 'jumpingBean'] as const) {
      const state = game(); own(state, 'epinephrine'); state.lives = 1; startFromShop(state); state.dice[0].value = 1;
      new Resolver(state, constant()).play('ones', [0], source);
      expect(flameFactor(state, 'epinephrine')).toBe(7);
      state.dice[1].value = 2;
      new Resolver(state, constant()).play('twos', [1], 'jumpingBean');
      expect(flameFactor(state, 'epinephrine')).toBeUndefined();
    }
    const healthy = game(); own(healthy, 'epinephrine'); healthy.lives = 2; startFromShop(healthy); healthy.dice[0].value = 1;
    new Resolver(healthy, constant()).play('ones', [0]);
    expect(flameFactor(healthy, 'epinephrine')).toBeUndefined();

    const retry = game(); own(retry, 'epinephrine'); retry.lives = 2; startFromShop(retry);
    retry.phase = 'shop'; retry.shop = { stage: 'shop', offers: [], offerRerolls: 0, lifeRestores: 0 };
    retry.lives = 1;
    new Resolver(retry, constant()).startRound(true);
    retry.target = 1_000_000n; retry.dice[0].value = 1;
    new Resolver(retry, constant()).play('ones', [0]);
    expect(flameFactor(retry, 'epinephrine')).toBe(7);
  });

  it('Punch Card snapshots a binary die purchase and consumes on the first Play', () => {
    expect(punchCardMultiplier(100)).toBe(3);
    const state = game(); own(state, 'punchCard');
    state.phase = 'shop'; state.shop = { stage: 'shop', offers: [], offerRerolls: 0, lifeRestores: 0,
      diePurchased: true };
    new Resolver(state, constant()).startRound(); state.target = 1_000_000n; state.dice[0].value = 1;
    new Resolver(state, constant()).play('ones', [0]);
    expect(flameFactor(state, 'punchCard')).toBe(3);
    state.dice[1].value = 2;
    new Resolver(state, constant()).play('twos', [1], 'jumpingBean');
    expect(flameFactor(state, 'punchCard')).toBeUndefined();

    const noPurchase = game(); own(noPurchase, 'punchCard'); startFromShop(noPurchase); noPurchase.dice[0].value = 1;
    new Resolver(noPurchase, constant()).play('ones', [0]);
    expect(flameFactor(noPurchase, 'punchCard')).toBeUndefined();
  });

  it('records canonical Shop die purchases as one binary Punch Card prerequisite', () => {
    let state = game(); own(state, 'punchCard');
    state.phase = 'shop'; state.gold = 100;
    state.shop = { visitId: 91, stage: 'shop', offers: [
      { id: 1, dieType: 'bonus', rarity: 'common', price: 5, purchased: false },
      { id: 2, dieType: 'golden', rarity: 'uncommon', price: 7, purchased: false },
    ], offerRerolls: 0, lifeRestores: 0, diePurchased: false };
    state = dispatch(state, { type: 'BUY_DIE', offerId: 1 }, constant()).state;
    expect(state.shop?.diePurchased).toBe(true);
    state = dispatch(state, { type: 'BUY_DIE', offerId: 2 }, constant()).state;
    expect(state.shop?.diePurchased).toBe(true);
    new Resolver(state, constant()).startRound();
    expect(state.precedingShopDiePurchase).toBe(true);
  });

  it.each([[5, 1], [4, 2], [3, 3], [2, 4], [1, 5]] as const)(
    'Black Hole snapshots roster size %i for factor ×%i', (size, expected) => {
      expect(blackHoleMultiplier(100, 5 - size)).toBe(expected);
      const state = game();
      for (const index of [1, 2, 3, 4] as const) if (index >= size) state.diceInventory.roster[index] = null;
      syncActiveDiceProjection(state); own(state, 'blackHole'); startFromShop(state);
      state.dice[0].value = 1;
      new Resolver(state, constant()).play('ones', [0]);
      expect(flameFactor(state, 'blackHole')).toBe(expected === 1 ? undefined : expected);
    },
  );

  it('Black Hole ignores Warden and Magician temporary availability', () => {
    for (const boss of ['warden', 'magician'] as const) {
      const state = game(); own(state, 'blackHole'); state.roundStartRosterSize = 5;
      state.boss = boss === 'warden'
        ? { type: 'warden', encounterDieIds: [0, 1, 2, 3, 4], activeDieIds: [0], startingDieId: 0,
          nextUnlockTarget: null, unlockCosts: [], unlockTargets: [], pendingReinforcements: 0 }
        : { type: 'magician', missingDieId: 4, calledHands: [], completedHands: [], returned: false };
      state.dice[0].value = 1;
      new Resolver(state, constant()).play('ones', [0]);
      expect(flameFactor(state, 'blackHole')).toBeUndefined();
    }
  });
});

describe('new density Flames and offer prerequisites', () => {
  it.each([
    ['assemblyLine', 'clockwork', assemblyLineMultiplier],
    ['gymBros', 'workout', gymBrosMultiplier],
  ] as const)('%s scales from one through five matching Played dice', (flame, effect, multiplier) => {
    expect([1, 2, 3, 4, 5].map(count => multiplier(100, count))).toEqual([1.3, 1.6, 1.9, 2.2, 2.5]);
    for (let count = 1; count <= 5; count++) {
      const state = game([1, 1, 1, 1, 1]); own(state, flame);
      for (let index = 0; index < count; index++) effects(state, index, [[effect, index + 1]]);
      const ids = Array.from({ length: count }, (_, index) => index);
      new Resolver(state, constant()).play('ones', ids);
      expect(flameFactor(state, flame)).toBeCloseTo(multiplier(100, count));
    }
  });

  it('gates only structurally dependent new Flames through canonical build capabilities', () => {
    const state = game();
    expect(buildCanProduceFreePlays(state)).toBe(false);
    expect(eligibleFlameIds(state)).not.toEqual(expect.arrayContaining(['freeRealEstate', 'assemblyLine', 'gymBros']));
    effects(state, 0, [['freePlay', 1], ['clockwork', 1], ['workout', 1]]);
    expect(buildCanProduceFreePlays(state)).toBe(true);
    expect(eligibleFlameIds(state)).toEqual(expect.arrayContaining(['freeRealEstate', 'assemblyLine', 'gymBros',
      'potentialEnergy', 'casual', 'benchWarmer', 'blackHole']));
  });

  it('shares Played-only and active-effect suppression semantics with Pass 1 density Flames', () => {
    const state = game([1, 1, 1, 1, 1]);
    effects(state, 0, [['clockwork', 4]]);
    effects(state, 1, [['clockwork', 1], ['hitchhiker', 1]]);
    own(state, 'assemblyLine');
    new Resolver(state, constant()).play('ones', [0]);
    expect(flameFactor(state, 'assemblyLine')).toBe(1.3);

    const suppressed = game([1, 1, 1, 1, 1]);
    effects(suppressed, 0, [['workout', 5]]); own(suppressed, 'gymBros');
    activeFace(rosterDice(suppressed)[0]).bossMutation = { kind: 'infected' };
    new Resolver(suppressed, constant()).play('ones', [0]);
    expect(flameFactor(suppressed, 'gymBros')).toBeUndefined();
  });
});
