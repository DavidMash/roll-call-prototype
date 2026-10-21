import { describe, expect, it } from 'vitest';
import { activeFace, createCollectibleDie } from './dice';
import { Resolver } from './effects';
import { dispatch, newRun } from './engine';
import { planQualification } from './hands';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { loadPersistedRun, savePersistedRun } from './persistence';
import {
  createDieEffect, effectOf, effectRuntime, initialDieRoundRuntime, resetDieRoundState,
  SHOP_SPECIAL_DIE_TYPES, SPECIAL_DICE, SPECIAL_DIE_TYPES,
} from './specialDice';
import type { GameState, RandomSource, Rank, SpecialDieType } from './types';
import { cleanupTemporaryBossFaces } from './bosses';

const constant = (value = 0): RandomSource => ({ next: () => value });
function game(): GameState {
  const state = newRun('composable-special-dice', constant(0)).state;
  state.target = 1_000_000n;
  state.consumed = [];
  state.scorecardCycleConsumed = [];
  return state;
}
function setEffects(state: GameState, dieId: number, effects: Array<[SpecialDieType, number]>) {
  const die = state.diceInventory.instances[dieId];
  die.effects = effects.map(([type, level]) => createDieEffect(die.id, type, level));
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  syncActiveDiceProjection(state);
  return die;
}
function values(state: GameState, ranks: Rank[]) {
  ranks.forEach((rank, index) => { state.diceInventory.instances[index].value = rank; });
  syncActiveDiceProjection(state);
}

