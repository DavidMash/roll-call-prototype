import { describe, expect, it } from 'vitest';
import { CONFIG, lifeRestoreCost } from './config';
import { activeFace } from './dice';
import { dispatch, newRun, validateAction } from './engine';
import { ENHANCEMENTS, ENHANCEMENT_IDS, enhancementSellValue } from './enhancements';
import { Resolver } from './effects';
import { HAND_IDS } from './hands';
import type { GameState, GameStateBase, RandomSource, Rank } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });
const sequence = (...values: number[]): RandomSource => { let index = 0; return { next: () => values[index++] ?? 0 }; };

function compactCheckpoint(state: GameState): GameStateBase {
  const clone = structuredClone(state);
  const { roundCheckpoint: _checkpoint, ...base } = clone;
  base.history = [];
  base.stats.actions = [];
  return base;
}
function forceBust(state: GameState, rng: RandomSource = constant()): ReturnType<typeof dispatch> {
  state.dice.forEach((die, index) => { die.value = ([1, 2, 2, 4, 5] as Rank[])[index]; });
  state.score = 0;
  state.manualRerollsRemaining = 0;
  state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
  return dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, rng);
}
function shop(seed = 'economy-shop'): GameState {
  const state = newRun(seed, constant(0.2)).state;
  state.phase = 'shop';
  state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
  state.flameSelection = null;
  return state;
}
function clearIntoShop(state: GameState): GameState {
  state.target = 1;
  state.stats.rounds.at(-1)!.target = 1;
  state.dice[0].value = 1;
  const summary = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant()).state;
  return dispatch(summary, { type: 'CONTINUE_ROUND_SUMMARY' }, constant()).state;
}

