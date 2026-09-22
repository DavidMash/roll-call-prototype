import { describe, expect, it, vi } from 'vitest';
import { dispatch, newRun, validateAction } from './engine';
import { Resolver } from './effects';
import {
  captureHandStart, chargeGainPerRoll, composeXMult, dragonsHoardMultiplier, FLAME_IDS,
  handXMultContributions, lowballMultiplier, moneyToBurnMultiplier, standardFlameMultiplier,
  targetPracticeMultiplier, trainerChance, wellTrainedMultiplier,
} from './flames';
import type { Flame, GameState, RandomSource, Rank } from './types';

const constant = (value = 0.99): RandomSource => ({ next: () => value });
function game(values: Rank[] = [4, 4, 4, 2, 6]): GameState {
  const state = newRun('new-flames', constant()).state;
  state.dice.forEach((die, index) => { die.value = values[index]; });
  state.target = 100000; state.stats.rounds[0].target = state.target;
  return state;
}
function flame(state: GameState, dieId: number, id: Flame, investedGold = 100) { state.dice[dieId].flame = { id, investedGold }; }
const play = (state: GameState, hand = 'threeKind' as const, dieIds = [0, 1, 2], rng = constant()) => dispatch(state, { type: 'PLAY', hand, dieIds }, rng);

describe('multiplicative Flame formulas', () => {
  it('contains the final unique 13-Flame roster', () => {
    expect(FLAME_IDS).toEqual(['ultimate', 'minigun', 'hailMary', 'charge', 'personalTrainer', 'dragonsHoard', 'wellTrained', 'targetPractice', 'hotStreak', 'moneyToBurn', 'lowball', 'straightShooter', 'doubleDown']);
  });
  it.each([[0, 1], [50, 2], [100, 3]] as const)('standard scale %s => ×%s', (gold, factor) => expect(standardFlameMultiplier(gold)).toBe(factor));
  it('uses exact capped special formulas', () => {
    expect(targetPracticeMultiplier(50)).toBe(3);
    expect(trainerChance(50)).toBe(0.375);
    expect(chargeGainPerRoll(50)).toBe(0.25);
    expect(dragonsHoardMultiplier(100, 20)).toBe(1.4);
    expect(dragonsHoardMultiplier(100, 200)).toBe(3);
    expect(wellTrainedMultiplier(100, 30)).toBe(3);
    expect(moneyToBurnMultiplier(100, 75)).toBe(2.5);
    expect(moneyToBurnMultiplier(100, 200)).toBe(3);
    expect(lowballMultiplier(100, 2)).toBe(3);
    expect(lowballMultiplier(50, 3)).toBe(1.75);
  });
  it('multiplies factors centrally and without order dependence', () => {
    expect(composeXMult([2.2, 1.5, 3])).toBe(9.9);
    expect(composeXMult([3, 2.2, 1.5])).toBe(9.9);
  });
});

