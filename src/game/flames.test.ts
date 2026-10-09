import { describe, expect, it } from 'vitest';
import { dispatch, newRun, validateAction } from './engine';
import { Resolver } from './effects';
import {
  captureHandStart, composeXMult, flameEffectText, FLAME_IDS, momentumChargeGain,
  handFamilyFlameMultiplier, handXMultContributions, hotStreakMultiplier, lowballMultiplier, standardFlameMultiplier,
  targetPracticeMultiplier, XMult_FLAME_IDS,
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
  it('contains the final unique 15-Flame roster without Personal Trainer', () => {
    expect(FLAME_IDS).toEqual(['ultimate', 'minigun', 'hailMary', 'fullOfGrace', 'momentum', 'thirdRail', 'jumpStart', 'powerSurge', 'speedDemon', 'sixPack', 'fluxCapacitor', 'fatCat', 'vineyard', 'fetch', 'targetPractice', 'hotStreak', 'lowball', 'straightShooter', 'doubleDown', 'threesCompany', 'boxSet', 'missingPair', 'oneShort']);
    expect(FLAME_IDS).not.toContain('personalTrainer');
    expect(FLAME_IDS).not.toContain('weighted');
    expect(FLAME_IDS).not.toContain('clockwork');
  });
  it.each([[0, 1], [10, 1.4], [25, 2], [50, 3], [100, 5]] as const)('standard scale %s => ×%s', (gold, factor) => expect(standardFlameMultiplier(gold)).toBe(factor));
  it.each([[0, 1], [25, 3], [50, 5], [100, 9]] as const)('hand-family payoff scale %s => ×%s', (gold, factor) => expect(handFamilyFlameMultiplier(gold)).toBe(factor));
  it.each([
    [0, 1, 0, 1],
    [10, 1.8, 0.05, 1.4],
    [25, 3, 0.125, 2],
    [50, 5, 0.25, 3],
    [100, 9, 0.5, 5],
  ] as const)('uses doubled bonus-above-neutral curves at %s%%', (gold, target, charge, lowball) => {
    expect(targetPracticeMultiplier(gold)).toBe(target);
    expect(momentumChargeGain(gold)).toBe(charge);
    expect(lowballMultiplier(gold, 2)).toBe(lowball);
  });
  it.each([[0, 1], [10, 1.2], [25, 1.5], [50, 2], [100, 3]] as const)('Hot Streak at %s%% doubles its two-charge bonus to ×%s', (gold, factor) => {
    expect(hotStreakMultiplier(gold, 2)).toBeCloseTo(factor);
  });
  it('preserves unique inputs while doubling coefficients and raising factor caps', () => {
    expect(lowballMultiplier(100, 3)).toBe(4);
    expect(lowballMultiplier(50, 3)).toBe(2.5);
    expect(hotStreakMultiplier(50, 2)).toBe(2);
  });
  it('derives UI-facing values from the same domain formula helpers', () => {
    const state = game(); state.gold = 100; state.lifetimeNormalShopGoldSpent = 100;
    expect(flameEffectText('ultimate', 25, state)).toContain('×2 XMult');
    expect(flameEffectText('targetPractice', 25, state)).toContain('×3 XMult');
    expect(flameEffectText('momentum', 25, state)).toContain('+0.125');
    expect(flameEffectText('fatCat', 25, state)).toContain('×2 XMult');
  });
  it('multiplies factors centrally and without order dependence', () => {
    expect(composeXMult([2.2, 1.5, 3])).toBe(9.9);
    expect(composeXMult([3, 2.2, 1.5])).toBe(9.9);
  });
});