describe('composable special-die registry', () => {
  it('registers the complete 24-component catalog with authoritative presentation and economy metadata', () => {
    expect(SPECIAL_DIE_TYPES).toHaveLength(24);
    expect(new Set(SPECIAL_DIE_TYPES)).toHaveLength(24);
    for (const type of SPECIAL_DIE_TYPES) {
      const definition = SPECIAL_DICE[type];
      expect(definition.type).toBe(type);
      expect(definition.name).toBeTruthy();
      expect(definition.icon).toBeTypeOf('object');
      expect(definition.color).toMatch(/^#[0-9a-f]{6}$/i);
      if (type !== 'basic') {
        expect(definition.purchasePrice).toBe({ common: 10, uncommon: 20, rare: 30, legendary: 40 }[definition.rarity]);
        expect(definition.forgeBaseWeight).toBe({ common: 2, uncommon: 3, rare: 5, legendary: 8 }[definition.rarity]);
      }
      expect(definition.verboseDescription(1).length).toBeGreaterThan(0);
    }
    expect(new Set(SPECIAL_DIE_TYPES.map(type => SPECIAL_DICE[type].icon))).toHaveLength(24);
    expect(new Set(SPECIAL_DIE_TYPES.map(type => SPECIAL_DICE[type].color))).toHaveLength(24);
    expect(SHOP_SPECIAL_DIE_TYPES).not.toContain('basic');
    expect(SPECIAL_DICE.basic).toMatchObject({ componentSalvage: 1, forgeBaseWeight: 1 });
    expect(SPECIAL_DICE.bonus.color).toBe('#12b886');
    expect(SPECIAL_DICE.bonus.color).not.toBe(SPECIAL_DICE.golden.color);
    expect(SPECIAL_DICE.freePlay.name).toBe('Curtain Call');
  });

  it('represents Normal as zero effects and a special die as an effect instance', () => {
    expect(createCollectibleDie(1).effects).toEqual([]);
    const die = createCollectibleDie(2, 'magic', 3);
    expect(die.effects).toEqual([expect.objectContaining({ id: '2:magic', type: 'magic', level: 3 })]);
    expect(die).not.toHaveProperty('type');
    expect(die).not.toHaveProperty('level');
  });

  it('keeps independent runtime state for every effect instance on one die', () => {
    const die = createCollectibleDie(7, 'magic', 2);
    die.effects.push(createDieEffect(7, 'mirror', 4));
    const runtime = initialDieRoundRuntime(die);
    expect(effectRuntime(runtime, effectOf(die, 'magic'))?.invocationsRemaining).toBe(2);
    expect(effectRuntime(runtime, effectOf(die, 'mirror'))?.invocationsRemaining).toBe(4);
    effectRuntime(runtime, effectOf(die, 'magic'))!.invocationsRemaining--;
    expect(effectRuntime(runtime, effectOf(die, 'magic'))?.invocationsRemaining).toBe(1);
    expect(effectRuntime(runtime, effectOf(die, 'mirror'))?.invocationsRemaining).toBe(4);
  });

  it('resets Round state without discarding persistent effect configuration', () => {
    const die = createCollectibleDie(9, 'weighted', 2);
    effectOf(die, 'weighted')!.persistent.weightedFace = 4;
    const first = initialDieRoundRuntime(die);
    effectRuntime(first, effectOf(die, 'weighted'))!.invocationsRemaining = 0;
    const next = initialDieRoundRuntime(die);
    expect(effectRuntime(next, effectOf(die, 'weighted'))).toMatchObject({ weightedFace: 4, invocationsRemaining: 0 });
    expect(effectOf(die, 'weighted')!.persistent.weightedFace).toBe(4);
  });
});

describe('composable roll controllers', () => {
  it('lets Magic win over another controller on the same die and only spends Magic', () => {
    const state = game();
    const die = setEffects(state, 0, [['magic', 1], ['weighted', 1]]);
    effectOf(die, 'weighted')!.persistent.weightedFace = 6;
    const magic = effectRuntime(state.dieRoundState[die.id], effectOf(die, 'magic'))!;
    const weighted = effectRuntime(state.dieRoundState[die.id], effectOf(die, 'weighted'))!;
    magic.magicArmedFace = 4;
    new Resolver(state, constant(.2)).manualReroll([die.id]);
    expect(activeFace(die).rank).toBe(4);
    expect(magic.invocationsRemaining).toBe(0);
    expect(weighted.invocationsRemaining).toBe(0);
  });

  it('lets an external Magnetic controller shadow Weighted without spending Weighted', () => {
    const state = game();
    const anchor = setEffects(state, 0, [['magnetic', 1]]);
    const target = setEffects(state, 1, [['weighted', 1]]);
    anchor.value = 5;
    effectOf(target, 'weighted')!.persistent.weightedFace = 6;
    state.dieRoundState = resetDieRoundState(rosterDice(state));
    new Resolver(state, constant(.2)).manualReroll([target.id]);
    expect(activeFace(target).rank).toBe(5);
    expect(effectRuntime(state.dieRoundState[anchor.id], effectOf(anchor, 'magnetic'))?.invocationsRemaining).toBe(0);
    expect(effectRuntime(state.dieRoundState[target.id], effectOf(target, 'weighted'))?.invocationsRemaining).toBe(0);
  });

  it('preserves Clockwork precedence because Weighted only affects genuinely randomized Rolls', () => {
    const state = game();
    const die = setEffects(state, 0, [['weighted', 1], ['clockwork', 2]]);
    effectOf(die, 'weighted')!.persistent.weightedFace = 6;
    state.dieRoundState = resetDieRoundState(rosterDice(state));
    new Resolver(state, constant(.2)).manualReroll([die.id]);
    expect(activeFace(die).rank).toBe(2);
    expect(effectRuntime(state.dieRoundState[die.id], effectOf(die, 'clockwork'))?.clockworkRolls).toBe(1);
  });
});

describe('persistent Chameleon faces', () => {
  it('uses the unique majority shown by the other equipped dice', () => {
    let state = game();
    values(state, [6, 3, 3, 3, 4]);
    setEffects(state, 0, [['chameleon', 1]]);
    state = dispatch(state, { type: 'INVOKE_CHAMELEON', dieId: 0 }, constant(.99)).state;
    expect(state.diceInventory.instances[0].faces[5].rank).toBe(3);
  });

  it('rewrites the current physical face, ignores itself, and chooses only among seeded top ties', () => {
    let state = game();
    values(state, [6, 1, 2, 3, 4]);
    setEffects(state, 0, [['chameleon', 2]]);
    let result = dispatch(state, { type: 'INVOKE_CHAMELEON', dieId: 0 }, constant(.6));
    state = result.state;
    expect(state.diceInventory.instances[0].value).toBe(6);
    expect(state.diceInventory.instances[0].faces[5].rank).toBe(3);
    expect(activeFace(state.diceInventory.instances[0]).rank).toBe(3);
    expect(effectRuntime(state.dieRoundState[0], effectOf(state.diceInventory.instances[0], 'chameleon'))?.invocationsRemaining).toBe(1);
    expect(result.events.at(-1)?.type).toBe('DIE_FLIPPED');

    // The other dice are tied 2-2 between 2 and 5. Counting Chameleon itself would
    // incorrectly make 2 the unique majority; the seeded tie choice instead selects 5.
    values(state, [2, 2, 2, 5, 5]);
    result = dispatch(state, { type: 'INVOKE_CHAMELEON', dieId: 0 }, constant(.99));
    state = result.state;
    expect(state.diceInventory.instances[0].faces[1].rank).toBe(5);
    expect(state.diceInventory.instances[0].faces[5].rank).toBe(3);
    expect(effectRuntime(state.dieRoundState[0], effectOf(state.diceInventory.instances[0], 'chameleon'))?.invocationsRemaining).toBe(0);
    expect(dispatch(state, { type: 'INVOKE_CHAMELEON', dieId: 0 }, constant()).error).toMatch(/no Uses remaining/);
  });

  it('keeps rewritten faces through Rolls, later Rounds, Storage, and serialization', () => {
    let state = game();
    values(state, [1, 3, 3, 4, 5]);
    setEffects(state, 0, [['chameleon', 1]]);
    state = dispatch(state, { type: 'INVOKE_CHAMELEON', dieId: 0 }, constant()).state;
    expect(state.diceInventory.instances[0].faces[0].rank).toBe(3);

    new Resolver(state, constant(.3)).rollBatch([0], 'later Roll', 'gameplay', false, 'other');
    new Resolver(state, constant(0)).rollBatch([0], 'return Roll', 'gameplay', false, 'other');
    expect(activeFace(state.diceInventory.instances[0]).rank).toBe(3);
    new Resolver(state, constant(0)).startRound();
    expect(state.diceInventory.instances[0].faces[0].rank).toBe(3);

    state.diceInventory.roster[0] = null;
    state.diceInventory.storage[0] = 0;
    syncActiveDiceProjection(state);
    expect(state.diceInventory.instances[0].faces[0].rank).toBe(3);
    const valuesByKey = new Map<string, string>();
    const storage = { getItem: (key: string) => valuesByKey.get(key) ?? null,
      setItem: (key: string, value: string) => { valuesByKey.set(key, value); } };
    expect(savePersistedRun(storage, state)).toBe(true);
    expect(loadPersistedRun(storage, state.seed)?.diceInventory.instances[0].faces[0].rank).toBe(3);
  });

  it('can reshape every physical face through higher-level Uses without reverting prior mutations', () => {
    let state = game();
    setEffects(state, 0, [['chameleon', 6]]);
    for (const physicalFace of [1, 2, 3, 4, 5, 6] as const) {
      values(state, [physicalFace, 3, 3, 3, 4]);
      state = dispatch(state, { type: 'INVOKE_CHAMELEON', dieId: 0 }, constant()).state;
    }
    expect(state.diceInventory.instances[0].faces.map(face => face.rank)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(effectRuntime(state.dieRoundState[0], effectOf(state.diceInventory.instances[0], 'chameleon'))?.invocationsRemaining).toBe(0);
  });

  it('preserves a destination mutation through Shop entry and a Fusion', () => {
    let state = game();
    values(state, [1, 3, 3, 4, 5]);
    setEffects(state, 0, [['chameleon', 1]]);
    state = dispatch(state, { type: 'INVOKE_CHAMELEON', dieId: 0 }, constant()).state;
    const source = createCollectibleDie(5, 'chameleon');
    state.diceInventory.instances[source.id] = source;
    state.diceInventory.storage[0] = source.id;
    state.diceInventory.nextDieId = 6;
    new Resolver(state, constant()).openShop();
    state.forgeUnlocked = true;
    state.temper = 10;
    state.shop!.stage = 'forge';
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'A', dieId: 0 }).state;
    state = dispatch(state, { type: 'SET_FORGE_INGREDIENT', socket: 'B', dieId: 5 }).state;
    state = dispatch(state, { type: 'CONFIRM_FORGE' }).state;
    const result = state.diceInventory.instances[6];
    expect(effectOf(result, 'chameleon')?.level).toBe(2);
    expect(result.faces[0].rank).toBe(3);
  });

  it('survives cleanup of a temporary Snake Eyes mutation', () => {
    let state = game();
    values(state, [1, 3, 3, 4, 5]);
    const die = setEffects(state, 0, [['chameleon', 1]]);
    die.faces[0] = { rank: 1, bossMutation: { kind: 'snakeEyes', originalRank: 1 } };
    state = dispatch(state, { type: 'INVOKE_CHAMELEON', dieId: 0 }, constant()).state;
    expect(state.diceInventory.instances[0].faces[0]).toMatchObject({ rank: 3, bossMutation: { originalRank: 3 } });
    cleanupTemporaryBossFaces(state.dice);
    expect(state.diceInventory.instances[0].faces[0]).toEqual({ rank: 3 });
  });
});