describe('conditional Flames and Bonfires', () => {
  it('uses investment and die participation before Bonfire', () => {
    const state = game(); state.handLevels.threeKind = 3; flame(state, 0, 'ultimate', 50);
    const factors = handXMultContributions(captureHandStart(state, 'threeKind'), 'threeKind', 3, [0, 1, 2]);
    expect(factors).toMatchObject([{ source: 'ultimate', value: 2, dieId: 0 }]);
    expect(handXMultContributions(captureHandStart(state, 'threeKind'), 'threeKind', 3, [1, 2])).toEqual([]);
  });
  it('applies each Bonfire once globally', () => {
    const state = game(); state.bonfires = ['ultimate', 'minigun'];
    const factors = handXMultContributions(captureHandStart(state, 'fours'), 'fours', 1, [0]);
    expect(factors.map(item => item.value)).toEqual([3, 3]);
    expect(composeXMult(factors)).toBe(9);
  });
  it('supports Straight Shooter, Double Down, Target Practice and Lowball conditions', () => {
    const state = game([1, 2, 3, 4, 6]);
    flame(state, 0, 'straightShooter'); flame(state, 1, 'doubleDown'); flame(state, 2, 'targetPractice'); flame(state, 3, 'lowball');
    state.targetPracticeHand = 'smallStraight';
    const factors = handXMultContributions(captureHandStart(state, 'smallStraight'), 'smallStraight', 1, [0, 1, 2, 3]);
    expect(factors.map(item => [item.source, item.value])).toEqual([['straightShooter', 3], ['targetPractice', 5], ['lowball', 2.5]]);
  });
  it('uses previous plays and the held-Gold/shop-spend snapshots', () => {
    const state = game(); state.gold = 50; state.handPlayCounts.threeKind = 10; state.lifetimeNormalShopGoldSpent = 75;
    flame(state, 0, 'dragonsHoard'); flame(state, 1, 'wellTrained'); flame(state, 2, 'moneyToBurn');
    expect(handXMultContributions(captureHandStart(state, 'threeKind'), 'threeKind', 1, [0, 1, 2]).map(item => item.value)).toEqual([2, 2, 2.5]);
  });
});

describe('investment, uniqueness, and reward lifecycle', () => {
  function reward(): GameState {
    const state = game(); state.phase = 'flameReward'; state.gold = 200;
    state.flameReward = { offers: [{ id: 1, flame: 'ultimate' }, { id: 2, flame: 'charge' }, { id: 3, flame: 'lowball' }], offerRerolls: 0, acquired: false };
    return state;
  }
  it('acquires a neutral ember, permits arbitrary donations, and converts at 100', () => {
    let state = dispatch(reward(), { type: 'CHOOSE_FLAME', offerId: 1, dieId: 0 }).state;
    expect(state.dice[0].flame).toEqual({ id: 'ultimate', investedGold: 0 });
    state = dispatch(state, { type: 'DONATE_FLAME', dieId: 0, amount: 23 }).state;
    expect(state.dice[0].flame?.investedGold).toBe(23);
    state = dispatch(state, { type: 'DONATE_FLAME', dieId: 0, amount: 77 }).state;
    expect(state.dice[0].flame).toBeNull(); expect(state.bonfires).toEqual(['ultimate']); expect(state.gold).toBe(100);
    expect(validateAction(state, { type: 'CHOOSE_FLAME', offerId: 2, dieId: 0 })).toContain('Only one');
  });
  it('rejects fractions, overspend, over-cap, duplicates, and investment outside rewards', () => {
    const state = reward(); flame(state, 0, 'charge', 95); state.gold = 4;
    expect(validateAction(state, { type: 'DONATE_FLAME', dieId: 0, amount: 1.5 })).toContain('whole');
    expect(validateAction(state, { type: 'DONATE_FLAME', dieId: 0, amount: 5 })).toContain('Not enough');
    state.gold = 100;
    expect(validateAction(state, { type: 'DONATE_FLAME', dieId: 0, amount: 6 })).toContain('more than 100');
    state.flameReward!.offers[0].flame = 'charge';
    expect(validateAction(state, { type: 'CHOOSE_FLAME', offerId: 1, dieId: 1 })).toContain('already owned');
    state.phase = 'round'; expect(validateAction(state, { type: 'DONATE_FLAME', dieId: 0, amount: 1 })).toContain('requires');
  });
  it('can skip acquisition and preserve reward faces into shop', () => {
    const state = reward(); const values = state.dice.map(die => die.value);
    const result = dispatch(state, { type: 'CONTINUE_FLAME_REWARD' }, constant(0));
    expect(result.state.phase).toBe('shop'); expect(result.state.dice.map(die => die.value)).toEqual(values); expect(result.state.stats.flameSkips).toEqual([1]);
  });
  it('safely ignores deprecated Flame IDs and normalizes legacy current IDs on investment', () => {
    const deprecated = reward(); deprecated.dice[0].flame = 'clockwork' as unknown as GameState['dice'][number]['flame'];
    deprecated.phase = 'round'; deprecated.flameReward = null;
    expect(play(deprecated).state.phase).not.toBe('error');
    const legacy = reward(); legacy.dice[0].flame = 'ultimate' as unknown as GameState['dice'][number]['flame'];
    const invested = dispatch(legacy, { type: 'DONATE_FLAME', dieId: 0, amount: 7 }).state;
    expect(invested.dice[0].flame).toEqual({ id: 'ultimate', investedGold: 7 });
  });
});