describe('conditional Flames and Bonfires', () => {
  it('uses investment and die participation before Bonfire', () => {
    const state = game(); state.handLevels.threeKind = 3; flame(state, 0, 'ultimate', 50);
    const factors = handXMultContributions(captureHandStart(state, 'threeKind', [0, 1, 2]), 'threeKind', 3, [0, 1, 2]);
    expect(factors).toMatchObject([{ source: 'ultimate', value: 3, dieId: 0 }]);
    expect(handXMultContributions(captureHandStart(state, 'threeKind', [1, 2]), 'threeKind', 3, [1, 2])).toEqual([]);
  });
  it('applies each Bonfire once globally', () => {
    const state = game(); state.bonfires = ['ultimate', 'minigun']; state.handLevels.fours = 2;
    const factors = handXMultContributions(captureHandStart(state, 'fours', [0]), 'fours', 1, [0]);
    expect(factors.map(item => item.value)).toEqual([5, 5]);
    expect(composeXMult(factors)).toBe(25);
  });
  it('supports armed Straight Shooter, Target Practice and Lowball conditions', () => {
    const state = game([1, 2, 3, 4, 6]);
    flame(state, 0, 'straightShooter'); flame(state, 2, 'targetPractice'); flame(state, 3, 'lowball');
    state.handFamilyFlameStages.straightShooter = 'payoff';
    state.targetPracticeHand = 'smallStraight';
    const factors = handXMultContributions(captureHandStart(state, 'smallStraight', [0, 1, 2, 3]), 'smallStraight', 1, [0, 1, 2, 3]);
    expect(factors.map(item => [item.source, item.value])).toEqual([['targetPractice', 9], ['lowball', 4]]);
  });
  it.each([
    ['doubleDown', 'twoPair'],
    ['threesCompany', 'fullHouse'],
    ['straightShooter', 'largeStraight'],
    ['boxSet', 'fiveKind'],
  ] as const)('%s scales for its armed %s payoff, requires its die before Bonfire, and applies globally after Bonfire', (id, hand) => {
    const ember = game(); flame(ember, 0, id, 50);
    ember.handFamilyFlameStages[id] = 'payoff';
    const participating = handXMultContributions(captureHandStart(ember, hand, [0, 1, 2]), hand, 1, [0, 1, 2]);
    expect(participating).toMatchObject([{ source: id, value: 5, dieId: 0 }]);
    expect(handXMultContributions(captureHandStart(ember, hand, [1, 2]), hand, 1, [1, 2])).toEqual([]);
    expect(handXMultContributions(captureHandStart(ember, 'ones', [0]), 'ones', 1, [0])).toEqual([]);

    ember.dice[0].flame = null;
    ember.bonfires = [id];
    ember.handFamilyFlameStages[id] = 'payoff';
    expect(handXMultContributions(captureHandStart(ember, hand, [1, 2]), hand, 1, [1, 2]))
      .toMatchObject([{ source: id, value: 9, dieId: null }]);
  });
  it('uses actual Golden/Jackpot and Vintage scoring participation', () => {
    const state = game(); flame(state, 0, 'fatCat'); flame(state, 1, 'vineyard');
    state.dice[2].faces[state.dice[2].value - 1].enhancements.golden = 1;
    state.dice[2].faces[state.dice[2].value - 1].enhancements.vintage = 1;
    expect(handXMultContributions(captureHandStart(state, 'threeKind', [0, 1, 2]), 'threeKind', 1, [0, 1, 2])
      .map(item => [item.source, item.value])).toEqual([['fatCat', 5], ['vineyard', 5]]);
    expect(handXMultContributions(captureHandStart(state, 'threeKind', [0, 1]), 'threeKind', 1, [0, 1])).toEqual([]);
  });
  it('exposes all XMult Flames as factors and multiplies simultaneous real factors', () => {
    expect(XMult_FLAME_IDS).toEqual(FLAME_IDS);
    const state = game([4, 4, 4, 2, 6]);
    state.bonfires = ['ultimate', 'fatCat']; flame(state, 0, 'vineyard', 50);
    state.dice[0].faces[3].enhancements.vintage = 1;
    state.dice[1].faces[3].enhancements.golden = 1;
    state.handLevels.threeKind = 2;
    state.handPlayCounts.threeKind = 10;
    const factors = handXMultContributions(captureHandStart(state, 'threeKind', [0, 1, 2]), 'threeKind', 1, [0, 1, 2]);
    expect(factors.map(factor => [factor.source, factor.value])).toEqual([['ultimate', 5], ['fatCat', 5], ['vineyard', 3]]);
    expect(composeXMult(factors)).toBe(75);
    expect(flameEffectText('fatCat', 50, state)).toContain('×3 XMult');
  });
  it('plays back factor-by-factor multiplication instead of additive XMult wording', () => {
    const state = game([4, 4, 4, 2, 6]); state.bonfires = ['ultimate', 'fatCat'];
    flame(state, 0, 'vineyard', 50); state.dice[0].faces[3].enhancements.vintage = 1; state.dice[1].faces[3].enhancements.golden = 1; state.handLevels.threeKind = 2;
    const result = play(state);
    const messages = result.events.filter(event => event.type === 'HAND_XMULT_CHANGED').map(event => event.message);
    expect(messages).toEqual([
      'Ultimate: XMult ×1 × factor ×5 = ×5',
      'Fat Cat: XMult ×5 × factor ×5 = ×25',
      'Vineyard: XMult ×25 × factor ×3 = ×75',
    ]);
    expect(result.state.stats.handScores[0].xMult).toBe(75);
  });
});

