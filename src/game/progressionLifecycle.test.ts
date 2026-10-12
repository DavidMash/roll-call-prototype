import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { HAND_IDS } from './hands';
import { rankedRecipients, rankedSacrifices } from './hoodedFigure';
import { loadPersistedRun, savePersistedRun } from './persistence';
import { classifyRunHistoryV2Timelines } from './runHistoryV2Timeline';
import type { ActiveHoodedChallenge, GameState, RandomSource, Rank, RoundSummary } from './types';

const constant = (value = .2): RandomSource => ({ next: () => value });

function challenge(chapter = 5, value = 0, complete = false): ActiveHoodedChallenge {
  return {
    id: 'theLongWay', issuedChapter: chapter, target: 3,
    committed: { value, keys: [], invalid: false, jackpotPaid: false },
    attempt: { value, keys: [], invalid: false, jackpotPaid: false },
    complete, dialogueLine: 'lifecycle fixture',
  };
}

function summary(round: number): RoundSummary {
  return {
    round, encounterType: round % 3 === 0 ? 'boss' : 'normal', bossType: round % 3 === 0 ? 'juggler' : null,
    score: 100, target: 100, goldBefore: 10, goldAfter: 15, totalGoldEarned: 5,
    sources: { baseRewardGold: 5, unusedRerollGold: 0, interestGold: 0, bossRewardGold: 0,
      goldenGold: 0, jackpotGold: 0, otherGold: 0 },
  };
}

function chapterFiveSummary(localRound: number, active: ActiveHoodedChallenge | null = challenge(5)): GameState {
  const state = newRun(`chapter-five-r${localRound}`, constant()).state;
  state.round = 24 + localRound;
  state.presentedChapters = [1, 2, 3, 4, 5];
  state.phase = 'roundSummary';
  state.roundSummary = summary(state.round);
  state.hoodedFigure.active = active;
  state.hoodedFigure.issuedChapters = [5];
  state.hoodedFigure.challengeCheckpoint = challenge(5);
  return state;
}

function timeTravelState(active: ActiveHoodedChallenge | null = challenge(5, 2)): GameState {
  const state = newRun('time-travel-current-build', constant()).state;
  state.round = 27;
  state.presentedChapters = [1, 2, 3, 4, 5];
  state.phase = 'specialOffer';
  state.specialOffer = { offers: [{ id: 900, type: 'timeTravel' }], acquired: false };
  state.gold = 87;
  state.lives = 2;
  state.handLevels.ones = 8;
  state.dice[0].faces[0].enhancements.vintage = 1;
  state.dice[0].faces[0].enhancements.bonus = 2;
  state.dice[0].faces[0].vintageSellValue = 19;
  state.dice[0].flame = { id: 'ultimate', investedGold: 64 };
  state.bonfires = ['minigun', 'hailMary', 'fullOfGrace', 'vineyard'];
  state.wildfires = [{ flame: 'lowball', sacrificedFlame: 'fatCat', sacrificedAverage: 2,
    transferMultiplier: 2.25, resolved: { kind: 'xMult', baseMax: 5, max: 11 } }];
  state.specialOfferEffects.carePackageRerolls = 2;
  state.hoodedFigure.active = active;
  state.hoodedFigure.issuedChapters = [5];
  state.hoodedFigure.challengeCheckpoint = challenge(5);
  state.hoodedFigure.contributionCheckpoint = { minigun: { roundCount: 4, factorSum: 7 } };
  state.bonfireContributions = { minigun: { roundCount: 7, factorSum: 15 } };
  state.chapterPlans[5] = { chapterNumber: 5, miniBoss: 'juggler', boss: 'hexer' };
  state.bossSchedule[27] = 'juggler';
  state.bossSchedule[30] = 'hexer';
  return state;
}

function chooseBadDream(active: ActiveHoodedChallenge | null): GameState {
  const state = chapterFiveSummary(3, active);
  state.phase = 'specialOffer';
  state.roundSummary = null;
  state.specialOffer = { offers: [{ id: 901, type: 'badDream' }], acquired: false };
  state.hoodedFigure.active = active;
  return dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 901 }, constant()).state;
}

function bustCurrentRound(state: GameState): GameState {
  state.lives = 1;
  state.target = 1_000_000;
  state.stats.rounds.at(-1)!.target = state.target;
  state.manualRerollsRemaining = 0;
  state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
  ([1, 2, 2, 4, 5] as Rank[]).forEach((value, index) => { state.dice[index].value = value; });
  return dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant()).state;
}

