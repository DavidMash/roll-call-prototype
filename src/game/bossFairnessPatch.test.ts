import { describe, expect, it } from 'vitest';
import {
  activeEncounterDice, bossTypeForRound, BOSS_TYPES, createBossRuntime, createCursedDie,
  currentlyPlayableManualHands, isBigBossType, isMiniBossType, MINI_BOSS_TYPES,
} from './bosses';
import { dispatch, newRun, validateAction } from './engine';
import { Resolver } from './effects';
import { handIsStructurallyImpossible, HAND_IDS, upperBaselineLevel } from './hands';
import { createDieEffect, resetDieRoundState } from './specialDice';
import type { BossType, GameState, RandomSource, Rank } from './types';

const constant = (value = .2): RandomSource => ({ next: () => value });

function encounter(type: BossType, values: Rank[] = [1, 2, 3, 5, 6]): GameState {
  const state = newRun(`fairness-${type}`, constant()).state;
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
  state.boss = createBossRuntime(state.seed, state.round, type, {
    playerDieIds: state.dice.map(die => die.id), handPlayCounts: state.handPlayCounts,
  });
  state.bossSilenced = false;
  values.forEach((value, index) => { state.dice[index].value = value; });
  return state;
}

describe('boss fairness roster and structural availability', () => {
  it('uses the final active tier rosters and chapter unlock bands', () => {
    expect(MINI_BOSS_TYPES).toEqual(['capitalReturn', 'neglected', 'tightrope', 'crawler', 'quickdraw', 'pendulum']);
    expect(BOSS_TYPES).toEqual(['magician', 'juggler', 'caller', 'warden', 'hexer', 'marathon', 'fly', 'snakeEyes', 'infected']);
    for (let index = 0; index < 30; index++) {
      expect(['capitalReturn', 'crawler', 'quickdraw', 'pendulum']).toContain(bossTypeForRound(`unlock-${index}`, 3));
      expect(['magician', 'hexer', 'snakeEyes']).toContain(bossTypeForRound(`unlock-${index}`, 6));
    }
    expect(isMiniBossType('quickdraw')).toBe(true);
    expect(isBigBossType('magician')).toBe(true);
    expect(isBigBossType('juggler')).toBe(true);
  });

  it('cycles unseen encounters independently without immediate repeats', () => {
    for (const tier of [3, 6] as const) {
      const sequence = Array.from({ length: 16 }, (_, index) => bossTypeForRound('unseen-cycle', tier + index * 6));
      expect(sequence.every((boss, index) => index === 0 || boss !== sequence[index - 1])).toBe(true);
    }
  });

  it('marks only die-count impossibilities', () => {
    expect(handIsStructurallyImpossible('fullHouse', 4)).toBe(true);
    expect(handIsStructurallyImpossible('largeStraight', 4)).toBe(true);
    expect(handIsStructurallyImpossible('fiveKind', 4)).toBe(true);
    expect(handIsStructurallyImpossible('fourKind', 4)).toBe(false);
    expect(handIsStructurallyImpossible('ones', 1)).toBe(false);
  });
});

