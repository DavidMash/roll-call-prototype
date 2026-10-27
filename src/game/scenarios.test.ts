import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { createInfernoEvaluation } from './engulfment';
import { flameInstances, FLAMES } from './flames';
import { handStats, HAND_IDS } from './hands';
import { rosterDice } from './inventory';
import { SCENARIOS, canonicalRoundForScenarioGoal, handLevelsForScenario, scenarioById,
  validateScenarioDefinition, validateScenarioDefinitions } from './scenarios';
import type { RandomSource } from './types';
import { SPECIAL_DICE } from './specialDice';

const constant: RandomSource = { next: () => .25 };

describe('Scenario definitions', () => {
  it('has six unique stable IDs and validates every current asset', () => {
    expect(SCENARIOS).toHaveLength(6);
    expect(new Set(SCENARIOS.map(scenario => scenario.id)).size).toBe(6);
    expect(() => validateScenarioDefinitions()).not.toThrow();
    expect(SCENARIOS.flatMap(validateScenarioDefinition)).toEqual([]);
  });

  it('uses canonical keys for every requested current effect and Flame', () => {
    expect(['loneWolf', 'clockwork', 'flywheel', 'tank', 'vintage', 'magnetic', 'jumpingBean', 'chameleon',
      'weighted', 'golden', 'jackpot', 'furnace'].map(key => SPECIAL_DICE[key as keyof typeof SPECIAL_DICE].name))
      .toEqual(['Lone Wolf', 'Clockwork', 'Flywheel', 'Tank', 'Vintage', 'Magnetic', 'Jumping Bean', 'Chameleon',
        'Weighted', 'Golden', 'Jackpot', 'Furnace']);
    expect(['minigun', 'countDown', 'straightShooter', 'oneShort', 'fluxCapacitor', 'dareDevil', 'vineyard', 'hailMary']
      .map(key => FLAMES[key as keyof typeof FLAMES].name))
      .toEqual(['Minigun', 'Count Down', 'Straight Shooter', 'One Short', 'Flux Capacitor', 'Dare Devil', 'Vineyard', 'Hail Mary']);
    expect(Object.values(FLAMES).some(flame => flame.name === 'Bribery')).toBe(false);
  });

  it('maps every launch Goal to the canonical progression', () => {
    expect(SCENARIOS.map(scenario => [scenario.startingGoal, canonicalRoundForScenarioGoal(scenario.startingGoal)]))
      .toEqual([[4_000n, 15], [6_000n, 17], [2_000n, 13], [6_000n, 17], [9_000n, 19], [4_000n, 15]]);
  });

  it('applies configured dice, levels, and real Flame investment', () => {
    for (const scenario of SCENARIOS) {
      const state = newRun(`scenario-definition-${scenario.id}`, constant, { scenario }).state;
      expect(state.runMode).toBe('scenario');
      expect(state.scenario).toMatchObject({ id: scenario.id, version: scenario.version, name: scenario.name });
      expect(rosterDice(state)).toHaveLength(scenario.roster.length);
      expect(rosterDice(state).map(die => die.effects.map(effect => [effect.type, effect.level])))
        .toEqual(scenario.roster.map(die => die.effects.map(effect => [effect.key, effect.level])));
      expect(state.handLevels).toEqual(handLevelsForScenario(scenario));
      expect(flameInstances(state).map(flame => [flame.type, flame.investedGold, flame.stage]))
        .toEqual(scenario.flames.map(flame => [flame.key, flame.investedGold, 'ember']));
      expect(state.gold).toBe(scenario.startingGold);
      expect(state.temper).toBe(scenario.startingTemper);
      expect(state.lives).toBe(scenario.startingLives);
      expect(state.round).toBe(1);
      expect(state.target).toBe(scenario.startingGoal);
    }
  });

  it('starts Loneliest Number with exactly one die and no Normal fill', () => {
    const state = newRun('scenario-lonely', constant, { scenario: scenarioById('loneliest-number')! }).state;
    expect(rosterDice(state)).toHaveLength(1);
    expect(state.diceInventory.roster).toEqual([0, null, null, null, null]);
    expect(rosterDice(state)[0].effects.map(effect => effect.type)).toEqual(['loneWolf', 'clockwork', 'flywheel']);
  });

  it('uses actual configured Hand Mult values', () => {
    const levels = handLevelsForScenario(scenarioById('loneliest-number')!);
    expect(['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].map(hand => levels[hand as keyof typeof levels]))
      .toEqual([12, 9, 8, 7, 6, 5]);
    expect(handStats('ones', levels.ones).handMultiplier).toBeGreaterThan(handStats('sixes', levels.sixes).handMultiplier);
    expect(HAND_IDS.filter(hand => !['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].includes(hand))
      .every(hand => levels[hand] === 3)).toBe(true);
  });
});

describe('Scenario progression and completion', () => {
  it('advances from the configured Goal while keeping Scenario cadence fresh', () => {
    const scenario = scenarioById('loneliest-number')!;
    const state = newRun('scenario-goal-track', constant, { scenario }).state;
    state.round = 2;
    new Resolver(state, constant).startRound();
    expect(state.target).toBe(5_000n);
    expect(state.boss).toBeNull();
    state.round = 3;
    new Resolver(state, constant).startRound();
    expect(state.boss).not.toBeNull();
    expect(state.bossSchedule[3]).toBeTruthy();
  });

  it('records the first Engulfment once, pauses for completion, then continues normally', () => {
    const state = newRun('scenario-completion', constant, { scenario: scenarioById('short-circuit')! }).state;
    const evaluation = createInfernoEvaluation(state)!;
    evaluation.success = true;
    evaluation.flamesSnuffed = [];
    evaluation.flamesPreserved = [];
    evaluation.infernoLevelAfter = 1;
    evaluation.infernoMultiplierAfter = 25n;
    state.infernoEvaluation = evaluation;
    state.phase = 'inferno';
    const resolver = new Resolver(state, constant);
    resolver.engulfNow();
    expect(state.scenario?.completionPending).toBe(true);
    resolver.continueInfernoEvaluation();
    expect(state.phase).toBe('scenarioComplete');
    const continued = dispatch(state, { type: 'CONTINUE_SCENARIO_RUN' }, constant).state;
    expect(continued.scenario).toMatchObject({ completionPending: false, completionAcknowledged: true });
    expect(continued.phase).not.toBe('scenarioComplete');
  });

  it('tags Scenario run history without changing normal run starts', () => {
    const scenario = newRun('scenario-history', constant, { scenario: scenarioById('popcorn')! }).state;
    const normal = newRun('normal-history', constant).state;
    expect(scenario.historyV2.find(event => event.kind === 'run_started')).toMatchObject({
      runMode: 'scenario', scenarioId: 'popcorn', scenarioVersion: 1, scenarioName: 'Popcorn',
    });
    expect(normal.historyV2.find(event => event.kind === 'run_started')).not.toHaveProperty('runMode');
  });

  it('creates an exact fresh starting state for Try Again', () => {
    const definition = scenarioById('money-bags')!;
    const failed = newRun('scenario-failed', constant, { scenario: definition }).state;
    failed.phase = 'lost'; failed.gold = 0; failed.lives = 0; failed.handLevels.ones = 99;
    const retry = newRun('scenario-retry', constant, { scenario: definition }).state;
    expect({ round: retry.round, goal: retry.target, gold: retry.gold, temper: retry.temper, lives: retry.lives,
      roster: rosterDice(retry).map(die => die.effects.map(effect => [effect.type, effect.level])),
      hands: retry.handLevels, flames: flameInstances(retry).map(flame => [flame.type, flame.investedGold]) })
      .toEqual({ round: 1, goal: definition.startingGoal, gold: 15, temper: 0, lives: 3,
        roster: definition.roster.map(die => die.effects.map(effect => [effect.key, effect.level])),
        hands: handLevelsForScenario(definition), flames: [] });
  });
});

describe('Scared Straight controller precedence', () => {
  it('lets Clockwork advance Tank dice before Tank starts intercepting', () => {
    const state = newRun('scenario-controller-order', constant, { scenario: scenarioById('scared-straight')! }).state;
    const die = rosterDice(state)[0];
    const start = die.faces[die.value - 1].rank;
    const resolver = new Resolver(state, constant);
    resolver.rollBatch([die.id], 'Clockwork precedence 1', 'gameplay', true, 'manual');
    resolver.rollBatch([die.id], 'Clockwork precedence 2', 'gameplay', true, 'manual');
    resolver.rollBatch([die.id], 'Clockwork precedence 3', 'gameplay', true, 'manual');
    const afterClockwork = die.faces[die.value - 1].rank;
    resolver.rollBatch([die.id], 'Tank precedence', 'gameplay', true, 'manual');
    expect(afterClockwork).toBe(((start + 2) % 6 + 1));
    expect(die.faces[die.value - 1].rank).toBe(afterClockwork);
    const activations = state.historyV2.filter(event => event.kind === 'special_die_activated');
    expect(activations.slice(-4).map(event => event.kind === 'special_die_activated' ? event.dieType : null))
      .toEqual(['clockwork', 'clockwork', 'clockwork', 'tank']);
  });
});