describe('whole-Chapter Hooded lifecycle', () => {
  it('requires four ordinary Bonfires at the start of a genuinely new Chapter', () => {
    const base = () => {
      const state = newRun('four-bonfire-threshold', constant()).state;
      state.round = 24;
      state.presentedChapters = [1, 2, 3, 4];
      state.phase = 'shop';
      state.shop = { kind: 'post_boss', offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
      return state;
    };
    const three = base();
    three.bonfires = ['ultimate', 'minigun', 'hailMary'];
    expect(dispatch(three, { type: 'NEXT_CHAPTER' }, constant()).state.hoodedFigure.active).toBeNull();

    const four = base();
    four.bonfires = ['ultimate', 'minigun', 'hailMary', 'fullOfGrace'];
    expect(dispatch(four, { type: 'NEXT_CHAPTER' }, constant()).state.hoodedFigure.active?.issuedChapter).toBe(5);

    const wildfireDoesNotCount = base();
    wildfireDoesNotCount.bonfires = ['ultimate', 'minigun', 'hailMary'];
    wildfireDoesNotCount.wildfires = [{ flame: 'vineyard', sacrificedFlame: 'fatCat', sacrificedAverage: 2,
      transferMultiplier: 2.25, resolved: { kind: 'xMult', baseMax: 5, max: 11 } }];
    expect(dispatch(wildfireDoesNotCount, { type: 'NEXT_CHAPTER' }, constant()).state.hoodedFigure.active).toBeNull();
  });

  it('does not issue when the fourth Bonfire appears mid-Chapter and issues only at the next new Chapter', () => {
    let state = newRun('mid-chapter-fourth', constant()).state;
    state.round = 24; state.presentedChapters = [1, 2, 3, 4]; state.phase = 'shop';
    state.shop = { kind: 'post_boss', offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    state.bonfires = ['ultimate', 'minigun', 'hailMary'];
    state = dispatch(state, { type: 'NEXT_CHAPTER' }, constant()).state;
    expect(state.hoodedFigure.active).toBeNull();
    state.phase = 'shop';
    state.shop = { kind: 'between_rounds', offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    state.bonfires.push('fullOfGrace');
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant()).state;
    expect(state.round).toBe(26);
    expect(state.hoodedFigure.active).toBeNull();
    state.round = 30; state.phase = 'shop';
    state.shop = { kind: 'post_boss', offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    state = dispatch(state, { type: 'NEXT_CHAPTER' }, constant()).state;
    expect(state.hoodedFigure.active?.issuedChapter).toBe(6);
    expect(state.hoodedFigure.issuedChapters).toEqual([6]);
  });

  it.each([1, 2, 3, 4, 5, 6])('returns immediately after a successful challenge-completing R%s payout', localRound => {
    const state = newRun(`challenge-completion-r${localRound}`, constant()).state;
    state.round = 24 + localRound;
    state.presentedChapters = [1, 2, 3, 4, 5];
    state.target = 1;
    state.stats.rounds.at(-1)!.round = state.round;
    state.stats.rounds.at(-1)!.target = 1;
    state.hoodedFigure.active = {
      id: 'noTakebacks', issuedChapter: 5, target: 1,
      committed: { value: 0, keys: [], invalid: false, jackpotPaid: false },
      attempt: { value: 0, keys: [], invalid: false, jackpotPaid: false }, complete: false, dialogueLine: 'fixture',
    };
    state.hoodedFigure.issuedChapters = [5];
    state.dice.forEach((die, index) => { die.value = ([1, 2, 3, 4, 6] as Rank[])[index]; });
    const cleared = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant());
    expect(cleared.state.phase).toBe('roundSummary');
    expect(cleared.state.hoodedFigure.active?.complete).toBe(true);
    expect(cleared.events.some(event => event.type === 'HOODED_FIGURE_RETURNED')).toBe(false);
    const continued = dispatch(cleared.state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant());
    expect(continued.state.phase).toBe('hoodedFigure');
    expect(continued.state.hoodedFigure.interaction?.kind).toBe('return');
    expect(continued.events.some(event => event.type === 'HOODED_FIGURE_RETURNED')).toBe(true);
    const payoutSeq = continued.state.historyV2.findIndex(event => event.kind === 'shop_transaction'
      && event.transaction.type === 'round_payout');
    const returnSeq = continued.state.historyV2.findIndex(event => event.kind === 'hooded_challenge_changed'
      && event.change === 'returned');
    expect(payoutSeq).toBeLessThan(returnSeq);
  });

  it('keeps an unfinished challenge through R5 and expires it only after successful R6', () => {
    for (const localRound of [1, 2, 3, 4, 5]) {
      const continued = dispatch(chapterFiveSummary(localRound), { type: 'CONTINUE_ROUND_SUMMARY' }, constant()).state;
      expect(continued.hoodedFigure.active?.id).toBe('theLongWay');
    }
    const final = dispatch(chapterFiveSummary(6), { type: 'CONTINUE_ROUND_SUMMARY' }, constant());
    expect(final.state.phase).toBe('flameSelection');
    expect(final.state.hoodedFigure.active).toBeNull();
    expect(final.events.some(event => event.type === 'HOODED_CHALLENGE_EXPIRED')).toBe(true);
  });

  it.each([[3, 'specialOffer'], [6, 'flameSelection']] as const)(
    'resumes the R%s reward flow only after the Hooded return resolves', (localRound, expectedPhase) => {
      let state = dispatch(chapterFiveSummary(localRound, challenge(5, 3, true)),
        { type: 'CONTINUE_ROUND_SUMMARY' }, constant()).state;
      expect(state.phase).toBe('hoodedFigure');
      state = dispatch(state, { type: 'WALK_AWAY_WILDFIRE' }, constant()).state;
      state = dispatch(state, { type: 'ADVANCE_HOODED_FIGURE' }, constant()).state;
      expect(state.phase).toBe(expectedPhase);
    },
  );

  it('offers three recipients and all three remaining sacrifices with exactly four ordinary Bonfires', () => {
    const state = chapterFiveSummary(2);
    state.bonfires = ['ultimate', 'minigun', 'hailMary', 'fullOfGrace'];
    state.bonfireContributions = {
      ultimate: { roundCount: 1, factorSum: 1 }, minigun: { roundCount: 1, factorSum: 2 },
      hailMary: { roundCount: 1, factorSum: 3 }, fullOfGrace: { roundCount: 1, factorSum: 4 },
    };
    expect(rankedRecipients(state)).toEqual(['ultimate', 'minigun', 'hailMary']);
    expect(rankedSacrifices(state, 'ultimate')).toEqual(['fullOfGrace', 'hailMary', 'minigun']);
  });
});

describe('progression-only Time Travel', () => {
  it('preserves the current build and economy while resetting unfinished challenge progress to Chapter start', () => {
    let state = timeTravelState();
    state = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 900 }, constant()).state;
    state = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant()).state;
    expect(state).toMatchObject({ round: 25, phase: 'round', gold: 87, lives: 2 });
    expect(state.handLevels.ones).toBe(8);
    expect(state.dice[0].faces[0]).toMatchObject({ enhancements: { vintage: 1, bonus: 2 }, vintageSellValue: 19 });
    expect(state.dice[0].flame).toEqual({ id: 'ultimate', investedGold: 64 });
    expect(state.bonfires).toEqual(['minigun', 'hailMary', 'fullOfGrace', 'vineyard']);
    expect(state.wildfires).toHaveLength(1);
    expect(state.specialOfferEffects.carePackageRerolls).toBe(2);
    expect(state.hoodedFigure.active).toEqual(state.hoodedFigure.challengeCheckpoint);
    expect(state.bonfireContributions).toEqual({ minigun: { roundCount: 4, factorSum: 7 } });
    expect(state.chapterPlans[5]).toEqual({ chapterNumber: 5, miniBoss: 'juggler', boss: 'hexer' });
    expect(state.chapterLifecycle[5]?.specialOfferConsumed).toBe(true);
  });

  it('preserves completed-unrewarded and completed-rewarded challenge outcomes without duplicate rewards', () => {
    let completed = timeTravelState(challenge(5, 3, true));
    completed = dispatch(completed, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 900 }, constant()).state;
    completed = dispatch(completed, { type: 'CONTINUE_SPECIAL_OFFER' }, constant()).state;
    expect(completed.hoodedFigure.active?.complete).toBe(true);

    const rewardedWildfire = timeTravelState().wildfires[0];
    let rewarded = timeTravelState(null);
    rewarded.hoodedFigure.rewardedChapters = [5];
    rewarded = dispatch(rewarded, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 900 }, constant()).state;
    rewarded = dispatch(rewarded, { type: 'CONTINUE_SPECIAL_OFFER' }, constant()).state;
    expect(rewarded.hoodedFigure.active).toBeNull();
    expect(rewarded.hoodedFigure.rewardedChapters).toEqual([5]);
    expect(rewarded.wildfires).toEqual([rewardedWildfire]);
  });

  it('keeps the consumed Special Offer canonical and cannot present it again after replayed R3', () => {
    let state = timeTravelState();
    state = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 900 }, constant()).state;
    const selection = state.historyV2.find(event => event.kind === 'shop_transaction'
      && event.transaction.type === 'special_offer_selected' && event.transaction.offer === 'timeTravel');
    const relocation = state.historyV2.find(event => event.kind === 'checkpoint_restored' && event.reason === 'time_travel');
    expect(selection).toBeDefined();
    expect(classifyRunHistoryV2Timelines(state.historyV2).status(selection!)).toBe('canonical');
    expect(relocation).toMatchObject({ relocation: 'chapter_start', preservedState: 'current_build' });
    state = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant()).state;
    state.round = 27; state.phase = 'roundSummary'; state.roundSummary = summary(27);
    state = dispatch(state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant()).state;
    expect(state.phase).toBe('shop');
    expect(state.specialOffer).toBeNull();
  });
});

