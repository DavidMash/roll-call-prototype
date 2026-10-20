import { describe, expect, it } from 'vitest';
import { activeEncounterDice, BOSSES, bossSchedule, BOSS_TYPES, createBossRuntime, isBigBossRound, isMiniBossRound, MINI_BOSS_TYPES, unavailableEncounterHands } from './bosses';
import { Resolver } from './effects';
import { dispatch, newRun, validateAction } from './engine';
import { HANDS, HAND_IDS, LOWER_HAND_IDS } from './hands';
import { isChapterMapTransition, isPlaybackBarrier } from './playback';
import { loadPersistedRun, savePersistedRun } from './persistence';
import { postBossRewardForRound, routeThrough } from './progression';
import { flameByType, placeFlameInstance } from './flames';
import type { GameState, HandId, MiniBossType, RandomSource, Rank } from './types';

const constant = (value = 0): RandomSource => ({ next: () => value });

function miniBossRound(type: MiniBossType, prepare?: (state: GameState) => void, random: RandomSource = constant(.2)): GameState {
  const state = newRun(`mini-${type}`, constant(.2)).state;
  state.phase = 'shop';
  state.shop = { stage: 'flames', offers: [], offerRerolls: 0, lifeRestores: 0 };
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
      for (let index = 0; index + pool.length <= sequence.length; index += pool.length)
        expect(new Set(sequence.slice(index, index + pool.length))).toEqual(new Set(pool));
      sequence.slice(1).forEach((boss, index) => expect(boss).not.toBe(sequence[index]));
    }
    expect(bossSchedule('separate-bags', 192)).toEqual(schedule);
  });

  it('pays and labels the normal Boss Gold reward before opening a Special Offer', () => {
    let state = miniBossRound('capitalReturn');
    state.target = 1n;
    state.stats.rounds.at(-1)!.target = 1n;
    state.dice[0].value = 6;
    const clear = dispatch(state, { type: 'PLAY', hand: 'sixes', dieIds: [0] }, constant(.2));
    expect(clear.state.lastRoundPayout?.bossRewardGold).toBe(15);
    expect(clear.events.find(event => event.type === 'GOLD_ADDED' && event.goldSource === 'bossReward')?.message)
      .toContain('Mini-Boss Reward');
    const continued = dispatch(clear.state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant(.2));
    expect(continued.events[0]).toMatchObject({ type: 'MAP_TRANSITION', nodeType: 'special_offer' });
    expect(isChapterMapTransition(continued.events[0])).toBe(false);
    expect(isPlaybackBarrier(continued.events[0])).toBe(false);
    state = continued.state;
    expect(state.phase).toBe('specialOffer');
  });
});

