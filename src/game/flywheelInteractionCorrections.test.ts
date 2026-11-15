import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { createBossRuntime, createCursedDie, currentlyPlayableManualHands } from './bosses';
import { dispatch, newRun, validateAction } from './engine';
import { Resolver } from './effects';
import { placeFlameInstance, recalculateMaxCharge } from './flames';
import { HAND_IDS } from './hands';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { hasLegalManualReroll, resolveManualRerollCost } from './manualRerolls';
import { createDieEffect, effectOf, effectRuntime, resetDieRoundState } from './specialDice';
import type { Flame, GameState, RandomSource, Rank, SpecialDieType } from './types';
import type { RollBatchEvent } from './runHistoryV2';

const constant = (value = 0): RandomSource => ({ next: () => value });
const sequence = (...values: number[]): RandomSource => {
  let index = 0;
  return { next: () => values[Math.min(index++, values.length - 1)] ?? 0 };
};

function game(seed = 'flywheel-corrections', values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const state = newRun(seed, constant(.25)).state;
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
  values.forEach((value, index) => { rosterDice(state)[index].value = value; });
  syncActiveDiceProjection(state);
  return state;
}

function equip(state: GameState, dieIndex: number, effects: Array<[SpecialDieType, number]>): void {
  const die = rosterDice(state)[dieIndex];
  die.effects = effects.map(([type, level]) => createDieEffect(die.id, type, level));
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
}

function own(state: GameState, flame: Flame, investment = 100): void {
  placeFlameInstance(state, flame, investment);
  recalculateMaxCharge(state);
}

function flywheelUses(state: GameState, dieIndex: number): number {
  const die = rosterDice(state)[dieIndex];
  return effectRuntime(state.dieRoundState[die.id], effectOf(die, 'flywheel'))!.invocationsRemaining;
}

function manualBatch(state: GameState): RollBatchEvent | undefined {
  return [...state.historyV2].reverse().find((event): event is RollBatchEvent =>
    event.kind === 'roll_batch' && event.reason === 'manual');
}

describe('Flywheel per-die Manual Reroll pricing', () => {
  it('charges exactly once for every uncovered selected die', () => {
    const state = game();
    equip(state, 0, [['flywheel', 1]]);
    rosterDice(state)[1].effects = [createDieEffect(1, 'flywheel', 1)];
    state.dieRoundState = resetDieRoundState(rosterDice(state));

    expect(resolveManualRerollCost(state, [0])).toMatchObject({ resourceCost: 0, flywheelDieIds: [0] });
    expect(resolveManualRerollCost(state, [0, 1])).toMatchObject({ resourceCost: 0, flywheelDieIds: [0, 1] });
    expect(resolveManualRerollCost(state, [0, 2])).toMatchObject({ resourceCost: 1, flywheelDieIds: [0] });
    expect(resolveManualRerollCost(state, [0, 2, 3, 4])).toMatchObject({ resourceCost: 3, flywheelDieIds: [0] });
    expect(resolveManualRerollCost(state, [0, 1, 2, 3])).toMatchObject({ resourceCost: 2, flywheelDieIds: [0, 1] });

    effectRuntime(state.dieRoundState[1], effectOf(rosterDice(state)[1], 'flywheel'))!.invocationsRemaining = 0;
    expect(resolveManualRerollCost(state, [0, 1, 2])).toMatchObject({ resourceCost: 2, flywheelDieIds: [0] });
  });

  it('does not cover Infected-suppressed or boss-owned Cursed dice', () => {
    const infected = game('infected-flywheel');
    equip(infected, 0, [['flywheel', 1]]);
    activeFace(rosterDice(infected)[0]).bossMutation = { kind: 'infected' };
    expect(resolveManualRerollCost(infected, [0, 1])).toMatchObject({ resourceCost: 2, flywheelDieIds: [] });

    const hexer = game('cursed-flywheel');
    equip(hexer, 0, [['flywheel', 1]]);
    const cursed = createCursedDie();
    hexer.encounterDice = [cursed];
    hexer.boss = { type: 'hexer', cursedDieId: cursed.id };
    syncActiveDiceProjection(hexer);
    expect(resolveManualRerollCost(hexer, [0, cursed.id])).toMatchObject({ resourceCost: 1, flywheelDieIds: [0] });
  });

  it('spends normal resources before Care Package and records per-die coverage once', () => {
    const state = game('flywheel-care');
    equip(state, 0, [['flywheel', 1]]);
    state.manualRerollsRemaining = 1;
    state.specialOfferEffects.carePackageRerolls = 1;

    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1, 2] }, constant(.8));
    expect(result.error).toBeUndefined();
    expect(result.state.manualRerollsRemaining).toBe(0);
    expect(result.state.specialOfferEffects.carePackageRerolls).toBe(0);
    expect(flywheelUses(result.state, 0)).toBe(0);
    expect(result.state.stats.manualRerolls.at(-1)).toMatchObject({ charges: 2, flywheelDieIds: [0] });
    expect(manualBatch(result.state)).toMatchObject({ spend: {
      normalCharges: 1, carePackageCharges: 1, flywheelDieIds: [0],
    } });
  });
});

