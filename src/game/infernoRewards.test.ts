import { describe, expect, it } from 'vitest';
import { dispatch, newRun, normalizeGameState } from './engine';
import {
  CURATED_DIE_BUILDS, generateInfernoRewardSelection, INFERNO_REWARD_OFFERS,
  infernoRewardEligible,
} from './infernoRewards';
import { SeededRng, hashSeed } from './rng';
import { createCollectibleDie } from './dice';
import type { GameState, InfernoRewardOfferId } from './types';
import { CONFIG } from './config';
import { renderRunSummaryV2 } from './runHistoryV2Export';
import type { RunHistoryV2Event } from './runHistoryV2';

const constant = (value = .2) => ({ next: () => value });

function offer(state: GameState, id: InfernoRewardOfferId, also: InfernoRewardOfferId[] = []): GameState {
  state.phase = 'infernoReward';
  const screenNumber = ++state.infernoRewards.screenCount;
  state.infernoRewards.pending = { screenNumber, offers: [id, ...also], recycledOfferIds: [], makeRoomOfferId: null };
  return state;
}

function claim(state: GameState, id: InfernoRewardOfferId): GameState {
  return dispatch(offer(state, id), { type: 'CHOOSE_INFERNO_REWARD', offerId: id }, constant()).state;
}

describe('Inferno Reward generation', () => {
  it('is deterministic, unique, diverse, and allows at most one Legendary', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = newRun(`inferno-reward-${seed}`, constant()).state;
      const first = generateInfernoRewardSelection(state, new SeededRng(hashSeed(`offers-${seed}`)));
      const replay = generateInfernoRewardSelection(state, new SeededRng(hashSeed(`offers-${seed}`)));
      expect(replay).toEqual(first);
      expect(new Set(first.offers).size).toBe(first.offers.length);
      expect(first.offers.filter(id => INFERNO_REWARD_OFFERS[id].rarity === 'legendary').length).toBeLessThanOrEqual(1);
      expect(new Set(first.offers.map(id => INFERNO_REWARD_OFFERS[id].category)).size).toBeGreaterThanOrEqual(2);
      expect(Math.max(...Object.values(first.offers.reduce<Record<string, number>>((counts, id) => {
        const category = INFERNO_REWARD_OFFERS[id].category;
        counts[category] = (counts[category] ?? 0) + 1;
        return counts;
      }, {})))).toBeLessThanOrEqual(2);
    }
  });

  it('enforces prerequisites and permanently excludes claimed offers', () => {
    const state = newRun('inferno-prerequisites', constant()).state;
    expect(infernoRewardEligible(state, 'expandedRoster2')).toBe(false);
    expect(infernoRewardEligible(state, 'handSixKind')).toBe(false);
    state.infernoRewards.claimedOfferIds.push('expandedRoster');
    state.infernoRewards.upgrades.rosterCap = 6;
    expect(infernoRewardEligible(state, 'expandedRoster')).toBe(false);
    expect(infernoRewardEligible(state, 'expandedRoster2')).toBe(true);
    expect(infernoRewardEligible(state, 'handSixKind')).toBe(true);
    for (let seed = 0; seed < 20; seed++)
      expect(generateInfernoRewardSelection(state, new SeededRng(seed)).offers).not.toContain('expandedRoster');
  });

  it('recycles deferred offers only after three subsequent screens and only when unseen is scarce', () => {
    const state = newRun('inferno-deferred', constant()).state;
    const keep = ['goldWindfall', 'temperWindfall'] as InfernoRewardOfferId[];
    state.infernoRewards.claimedOfferIds = (Object.keys(INFERNO_REWARD_OFFERS) as InfernoRewardOfferId[])
      .filter(id => id !== 'handOdds' && !keep.includes(id));
    state.infernoRewards.deferredOffers.handOdds = { deferredAtScreen: 1 };
    state.infernoRewards.screenCount = 3;
    expect(generateInfernoRewardSelection(state, constant()).offers).not.toContain('handOdds');
    state.infernoRewards.screenCount = 4;
    const recycled = generateInfernoRewardSelection(state, constant());
    expect(recycled.offers).toContain('handOdds');
    expect(recycled.recycledOfferIds).toContain('handOdds');
  });

  it('returns the remaining valid unique offers when the pool is exhausted', () => {
    const state = newRun('inferno-exhausted', constant()).state;
    state.infernoRewards.claimedOfferIds = (Object.keys(INFERNO_REWARD_OFFERS) as InfernoRewardOfferId[])
      .filter(id => !['goldWindfall', 'temperWindfall'].includes(id));
    expect(generateInfernoRewardSelection(state, constant()).offers).toEqual(['goldWindfall', 'temperWindfall']);
  });
});

