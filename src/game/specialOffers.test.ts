import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { HAND_IDS } from './hands';
import { getRoundGoalBreakdown, targetForRound } from './goals';
import { postBossRewardForRound, routeThrough } from './progression';
import { loadPersistedRun, savePersistedRun } from './persistence';
import {
  activeSpecialOfferStatusItems, captureBustPersistentSpecialOfferState, initialSpecialOfferEffects,
  restoreSpecialOfferEffectsAfterBust, SPECIAL_OFFER_COLOR, SPECIAL_OFFERS, specialOfferEligible,
  usableManualRerolls,
} from './specialOffers';
import { SCREEN_THEMES } from './screenThemes';
import { classifyRunHistoryV2Timelines } from './runHistoryV2Timeline';
import { flameByType, placeFlameInstance } from './flames';
import type { GameState, HandId, RandomSource, RoundSummary, SpecialOfferType } from './types';
import { rosterDice, syncActiveDiceProjection } from './inventory';

const constant = (value = 0): RandomSource => ({ next: () => value });

function offerState(type: SpecialOfferType, hand?: HandId): GameState {
  const state = newRun(`offer-${type}`, constant(.2)).state;
  state.phase = 'specialOffer';
  state.round = 3;
  state.shop = null;
  state.flameSelection = null;
  state.specialOffer = { offers: [{ id: 100, type, hand }], acquired: false };
  return state;
}

const choose = (type: SpecialOfferType, hand?: HandId, random: RandomSource = constant()) =>
  dispatch(offerState(type, hand), { type: 'CHOOSE_SPECIAL_OFFER', offerId: 100 }, random).state;

const unlockShop = (state: GameState, random: RandomSource = constant()) => {
  let next = state.shop?.exitUnlocked === false ? dispatch(state, { type: 'UNLOCK_SHOP_EXIT' }, random).state : state;
  if (next.shop?.stage === 'dice') next = dispatch(next, { type: 'SET_SHOP_STAGE', stage: 'training' }, random).state;
  if (next.shop?.stage === 'training') next = dispatch(next, { type: 'SET_SHOP_STAGE', stage: 'fireKeeping' }, random).state;
  return next;
};

function carePackageRound(random: RandomSource = constant(.4)): GameState {
  const state = unlockShop(choose('carePackage'), random);
  return dispatch(state, { type: 'NEXT_ROUND' }, random).state;
}

function summary(round: number): RoundSummary {
  return { round, encounterType: 'boss', bossType: 'juggler', score: 1n, target: 1n, goldBefore: 0, goldAfter: 0,
    totalGoldEarned: 0, sources: { baseRewardGold: 0, unusedRerollGold: 0, interestGold: 0,
      bossRewardGold: 0, goldenGold: 0, jackpotGold: 0, otherGold: 0 } };
}

describe('alternating Special Offer progression', () => {
  it('routes Mini-Bosses to Special Offers and Big Bosses to Flame Selection', () => {
    expect([3, 6, 9, 12, 15, 18].map(postBossRewardForRound))
      .toEqual(['specialOffer', 'flame', 'specialOffer', 'flame', 'specialOffer', 'flame']);
    const route = routeThrough('offers-route', 12);
    expect(route.filter(node => node.type === 'flame_selection').map(node => node.round)).toEqual([6, 12]);
    expect(route.filter(node => node.type === 'special_offer').map(node => node.round)).toEqual([3, 9]);
    expect(SCREEN_THEMES.specialOffer.accent).toBe(SPECIAL_OFFER_COLOR);
  });

  it('generates three distinct seeded eligible offers and fixes a generated Focus hand', () => {
    const state = offerState('greatFairy');
    state.specialOffer = { offers: [], acquired: false };
    const resolver = new Resolver(state, constant(0));
    resolver.freshSpecialOffers();
    expect(state.specialOffer.offers).toHaveLength(3);
    expect(new Set(state.specialOffer.offers.map(offer => offer.type)).size).toBe(3);
    const focus = state.specialOffer.offers.find(offer => offer.type === 'focus');
    expect(focus?.hand).toBeDefined();
    const replay = offerState('greatFairy');
    replay.specialOffer = { offers: [], acquired: false };
    new Resolver(replay, constant(0)).freshSpecialOffers();
    expect(replay.specialOffer.offers).toEqual(state.specialOffer.offers);
  });

  it('centralizes Fire Keeper eligibility without legacy face-effect offers', () => {
    const state = offerState('greatFairy');
    expect(specialOfferEligible(state, 'fireKeeper')).toBe(false);
    placeFlameInstance(state, 'ultimate', 20);
    expect(specialOfferEligible(state, 'fireKeeper')).toBe(true);
  });
});