describe('Jump Start per-die semantics', () => {
  it('triggers for every manually rerolled die even when Flywheel makes the action free', () => {
    const state = game('jump-start-free', [1, 1, 3, 4, 5]);
    own(state, 'jumpStart');
    equip(state, 0, [['flywheel', 1]]);
    rosterDice(state)[1].effects = [createDieEffect(1, 'flywheel', 1)];
    state.dieRoundState = resetDieRoundState(rosterDice(state));
    state.manualRerollsRemaining = 0;
    state.specialOfferEffects.carePackageRerolls = 0;

    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1] }, constant(0));
    expect(result.error).toBeUndefined();
    expect(result.state.chargeXMult).toBe(2.25);
    expect(result.state.stats.flameTriggers.jumpStart).toBe(2);
    expect(result.state.stats.manualRerollActions).toBe(1);
    expect(result.state.stats.manualDiceRerolled).toBe(2);
    expect(result.state.stats.manualRerolls.at(-1)?.charges).toBe(0);
    expect(result.state.chargeEvents.filter(event => event.sourceFlame === 'jumpStart')).toHaveLength(2);
  });

  it('compounds every per-die attempt while respecting the Charge cap', () => {
    const state = game('jump-start-cap');
    own(state, 'jumpStart');
    state.chargeXMult = 4;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1, 2] }, constant(.8));
    const events = result.state.chargeEvents.filter(event => event.sourceFlame === 'jumpStart');
    expect(result.state.chargeXMult).toBe(result.state.maxCharge);
    expect(events).toHaveLength(3);
    expect(events.map(event => event.factorRequested)).toEqual([1.5, 1.5, 1.5]);
    expect(events.at(-1)?.after).toBe(result.state.maxCharge);
  });
});

describe('authoritative legal Manual Reroll availability', () => {
  function deadFlywheelBoard(seed: string, bottledFairy: boolean): GameState {
    const state = game(seed, [1, 1, 1, 1, 1]);
    equip(state, 0, [['flywheel', 1]]);
    state.consumed = currentlyPlayableManualHands(state);
    state.manualRerollsRemaining = 0;
    state.specialOfferEffects.carePackageRerolls = 0;
    state.specialOfferEffects.bottledFairyRounds = bottledFairy ? 3 : 0;
    return state;
  }

  it('keeps a dead board alive while a legal free Flywheel reroll remains', () => {
    const state = deadFlywheelBoard('dead-free-flywheel', false);
    expect(currentlyPlayableManualHands(state)).toEqual([]);
    expect(hasLegalManualReroll(state)).toBe(true);
    expect(validateAction(state, { type: 'MANUAL_REROLL', dieIds: [0] })).toBeNull();

    new Resolver(state, constant()).evaluate();
    expect(state.phase).toBe('round');
    expect(state.lives).toBe(3);
    expect(state.bust).toBeNull();
  });

  it('does not consume Bottled Fairy until no legal Flywheel reroll remains', () => {
    const state = deadFlywheelBoard('fairy-free-flywheel', true);
    new Resolver(state, constant()).evaluate();
    expect(state.specialOfferEffects.bottledFairyTriggeredThisRound).toBe(false);
    expect(state.manualRerollsRemaining).toBe(0);

    effectRuntime(state.dieRoundState[0], effectOf(rosterDice(state)[0], 'flywheel'))!.invocationsRemaining = 0;
    expect(hasLegalManualReroll(state)).toBe(false);
    new Resolver(state, constant()).evaluate();
    expect(state.specialOfferEffects.bottledFairyTriggeredThisRound).toBe(true);
    expect(state.manualRerollsRemaining).toBe(state.infernoRewards.upgrades.manualRerolls);
  });

  it('allows a Tightrope Round to use Flywheel at zero normal and Care Package resources', () => {
    const state = game('tightrope-flywheel');
    equip(state, 0, [['flywheel', 1]]);
    state.bossSchedule[state.round] = 'tightrope';
    new Resolver(state, constant(.4)).startRound();

    expect(state.boss?.type).toBe('tightrope');
    expect(state.manualRerollsRemaining).toBe(0);
    expect(state.specialOfferEffects.carePackageRerolls).toBe(0);
    expect(validateAction(state, { type: 'MANUAL_REROLL', dieIds: [0] })).toBeNull();
    expect(hasLegalManualReroll(state)).toBe(true);
  });
});