describe('investment, uniqueness, and reward lifecycle', () => {
  function reward(): GameState {
    const state = game(); state.phase = 'flameSelection'; state.gold = 200;
    state.flameSelection = { offers: [{ id: 1, flame: 'ultimate' }, { id: 2, flame: 'momentum' }, { id: 3, flame: 'lowball' }], acquired: false };
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
    const state = reward(); flame(state, 0, 'momentum', 95); state.gold = 4;
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
    flame(state, 0, 'fatCat', 27);
    expect(validateAction(state, { type: 'STOKE_FLAME', dieId: 0, amount: 14 })).toBeNull();
    expect(validateAction(state, { type: 'CHOOSE_FLAME', offerId: 1, dieId: 0 })).toContain('Flame Selection');
    const result = dispatch(state, { type: 'STOKE_FLAME', dieId: 0, amount: 14 });
    expect(result.state.gold).toBe(0);
    expect(result.state.dice[0].flame).toEqual({ id: 'fatCat', investedGold: 41 });
    expect(result.state.stats.flameStokes.at(-1)).toEqual({ round, dieId: 0, flame: 'fatCat', amount: 14,
      from: 27, total: 41, source: 'shop' });
    expect(result.events.find(event => event.type === 'FLAME_INVESTED')?.message).toContain('27 → 41 / 100');
    const nextRound = dispatch(result.state, { type: 'NEXT_ROUND' }, constant()).state;
    expect(nextRound.dice[0].flame).toEqual({ id: 'fatCat', investedGold: 41 });
  });
  it('validates Shop Stoke Gold and cap, persists investment, and creates the same Bonfire at 100', () => {
    const state = game(); state.phase = 'shop'; state.gold = 10;
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 }; flame(state, 0, 'ultimate', 95);
    expect(validateAction(state, { type: 'STOKE_FLAME', dieId: 0, amount: 11 })).toContain('Not enough');
    expect(validateAction(state, { type: 'STOKE_FLAME', dieId: 0, amount: 6 })).toContain('more than 100');
    const completed = dispatch(state, { type: 'STOKE_FLAME', dieId: 0, amount: 5 }).state;
    expect(completed.gold).toBe(5); expect(completed.dice[0].flame).toBeNull(); expect(completed.bonfires).toContain('ultimate');
    expect(completed.historyV2).toContainEqual(expect.objectContaining({ kind: 'flame_changed',
      change: expect.objectContaining({ type: 'bonfire_created', flame: 'ultimate' }) }));
  });
  it('can skip acquisition and preserve reward faces into shop', () => {
    const state = reward(); const values = state.dice.map(die => die.value);
    const result = dispatch(state, { type: 'CONTINUE_FLAME_SELECTION' }, constant(0));
    expect(result.state.phase).toBe('shop'); expect(result.state.dice.map(die => die.value)).toEqual(values);
    expect(result.state.historyV2).toContainEqual(expect.objectContaining({ kind: 'flame_changed', change: { type: 'skipped' } }));
  });
  it('keeps generated Flame offers unique, deterministic, and free of Personal Trainer', () => {
    const makeOffers = () => {
      const state = game();
      state.phase = 'flameSelection';
      state.flameSelection = { offers: [], acquired: false };
      new Resolver(state, constant(0.42)).freshFlameOffers();
      return state.flameSelection.offers.map(offer => offer.flame);
    };
    const first = makeOffers();
    expect(makeOffers()).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
    expect(first).not.toContain('personalTrainer');
  });
  it('offers nothing when every current Flame is owned and still continues to the Shop', () => {
    const state = game();
    state.phase = 'flameSelection';
    state.flameSelection = { offers: [], acquired: false };
    state.bonfires = [...FLAME_IDS];
    new Resolver(state, constant(0.42)).freshFlameOffers();
    expect(state.flameSelection.offers).toEqual([]);
    const continued = dispatch(state, { type: 'CONTINUE_FLAME_SELECTION' }, constant(0));
    expect(continued.error).toBeUndefined();
    expect(continued.state.phase).toBe('shop');
  });
  it('makes a Flame eligible again after it is no longer currently owned', () => {
    const missing = FLAME_IDS[0];
    const state = game();
    state.phase = 'flameSelection';
    state.flameSelection = { offers: [], acquired: false };
    state.bonfires = FLAME_IDS.filter(id => id !== missing);
    state.dice.forEach(die => { die.flame = null; });
    new Resolver(state, constant(0)).freshFlameOffers();
    expect(state.flameSelection.offers.map(offer => offer.flame)).toEqual([missing]);
  });
  it('safely ignores deprecated Flame IDs and normalizes legacy current IDs on investment', () => {
    const deprecated = reward();
    deprecated.dice[0].flame = { id: 'personalTrainer', investedGold: 100 } as unknown as GameState['dice'][number]['flame'];
    deprecated.bonfires = ['personalTrainer' as unknown as Flame];
    deprecated.phase = 'round'; deprecated.flameSelection = null;
    const normalized = play(deprecated).state;
    expect(normalized.phase).not.toBe('error');
    expect(normalized.dice[0].flame).toBeNull();
    expect(normalized.bonfires).toEqual([]);
    const legacy = reward(); legacy.phase = 'shop'; legacy.flameSelection = null;
    legacy.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    legacy.dice[0].flame = 'ultimate' as unknown as GameState['dice'][number]['flame'];
    const invested = dispatch(legacy, { type: 'STOKE_FLAME', dieId: 0, amount: 7 }).state;
    expect(invested.dice[0].flame).toEqual({ id: 'ultimate', investedGold: 7 });
  });
});

