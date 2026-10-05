import { describe, expect, it } from 'vitest';
import { activeEncounterDice, BOSSES, bossSchedule, BOSS_TYPES, createBossRuntime, isBigBossRound, isMiniBossRound, MINI_BOSS_TYPES, unavailableEncounterHands } from './bosses';
import { activeFace } from './dice';
import { Resolver } from './effects';
import { dispatch, newRun, validateAction } from './engine';
import { HANDS, HAND_IDS, LOWER_HAND_IDS } from './hands';
import { postBossRewardForRound, routeThrough } from './progression';
import type { GameState, HandId, MiniBossType, RandomSource, Rank } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });

function miniBossRound(type: MiniBossType, prepare?: (state: GameState) => void, random: RandomSource = constant(.2)): GameState {
  const state = newRun(`mini-${type}`, constant(.2)).state;
  state.phase = 'shop';
  state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
  state.round = 2;
  state.currentNodeId = 'shop:before-round:3';
  state.bossSchedule[3] = type;
  prepare?.(state);
  return dispatch(state, { type: 'NEXT_ROUND' }, random).state;
}

function expose(state: GameState, values: Rank[]): void {
  values.forEach((value, index) => { state.dice[index].value = value; });
}

function lowerFixture(hand: HandId): { values: Rank[]; ids: number[] } {
  switch (hand) {
    case 'pair': return { values: [2, 2], ids: [0, 1] };
    case 'twoPair': return { values: [2, 2, 3, 3], ids: [0, 1, 2, 3] };
    case 'threeKind': return { values: [2, 2, 2], ids: [0, 1, 2] };
    case 'smallStraight': return { values: [1, 2, 3, 4], ids: [0, 1, 2, 3] };
    case 'fullHouse': return { values: [2, 2, 2, 3, 3], ids: [0, 1, 2, 3, 4] };
    case 'fourKind': return { values: [2, 2, 2, 2], ids: [0, 1, 2, 3] };
    case 'largeStraight': return { values: [1, 2, 3, 4, 5], ids: [0, 1, 2, 3, 4] };
    case 'fiveKind': return { values: [2, 2, 2, 2, 2], ids: [0, 1, 2, 3, 4] };
    default: throw new Error(`${hand} is not a Lower hand.`);
  }
}

describe('six-Round encounter cadence', () => {
  it('places Mini-Bosses and Big Bosses on their respective three-Round endpoints', () => {
    expect([3, 9, 15, 21].every(isMiniBossRound)).toBe(true);
    expect([6, 12, 18, 24].every(isBigBossRound)).toBe(true);
    expect([1, 2, 4, 5, 7, 8].some(round => isMiniBossRound(round) || isBigBossRound(round))).toBe(false);
    const route = routeThrough('mini-cadence', 12);
    expect(route.filter(node => node.type === 'mini_boss_round').map(node => node.round)).toEqual([3, 9]);
    expect(route.filter(node => node.type === 'boss_round').map(node => node.round)).toEqual([6, 12]);
    expect([3, 9].map(postBossRewardForRound)).toEqual(['specialOffer', 'specialOffer']);
    expect([6, 12].map(postBossRewardForRound)).toEqual(['flame', 'flame']);
  });

  it('uses separate deterministic exhaustive shuffled bags with no boundary repeats', () => {
    const schedule = bossSchedule('separate-bags', 192);
    const tier = (remainder: number) => Object.entries(schedule)
      .filter(([round]) => Number(round) % 6 === remainder).map(([, boss]) => boss!);
    for (const [sequence, pool] of [[tier(3), MINI_BOSS_TYPES], [tier(0), BOSS_TYPES]] as const) {
      for (let index = 0; index < sequence.length; index += pool.length)
        expect(new Set(sequence.slice(index, index + pool.length))).toEqual(new Set(pool));
      sequence.slice(1).forEach((boss, index) => expect(boss).not.toBe(sequence[index]));
    }
    expect(bossSchedule('separate-bags', 192)).toEqual(schedule);
  });

  it('pays and labels the normal Boss Gold reward before opening a Special Offer', () => {
    let state = miniBossRound('capitalReturn');
    state.target = 1;
    state.stats.rounds.at(-1)!.target = 1;
    state.dice[0].value = 6;
    const clear = dispatch(state, { type: 'PLAY', hand: 'sixes', dieIds: [0] }, constant(.2));
    expect(clear.state.lastRoundPayout?.bossRewardGold).toBe(10);
    expect(clear.events.find(event => event.type === 'GOLD_ADDED' && event.goldSource === 'bossReward')?.message)
      .toContain('Mini-Boss Reward');
    state = dispatch(clear.state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant(.2)).state;
    expect(state.phase).toBe('specialOffer');
  });
});