describe('Mini-Boss mechanics', () => {
  it('The Juggler rerolls every physical player die after Upper hands, after scoring, without spending a Reroll', () => {
    let state = miniBossRound('juggler');
    state.target = 1_000_000n;
    expose(state, [1, 2, 3, 4, 5]);
    const facesBefore = structuredClone(state.dice.map(die => die.faces));
    const rerollsBefore = state.manualRerollsRemaining;
    const scoresBefore = state.stats.handScores.length;
    let result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.4));
    const triggerIndex = result.events.findIndex(event => event.type === 'BOSS_HAND_CHANGED' && event.boss === 'juggler');
    const scoreIndex = result.events.findIndex(event => event.type === 'HAND_SCORE_FINALIZED');
    const jugglerRoll = result.events.find(event => event.type === 'DICE_REROLL_STARTED' && event.rollReason === 'juggler');
    expect(triggerIndex).toBeGreaterThan(scoreIndex);
    expect(jugglerRoll?.dieIds).toEqual([0, 1, 2, 3, 4]);
    expect(result.state.manualRerollsRemaining).toBe(rerollsBefore);
    expect(result.state.stats.handScores).toHaveLength(scoresBefore + 1);
    expect(result.state.dice.map(die => die.faces)).toEqual(facesBefore);
    const scored = [...result.state.historyV2].reverse().find(event => event.kind === 'hand_scored');
    const bossEvent = [...result.state.historyV2].reverse()
      .find(event => event.kind === 'boss_state_changed' && event.boss === 'juggler');
    const rollEvent = [...result.state.historyV2].reverse()
      .find(event => event.kind === 'roll_batch' && event.reason === 'juggler');
    expect(bossEvent).toMatchObject({ hand: 'ones', dieIds: [0, 1, 2, 3, 4], state: 'triggered' });
    expect(rollEvent).toMatchObject({ dieIds: [0, 1, 2, 3, 4], spend: null, parentSeq: scored?.seq });

    state = miniBossRound('juggler');
    state.target = 1_000_000n;
    state.dice[0].value = 6;
    result = dispatch(state, { type: 'PLAY', hand: 'sixes', dieIds: [0] }, constant(.4));
    expect(result.events.find(event => event.rollReason === 'juggler')?.dieIds).toEqual([0, 1, 2, 3, 4]);

    state = miniBossRound('juggler');
    state.target = 1n;
    state.dice[0].value = 1;
    result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.4));
    expect(result.events.find(event => event.rollReason === 'juggler')?.dieIds).toEqual([0, 1, 2, 3, 4]);
    expect([...result.state.historyV2].reverse().find(event => event.kind === 'roll_batch' && event.reason === 'juggler'))
      .toMatchObject({ context: 'settle' });
  });

  it('The Juggler ignores Lower hands and remains deterministic', () => {
    let state = miniBossRound('juggler');
    state.target = 1_000_000n;
    expose(state, [2, 2, 3, 4, 5]);
    let result = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(.4));
    expect(result.events.some(event => event.rollReason === 'juggler')).toBe(false);

    state = miniBossRound('juggler');
    state.target = 1_000_000n;
    expose(state, [2, 2, 2, 3, 3]);
    result = dispatch(state, { type: 'PLAY', hand: 'fullHouse', dieIds: [0, 1, 2, 3, 4] }, constant(.4));
    expect(result.events.some(event => event.rollReason === 'juggler')).toBe(false);

    const first = miniBossRound('juggler');
    first.target = 1_000_000n;
    expose(first, [6, 2, 3, 4, 5]);
    const second = structuredClone(first);
    const a = dispatch(first, { type: 'PLAY', hand: 'sixes', dieIds: [0] });
    const b = dispatch(second, { type: 'PLAY', hand: 'sixes', dieIds: [0] });
    expect(a.state.dice.map(die => die.value)).toEqual(b.state.dice.map(die => die.value));
    expect([...a.state.historyV2].reverse().find(event => event.kind === 'roll_batch' && event.reason === 'juggler'))
      .toEqual([...b.state.historyV2].reverse().find(event => event.kind === 'roll_batch' && event.reason === 'juggler'));
  });

  it('Capital Return charges once per Lower hand without taking Gold below zero', () => {
    let state = miniBossRound('capitalReturn');
    state.target = 1_000_000n;
    state.gold = 1;
    expose(state, [2, 2]);
    state = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant(.2)).state;
    expect(state.gold).toBe(0);
    expose(state, [3, 3, 3]);
    state = dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] }, constant(.2)).state;
    expect(state.gold).toBe(0);
  });

  it('The Neglected restores its two least-played hands immediately after the sixth completed play', () => {
    let state = miniBossRound('neglected', game => {
      for (const hand of HAND_IDS) game.handPlayCounts[hand] = 4;
      game.handPlayCounts.ones = 0;
      game.handPlayCounts.threes = 0;
    });
    state.target = 1_000_000n;
    expect(state.boss).toMatchObject({ type: 'neglected', neglectedHands: ['ones', 'threes'], handsPlayed: 0, restored: false });
    expect(state.boss?.type === 'neglected' && state.boss.neglectedHands).toHaveLength(2);
    expect(unavailableEncounterHands(state)).toEqual(expect.arrayContaining(['ones', 'threes']));
    expect(validateAction(state, { type: 'PLAY', hand: 'ones', dieIds: [0] })).toContain('consumed');

    const rerollsBefore = state.manualRerollsRemaining;
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(.2)).state;
    expect(state.boss).toMatchObject({ type: 'neglected', handsPlayed: 0, restored: false });
    expect(state.manualRerollsRemaining).toBe(rerollsBefore - 1);

    const plays: { hand: HandId; values: Rank[]; ids: number[] }[] = [
      { hand: 'twos', values: [2], ids: [0] },
      { hand: 'fours', values: [4], ids: [0] },
      { hand: 'fives', values: [5], ids: [0] },
      { hand: 'sixes', values: [6], ids: [0] },
      { hand: 'pair', values: [2, 2], ids: [0, 1] },
      { hand: 'threeKind', values: [2, 2, 2], ids: [0, 1, 2] },
    ];
    for (const [index, play] of plays.entries()) {
      expose(state, play.values);
      const resolution = dispatch(state, { type: 'PLAY', hand: play.hand, dieIds: play.ids }, constant(.2));
      state = resolution.state;
      expect(state.boss).toMatchObject({ type: 'neglected', handsPlayed: index + 1, restored: index === 5 });
      if (index < 5) expect(unavailableEncounterHands(state)).toEqual(expect.arrayContaining(['ones', 'threes']));
      else {
        const consumed = [...resolution.events].reverse().find(event => event.type === 'HAND_CONSUMED')!;
        const restored = resolution.events.find(event => event.type === 'BOSS_HAND_CHANGED' && event.bossState === 'restored')!;
        expect(unavailableEncounterHands(consumed.board)).toEqual(expect.arrayContaining(['ones', 'threes']));
        expect(unavailableEncounterHands(restored.board)).not.toEqual(expect.arrayContaining(['ones', 'threes']));
      }
    }
    expect(unavailableEncounterHands(state)).not.toEqual(expect.arrayContaining(['ones', 'threes']));
    expect(state.historyV2.filter((event): event is import('./runHistoryV2').BossStateChangedEvent =>
      event.kind === 'boss_state_changed' && event.boss === 'neglected' && !!event.state)
      .map(event => ({ amount: event.amount, state: event.state, hands: event.hands }))).toEqual([
        { amount: 0, state: 'restricted', hands: ['ones', 'threes'] },
        ...[1, 2, 3, 4, 5].map(amount => ({ amount, state: 'restricted', hands: ['ones', 'threes'] })),
        { amount: 6, state: 'restored', hands: ['ones', 'threes'] },
      ]);
    expose(state, [1]);
    expect(validateAction(state, { type: 'PLAY', hand: 'ones', dieIds: [0] })).toBeNull();
    state = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(.2)).state;
    expect(state.boss).toMatchObject({ type: 'neglected', handsPlayed: 6, restored: true });
    expect(state.consumed).toContain('ones');
  });

  it('The Neglected counts genuine extra plays, resets on a fresh attempt, and persists mid-attempt progress', () => {
    let state = miniBossRound('neglected');
    state.target = 1_000_000n;
    state.dice[0].value = 2;
    new Resolver(state, constant(.2)).play('twos', [0], 'jumpingBean');
    expect(state.boss).toMatchObject({ type: 'neglected', handsPlayed: 1, restored: false });

    let serialized = '';
    const storage = { getItem: () => serialized || null, setItem: (_key: string, value: string) => { serialized = value; } };
    expect(savePersistedRun(storage, state)).toBe(true);
    const loaded = loadPersistedRun(storage, state.seed)!;
    expect(loaded.boss).toEqual(state.boss);
    expect(unavailableEncounterHands(loaded)).toEqual(expect.arrayContaining(
      state.boss?.type === 'neglected' ? state.boss.neglectedHands : [],
    ));

    loaded.consumed = [...HAND_IDS];
    loaded.scorecardCycleConsumed = [...HAND_IDS];
    loaded.manualRerollsRemaining = 0;
    new Resolver(loaded, constant(.2)).evaluate();
    expect(loaded.phase).toBe('shop');
    loaded.shop!.stage = 'flames';
    const retry = dispatch(loaded, { type: 'RETRY_ROUND' }, constant(.2)).state;
    expect(retry.boss).toMatchObject({ type: 'neglected', handsPlayed: 0, restored: false });
    if (retry.boss?.type === 'neglected')
      expect(unavailableEncounterHands(retry)).toEqual(expect.arrayContaining(retry.boss.neglectedHands));
  });

  it('The Tightrope halves the Goal, preserves reserve Rerolls, enables Hail Mary, and permits Bottled Fairy rescue', () => {
    let state = miniBossRound('tightrope', game => {
      game.specialOfferEffects.carePackageRerolls = 2;
      game.specialOfferEffects.bottledFairyRounds = 3;
      placeFlameInstance(game, 'hailMary', 100);
    });
    expect(state.target).toBe(BigInt(100n));
    expect(state.manualRerollsRemaining).toBe(0);
    expect(validateAction(state, { type: 'MANUAL_REROLL', dieIds: [0, 1] })).toBeNull();
    state.target = 1_000_000n;
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

  it('The Magician removes a die while global Flames remain active until three distinct calls complete', () => {
    const seed = 'mini-magician';
    const preview = createBossRuntime(seed, 3, 'magician');
    if (preview.type !== 'magician') throw new Error('Magician fixture failed.');
    if (preview.missingDieId === null) throw new Error('Five-die Magician fixture must remove a die.');
    const state = miniBossRound('magician', game => {
      game.seed = seed;
      placeFlameInstance(game, 'momentum', 100);
    });
    if (state.boss?.type !== 'magician') throw new Error('Magician fixture failed.');
    expect(activeEncounterDice(state)).toHaveLength(4);
    expect(flameByType(state, 'momentum')).toMatchObject({ investedGold: 100 });
    expect(state.maxCharge).toBeGreaterThan(1);
    state.target = 1_000_000n;
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
    expect(flameByType(state, 'momentum')).toMatchObject({ investedGold: 100 });
    expect(state.maxCharge).toBeGreaterThan(1);
    expect(resolver.events.some(event => event.message.includes('Magician return roll'))).toBe(true);
    expect(state.stats.jumpingBeanFreePlays.some(play => play.hand === calls[1])).toBe(true);
  });

  it('The Magician preserves global Flame instances through Bust checkpoints and retry', () => {
    const seed = 'mini-magician-checkpoint';
    const preview = createBossRuntime(seed, 3, 'magician');
    if (preview.type !== 'magician') throw new Error('Magician fixture failed.');
    if (preview.missingDieId === null) throw new Error('Five-die Magician fixture must remove a die.');
    let state = miniBossRound('magician', game => {
      game.seed = seed;
      placeFlameInstance(game, 'momentum', 50);
    });
    expect(state.roundCheckpoint?.board.flameSlots).toContainEqual(expect.objectContaining({ type: 'momentum', investedGold: 50 }));
    state.target = 1_000_000n;
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    new Resolver(state, constant(.2)).evaluate();
    expect(state.phase).toBe('shop');
    expect(state.boss).toBeNull();
    expect(flameByType(state, 'momentum')).toMatchObject({ investedGold: 50 });
    state.shop!.stage = 'flames';
    state = dispatch(state, { type: 'RETRY_ROUND' }, constant(.2)).state;
    expect(state.boss).toMatchObject({ type: 'magician', missingDieId: preview.missingDieId, returned: false });
    expect(flameByType(state, 'momentum')).toMatchObject({ investedGold: 50 });
    expect(activeEncounterDice(state)).toHaveLength(4);
  });

  it('The Mugger reveals its hidden Lower hand, steals at most 5 Gold once, then remains spent', () => {
    const state = miniBossRound('mugger');
    if (state.boss?.type !== 'mugger') throw new Error('Mugger fixture failed.');
    state.target = 1_000_000n;
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
      juggler: 'All dice reroll when an Upper hand is played.',
      capitalReturn: 'Lose 1 Gold whenever you play a Lower hand.',
      neglected: 'Two of your least played hands are unavailable until 6 hands have been played.',
      tightrope: 'Start with 0 Rerolls. Goal is halved.',
      crawler: 'After every hand, only one scoring die rerolls.',
      magician: 'One die disappears until you play 3 called Upper hands.',
      mugger: 'One hidden Lower hand will steal 5 Gold if played.',
    });
  });
});