describe('lives, Bust checkpoint, and retry RNG', () => {
  it('starts at 3/3, loses one life per Bust, retries the same round, and ends on the final life', () => {
    let state = newRun('three-lives').state;
    expect(state.lives).toBe(3);
    const round = state.round;
    const target = state.target;
    const attemptOneDice = state.dice.map(die => die.value);

    state = forceBust(state).state;
    expect(state).toMatchObject({ phase: 'shop', lives: 2, round, target, score: 0, roundAttemptNumber: 2 });
    expect(state.bust).toMatchObject({ attempt: 1, livesBefore: 3, livesAfter: 2 });
    state = dispatch(state, { type: 'RETRY_ROUND' }).state;
    expect(state).toMatchObject({ phase: 'round', lives: 2, round, target, roundAttemptNumber: 2, manualRerollsRemaining: 3 });
    expect(state.consumed).toEqual([]);
    expect(state.dice.map(die => die.value)).not.toEqual(attemptOneDice);

    state = forceBust(state).state;
    expect(state).toMatchObject({ phase: 'shop', lives: 1, roundAttemptNumber: 3 });
    state = dispatch(state, { type: 'RETRY_ROUND' }).state;
    state = forceBust(state).state;
    expect(state).toMatchObject({ phase: 'lost', lives: 0, round, roundAttemptNumber: 3 });
    expect(state.bust).toMatchObject({ livesBefore: 1, livesAfter: 0 });
    expect(state.shop).toBeNull();
    expect(state.roundCheckpoint).toBeNull();
    expect(state.stats.busts).toHaveLength(3);
    expect(state.stats.busts.map(item => item.retryStarted)).toEqual([true, true, false]);
    expect(validateAction(state, { type: 'RESTORE_LIFE' })).toContain('open shop');
  });

  it('reproduces retry outcomes for the same seed while making attempt RNG distinct', () => {
    const retry = () => dispatch(forceBust(newRun('retry-rng').state).state, { type: 'RETRY_ROUND' }).state;
    const first = retry();
    const second = retry();
    expect(first.dice.map(die => die.value)).toEqual(second.dice.map(die => die.value));
    expect(first.rngState).toBe(second.rngState);
    expect(first.roundAttemptNumber).toBe(2);
    expect(first.dice.map(die => die.value)).not.toEqual(newRun('retry-rng').state.dice.map(die => die.value));
  });

  it('restores the exact pre-attempt Shop without rewards or regeneration', () => {
    const state = shop('same-bust-shop');
    state.gold = 37;
    state.shop = {
      offers: [{ id: 41, enhancement: 'bonus', purchased: true }, { id: 42, enhancement: 'workout', purchased: false }],
      trainingOffers: [{ hand: 'ones', purchased: true }, { hand: 'pair', purchased: false }],
      diceRerolls: 2,
      offerRerolls: 1,
      lifeRestores: 0,
    };
    state.dice.forEach((die, index) => { die.value = (index + 1) as Rank; });
    activeFace(state.dice[0]).enhancements.bonus = 1;
    state.dice[1].flame = { id: 'wellTrained', investedGold: 23 };
    state.handLevels.ones = 2;
    const expectedShop = structuredClone(state.shop);
    const expectedDice = structuredClone(state.dice);

    const attempt = dispatch(state, { type: 'NEXT_ROUND' }, constant(0.2)).state;
    const result = forceBust(attempt);
    expect(result.state).toMatchObject({ phase: 'shop', round: 2, roundAttemptNumber: 2, lives: 2, gold: 37, score: 0 });
    expect(result.state.shop).toEqual(expectedShop);
    expect(result.state.dice).toEqual(expectedDice);
    expect(result.state.handLevels.ones).toBe(2);
    expect(result.state.stats.goldBySource).toMatchObject({ roundBase: 0, unusedRerolls: 0, interest: 0, bossReward: 0 });
    expect(result.state.flameSelection).toBeNull();
    expect(result.events.slice(-3).map(event => event.type)).toEqual(['ROUND_BUST', 'MAP_TRANSITION', 'SHOP_REOPENED_AFTER_BUST']);
    expect(result.state.stats.busts.at(-1)).toMatchObject({ round: 2, attempt: 1, checkpointRestored: true, returnedToShop: true });
  });

  it('captures post-Bust purchases as the next attempt checkpoint', () => {
    let state = shop('bust-purchase-checkpoint');
    state.gold = 20;
    state.shop!.offers = [{ id: 7, enhancement: 'bonus', purchased: false }];
    state = forceBust(dispatch(state, { type: 'NEXT_ROUND' }, constant(0.2)).state).state;
    expect(state).toMatchObject({ phase: 'shop', roundAttemptNumber: 2 });
    state = dispatch(state, { type: 'BUY', offerId: 7, dieId: 0 }).state;
    const boughtFace = activeFace(state.dice[0]).rank;
    expect(state.gold).toBe(17);
    state = dispatch(state, { type: 'RETRY_ROUND' }, constant(0.2)).state;
    expect(state.roundAttemptNumber).toBe(2);
    state = forceBust(state).state;
    expect(state).toMatchObject({ phase: 'shop', roundAttemptNumber: 3, gold: 17 });
    expect(state.dice[0].faces[boughtFace - 1].enhancements.bonus).toBe(1);
    expect(state.shop!.offers[0].purchased).toBe(true);
  });

  it('keeps a post-Bust sale in the second checkpoint', () => {
    let state = shop('bust-sale-checkpoint');
    state.gold = 10;
    activeFace(state.dice[0]).enhancements.workout = 1;
    state = forceBust(dispatch(state, { type: 'NEXT_ROUND' }, constant(0.2)).state).state;
    const soldRank = activeFace(state.dice[0]).rank;
    state = dispatch(state, { type: 'SELL_ENHANCEMENT', dieId: 0, face: soldRank, enhancement: 'workout' }).state;
    expect(state.gold).toBe(12);
    state = dispatch(state, { type: 'RETRY_ROUND' }, constant(0.2)).state;
    state = forceBust(state).state;
    expect(state.gold).toBe(12);
    expect(state.dice[0].faces[soldRank - 1].enhancements.workout).toBeUndefined();
    expect(state.stats.sales).toHaveLength(1);
  });

  it('includes a post-Bust life restore in the next checkpoint before losing another life', () => {
    let state = shop('bust-life-checkpoint');
    state.gold = 100;
    state = forceBust(dispatch(state, { type: 'NEXT_ROUND' }, constant(0.2)).state).state;
    expect(state.lives).toBe(2);
    state = dispatch(state, { type: 'RESTORE_LIFE' }).state;
    expect(state).toMatchObject({ lives: 3, gold: 75, shop: { lifeRestores: 1 } });
    state = dispatch(state, { type: 'RETRY_ROUND' }, constant(0.2)).state;
    state = forceBust(state).state;
    expect(state).toMatchObject({ phase: 'shop', lives: 2, gold: 75, roundAttemptNumber: 3, shop: { lifeRestores: 1 } });
    expect(lifeRestoreCost(state.shop!.lifeRestores)).toBe(40);
  });

  it('rolls back failed-attempt Gold, Workout, Trainer, history, and Vintage growth', () => {
    const state = newRun('rollback', constant(0.2)).state;
    state.gold = 10;
    state.bonfires.push('personalTrainer');
    const face = state.dice[0].faces[0];
    face.enhancements.golden = 1;
    face.enhancements.workout = 1;
    face.enhancements.vintage = 1;
    face.vintageSellValue = 0;
    state.roundCheckpoint = compactCheckpoint(state);
    const checkpointDice = state.dice.map(die => die.value);
    state.gold = 99;
    state.stats.goldBySource.jackpot = 3;
    state.chargeXMult = 4;
    state.chargeArmed = true;
    state.hotStreakCharges = 3;

    const result = forceBust(state, constant(0));
    expect(result.events.some(event => event.type === 'VINTAGE_GROWN')).toBe(true);
    expect(result.events.some(event => event.type === 'WORKOUT_INCREMENTED')).toBe(true);
    expect(result.state).toMatchObject({ phase: 'shop', gold: 10, score: 0, manualRerollsRemaining: 3 });
    expect(result.state.dice[0].faces[0]).toMatchObject({ workoutPips: 0, vintageSellValue: 0 });
    expect(result.state.handLevels.ones).toBe(1);
    expect(result.state.handPlayCounts.ones).toBe(0);
    expect(result.state.stats.goldBySource.golden).toBe(0);
    expect(result.state.stats.goldBySource.jackpot).toBe(0);
    expect(result.state.stats.vintageGrowth).toEqual([]);
    expect(result.state.chargeXMult).toBe(1);
    expect(result.state.chargeArmed).toBe(false);
    expect(result.state.hotStreakCharges).toBe(0);
    expect(result.state.consumed).toEqual([]);
    expect(result.state.dice.map(die => die.value)).toEqual(checkpointDice);
  });

  it('does not pay clear rewards or Boss Reward on Bust, then can pay normally after a retry clear', () => {
    let state = newRun('bust-payout', constant(0.2)).state;
    state.round = 3;
    state.target = 50;
    state.stats.rounds.at(-1)!.round = 3;
    state.stats.rounds.at(-1)!.target = 50;
    state.roundCheckpoint = compactCheckpoint(state);
    const busted = forceBust(state).state;
    expect(busted.stats.goldBySource).toMatchObject({ roundBase: 0, unusedRerolls: 0, interest: 0, bossReward: 0 });
    state = dispatch(busted, { type: 'RETRY_ROUND' }, constant(0.2)).state;
    state.target = 1;
    state.stats.rounds.at(-1)!.target = 1;
    const choice = state.dice.find(die => die.value === 1) ?? state.dice[0];
    choice.value = 1;
    const cleared = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [choice.id] }, constant()).state;
    expect(cleared.stats.goldBySource.roundBase).toBe(5);
    expect(cleared.stats.goldBySource.bossReward).toBe(10);
  });
});

