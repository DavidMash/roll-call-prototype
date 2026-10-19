import { describe, expect, it } from 'vitest';
import { ALL_BOSS_TYPES, BOSS_TYPES, cleanupTemporaryBossFaces, createCursedDie, MINI_BOSS_TYPES, bossSchedule } from './bosses';
import { activeFace, wholeDieEffectSuppressed } from './dice';
import { Resolver } from './effects';
import { dispatch, newRun, validateAction } from './engine';
import { planQualification } from './hands';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { SPECIAL_OFFERS } from './specialOffers';
import { resetDieRoundState } from './specialDice';
import type { DieType, GameState, RandomSource, Rank } from './types';

const constant = (value = .99): RandomSource => ({ next: () => value });

function game(type: DieType = 'normal', level = 1): GameState {
  const state = newRun(`stage8-${type}-${level}`, constant(.1)).state;
  const die = rosterDice(state)[0];
  die.type = type;
  die.level = level;
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  state.target = 1_000_000n;
  state.stats.rounds[0].target = state.target;
  return state;
}

function infectCurrent(state: GameState, dieId = 0): void {
  const die = rosterDice(state).find(item => item.id === dieId)!;
  activeFace(die).bossMutation = { kind: 'infected' };
  syncActiveDiceProjection(state);
}

function latestController(state: GameState, dieId = 0) {
  const event = [...state.historyV2].reverse().find(item => item.kind === 'roll_batch');
  if (event?.kind !== 'roll_batch') throw new Error('Expected roll history.');
  return event.results.find(result => result.dieId === dieId)?.controller;
}

describe('Clockmaker retirement', () => {
  it('removes Clockmaker from types, pools, schedules, and runtime output', () => {
    expect(MINI_BOSS_TYPES).toEqual(['juggler', 'capitalReturn', 'neglected', 'tightrope', 'crawler', 'magician', 'mugger']);
    expect(ALL_BOSS_TYPES).toEqual([...MINI_BOSS_TYPES, ...BOSS_TYPES]);
    expect(Object.values(bossSchedule('no-clockmaker', 600))).not.toContain('clockmaker');
    expect(JSON.stringify(newRun('retired-boss-state').state, (_key, value) => typeof value === 'bigint' ? value.toString() : value))
      .not.toContain('clockmaker');
  });

  it('keeps Clockwork as a whole-die controller with no boss or face controller', () => {
    const state = game('clockwork');
    state.dice[0].value = 4;
    new Resolver(state, constant(0)).rollBatch([0], 'Clockwork test', 'gameplay', false, 'manual');
    expect(state.dice[0].value).toBe(5);
    expect(latestController(state)).toBe('clockworkDie');
  });
});

describe('dedicated boss face mutations', () => {
  it('Snake Eyes changes only the scored physical face and cleanup restores its authored rank', () => {
    const state = game();
    state.boss = { type: 'snakeEyes', mutatedFaces: [] };
    state.dice[0].value = 4;
    const result = dispatch(state, { type: 'PLAY', hand: 'fours', dieIds: [0] }, constant(0));
    const die = rosterDice(result.state)[0];
    expect(die.faces[3]).toMatchObject({ rank: 1, bossMutation: { kind: 'snakeEyes', originalRank: 4 } });
    expect(die.faces.filter(face => face.bossMutation?.kind === 'snakeEyes')).toHaveLength(1);
    cleanupTemporaryBossFaces(result.state.dice);
    expect(die.faces[3]).toEqual({ rank: 4 });
  });

  it('Infected suppresses scoring and economy effects only while the infected face is exposed', () => {
    const bonus = game('bonus', 2);
    bonus.dice[0].value = 1;
    infectCurrent(bonus);
    expect(wholeDieEffectSuppressed(rosterDice(bonus)[0])).toBe(true);
    const scored = dispatch(bonus, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0));
    expect(scored.state.stats.handScores[0]).toMatchObject({ pips: 7, bonusPips: 0 });

    const golden = game('golden');
    golden.dice[0].value = 1;
    infectCurrent(golden);
    expect(dispatch(golden, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant(0)).state.stats.goldBySource.golden).toBe(0);

    const restored = game('bonus');
    restored.dice[0].value = 1;
    infectCurrent(restored);
    new Resolver(restored, constant(.3)).rollBatch([0], 'leave infection', 'gameplay', false, 'manual');
    expect(wholeDieEffectSuppressed(rosterDice(restored)[0])).toBe(false);
    const hand = `${activeFace(restored.dice[0]).rank === 1 ? 'ones' : activeFace(restored.dice[0]).rank === 2 ? 'twos'
      : activeFace(restored.dice[0]).rank === 3 ? 'threes' : activeFace(restored.dice[0]).rank === 4 ? 'fours'
      : activeFace(restored.dice[0]).rank === 5 ? 'fives' : 'sixes'}` as const;
    new Resolver(restored, constant()).play(hand, [0]);
    expect(restored.stats.handScores.at(-1)?.bonusPips).toBe(10);
  });

  it.each([
    ['mirror', 'pair', [0, 1]],
    ['conjoined', 'pair', [0]],
    ['missingLink', 'smallStraight', [0, 1, 2, 3]],
  ] as const)('suppresses %s qualification claims', (type, hand, ids) => {
    const state = game(type);
    ([1, 2, 3, 6, 5] as Rank[]).forEach((rank, index) => { state.dice[index].value = rank; });
    infectCurrent(state);
    expect(planQualification(state.dice, hand, ids, { roundState: state.dieRoundState }).legal).toBe(false);
    expect(state.dieRoundState[0].invocationsRemaining).toBe(1);
  });

  it.each(['weighted', 'clockwork', 'magic'] as const)('suppresses the %s own Roll controller', type => {
    const state = game(type);
    state.dice[0].value = 1;
    if (type === 'magic') state.dieRoundState[0].magicArmedFace = 6;
    infectCurrent(state);
    new Resolver(state, constant(.4)).rollBatch([0], 'suppressed controller', 'gameplay', false, 'manual');
    expect(latestController(state)).toBe('rng');
  });

  it('suppresses Magnetic as an external controller and blocks On Command actions', () => {
    const state = game('magnetic');
    state.dice[0].value = 6;
    infectCurrent(state);
    new Resolver(state, constant(0)).rollBatch([1], 'suppressed magnet', 'gameplay', false, 'manual');
    expect(latestController(state, 1)).toBe('rng');

    const bean = game('jumpingBean'); bean.dice[0].value = 1; infectCurrent(bean);
    expect(validateAction(bean, { type: 'INVOKE_JUMPING_BEAN', dieId: 0 })).toMatch(/suppressed/i);
    const flywheel = game('flywheel'); flywheel.dice[0].value = 1; infectCurrent(flywheel);
    expect(validateAction(flywheel, { type: 'INVOKE_FLYWHEEL', dieId: 0 })).toMatch(/suppressed/i);
  });

  it('prevents Free Play post-Roll reactions when every landing face is infected', () => {
    const state = game('freePlay');
    rosterDice(state)[0].faces.forEach(face => { face.bossMutation = { kind: 'infected' }; });
    syncActiveDiceProjection(state);
    new Resolver(state, constant(.4)).rollBatch([0], 'infected free play', 'gameplay', false, 'manual');
    expect(state.stats.jumpingBeanFreePlays).toEqual([]);
    expect(state.historyV2.filter(event => event.kind === 'hand_scored')).toEqual([]);
  });
});

