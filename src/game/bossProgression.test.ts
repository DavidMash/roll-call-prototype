import { describe, expect, it } from 'vitest';
import { activeFace, rollWeights } from './dice';
import { dispatch, newRun, validateAction } from './engine';
import { activeEncounterDice, BOSS_TYPES, bossSchedule, createCursedDie, MINI_BOSS_TYPES, requiredEncounterDieIds, wardenBaselineCapacity, wardenBaselineHandScore, wardenIdealNaturalPips, wardenNaturalHands, wardenUnlockCost, wardenUnlockCosts } from './bosses';
import { combinationsForHand, HAND_IDS, hasPlayableHand, initialHandLevels, UPPER_HAND_IDS } from './hands';
import { encounterTarget, routeThrough, routeWindow } from './progression';
import type { BossType, GameState, RandomSource } from './types';
import { Resolver } from './effects';

const constant = (value = 0): RandomSource => ({ next: () => value });
function bossRound(type: BossType): GameState {
  const state = newRun(`boss-${type}`, constant(.2)).state;
  state.phase = 'shop';
  state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
  state.round = 2;
  state.currentNodeId = 'shop:before-round:3';
  state.bossSchedule[3] = type;
  return dispatch(state, { type: 'NEXT_ROUND' }, constant(.55)).state;
}

describe('linear route and deterministic boss schedule', () => {
  it('uses stable cadence and node identifiers', () => {
    expect(routeThrough('route', 4).map(node => node.id)).toEqual([
      'round:1', 'shop:before-round:2', 'round:2', 'shop:before-round:3',
      'boss:3', 'special:after-round:3', 'shop:before-round:4', 'round:4', 'shop:before-round:5',
    ]);
  });

  it('limits the map to the complete current Chapter', () => {
    const chapterOne = routeWindow('route', 'boss:6');
    expect(chapterOne).toHaveLength(12);
    expect(chapterOne.some(node => node.type === 'special_offer' || node.type === 'flame_selection')).toBe(false);
    expect(chapterOne.map(node => node.round).every(round => round >= 1 && round <= 6)).toBe(true);
    const chapterTwo = routeWindow('route', 'round:7');
    expect(chapterTwo).toHaveLength(12);
    expect(chapterTwo.some(node => node.type === 'special_offer' || node.type === 'flame_selection')).toBe(false);
    expect(chapterTwo.map(node => node.round).every(round => round >= 7 && round <= 12)).toBe(true);
  });

  it('reports the gameplay target for every encounter node, including target-changing bosses', () => {
    expect(encounterTarget({ id: 'round:2', type: 'normal_round', round: 2 })).toBe(175);
    expect(encounterTarget({ id: 'boss:3', type: 'boss_round', round: 3, boss: 'caller' })).toBe(200);
    expect(encounterTarget({ id: 'boss:6', type: 'boss_round', round: 6, boss: 'marathon' })).toBe(1_350);
    expect(encounterTarget({ id: 'boss:6', type: 'boss_round', round: 6, boss: 'quickdraw' })).toBe(150);
    expect(encounterTarget({ id: 'shop:before-round:2', type: 'shop', round: 2 })).toBeNull();
  });

  it('draws all eight bosses before reshuffling without adjacent repeats', () => {
    const schedule = bossSchedule('bag-seed', 96);
    const miniSequence = Object.entries(schedule).filter(([round]) => Number(round) % 6 === 3).map(([, boss]) => boss!);
    const bigSequence = Object.entries(schedule).filter(([round]) => Number(round) % 6 === 0).map(([, boss]) => boss!);
    for (const [sequence, types] of [[miniSequence, MINI_BOSS_TYPES], [bigSequence, BOSS_TYPES]] as const) {
      expect(sequence).toHaveLength(16);
      for (let index = 0; index < sequence.length; index += types.length)
        expect(new Set(sequence.slice(index, index + types.length))).toEqual(new Set(types));
      sequence.slice(1).forEach((boss, index) => expect(boss).not.toBe(sequence[index]));
    }
    expect(bossSchedule('bag-seed', 96)).toEqual(schedule);
  });

  it('emits auditable movement into a boss node', () => {
    const state = bossRound('caller');
    expect(state.currentNodeId).toBe('boss:3');
    expect(state.stats.mapTransitions.at(-1)).toMatchObject({
      fromNode: 'shop:before-round:3', toNode: 'boss:3', nodeType: 'mini_boss_round', boss: 'caller', direction: 'forward',
    });
  });
});

