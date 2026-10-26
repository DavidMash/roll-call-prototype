import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { Resolver } from './effects';
import { dispatch, newRun } from './engine';
import {
  captureHandStart, countPlayedDiceWithActiveEffects, fatCatMultiplier, handXMultContributions,
  lowballPlayedDiceCounts, placeFlameInstance, vineyardMultiplier,
} from './flames';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { createDieEffect } from './specialDice';
import type { Flame, GameState, RandomSource, Rank, SpecialDieType } from './types';

const constant = (value = .8): RandomSource => ({ next: () => value });

function game(values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const state = newRun('flame-update-pass-1', constant()).state;
  values.forEach((value, index) => { state.dice[index].value = value; });
  state.target = 1_000_000n;
  state.stats.rounds[0].target = state.target;
  return state;
}

function ownFlame(state: GameState, id: Flame, investedGold = 100): void {
  placeFlameInstance(state, id, investedGold);
}

function addEffects(state: GameState, dieIndex: number, effects: SpecialDieType[]): void {
  const die = rosterDice(state)[dieIndex];
  die.effects = effects.map(type => createDieEffect(die.id, type));
  syncActiveDiceProjection(state);
}

function factor(state: GameState) {
  return state.stats.handScores.at(-1)?.xMultFactors.find(item => item.source !== 'charge');
}

describe('Minigun consecutive Upper streak', () => {
  it('spins up through the exact Bonfire sequence, caps, and includes Upper Free Plays', () => {
    const state = game([1, 2, 3, 4, 5]);
    ownFlame(state, 'minigun');
    const resolver = new Resolver(state, constant());
    for (let count = 0; count < 7; count++) resolver.play('ones', [0], 'jumpingBean');
    expect(state.stats.handScores.map(score => score.xMult)).toEqual([1.5, 2, 2.5, 3, 3.5, 4, 4]);
    expect(state.minigunUpperStreak).toBe(6);
  });

  it('resets on a Lower Play but not on rolls or scorecard refresh, and resets at Round start', () => {
    const state = game([1, 2, 3, 4, 5]);
    ownFlame(state, 'minigun');
    const resolver = new Resolver(state, constant());
    resolver.play('ones', [0], 'jumpingBean');
    resolver.play('twos', [1], 'jumpingBean');
    expect(state.minigunUpperStreak).toBe(2);
    resolver.rollBatch([0], 'non-Play action', 'gameplay');
    expect(state.minigunUpperStreak).toBe(2);

    state.scorecardCycleConsumed = ['twos', 'threes', 'fours', 'fives', 'sixes', 'pair', 'twoPair',
      'threeKind', 'fourKind', 'fiveKind', 'fullHouse', 'smallStraight', 'largeStraight'];
    state.consumed = [...state.scorecardCycleConsumed];
    state.dice[0].value = 1;
    const refreshed = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant()).state;
    expect(refreshed.scorecardCycleConsumed).toEqual([]);
    expect(refreshed.minigunUpperStreak).toBe(3);

    refreshed.dice[0].value = 2;
    refreshed.dice[1].value = 2;
    const lower = dispatch(refreshed, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant()).state;
    expect(lower.minigunUpperStreak).toBe(0);
    expect(lower.historyV2).toContainEqual(expect.objectContaining({
      kind: 'flame_runtime_changed', flame: 'minigun', change: 'streak_reset', reason: 'lower_play',
    }));

    lower.minigunUpperStreak = 4;
    lower.phase = 'shop';
    lower.shop = { stage: 'shop', offers: [], offerRerolls: 0, lifeRestores: 0 };
    new Resolver(lower, constant()).startRound();
    expect(lower.minigunUpperStreak).toBe(0);
  });
});

