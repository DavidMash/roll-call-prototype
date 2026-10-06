import { describe, expect, it } from 'vitest';
import { bossTypeForRound, isBigBossType, isMiniBossType } from './bosses';
import {
  chapterEncounterRounds, chapterLabel, chapterNumberForRound, chapterPosition, chapterRoundForRound,
  ensureChapterPlan,
} from './chapters';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { chapterRoute, timeTravelDestinationRound } from './progression';
import type { RandomSource } from './types';

const constant = (value = .2): RandomSource => ({ next: () => value });

describe('Chapter round presentation', () => {
  it.each([
    [1, 1, 1], [6, 1, 6], [7, 2, 1], [12, 2, 6], [13, 3, 1], [57, 10, 3], [240, 40, 6],
  ])('maps global Round %i to Chapter %i Round %i', (globalRound, chapterNumber, chapterRound) => {
    expect(chapterPosition(globalRound)).toEqual({ chapterNumber, chapterRound });
    expect(chapterNumberForRound(globalRound)).toBe(chapterNumber);
    expect(chapterRoundForRound(globalRound)).toBe(chapterRound);
    expect(chapterLabel(globalRound)).toBe(`C${chapterNumber} R${chapterRound}`);
  });

  it('keeps Time Travel on global three-round blocks while labels follow the destination Chapter', () => {
    expect([3, 9, 15].map(timeTravelDestinationRound)).toEqual([1, 7, 13]);
    expect([3, 9, 15].map(round => chapterLabel(timeTravelDestinationRound(round))))
      .toEqual(['C1 R1', 'C2 R1', 'C3 R1']);
  });

  it('does not replay the Chapter splash when Time Travel returns within the same Chapter', () => {
    let state = newRun('chapter-time-travel', constant()).state;
    state.round = 9;
    state.phase = 'specialOffer';
    state.specialOffer = { offers: [{ id: 101, type: 'timeTravel' }], acquired: false };
    state.presentedChapters = [1, 2];
    ensureChapterPlan(state, 2);
    state = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 101 }, constant()).state;
    expect(state.round).toBe(7);
    const replay = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant());
    expect(replay.state.round).toBe(7);
    expect(replay.events.some(event => event.type === 'CHAPTER_STARTED')).toBe(false);
    expect(replay.state.suppressedPostBossRewardRounds).toContain(9);
  });
});

describe('Chapter encounter planning', () => {
  it('plans and persists both deterministic tier-specific encounters together', () => {
    const state = newRun('chapter-plan').state;
    for (let chapterNumber = 1; chapterNumber <= 24; chapterNumber++) {
      const plan = ensureChapterPlan(state, chapterNumber);
      const { miniBossRound, bossRound } = chapterEncounterRounds(chapterNumber);
      expect(plan).toEqual({
        chapterNumber,
        miniBoss: bossTypeForRound(state.seed, miniBossRound),
        boss: bossTypeForRound(state.seed, bossRound),
      });
      expect(isMiniBossType(plan.miniBoss)).toBe(true);
      expect(isBigBossType(plan.boss)).toBe(true);
      expect(state.bossSchedule[miniBossRound]).toBe(plan.miniBoss);
      expect(state.bossSchedule[bossRound]).toBe(plan.boss);
      expect(ensureChapterPlan(state, chapterNumber)).toBe(plan);
    }
  });

  it('emits one Chapter splash before its first map and never on a retry or revisit', () => {
    const initial = newRun('chapter-splash', constant());
    expect(initial.events.slice(0, 2).map(event => event.type)).toEqual(['CHAPTER_STARTED', 'MAP_TRANSITION']);
    expect(initial.events[0]).toMatchObject({ chapterNumber: 1,
      chapterMiniBoss: initial.state.chapterPlans[1]!.miniBoss, chapterBoss: initial.state.chapterPlans[1]!.boss });
    expect(initial.state.presentedChapters).toEqual([1]);

    const resolver = new Resolver(initial.state, constant());
    resolver.enterChapterIfNeeded(1);
    resolver.enterChapterIfNeeded(6);
    expect(resolver.events.filter(event => event.type === 'CHAPTER_STARTED')).toHaveLength(0);

    initial.state.phase = 'shop';
    initial.state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    initial.state.bust = { round: 1, attempt: 1, score: 0, target: 100, shortfall: 100, livesBefore: 3, livesAfter: 2 };
    initial.state.roundAttemptNumber = 2;
    const retry = dispatch(initial.state, { type: 'RETRY_ROUND' }, constant());
    expect(retry.events.some(event => event.type === 'CHAPTER_STARTED')).toBe(false);
  });

  it('keeps the prior Chapter active through its post-Boss Shop, then enters the next Chapter once', () => {
    const state = newRun('next-chapter', constant()).state;
    state.round = 6;
    state.phase = 'flameSelection';
    state.flameSelection = { offers: [], acquired: true };
    const resolver = new Resolver(state, constant());
    resolver.openShop();
    expect(resolver.events.slice(0, 2).map(event => event.type)).toEqual(['MAP_TRANSITION', 'SHOP_OPENED']);
    expect(resolver.events.some(event => event.type === 'CHAPTER_STARTED')).toBe(false);
    expect(state.presentedChapters).toEqual([1]);
    expect(state.chapterPlans[2]).toBeUndefined();
    expect(state.currentNodeId).toBe('shop:after-round:6');
    expect(state.shop?.kind).toBe('post_boss');

    const next = dispatch(state, { type: 'NEXT_CHAPTER' }, constant());
    expect(next.state.round).toBe(7);
    expect(next.events.slice(0, 2).map(event => event.type)).toEqual(['CHAPTER_STARTED', 'MAP_TRANSITION']);
    expect(next.events[0].chapterNumber).toBe(2);
    expect(next.state.chapterPlans[2]).toBeDefined();
    expect(next.state.presentedChapters).toEqual([1, 2]);
  });
});

describe('current Chapter route', () => {
  it('contains the six encounters and all six Shops, ending at the post-Boss Shop', () => {
    const route = chapterRoute('chapter-map', 2);
    expect(route.map(node => node.type)).toEqual([
      'normal_round', 'shop', 'normal_round', 'shop', 'mini_boss_round', 'shop',
      'normal_round', 'shop', 'normal_round', 'shop', 'boss_round', 'shop',
    ]);
    expect(route.filter(node => node.type === 'shop')).toHaveLength(6);
    expect(route.filter(node => node.type.includes('round')).map(node => node.round)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(route.some(node => node.type === 'special_offer' || node.type === 'flame_selection')).toBe(false);
    expect(route.some(node => node.round <= 6 || node.round >= 13)).toBe(false);
    expect(route.at(-1)?.id).toBe('shop:after-round:12');
  });
});
