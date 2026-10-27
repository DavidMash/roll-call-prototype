import { describe, expect, it } from 'vitest';
import { activeFace, createCollectibleDie } from './dice';
import { generateDiceOfferTypes } from './diceEconomy';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { dieForgeRating } from './forge';
import { planQualification } from './hands';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { summarizeRunHistoryV2 } from './runHistoryV2Summary';
import { resolvedDiePipsContributions } from './scoring';
import {
  createDieEffect, effectOf, effectRuntime, resetDieRoundState, SHOP_SPECIAL_DIE_TYPES, SPECIAL_DICE,
} from './specialDice';
import type { GameState, RandomSource, Rank, SpecialDieType } from './types';

const constant = (value = .99): RandomSource => ({ next: () => value });

function game(ranks: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const state = newRun('post-base-pips-balance', constant()).state;
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
  state.consumed = [];
  ranks.forEach((rank, index) => { state.diceInventory.instances[index].value = rank; });
  syncActiveDiceProjection(state);
  return state;
}

function setEffects(state: GameState, dieId: number, effects: Array<[SpecialDieType, number]>) {
  const die = state.diceInventory.instances[dieId];
  die.effects = effects.map(([type, level]) => createDieEffect(dieId, type, level));
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  syncActiveDiceProjection(state);
  return die;
}

const pips = (state: GameState) => {
  const event = [...state.historyV2].reverse().find(item => item.kind === 'hand_scored');
  return event?.kind === 'hand_scored' ? event.score.finalPips : null;
};

describe('post-Base-Pips Pips balance', () => {
  it.each([[1, 4], [2, 8], [3, 12]] as const)('gives Bonus %i +%i Pips per Score', (level, bonus) => {
    const state = game([6, 2, 3, 4, 5]);
    setEffects(state, 0, [['bonus', level]]);
    new Resolver(state, constant()).play('sixes', [0]);
    expect(pips(state)).toBe(6 + bonus);
  });

  it('applies Bonus on every Score occurrence while preserving the physical face', () => {
    const state = game([4, 2, 3, 5, 6]);
    setEffects(state, 0, [['bonus', 2], ['conjoined', 1]]);
    const plan = planQualification(rosterDice(state), 'pair', [0], { roundState: state.dieRoundState });
    const result = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0], qualificationClaims: plan.resourceClaims }, constant()).state;
    const event = [...result.historyV2].reverse().find(item => item.kind === 'hand_scored');
    expect(event?.kind === 'hand_scored' ? event.scoreOccurrences : []).toHaveLength(2);
    expect(event?.kind === 'hand_scored' ? event.score.finalPips : null).toBe(24);
    expect(event?.kind === 'hand_scored' ? event.pipsContributions
      .filter(item => item.effectType === 'bonus').map(item => item.amount) : []).toEqual([8, 8]);
  });

  it('leaves Workout at +2 future Pips per level and lets setup overtake Bonus', () => {
    const state = game([6, 2, 3, 4, 5]);
    const workout = setEffects(state, 0, [['workout', 1]]);
    const runtime = effectRuntime(state.dieRoundState[0], effectOf(workout, 'workout'))!;
    expect(runtime.temporaryPips).toBe(0);
    runtime.temporaryPips = 6; // Three prior Score occurrences at +2 each.
    const workoutPips = resolvedDiePipsContributions({ id: 0, face: activeFace(workout), role: 'selected' }, 1,
      { die: workout, runtime: state.dieRoundState[0], selectedDice: [workout], playSource: 'manual' })
      .reduce((sum, part) => sum + part.amount, 0);
    const bonusState = game([6, 2, 3, 4, 5]);
    const bonus = setEffects(bonusState, 0, [['bonus', 1]]);
    const bonusPips = resolvedDiePipsContributions({ id: 0, face: activeFace(bonus), role: 'selected' }, 1,
      { die: bonus, runtime: bonusState.dieRoundState[0], selectedDice: [bonus], playSource: 'manual' })
      .reduce((sum, part) => sum + part.amount, 0);
    expect(workoutPips).toBe(12);
    expect(bonusPips).toBe(10);
  });

  it('grows Tank by 5 Pips per level after Scores and qualifying reroll attempts', () => {
    const state = game([6, 2, 3, 4, 5]);
    const tank = setEffects(state, 0, [['tank', 2]]);
    const runtime = effectRuntime(state.dieRoundState[0], effectOf(tank, 'tank'))!;
    new Resolver(state, constant()).play('sixes', [0]);
    // One Score and the canonical post-Play attempted Roll each add +10; the current Score used the pre-growth value.
    expect(pips(state)).toBe(6);
    expect(runtime.temporaryPips).toBe(20);
    new Resolver(state, constant()).manualReroll([0]);
    expect(runtime.temporaryPips).toBe(30);
  });

  it('advances Tank once per duplicate Score occurrence without adding a cap', () => {
    const state = game([4, 2, 3, 5, 6]);
    const tank = setEffects(state, 0, [['tank', 1], ['conjoined', 1]]);
    const plan = planQualification(rosterDice(state), 'pair', [0], { roundState: state.dieRoundState });
    new Resolver(state, constant()).play('pair', [0], 'manual', null, plan.resourceClaims);
    // Two Score occurrences plus the post-Play attempted Roll.
    expect(effectRuntime(state.dieRoundState[0], effectOf(tank, 'tank'))!.temporaryPips).toBe(15);
  });

  it('resets accumulated Tank Pips at Round reset', () => {
    const state = game([6, 2, 3, 4, 5]);
    const tank = setEffects(state, 0, [['tank', 3]]);
    effectRuntime(state.dieRoundState[0], effectOf(tank, 'tank'))!.temporaryPips = 75;
    expect(effectRuntime(resetDieRoundState(rosterDice(state))[0], effectOf(tank, 'tank'))!.temporaryPips).toBe(0);
  });
});