describe('life restoration economy', () => {
  it('uses the exact escalating progression and continues its growing increments', () => {
    expect(Array.from({ length: 10 }, (_, index) => lifeRestoreCost(index)))
      .toEqual([25, 40, 60, 90, 130, 180, 240, 310, 390, 480]);
    expect([lifeRestoreCost(10), lifeRestoreCost(11)]).toEqual([580, 690]);
  });

  it('starts a freshly reached Shop at 25 Gold', () => {
    const state = clearIntoShop(newRun('fresh-restore-shop', constant(0.2)).state);
    expect(state).toMatchObject({ phase: 'shop', shop: { lifeRestores: 0 } });
    expect(lifeRestoreCost(state.shop!.lifeRestores)).toBe(25);
  });

  it('escalates multiple purchases within the same Shop', () => {
    let state = shop();
    state.lives = 2;
    state.gold = 1000;
    const expected = [25, 40, 60, 90];
    for (const cost of expected) {
      state = dispatch(state, { type: 'RESTORE_LIFE' }).state;
      expect(state.lives).toBe(3);
      expect(state.stats.lifeRestores.at(-1)).toMatchObject({ cost, livesBefore: 2, livesAfter: 3 });
      state.lives = 2;
    }
    expect(state.shop!.lifeRestores).toBe(4);
    expect(lifeRestoreCost(state.shop!.lifeRestores)).toBe(130);
  });

  it('preserves escalation when a Bust returns to the same pre-round Shop', () => {
    let state = shop('same-shop-restore-price');
    state.lives = 1;
    state.gold = 1000;
    state = dispatch(state, { type: 'RESTORE_LIFE' }).state;
    state = forceBust(dispatch(state, { type: 'NEXT_ROUND' }, constant(0.2)).state).state;

    expect(state).toMatchObject({ phase: 'shop', lives: 1, shop: { lifeRestores: 1 } });
    expect(lifeRestoreCost(state.shop!.lifeRestores)).toBe(40);
    state = dispatch(state, { type: 'RESTORE_LIFE' }).state;
    expect(state).toMatchObject({ lives: 2, gold: 935, shop: { lifeRestores: 2 } });
    expect(state.stats.lifeRestores.map(purchase => purchase.cost)).toEqual([25, 40]);
  });

  it('resets restoration pricing after clearing the encounter and reaching the next new Shop', () => {
    let state = shop('next-shop-restore-price');
    state.lives = 1;
    state.gold = 1000;
    state = dispatch(state, { type: 'RESTORE_LIFE' }).state;
    state = forceBust(dispatch(state, { type: 'NEXT_ROUND' }, constant(0.2)).state).state;
    state = dispatch(state, { type: 'RESTORE_LIFE' }).state;
    state = dispatch(state, { type: 'RETRY_ROUND' }, constant(0.2)).state;
    state = clearIntoShop(state);

    expect(state).toMatchObject({ phase: 'shop', shop: { lifeRestores: 0 } });
    expect(lifeRestoreCost(state.shop!.lifeRestores)).toBe(25);
  });

  it('counts life restoration spending toward Money to Burn exactly as before', () => {
    let state = shop('restore-money-to-burn');
    state.lives = 1;
    state.gold = 1000;
    state = dispatch(state, { type: 'RESTORE_LIFE' }).state;
    state.lives = 1;
    state = dispatch(state, { type: 'RESTORE_LIFE' }).state;

    expect(state.lifetimeNormalShopGoldSpent).toBe(65);
    expect(state.stats.lifetimeNormalShopGoldSpent).toBe(65);
    expect(state.stats.goldSpentBySource.lifeRestore).toBe(65);
    expect(state.stats.lifeRestores.at(-1)).toMatchObject({
      cost: 40, lifetimeSpendBefore: 25, lifetimeSpendAfter: 65,
    });
  });

  it('rejects insufficient Gold and full-life purchases', () => {
    const state = shop();
    state.lives = 2;
    state.gold = 24;
    expect(validateAction(state, { type: 'RESTORE_LIFE' })).toContain('Not enough');
    state.gold = 25;
    state.lives = CONFIG.maxLives;
    expect(validateAction(state, { type: 'RESTORE_LIFE' })).toContain('already restored');
  });
});