describe('Mini-Boss mechanics', () => {
  it('The Juggler adds one non-scoring gameplay reroll and skips it after a clear', () => {
    let state = miniBossRound('juggler');
    state.target = 1_000_000;
    expose(state, [1, 2, 3, 4, 5]);
    state.dice[1].faces[0].enhancements.jumpingBean = 1;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    const postHand = result.events.find(event => event.type === 'DICE_REROLL_STARTED' && event.message.startsWith('Post-hand'));
    expect(postHand?.dieIds).toEqual([0, 1]);
    expect(result.events.some(event => event.boss === 'juggler' && event.dieIds?.[0] === 1)).toBe(true);
    expect(result.events.some(event => event.type === 'JUMPING_BEAN_FREE_PLAY' && event.dieIds?.[0] === 1)).toBe(true);

    state = miniBossRound('juggler');
    state.target = 1;
    state.dice[0].value = 1;
    const winning = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    expect(winning.events.some(event => event.type === 'BOSS_HAND_CHANGED' && event.boss === 'juggler')).toBe(false);

    state = miniBossRound('juggler');
    state.target = 1_000_000;
    expose(state, [2, 2, 2, 2, 2]);
    const noExtra = dispatch(state, { type: 'PLAY', hand: 'fiveKind', dieIds: [0, 1, 2, 3, 4] }, constant(0));
    expect(noExtra.events.some(event => event.type === 'BOSS_HAND_CHANGED' && event.boss === 'juggler')).toBe(false);
  });

  it('Capital Return charges once per Lower hand without taking Gold below zero', () => {
    let state = miniBossRound('capitalReturn');
    state.target = 1_000_000;
    state.gold = 1;
    expose(state, [2, 2]);
    state = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(.2)).state;
    expect(state.gold).toBe(0);
    expose(state, [3, 3, 3]);
    state = dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant(.2)).state;
    expect(state.gold).toBe(0);
  });

  it('The Neglected deterministically consumes the two least-played hands while Bean free plays remain legal', () => {
    const state = miniBossRound('neglected', game => {
      for (const hand of HAND_IDS) game.handPlayCounts[hand] = 4;
      game.handPlayCounts.ones = 0;
      game.handPlayCounts.threes = 0;
    });
    expect(state.boss).toMatchObject({ type: 'neglected', neglectedHands: ['ones', 'threes'] });
    expect(unavailableEncounterHands(state)).toEqual(expect.arrayContaining(['ones', 'threes']));
    expect(validateAction(state, { type: 'PLAY', hand: 'ones', dieIds: [0] })).toContain('consumed');
    state.dice[0].value = 1;
    const resolver = new Resolver(state, constant(.2));
    resolver.play('ones', [0], 'jumpingBean');
    expect(state.stats.handScores.at(-1)).toMatchObject({ hand: 'ones', playSource: 'jumpingBean', consumedHand: false });
    expect(state.consumed).toContain('ones');
  });

  it('The Clockmaker supplies one Bump only to dice that genuinely roll', () => {
    const state = miniBossRound('clockmaker');
    state.target = 1_000_000;
    expose(state, [1, 2, 3, 4, 5]);
    state.dice[0].faces[0].enhancements.bump = 1;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.2));
    expect(result.state.dice.map(die => die.value)).toEqual([2, 2, 3, 4, 5]);
    expect(result.events.filter(event => event.type === 'BUMP_ROLL' && event.boss === 'clockmaker')).toHaveLength(1);
    expect(result.events.filter(event => event.type === 'BUMP_ROLL' && event.dieIds?.[0] === 0)).toHaveLength(1);
    expect(result.events.some(event => event.type === 'DIE_FLIPPED' && event.boss === 'clockmaker')).toBe(false);
    expect(result.events.some(event => event.type === 'JUMPING_BEAN_FREE_PLAY')).toBe(false);
  });

  it('The Tightrope halves the Goal, preserves reserve Rerolls, enables Hail Mary, and permits Bottled Fairy rescue', () => {
    let state = miniBossRound('tightrope', game => {
      game.specialOfferEffects.carePackageRerolls = 2;
      game.specialOfferEffects.bottledFairyRounds = 3;
      game.dice[0].flame = { id: 'hailMary', investedGold: 100 };
    });
    expect(state.target).toBe(100);
    expect(state.manualRerollsRemaining).toBe(0);
    expect(validateAction(state, { type: 'MANUAL_REROLL', dieIds: [0, 1] })).toBeNull();
    state.target = 1_000_000;
    state.dice[0].value = 1;
    state = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.2)).state;
    expect(state.stats.handScores.at(-1)?.xMult).toBe(5);
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 1] }, constant(.2)).state;
    expect(state.specialOfferEffects.carePackageRerolls).toBe(0);
    state.consumed = [...HAND_IDS];
    new Resolver(state, constant(.2)).evaluate();
    expect(state.manualRerollsRemaining).toBe(3);
    expect(state.specialOfferEffects.bottledFairyTriggeredThisRound).toBe(true);
  });

  it('The Crawler limits ordinary scoring rerolls but still allows Sticky and Slippy behavior', () => {
    let state = miniBossRound('crawler');
    state.target = 1_000_000;
    expose(state, [2, 2, 3, 4, 5]);
    activeFace(state.dice[4]).enhancements.slippy = 1;
    let result = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(0));
    let postHand = result.events.find(event => event.type === 'DICE_REROLL_STARTED' && event.message.startsWith('Post-hand'));
    expect(postHand?.dieIds).toEqual([0, 4]);
    expect(result.events.some(event => event.enhancement === 'slippy')).toBe(true);

    state = miniBossRound('crawler');
    state.target = 1_000_000;
    expose(state, [2, 2]);
    activeFace(state.dice[0]).enhancements.sticky = 1;
    result = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(0));
    postHand = result.events.find(event => event.type === 'DICE_REROLL_STARTED' && event.message.startsWith('Post-hand'));
    expect(postHand?.dieIds).toEqual([1]);
    expect(result.events.some(event => event.enhancement === 'sticky')).toBe(true);

    state = miniBossRound('crawler');
    state.target = 1;
    expose(state, [2, 2]);
    result = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(0));
    expect(result.events.some(event => event.type === 'DICE_REROLL_STARTED' && event.message.startsWith('Post-hand'))).toBe(false);
  });

  it('The Magician removes a die and its Flame until three distinct calls complete in any order, including Bean', () => {
    const seed = 'mini-magician';
    const preview = createBossRuntime(seed, 3, 'magician');
    if (preview.type !== 'magician') throw new Error('Magician fixture failed.');
    const state = miniBossRound('magician', game => {
      game.seed = seed;
      game.dice[preview.missingDieId].flame = { id: 'momentum', investedGold: 100 };
    });
    if (state.boss?.type !== 'magician') throw new Error('Magician fixture failed.');
    expect(activeEncounterDice(state)).toHaveLength(4);
    expect(state.dice[state.boss.missingDieId].flame).toBeNull();
    expect(state.maxCharge).toBe(1);
    state.target = 1_000_000;
    const calls = [...state.boss.calledHands].reverse();
    const resolver = new Resolver(state, constant(.2));
    calls.forEach((hand, index) => {
      const rank = HANDS[hand].rank!;
      const die = activeEncounterDice(state)[0];
      die.value = rank;
      resolver.play(hand, [die.id], index === 1 ? 'jumpingBean' : 'manual');
    });
    expect(state.boss).toMatchObject({ type: 'magician', returned: true, completedHands: calls });
    expect(activeEncounterDice(state)).toHaveLength(5);
    expect(state.dice[preview.missingDieId].flame).toMatchObject({ id: 'momentum', investedGold: 100 });
    expect(state.maxCharge).toBeGreaterThan(1);
    expect(resolver.events.some(event => event.message.includes('Magician return roll'))).toBe(true);
    expect(state.stats.jumpingBeanFreePlays.some(play => play.hand === calls[1])).toBe(true);
  });

  it('The Magician restores the hidden die and Flame through Bust checkpoints, then hides the same build on retry', () => {
    const seed = 'mini-magician-checkpoint';
    const preview = createBossRuntime(seed, 3, 'magician');
    if (preview.type !== 'magician') throw new Error('Magician fixture failed.');
    let state = miniBossRound('magician', game => {
      game.seed = seed;
      game.dice[preview.missingDieId].flame = { id: 'momentum', investedGold: 50 };
    });
    expect(state.roundCheckpoint?.dice[preview.missingDieId].flame).toMatchObject({ id: 'momentum', investedGold: 50 });
    state.target = 1_000_000;
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    new Resolver(state, constant(.2)).evaluate();
    expect(state.phase).toBe('shop');
    expect(state.boss).toBeNull();
    expect(state.dice[preview.missingDieId].flame).toMatchObject({ id: 'momentum', investedGold: 50 });
    state = dispatch(state, { type: 'RETRY_ROUND' }, constant(.2)).state;
    expect(state.boss).toMatchObject({ type: 'magician', missingDieId: preview.missingDieId, returned: false });
    expect(state.dice[preview.missingDieId].flame).toBeNull();
    expect(activeEncounterDice(state)).toHaveLength(4);
  });

  it('The Mugger reveals its hidden Lower hand, steals at most 5 Gold once, then remains spent', () => {
    const state = miniBossRound('mugger');
    if (state.boss?.type !== 'mugger') throw new Error('Mugger fixture failed.');
    state.target = 1_000_000;
    state.gold = 3;
    const hidden = state.boss.hiddenHand;
    expect(LOWER_HAND_IDS).toContain(hidden);
    const fixture = lowerFixture(hidden);
    expose(state, fixture.values);
    const resolver = new Resolver(state, constant(.2));
    resolver.play(hidden, fixture.ids);
    expect(state.gold).toBe(0);
    expect(state.boss).toMatchObject({ spent: true, revealedHand: hidden });
    state.gold = 4;
    expose(state, fixture.values);
    resolver.play(hidden, fixture.ids, 'jumpingBean');
    expect(state.gold).toBe(4);
  });

  it('keeps all canonical Mini-Boss rules centralized', () => {
    expect(Object.fromEntries(MINI_BOSS_TYPES.map(type => [type, BOSSES[type].shortRule]))).toEqual({
      juggler: 'After every hand, one random extra die rerolls.',
      capitalReturn: 'Lose 1 Gold whenever you play a Lower hand.',
      neglected: 'Your 2 least-played hands are unavailable.',
      clockmaker: 'Every roll gets Bumped up one face.',
      tightrope: 'Start with 0 Rerolls. Goal is halved.',
      crawler: 'After every hand, only one scoring die rerolls.',
      magician: 'One die disappears until you play 3 called Upper hands.',
      mugger: 'One hidden Lower hand will steal 5 Gold if played.',
    });
  });
});