describe('Team Player additive networks', () => {
  function contribution(levels: number[], subject: number, subjectEffects: Array<[SpecialDieType, number]> = []) {
    const state = game([2, 2, 2, 4, 5]);
    levels.forEach((level, index) => setEffects(state, index, [['teamPlayer', level]]));
    if (subjectEffects.length) setEffects(state, subject, subjectEffects);
    const selected = levels.map((_, index) => state.diceInventory.instances[index]);
    if (!selected.some(die => die.id === subject)) selected.push(state.diceInventory.instances[subject]);
    const die = state.diceInventory.instances[subject];
    return resolvedDiePipsContributions({ id: subject, face: activeFace(die), role: 'selected' }, selected.length,
      { die, runtime: state.dieRoundState[subject], selectedDice: selected, playSource: 'manual' });
  }

  it('adds levels for ordinary dice instead of multiplying Team Player factors', () => {
    expect(contribution([1], 2).reduce((sum, part) => sum + part.amount, 0)).toBe(4);
    expect(contribution([1, 1], 2).reduce((sum, part) => sum + part.amount, 0)).toBe(6);
    expect(contribution([2, 1], 2).reduce((sum, part) => sum + part.amount, 0)).toBe(8);
  });

  it('lets Team Players benefit from the others but never themselves', () => {
    expect(contribution([1, 1], 0).reduce((sum, part) => sum + part.amount, 0)).toBe(4);
    expect(contribution([2, 1], 0).reduce((sum, part) => sum + part.amount, 0)).toBe(4);
    expect(contribution([2, 1], 1).reduce((sum, part) => sum + part.amount, 0)).toBe(6);
  });

  it('amplifies the complete Basic and Bonus die contribution additively', () => {
    expect(contribution([1, 1], 2, [['basic', 2], ['bonus', 1]])
      .reduce((sum, part) => sum + part.amount, 0)).toBe(24);
  });

  it('applies the additive network independently to repeated Score occurrences', () => {
    const state = game([4, 4, 2, 3, 5]);
    setEffects(state, 0, [['teamPlayer', 1]]);
    setEffects(state, 1, [['doubleTime', 1]]);
    new Resolver(state, constant(0)).play('fours', [0, 1]);
    const event = [...state.historyV2].reverse().find(item => item.kind === 'hand_scored');
    expect(event?.kind === 'hand_scored' ? event.scoreOccurrences.filter(item => item.dieId === 1) : []).toHaveLength(2);
    expect(event?.kind === 'hand_scored' ? event.pipsContributions
      .filter(item => item.source === 'team_player' && item.dieId === 1).map(item => item.amount) : []).toEqual([4, 4]);
  });
});