describe('enhancement selling and Vintage', () => {
  it('keeps authoritative buy/sell metadata, including the Sticky and Slippy price changes', () => {
    const expected = {
      sticky: [2, 1], slippy: [2, 1], jumpingBean: [2, 1], golden: [2, 1], missingLink: [2, 1],
      mirror: [2, 1], hitchhiker: [2, 1], bump: [2, 1], bonus: [3, 1], workout: [3, 2],
      magnetic: [3, 2], weighted: [3, 2], jackpot: [3, 1], vintage: [3, 0],
    } as const;
    for (const id of ENHANCEMENT_IDS) {
      expect([ENHANCEMENTS[id].purchasePrice, ENHANCEMENTS[id].baseSellPrice]).toEqual(expected[id]);
      expect(ENHANCEMENTS[id].baseSellPrice).toBeLessThan(ENHANCEMENTS[id].purchasePrice);
    }
    expect(ENHANCEMENTS.vintage.stackable).toBe(false);
  });

  it('sells all stacks, pays immediately, frees the slot, and never rewrites spend history', () => {
    let state = shop();
    state.gold = 10;
    state.lifetimeNormalShopGoldSpent = 50;
    state.stats.lifetimeNormalShopGoldSpent = 50;
    const face = activeFace(state.dice[0]);
    face.enhancements.golden = 3;
    const rank = face.rank;
    expect(enhancementSellValue(face, 'golden')).toBe(3);
    state = dispatch(state, { type: 'SELL_ENHANCEMENT', dieId: 0, face: rank, enhancement: 'golden' }).state;
    expect(state.gold).toBe(13);
    expect(activeFace(state.dice[0]).enhancements.golden).toBeUndefined();
    expect(state.lifetimeNormalShopGoldSpent).toBe(50);
    expect(state.stats.sales.at(-1)).toMatchObject({ stacksSold: 3, baseSellPrice: 1, totalProceeds: 3, goldBefore: 10, goldAfter: 13 });

    state.shop!.offers = [{ id: 99, enhancement: 'golden', purchased: false }];
    state = dispatch(state, { type: 'BUY', offerId: 99, dieId: 0 }).state;
    expect(activeFace(state.dice[0]).enhancements.golden).toBe(1);
  });

  it('grows Vintage once for selected, successful Hitchhiker, and Jumping Bean scoring participation', () => {
    const normal = newRun('vintage-normal', constant(0.2)).state;
    normal.target = 100000;
    normal.dice[0].value = 1;
    normal.dice[0].faces[0].enhancements.vintage = 1;
    normal.dice[0].faces[0].vintageSellValue = 0;
    const normalResult = dispatch(normal, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    expect(normalResult.state.dice[0].faces[0].vintageSellValue).toBe(3);
    expect(normalResult.state.stats.vintageGrowth.at(-1)).toMatchObject({ participation: 'selected', from: 0, to: 3 });
    const repeatResolver = new Resolver(normalResult.state, constant(0));
    repeatResolver.whenScored(0, structuredClone(normalResult.state.dice[0].faces[0]), 'ones', 'manual', 'selected');
    expect(normalResult.state.dice[0].faces[0].vintageSellValue).toBe(6);
    expect(normalResult.state.stats.vintageGrowth.at(-1)).toMatchObject({ from: 3, to: 6 });

    const hitch = newRun('vintage-hitch', constant(0.2)).state;
    hitch.target = 100000;
    hitch.dice[0].value = 1;
    hitch.dice[4].value = 6;
    hitch.dice[4].faces[5].enhancements.hitchhiker = 1;
    hitch.dice[4].faces[5].enhancements.vintage = 1;
    hitch.dice[4].faces[5].vintageSellValue = 0;
    const hitchResult = dispatch(hitch, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    expect(hitchResult.state.dice[4].faces[5].vintageSellValue).toBe(3);
    expect(hitchResult.state.stats.vintageGrowth.at(-1)?.participation).toBe('hitchhiker');

    const bean = newRun('vintage-bean', constant(0.2)).state;
    bean.target = 100000;
    bean.dice[0].faces[5].enhancements.jumpingBean = 1;
    bean.dice[0].faces[5].enhancements.vintage = 1;
    bean.dice[0].faces[5].vintageSellValue = 0;
    const beanResult = dispatch(bean, { type: 'MANUAL_REROLL', dieIds: [0] }, sequence(0.99, 0));
    expect(beanResult.state.dice[0].faces[5].vintageSellValue).toBe(3);
    expect(beanResult.state.stats.vintageGrowth.at(-1)).toMatchObject({ playSource: 'jumpingBean', from: 0, to: 3 });
  });

  it('does not grow Vintage for display, failed Hitchhiker, Shop rolls, or Flame Selection rolls', () => {
    const state = newRun('vintage-no-growth', constant(0.2)).state;
    state.target = 100000;
    state.dice[4].value = 6;
    const face = state.dice[4].faces[5];
    face.enhancements.hitchhiker = 1;
    face.enhancements.vintage = 1;
    face.vintageSellValue = 0;
    state.dice[0].value = 1;
    const failed = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0.99)).state;
    expect(failed.dice[4].faces[5].vintageSellValue).toBe(0);

    failed.phase = 'shop';
    failed.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    failed.gold = 100;
    const shopRoll = dispatch(failed, { type: 'REROLL_DICE' }, constant(0.99)).state;
    expect(shopRoll.dice[4].faces[5].vintageSellValue).toBe(0);
    new Resolver(shopRoll, constant(0.99)).rollBatch([4], 'Flame Selection roll test', 'flameSelection');
    expect(shopRoll.dice[4].faces[5].vintageSellValue).toBe(0);
  });

  it('sells Vintage at its current uncapped value and repurchase starts again at 0', () => {
    let state = shop('vintage-sale');
    state.gold = 20;
    const face = activeFace(state.dice[0]);
    face.enhancements.vintage = 1;
    face.vintageSellValue = 31;
    const rank = face.rank;
    state = dispatch(state, { type: 'SELL_ENHANCEMENT', dieId: 0, face: rank, enhancement: 'vintage' }).state;
    expect(state.gold).toBe(51);
    expect(activeFace(state.dice[0]).vintageSellValue).toBeUndefined();
    expect(state.stats.sales.at(-1)).toMatchObject({ totalProceeds: 31, vintageSellValue: 31 });
    state.shop!.offers = [{ id: 1, enhancement: 'vintage', purchased: false }];
    state = dispatch(state, { type: 'BUY', offerId: 1, dieId: 0 }).state;
    expect(activeFace(state.dice[0]).vintageSellValue).toBe(0);
  });
});

