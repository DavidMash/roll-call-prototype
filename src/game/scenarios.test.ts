import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { Resolver } from './effects';
import { createInfernoEvaluation, maximumPossibleEngulfmentReadiness } from './engulfment';
import { flameInstances, FLAMES, recalculateMaxCharge } from './flames';
import { availableHandIds, FINAL_LOWER_HAND_ORDER, FINAL_UPPER_HAND_ORDER, trainedHandStrength } from './hands';
import { rosterDice } from './inventory';
import { SCENARIOS, canonicalRoundForScenarioGoal, handLevelsForScenario, scenarioById,
  validateScenarioDefinition, validateScenarioDefinitions } from './scenarios';
import type { HandId, RandomSource } from './types';
import { SPECIAL_DICE } from './specialDice';
import { targetForRound } from './goals';

const constant: RandomSource = { next: () => .25 };

describe('Scenario definitions', () => {
  it('contains exactly the six intended stable IDs and excludes retired Scenarios', () => {
    expect(SCENARIOS.map(scenario => scenario.id)).toEqual([
      'scared-straight', 'short-circuit', 'popcorn', 'money-bags', 'extra-die', 'house-rules',
    ]);
    expect(SCENARIOS).toHaveLength(6);
    expect(new Set(SCENARIOS.map(scenario => scenario.id)).size).toBe(6);
    expect(scenarioById('loneliest-number')).toBeNull();
    expect(scenarioById('chicken-salesman')).toBeNull();
    expect(() => validateScenarioDefinitions()).not.toThrow();
    expect(SCENARIOS.flatMap(validateScenarioDefinition)).toEqual([]);
  });

  it('uses canonical keys for every retained and new setup', () => {
    expect(['basic', 'clockwork', 'bonus', 'tank', 'magnetic', 'jumpingBean', 'chameleon', 'weighted', 'golden', 'jackpot', 'furnace']
      .map(key => SPECIAL_DICE[key as keyof typeof SPECIAL_DICE].name))
      .toEqual(['Basic', 'Clockwork', 'Bonus', 'Tank', 'Magnetic', 'Jumping Bean', 'Chameleon', 'Weighted', 'Golden', 'Jackpot', 'Furnace']);
    expect(['straightShooter', 'oneShort', 'fluxCapacitor', 'dareDevil', 'minigun', 'hailMary', 'bribery', 'fatCat']
      .map(key => FLAMES[key as keyof typeof FLAMES].name))
      .toEqual(['Straight Shooter', 'One Short', 'Flux Capacitor', 'Dare Devil', 'Minigun', 'Hail Mary', 'Bribery', 'Fat Cat']);
  });

  it('preserves retained launch Goals, economy, and progression anchors', () => {
    expect(SCENARIOS.slice(0, 4).map(scenario => [scenario.startingGoal, scenario.goalProgressionRound, scenario.startingGold]))
      .toEqual([[6_000n, 17, 10], [6_000n, 17, 10], [9_000n, 19, 5], [4_000n, 15, 15]]);
    expect(SCENARIOS.slice(0, 4).every(scenario => !('targetOverrides' in scenario))).toBe(true);
    expect(canonicalRoundForScenarioGoal(4_000n)).toBe(16);
  });

  it('applies configured dice, levels, and real Flame investment', () => {
    for (const scenario of SCENARIOS) {
      const state = newRun(`scenario-definition-${scenario.id}`, constant, { scenario }).state;
      expect(state.runMode).toBe('scenario');
      expect(state.scenario).toMatchObject({ id: scenario.id, version: scenario.version, name: scenario.name });
      expect(rosterDice(state)).toHaveLength(scenario.roster.length);
      expect(rosterDice(state).map(die => die.effects.map(effect => [effect.type, effect.level])))
        .toEqual(scenario.roster.map(die => die.effects.map(effect => [effect.key, effect.level])));
      const configuredLevels = handLevelsForScenario(scenario);
      for (const [hand, level] of Object.entries(configuredLevels))
        if (!state.infernoRewards.unlockedHands.includes(hand as HandId))
          expect(state.handLevels[hand], `${scenario.name}: ${hand}`).toBe(level);
      expect(flameInstances(state).map(flame => [flame.type, flame.investedGold, flame.stage]))
        .toEqual(scenario.flames.map(flame => [flame.key, flame.investedGold, 'ember']));
      expect(state.gold).toBe(scenario.startingGold);
      expect(state.temper).toBe(scenario.startingTemper);
      expect(state.lives).toBe(scenario.startingLives);
      expect(state.round).toBe(1);
      expect(state.target).toBe(scenario.startingGoal);
    }
  });

  it('preserves each retained core roster and revised Flame setup', () => {
    const scared = scenarioById('scared-straight')!;
    expect(scared.roster.every(die => die.effects.map(effect => [effect.key, effect.level]).join() === 'tank,3,clockwork,1')).toBe(true);
    expect(scared.flames.map(flame => flame.key)).toEqual(['straightShooter', 'oneShort', 'hailMary']);
    const short = scenarioById('short-circuit')!;
    expect(short.roster.every(die => die.effects[0].key === 'magnetic' && die.effects[0].level === 1)).toBe(true);
    expect(short.flames.map(flame => flame.key)).toEqual(['fluxCapacitor', 'dareDevil']);
    const popcorn = scenarioById('popcorn')!;
    expect(popcorn.roster[0].effects.map(effect => [effect.key, effect.level]))
      .toEqual([['jumpingBean', 5], ['chameleon', 1], ['weighted', 1]]);
    expect(popcorn.flames.map(flame => flame.key)).toEqual(['minigun', 'hailMary']);
    const money = scenarioById('money-bags')!;
    expect(money.roster[0].effects.map(effect => [effect.key, effect.level]))
      .toEqual([['golden', 1], ['jackpot', 1], ['furnace', 3]]);
    expect(money.flames.map(flame => flame.key)).toEqual(['bribery', 'fatCat']);
  });

  it('initializes Extra Die through real claimed reward and Hand state', () => {
    const state = newRun('scenario-extra-die', constant, { scenario: scenarioById('extra-die')! }).state;
    expect(state.infernoRewards.upgrades.rosterCap).toBe(6);
    expect(state.diceInventory.roster).toHaveLength(6);
    expect(rosterDice(state)).toHaveLength(6);
    expect(rosterDice(state).every(die => die.effects.length === 1
      && die.effects[0].type === 'basic' && die.effects[0].level === 1)).toBe(true);
    expect(state.infernoRewards.claimedOfferIds).toEqual(['expandedRoster', 'handThreePair', 'handWideStraight']);
    expect(state.infernoRewards.unlockedHands).toEqual(['threePair', 'wideStraight']);
    expect([state.handLevels.threePair, state.handLevels.wideStraight]).toEqual([5, 5]);
    expect(availableHandIds(state).filter(hand => ['threePair', 'wideStraight'].includes(hand)))
      .toEqual(['threePair', 'wideStraight']);
    expect(flameInstances(state)).toEqual([]);
    expect(state.gold).toBe(0);
    expect(state.target).toBe(4_000n);
  });

  it('initializes House Rules through real Hand claims at section baselines without expanding its roster', () => {
    const state = newRun('scenario-house-rules', constant, { scenario: scenarioById('house-rules')! }).state;
    const unlocked = ['odds', 'evens', 'chance', 'miniStraight', 'oddStraight', 'evenStraight'];
    expect(state.infernoRewards.upgrades.rosterCap).toBe(5);
    expect(rosterDice(state)).toHaveLength(5);
    expect(rosterDice(state).every(die => die.effects.length === 1
      && die.effects[0].type === 'basic' && die.effects[0].level === 1)).toBe(true);
    expect(state.infernoRewards.unlockedHands).toEqual(unlocked);
    expect(state.infernoRewards.claimedOfferIds).toEqual([
      'handOdds', 'handEvens', 'handChance', 'handMiniStraight', 'handOddStraight', 'handEvenStraight',
    ]);
    expect(unlocked.map(hand => state.handLevels[hand])).toEqual([5, 5, 5, 5, 5, 5]);
    const hands = availableHandIds(state);
    expect(hands.filter(hand => FINAL_UPPER_HAND_ORDER.includes(hand))).toEqual(FINAL_UPPER_HAND_ORDER);
    expect(hands.filter(hand => FINAL_LOWER_HAND_ORDER.includes(hand))).toEqual([
      'pair', 'twoPair', 'miniStraight', 'threeKind', 'oddStraight', 'evenStraight',
      'smallStraight', 'fullHouse', 'fourKind', 'largeStraight', 'fiveKind',
    ]);
    expect(flameInstances(state)).toEqual([]);
    expect(state.gold).toBe(0);
    expect(state.target).toBe(4_000n);
  });

  it('preserves the retained Scenarios mature overlapping Flame routes of at least x15', () => {
    for (const scenario of SCENARIOS.slice(0, 4)) {
      const state = newRun(`scenario-feasibility-${scenario.id}`, constant, { scenario }).state;
      for (const flame of flameInstances(state)) { flame.investedGold = 100; flame.stage = 'bonfire'; }
      recalculateMaxCharge(state);
      expect(maximumPossibleEngulfmentReadiness(state), scenario.name).toBeGreaterThanOrEqual(15);
    }
  });

  it('leaves the two reward-mechanic Scenarios on normal Flame and dice acquisition paths', () => {
    for (const id of ['extra-die', 'house-rules'] as const) {
      const definition = scenarioById(id)!;
      const flameState = newRun(`scenario-feasibility-flame-${id}`, constant, { scenario: definition }).state;
      expect(flameInstances(flameState)).toEqual([]);
      const scorecardBenchmark = availableHandIds(flameState)
        .reduce((total, hand) => total + trainedHandStrength(hand, flameState.handLevels[hand]), 0);
      expect(scorecardBenchmark, `${definition.name} starting scorecard runway`).toBeGreaterThanOrEqual(5_000);
      const flameResolver = new Resolver(flameState, constant);
      flameResolver.openFlameSelection();
      expect(flameState.flameSelection?.offers).toHaveLength(3);
      const acquired = dispatch(flameState, { type: 'CHOOSE_FLAME', offerId: flameState.flameSelection!.offers[0].id }, constant).state;
      expect(flameInstances(acquired)).toHaveLength(1);

      const shopState = newRun(`scenario-feasibility-shop-${id}`, constant, { scenario: definition }).state;
      new Resolver(shopState, constant).openShop();
      expect(shopState.shop?.offers).toHaveLength(3);
      expect(shopState.shop?.trainingSession).toBeTruthy();
    }
  });
});