describe('immediate and Shop Special Offers', () => {
  it('On The House makes only initial displayed purchases free once', () => {
    let state = choose('onTheHouse');
    expect(activeSpecialOfferStatusItems(state.specialOfferEffects)).toEqual([]);
    expect(state.shop?.freeDicePurchaseAvailable).toBe(true);
    expect(state.shop?.trainingSession?.freeTrainingAvailable).toBe(true);
    const dieOffer = state.shop!.offers[0];
    state = dispatch(state, { type: 'BUY_DIE', offerId: dieOffer.id }, constant()).state;
    expect(state.shop?.freeDicePurchaseAvailable).toBe(false);
    expect([...state.historyV2].reverse().find(event => event.kind === 'shop_transaction'
      && event.transaction.type === 'dice_purchased')).toMatchObject({ transaction: { pricePaid: 0 } });
    state = dispatch(state, { type: 'SET_SHOP_STAGE', stage: 'training' }, constant()).state;
    state = dispatch(state, { type: 'TRAIN_HAND', hand: 'pair' }, constant()).state;
    expect(state.stats.trainingPurchases.at(-1)?.cost).toBe(0);
    state.gold = 100;
    state = dispatch(state, { type: 'TRAIN_HAND', hand: 'pair' }, constant()).state;
    expect(state.stats.trainingPurchases.at(-1)?.cost).toBe(4);
    state = dispatch(state, { type: 'SET_SHOP_STAGE', stage: 'dice' }, constant()).state;
    state = dispatch(state, { type: 'REROLL_OFFERS' }, constant()).state;
    expect(state.shop!.freeDicePurchaseAvailable).toBe(false);
  });

  it('Great Fairy restores Lives or grants 15 Gold at full Lives', () => {
    const hurt = offerState('greatFairy');
    hurt.lives = 1;
    expect(dispatch(hurt, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 100 }).state.lives).toBe(3);
    const full = choose('greatFairy');
    expect(full.gold).toBe(15);
    expect(full.stats.goldBySource.specialOffer).toBe(15);
  });

  it('Focus grants exactly four fixed hand levels without training spend', () => {
    const state = choose('focus', 'fullHouse');
    expect(state.handLevels.fullHouse).toBe(5);
    expect(state.stats.trainingPurchases).toEqual([]);
    expect(state.stats.trainingGoldSpent).toBe(0);
    expect(state.actionJournal.at(-1)).toEqual({ type: 'CHOOSE_SPECIAL_OFFER', offerId: 100 });
  });

  it('Fire Keeper updates every applicable Flame deterministically', () => {
    for (const [from, to] of [[20, 60], [60, 80], [90, 95]] as const) {
      const ember = offerState('fireKeeper');
      placeFlameInstance(ember, 'ultimate', from);
      const stoked = dispatch(ember, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 100 }, constant(0)).state;
      expect(flameByType(stoked, 'ultimate')?.investedGold).toBe(to);
    }
  });
});