describe('Sustainable selected-participant requirement', () => {
  it('preserves a Hand when Sustainable was actually selected', () => {
    const state = game([1, 2, 3, 4, 5]);
    const die = setEffects(state, 0, [['sustainable', 1]]);
    new Resolver(state, constant()).play('ones', [0]);
    expect(state.consumed).not.toContain('ones');
    expect(effectRuntime(state.dieRoundState[0], effectOf(die, 'sustainable'))!.invocationsRemaining).toBe(0);
  });

  it('does not preserve a Hand when Sustainable participates only through Hitchhiker', () => {
    const state = game([1, 2, 3, 4, 5]);
    const die = setEffects(state, 1, [['hitchhiker', 1], ['sustainable', 1]]);
    new Resolver(state, constant()).play('ones', [0]);
    expect(state.consumed).toContain('ones');
    expect(pips(state)).toBe(3);
    expect(effectRuntime(state.dieRoundState[1], effectOf(die, 'hitchhiker'))!.invocationsRemaining).toBe(0);
    expect(effectRuntime(state.dieRoundState[1], effectOf(die, 'sustainable'))!.invocationsRemaining).toBe(1);
  });
});

describe('Furnace Pip reserve', () => {
  it.each([[1, 15], [2, 30], [3, 45]] as const)('fully feeds Furnace %i to %i reserve Pips', (level, reserve) => {
    const state = game();
    state.gold = 100;
    const die = setEffects(state, 0, [['furnace', level]]);
    const fed = dispatch(state, { type: 'FEED_FURNACE', dieId: 0, amount: 5 }, constant()).state;
    expect(effectRuntime(fed.dieRoundState[0], effectOf(die, 'furnace'))!.furnacePips).toBe(reserve);
  });

  it.each([1, 2, 3, 4, 5])('turns %i Gold into direct level-scaled reserve Pips', amount => {
    const state = game();
    state.gold = 100;
    const die = setEffects(state, 0, [['furnace', 2]]);
    const result = dispatch(state, { type: 'FEED_FURNACE', dieId: 0, amount }, constant());
    const runtime = effectRuntime(result.state.dieRoundState[0], effectOf(die, 'furnace'))!;
    expect(result.error).toBeUndefined();
    expect(result.state.gold).toBe(100 - amount);
    expect(runtime.furnaceGoldFed).toBe(amount);
    expect(runtime.furnacePips).toBe(amount * 6);
  });

  it('scores with the current reserve, then burns exactly one Pip after the Play', () => {
    const state = game([6, 2, 3, 4, 5]);
    state.gold = 5;
    setEffects(state, 0, [['furnace', 1]]);
    const fed = dispatch(state, { type: 'FEED_FURNACE', dieId: 0, amount: 5 }, constant()).state;
    new Resolver(fed, constant()).play('sixes', [0]);
    expect(pips(fed)).toBe(21);
    expect(effectRuntime(fed.dieRoundState[0], effectOf(fed.diceInventory.instances[0], 'furnace'))!.furnacePips).toBe(14);
  });

  it('burns once after manual and Free Plays even when Furnace does not participate', () => {
    const state = game([6, 2, 3, 4, 5]);
    const die = setEffects(state, 0, [['furnace', 1]]);
    const runtime = effectRuntime(state.dieRoundState[0], effectOf(die, 'furnace'))!;
    runtime.furnacePips = 3;
    new Resolver(state, constant()).play('twos', [1]);
    expect(runtime.furnacePips).toBe(2);
    new Resolver(state, constant()).play('threes', [2], 'freePlay');
    expect(runtime.furnacePips).toBe(1);
  });

  it.each(['conjoined', 'doubleTime', 'loneWolf'] as const)('does not burn extra reserve for %s Score occurrences', effect => {
    const state = game([4, 2, 3, 5, 6]);
    const die = setEffects(state, 0, [['furnace', 1], [effect, 1]]);
    const runtime = effectRuntime(state.dieRoundState[0], effectOf(die, 'furnace'))!;
    runtime.furnacePips = 15;
    if (effect === 'conjoined') {
      const plan = planQualification(rosterDice(state), 'pair', [0], { roundState: state.dieRoundState });
      new Resolver(state, constant()).play('pair', [0], 'manual', null, plan.resourceClaims);
    } else new Resolver(state, constant()).play('fours', [0]);
    expect(runtime.furnacePips).toBe(14);
  });

  it('never decays below zero and resets the feed lifecycle next Round', () => {
    const state = game([1, 2, 3, 4, 5]);
    const die = setEffects(state, 0, [['furnace', 1]]);
    const runtime = effectRuntime(state.dieRoundState[0], effectOf(die, 'furnace'))!;
    runtime.furnacePips = 1; runtime.furnaceGoldFed = 5;
    new Resolver(state, constant()).play('twos', [1]);
    expect(runtime.furnacePips).toBe(0);
    const reset = resetDieRoundState(rosterDice(state));
    expect(effectRuntime(reset[0], effectOf(die, 'furnace'))).toMatchObject({ furnacePips: 0, furnaceGoldFed: 0 });
  });

  it('keeps the five-Gold feed maximum', () => {
    const state = game();
    state.gold = 100;
    setEffects(state, 0, [['furnace', 1]]);
    const result = dispatch(state, { type: 'FEED_FURNACE', dieId: 0, amount: 6 }, constant());
    expect(result.error).toMatch(/at most 5 Gold/i);
    expect(result.state.gold).toBe(100);
  });
});

