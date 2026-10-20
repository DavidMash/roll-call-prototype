import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { rosterDice, syncActiveDiceProjection } from './inventory';
import { RUN_STORAGE_VERSION } from './persistence';
import { RUN_HISTORY_V2_SCHEMA_VERSION } from './runHistoryV2';
import { summarizeRunHistoryV2 } from './runHistoryV2Summary';
import { resetDieRoundState } from './specialDice';
import { placeFlameInstance } from './flames';
import type { DieType, GameState, RandomSource } from './types';

const constant = (value = .1): RandomSource => ({ next: () => value });

function special(type: DieType, level = 1): GameState {
  const state = newRun(`stage9-${type}-${level}`, constant()).state;
  const die = rosterDice(state)[0];
  die.type = type;
  die.level = level;
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  state.target = 1_000_000n;
  state.stats.rounds[0].target = state.target;
  return state;
}

describe('Stage 9 current schema and observability', () => {
  it('creates only current Shop, Training, Flame, and history state', () => {
    const state = newRun('stage9-schema', constant()).state;
    const payload = JSON.parse(JSON.stringify(state, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
    expect(RUN_STORAGE_VERSION).toBe(19);
    expect(RUN_HISTORY_V2_SCHEMA_VERSION).toBe(16);
    expect(payload).not.toHaveProperty('suppressedPostBossRewardRounds');
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('trainingOffers');
    expect(serialized).not.toContain('freeTrainingOfferKeys');
    expect(serialized).not.toContain('wildfire');
    expect(serialized).not.toContain('hooded_challenge_changed');
  });

  it('records genuine additional Score occurrences and only suppresses Double Time recursion', () => {
    const state = special('doubleTime', 4);
    rosterDice(state)[0].value = 1;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [rosterDice(state)[0].id] }, constant()).state;
    const hand = result.historyV2.find(event => event.kind === 'hand_scored');
    if (hand?.kind !== 'hand_scored') throw new Error('Expected hand history.');
    expect(hand.scoreOccurrences).toHaveLength(2);
    expect(hand.scoreOccurrences[0]).toMatchObject({ cause: 'play_selection', additional: false, suppressedEffects: [] });
    expect(hand.scoreOccurrences[1]).toMatchObject({ cause: 'double_time', additional: true,
      suppressedEffects: ['wholeDieDoubleTime'] });
  });

  it('records On Command activations and Invocation spending outside a hand', () => {
    const state = special('flywheel', 2);
    const die = rosterDice(state)[0];
    const result = dispatch(state, { type: 'INVOKE_FLYWHEEL', dieId: die.id }, constant()).state;
    const activation = result.historyV2.find(event => event.kind === 'special_die_activated');
    expect(activation).toMatchObject({ kind: 'special_die_activated', dieId: die.id, dieType: 'flywheel',
      level: 2, context: 'command', invocationBefore: 2, invocationAfter: 1 });
    expect(summarizeRunHistoryV2(result.historyV2, result).experienced.specialDice.flywheel)
      .toMatchObject({ activations: 1, invocationsSpent: 1, commandUses: 1 });
  });

  it('keeps global Flame ownership out of die history snapshots', () => {
    const state = newRun('stage9-history-dice', constant()).state;
    const started = state.historyV2.find(event => event.kind === 'round_attempt_started');
    if (started?.kind !== 'round_attempt_started') throw new Error('Expected Round start.');
    for (const die of started.dice) {
      expect(die).not.toHaveProperty('flame');
      expect(die).not.toHaveProperty('flameInstanceId');
    }
  });

  it('counts each Flame activation once despite its contextual score records', () => {
    const state = newRun('stage9-flame-activation', constant()).state;
    placeFlameInstance(state, 'minigun', 100);
    for (const die of rosterDice(state)) die.value = 1;
    const dieId = rosterDice(state)[0].id;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [dieId] }, constant()).state;
    expect(result.historyV2.filter(event => event.kind === 'flame_changed'
      && event.change.type === 'activated' && event.change.flame === 'minigun')).toHaveLength(1);
    expect(summarizeRunHistoryV2(result.historyV2, result).experienced.flameActivations.minigun).toBe(1);
  });
});