describe('Charge and Hot Streak', () => {
  it('stores Momentum Charge per hand, only applies armed Charge, then resets before rebuilding', () => {
    let state = game([1, 2, 3, 4, 5]); flame(state, 0, 'momentum', 50);
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0)).state;
    expect(state.chargeXMult).toBe(1);
    const unarmed = state; unarmed.dice[0].value = 4; unarmed.dice[1].value = 4; unarmed.dice[2].value = 4;
    const first = play(unarmed);
    expect(first.state.stats.handScores[0].xMult).toBe(1); expect(first.state.chargeXMult).toBe(1.25);
    first.state.dice.forEach((die, i) => { die.value = ([4, 4, 4, 2, 6] as Rank[])[i]; }); first.state.consumed = [];
    const armed = dispatch(first.state, { type: 'TOGGLE_CHARGE', hand: 'threeKind', dieIds: [0, 1, 2] }).state;
    const second = play(armed);
    expect(second.state.stats.handScores[1].xMult).toBe(1.25);
    expect(second.state.chargeXMult).toBe(1.25);
  });
  it('Momentum Bonfire grows once per played hand and not from gameplay rolls', () => {
    const state = game([6, 6, 6, 6, 6]); state.bonfires = ['momentum']; state.chargeXMult = 1;
    const resolver = new Resolver(state, constant(0)); resolver.rollBatch([0, 1, 2, 3, 4], 'test', 'gameplay');
    expect(state.chargeXMult).toBe(1);
    const result = dispatch(state, { type: 'PLAY', hand: 'fiveKind', dieIds: [0, 1, 2, 3, 4] }, constant());
    expect(result.state.chargeXMult).toBe(1.5);
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
