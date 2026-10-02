import { describe, expect, it } from 'vitest';
import { dispatch, newRun, validateAction } from './engine';
import {
  handFamilyFlameTargets, handFamilyFlameMultiplier, standardFlameMultiplier,
} from './flames';
import type { Flame, GameState, HandId, RandomSource, Rank } from './types';

const constant = (value = .8): RandomSource => ({ next: () => value });

function game(values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const state = newRun('hand-family-flames', constant()).state;
  state.target = 1_000_000;
  state.stats.rounds[0].target = state.target;
  setValues(state, values);
  return state;
}

function setValues(state: GameState, values: Rank[]): void {
  values.forEach((value, index) => { state.dice[index].value = value; });
}

function attach(state: GameState, id: Flame, investedGold = 50): void {
  state.dice[0].flame = { id, investedGold };
}

function play(state: GameState, hand: HandId, dieIds: number[]): GameState {
  const result = dispatch(state, { type: 'PLAY', hand, dieIds }, constant());
  expect(result.error).toBeUndefined();
  return result.state;
}

const sequences = [
  { id: 'doubleDown', setup: 'pair', setupValues: [2, 2, 3, 4, 5], setupIds: [0, 1], payoff: 'twoPair', payoffValues: [2, 2, 3, 3, 5], payoffIds: [0, 1, 2, 3] },
  { id: 'threesCompany', setup: 'threeKind', setupValues: [2, 2, 2, 4, 5], setupIds: [0, 1, 2], payoff: 'fullHouse', payoffValues: [2, 2, 2, 3, 3], payoffIds: [0, 1, 2, 3, 4] },
  { id: 'straightShooter', setup: 'smallStraight', setupValues: [1, 2, 3, 4, 6], setupIds: [0, 1, 2, 3], payoff: 'largeStraight', payoffValues: [1, 2, 3, 4, 5], payoffIds: [0, 1, 2, 3, 4] },
  { id: 'boxSet', setup: 'fourKind', setupValues: [2, 2, 2, 2, 5], setupIds: [0, 1, 2, 3], payoff: 'fiveKind', payoffValues: [2, 2, 2, 2, 2], payoffIds: [0, 1, 2, 3, 4] },
] as const;

