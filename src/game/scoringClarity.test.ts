import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { deriveFlamePresentations } from './flamePresentation';
import { placeFlameInstance } from './flames';
import { ultimateHands } from './hands';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { canonicalPlayPreview } from './playPreview';
import { createDieEffect, resetDieRoundState } from './specialDice';
import { RUN_HISTORY_V2_RULESET, RUN_HISTORY_V2_SCHEMA_VERSION } from './runHistoryV2';
import { renderHandScoredV2 } from './runHistoryV2Renderer';
import type { Flame, GameState, RandomSource, Rank } from './types';

const constant = (value = .99): RandomSource => ({ next: () => value });
function stateWith(...flames: Flame[]): GameState {
  const state = newRun(`clarity-${flames.join('-')}`, constant()).state;
  state.target = 10n ** 20n;
  state.stats.rounds.at(-1)!.target = state.target;
  flames.forEach(flame => placeFlameInstance(state, flame, 100));
  return state;
}
function setFaces(state: GameState, ranks: Rank[]): number[] {
  const dice = rosterDice(state);
  ranks.forEach((rank, index) => { dice[index].value = rank; });
  syncActiveDiceProjection(state);
  return ranks.map((_, index) => dice[index].id);
}
const stateOf = (state: GameState, flame: Flame, preview: ReturnType<typeof canonicalPlayPreview> | null = null) =>
  deriveFlamePresentations(state, preview).find(item => item.flame === flame)!;

describe('canonical scoring clarity preview', () => {
  it('omits no canonical die Pips and agrees with resolved enhanced and Hitchhiker scoring', () => {
    const state = stateWith();
    const dice = rosterDice(state);
    setFaces(state, [4, 4, 4, 2, 6]);
    dice[0].effects = [createDieEffect(dice[0].id, 'basic', 2), createDieEffect(dice[0].id, 'bonus', 2)];
    dice[4].effects = [createDieEffect(dice[4].id, 'hitchhiker', 1)];
    state.dieRoundState = resetDieRoundState(dice);
    const ids = dice.slice(0, 3).map(die => die.id);
    const preview = canonicalPlayPreview(state, 'threeKind', ids);
    const resolved = dispatch(state, { type: 'PLAY', hand: 'threeKind', dieIds: ids }, constant());
    expect(preview.diePips).toEqual(expect.arrayContaining([
      expect.objectContaining({ dieId: dice[0].id, pips: 28 }),
      expect.objectContaining({ dieId: dice[4].id, pips: 6, role: 'hitchhiker' }),
    ]));
    expect(preview.pips).toBe(resolved.state.stats.handScores[0].pips);
    expect(preview.score).toBe(resolved.state.stats.handScores[0].score);
    const finalEvent = resolved.events.find(event => event.type === 'HAND_SCORE_FINALIZED')!;
    expect(finalEvent.resolvedDicePips?.map(item => ({ dieId: item.dieId, pips: item.totalPips, role: item.role })))
      .toEqual(preview.diePips);
    const dieEvents = resolved.events.filter(event => event.type === 'DIE_PIPS_RESOLVED');
    expect(dieEvents.map(event => event.resolvedDiePips?.dieId)).toEqual([...ids, dice[4].id]);
    expect(dieEvents.map(event => event.resolvedDiePips?.resolutionId)).toEqual(
      dieEvents.map(event => event.resolvedDiePips?.resolutionId).filter((id, index, all) => all.indexOf(id) === index),
    );
    expect(dieEvents[0].resolvedDiePips?.runningPipsBefore).toBe(0);
    for (let index = 1; index < dieEvents.length; index++) {
      expect(dieEvents[index].resolvedDiePips?.runningPipsBefore)
        .toBe(dieEvents[index - 1].resolvedDiePips?.runningPipsAfter);
    }
    expect(dieEvents.at(-1)?.resolvedDiePips?.runningPipsAfter).toBe(preview.pips);
    expect(resolved.events.findIndex(event => event.type === 'HAND_MULTIPLIER_CHANGED'))
      .toBeGreaterThan(resolved.events.map(event => event.type).lastIndexOf('DIE_PIPS_RESOLVED'));
    const history = resolved.state.historyV2.find(event => event.kind === 'hand_scored')!;
    expect(history.kind === 'hand_scored' ? history.score : null).toMatchObject({ finalPips: 42, handMult: 3 });
    expect(history).not.toHaveProperty('score.basePips');
    expect(history).not.toHaveProperty('score.baseMult');
    expect(history.kind === 'hand_scored' ? renderHandScoredV2(history) : '')
      .toContain('42 Pips × 3 Mult = 126');
    expect(resolved.state.historyV2.find(event => event.kind === 'run_started')).toMatchObject({
      schemaVersion: RUN_HISTORY_V2_SCHEMA_VERSION,
      ruleset: RUN_HISTORY_V2_RULESET,
    });
  });

  it('aggregates duplicate Score occurrences into one authoritative die beat', () => {
    const state = stateWith();
    const dice = rosterDice(state);
    const ids = setFaces(state, [2, 2]);
    dice[0].effects = [createDieEffect(dice[0].id, 'doubleTime', 4)];
    state.dieRoundState = resetDieRoundState(dice);
    const preview = canonicalPlayPreview(state, 'pair', ids);
    const resolved = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: ids }, constant());
    const beats = resolved.events.filter(event => event.type === 'DIE_PIPS_RESOLVED');
    expect(beats).toHaveLength(2);
    expect(beats[0].resolvedDiePips).toMatchObject({ dieId: dice[0].id, totalPips: 4 });
    expect(beats[0].resolvedDiePips?.occurrenceIds).toHaveLength(2);
    expect(new Set(beats[0].resolvedDiePips?.components.map(component => component.occurrenceId)).size).toBe(2);
    expect(beats.reduce((sum, event) => sum + (event.resolvedDiePips?.totalPips ?? 0), 0)).toBe(preview.pips);
  });

  it('combines multiple canonical Flame factors and deterministic Double Time', () => {
    const state = stateWith('missingPair', 'lowball');
    const ids = setFaces(state, [1, 1]);
    const die = rosterDice(state)[0];
    die.effects = [createDieEffect(die.id, 'doubleTime', 4)];
    state.dieRoundState = resetDieRoundState(rosterDice(state));
    const preview = canonicalPlayPreview(state, 'pair', ids);
    const resolved = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: ids }, constant());
    expect(preview.xMultFactors.filter(item => item.source === 'missingPair' || item.source === 'lowball')
      .map(item => item.value)).toEqual([3, 3.5]);
    expect(preview.effectiveXMult).toBe(10.5);
    expect(preview.score).toBe(resolved.state.stats.handScores[0].score);
  });

  it('keeps Charge, Boss modifiers, and Inferno in preview/resolution agreement', () => {
    const state = stateWith('momentum');
    const ids = setFaces(state, [1]);
    state.chargeXMult = 2;
    state.maxCharge = 2;
    state.chargeArmed = true;
    state.engulfmentLevel = 1;
    state.boss = { type: 'fly', flyHand: 'pair', caught: false, moves: 0 };
    const preview = canonicalPlayPreview(state, 'ones', ids);
    const resolved = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: ids }, constant());
    expect(preview.xMult).toBe(2);
    expect(preview.bossFactor).toBe(.5);
    expect(preview.effectiveXMult).toBe(1);
    expect(preview.infernoMultiplier).toBe(25n);
    expect(preview.score).toBe(resolved.state.stats.handScores[0].score);
  });
});

