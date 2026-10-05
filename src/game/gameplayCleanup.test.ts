import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { HAND_IDS } from './hands';
import { timeTravelDestinationRound } from './progression';
import type { GameState, RandomSource, Rank, RoundSummary, SpecialOfferType } from './types';

const constant = (value = .2): RandomSource => ({ next: () => value });

function expose(state: GameState, values: Rank[]): void {
  values.forEach((value, index) => { state.dice[index].value = value; });
}

function winningRound(): ReturnType<typeof dispatch> {
  const state = newRun('persistent-winning-faces', constant(.2)).state;
  expose(state, [2, 2, 3, 4, 5]);
  state.target = 1;
  state.stats.rounds.at(-1)!.target = 1;
  state.dice[0].faces[5].enhancements.jumpingBean = 1;
  return dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(.99));
}

function bossSummary(round: number, bossType: RoundSummary['bossType']): RoundSummary {
  return { round, encounterType: 'boss', bossType, score: 1, target: 1, goldBefore: 0, goldAfter: 0,
    totalGoldEarned: 0, sources: { baseRewardGold: 0, unusedRerollGold: 0, interestGold: 0,
      bossRewardGold: 0, goldenGold: 0, jackpotGold: 0, otherGold: 0 } };
}

function clockmakerEncounter(): GameState {
  const state = newRun('clockmaker-roll-pipeline', constant(.2)).state;
  state.phase = 'shop';
  state.round = 2;
  state.currentNodeId = 'shop:before-round:3';
  state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
  state.bossSchedule[3] = 'clockmaker';
  expose(state, [1, 2, 3, 4, 5]);
  return dispatch(state, { type: 'NEXT_ROUND' }, constant(.99)).state;
}

function offerState(type: SpecialOfferType, round: number): GameState {
  const state = newRun(`cleanup-${type}-${round}`, constant(.2)).state;
  state.phase = 'specialOffer';
  state.round = round;
  state.shop = null;
  state.flameSelection = null;
  state.specialOffer = { offers: [{ id: 1, type }], acquired: false };
  return state;
}