describe('Inferno Reward effects and persistence', () => {
  it('applies roster, reroll, Heart, Interest, Shop reroll, Temper, and windfall upgrades', () => {
    let state = newRun('inferno-upgrades', constant()).state;
    state = claim(state, 'expandedRoster');
    state = claim(state, 'expandedRoster2');
    expect(state.diceInventory.roster).toHaveLength(7);
    state = claim(state, 'extraReroll'); state = claim(state, 'extraReroll2');
    expect(state.infernoRewards.upgrades.manualRerolls).toBe(5);
    state.lives = 1;
    state = claim(state, 'maxHeart'); state = claim(state, 'maxHeart2');
    expect([state.lives, state.infernoRewards.upgrades.maxLives]).toEqual([3, 5]);
    state = claim(state, 'higherInterest'); state = claim(state, 'higherInterest2');
    expect(state.infernoRewards.upgrades.interestCap).toBe(25);
    state = claim(state, 'freeShopReroll'); state = claim(state, 'freeShopReroll2');
    expect(state.infernoRewards.upgrades.freeShopRerolls).toBe(2);
    state = claim(state, 'temperCapacity'); state = claim(state, 'temperCapacity2');
    expect(state.infernoRewards.upgrades.overkillTemperCap).toBe(20);
    const gold = state.gold, temper = state.temper;
    state = claim(state, 'goldWindfall'); state = claim(state, 'temperWindfall');
    expect(state.gold - gold).toBe(100); expect(state.temper - temper).toBe(100);
  });

  it('uses free Shop rerolls before the unchanged first paid-reroll price', () => {
    let state = newRun('inferno-free-rerolls', constant()).state;
    state.infernoRewards.upgrades.freeShopRerolls = 2;
    state.phase = 'shop';
    state.gold = 100;
    state.shop = { visitId: 1, stage: 'shop', offers: [], offerRerolls: 0,
      freeOfferRerollsUsed: 0, lifeRestores: 0 };
    state = dispatch(state, { type: 'REROLL_OFFERS' }, constant()).state;
    state = dispatch(state, { type: 'REROLL_OFFERS' }, constant()).state;
    expect([state.gold, state.shop?.offerRerolls, state.shop?.freeOfferRerollsUsed]).toEqual([100, 0, 2]);
    state = dispatch(state, { type: 'REROLL_OFFERS' }, constant()).state;
    expect([state.gold, state.shop?.offerRerolls]).toEqual([100 - CONFIG.offerRerollBase, 1]);
  });

  it('initializes unlocked Hands at their current section baselines', () => {
    let state = newRun('inferno-hands', constant()).state;
    for (const hand of ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes']) state.handLevels[hand] = 7;
    for (const hand of ['pair', 'twoPair', 'threeKind', 'smallStraight', 'fullHouse', 'fourKind', 'largeStraight', 'fiveKind']) state.handLevels[hand] = 4;
    state = claim(state, 'handOdds');
    state = claim(state, 'handMiniStraight');
    expect(state.handLevels.odds).toBe(7);
    expect(state.handLevels.miniStraight).toBe(4);
  });

  it('defines every curated die exactly and makes full inventory placement cancellable and atomic', () => {
    expect(CURATED_DIE_BUILDS).toEqual({
      dieInvestor: [['vintage', 2], ['doubleTime', 3], ['bonus', 2]],
      dieMagicMirror: [['magic', 2], ['mirror', 2], ['bonus', 2]],
      dieGroundAssault: [['tank', 3], ['flywheel', 3], ['clockwork', 1]],
      dieSustainableIndustry: [['furnace', 2], ['golden', 1], ['sustainable', 1]],
      dieGymRat: [['workout', 6], ['doubleTime', 3]],
      diePopcornMachine: [['jumpingBean', 5], ['flywheel', 2], ['chameleon', 3]],
    });
    let state = newRun('inferno-make-room', constant()).state;
    for (let index = 0; index < state.diceInventory.storage.length; index++) {
      const die = createCollectibleDie(state.diceInventory.nextDieId++);
      state.diceInventory.instances[die.id] = die; state.diceInventory.storage[index] = die.id;
    }
    state = offer(state, 'dieInvestor', ['goldWindfall']);
    const beforeIds = Object.keys(state.diceInventory.instances);
    state = dispatch(state, { type: 'CHOOSE_INFERNO_REWARD', offerId: 'dieInvestor' }, constant()).state;
    expect(state.infernoRewards.pending?.makeRoomOfferId).toBe('dieInvestor');
    expect(state.infernoRewards.claimedOfferIds).not.toContain('dieInvestor');
    expect(Object.keys(state.diceInventory.instances)).toEqual(beforeIds);
    state = dispatch(state, { type: 'CANCEL_INFERNO_MAKE_ROOM' }, constant()).state;
    expect(state.infernoRewards.pending?.offers).toEqual(['dieInvestor', 'goldWindfall']);
    const replaced = state.diceInventory.storage[0]!;
    state = dispatch(state, { type: 'CHOOSE_INFERNO_REWARD', offerId: 'dieInvestor' }, constant()).state;
    state = dispatch(state, { type: 'PLACE_INFERNO_DIE', destination: { area: 'storage', index: 0 }, expectedDieId: replaced }, constant()).state;
    expect(state.infernoRewards.claimedOfferIds).toContain('dieInvestor');
    expect(state.diceInventory.instances[replaced]).toBeUndefined();
    const reward = state.diceInventory.instances[state.diceInventory.storage[0]!]!;
    expect(reward.effects.map(effect => [effect.type, effect.level])).toEqual(CURATED_DIE_BUILDS.dieInvestor);
  });

  it('normalizes old saves and preserves a pending generated screen exactly', () => {
    const state = newRun('inferno-save', constant()).state;
    state.infernoRewards.pending = generateInfernoRewardSelection(state, new SeededRng(42));
    state.infernoRewards.screenCount = 1;
    state.phase = 'infernoReward';
    expect(normalizeGameState(structuredClone(state)).infernoRewards.pending).toEqual(state.infernoRewards.pending);
    const legacy = structuredClone(state) as GameState;
    delete (legacy as unknown as { infernoRewards?: unknown }).infernoRewards;
    const migrated = normalizeGameState(legacy);
    expect(migrated.infernoRewards.upgrades).toMatchObject({ rosterCap: 5, manualRerolls: 3, maxLives: 3 });
  });

  it('includes claimed rewards, recycled counts, upgrades, and bonus Hands in the text summary', () => {
    let state = newRun('inferno-summary', constant()).state;
    state.infernoRewards.pending = { screenNumber: 1, offers: ['handOdds'],
      recycledOfferIds: ['handOdds'], makeRoomOfferId: null };
    state.infernoRewards.screenCount = 1;
    state.phase = 'infernoReward';
    const envelope = state.historyV2.at(-1)!;
    state.historyV2.push({ ...envelope, seq: state.nextHistorySeq++, actionId: state.nextActionId,
      kind: 'inferno_reward_offered', screenNumber: 1,
      offers: [{ ...INFERNO_REWARD_OFFERS.handOdds, recycled: true }] } as RunHistoryV2Event);
    state = dispatch(state, { type: 'CHOOSE_INFERNO_REWARD', offerId: 'handOdds' }, constant()).state;
    const summary = renderRunSummaryV2(state);
    expect(summary).toContain('Inferno Rewards: 1 screens');
    expect(summary).toContain('New Hand: Odds');
    expect(summary).toContain('recycled shown 1 / claimed 1');
    expect(summary).toContain('Unlocked bonus Hands: Odds');
  });
});