describe('The Caller', () => {
  it('reveals a deterministic conservative call and a matching Bean answers without using a manual play', () => {
    const state = bossRound('caller');
    if (state.boss?.type !== 'caller') throw new Error('Caller fixture failed');
    state.boss.calledHand = 'ones';
    state.dice[0].value = 6;
    state.dice[0].faces[5].enhancements.bump = 1;
    state.dice[0].faces[0].enhancements.jumpingBean = 1;
    state.dice[0].faces[0].enhancements.sticky = 1;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0));
    expect(result.state.boss).toMatchObject({ type: 'caller', satisfied: false, playsRemaining: 6, callDeadline: 6, manualHandsPlayed: 0, satisfyingSource: null, callsCompleted: 1 });
    if (result.state.boss?.type !== 'caller') throw new Error('Caller fixture failed');
    expect(result.state.boss.calledHand).not.toBe('ones');
    expect(result.state.stats.callerEvents.at(-1)).toMatchObject({ satisfied: true, source: 'jumpingBean', expired: false });
  });

  it('halves score after the third nonmatching manual play, then still supports ordinary Bust rollback', () => {
    let state = bossRound('caller');
    if (state.boss?.type !== 'caller') throw new Error('Caller fixture failed');
    const deterministicCall = state.boss.calledHand;
    state.boss.calledHand = 'fullHouse';
    state.target = 1_000_000;
    for (const [index, hand] of (['ones', 'twos', 'threes'] as const).entries()) {
      state.dice[0].value = (index + 1) as 1 | 2 | 3;
      const result = dispatch(state, { type: 'PLAY', hand, dieIds: [0] }, constant(.2));
      state = result.state;
    }
    expect(state.phase).toBe('round');
    expect(state.score).toBe(14);
    expect(state.boss).toMatchObject({ type: 'caller', playsRemaining: 3, callsMissed: 1 });
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    new Resolver(state, constant(.2)).evaluate();
    expect(state.phase).toBe('shop');
    expect(state.lives).toBe(2);
    expect(state.round).toBe(3);
    expect(state.roundAttemptNumber).toBe(2);
    expect(state.boss).toBeNull();
    expect(state.stats.bossEncounters.at(-1)).toMatchObject({ boss: 'caller', busted: true });
    expect(state.stats.mapTransitions.slice(-2).map(item => [item.toNode, item.direction])).toEqual([
      ['boss:3', 'forward'], ['shop:before-round:3', 'backward'],
    ]);
    state = dispatch(state, { type: 'RETRY_ROUND' }, constant(.55)).state;
    expect(state.boss).toMatchObject({ type: 'caller', calledHand: deterministicCall, playsRemaining: 3, satisfied: false });
  });
});