describe('progression-only Bad Dream', () => {
  it('stores only challenge data and restores unfinished challenge progress while retaining the build at death', () => {
    let state = chooseBadDream(challenge(5, 1));
    expect(state.badDreamCheckpoint).toEqual({ chapter: 5, hoodedChallenge: challenge(5, 1) });
    expect(state.badDreamCheckpoint).not.toHaveProperty('board');
    state = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant()).state;
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant()).state;
    state.hoodedFigure.active!.committed.value = 2;
    state.hoodedFigure.active!.attempt.value = 2;
    state.gold = 73;
    state.handLevels.ones = 11;
    state.dice[0].faces[0].enhancements.vintage = 1;
    state.dice[0].faces[0].vintageSellValue = 22;
    state.dice[0].flame = { id: 'ultimate', investedGold: 74 };
    state = bustCurrentRound(state);
    expect(state).toMatchObject({ phase: 'shop', round: 27, lives: 1, gold: 73 });
    expect(state.handLevels.ones).toBe(11);
    expect(state.dice[0].faces[0]).toMatchObject({ enhancements: { vintage: 1 }, vintageSellValue: 25 });
    expect(state.dice[0].flame).toEqual({ id: 'ultimate', investedGold: 74 });
    expect(state.hoodedFigure.active?.committed.value).toBe(1);
    expect(state.chapterLifecycle[5]?.specialOfferConsumed).toBe(true);
    expect(state.badDreamCheckpoint).toBeNull();
  });

  it('preserves a Wildfire claimed after Bad Dream selection and never restores the old unfinished challenge', () => {
    let state = chooseBadDream(challenge(5, 1));
    state = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant()).state;
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant()).state;
    state.hoodedFigure.active = null;
    state.hoodedFigure.rewardedChapters = [5];
    state.wildfires = [{ flame: 'ultimate', sacrificedFlame: 'vineyard', sacrificedAverage: 4,
      transferMultiplier: 4.75, resolved: { kind: 'xMult', baseMax: 5, max: 24 } }];
    state = bustCurrentRound(state);
    expect(state.hoodedFigure.active).toBeNull();
    expect(state.hoodedFigure.rewardedChapters).toEqual([5]);
    expect(state.wildfires).toHaveLength(1);
    expect(state.chapterLifecycle[5]?.specialOfferConsumed).toBe(true);
  });
});