describe('persistent physical faces', () => {
  it('settles a winning hand without starting landing-trigger score chains, then carries the faces into Shop', () => {
    const result = winningRound();
    expect(result.state.phase).toBe('roundSummary');
    expect(result.state.dice.slice(0, 2).map(die => die.value)).toEqual([6, 6]);
    expect(result.events.find(event => event.type === 'DICE_REROLL_STARTED')?.message).toContain('Winning hand settle reroll');
    expect(result.events.some(event => event.type === 'JUMPING_BEAN_FREE_PLAY')).toBe(false);
    expect(result.state.stats.handsPlayed.sixes).toBeUndefined();
    const score = result.state.score;
    const finalFaces = result.state.dice.map(die => die.value);

    const shop = dispatch(result.state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant(0));
    expect(shop.state.phase).toBe('shop');
    expect(shop.state.dice.map(die => die.value)).toEqual(finalFaces);
    expect(shop.state.score).toBe(score);
    expect(shop.events.some(event => event.type === 'DICE_REROLL_STARTED')).toBe(false);
    expect(shop.events.some(event => event.message.includes('Free shop roll'))).toBe(false);
  });

  it('preserves faces through Special Offer and Flame Selection, while paid Shop rerolls still roll', () => {
    const finalFaces: Rank[] = [6, 5, 4, 3, 2];
    const special = winningRound().state;
    expose(special, finalFaces);
    special.round = 3;
    special.roundSummary = bossSummary(3, 'juggler');
    const specialResult = dispatch(special, { type: 'CONTINUE_ROUND_SUMMARY' }, constant(0));
    expect(specialResult.state.phase).toBe('specialOffer');
    expect(specialResult.state.dice.map(die => die.value)).toEqual(finalFaces);
    expect(specialResult.events.some(event => event.type === 'DICE_REROLL_STARTED')).toBe(false);

    const flame = winningRound().state;
    expose(flame, finalFaces);
    flame.round = 6;
    flame.roundSummary = bossSummary(6, 'caller');
    const flameResult = dispatch(flame, { type: 'CONTINUE_ROUND_SUMMARY' }, constant(0));
    expect(flameResult.state.phase).toBe('flameSelection');
    expect(flameResult.state.dice.map(die => die.value)).toEqual(finalFaces);
    expect(flameResult.events.some(event => event.type === 'DICE_REROLL_STARTED')).toBe(false);

    const shop = winningRound().state;
    expose(shop, finalFaces);
    shop.phase = 'shop';
    shop.roundSummary = null;
    shop.gold = 100;
    shop.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    const paid = dispatch(shop, { type: 'REROLL_DICE' }, constant(0));
    expect(paid.events.find(event => event.type === 'DICE_REROLL_STARTED')?.message).toContain('Shop dice reroll');
    expect(paid.state.dice.map(die => die.value)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('Clockmaker roll pipeline', () => {
  it('Bumps every initial roll once through the shared roll pipeline', () => {
    const state = clockmakerEncounter();
    expect(state.dice.map(die => die.value)).toEqual([2, 3, 4, 5, 6]);
    expect(state.history.filter(event => event.type === 'BUMP_ROLL' && event.boss === 'clockmaker').slice(-5)).toHaveLength(5);
  });

  it('changes post-hand and manual rolling dice only, and actual Bump does not double-stack', () => {
    let state = clockmakerEncounter();
    state.target = 1_000_000;
    expose(state, [2, 2, 3, 4, 5]);
    activeFace(state.dice[4]).enhancements.slippy = 1;
    let result = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(.99));
    expect(result.state.dice.map(die => die.value)).toEqual([3, 3, 3, 4, 6]);
    expect(result.events.some(event => event.type === 'DIE_FLIPPED' && event.boss === 'clockmaker')).toBe(false);

    state = result.state;
    expose(state, [5, 2, 3, 4, 5]);
    activeFace(state.dice[0]).enhancements.bump = 1;
    result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(.99));
    expect(result.state.dice.map(die => die.value)).toEqual([6, 2, 3, 4, 5]);
    expect(result.events.filter(event => event.type === 'BUMP_ROLL' && event.dieIds?.[0] === 0)).toHaveLength(1);
  });

  it('applies to Jumping Bean follow-up rolls without a separate Clockmaker face-change pass', () => {
    const state = clockmakerEncounter();
    state.target = 1_000_000;
    expose(state, [1, 3, 4, 5, 6]);
    state.dice[0].faces[1].enhancements.jumpingBean = 1;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(.99));
    expect(result.events.some(event => event.type === 'JUMPING_BEAN_FREE_PLAY' && event.hand === 'twos')).toBe(true);
    expect(result.events.filter(event => event.type === 'BUMP_ROLL' && event.dieIds?.[0] === 0)).toHaveLength(2);
    expect(result.state.dice[0].value).toBe(3);
  });
});

describe('Care Package resources and Time Travel boundaries', () => {
  it('keeps Care Package charges persistent, out of unused-Reroll Gold, and inside Bust rollback', () => {
    let state = offerState('carePackage', 3);
    state = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 1 }, constant()).state;
    expect(state.specialOfferEffects.carePackageRerolls).toBe(3);
    state = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant()).state;
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant(.2)).state;
    expect(state.specialOfferEffects.carePackageRerolls).toBe(3);
    state.manualRerollsRemaining = 0;
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1, 2] }, constant(.2)).state;
    expect(state.specialOfferEffects.carePackageRerolls).toBe(0);
    state.consumed = [...HAND_IDS];
    new Resolver(state, constant(.2)).evaluate();
    expect(state.phase).toBe('shop');
    expect(state.specialOfferEffects.carePackageRerolls).toBe(3);

    const payout = newRun('care-package-payout', constant(.2)).state;
    expose(payout, [2, 2, 3, 4, 5]);
    payout.target = 1;
    payout.stats.rounds.at(-1)!.target = 1;
    payout.manualRerollsRemaining = 0;
    payout.specialOfferEffects.carePackageRerolls = 3;
    const cleared = dispatch(payout, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(.2)).state;
    expect(cleared.lastRoundPayout?.unusedRerollGold).toBe(0);
    expect(cleared.specialOfferEffects.carePackageRerolls).toBe(3);
  });

  it.each([[3, 1], [9, 7], [15, 13], [21, 19]])('Time Travel after Round %i starts Round %i directly', (round, destination) => {
    expect(timeTravelDestinationRound(round)).toBe(destination);
    let state = offerState('timeTravel', round);
    state.gold = 47;
    state.roundAttemptNumber = 4;
    state.handLevels.fullHouse = 9;
    state.dice[0].flame = { id: 'ultimate', investedGold: 40 };
    state = dispatch(state, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 1 }, constant()).state;
    expect(state.round).toBe(destination);
    expect(state.round).toBeGreaterThan(0);
    state = dispatch(state, { type: 'CONTINUE_SPECIAL_OFFER' }, constant(.2)).state;
    expect(state).toMatchObject({ phase: 'round', round: destination, roundAttemptNumber: 1,
      currentNodeId: `round:${destination}`, gold: 47 });
    expect(state.shop).toBeNull();
    expect(state.handLevels.fullHouse).toBe(9);
    expect(state.dice[0].flame).toEqual({ id: 'ultimate', investedGold: 40 });
    expect(state.stats.mapTransitions.at(-1)).toMatchObject({ toNode: `round:${destination}`, direction: 'backward' });
    expect(state.suppressedPostBossRewardRounds).toContain(round);
    if (round === 3) {
      expose(state, [2, 2, 3, 4, 5]);
      state.target = 1;
      state.stats.rounds.at(-1)!.target = 1;
      state = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(.2)).state;
      expect(state.phase).toBe('roundSummary');
      state = dispatch(state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant(.2)).state;
      expect(state).toMatchObject({ phase: 'shop', currentNodeId: 'shop:before-round:2' });
    }
  });
});