describe('Scenario progression and completion', () => {
  it('uses only the two early target overrides, then returns to normal Scenario progression', () => {
    for (const id of ['extra-die', 'house-rules'] as const) {
      const state = newRun(`scenario-targets-${id}`, constant, { scenario: scenarioById(id)! }).state;
      expect(state.target).toBe(4_000n);
      expect(state.scenario?.targetOverrides).toEqual({ 1: 4_000n, 2: 5_000n });
      state.round = 2;
      new Resolver(state, constant).startRound();
      expect(state.target).toBe(5_000n);
      state.round = 3;
      state.bossSchedule[3] = 'neglected';
      new Resolver(state, constant).startRound();
      expect(state.target).toBe(targetForRound(19, 'neglected', round => round === 19 ? 'neglected' : null));
    }
    const normal = newRun('normal-target-regression', constant).state;
    expect(normal.target).toBe(targetForRound(1));
    expect(normal.scenario).toBeNull();
  });

  it('advances from the configured Goal while keeping Scenario cadence fresh', () => {
    const scenario = scenarioById('scared-straight')!;
    const state = newRun('scenario-goal-track', constant, { scenario }).state;
    state.round = 2;
    new Resolver(state, constant).startRound();
    expect(state.target).toBe(6_000n);
    expect(state.boss).toBeNull();
    state.round = 3;
    new Resolver(state, constant).startRound();
    expect(state.boss).not.toBeNull();
    expect(state.bossSchedule[3]).toBeTruthy();
  });

  it('ends on the first Engulfment without generating an Inferno Reward', () => {
    const state = newRun('scenario-completion', constant, { scenario: scenarioById('short-circuit')! }).state;
    const evaluation = createInfernoEvaluation(state)!;
    evaluation.success = true;
    evaluation.flamesSnuffed = evaluation.flames.map(item => item.asset);
    evaluation.flamesPreserved = [];
    evaluation.selectedFlameInstanceIds = evaluation.flamesSnuffed.map(asset => asset.instanceId);
    evaluation.selectedEffectiveValue = 15;
    evaluation.earnedInfernoFactor = 15;
    evaluation.engulfmentCountAfter = 1;
    evaluation.infernoLevelAfter = 1;
    evaluation.infernoMultiplierAfter = 15n;
    state.infernoEvaluation = evaluation;
    state.phase = 'inferno';
    const resolver = new Resolver(state, constant);
    resolver.engulfNow();
    expect(state.scenario?.completionPending).toBe(true);
    resolver.continueInfernoEvaluation();
    expect(state.phase).toBe('scenarioComplete');
    expect(state.infernoRewards.pending).toBeNull();
    expect(state.infernoRewards.screenCount).toBe(0);
    expect(state.historyV2.some(event => event.kind === 'inferno_reward_offered')).toBe(false);
    const continued = dispatch(state, { type: 'CONTINUE_SCENARIO_RUN' }, constant).state;
    expect(continued.scenario).toMatchObject({ completionPending: false, completionAcknowledged: true });
    expect(continued.phase).toBe('scenarioComplete');
    expect(continued.infernoRewards.pending).toBeNull();
  });

  it('keeps the normal Engulfment to Inferno Reward flow unchanged', () => {
    const state = newRun('normal-inferno-reward', constant, { scenario: scenarioById('short-circuit')! }).state;
    state.runMode = 'normal';
    state.scenario = null;
    const evaluation = createInfernoEvaluation(state)!;
    evaluation.success = true;
    evaluation.flamesSnuffed = [];
    evaluation.flamesPreserved = [];
    evaluation.selectedFlameInstanceIds = [];
    evaluation.selectedEffectiveValue = 15;
    evaluation.earnedInfernoFactor = 15;
    evaluation.engulfmentCountAfter = 1;
    evaluation.infernoLevelAfter = 1;
    evaluation.infernoMultiplierAfter = 15n;
    state.infernoEvaluation = evaluation;
    state.phase = 'inferno';
    const resolver = new Resolver(state, constant);
    resolver.engulfNow();
    resolver.continueInfernoEvaluation();
    expect(state.phase).toBe('infernoReward');
    expect(state.infernoRewards.pending?.offers.length).toBeGreaterThan(0);
    expect(state.historyV2.some(event => event.kind === 'inferno_reward_offered')).toBe(true);
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
        hands: handLevelsForScenario(definition), flames: [['bribery', 40], ['fatCat', 40]] });
    expect(definition.version).toBe(3);
    expect(Object.values(retry.dieRoundState).flatMap(runtime => Object.values(runtime.effects))
      .filter(effect => effect.type === 'furnace')
      .every(effect => effect.furnaceGoldFed === 0 && effect.furnacePips === 0)).toBe(true);
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