describe('Lightning Strike canonical manual-batch outcomes', () => {
  it('scores the original manual landing before Jumping Bean follow-up Rolls', () => {
    const state = game('lightning-bean');
    own(state, 'lightningStrike');
    const die = rosterDice(state)[0];
    die.value = 6;
    die.effects = [createDieEffect(die.id, 'jumpingBean', 1)];
    die.effects[0].persistent.jumpingBeanNumber = 1;
    syncActiveDiceProjection(state);
    state.dieRoundState = resetDieRoundState(rosterDice(state));

    const result = dispatch(state, { type: 'ACTIVATE_LIGHTNING_STRIKE', predictions: [
      { dieId: die.id, outcome: { kind: 'rank', rank: 1 } },
    ] }, sequence(0, .3));
    expect(result.error).toBeUndefined();
    expect(activeFace(rosterDice(result.state)[0]).rank).toBe(2);
    expect(result.state.chargeXMult).toBe(3);
    const batches = result.state.historyV2.filter(event => event.kind === 'roll_batch').slice(-2);
    expect(batches.map(event => event.kind === 'roll_batch' ? [event.reason, event.results[0].afterFace] : null))
      .toEqual([['manual', 1], ['jumping_bean_followup', 2]]);
    expect(result.state.historyV2.find(event => event.kind === 'flame_action' && event.flame === 'lightningStrike'))
      .toMatchObject({ action: { type: 'lightning_strike', predictions: [{ actualOutcome: { kind: 'rank', rank: 1 }, hit: true }] } });
  });

  it('compounds independent hits on a zero-resource all-Flywheel action without duplicating the batch', () => {
    const state = game('lightning-flywheel', [1, 1, 3, 4, 5]);
    own(state, 'lightningStrike');
    equip(state, 0, [['flywheel', 1]]);
    rosterDice(state)[1].effects = [createDieEffect(1, 'flywheel', 1)];
    state.dieRoundState = resetDieRoundState(rosterDice(state));
    state.manualRerollsRemaining = 0;
    state.specialOfferEffects.carePackageRerolls = 0;

    const result = dispatch(state, { type: 'ACTIVATE_LIGHTNING_STRIKE', predictions: [
      { dieId: 0, outcome: { kind: 'rank', rank: 2 } },
      { dieId: 1, outcome: { kind: 'rank', rank: 2 } },
    ] }, constant(0));
    expect(result.error).toBeUndefined();
    expect(result.state.chargeXMult).toBe(5);
    expect(result.state.chargeEvents.filter(event => event.sourceFlame === 'lightningStrike')).toHaveLength(2);
    expect(result.state.stats.manualRerollActions).toBe(1);
    expect(result.state.stats.manualDiceRerolled).toBe(2);
    expect(result.state.stats.manualRerolls.at(-1)).toMatchObject({ charges: 0, flywheelDieIds: [0, 1] });
    expect(result.state.historyV2.filter(event => event.kind === 'roll_batch' && event.reason === 'manual')).toHaveLength(1);
    expect([flywheelUses(result.state, 0), flywheelUses(result.state, 1)]).toEqual([0, 0]);
  });
});

