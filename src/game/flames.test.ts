import { describe, expect, it, vi } from 'vitest';
import { dispatch, newRun, validateAction } from './engine';
import { Resolver } from './effects';
import {
  captureHandStart, chargeGainPerRoll, composeXMult, dragonsHoardMultiplier, flameEffectText, FLAME_IDS,
  handXMultContributions, hotStreakMultiplier, lowballMultiplier, moneyToBurnMultiplier, standardFlameMultiplier,
  targetPracticeMultiplier, trainerChance, wellTrainedMultiplier, XMult_FLAME_IDS,
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
    expect(FLAME_IDS).not.toContain('weighted');
    expect(FLAME_IDS).not.toContain('clockwork');
  });
  it.each([[0, 1], [10, 1.4], [25, 2], [50, 3], [100, 5]] as const)('standard scale %s => ×%s', (gold, factor) => expect(standardFlameMultiplier(gold)).toBe(factor));
  it.each([
    [0, 1, 0, 0, 1, 1, 1, 1],
    [10, 1.8, 0.15, 0.1, 1.4, 1.2, 1.4, 1.4],
    [25, 3, 0.375, 0.25, 2, 1.5, 2, 2],
    [50, 5, 0.75, 0.5, 3, 2, 3, 3],
    [100, 9, 0.75, 1, 5, 3, 5, 5],
  ] as const)('uses doubled bonus-above-neutral curves at %s%%', (gold, target, trainer, charge, dragon, trained, burn, lowball) => {
    expect(targetPracticeMultiplier(gold)).toBe(target);
    expect(trainerChance(gold)).toBeCloseTo(trainer);
    expect(chargeGainPerRoll(gold)).toBe(charge);
    expect(dragonsHoardMultiplier(gold, 100)).toBe(dragon);
    expect(wellTrainedMultiplier(gold, 10)).toBe(trained);
    expect(moneyToBurnMultiplier(gold, 100)).toBe(burn);
    expect(lowballMultiplier(gold, 2)).toBe(lowball);
  });
  it.each([[0, 1], [10, 1.2], [25, 1.5], [50, 2], [100, 3]] as const)('Hot Streak at %s%% doubles its two-charge bonus to ×%s', (gold, factor) => {
    expect(hotStreakMultiplier(gold, 2)).toBeCloseTo(factor);
  });
  it('preserves unique inputs while doubling coefficients and raising factor caps', () => {
    expect(dragonsHoardMultiplier(100, 20)).toBe(1.8);
    expect(dragonsHoardMultiplier(100, 200)).toBe(5);
    expect(wellTrainedMultiplier(100, 30)).toBe(5);
    expect(moneyToBurnMultiplier(100, 75)).toBe(4);
    expect(moneyToBurnMultiplier(100, 200)).toBe(5);
    expect(lowballMultiplier(100, 3)).toBe(4);
    expect(lowballMultiplier(50, 3)).toBe(2.5);
    expect(hotStreakMultiplier(50, 2)).toBe(2);
  });
  it('derives UI-facing values from the same domain formula helpers', () => {
    const state = game(); state.gold = 100; state.lifetimeNormalShopGoldSpent = 100;
    expect(flameEffectText('ultimate', 25, state)).toContain('×2 XMult');
    expect(flameEffectText('targetPractice', 25, state)).toContain('×3 XMult');
    expect(flameEffectText('charge', 25, state)).toContain('+0.25');
    expect(flameEffectText('personalTrainer', 25, state)).toContain('37.5%');
    expect(flameEffectText('moneyToBurn', 25, state)).toContain('×2 XMult');
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
    expect(factors).toMatchObject([{ source: 'ultimate', value: 3, dieId: 0 }]);
    expect(handXMultContributions(captureHandStart(state, 'threeKind'), 'threeKind', 3, [1, 2])).toEqual([]);
  });
  it('applies each Bonfire once globally', () => {
    const state = game(); state.bonfires = ['ultimate', 'minigun']; state.handLevels.fours = 2;
    const factors = handXMultContributions(captureHandStart(state, 'fours'), 'fours', 1, [0]);
    expect(factors.map(item => item.value)).toEqual([5, 5]);
    expect(composeXMult(factors)).toBe(25);
  });
  it('supports Straight Shooter, Double Down, Target Practice and Lowball conditions', () => {
    const state = game([1, 2, 3, 4, 6]);
    flame(state, 0, 'straightShooter'); flame(state, 1, 'doubleDown'); flame(state, 2, 'targetPractice'); flame(state, 3, 'lowball');
    state.targetPracticeHand = 'smallStraight';
    const factors = handXMultContributions(captureHandStart(state, 'smallStraight'), 'smallStraight', 1, [0, 1, 2, 3]);
    expect(factors.map(item => [item.source, item.value])).toEqual([['straightShooter', 5], ['targetPractice', 9], ['lowball', 4]]);
  });
  it('uses previous plays and the held-Gold/shop-spend snapshots', () => {
    const state = game(); state.gold = 50; state.handPlayCounts.threeKind = 10; state.lifetimeNormalShopGoldSpent = 75;
    flame(state, 0, 'dragonsHoard'); flame(state, 1, 'wellTrained'); flame(state, 2, 'moneyToBurn');
    expect(handXMultContributions(captureHandStart(state, 'threeKind'), 'threeKind', 1, [0, 1, 2]).map(item => item.value)).toEqual([3, 3, 4]);
  });
  it('exposes all XMult Flames as factors and multiplies simultaneous real factors', () => {
    expect(XMult_FLAME_IDS).toEqual(FLAME_IDS.filter(id => id !== 'personalTrainer'));
    const state = game([4, 4, 4, 2, 6]); state.gold = 25;
    state.bonfires = ['ultimate', 'dragonsHoard']; flame(state, 0, 'wellTrained', 50);
    state.handLevels.threeKind = 2;
    state.handPlayCounts.threeKind = 10;
    const factors = handXMultContributions(captureHandStart(state, 'threeKind'), 'threeKind', 1, [0, 1, 2]);
    expect(factors.map(factor => [factor.source, factor.value])).toEqual([['ultimate', 5], ['dragonsHoard', 2], ['wellTrained', 2]]);
    expect(composeXMult(factors)).toBe(20);
    expect(flameEffectText('dragonsHoard', 50, state)).toContain('×1.5 XMult');
  });
  it('plays back factor-by-factor multiplication instead of additive XMult wording', () => {
    const state = game([4, 4, 4, 2, 6]); state.gold = 25; state.bonfires = ['ultimate', 'dragonsHoard'];
    flame(state, 0, 'wellTrained', 50); state.handPlayCounts.threeKind = 10; state.handLevels.threeKind = 2;
    const result = play(state);
    const messages = result.events.filter(event => event.type === 'HAND_XMULT_CHANGED').map(event => event.message);
    expect(messages).toEqual([
      'Ultimate: XMult ×1 × factor ×5 = ×5',
      "Dragon's Hoard: XMult ×5 × factor ×2 = ×10",
      'Well Trained: XMult ×10 × factor ×2 = ×20',
    ]);
    expect(result.state.stats.handScores[0].xMult).toBe(20);
  });
});