describe('The Warden', () => {
  it('rolls all five dice first and leaves all locked before the initial choice', () => {
    const state = bossRound('warden');
    expect(state.boss).toMatchObject({ type: 'warden', nextUnlockTarget: null, unlockTargets: [],
      startingDieId: null, activeDieIds: [], pendingReinforcements: 1 });
    const opening = [...state.historyV2].reverse().find(event => event.kind === 'roll_batch' && event.reason === 'warden_opening');
    expect(opening?.kind === 'roll_batch' ? opening.results.map(result => result.dieId) : []).toEqual([0, 1, 2, 3, 4]);
    expect(activeEncounterDice(state)).toEqual([]);
  });

  it('calculates deterministic baseline capacity from trained stats and ideal natural dice only', () => {
    const levels = initialHandLevels();
    expect(wardenIdealNaturalPips('sixes', 3)).toBe(18);
    expect(wardenIdealNaturalPips('twoPair', 4)).toBe(22);
    expect(wardenIdealNaturalPips('fullHouse', 5)).toBe(28);
    expect(wardenIdealNaturalPips('largeStraight', 5)).toBe(20);
    expect(wardenBaselineCapacity(levels, [], 1)).toBe(63);
    levels.pair = 2;
    expect(wardenBaselineCapacity(levels, [], 2)).toBe(136);
  });

  it('caps the first unlock at the two weakest Upper baselines and half the Pair baseline', () => {
    const pairCapped = initialHandLevels();
    for (const hand of UPPER_HAND_IDS) pairCapped[hand] = 2;
    expect(wardenUnlockCost(pairCapped, [], 1)).toBe(15);
    expect(wardenUnlockCost(pairCapped, [], 1)).toBeLessThanOrEqual(
      wardenBaselineHandScore(pairCapped, 'pair', 2) * 0.5,
    );

    const upperCapped = initialHandLevels();
    upperCapped.pair = 2;
    const weakestUpperTotal = UPPER_HAND_IDS
      .map(hand => wardenBaselineHandScore(upperCapped, hand, 1))
      .sort((a, b) => a - b)
      .slice(0, 2)
      .reduce((sum, score) => sum + score, 0);
    expect(weakestUpperTotal).toBe(17);
    expect(wardenUnlockCost(upperCapped, [], 1)).toBe(15);
  });

  it('clamps the second unlock to twice the first cost and the Pair baseline', () => {
    const levels = initialHandLevels();
    expect(wardenUnlockCost(levels, UPPER_HAND_IDS, 2, 15)).toBe(30);

    levels.pair = 2;
    expect(wardenBaselineHandScore(levels, 'pair', 2)).toBe(52);
    expect(wardenUnlockCost(levels, [], 2, 15)).toBe(50);
  });

  it('keeps unscaled costs when the final unlock is already at or below half the Goal', () => {
    expect(wardenUnlockCosts(initialHandLevels(), [], 1_000)).toEqual([15, 30, 105, 255]);
  });

  it('scales all costs proportionally and rounds the final unlock to exactly half the Goal', () => {
    const costs = wardenUnlockCosts(initialHandLevels(), [], 500);
    expect(costs).toEqual([10, 20, 65, 155]);
    expect(costs.reduce((sum, cost) => sum + cost, 0)).toBe(250);
  });

  it('only includes unused hands that are naturally possible at the active-die count', () => {
    expect(wardenNaturalHands(1)).toEqual(UPPER_HAND_IDS);
    expect(wardenNaturalHands(2)).toEqual([...UPPER_HAND_IDS, 'pair']);
    expect(wardenNaturalHands(3)).toEqual([...UPPER_HAND_IDS, 'pair', 'threeKind']);
    expect(wardenNaturalHands(4)).toEqual([...UPPER_HAND_IDS, 'pair', 'twoPair', 'threeKind', 'smallStraight', 'fourKind']);
    expect(wardenNaturalHands(5)).toEqual(HAND_IDS);
    const levels = initialHandLevels();
    expect(wardenBaselineCapacity(levels, ['sixes', 'pair'], 2)).toBe(65);
  });

  it('lets the player choose any first die and unlocks it without rerolling or triggering roll effects', () => {
    const state = bossRound('warden');
    const face = state.dice[4].value;
    state.dice[4].faces[face - 1].enhancements.jumpingBean = 1;
    state.dice[4].faces[face - 1].enhancements.bonus = 2;
    state.dice[4].faces[face - 1].enhancements.workout = 3;
    state.dice[4].faces[face - 1].workoutPips = 50;
    state.dice[4].flame = { id: 'momentum', investedGold: 100 };
    state.bonfires = ['ultimate'];
    state.chargeXMult = 5;
    const result = dispatch(state, { type: 'UNLOCK_WARDEN_DIE', dieId: 4 }, constant(0));
    expect(result.state.boss).toMatchObject({ type: 'warden', startingDieId: 4, activeDieIds: [4],
      unlockCosts: [5, 10, 25, 60], nextUnlockTarget: 5, unlockTargets: [5], pendingReinforcements: 0 });
    expect(result.state.dice[4].value).toBe(face);
    expect(result.state.boss?.type === 'warden' && result.state.boss.nextUnlockTarget).toBe(5);
    expect(result.events.some(event => event.type === 'DIE_ROLLED' || event.type === 'JUMPING_BEAN_FREE_PLAY' || event.type === 'CHARGE_CHANGED')).toBe(false);
    expect(result.state.stats.wardenEvents.at(-1)).toMatchObject({ kind: 'starting_die', dieId: 4, activeDice: 1 });
  });

  it('freezes the cumulative cost schedule against score overshoot and later build changes', () => {
    let state = bossRound('warden');
    state = dispatch(state, { type: 'UNLOCK_WARDEN_DIE', dieId: 3 }, constant()).state;
    if (state.boss?.type !== 'warden') throw new Error('Warden fixture failed');
    expect(state.boss.nextUnlockTarget).toBe(5);
    state.score = 4;
    state.consumed = ['ones'];
    state.handLevels.twos = 99;
    expect(state.boss.nextUnlockTarget).toBe(5);
    state.handLevels.twos = 1;
    const resolver = new Resolver(state, constant(.2));
    resolver.addScore(1, 'hand', 'test target crossing', [3], 'ones');
    if (state.boss?.type !== 'warden') throw new Error('Warden fixture failed');
    expect(state.boss).toMatchObject({ activeDieIds: [3], nextUnlockTarget: 5, pendingReinforcements: 1 });
    expect(state.boss.nextUnlockTarget).toBe(5);
    expect(validateAction(state, { type: 'PLAY', hand: 'ones', dieIds: [3] })).toContain('Unlock');
    const lockedFace = state.dice[1].value;
    const unlock = dispatch(state, { type: 'UNLOCK_WARDEN_DIE', dieId: 1 }, constant(0));
    state = unlock.state;
    if (state.boss?.type !== 'warden') throw new Error('Warden fixture failed');
    expect(state.boss.activeDieIds).toEqual([3, 1]);
    expect(state.dice[1].value).toBe(lockedFace);
    expect(unlock.events.some(event => event.type === 'DIE_ROLLED')).toBe(false);
    expect(state.boss.nextUnlockTarget).toBe(15);
    expect(state.boss.unlockTargets).toEqual([5, 15]);
  });

  it('keeps locked dice out of scoring, rerolls, Jumping Bean, and attached Flames while Bonfires stay global', () => {
    let state = bossRound('warden');
    state.handLevels.ones = 2;
    state.dice[0].flame = { id: 'ultimate', investedGold: 100 };
    state.dice[0].value = 1;
    state.dice[0].faces[0].enhancements.jumpingBean = 1;
    state = dispatch(state, { type: 'UNLOCK_WARDEN_DIE', dieId: 1 }, constant()).state;
    state.dice[1].value = 1;
    expect(validateAction(state, { type: 'PLAY', hand: 'ones', dieIds: [0] })).toContain('valid set');
    expect(validateAction(state, { type: 'MANUAL_REROLL', dieIds: [0] })).toContain('unlocked');
    let result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [1] }, constant(.2));
    expect(result.state.stats.handScores.at(-1)?.xMult).toBe(1);
    expect(result.events.some(event => event.type === 'JUMPING_BEAN_FREE_PLAY' && event.dieIds?.includes(0))).toBe(false);

    state = bossRound('warden');
    state.handLevels.ones = 2;
    state.bonfires = ['ultimate'];
    state = dispatch(state, { type: 'UNLOCK_WARDEN_DIE', dieId: 1 }, constant()).state;
    state.dice[1].value = 1;
    result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [1] }, constant(.2));
    expect(result.state.stats.handScores.at(-1)?.xMult).toBe(5);
  });

  it('resolves opening landing mechanics but suppresses opening gameplay and Flame effects', () => {
    const state = newRun('warden-opening-effects', constant(.2)).state;
    state.phase = 'shop';
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    state.round = 2;
    state.currentNodeId = 'shop:before-round:3';
    state.bossSchedule[3] = 'warden';
    const before = state.dice.map(die => die.value);
    state.dice.forEach(die => {
      die.faces[die.value - 1].enhancements.bump = 1;
      die.faces.forEach(face => { face.enhancements.jumpingBean = 1; });
    });
    state.dice[0].flame = { id: 'momentum', investedGold: 100 };
    const result = dispatch(state, { type: 'NEXT_ROUND' }, constant(0));
    expect(result.state.dice.map(die => die.value)).toEqual(before.map(value => value === 6 ? 1 : value + 1));
    expect(result.state.stats.bumpControlledRolls).toBe(5);
    expect(result.state.stats.jumpingBeanFreePlays).toHaveLength(0);
    expect(result.state.chargeXMult).toBe(1);
    expect(result.state.stats.flameTriggers.momentum ?? 0).toBe(0);
  });

  it('resets the rolled-and-locked choice state on Bust and retry', () => {
    let state = bossRound('warden');
    state = dispatch(state, { type: 'UNLOCK_WARDEN_DIE', dieId: 4 }, constant()).state;
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    new Resolver(state, constant(.2)).evaluate();
    expect(state.phase).toBe('shop');
    state = dispatch(state, { type: 'RETRY_ROUND' }, constant(.55)).state;
    expect(state.boss).toMatchObject({ type: 'warden', startingDieId: null, activeDieIds: [],
      nextUnlockTarget: null, unlockTargets: [], pendingReinforcements: 1 });
    const opening = [...state.historyV2].reverse().find(event => event.kind === 'roll_batch' && event.reason === 'warden_opening');
    expect(opening?.kind === 'roll_batch' ? opening.results : []).toHaveLength(5);
  });
});