describe('Conjoined qualification and real Score occurrences', () => {
  it('qualifies Pair by itself, contributes two faces, and spends exactly one Use', () => {
    const state = game();
    values(state, [4, 2, 3, 5, 6]);
    const die = setEffects(state, 0, [['conjoined', 2]]);
    const plan = planQualification(rosterDice(state), 'pair', [die.id], { roundState: state.dieRoundState });
    expect(plan).toMatchObject({ legal: true, resourceClaims: [{ dieId: die.id, effect: 'conjoined', amount: 1 }] });
    new Resolver(state, constant()).play('pair', [die.id], 'manual', null, plan.resourceClaims);
    expect(state.stats.handScores.at(-1)?.pips).toBe(16);
    expect(effectRuntime(state.dieRoundState[die.id], effectOf(die, 'conjoined'))?.invocationsRemaining).toBe(1);
    const scored = [...state.historyV2].reverse().find(event => event.kind === 'hand_scored');
    expect(scored?.kind === 'hand_scored' ? scored.scoreOccurrences.map(item => item.cause) : [])
      .toEqual(['play_selection', 'conjoined']);
  });

  it('automatically claims an available Conjoined effect for an Upper Hand and exhausts cleanly', () => {
    const state = game();
    values(state, [4, 2, 3, 5, 6]);
    const die = setEffects(state, 0, [['conjoined', 1]]);
    const plan = planQualification(rosterDice(state), 'fours', [die.id], { roundState: state.dieRoundState });
    expect(plan.resourceClaims).toEqual([expect.objectContaining({ dieId: die.id, effect: 'conjoined', amount: 1 })]);
    const played = dispatch(state, { type: 'PLAY', hand: 'fours', dieIds: [die.id] }, constant()).state;
    const playedDie = played.diceInventory.instances[die.id];
    expect(played.stats.handScores.at(-1)?.pips).toBe(15);
    expect(effectRuntime(played.dieRoundState[die.id], effectOf(playedDie, 'conjoined'))?.invocationsRemaining).toBe(0);
    expect(planQualification(rosterDice(played), 'fours', [die.id], { roundState: played.dieRoundState }).resourceClaims).toEqual([]);
    expect(planQualification(rosterDice(played), 'pair', [die.id], { roundState: played.dieRoundState }).legal).toBe(false);
  });

  it('runs per-Score effects twice without duplicating once-per-Play behavior or recursing', () => {
    const state = game();
    values(state, [4, 2, 3, 5, 6]);
    const die = setEffects(state, 0, [
      ['conjoined', 1], ['bonus', 1], ['golden', 1], ['vintage', 1], ['workout', 1], ['furnace', 1], ['sustainable', 1],
    ]);
    effectRuntime(state.dieRoundState[die.id], effectOf(die, 'furnace'))!.furnaceUnits = 5;
    const plan = planQualification(rosterDice(state), 'fours', [die.id], { roundState: state.dieRoundState });
    new Resolver(state, constant(.99)).play('fours', [die.id], 'manual', null, plan.resourceClaims);
    const scored = [...state.historyV2].reverse().find(event => event.kind === 'hand_scored');
    expect(scored?.kind === 'hand_scored' ? scored.scoreOccurrences : []).toHaveLength(2);
    expect(state.stats.handScores.at(-1)?.pips).toBe(64);
    expect(state.stats.goldBySource.golden).toBe(2);
    expect(effectOf(die, 'vintage')?.persistent.vintageAppreciation).toBe(2);
    expect(effectRuntime(state.dieRoundState[die.id], effectOf(die, 'workout'))?.temporaryPips).toBe(4);
    expect(effectRuntime(state.dieRoundState[die.id], effectOf(die, 'furnace'))?.furnaceUnits).toBe(3);
    expect(effectRuntime(state.dieRoundState[die.id], effectOf(die, 'sustainable'))?.invocationsRemaining).toBe(0);
    expect(state.handPlayCounts.fours).toBe(1);
    expect(state.consumed).not.toContain('fours');
  });
});