describe('temporary Special Offers', () => {
  it('derives compact status badges only for unresolved persistent effects', () => {
    const effects = initialSpecialOfferEffects();
    Object.assign(effects, {
      onTheHouse: true,
      carePackageRerolls: 2,
      silence: true,
      taxEvasionRounds: 1,
      bottledFairyRounds: 2,
      badDreamRounds: 3,
    });
    expect(activeSpecialOfferStatusItems(effects).map(status => [status.type, status.label])).toEqual([
      ['onTheHouse', 'On The House · Next Shop'],
      ['carePackage', 'Care Package · 2 Rerolls Left'],
      ['silence', 'Silence · Next Boss'],
      ['taxEvasion', 'Tax Evasion · 1 Round'],
      ['bottledFairy', 'Bottled Fairy · 2 Rounds'],
      ['badDream', 'Bad Dream · 3 Rounds'],
    ]);
    expect(activeSpecialOfferStatusItems(effects).every(status => status.description === SPECIAL_OFFERS[status.type].description)).toBe(true);
    expect(activeSpecialOfferStatusItems(initialSpecialOfferEffects())).toEqual([]);
  });

  it('Care Package spends normal Rerolls first and keeps reserve charges persistent', () => {
    let state = choose('carePackage');
    expect(state.specialOfferEffects.carePackageRerolls).toBe(3);
    state.phase = 'round';
    state.manualRerollsRemaining = 1;
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1] }, constant(.4)).state;
    expect(state.manualRerollsRemaining).toBe(0);
    expect(state.specialOfferEffects.carePackageRerolls).toBe(2);
    expect(activeSpecialOfferStatusItems(state.specialOfferEffects)[0]?.label).toBe('Care Package · 2 Rerolls Left');
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [2] }, constant(.4)).state;
    expect(state.specialOfferEffects.carePackageRerolls).toBe(1);
    expect(activeSpecialOfferStatusItems(state.specialOfferEffects)[0]?.label).toBe('Care Package · 1 Reroll Left');
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [3] }, constant(.4)).state;
    expect(state.specialOfferEffects.carePackageRerolls).toBe(0);
    expect(activeSpecialOfferStatusItems(state.specialOfferEffects)).toEqual([]);
  });

  it.each([3, 2, 0])('ordinary Bust restoration preserves the current Care Package reserve of %s', remaining => {
    const checkpoint = initialSpecialOfferEffects();
    checkpoint.carePackageRerolls = 3;
    const current = structuredClone(checkpoint);
    current.carePackageRerolls = remaining;
    const restored = restoreSpecialOfferEffectsAfterBust(
      checkpoint,
      captureBustPersistentSpecialOfferState(current),
    );
    expect(restored.carePackageRerolls).toBe(remaining);
  });

  it('keeps a dead board playable until the final Care Package Reroll is spent', () => {
    let state = choose('carePackage');
    state = unlockShop(state);
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant(.2)).state;
    state.target = 1_000_000n;
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;

    const unresolved = new Resolver(state, constant());
    unresolved.evaluate();
    expect(usableManualRerolls(state)).toBe(3);
    expect(unresolved.events.at(-1)?.type).toBe('DEAD_BOARD');
    expect(unresolved.events.some(event => event.type === 'ROUND_BUST')).toBe(false);

    for (const remaining of [2, 1]) {
      const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant());
      state = result.state;
      expect(state.specialOfferEffects.carePackageRerolls).toBe(remaining);
      expect(usableManualRerolls(state)).toBe(remaining);
      expect(state.phase).toBe('round');
      expect(result.events.at(-1)?.type).toBe('DEAD_BOARD');
      expect(result.events.some(event => event.type === 'ROUND_BUST')).toBe(false);
    }

    const exhausted = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant());
    expect(exhausted.events.some(event => event.type === 'ROUND_BUST')).toBe(true);
    expect(exhausted.state.phase).toBe('shop');
    expect(exhausted.state.specialOfferEffects.carePackageRerolls).toBe(0);
    expect(activeSpecialOfferStatusItems(exhausted.state.specialOfferEffects)).toEqual([]);
  });

  it('does not refund six spent Rerolls through the Bust checkpoint', () => {
    let state = carePackageRound();
    state.target = 1_000_000n;
    state.consumed = [...HAND_IDS];

    let result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1, 2] }, constant(.4));
    state = result.state;
    expect(state).toMatchObject({
      phase: 'round',
      manualRerollsRemaining: 0,
      specialOfferEffects: { carePackageRerolls: 3 },
    });
    expect(result.events.find(event => event.type === 'MANUAL_REROLL_STARTED')?.message)
      .toBe('Manual reroll · 0 Rerolls left · Care Package 3');

    result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1, 2] }, constant(.4));
    state = result.state;
    expect(state.phase).toBe('shop');
    expect(state.specialOfferEffects.carePackageRerolls).toBe(0);
    expect(state.roundCheckpoint?.board.specialOfferEffects.carePackageRerolls).toBe(0);
    expect(result.events.find(event => event.type === 'MANUAL_REROLL_STARTED')?.message)
      .toBe('Care Package depleted · 0 Rerolls left');
    expect(result.events.find(event => event.type === 'SHOP_REOPENED_AFTER_BUST')?.message)
      .toContain('3 Rerolls left · Care Package 0');

    state = dispatch(unlockShop(state), { type: 'RETRY_ROUND' }, constant(.4)).state;
    expect(state).toMatchObject({
      phase: 'round',
      manualRerollsRemaining: 3,
      specialOfferEffects: { carePackageRerolls: 0 },
    });
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(.4)).state;
    expect(usableManualRerolls(state)).toBe(2);
    expect(state).toMatchObject({
      manualRerollsRemaining: 2,
      specialOfferEffects: { carePackageRerolls: 0 },
    });
  });

  it('keeps Care Package spending permanent through a Tightrope Bust and retry', () => {
    let state = choose('carePackage');
    state = unlockShop(state, constant(.4));
    state.bossSchedule[state.round + 1] = 'tightrope';
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant(.4)).state;
    expect(state.boss?.type).toBe('tightrope');
    expect(state.manualRerollsRemaining).toBe(0);
    state.target = 1_000_000n;
    state.consumed = [...HAND_IDS];

    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(.4)).state;
    expect(state.phase).toBe('round');
    expect(state.specialOfferEffects.carePackageRerolls).toBe(2);
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [1, 2] }, constant(.4)).state;
    expect(state.phase).toBe('shop');
    expect(state.specialOfferEffects.carePackageRerolls).toBe(0);

    state = dispatch(unlockShop(state), { type: 'RETRY_ROUND' }, constant(.4)).state;
    expect(state.boss?.type).toBe('tightrope');
    expect(state.manualRerollsRemaining).toBe(0);
    expect(state.specialOfferEffects.carePackageRerolls).toBe(0);
  });

  it('pays only unused normal Rerolls while leaving the Care Package reserve intact', () => {
    const state = carePackageRound();
    state.manualRerollsRemaining = 2;
    state.score = state.target;
    new Resolver(state, constant()).evaluate();
    expect(state.lastRoundPayout?.unusedRerollGold).toBe(2);
    expect(state.specialOfferEffects.carePackageRerolls).toBe(3);
  });

  it.each(['crawler', 'juggler'] as const)('uses Care Package Bust eligibility during the %s encounter', boss => {
    const state = choose('carePackage');
    state.phase = 'round';
    state.target = 1_000_000n;
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    state.boss = boss === 'crawler'
      ? { type: 'crawler' }
      : { type: 'juggler' };
    const resolver = new Resolver(state, constant());
    resolver.evaluate();
    expect(resolver.events.at(-1)?.type).toBe('DEAD_BOARD');
    expect(state.phase).toBe('round');
    expect(state.specialOfferEffects.carePackageRerolls).toBe(3);
  });

  it('Care Package charges carry into later Rounds without recharging', () => {
    let state = choose('carePackage');
    state.phase = 'round';
    state.manualRerollsRemaining = 0;
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(.4)).state;
    expect(state.specialOfferEffects.carePackageRerolls).toBe(2);
    new Resolver(state, constant(.4)).openShop();
    state = unlockShop(state, constant(.4));
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant(.4)).state;
    expect(state.manualRerollsRemaining).toBe(3);
    expect(state.specialOfferEffects.carePackageRerolls).toBe(2);
  });

  it('Tax Evasion doubles only Interest and expires by completed encounter', () => {
    const state = choose('taxEvasion');
    state.phase = 'round';
    state.gold = 10;
    state.score = state.target;
    state.stats.rounds.at(-1)!.goldBefore = 10;
    new Resolver(state, constant()).evaluate();
    expect(state.lastRoundPayout?.interestGold).toBe(4);
    expect(state.lastRoundPayout?.baseGold).toBe(5);
    expect(state.specialOfferEffects.taxEvasionRounds).toBe(2);
    expect(activeSpecialOfferStatusItems(state.specialOfferEffects)[0]?.label).toBe('Tax Evasion · 2 Rounds');
  });

  it('Bottled Fairy refills once per Round only after reserve Rerolls are exhausted', () => {
    const state = choose('bottledFairy');
    state.phase = 'round';
    state.target = 1_000_000n;
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    state.specialOfferEffects.carePackageRerolls = 1;
    const resolver = new Resolver(state, constant());
    resolver.evaluate();
    expect(state.phase).toBe('round');
    expect(state.manualRerollsRemaining).toBe(0);
    expect(state.specialOfferEffects.bottledFairyTriggeredThisRound).toBe(false);
    state.specialOfferEffects.carePackageRerolls = 0;
    resolver.evaluate();
    expect(state.manualRerollsRemaining).toBe(3);
    expect(state.specialOfferEffects.bottledFairyTriggeredThisRound).toBe(true);
    expect(activeSpecialOfferStatusItems(state.specialOfferEffects)[0]?.label).toBe('Bottled Fairy · 3 Rounds');
    state.manualRerollsRemaining = 0;
    resolver.evaluate();
    expect(state.phase).toBe('shop');
  });

  it('Silence is consumed at Boss start and uses the neutral Goal in state and history', () => {
    let state = choose('silence');
    expect(activeSpecialOfferStatusItems(state.specialOfferEffects)[0]?.label).toBe('Silence · Next Boss');
    state = unlockShop(state);
    state.round = 5;
    state.bossSchedule[6] = 'marathon';
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant(.3)).state;
    expect(state.boss?.type).toBe('marathon');
    expect(state.bossSilenced).toBe(true);
    expect(state.specialOfferEffects.silence).toBe(false);
    expect(activeSpecialOfferStatusItems(state.specialOfferEffects)).toEqual([]);
    expect(state.dice.every(die => die.owner === 'player')).toBe(true);
    expect(state.target).toBe(targetForRound(6));
    expect(state.target).not.toBe(targetForRound(6, 'marathon'));
    const started = [...state.historyV2].reverse().find(event => event.kind === 'round_attempt_started');
    expect(started?.kind === 'round_attempt_started' ? started.target : null)
      .toEqual(expect.objectContaining({ bossModifier: 1, postBossRawGoal: getRoundGoalBreakdown(6).neutralRawGoal,
        finalGoal: targetForRound(6) }));
  });

  it('On The House generates chapter-independent Dice offers', () => {
    const state = offerState('onTheHouse');
    state.round = 9;
    state.presentedChapters = [1, 2];
    const chosen = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 100 }, constant()).state;
    expect(chosen.phase).toBe('shop');
    expect(chosen.shop!.offers.every(offer => !!offer.dieType)).toBe(true);
    expect([...chosen.historyV2].reverse().find(event => event.kind === 'shop_offers_presented' && event.pool === 'dice'))
      .toMatchObject({ offers: expect.any(Array) });
  });

  it.each(['tightrope', 'quickdraw'] as const)('Silence gives %s the neutral Goal', boss => {
    let state = unlockShop(choose('silence'));
    state.round = 5;
    state.bossSchedule[6] = boss;
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant(.3)).state;
    expect(state.boss?.type).toBe(boss);
    expect(state.bossSilenced).toBe(true);
    expect(state.target).toBe(targetForRound(6));
    expect(state.target).not.toBe(targetForRound(6, boss));
  });

  it('leaves Marathon and ordinary Goals unchanged without an active Silence', () => {
    let marathon = unlockShop(choose('silence'));
    marathon.specialOfferEffects.silence = false;
    marathon.round = 5;
    marathon.bossSchedule[6] = 'marathon';
    marathon = dispatch(marathon, { type: 'NEXT_ROUND' }, constant(.3)).state;
    expect(marathon.bossSilenced).toBe(false);
    expect(marathon.target).toBe(targetForRound(6, 'marathon'));

    let ordinary = unlockShop(choose('silence'));
    ordinary.round = 3;
    delete ordinary.bossSchedule[4];
    ordinary = dispatch(ordinary, { type: 'NEXT_ROUND' }, constant(.3)).state;
    expect(ordinary.boss).toBeNull();
    expect(ordinary.specialOfferEffects.silence).toBe(true);
    expect(ordinary.target).toBe(targetForRound(4));
  });

  it('keeps a silenced Marathon neutral across save/load, Bust restoration, and retry', () => {
    let state = unlockShop(choose('silence'));
    state.round = 5;
    state.bossSchedule[6] = 'marathon';
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant(.3)).state;
    const neutral = targetForRound(6);
    const legacyBossGoal = targetForRound(6, 'marathon');

    // Simulate a persisted active encounter created before Silence selected
    // the neutral Goal. Loading must repair gameplay and its projections.
    state.target = legacyBossGoal;
    state.stats.rounds.at(-1)!.target = legacyBossGoal;
    const legacyStarted = [...state.historyV2].reverse().find(event => event.kind === 'round_attempt_started');
    if (legacyStarted?.kind === 'round_attempt_started')
      legacyStarted.target = getRoundGoalBreakdown(6, 'marathon');

    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(savePersistedRun(storage, state)).toBe(true);
    state = loadPersistedRun(storage, state.seed)!;
    expect(state.target).toBe(neutral);
    expect(state.roundCheckpoint?.board.target).toBe(neutral);
    expect(state.stats.rounds.at(-1)?.target).toBe(neutral);
    const loadedStarted = [...state.historyV2].reverse().find(event => event.kind === 'round_attempt_started');
    expect(loadedStarted?.kind === 'round_attempt_started' ? loadedStarted.target.finalGoal : null).toBe(neutral);

    state.score = 0n;
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    new Resolver(state, constant(.3)).evaluate();
    expect(state.phase).toBe('shop');
    expect(state.specialOfferEffects.silence).toBe(true);
    expect(state.target).toBe(neutral);

    state = dispatch(unlockShop(state), { type: 'RETRY_ROUND' }, constant(.3)).state;
    expect(state.boss?.type).toBe('marathon');
    expect(state.bossSilenced).toBe(true);
    expect(state.target).toBe(neutral);
    expect(state.stats.rounds.at(-1)?.target).toBe(neutral);
  });

  it('expires every unconsumed three-Round effect after three completed encounters', () => {
    const state = choose('taxEvasion');
    state.specialOfferEffects.taxEvasionRounds = 3;
    state.specialOfferEffects.bottledFairyRounds = 3;
    state.specialOfferEffects.badDreamRounds = 3;
    state.badDreamCheckpoint = { chapter: 1 };
    for (let index = 0; index < 3; index++) {
      state.phase = 'round';
      state.roundSummary = null;
      state.score = state.target;
      new Resolver(state, constant()).evaluate();
    }
    expect(state.specialOfferEffects).toMatchObject({ taxEvasionRounds: 0,
      bottledFairyRounds: 0, badDreamRounds: 0 });
    expect(state.badDreamCheckpoint).toBeNull();
  });
});