describe('one-time Chapter Special Offer', () => {
  it('does not duplicate a Gold-paying offer when R3 progression is revisited', () => {
    const state = chapterFiveSummary(3, null);
    state.phase = 'specialOffer';
    state.roundSummary = null;
    state.specialOffer = { offers: [{ id: 902, type: 'greatFairy' }], acquired: false };
    state.gold = 10;
    state.lives = 3;
    let current = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 902 }, constant()).state;
    expect(current.gold).toBe(25);
    current = dispatch(current, { type: 'CONTINUE_SPECIAL_OFFER' }, constant()).state;
    current.round = 27; current.phase = 'roundSummary'; current.roundSummary = summary(27);
    current = dispatch(current, { type: 'CONTINUE_ROUND_SUMMARY' }, constant()).state;
    expect(current.phase).toBe('shop');
    expect(current.specialOffer).toBeNull();
    expect(current.gold).toBe(25);
    expect(current.chapterLifecycle[5]?.specialOfferConsumed).toBe(true);
  });

  it('keeps consumption durable through an ordinary Bust and save/load', () => {
    const state = chapterFiveSummary(3, null);
    state.phase = 'specialOffer';
    state.roundSummary = null;
    state.specialOffer = { offers: [{ id: 903, type: 'silence' }], acquired: false };
    let current = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 903 }, constant()).state;
    current = dispatch(current, { type: 'CONTINUE_SPECIAL_OFFER' }, constant()).state;
    current = dispatch(current, { type: 'NEXT_ROUND' }, constant()).state;
    current.target = 1_000_000;
    current.stats.rounds.at(-1)!.target = current.target;
    current.manualRerollsRemaining = 0;
    current.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    current.dice.forEach((die, index) => { die.value = ([1, 2, 2, 4, 5] as Rank[])[index]; });
    current = dispatch(current, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant()).state;
    expect(current.phase).toBe('shop');
    expect(current.lives).toBe(2);
    expect(current.chapterLifecycle[5]?.specialOfferConsumed).toBe(true);
    expect(current.specialOfferEffects.silence).toBe(true);

    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(savePersistedRun(storage, current)).toBe(true);
    const loaded = loadPersistedRun(storage, current.seed);
    expect(loaded?.chapterLifecycle[5]?.specialOfferConsumed).toBe(true);
    expect(loaded?.specialOfferEffects.silence).toBe(true);
  });
});
