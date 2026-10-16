import { describe, expect, it } from 'vitest';
import { stringifyExactJson } from './scoreMath';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { eligibleEnhancements, highestUnlockedEnhancementTier, maxEnhancementTypesPerFace } from './enhancements';
import { loadPersistedRun, RUN_STORAGE_KEY, RUN_STORAGE_VERSION, savePersistedRun } from './persistence';
import type { GameState, RandomSource } from './types';

const constant = (value = .31): RandomSource => ({ next: () => value });

function postBossFlameSelection(seed = 'chapter-boundary'): GameState {
  const state = newRun(seed, constant()).state;
  state.round = 6;
  state.phase = 'flameSelection';
  state.currentNodeId = 'flame:after-round:6';
  state.flameSelection = { offers: [], acquired: true };
  state.shop = null;
  state.roundSummary = null;
  state.presentedChapters = [1];
  delete state.chapterPlans[2];
  delete state.bossSchedule[9];
  delete state.bossSchedule[12];
  return state;
}

function memoryStorage() {
  let value: string | null = null;
  return {
    getItem: (key: string) => key === RUN_STORAGE_KEY ? value : null,
    setItem: (key: string, next: string) => { if (key === RUN_STORAGE_KEY) value = next; },
  };
}

describe('post-Boss Chapter boundary', () => {
  it('resumes the Boss summary and Flame Selection without replaying either reward', () => {
    const storage = memoryStorage();
    const summary = postBossFlameSelection('reward-resume');
    summary.phase = 'roundSummary';
    summary.flameSelection = null;
    summary.gold = 39;
    summary.roundSummary = {
      round: 6, encounterType: 'boss', bossType: 'caller', score: 500n, target: 450n,
      goldBefore: 10, goldAfter: 39, totalGoldEarned: 29,
      sources: { baseRewardGold: 5, unusedRerollGold: 3, interestGold: 1, bossRewardGold: 20,
        goldenGold: 0, jackpotGold: 0, otherGold: 0 },
    };
    const gold = summary.gold;
    savePersistedRun(storage, summary);
    const resumedSummary = loadPersistedRun(storage, summary.seed)!;
    const flame = dispatch(resumedSummary, { type: 'CONTINUE_ROUND_SUMMARY' }, constant());
    expect(flame.state.phase).toBe('flameSelection');
    expect(flame.state.gold).toBe(gold);
    expect(flame.events.filter(event => event.type === 'FLAME_SELECTION_OPENED')).toHaveLength(1);

    savePersistedRun(storage, flame.state);
    const resumedFlame = loadPersistedRun(storage, summary.seed)!;
    expect(resumedFlame.flameSelection).toEqual(flame.state.flameSelection);
    const shop = dispatch(resumedFlame, { type: 'SKIP_FLAME_SELECTION' }, constant());
    expect(shop.state.phase).toBe('shop');
    expect(shop.events.filter(event => event.type === 'FLAME_SELECTION_OPENED')).toHaveLength(0);
    expect(shop.events.filter(event => event.type === 'SHOP_OPENED')).toHaveLength(1);
  });

  it('opens exactly one persisted Shop in the completed Chapter and advances only from NEXT_CHAPTER', () => {
    const opened = dispatch(postBossFlameSelection(), { type: 'CONTINUE_FLAME_SELECTION' }, constant());
    expect(opened.state).toMatchObject({ phase: 'shop', round: 6, currentNodeId: 'shop:after-round:6' });
    expect(opened.state.shop?.kind).toBe('post_boss');
    expect(opened.state.presentedChapters).toEqual([1]);
    expect(opened.state.chapterPlans[2]).toBeUndefined();
    expect(opened.events.map(event => event.type)).toEqual(['MAP_TRANSITION', 'SHOP_OPENED']);
    expect(opened.events.filter(event => event.type === 'SHOP_OPENED')).toHaveLength(1);
    expect(opened.state.historyV2.filter(event => event.kind === 'chapter_started' && event.chapter === 2)).toHaveLength(0);
    expect(maxEnhancementTypesPerFace(1)).toBe(1);
    expect(highestUnlockedEnhancementTier(1)).toBe(0);
    expect(opened.state.shop!.offers.every(offer => eligibleEnhancements(1).includes(offer.enhancement))).toBe(true);
    expect(dispatch(opened.state, { type: 'NEXT_ROUND' }, constant()).error).toContain('one second');
    const unlocked = dispatch(opened.state, { type: 'UNLOCK_SHOP_EXIT' }, constant()).state;
    expect(dispatch(unlocked, { type: 'NEXT_ROUND' }, constant()).error).toContain('Next Chapter');

    const offers = structuredClone(opened.state.shop!.offers);
    const training = structuredClone(opened.state.shop!.trainingOffers);
    const nextOfferId = opened.state.nextOfferId;
    const advanced = dispatch(unlocked, { type: 'NEXT_CHAPTER' }, constant());
    expect(advanced.state).toMatchObject({ phase: 'round', round: 7, currentNodeId: 'round:7' });
    expect(advanced.state.presentedChapters).toEqual([1, 2]);
    expect(advanced.state.chapterPlans[2]).toBeDefined();
    expect(advanced.events.slice(0, 2).map(event => event.type)).toEqual(['CHAPTER_STARTED', 'MAP_TRANSITION']);
    expect(advanced.events.some(event => event.type === 'SHOP_OPENED' || event.type === 'OFFERS_REFRESHED')).toBe(false);
    expect(advanced.state.nextOfferId).toBe(nextOfferId);
    expect(offers).toHaveLength(3);
    expect(training).toHaveLength(3);
    expect(advanced.state.historyV2.filter(event => event.kind === 'shop_offers_presented')).toHaveLength(1);
    expect(advanced.state.historyV2.filter(event => event.kind === 'chapter_started' && event.chapter === 2)).toHaveLength(1);
    expect(maxEnhancementTypesPerFace(2)).toBe(2);
    expect(highestUnlockedEnhancementTier(2)).toBe(1);
    expect(advanced.events[0]).toMatchObject({ enhancementCapacityBefore: 1, enhancementCapacityAfter: 2,
      newlyUnlockedEnhancements: ['hitchhiker', 'weighted', 'bump', 'magnetic', 'jackpot'] });
    expect(advanced.state.historyV2.find(event => event.kind === 'chapter_started' && event.chapter === 2))
      .toMatchObject({ enhancementProgression: { capacityBefore: 1, capacityAfter: 2,
        newlyUnlocked: ['hitchhiker', 'weighted', 'bump', 'magnetic', 'jackpot'] } });
    expect(opened.state.shop!.offers).toEqual(offers);

    const chapterTwoShop = structuredClone(advanced.state);
    chapterTwoShop.phase = 'shop';
    chapterTwoShop.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    new Resolver(chapterTwoShop, constant(.72)).freshOffers();
    expect(chapterTwoShop.shop.offers.every(offer => eligibleEnhancements(2).includes(offer.enhancement))).toBe(true);
    expect([...chapterTwoShop.historyV2].reverse().find(event => event.kind === 'shop_offers_presented'))
      .toMatchObject({ chapter: 2, maxEnhancementTypesPerFace: 2, highestUnlockedEnhancementTier: 1 });

    const duplicate = dispatch(advanced.state, { type: 'NEXT_CHAPTER' }, constant());
    expect(duplicate.error).toContain('open shop');
    expect(duplicate.state).toBe(advanced.state);
  });

  it('keeps ordinary Shops on NEXT_ROUND and rejects NEXT_CHAPTER there', () => {
    const state = newRun('ordinary-shop', constant()).state;
    state.phase = 'shop';
    state.shop = { kind: 'between_rounds', offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    const rejected = dispatch(state, { type: 'NEXT_CHAPTER' }, constant());
    expect(rejected.error).toContain('final post-Boss Shop');
    expect(rejected.state).toBe(state);
    expect(dispatch(state, { type: 'NEXT_ROUND' }, constant()).state.round).toBe(2);
  });

  it('round-trips offers, purchases, rerolls, and ownership before and after the boundary', () => {
    let state = dispatch(postBossFlameSelection('chapter-resume'), { type: 'CONTINUE_FLAME_SELECTION' }, constant()).state;
    const storage = memoryStorage();
    const initialShop = structuredClone(state.shop);
    expect(savePersistedRun(storage, state)).toBe(true);
    state = loadPersistedRun(storage, state.seed)!;
    expect(state.shop).toEqual(initialShop);
    state.gold = 1_000;
    const offer = state.shop!.offers[0];
    state = dispatch(state, { type: 'BUY', offerId: offer.id, dieId: 0 }, constant()).state;
    state = dispatch(state, { type: 'REROLL_OFFERS' }, constant(.72)).state;
    const persistedShop = structuredClone(state.shop);
    const persistedDice = structuredClone(state.dice);
    const persistedPurchases = state.historyV2.filter(event => event.kind === 'shop_transaction'
      && event.transaction.type === 'enhancement_purchased');
    expect(savePersistedRun(storage, state)).toBe(true);

    const resumed = loadPersistedRun(storage, state.seed)!;
    expect(resumed).toMatchObject({ phase: 'shop', round: 6, currentNodeId: 'shop:after-round:6' });
    expect(resumed.shop).toEqual(persistedShop);
    expect(resumed.dice).toEqual(persistedDice);
    expect(resumed.stats.purchases).toEqual([]);
    expect(resumed.historyV2.filter(event => event.kind === 'shop_transaction'
      && event.transaction.type === 'enhancement_purchased')).toEqual(persistedPurchases);
    expect(resumed.shop?.offerRerolls).toBe(1);
    expect(resumed.stats.enhancementShopRerolls).toBe(1);

    const unlocked = dispatch(resumed, { type: 'UNLOCK_SHOP_EXIT' }, constant()).state;
    const advanced = dispatch(unlocked, { type: 'NEXT_CHAPTER' }, constant()).state;
    expect(savePersistedRun(storage, advanced)).toBe(true);
    const resumedChapter = loadPersistedRun(storage, advanced.seed)!;
    expect(resumedChapter).toMatchObject({ phase: 'round', round: 7, currentNodeId: 'round:7' });
    expect(resumedChapter.stats.purchases).toEqual([]);
    expect(resumedChapter.historyV2.filter(event => event.kind === 'shop_transaction'
      && event.transaction.type === 'enhancement_purchased')).toEqual(persistedPurchases);
    expect(resumedChapter.presentedChapters).toEqual([1, 2]);
  });

  it('migrates a legacy prematurely-entered Shop without regenerating its contents or Chapter plan', () => {
    const current = dispatch(postBossFlameSelection('legacy-boundary'), { type: 'CONTINUE_FLAME_SELECTION' }, constant()).state;
    const plan = { chapterNumber: 2, miniBoss: 'juggler' as const, boss: 'caller' as const };
    current.currentNodeId = 'shop:before-round:7';
    current.presentedChapters = [1, 2];
    current.chapterPlans[2] = plan;
    current.history.push({ id: current.history.length, round: 6, type: 'CHAPTER_STARTED', chapterNumber: 2,
      chapterMiniBoss: plan.miniBoss, chapterBoss: plan.boss, message: 'Chapter 2 entered' });
    const shop = structuredClone(current.shop);
    const storage = memoryStorage();
    storage.setItem(RUN_STORAGE_KEY, stringifyExactJson({ version: RUN_STORAGE_VERSION, state: current }));

    const migrated = loadPersistedRun(storage, current.seed)!;
    expect(migrated.currentNodeId).toBe('shop:after-round:6');
    expect(migrated.presentedChapters).toEqual([1]);
    expect(migrated.chapterPlans[2]).toEqual(plan);
    expect(migrated.shop).toEqual(shop);
    expect(migrated.historyV2.some(event => event.kind === 'chapter_started' && event.chapter === 2)).toBe(false);

    const unlocked = dispatch(migrated, { type: 'UNLOCK_SHOP_EXIT' }, constant()).state;
    const advanced = dispatch(unlocked, { type: 'NEXT_CHAPTER' }, constant());
    expect(advanced.state.chapterPlans[2]).toEqual(plan);
    expect(advanced.state.historyV2.filter(event => event.kind === 'chapter_started' && event.chapter === 2)).toHaveLength(1);
  });
});