describe('replay and checkpoint Special Offers', () => {
  it('persists the depleted Care Package reserve after Bust and reload', () => {
    let state = carePackageRound();
    state.target = 1_000_000n;
    state.consumed = [...HAND_IDS];
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1, 2] }, constant(.4)).state;
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1, 2] }, constant(.4)).state;
    expect(state.phase).toBe('shop');
    expect(state.specialOfferEffects.carePackageRerolls).toBe(0);

    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(savePersistedRun(storage, state)).toBe(true);
    const loaded = loadPersistedRun(storage, state.seed)!;
    expect(loaded.specialOfferEffects.carePackageRerolls).toBe(0);
    expect(loaded.roundCheckpoint?.board.specialOfferEffects.carePackageRerolls).toBe(0);
    const retry = dispatch(loaded, { type: 'RETRY_ROUND' }, constant(.4)).state;
    expect(retry.manualRerollsRemaining).toBe(3);
    expect(retry.specialOfferEffects.carePackageRerolls).toBe(0);
  });

  it('Time Travel replays the completed block while the Chapter Special Offer remains consumed', () => {
    let state = offerState('timeTravel');
    state.engulfmentLevel = 2;
    state.handLevels.ones = 8;
    placeFlameInstance(state, 'lowball', 100);
    state.infernoEvaluationSuspendedUntilNewFlame = true;
    state = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 100 }, constant()).state;
    expect(state.round).toBe(1);
    expect(state.chapterLifecycle[1]?.specialOfferConsumed).toBe(true);
    expect(state.phase).toBe('round');
    expect(state.round).toBe(1);
    expect(state.currentNodeId).toBe('round:1');
    expect(state.engulfmentLevel).toBe(2);
    expect(state.handLevels.ones).toBe(8);
    expect(flameByType(state, 'lowball')).toMatchObject({ stage: 'bonfire' });
    expect(state.infernoEvaluationSuspendedUntilNewFlame).toBe(true);
    state.round = 3;
    state.phase = 'roundSummary';
    state.shop = null;
    state.roundSummary = summary(3);
    state = dispatch(state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant()).state;
    expect(state.phase).toBe('shop');
    expect(state.chapterLifecycle[1]?.specialOfferConsumed).toBe(true);
    expect(state.specialOffer).toBeNull();
  });

  it('Bad Dream relocates the current build to the post-R3 Shop once with 1 Life', () => {
    let state = offerState('badDream');
    state.specialOfferEffects.carePackageRerolls = 2;
    state = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 100 }, constant()).state;
    state.infernoEvaluationSuspendedUntilNewFlame = true;
    expect(activeSpecialOfferStatusItems(state.specialOfferEffects).find(status => status.type === 'badDream')?.label)
      .toBe('Bad Dream · 3 Rounds');
    const checkpoint = structuredClone(state.badDreamCheckpoint!);
    expect(checkpoint).toEqual({ chapter: 1 });
    state = unlockShop(state);
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant(.4)).state;
    state.gold = 77;
    state.handLevels.ones = 9;
    rosterDice(state)[0].type = 'vintage';
    rosterDice(state)[0].vintageAppreciation = 18;
    syncActiveDiceProjection(state);
    placeFlameInstance(state, 'ultimate', 61);
    state.engulfmentLevel = 3;
    placeFlameInstance(state, 'lowball', 100);
    state.lives = 1;
    state.target = 1_000_000n;
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 1;
    state.specialOfferEffects.carePackageRerolls = 0;
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(.4)).state;
    expect(state.phase).toBe('shop');
    expect(state.round).toBe(3);
    expect(state.currentNodeId).toBe('shop:before-round:4');
    expect(state.lives).toBe(1);
    expect(state.gold).toBe(77);
    expect(state.handLevels.ones).toBe(9);
    expect(state.dice[0]).toMatchObject({ type: 'vintage', vintageAppreciation: 18 });
    expect(flameByType(state, 'ultimate')).toMatchObject({ investedGold: 61 });
    expect(state.engulfmentLevel).toBe(3);
    expect(flameByType(state, 'lowball')).toMatchObject({ stage: 'bonfire' });
    expect(state.infernoEvaluationSuspendedUntilNewFlame).toBe(true);
    expect(state.badDreamCheckpoint).toBeNull();
    expect(state.specialOfferEffects.badDreamRounds).toBe(0);
    expect(state.specialOfferEffects.carePackageRerolls).toBe(0);
    expect(state.chapterLifecycle[1]?.specialOfferConsumed).toBe(true);
    expect(state.specialOffer).toBeNull();
    const timelines = classifyRunHistoryV2Timelines(state.historyV2, state.historyV2Coverage);
    expect(timelines.ranges.at(-1)?.reason).toBe('bad_dream');
    expect(state.historyV2.some(event => event.kind === 'round_attempt_finished' && timelines.status(event) === 'abandoned')).toBe(true);
    expect(state.historyV2.some(event => event.kind === 'shop_transaction'
      && event.transaction.type === 'special_offer_selected' && event.transaction.offer === 'badDream'
      && timelines.status(event) === 'canonical')).toBe(true);
  });

  it('persists an active Bad Dream checkpoint as part of the run', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const state = choose('badDream');
    expect(savePersistedRun(storage, state)).toBe(true);
    const loaded = loadPersistedRun(storage, state.seed);
    expect(loaded?.badDreamCheckpoint).toEqual(state.badDreamCheckpoint);
    expect(loaded?.specialOfferEffects.badDreamRounds).toBe(3);
  });

  it('keeps the canonical player-facing descriptions exact', () => {
    expect(SPECIAL_OFFERS.onTheHouse.description).toBe('Your first Dice purchase and first individual Training purchase in the next Shop are free.');
    expect(SPECIAL_OFFERS.timeTravel.description).toBe('Replay this Chapter from Round 1 with your current build.');
    expect(SPECIAL_OFFERS.badDream.description).toBe('If your run ends in the next 3 Rounds, return to the post-R3 Shop with your current build and 1 Life.');
  });
});