describe('forced controller missing-rank safety', () => {
  it('keeps Magic armed and falls through to Clockwork when Magic cannot produce its rank', () => {
    const state = game('magic-clockwork-fallback');
    equip(state, 0, [['magic', 1], ['clockwork', 1]]);
    const die = rosterDice(state)[0];
    die.faces.forEach((face, index) => { face.rank = ([2, 2, 3, 3, 4, 4] as Rank[])[index]; });
    die.value = 1;
    const magic = effectRuntime(state.dieRoundState[die.id], effectOf(die, 'magic'))!;
    const clockwork = effectRuntime(state.dieRoundState[die.id], effectOf(die, 'clockwork'))!;
    magic.magicArmedFace = 6;

    new Resolver(state, constant()).manualReroll([die.id]);
    expect(manualBatch(state)?.results[0]).toMatchObject({ controller: 'clockworkDie', afterFace: 3 });
    expect(magic.magicArmedFace).toBe(6);
    expect(magic.invocationsRemaining).toBe(1);
    expect(clockwork.clockworkRolls).toBe(1);
  });

  it('chooses the first matching physical face deterministically for duplicate forced ranks', () => {
    const state = game('magic-duplicate-rank');
    equip(state, 0, [['magic', 1]]);
    const die = rosterDice(state)[0];
    die.faces.forEach((face, index) => { face.rank = ([2, 2, 3, 3, 4, 4] as Rank[])[index]; });
    die.value = 6;
    const magic = effectRuntime(state.dieRoundState[die.id], effectOf(die, 'magic'))!;
    magic.magicArmedFace = 2;

    new Resolver(state, constant(.9)).manualReroll([die.id]);
    expect(manualBatch(state)?.results[0]).toMatchObject({ controller: 'magicDie', afterPhysicalFace: 1, afterFace: 2 });
    expect(magic.magicArmedFace).toBeNull();
    expect(magic.invocationsRemaining).toBe(0);
  });

  it('does not consume Magnetic when a Flywheel-covered Chameleon die lacks the anchor rank', () => {
    const state = game('magnetic-missing-rank');
    equip(state, 0, [['chameleon', 1], ['flywheel', 1]]);
    const target = rosterDice(state)[0];
    target.faces.forEach((face, index) => { face.rank = ([2, 2, 3, 3, 4, 4] as Rank[])[index]; });
    target.value = 1;
    const anchor = rosterDice(state)[1];
    anchor.value = 6;
    anchor.effects = [createDieEffect(anchor.id, 'magnetic', 1)];
    syncActiveDiceProjection(state);
    state.dieRoundState = resetDieRoundState(rosterDice(state));
    state.manualRerollsRemaining = 0;
    const magnetic = effectRuntime(state.dieRoundState[anchor.id], effectOf(anchor, 'magnetic'))!;

    new Resolver(state, constant()).manualReroll([target.id]);
    expect(manualBatch(state)?.results[0]).toMatchObject({ controller: 'rng', afterFace: 2 });
    expect(magnetic.invocationsRemaining).toBe(1);
    expect(flywheelUses(state, 0)).toBe(0);
  });

  it('falls through from an unavailable Clockwork rank to Tank without counting Clockwork', () => {
    const state = game('clockwork-tank-fallback');
    equip(state, 0, [['clockwork', 1], ['tank', 1]]);
    const die = rosterDice(state)[0];
    die.faces.forEach((face, index) => { face.rank = ([1, 2, 3, 4, 4, 6] as Rank[])[index]; });
    die.value = 4;
    const clockwork = effectRuntime(state.dieRoundState[die.id], effectOf(die, 'clockwork'))!;

    new Resolver(state, constant()).manualReroll([die.id]);
    expect(manualBatch(state)?.results[0]).toMatchObject({ controller: 'tank', afterFace: 4, intercepted: true });
    expect(clockwork.clockworkRolls).toBe(0);
  });

  it('does not consume Magic when Snake Eyes removed the armed rank', () => {
    const state = game('snake-eyes-magic');
    equip(state, 0, [['magic', 1]]);
    const die = rosterDice(state)[0];
    die.faces[5] = { rank: 1, bossMutation: { kind: 'snakeEyes', originalRank: 6 } };
    die.value = 1;
    const magic = effectRuntime(state.dieRoundState[die.id], effectOf(die, 'magic'))!;
    magic.magicArmedFace = 6;

    new Resolver(state, constant()).manualReroll([die.id]);
    expect(manualBatch(state)?.results[0].controller).toBe('rng');
    expect(magic.magicArmedFace).toBe(6);
    expect(magic.invocationsRemaining).toBe(1);
  });
});