describe('investment, uniqueness, and reward lifecycle', () => {
  function reward(): GameState {
    const state = game(); state.phase = 'flameSelection'; state.gold = 200;
    state.flameSelection = { offers: [{ id: 1, flame: 'ultimate' }, { id: 2, flame: 'charge' }, { id: 3, flame: 'lowball' }], acquired: false };
    return state;
  }
  it('acquires a neutral ember, then permits arbitrary Shop stoking and converts at 100', () => {
    let state = dispatch(reward(), { type: 'CHOOSE_FLAME', offerId: 1, dieId: 0 }).state;
    expect(state.dice[0].flame).toEqual({ id: 'ultimate', investedGold: 0 });
    expect(validateAction(state, { type: 'STOKE_FLAME', dieId: 0, amount: 1 })).toContain('normal Shop');
    state = dispatch(state, { type: 'CONTINUE_FLAME_SELECTION' }).state;
    state = dispatch(state, { type: 'STOKE_FLAME', dieId: 0, amount: 23 }).state;
    expect(state.dice[0].flame?.investedGold).toBe(23);
    expect(state.stats.flameStokes).toEqual([{ round: 1, dieId: 0, flame: 'ultimate', amount: 23,
      from: 0, total: 23, source: 'shop' }]);
    state = dispatch(state, { type: 'STOKE_FLAME', dieId: 0, amount: 77 }).state;
    expect(state.dice[0].flame).toBeNull(); expect(state.bonfires).toEqual(['ultimate']); expect(state.gold).toBe(100);
    expect(state.stats.flameStokes.at(-1)).toMatchObject({ amount: 77, total: 100 });
    expect(validateAction(state, { type: 'CHOOSE_FLAME', offerId: 2, dieId: 0 })).toContain('Flame Selection');
  });
  it('rejects Reward spending, fractions, overspend, over-cap, duplicates, and investment outside shops', () => {
    const state = reward(); flame(state, 0, 'charge', 95); state.gold = 4;
    expect(validateAction(state, { type: 'STOKE_FLAME', dieId: 0, amount: 1 })).toContain('normal Shop');
    state.phase = 'shop'; state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 }; state.flameSelection = null;
    expect(validateAction(state, { type: 'STOKE_FLAME', dieId: 0, amount: 1.5 })).toContain('whole');
    expect(validateAction(state, { type: 'STOKE_FLAME', dieId: 0, amount: 5 })).toContain('Not enough');
    state.gold = 100;
    expect(validateAction(state, { type: 'STOKE_FLAME', dieId: 0, amount: 6 })).toContain('more than 100');
    state.phase = 'round'; state.shop = null; expect(validateAction(state, { type: 'STOKE_FLAME', dieId: 0, amount: 1 })).toContain('normal Shop');
  });
  it.each([1, 2, 4, 8])('allows arbitrary Stoke at an ordinary round-%s shop without enabling acquisition', round => {
    const state = game(); state.phase = 'shop'; state.round = round; state.gold = 14;
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    flame(state, 0, 'dragonsHoard', 27);
    expect(validateAction(state, { type: 'STOKE_FLAME', dieId: 0, amount: 14 })).toBeNull();
    expect(validateAction(state, { type: 'CHOOSE_FLAME', offerId: 1, dieId: 0 })).toContain('Flame Selection');
    const result = dispatch(state, { type: 'STOKE_FLAME', dieId: 0, amount: 14 });
    expect(result.state.gold).toBe(0);
    expect(result.state.dice[0].flame).toEqual({ id: 'dragonsHoard', investedGold: 41 });
    expect(result.state.stats.flameStokes.at(-1)).toEqual({ round, dieId: 0, flame: 'dragonsHoard', amount: 14,
      from: 27, total: 41, source: 'shop' });
    expect(result.events.find(event => event.type === 'FLAME_INVESTED')?.message).toContain('27 → 41 / 100');
    const nextRound = dispatch(result.state, { type: 'NEXT_ROUND' }, constant()).state;
    expect(nextRound.dice[0].flame).toEqual({ id: 'dragonsHoard', investedGold: 41 });
  });
  it('validates Shop Stoke Gold and cap, persists investment, and creates the same Bonfire at 100', () => {
    const state = game(); state.phase = 'shop'; state.gold = 10;
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 }; flame(state, 0, 'ultimate', 95);
    expect(validateAction(state, { type: 'STOKE_FLAME', dieId: 0, amount: 11 })).toContain('Not enough');
    expect(validateAction(state, { type: 'STOKE_FLAME', dieId: 0, amount: 6 })).toContain('more than 100');
    const completed = dispatch(state, { type: 'STOKE_FLAME', dieId: 0, amount: 5 }).state;
    expect(completed.gold).toBe(5); expect(completed.dice[0].flame).toBeNull(); expect(completed.bonfires).toContain('ultimate');
    expect(completed.stats.bonfiresCreated.at(-1)).toEqual({ round: 1, flame: 'ultimate' });
  });
  it('can skip acquisition and preserve reward faces into shop', () => {
    const state = reward(); const values = state.dice.map(die => die.value);
    const result = dispatch(state, { type: 'CONTINUE_FLAME_SELECTION' }, constant(0));
    expect(result.state.phase).toBe('shop'); expect(result.state.dice.map(die => die.value)).toEqual(values); expect(result.state.stats.flameSkips).toEqual([1]);
  });
  it('safely ignores deprecated Flame IDs and normalizes legacy current IDs on investment', () => {
    const deprecated = reward(); deprecated.dice[0].flame = 'clockwork' as unknown as GameState['dice'][number]['flame'];
    deprecated.phase = 'round'; deprecated.flameSelection = null;
    expect(play(deprecated).state.phase).not.toBe('error');
    const legacy = reward(); legacy.phase = 'shop'; legacy.flameSelection = null;
    legacy.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    legacy.dice[0].flame = 'ultimate' as unknown as GameState['dice'][number]['flame'];
    const invested = dispatch(legacy, { type: 'STOKE_FLAME', dieId: 0, amount: 7 }).state;
    expect(invested.dice[0].flame).toEqual({ id: 'ultimate', investedGold: 7 });
  });
});