describe('revised encounter mechanics', () => {
  it('uses a plain seven-faced Cursed Die and a temporary baseline-level Sevens hand', () => {
    const die = createCursedDie();
    expect(die.faces.map(face => face.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(die.faces.every(face => !('hexerEffect' in face))).toBe(true);
    const state = encounter('hexer');
    state.bossSchedule[state.round] = 'hexer';
    state.handLevels.ones = 2; state.handLevels.twos = 2; state.handLevels.threes = 3;
    new Resolver(state, constant()).startRound();
    expect(state.handLevels.sevens).toBe(upperBaselineLevel(state.handLevels));
    expect(activeEncounterDice(state)).toHaveLength(6);
  });

  it('applies Quickdraw and Pendulum through the shared final boss factor', () => {
    const quickdraw = encounter('quickdraw', [2, 2, 3, 3, 4]);
    new Resolver(quickdraw, constant()).play('pair', [0, 1]);
    quickdraw.dice[2].value = 3;
    new Resolver(quickdraw, constant()).play('threes', [2]);
    expect(quickdraw.stats.handScores.slice(-2).map(score => score.bossFactor)).toEqual([1, 1]);
    quickdraw.dice[2].value = 3; quickdraw.dice[3].value = 3; quickdraw.dice[4].value = 3;
    new Resolver(quickdraw, constant()).play('threeKind', [2, 3, 4]);
    expect(quickdraw.stats.handScores.at(-1)!.bossFactor).toBe(.25);

    const pendulum = encounter('pendulum', [2, 2, 1, 4, 6]);
    if (pendulum.boss?.type !== 'pendulum') throw new Error('Expected Pendulum.');
    pendulum.boss.requestedSection = 'upper';
    new Resolver(pendulum, constant()).play('pair', [0, 1]);
    expect(pendulum.stats.handScores.at(-1)!.bossFactor).toBe(.5);
    expect(pendulum.boss.requestedSection).toBe('upper');
    new Resolver(pendulum, constant()).play('ones', [2]);
    expect(pendulum.stats.handScores.at(-1)!.bossFactor).toBe(1);
    expect(pendulum.boss.requestedSection).toBe('lower');
  });

  it('doubles only normal rerolls for Magician and Fly', () => {
    for (const type of ['magician', 'fly'] as const) {
      const state = newRun(`double-${type}`, constant()).state;
      state.round = 6; state.bossSchedule[6] = type;
      state.specialOfferEffects.carePackageRerolls = 2;
      new Resolver(state, constant()).startRound();
      expect(state.manualRerollsRemaining).toBe(6);
      expect(state.specialOfferEffects.carePackageRerolls).toBe(2);
    }
  });

  it('rigs only Magician final manual and post-Play random opportunities to existing called faces', () => {
    const finalManual = encounter('magician', [1, 2, 3, 4, 5]);
    if (finalManual.boss?.type !== 'magician') throw new Error('Expected Magician.');
    Object.assign(finalManual.boss, { returned: true, missingDieId: null,
      calledHands: ['sixes', 'fives', 'fours'], completedHands: [] });
    finalManual.consumed = HAND_IDS.filter(hand => hand !== 'sixes');
    finalManual.manualRerollsRemaining = 1;
    const mercy = dispatch(finalManual, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0));
    expect(mercy.error).toBeUndefined();
    expect(mercy.state.dice[0].faces[mercy.state.dice[0].value - 1].rank).toBe(6);

    const early = encounter('magician', [1, 2, 3, 4, 5]);
    if (early.boss?.type !== 'magician') throw new Error('Expected Magician.');
    Object.assign(early.boss, { returned: true, missingDieId: null,
      calledHands: ['sixes', 'fives', 'fours'], completedHands: [] });
    early.consumed = HAND_IDS.filter(hand => hand !== 'sixes'); early.manualRerollsRemaining = 2;
    const ordinary = dispatch(early, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0));
    expect(ordinary.state.dice[0].faces[ordinary.state.dice[0].value - 1].rank).not.toBe(6);

    const finalPlay = encounter('magician', [1, 2, 3, 4, 5]);
    if (finalPlay.boss?.type !== 'magician') throw new Error('Expected Magician.');
    Object.assign(finalPlay.boss, { returned: true, missingDieId: null,
      calledHands: ['sixes', 'fives', 'fours'], completedHands: [] });
    finalPlay.consumed = HAND_IDS.filter(hand => hand !== 'ones' && hand !== 'sixes');
    finalPlay.manualRerollsRemaining = 0;
    const afterPlay = dispatch(finalPlay, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    expect(afterPlay.state.dice[0].faces[afterPlay.state.dice[0].value - 1].rank).toBe(6);
  });

  it('never overrides deterministic roll controllers or fabricates a missing Magician face', () => {
    const controlled = encounter('magician', [1, 2, 3, 4, 5]);
    if (controlled.boss?.type !== 'magician') throw new Error('Expected Magician.');
    Object.assign(controlled.boss, { returned: true, missingDieId: null,
      calledHands: ['sixes', 'fives', 'fours'], completedHands: [] });
    controlled.consumed = HAND_IDS.filter(hand => hand !== 'sixes'); controlled.manualRerollsRemaining = 1;
    if (controlled.dice[0].owner !== 'player') throw new Error('Expected collectible die.');
    controlled.dice[0].effects = [createDieEffect(0, 'clockwork')];
    controlled.dieRoundState = resetDieRoundState(controlled.dice.filter(die => die.owner === 'player'));
    const clockwork = dispatch(controlled, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0));
    expect(clockwork.error).toBeUndefined();
    expect(clockwork.events.find(event => event.type === 'DIE_ROLLED')?.face).toBe(2);

    const constrained = encounter('magician', [1, 2, 3, 4, 5]);
    if (constrained.boss?.type !== 'magician') throw new Error('Expected Magician.');
    Object.assign(constrained.boss, { returned: true, missingDieId: null,
      calledHands: ['sixes'], completedHands: [] });
    constrained.consumed = HAND_IDS.filter(hand => hand !== 'sixes'); constrained.manualRerollsRemaining = 1;
    constrained.dice[0].faces.forEach(face => { face.rank = 2; });
    const noFabrication = dispatch(constrained, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0));
    expect(noFabrication.events.find(event => event.type === 'DIE_ROLLED')?.face).toBe(2);
  });

  it('latches Fly mercy and chooses an already-qualified available Lower hand after the Roll settles', () => {
    const state = encounter('fly', [1, 2, 2, 4, 5]);
    if (state.boss?.type !== 'fly') throw new Error('Expected Fly.');
    state.boss.flyHand = 'threeKind';
    state.manualRerollsRemaining = 0;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    expect(result.state.boss).toMatchObject({ type: 'fly', mercyActive: true, flyHand: 'pair' });
  });

  it('routes Free Plays through Warden and Hexer legality while retaining encounter score rules', () => {
    const warden = encounter('warden', [1, 1, 2, 3, 4]);
    if (warden.boss?.type !== 'warden') throw new Error('Expected Warden.');
    warden.boss.activeDieIds = [0];
    const before = warden.score;
    new Resolver(warden, constant()).play('ones', [1], 'freePlay');
    expect(warden.score).toBe(before);

    const hexer = encounter('hexer', [1, 2, 3, 4, 5]);
    if (hexer.boss?.type !== 'hexer') throw new Error('Expected Hexer.');
    hexer.encounterDice = [createCursedDie()];
    hexer.dice.push(hexer.encounterDice[0]);
    hexer.encounterDice[0].value = 2;
    new Resolver(hexer, constant()).play('ones', [0], 'freePlay');
    expect(hexer.score).toBe(0n);
    hexer.encounterDice[0].value = 1;
    new Resolver(hexer, constant()).play('ones', [0], 'freePlay');
    expect(hexer.score).toBeGreaterThan(0n);
  });
});