describe('boss mercy boundaries', () => {
  it('delays Magician final-opportunity correction while another free Flywheel action remains', () => {
    const state = game('magician-flywheel-mercy', [1, 2, 3, 4, 5]);
    state.boss = createBossRuntime(state.seed, state.round, 'magician', {
      playerDieIds: rosterDice(state).map(die => die.id), handPlayCounts: state.handPlayCounts,
    });
    if (state.boss.type !== 'magician') throw new Error('Expected Magician.');
    Object.assign(state.boss, { returned: true, missingDieId: null,
      calledHands: ['sixes', 'fives', 'fours'], completedHands: [] });
    equip(state, 0, [['flywheel', 2]]);
    state.consumed = HAND_IDS.filter(hand => hand !== 'sixes');
    state.manualRerollsRemaining = 0;
    state.specialOfferEffects.carePackageRerolls = 0;
    expect(currentlyPlayableManualHands(state)).toEqual([]);

    const first = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0));
    expect(activeFace(rosterDice(first.state)[0]).rank).toBe(2);
    expect(flywheelUses(first.state, 0)).toBe(1);
    expect(first.state.phase).toBe('round');

    const final = dispatch(first.state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0));
    expect(activeFace(rosterDice(final.state)[0]).rank).toBe(6);
    expect(flywheelUses(final.state, 0)).toBe(0);
  });
});

describe('Curtain Call committed Manual Reroll completion', () => {
  function curtainState(seed: string, withFlywheel: boolean): GameState {
    const state = game(seed, [1, 2, 3, 4, 5]);
    state.target = 1n;
    state.stats.rounds.at(-1)!.target = state.target;
    equip(state, 0, withFlywheel ? [['freePlay', 1], ['flywheel', 1]] : [['freePlay', 1]]);
    rosterDice(state)[0].value = 1;
    syncActiveDiceProjection(state);
    return state;
  }

  it('spends the committed resource and resolves the die after Curtain Call clears the Round', () => {
    const state = curtainState('curtain-committed-paid', false);
    own(state, 'thirdRail');
    const before = state.manualRerollsRemaining;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(.25));

    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('roundSummary');
    expect(result.state.manualRerollsRemaining).toBe(before - 1);
    expect(activeFace(rosterDice(result.state)[0]).rank).toBe(3);
    expect(result.state.stats.flameTriggers.thirdRail).toBe(1);
    expect(result.state.chargeXMult).toBe(1.25);
    expect(result.state.stats.manualRerollActions).toBe(1);
    expect(result.state.historyV2.filter(event => event.kind === 'roll_batch' && event.reason === 'manual')).toHaveLength(1);
    expect(result.state.historyV2.filter(event => event.kind === 'round_attempt_finished')).toHaveLength(1);
  });

  it('consumes Flywheel and lets Lightning evaluate the committed manual result after the clear', () => {
    const state = curtainState('curtain-lightning-flywheel', true);
    own(state, 'lightningStrike');
    state.manualRerollsRemaining = 0;
    state.specialOfferEffects.carePackageRerolls = 0;
    const result = dispatch(state, { type: 'ACTIVATE_LIGHTNING_STRIKE', predictions: [
      { dieId: 0, outcome: { kind: 'rank', rank: 2 } },
    ] }, constant(0));

    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe('roundSummary');
    expect(activeFace(rosterDice(result.state)[0]).rank).toBe(2);
    expect(flywheelUses(result.state, 0)).toBe(0);
    expect(result.state.stats.manualRerolls.at(-1)).toMatchObject({ charges: 0, flywheelDieIds: [0] });
    expect(result.state.chargeXMult).toBe(3);
    expect(result.state.historyV2.find(event => event.kind === 'flame_action' && event.flame === 'lightningStrike'))
      .toMatchObject({ action: { type: 'lightning_strike', predictions: [{ actualOutcome: { kind: 'rank', rank: 2 }, hit: true }] } });
    expect(result.state.historyV2.filter(event => event.kind === 'round_attempt_finished')).toHaveLength(1);
  });
});