describe('Hexer authored encounter faces', () => {
  it('uses a stable encounter identity and a closed dedicated effect model', () => {
    const die = createCursedDie();
    expect(die).toMatchObject({ id: -1, owner: 'boss', encounterId: 'hexer:cursed' });
    expect(die.faces.map(face => face.hexerEffect.kind)).toEqual([
      'goldenWeighted', 'goldenWeighted', 'goldenWeighted', 'wild', 'wildWorkout', 'workoutClockwork', 'wildBonus',
    ]);
    expect(die.faces.every(face => !Object.hasOwn(face, 'enhancements'))).toBe(true);
  });

  it('uses Hexer wild qualification and explicit weighted/clockwork controllers', () => {
    const state = game();
    const cursed = createCursedDie();
    state.encounterDice = [cursed];
    state.dice.push(cursed);
    state.boss = { type: 'hexer', cursedDieId: cursed.id };
    state.dice[0].value = 1; state.dice[1].value = 2; state.dice[2].value = 3; cursed.value = 4;
    expect(planQualification(state.dice, 'smallStraight', [0, 1, 2, -1], { roundState: state.dieRoundState }))
      .toMatchObject({ legal: true, effects: [{ dieId: -1, effect: 'hexerWild' }] });

    cursed.value = 1;
    new Resolver(state, constant(.75)).rollBatch([-1], 'Hexer weighted', 'gameplay', false, 'manual');
    expect(cursed.value).toBe(6);
    expect(latestController(state, -1)).toBe('hexerWeighted');
    cursed.value = 6;
    new Resolver(state, constant(0)).rollBatch([-1], 'Hexer clockwork', 'gameplay', false, 'manual');
    expect(cursed.value).toBe(7);
    expect(latestController(state, -1)).toBe('hexerClockwork');
  });
});

describe('roll arbitration and legacy cutoff', () => {
  it.each([
    ['tank', 'tank'], ['weighted', 'weightedDie'], ['clockwork', 'clockworkDie'], ['magic', 'magicDie'],
  ] as const)('places %s ahead of external Magnetic', (type, expected) => {
    const state = game(type);
    const source = rosterDice(state)[1]; source.type = 'magnetic'; source.level = 3; source.value = 6;
    syncActiveDiceProjection(state); state.dieRoundState = resetDieRoundState(rosterDice(state));
    state.dice[0].value = 1;
    if (type === 'magic') state.dieRoundState[0].magicArmedFace = 5;
    new Resolver(state, constant(0)).rollBatch([0], 'controller precedence', 'gameplay', false, 'manual');
    expect(latestController(state)).toBe(expected);
    expect(state.dieRoundState[1].invocationsRemaining).toBe(3);
  });

  it('retires every face-economy Special Offer identifier', () => {
    expect(Object.keys(SPECIAL_OFFERS)).not.toEqual(expect.arrayContaining(['cashBonus', 'orangeTheory', 'powerball', 'sommelier']));
  });

  it('serializes only whole-die identity and dedicated face mutations', () => {
    const state = game('bonus', 3);
    infectCurrent(state);
    const payload = JSON.stringify(state, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    expect(payload).not.toContain('enhancement');
    expect(payload).not.toContain('clockmaker');
    expect(payload).toContain('"type":"bonus"');
    expect(payload).toContain('"kind":"infected"');
  });
});