describe('The Hexer', () => {
  it('constructs the exact temporary seven-face loadout', () => {
    const die = createCursedDie();
    expect(die.owner).toBe('boss');
    expect(die.faces).toHaveLength(7);
    expect(die.faces.map(face => ({ rank: face.rank, weightedTarget: face.weightedTarget ?? null, enhancements: face.enhancements }))).toEqual([
      { rank: 1, weightedTarget: 6, enhancements: { golden: 1, weighted: 1 } },
      { rank: 2, weightedTarget: 5, enhancements: { golden: 1, weighted: 1 } },
      { rank: 3, weightedTarget: 4, enhancements: { golden: 1, weighted: 1 } },
      { rank: 4, weightedTarget: null, enhancements: { missingLink: 1, mirror: 1 } },
      { rank: 5, weightedTarget: null, enhancements: { workout: 5, mirror: 1 } },
      { rank: 6, weightedTarget: null, enhancements: { workout: 10, bump: 1 } },
      { rank: 7, weightedTarget: null, enhancements: { bonus: 5, mirror: 1 } },
    ]);
    expect(die.faces.every(face => Object.keys(face.enhancements).length === 2)).toBe(true);
    expect(die.faces.every(face => !face.enhancements.jumpingBean)).toBe(true);
    expect(rollWeights(die)).toEqual([1, 1, 1, 2, 2, 2, 1]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7] as const)('manual reroll excludes Cursed face %s while preserving authored behavior', face => {
    const state = bossRound('hexer');
    const cursed = state.dice.find(die => die.owner === 'boss')!;
    cursed.value = face;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [cursed.id] }, constant(.8));
    const rolled = result.state.dice.find(die => die.owner === 'boss')!;
    expect(rolled.value).not.toBe(face);
    expect(result.events.find(event => event.type === 'DIE_ROLLED' && event.dieIds?.includes(cursed.id))).toMatchObject({
      rollSource: 'manual_reroll', previousFace: face, resultFace: rolled.value,
    });
    if (face === 1) expect(rolled.value).toBe(6); // Authored Weighted → 6 remains favored after renormalization.
  });

  it('requires the Cursed Die in manual hands and removes it after clear', () => {
    let state = bossRound('hexer');
    expect(state.dice).toHaveLength(6);
    const cursed = state.dice.find(die => die.owner === 'boss')!;
    state.dice[0].value = 2;
    state.dice[1].value = 2;
    cursed.value = 2;
    expect(validateAction(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] })).toContain('Cursed Die');
    expect(validateAction(state, { type: 'PLAY', hand: 'pair', dieIds: [0, cursed.id] })).toBeNull();
    state.target = 1;
    state = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, cursed.id] }, constant(.2)).state;
    expect(state.phase).toBe('roundSummary');
    expect(state.lastRoundPayout).toMatchObject({ baseGold: 5, unusedRerollGold: 3, interestGold: 0, bossRewardGold: 10, totalRoundRewardGold: 18 });
    state = dispatch(state, { type: 'CONTINUE_ROUND_SUMMARY' }, constant()).state;
    expect(state.phase).toBe('specialOffer');
    expect(state.dice.every(die => die.owner === 'player')).toBe(true);
  });

  it('busts when ordinary hands remain but none can include the Cursed Die', () => {
    const state = bossRound('hexer');
    const cursed = state.dice.find(die => die.owner === 'boss')!;
    [1, 2, 3, 4, 6].forEach((rank, index) => { state.dice[index].value = rank as 1 | 2 | 3 | 4 | 6; });
    cursed.value = 7;
    state.consumed = HAND_IDS.filter(hand => hand !== 'smallStraight');
    state.manualRerollsRemaining = 0;

    expect(hasPlayableHand(activeEncounterDice(state), state.consumed)).toBe(true);
    expect(hasPlayableHand(activeEncounterDice(state), state.consumed, requiredEncounterDieIds(state))).toBe(false);

    new Resolver(state, constant(.2)).evaluate();
    expect(state.phase).toBe('shop');
    expect(state.bust).toMatchObject({ round: 3, score: 0, livesAfter: 2 });
    expect(state.lives).toBe(2);
    expect(state.boss).toBeNull();
  });

  it('supports extended straights with rank 7 while face 7 Mirror works in group hands', () => {
    const cursed = createCursedDie();
    const players = newRun('seven-hands', constant(.2)).state.dice;
    [3, 4, 5, 6].forEach((rank, index) => { players[index].value = rank as 3 | 4 | 5 | 6; });
    cursed.value = 7;
    expect(combinationsForHand([...players.slice(0, 4), cursed], 'largeStraight')).toContainEqual([0, 1, 2, 3, cursed.id]);
    players[0].value = 2;
    expect(combinationsForHand([players[0], cursed], 'pair')).toContainEqual([0, cursed.id]);
    expect(activeFace(cursed).rank).toBe(7);
  });

  it('uses Hexer-specific 6 → 7 Bump and the authored Workout and Bonus faces', () => {
    let state = bossRound('hexer');
    let cursed = state.dice.find(die => die.owner === 'boss')!;
    cursed.value = 6;
    state = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [cursed.id] }, constant(0)).state;
    cursed = state.dice.find(die => die.owner === 'boss')!;
    expect(cursed.value).toBe(7);

    state.target = 1_000_000;
    state.dice[0].value = 4;
    state.dice[1].value = 5;
    state.dice[2].value = 6;
    cursed.value = 7;
    state = dispatch(state, { type: 'PLAY', hand: 'smallStraight', dieIds: [0, 1, 2, cursed.id] }, constant(0)).state;
    cursed = state.dice.find(die => die.owner === 'boss')!;
    expect(state.stats.handScores.at(-1)?.bonusPips).toBe(50);

    state.dice[0].value = 5;
    cursed.value = 5;
    state = dispatch(state, { type: 'PLAY', hand: 'fives', dieIds: [cursed.id] }, constant(.95)).state;
    cursed = state.dice.find(die => die.owner === 'boss')!;
    expect(cursed.faces[4].workoutPips).toBe(5);
    expect(state.stats.goldBySource.jackpot).toBe(0);
    expect(state.stats.triggers.sticky ?? 0).toBe(0);
  });

  it('removes the Cursed Die on failed-attempt rollback and recreates it for the retry', () => {
    let state = bossRound('hexer');
    state.consumed = [...HAND_IDS];
    state.manualRerollsRemaining = 0;
    new Resolver(state, constant(.2)).evaluate();
    expect(state.phase).toBe('shop');
    expect(state.dice).toHaveLength(5);
    expect(state.dice.every(die => die.owner === 'player')).toBe(true);
    state = dispatch(state, { type: 'RETRY_ROUND' }, constant(.55)).state;
    expect(state.boss?.type).toBe('hexer');
    expect(state.dice.filter(die => die.owner === 'boss')).toHaveLength(1);
  });
});