describe('hand-family setup and payoff Flames', () => {
  it.each(sequences)('$id moves setup → payoff → spent and rewards only the payoff once', sequence => {
    let state = game([...sequence.setupValues] as Rank[]);
    attach(state, sequence.id);
    state.handFamilyFlameStages[sequence.id] = 'setup';
    expect(handFamilyFlameTargets(state)).toContain(sequence.setup);

    state = play(state, sequence.setup, [...sequence.setupIds]);
    expect(state.stats.handScores.at(-1)!.xMultFactors.some(factor => factor.source === sequence.id)).toBe(false);
    expect(state.handFamilyFlameStages[sequence.id]).toBe('payoff');
    expect(handFamilyFlameTargets(state)).toContain(sequence.payoff);

    setValues(state, [...sequence.payoffValues] as Rank[]);
    state = play(state, sequence.payoff, [...sequence.payoffIds]);
    expect(state.stats.handScores.at(-1)!.xMultFactors).toContainEqual(expect.objectContaining({
      source: sequence.id, value: 5, dieId: 0,
    }));
    expect(state.handFamilyFlameStages[sequence.id]).toBe('spent');
    expect(handFamilyFlameTargets(state)).not.toContain(sequence.payoff);

    if (state.boss?.type === 'marathon') throw new Error('Unexpected Marathon fixture');
    state.consumed = state.consumed.filter(hand => hand !== sequence.payoff);
    setValues(state, [...sequence.payoffValues] as Rank[]);
    state = play(state, sequence.payoff, [...sequence.payoffIds]);
    expect(state.stats.handScores.at(-1)!.xMultFactors.some(factor => factor.source === sequence.id)).toBe(false);
  });

  it.each(sequences)('$id ignores a payoff played before setup', sequence => {
    const state = game([...sequence.payoffValues] as Rank[]);
    attach(state, sequence.id, 100);
    state.handFamilyFlameStages[sequence.id] = 'setup';
    const result = play(state, sequence.payoff, [...sequence.payoffIds]);
    expect(result.stats.handScores.at(-1)!.xMultFactors.some(factor => factor.source === sequence.id)).toBe(false);
    expect(result.handFamilyFlameStages[sequence.id]).toBe('setup');
  });

  it('requires Ember participation to spend the payoff but makes a Bonfire global', () => {
    let ember = game([6, 2, 2, 3, 3]);
    attach(ember, 'doubleDown', 100);
    ember.handFamilyFlameStages.doubleDown = 'payoff';
    ember = play(ember, 'twoPair', [1, 2, 3, 4]);
    expect(ember.stats.handScores.at(-1)!.xMultFactors.some(factor => factor.source === 'doubleDown')).toBe(false);
    expect(ember.handFamilyFlameStages.doubleDown).toBe('payoff');

    const bonfire = game([6, 2, 2, 3, 3]);
    bonfire.bonfires = ['doubleDown'];
    bonfire.handFamilyFlameStages.doubleDown = 'payoff';
    const paid = play(bonfire, 'twoPair', [1, 2, 3, 4]);
    expect(paid.stats.handScores.at(-1)!.xMultFactors).toContainEqual(expect.objectContaining({
      source: 'doubleDown', value: 9, dieId: null,
    }));
    expect(paid.handFamilyFlameStages.doubleDown).toBe('spent');
  });

  it('lets Marathon return an early payoff after the setup arms it', () => {
    let state = game([2, 2, 3, 3, 5]);
    attach(state, 'doubleDown', 100);
    state.handFamilyFlameStages.doubleDown = 'setup';
    state.boss = { type: 'marathon', cooldowns: {} };

    state = play(state, 'twoPair', [0, 1, 2, 3]);
    expect(state.handFamilyFlameStages.doubleDown).toBe('setup');
    setValues(state, [2, 2, 3, 4, 5]);
    state = play(state, 'pair', [0, 1]);
    expect(state.handFamilyFlameStages.doubleDown).toBe('payoff');

    for (const [index, hand] of (['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as HandId[]).entries()) {
      const rank = (index + 1) as Rank;
      setValues(state, [rank, 2, 3, 4, 5]);
      state = play(state, hand, [0]);
    }
    expect(state.boss?.type === 'marathon' ? state.boss.cooldowns.twoPair : undefined).toBeUndefined();
    setValues(state, [2, 2, 3, 3, 5]);
    state = play(state, 'twoPair', [0, 1, 2, 3]);
    expect(state.stats.handScores.at(-1)!.xMultFactors).toContainEqual(expect.objectContaining({ source: 'doubleDown', value: 9 }));
    expect(state.handFamilyFlameStages.doubleDown).toBe('spent');
  });

  it('resets every owned sequence to its setup marker at the next Round', () => {
    const state = game();
    attach(state, 'boxSet', 100);
    state.handFamilyFlameStages.boxSet = 'spent';
    state.phase = 'shop';
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    const next = dispatch(state, { type: 'NEXT_ROUND' }, constant()).state;
    expect(next.handFamilyFlameStages).toEqual({ boxSet: 'setup' });
    expect(handFamilyFlameTargets(next)).toContain('fourKind');
  });
});

describe('Missing Pair and One Short', () => {
  it.each([
    ['missingPair', 'pair', [2, 2, 3, 4, 5], [0, 1]],
    ['missingPair', 'threeKind', [2, 2, 2, 4, 5], [0, 1, 2]],
    ['oneShort', 'smallStraight', [1, 2, 3, 4, 6], [0, 1, 2, 3]],
    ['oneShort', 'fourKind', [2, 2, 2, 2, 5], [0, 1, 2, 3]],
  ] as const)('%s gives its static scaling to %s with Ember participation', (id, hand, values, dieIds) => {
    const state = game([...values] as Rank[]);
    attach(state, id, 50);
    const result = play(state, hand, [...dieIds]);
    expect(result.stats.handScores.at(-1)!.xMultFactors).toContainEqual(expect.objectContaining({ source: id, value: 3, dieId: 0 }));
    expect(handFamilyFlameTargets(result)).toEqual([]);
  });

  it('requires the static Flame die before Bonfire and applies globally afterward', () => {
    let ember = game([6, 2, 2, 3, 4]);
    attach(ember, 'missingPair', 100);
    ember = play(ember, 'pair', [1, 2]);
    expect(ember.stats.handScores.at(-1)!.xMultFactors.some(factor => factor.source === 'missingPair')).toBe(false);

    const bonfire = game([6, 2, 2, 3, 4]);
    bonfire.bonfires = ['missingPair'];
    const result = play(bonfire, 'pair', [1, 2]);
    expect(result.stats.handScores.at(-1)!.xMultFactors).toContainEqual(expect.objectContaining({ source: 'missingPair', value: 5, dieId: null }));
    expect(standardFlameMultiplier(0)).toBe(1);
    expect(standardFlameMultiplier(100)).toBe(5);
    expect(handFamilyFlameMultiplier(0)).toBe(1);
    expect(handFamilyFlameMultiplier(100)).toBe(9);
  });

  it.each(['missingPair', 'oneShort'] as const)('%s participates in selection uniqueness and Bonfire lifecycle', id => {
    let state = game();
    state.phase = 'flameSelection';
    state.flameSelection = { offers: [{ id: 90, flame: id }], acquired: false };
    state = dispatch(state, { type: 'CHOOSE_FLAME', offerId: 90, dieId: 0 }, constant()).state;
    expect(state.dice[0].flame).toEqual({ id, investedGold: 0 });

    state.phase = 'flameSelection';
    state.flameSelection = { offers: [{ id: 91, flame: id }], acquired: false };
    expect(validateAction(state, { type: 'CHOOSE_FLAME', offerId: 91, dieId: 1 })).toContain('already owned');

    state.phase = 'shop';
    state.flameSelection = null;
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    state.gold = 100;
    state = dispatch(state, { type: 'STOKE_FLAME', dieId: 0, amount: 100 }, constant()).state;
    expect(state.dice[0].flame).toBeNull();
    expect(state.bonfires).toContain(id);
    expect(state.stats.bonfiresCreated.at(-1)).toEqual({ round: 1, flame: id });
  });
});