describe('Charge, Trainer, and Hot Streak', () => {
  it('stores Charge from qualifying rolls, only applies armed Charge, then resets', () => {
    let state = game([1, 2, 3, 4, 5]); flame(state, 0, 'charge', 50);
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0)).state;
    expect(state.chargeXMult).toBe(1.5);
    const unarmed = state; unarmed.dice[0].value = 4; unarmed.dice[1].value = 4; unarmed.dice[2].value = 4;
    const first = play(unarmed);
    expect(first.state.stats.handScores[0].xMult).toBe(1); expect(first.state.chargeXMult).toBeGreaterThan(1);
    first.state.dice.forEach((die, i) => { die.value = ([4, 4, 4, 2, 6] as Rank[])[i]; }); first.state.consumed = [];
    const armed = dispatch(first.state, { type: 'TOGGLE_CHARGE' }).state;
    const second = play(armed);
    expect(second.state.stats.handScores[1].xMult).toBeGreaterThan(1);
    // Consumption resets first; the post-hand reroll is a fresh qualifying roll for the next hand.
    expect(second.state.chargeXMult).toBe(1.5);
  });
  it('Charge Bonfire grows its stored factor by +5 for a five-die gameplay batch', () => {
    const state = game(); state.bonfires = ['charge']; state.chargeXMult = 1;
    const resolver = new Resolver(state, constant(0)); resolver.rollBatch([0, 1, 2, 3, 4], 'test', 'gameplay');
    expect(state.chargeXMult).toBe(6);
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