describe('Played-dice Flame predicates', () => {
  it.each([
    [[2], true, 1],
    [[2, 4], false, 1],
    [[2, 3], true, 2],
    [[1, 3, 6], true, 2],
    [[1, 3, 4, 6], false, 2],
    [[1, 2, 3, 6], true, 3],
    [[1, 2, 3, 5, 6], true, 3],
  ] as const)('Lowball uses a strict majority for %j', (values, qualifies, low) => {
    const state = game(values as unknown as Rank[]);
    const ids = values.map((_, index) => index);
    const counts = lowballPlayedDiceCounts(captureHandStart(state, 'ones', ids));
    expect(counts).toEqual({ played: values.length, low, qualifies });
  });

  it('Lowball ignores a non-Played Hitchhiker scorer and tops out at ×3.5', () => {
    const state = game([6, 2, 3, 4, 5]);
    ownFlame(state, 'lowball');
    addEffects(state, 1, ['hitchhiker']);
    const contributions = handXMultContributions(captureHandStart(state, 'sixes', [0]), 'sixes', 1, [0, 1]);
    expect(contributions.some(item => item.source === 'lowball')).toBe(false);

    state.dice[0].value = 2;
    const qualifying = handXMultContributions(captureHandStart(state, 'twos', [0]), 'twos', 1, [0, 1]);
    expect(qualifying).toContainEqual(expect.objectContaining({ source: 'lowball', value: 3.5,
      diagnostics: expect.objectContaining({ playedDiceCount: 1, qualifyingLowFaceCount: 1 }) }));
  });

  it.each([
    ['fatCat', 'golden', [1.3, 1.6, 1.9, 2.2, 2.5]],
    ['vineyard', 'vintage', [1.4, 1.8, 2.2, 2.6, 3]],
  ] as const)('%s scales with 1–5 matching Played dice', (flame, effect, expected) => {
    for (let count = 1; count <= 5; count++) {
      const state = game([1, 1, 1, 1, 1]);
      ownFlame(state, flame);
      for (let index = 0; index < count; index++) addEffects(state, index, [effect]);
      const ids = Array.from({ length: count }, (_, index) => index);
      const contribution = handXMultContributions(captureHandStart(state, 'ones', ids), 'ones', 1, ids)
        .find(item => item.source === flame);
      expect(contribution?.value).toBeCloseTo(expected[count - 1]);
      expect(contribution?.diagnostics).toMatchObject({ matchingPlayedDiceCount: count, playedDiceCount: count });
    }
    expect(flame === 'fatCat' ? fatCatMultiplier(100, 5) : vineyardMultiplier(100, 5))
      .toBe(expected[4]);
  });

  it('counts a die once, excludes non-Played scorers, and respects whole-die suppression', () => {
    const state = game([1, 1, 1, 1, 1]);
    addEffects(state, 0, ['golden', 'jackpot']);
    addEffects(state, 1, ['golden', 'hitchhiker']);
    let snapshot = captureHandStart(state, 'ones', [0]);
    expect(countPlayedDiceWithActiveEffects(snapshot, ['golden', 'jackpot'])).toBe(1);

    ownFlame(state, 'fatCat');
    snapshot = captureHandStart(state, 'ones', [0]);
    expect(handXMultContributions(snapshot, 'ones', 1, [0, 1])
      .find(item => item.source === 'fatCat')?.value).toBe(1.3);

    activeFace(rosterDice(state)[0]).bossMutation = { kind: 'infected' };
    snapshot = captureHandStart(state, 'ones', [0]);
    expect(countPlayedDiceWithActiveEffects(snapshot, ['golden', 'jackpot'])).toBe(0);
    expect(handXMultContributions(snapshot, 'ones', 1, [0, 1]).some(item => item.source === 'fatCat')).toBe(false);
  });

  it('applies the same Played-only and suppression semantics to Vineyard', () => {
    const state = game([1, 1, 1, 1, 1]);
    addEffects(state, 0, ['vintage']);
    addEffects(state, 1, ['vintage', 'hitchhiker']);
    ownFlame(state, 'vineyard');
    let snapshot = captureHandStart(state, 'ones', [0]);
    expect(handXMultContributions(snapshot, 'ones', 1, [0, 1])
      .find(item => item.source === 'vineyard')?.value).toBe(1.4);
    activeFace(rosterDice(state)[0]).bossMutation = { kind: 'infected' };
    snapshot = captureHandStart(state, 'ones', [0]);
    expect(handXMultContributions(snapshot, 'ones', 1, [0, 1]).some(item => item.source === 'vineyard')).toBe(false);
  });
});

describe('Full of Grace Last Play semantics', () => {
  it('applies on a naturally winning Last Play', () => {
    const state = game([1, 2, 3, 4, 5]);
    ownFlame(state, 'fullOfGrace');
    state.target = 1n;
    state.consumed = ['twos', 'threes', 'fours', 'fives', 'sixes', 'pair', 'twoPair', 'threeKind',
      'fourKind', 'fiveKind', 'fullHouse', 'smallStraight', 'largeStraight'];
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant()).state;
    expect(factor(result)).toMatchObject({ source: 'fullOfGrace', value: 5 });
  });

  it('requires exactly one playable manual Hand and supports a later recurring Last Play', () => {
    const many = game();
    ownFlame(many, 'fullOfGrace');
    expect(handXMultContributions(captureHandStart(many, 'ones', [0]), 'ones', 1, [0]))
      .not.toContainEqual(expect.objectContaining({ source: 'fullOfGrace' }));

    const none = game();
    ownFlame(none, 'fullOfGrace');
    none.consumed = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'pair', 'twoPair', 'threeKind',
      'fourKind', 'fiveKind', 'fullHouse', 'smallStraight', 'largeStraight'];
    expect(handXMultContributions(captureHandStart(none, 'ones', [0]), 'ones', 1, [0]))
      .not.toContainEqual(expect.objectContaining({ source: 'fullOfGrace' }));

    const recurring = game();
    ownFlame(recurring, 'fullOfGrace');
    recurring.consumed = ['twos', 'threes', 'fours', 'fives', 'sixes', 'pair', 'twoPair', 'threeKind',
      'fourKind', 'fiveKind', 'fullHouse', 'smallStraight', 'largeStraight'];
    recurring.scorecardCycleConsumed = [...recurring.consumed];
    let result = dispatch(recurring, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant()).state;
    expect(factor(result)).toMatchObject({ source: 'fullOfGrace' });
    result.consumed = ['ones', 'threes', 'fours', 'fives', 'sixes', 'pair', 'twoPair', 'threeKind',
      'fourKind', 'fiveKind', 'fullHouse', 'smallStraight', 'largeStraight'];
    result.dice[1].value = 2;
    result = dispatch(result, { type: 'PLAY', hand: 'twos', dieIds: [1] }, constant()).state;
    expect(factor(result)).toMatchObject({ source: 'fullOfGrace' });
  });
});

describe('Speed Demon Free Play exclusion', () => {
  it('does not trigger on a Free Play without a player decision window', () => {
    const state = game([1, 2, 3, 4, 5]);
    ownFlame(state, 'speedDemon');
    new Resolver(state, constant()).play('ones', [0], 'jumpingBean');
    expect(state.stats.handScores.at(-1)?.xMultFactors.some(item => item.source === 'speedDemon')).toBe(false);
  });
});