describe('Charge, Trainer, and Hot Streak', () => {
  it('stores Charge from qualifying rolls, only applies armed Charge, then resets', () => {
    let state = game([1, 2, 3, 4, 5]); flame(state, 0, 'charge', 50);
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0)).state;
    expect(state.chargeXMult).toBe(1.25);
    const unarmed = state; unarmed.dice[0].value = 4; unarmed.dice[1].value = 4; unarmed.dice[2].value = 4;
    const first = play(unarmed);
    expect(first.state.stats.handScores[0].xMult).toBe(1); expect(first.state.chargeXMult).toBeGreaterThan(1);
    first.state.dice.forEach((die, i) => { die.value = ([4, 4, 4, 2, 6] as Rank[])[i]; }); first.state.consumed = [];
    const armed = dispatch(first.state, { type: 'TOGGLE_CHARGE' }).state;
    const second = play(armed);
    expect(second.state.stats.handScores[1].xMult).toBeGreaterThan(1);
    // Consumption resets first; the post-hand reroll is a fresh qualifying roll for the next hand.
    expect(second.state.chargeXMult).toBe(1.25);
  });
  it('Charge Bonfire gains +2.5 for a five-die gameplay batch', () => {
    const state = game(); state.bonfires = ['charge']; state.chargeXMult = 1;
    const resolver = new Resolver(state, constant(0)); resolver.rollBatch([0, 1, 2, 3, 4], 'test', 'gameplay');
    expect(state.chargeXMult).toBe(3.5);
  });
  it('Personal Trainer skips RNG at 0 and trains after scoring at full investment', () => {
    const zero = game(); flame(zero, 0, 'personalTrainer', 0); const rng = { next: vi.fn(() => 0) };
    const zeroResult = play(zero, 'threeKind', [0, 1, 2], rng);
    expect(zeroResult.state.handLevels.threeKind).toBe(1);
    expect(zeroResult.state.stats.personalTrainerAttempts).toBe(0);
    expect(rng.next).toHaveBeenCalledTimes(3); // only the three normal post-hand die rolls
    const full = game(); flame(full, 0, 'personalTrainer', 100);
    const trained = play(full, 'threeKind', [0, 1, 2], constant(0));
    expect(trained.state.stats.handScores[0].handLevel).toBe(1); expect(trained.state.handLevels.threeKind).toBe(2);
  });
  it('Hot Streak keeps its goal after a future hand and skips that consumed hand later', () => {
    let state = game([3, 3, 3, 4, 5]); flame(state, 0, 'hotStreak'); state.hotStreakGoal = 'twoPair';
    state = play(state, 'threeKind', [0, 1, 2]).state;
    expect(state.hotStreakGoal).toBe('twoPair'); expect(state.hotStreakCharges).toBe(0);
    state.dice.forEach((die, i) => { die.value = ([2, 2, 4, 4, 6] as Rank[])[i]; });
    state = dispatch(state, { type: 'PLAY', hand: 'twoPair', dieIds: [0, 1, 2, 3] }, constant()).state;
    expect(state.hotStreakCharges).toBe(1); expect(state.hotStreakGoal).toBe('smallStraight');
    expect(state.stats.hotStreakSkippedHands).toContainEqual({ round: 1, hand: 'threeKind' });
  });
});