describe('last play and Retreat', () => {
  it('recognizes one playable hand even with rerolls remaining', () => {
    const state = encounter('capitalReturn');
    state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    state.dice[0].value = 1;
    state.manualRerollsRemaining = 3;
    expect(currentlyPlayableManualHands(state)).toEqual(['ones']);
  });

  it('allows Retreat only on a current dead board and reuses Bust rollback', () => {
    const state = newRun('retreat', constant()).state;
    state.dice.forEach((die, index) => { die.value = [1, 2, 3, 5, 6][index] as Rank; });
    state.consumed = ['ones', 'twos', 'threes', 'fives', 'sixes'];
    state.scorecardCycleConsumed = [...state.consumed];
    expect(currentlyPlayableManualHands(state)).toEqual([]);
    expect(validateAction(state, { type: 'RETREAT' })).toBeNull();
    const result = dispatch(state, { type: 'RETREAT' }, constant());
    expect(result.state.phase).toBe('shop');
    expect(result.state.lives).toBe(2);
    expect(result.state.bust).toMatchObject({ round: 1, livesBefore: 3, livesAfter: 2 });

    const finalLife = structuredClone(state);
    finalLife.lives = 1;
    expect(validateAction(finalLife, { type: 'RETREAT' })).toContain('end the run');
  });
});