describe('canonical Flame presentation states', () => {
  it('prioritizes Active over Possible over Setup for Double Down', () => {
    const state = stateWith('doubleDown');
    const ids = setFaces(state, [2, 2, 1, 1]);
    expect(stateOf(state, 'doubleDown').state).toBe('normal');
    state.handFamilyFlameStages.doubleDown = 'payoff';
    state.consumed.push('twoPair');
    expect(stateOf(state, 'doubleDown').state).toBe('setup');
    state.consumed = [];
    expect(stateOf(state, 'doubleDown').state).toBe('possible');
    const preview = canonicalPlayPreview(state, 'twoPair', ids);
    expect(stateOf(state, 'doubleDown', preview)).toMatchObject({ state: 'active', contribution: { kind: 'xmult', value: 6 } });
  });

  it('derives Count Down progress and selected-step state without mutable UI state', () => {
    const state = stateWith('countDown');
    state.consumed.push('sixes');
    expect(stateOf(state, 'countDown').state).toBe('normal');
    state.progressiveFlames.countDown = 2;
    state.consumed = ['fours'];
    expect(stateOf(state, 'countDown')).toMatchObject({ state: 'setup', progress: 2 / 6, targetHand: 'fours' });
    state.consumed = [];
    const ids = setFaces(state, [4]);
    expect(stateOf(state, 'countDown').state).toBe('possible');
    expect(stateOf(state, 'countDown', canonicalPlayPreview(state, 'fours', ids)).state).toBe('active');
  });

  it('represents Double or Nothing and Dare Devil stored opportunities', () => {
    const wager = stateWith('doubleOrNothing');
    wager.scoreWagers.doubleOrNothing = { hand: 'pair', acceptedPackageId: 'pkg', factor: 9, acceptedAtPlayCount: 1 };
    wager.consumed.push('pair');
    expect(stateOf(wager, 'doubleOrNothing')).toMatchObject({ state: 'setup', targetHand: 'pair' });
    wager.consumed = [];
    setFaces(wager, [2, 2]);
    expect(stateOf(wager, 'doubleOrNothing').state).toBe('possible');

    const dare = stateWith('dareDevil');
    dare.interactiveFlames.dareDevilCount = 2;
    const ultimate = ultimateHands(dare.handLevels)[0];
    dare.consumed.push(ultimate);
    expect(stateOf(dare, 'dareDevil')).toMatchObject({ state: 'setup', progress: .5 });
    dare.consumed = [];
    expect(stateOf(dare, 'dareDevil').state).toBe('possible');
  });

  it('marks Fat Cat Possible from legal board state and Active only for the selected qualifying dice', () => {
    const state = stateWith('fatCat');
    const dice = rosterDice(state);
    dice[0].effects = [createDieEffect(dice[0].id, 'golden', 1)];
    state.dieRoundState = resetDieRoundState(dice);
    const ids = setFaces(state, [1]);
    expect(stateOf(state, 'fatCat').state).toBe('possible');
    expect(stateOf(state, 'fatCat', canonicalPlayPreview(state, 'ones', ids))).toMatchObject({
      state: 'active', contribution: { kind: 'xmult', value: 1.3 },
    });
  });

  it('burns Speed Demon presentation down to Normal without displaying ×1', () => {
    const state = stateWith('speedDemon');
    expect(deriveFlamePresentations(state, null, 500).find(item => item.flame === 'speedDemon')).toMatchObject({
      state: 'active', statusText: '×4', progress: 1,
    });
    expect(deriveFlamePresentations(state, null, 5000).find(item => item.flame === 'speedDemon')).toMatchObject({
      state: 'normal', statusText: undefined, progress: 0,
    });
  });
});