describe('independent die economy metadata and offers', () => {
  it('locks the repriced catalog without coupling rarity, salvage, or Forge weight', () => {
    expect(SPECIAL_DICE.flywheel).toMatchObject({ rarity: 'uncommon', purchasePrice: 10, componentSalvage: 5, forgeBaseWeight: 3 });
    expect(SPECIAL_DICE.missingLink).toMatchObject({ rarity: 'rare', purchasePrice: 20, componentSalvage: 15, forgeBaseWeight: 5 });
    expect(SPECIAL_DICE.jackpot).toMatchObject({ rarity: 'uncommon', purchasePrice: 15, componentSalvage: 10, forgeBaseWeight: 3 });
    expect(SPECIAL_DICE.vintage).toMatchObject({ rarity: 'common', purchasePrice: 15, componentSalvage: 5, forgeBaseWeight: 2 });
    expect(SPECIAL_DICE.golden).toMatchObject({ rarity: 'common', purchasePrice: 15, componentSalvage: 5, forgeBaseWeight: 2 });
    expect(SPECIAL_DICE.mirror).toMatchObject({ rarity: 'rare', purchasePrice: 20, componentSalvage: 15, forgeBaseWeight: 5 });
    expect(SPECIAL_DICE.clockwork).toMatchObject({ rarity: 'common', purchasePrice: 15, componentSalvage: 5, forgeBaseWeight: 2 });
    expect(SPECIAL_DICE.chameleon).toMatchObject({ rarity: 'rare', purchasePrice: 30, componentSalvage: 10, forgeBaseWeight: 3 });
    expect(dieForgeRating(createCollectibleDie(20, 'flywheel'))).toBe(3n);
    expect(dieForgeRating(createCollectibleDie(21, 'chameleon'))).toBe(3n);
    expect(dieForgeRating(createCollectibleDie(22, 'golden'))).toBe(2n);
    expect(dieForgeRating(createCollectibleDie(23, 'vintage'))).toBe(2n);
  });

  it('moves only Chameleon between rarity pools', () => {
    const pool = (rarity: 'common' | 'uncommon' | 'rare') => SHOP_SPECIAL_DIE_TYPES
      .filter(type => SPECIAL_DICE[type].rarity === rarity);
    expect(pool('common')).toEqual(['bonus', 'workout', 'vintage', 'golden', 'weighted', 'clockwork']);
    expect(pool('uncommon')).toEqual(['hitchhiker', 'magnetic', 'jackpot', 'flywheel']);
    expect(pool('rare')).toEqual(['chameleon', 'teamPlayer', 'loneWolf', 'freePlay', 'tank', 'mirror',
      'missingLink', 'jumpingBean', 'furnace', 'sustainable']);
    expect(generateDiceOfferTypes(constant(.86), 1)[0]).toBe(pool('rare')[Math.floor(.86 * pool('rare').length)] ?? pool('rare')[0]);
  });

  it('summarizes offers, purchases, roster placement, and scoring participation by effect', () => {
    const state = newRun('special-die-telemetry', constant(0)).state;
    state.target = 1_000_000n; state.stats.rounds.at(-1)!.target = state.target;
    new Resolver(state, constant(0)).openShop();
    const offer = state.shop!.offers[0];
    expect(offer.dieType).toBe('bonus');
    state.gold = 100;
    let next = dispatch(state, { type: 'BUY_DIE', offerId: offer.id }, constant(0)).state;
    const specialId = next.diceInventory.storage[0]!;
    next = dispatch(next, { type: 'MOVE_DIE', source: { area: 'storage', index: 0 }, destination: { area: 'roster', index: 0 },
      expectedSourceDieId: specialId, expectedDestinationDieId: next.diceInventory.roster[0] }, constant(0)).state;
    next.diceInventory.instances[specialId].value = 1;
    syncActiveDiceProjection(next);
    new Resolver(next, constant()).play('ones', [specialId]);
    const metric = summarizeRunHistoryV2(next.historyV2, next).experienced.specialDice.bonus!;
    expect(metric).toMatchObject({ offersShown: 3, purchases: 1, purchaseRate: 1 / 3,
      rosterPlacements: 1, scoringParticipations: 1 });
  });
});
