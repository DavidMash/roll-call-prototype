import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { Resolver } from './effects';
import { dispatch, newRun, validateAction } from './engine';
import {
  burnItDownChargeGain, dareDevilMultiplier, FLAME_IDS, greaseTheEngineChargeGain, greaseTheEngineCost,
  hotPotatoClockChargeGain, lightningStrikeChargeGain, placeFlameInstance, recalculateMaxCharge,
} from './flames';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { createDieEffect, effectOf, effectRuntime, resetDieRoundState } from './specialDice';
import type { Flame, GameState, HandId, RandomSource, Rank, SpecialDieType } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });
const PASS_3A_FLAMES = ['burnItDown', 'greaseTheEngine', 'lightningStrike', 'hotPotatoClock', 'dareDevil'] as const;

function game(values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const state = newRun('flame-update-pass-3a', constant(.8)).state;
  state.target = 100n;
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

function factor(state: GameState, flame: Flame): number | undefined {
  return state.stats.handScores.at(-1)?.xMultFactors.find(item => item.source === flame)?.value;
}

function startFromShop(state: GameState, retry = false): void {
  state.phase = 'shop';
  state.shop = { stage: 'shop', offers: [], offerRerolls: 0, lifeRestores: 0 };
  new Resolver(state, constant()).startRound(retry);
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
}

describe('Flame Update Pass 3A catalog and formulas', () => {
  it('retains exactly the five Pass 3A Flames without later interactive Flames', () => {
    expect(FLAME_IDS.filter(id => (PASS_3A_FLAMES as readonly string[]).includes(id))).toEqual(PASS_3A_FLAMES);
    expect(FLAME_IDS).not.toEqual(expect.arrayContaining(['topDown', 'countDown']));
  });

  it('centralizes the exact initial scaling', () => {
    expect([.1, .25, .5, .75, 1].map(fraction => burnItDownChargeGain(100, fraction)))
      .toEqual([.5, 1.25, 2.5, 3.75, 5]);
    expect([0, 1, 2, 3, 4, 5].map(greaseTheEngineCost)).toEqual([5, 10, 20, 40, 80, 160]);
    expect(greaseTheEngineChargeGain(100)).toBe(1);
    expect(lightningStrikeChargeGain(100)).toBe(3);
    expect([1, 2, 3].map(streak => hotPotatoClockChargeGain(100, streak))).toEqual([.5, 1, 1.5]);
    expect([1, 2, 3, 4, 5].map(count => dareDevilMultiplier(100, count))).toEqual([3, 5, 7, 9, 9]);

    const state = game();
    for (const flame of ['burnItDown', 'greaseTheEngine', 'lightningStrike', 'hotPotatoClock'] as const) own(state, flame);
    expect(state.maxCharge).toBe(20);
  });
});

describe('Burn It Down', () => {
  it.each([[10n, .5], [25n, 1.25], [50n, 2.5], [75n, 3.75]] as const)(
    'sacrifices %s%% of a 100 target for %s Charge at Bonfire', (score, expectedGain) => {
      const state = game(); own(state, 'burnItDown'); state.score = score;
      const result = dispatch(state, { type: 'ACTIVATE_BURN_IT_DOWN' }, constant()).state;
      expect(result.score).toBe(0n);
      expect(result.chargeXMult).toBe(1 + expectedGain);
      expect(result.historyV2.at(-1)).toMatchObject({ kind: 'flame_action', flame: 'burnItDown',
        action: { type: 'burn_it_down', scoreSacrificed: score, target: 100n,
          chargeRequested: expectedGain, chargeGained: expectedGain, useCount: 1 } });
    },
  );

  it('can repeat without rewinding any non-score gameplay state and respects the Charge cap', () => {
    let state = game(); own(state, 'burnItDown');
    state.score = 25n; state.consumed = ['ones']; state.handPlayCounts.ones = 4; state.gold = 17; state.dice[0].value = 6;
    state = dispatch(state, { type: 'ACTIVATE_BURN_IT_DOWN' }, constant()).state;
    expect(state).toMatchObject({ score: 0n, consumed: ['ones'], gold: 17 });
    expect(state.handPlayCounts.ones).toBe(4);
    expect(state.dice[0].value).toBe(6);
    state.score = 25n;
    state = dispatch(state, { type: 'ACTIVATE_BURN_IT_DOWN' }, constant()).state;
    expect(state.interactiveFlames.burnItDownUses).toBe(2);
    expect(state.chargeXMult).toBe(3.5);
    state.chargeXMult = state.maxCharge; state.score = 10n;
    expect(validateAction(state, { type: 'ACTIVATE_BURN_IT_DOWN' })).toContain('already full');
    state.chargeXMult = 1; state.score = 0n;
    expect(validateAction(state, { type: 'ACTIVATE_BURN_IT_DOWN' })).toContain('Build Round Score');
    state.phase = 'roundSummary'; state.score = 50n;
    expect(validateAction(state, { type: 'ACTIVATE_BURN_IT_DOWN' })).toContain('active Round');
    state.phase = 'round'; state.score = state.target;
    expect(validateAction(state, { type: 'ACTIVATE_BURN_IT_DOWN' })).toContain('already resolved');
  });

  it('keeps ownership but resets ordinary attempt state on retry', () => {
    const state = game(); own(state, 'burnItDown'); state.score = 20n;
    const used = dispatch(state, { type: 'ACTIVATE_BURN_IT_DOWN' }, constant()).state;
    startFromShop(used, true);
    expect(used.flameSlots.some(slot => slot?.type === 'burnItDown')).toBe(true);
    expect(used.interactiveFlames.burnItDownUses).toBe(0);
    expect(used.score).toBe(0n);
  });
});

describe('Grease the Engine', () => {
  it('spends canonical Gold at escalating prices and adds Charge on every successful bribe', () => {
    let state = game(); own(state, 'greaseTheEngine'); own(state, 'momentum'); state.gold = 500;
    const prices = [5, 10, 20, 40, 80];
    for (const [index, price] of prices.entries()) {
      const beforeGold = state.gold;
      state = dispatch(state, { type: 'ACTIVATE_GREASE_THE_ENGINE' }, constant()).state;
      expect(state.gold).toBe(beforeGold - price);
      expect(state.interactiveFlames.greaseTheEngineUses).toBe(index + 1);
    }
    expect(state.chargeXMult).toBe(6);
    expect(state.stats.goldSpentBySource.greaseTheEngine).toBe(155);
    expect(state.historyV2.filter(event => event.kind === 'flame_action' && event.flame === 'greaseTheEngine')).toHaveLength(5);
  });

  it('disables for insufficient Gold, zero investment, or full Charge and resets price each attempt', () => {
    const poor = game(); own(poor, 'greaseTheEngine'); poor.gold = 4;
    expect(validateAction(poor, { type: 'ACTIVATE_GREASE_THE_ENGINE' })).toContain('Not enough Gold');
    const cold = game(); own(cold, 'greaseTheEngine', 0);
    expect(validateAction(cold, { type: 'ACTIVATE_GREASE_THE_ENGINE' })).toContain('needs investment');
    const full = game(); own(full, 'greaseTheEngine'); full.chargeXMult = full.maxCharge;
    expect(validateAction(full, { type: 'ACTIVATE_GREASE_THE_ENGINE' })).toContain('already full');
    const used = game(); own(used, 'greaseTheEngine'); used.gold = 100;
    const after = dispatch(used, { type: 'ACTIVATE_GREASE_THE_ENGINE' }, constant()).state;
    startFromShop(after, true);
    expect(after.interactiveFlames.greaseTheEngineUses).toBe(0);
    expect(greaseTheEngineCost(after.interactiveFlames.greaseTheEngineUses)).toBe(5);
  });
});

describe('Lightning Strike', () => {
  it('uses one canonical normal or Care Package Manual Reroll and checks the final face', () => {
    for (const reserve of [false, true]) {
      let state = game(); own(state, 'lightningStrike'); state.dice[0].value = 1;
      if (reserve) { state.manualRerollsRemaining = 0; state.specialOfferEffects.carePackageRerolls = 1; }
      const beforeNormal = state.manualRerollsRemaining;
      state = dispatch(state, { type: 'ACTIVATE_LIGHTNING_STRIKE', dieId: 0, predictedFace: 2 }, constant()).state;
      expect(activeFace(state.dice[0]).rank).toBe(2);
      expect(state.chargeXMult).toBe(4);
      expect(state.manualRerollsUsedThisRound).toBe(1);
      expect(reserve ? state.specialOfferEffects.carePackageRerolls : state.manualRerollsRemaining)
        .toBe(reserve ? 0 : beforeNormal - 1);
      expect(state.historyV2.find(event => event.kind === 'flame_action' && event.flame === 'lightningStrike'))
        .toMatchObject({ action: { type: 'lightning_strike', predictedFace: 2, actualFace: 2, hit: true,
          manualRerollSource: reserve ? 'carePackage' : 'normal', chargeGained: 3 } });
    }
  });

  it('awards nothing on a miss and is disabled without a reroll resource', () => {
    let state = game(); own(state, 'lightningStrike'); state.dice[0].value = 1;
    state = dispatch(state, { type: 'ACTIVATE_LIGHTNING_STRIKE', dieId: 0, predictedFace: 6 }, constant()).state;
    expect(state.chargeXMult).toBe(1);
    expect(state.historyV2.find(event => event.kind === 'flame_action' && event.flame === 'lightningStrike'))
      .toMatchObject({ action: { type: 'lightning_strike', hit: false, chargeGained: 0 } });
    state.manualRerollsRemaining = 0; state.specialOfferEffects.carePackageRerolls = 0;
    expect(validateAction(state, { type: 'ACTIVATE_LIGHTNING_STRIKE', dieId: 0, predictedFace: 1 }))
      .toContain('Not enough manual rerolls');
  });

  it('preserves Jump Start, Casual, Hail Mary, Curtain Call, and roll-controller semantics', () => {
    let state = game([1, 1, 1, 1, 1]);
    own(state, 'lightningStrike'); own(state, 'jumpStart'); own(state, 'casual');
    state.manualRerollsRemaining = 1;
    state = dispatch(state, { type: 'ACTIVATE_LIGHTNING_STRIKE', dieId: 0, predictedFace: 2 }, constant()).state;
    expect(state.chargeXMult).toBe(6);
    state.dice.forEach(die => { die.value = 1; });
    new Resolver(state, constant()).play('fiveKind', [0, 1, 2, 3, 4]);
    expect(factor(state, 'casual')).toBeUndefined();

    const hail = game([1, 1, 1, 1, 1]); own(hail, 'lightningStrike'); own(hail, 'hailMary');
    hail.manualRerollsRemaining = 1;
    new Resolver(hail, constant()).lightningStrike(0, 2);
    hail.dice.forEach(die => { die.value = 1; });
    new Resolver(hail, constant()).play('fiveKind', [0, 1, 2, 3, 4]);
    expect(factor(hail, 'hailMary')).toBe(5);

    const curtain = game(); effects(curtain, 0, [['freePlay', 1]]); own(curtain, 'lightningStrike');
    new Resolver(curtain, constant()).lightningStrike(0, 2);
    expect(curtain.stats.handScores.some(score => score.playSource === 'freePlay')).toBe(true);

    const magic = game(); effects(magic, 0, [['magic', 1]]); own(magic, 'lightningStrike');
    effectRuntime(magic.dieRoundState[0], effectOf(rosterDice(magic)[0], 'magic'))!.magicArmedFace = 6;
    new Resolver(magic, constant()).lightningStrike(0, 6);
    expect(activeFace(magic.dice[0]).rank).toBe(6);
    expect(magic.chargeXMult).toBe(4);
  });
});

describe('Hot Potato Clock', () => {
  const upperByFace: Partial<Record<Rank, HandId>> = {
    1: 'ones', 2: 'twos', 3: 'threes', 4: 'fours', 5: 'fives', 6: 'sixes',
  };

  it('tracks stable identity, grows on avoidance, resets when Played, and moves after every Play', () => {
    const state = game(); own(state, 'hotPotatoClock');
    state.interactiveFlames.hotPotatoDieId = 0;
    for (const expectedStreak of [1, 2, 3]) {
      const target = state.interactiveFlames.hotPotatoDieId!;
      const alternative = state.dice.find(die => die.owner === 'player' && die.id !== target)!;
      const face = activeFace(alternative).rank as Exclude<Rank, 7>;
      const prior = target;
      new Resolver(state, constant()).play(upperByFace[face]!, [alternative.id], 'jumpingBean');
      expect(state.interactiveFlames.hotPotatoStreak).toBe(expectedStreak);
      expect(state.interactiveFlames.hotPotatoDieId).not.toBe(prior);
    }
    expect(state.chargeXMult).toBe(4);
    const target = state.interactiveFlames.hotPotatoDieId!;
    const targetDie = state.dice.find(die => die.id === target)!;
    new Resolver(state, constant()).play(upperByFace[activeFace(targetDie).rank]!, [target], 'jumpingBean');
    expect(state.interactiveFlames.hotPotatoStreak).toBe(0);
    expect(state.chargeXMult).toBe(4);
    expect(state.historyV2.filter(event => event.kind === 'flame_action' && event.flame === 'hotPotatoClock')).toHaveLength(4);
  });

  it('handles one die, reduced/boss availability, Hitchhikers, and retry reset', () => {
    const one = game();
    for (const index of [1, 2, 3, 4] as const) one.diceInventory.roster[index] = null;
    syncActiveDiceProjection(one); own(one, 'hotPotatoClock'); one.interactiveFlames.hotPotatoDieId = 0;
    new Resolver(one, constant()).play('ones', [0], 'jumpingBean');
    expect(one.interactiveFlames).toMatchObject({ hotPotatoDieId: 0, hotPotatoStreak: 0 });

    const warden = game([1, 2, 3, 4, 5]); own(warden, 'hotPotatoClock');
    warden.boss = { type: 'warden', encounterDieIds: [0, 1, 2, 3, 4], activeDieIds: [2], startingDieId: 2,
      nextUnlockTarget: null, unlockCosts: [], unlockTargets: [], pendingReinforcements: 0 };
    warden.interactiveFlames.hotPotatoDieId = 0;
    new Resolver(warden, constant()).play('threes', [2], 'jumpingBean');
    expect(warden.historyV2.find(event => event.kind === 'flame_action' && event.flame === 'hotPotatoClock'))
      .toMatchObject({ action: { type: 'hot_potato_play', targetBefore: 2, played: true } });

    const magician = game(); own(magician, 'hotPotatoClock');
    magician.boss = { type: 'magician', missingDieId: 4, calledHands: [], completedHands: [], returned: false };
    magician.interactiveFlames.hotPotatoDieId = 4;
    new Resolver(magician, constant()).play('ones', [0], 'jumpingBean');
    expect(magician.historyV2.find(event => event.kind === 'flame_action' && event.flame === 'hotPotatoClock'))
      .toMatchObject({ action: { type: 'hot_potato_play', targetBefore: expect.not.stringMatching('4') } });

    const hitch = game(); effects(hitch, 0, [['hitchhiker', 1]]); own(hitch, 'hotPotatoClock');
    hitch.interactiveFlames.hotPotatoDieId = 0;
    new Resolver(hitch, constant()).play('twos', [1]);
    expect(hitch.interactiveFlames.hotPotatoStreak).toBe(1);

    startFromShop(hitch, true);
    expect(hitch.interactiveFlames.hotPotatoStreak).toBe(0);
    expect(hitch.interactiveFlames.hotPotatoDieId).not.toBeNull();
  });

  it('chooses a seeded stable-ID target at Round start and scorecard refresh does not reset its streak', () => {
    const first = game(); own(first, 'hotPotatoClock'); startFromShop(first);
    const second = game(); own(second, 'hotPotatoClock'); startFromShop(second);
    expect(first.interactiveFlames.hotPotatoDieId).toBe(second.interactiveFlames.hotPotatoDieId);
    expect(rosterDice(first).map(die => die.id)).toContain(first.interactiveFlames.hotPotatoDieId);

    first.interactiveFlames.hotPotatoDieId = 0;
    first.interactiveFlames.hotPotatoStreak = 2;
    const finishingHand: HandId = 'twos';
    first.dice[1].value = 2;
    first.scorecardCycleConsumed = (Object.keys(first.handLevels) as HandId[]).filter(hand => hand !== finishingHand);
    first.consumed = [...first.scorecardCycleConsumed];
    new Resolver(first, constant()).play(finishingHand, [1]);
    expect(first.scorecardCycleConsumed).toEqual([]);
    expect(first.interactiveFlames.hotPotatoStreak).toBe(3);
  });
});

describe('Dare Devil', () => {
  it('requires playable Ultimate, Rolls only available player dice, preserves Manual Rerolls and caps at four', () => {
    let state = game([5, 5, 5, 5, 5]); own(state, 'dareDevil');
    const rerolls = state.manualRerollsRemaining;
    for (let count = 1; count <= 4; count++) {
      state = dispatch(state, { type: 'ACTIVATE_DARE_DEVIL' }, constant()).state;
      expect(state.interactiveFlames.dareDevilCount).toBe(count);
      expect(state.manualRerollsRemaining).toBe(rerolls);
      expect(state.historyV2.filter(event => event.kind === 'roll_batch').at(-1))
        .toMatchObject({ reason: 'dare_devil', dieIds: [0, 1, 2, 3, 4], spend: null });
    }
    expect(validateAction(state, { type: 'ACTIVATE_DARE_DEVIL' })).toContain('payoff cap');

    const unavailable = game(); own(unavailable, 'dareDevil');
    expect(validateAction(unavailable, { type: 'ACTIVATE_DARE_DEVIL' })).toContain('not currently playable');

    const magician = game([5, 5, 5, 5, 5]); own(magician, 'dareDevil');
    magician.boss = { type: 'magician', missingDieId: 4, calledHands: [], completedHands: [], returned: false };
    new Resolver(magician, constant()).dareDevil();
    expect(magician.historyV2.filter(event => event.kind === 'roll_batch').at(-1))
      .toMatchObject({ reason: 'dare_devil', dieIds: [0, 1, 2, 3] });
  });

  it('stores ×3/×5/×7/×9, follows current Ultimate, and consumes only on Ultimate manual or Free Plays', () => {
    const state = game([5, 5, 5, 5, 5]); own(state, 'dareDevil');
    const resolver = new Resolver(state, constant());
    resolver.dareDevil();
    state.dice.forEach(die => { die.value = 1; });
    resolver.play('ones', [0], 'jumpingBean');
    expect(state.interactiveFlames.dareDevilCount).toBe(1);
    resolver.play('fiveKind', [0, 1, 2, 3, 4], 'jumpingBean');
    expect(factor(state, 'dareDevil')).toBe(3);
    expect(state.interactiveFlames.dareDevilCount).toBe(0);

    state.dice.forEach(die => { die.value = 2; });
    resolver.dareDevil(); resolver.dareDevil();
    state.dice.forEach(die => { die.value = 2; });
    resolver.play('fiveKind', [0, 1, 2, 3, 4]);
    expect(factor(state, 'dareDevil')).toBe(5);
    expect(state.interactiveFlames.dareDevilCount).toBe(0);
  });

  it('uses canonical Roll controllers, keeps Casual eligible, and resets on retry', () => {
    const state = game([5, 5, 5, 5, 5]); effects(state, 0, [['magic', 1]]);
    own(state, 'dareDevil'); own(state, 'casual');
    effectRuntime(state.dieRoundState[0], effectOf(rosterDice(state)[0], 'magic'))!.magicArmedFace = 6;
    new Resolver(state, constant()).dareDevil();
    expect(activeFace(state.dice[0]).rank).toBe(6);
    expect(state.manualRerollsUsedThisRound).toBe(0);
    state.dice.forEach(die => { die.value = 1; });
    new Resolver(state, constant()).play('fiveKind', [0, 1, 2, 3, 4]);
    expect(factor(state, 'casual')).toBe(4);
    state.interactiveFlames.dareDevilCount = 3;
    startFromShop(state, true);
    expect(state.interactiveFlames.dareDevilCount).toBe(0);
  });
});