describe('Flame Selection spending boundary and tutorial state', () => {
  it('schedules the first-Flame tutorial, forbids Reward Stoke, and completes the tutorial once in Shop', () => {
    let state = newRun('first-flame', constant(0.2)).state;
    state.phase = 'flameSelection';
    state.gold = 100;
    state.flameSelection = { offers: [{ id: 1, flame: 'ultimate' }], acquired: false };
    state.shop = null;
    state = dispatch(state, { type: 'CHOOSE_FLAME', offerId: 1, dieId: 2 }).state;
    expect(state.flameTutorial).toEqual({ pendingDieId: 2, completed: false });
    expect(validateAction(state, { type: 'STOKE_FLAME', dieId: 2, amount: 1 })).toContain('normal Shop');
    state = dispatch(state, { type: 'CONTINUE_FLAME_SELECTION' }, constant(0.2)).state;
    expect(state.phase).toBe('shop');
    expect(state.flameTutorial.pendingDieId).toBe(2);
    state = dispatch(state, { type: 'DISMISS_FLAME_TUTORIAL' }).state;
    expect(state.flameTutorial).toEqual({ pendingDieId: null, completed: true });
    expect(state.stats.flameAcquisitions).toHaveLength(1);
  });

  it('keeps Stoke excluded from Money to Burn spend while life restoration counts', () => {
    let state = shop('spend-boundary');
    state.gold = 100;
    state.lives = 2;
    state.dice[0].flame = { id: 'moneyToBurn', investedGold: 0 };
    state = dispatch(state, { type: 'STOKE_FLAME', dieId: 0, amount: 10 }).state;
    expect(state.lifetimeNormalShopGoldSpent).toBe(0);
    state = dispatch(state, { type: 'RESTORE_LIFE' }).state;
    expect(state.lifetimeNormalShopGoldSpent).toBe(25);
  });
});
