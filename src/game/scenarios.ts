import { createCollectibleDie } from './dice';
import { createFlameInstance, emptyFlameSlots, FLAMES, recalculateMaxCharge } from './flames';
import { HAND_IDS, LOWER_HAND_IDS, UPPER_HAND_IDS, initialHandLevels } from './hands';
import { rosterTuple, storageTuple, STORAGE_SLOT_COUNT } from './inventory';
import { createDieEffect, SPECIAL_DICE } from './specialDice';
import { targetForRound } from './goals';
import type { DiceInventory, Flame, GameState, HandId, HandLevels, SpecialDieType } from './types';

export type ScenarioId = 'loneliest-number' | 'scared-straight' | 'chicken-salesman'
  | 'short-circuit' | 'popcorn' | 'money-bags';

export interface ScenarioDieEffectDefinition { key: SpecialDieType; level: number }
export interface ScenarioDieDefinition {
  rosterSlot: 0 | 1 | 2 | 3 | 4;
  effects: readonly ScenarioDieEffectDefinition[];
}
export interface ScenarioFlameDefinition { key: Flame; investedGold: number }
export interface ScenarioHandTrainingDefinition {
  all?: number;
  upper?: number;
  lower?: number;
  overrides?: Partial<Record<HandId, number>>;
}
export interface ScenarioDefinition {
  id: ScenarioId;
  version: number;
  name: string;
  tagline: string;
  startingGoal: bigint;
  startingGold: number;
  startingTemper: number;
  startingLives: number;
  roster: readonly ScenarioDieDefinition[];
  flames: readonly ScenarioFlameDefinition[];
  /** Requested design assets that are not present in the current canonical registry. Never applied to gameplay. */
  unavailableStartingFlames?: readonly { name: string; investedGold: number; reason: string }[];
  handTraining: ScenarioHandTrainingDefinition;
  featuredHands?: readonly HandId[];
  /** Reserved for future data-driven puzzle configuration, such as fixed opening faces. */
  configuration?: Readonly<Record<string, unknown>>;
}

const repeatedDice = (count: number, effects: readonly ScenarioDieEffectDefinition[]): ScenarioDieDefinition[] =>
  Array.from({ length: count }, (_, rosterSlot) => ({ rosterSlot: rosterSlot as 0 | 1 | 2 | 3 | 4, effects }));

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'loneliest-number', version: 1, name: 'Loneliest Number', tagline: 'One die. Six numbers. Count it down.',
    startingGoal: 4_000n, startingGold: 10, startingTemper: 0, startingLives: 3,
    roster: repeatedDice(1, [{ key: 'loneWolf', level: 1 }, { key: 'clockwork', level: 1 }, { key: 'flywheel', level: 3 }]),
    flames: [{ key: 'minigun', investedGold: 40 }, { key: 'countDown', investedGold: 40 }],
    handTraining: { lower: 3, overrides: { ones: 12, twos: 9, threes: 8, fours: 7, fives: 6, sixes: 5 } },
    featuredHands: ['sixes', 'fives', 'fours', 'threes', 'twos', 'ones'],
  },
  {
    id: 'scared-straight', version: 1, name: 'Scared Straight', tagline: 'Line them up before the pressure gets to you.',
    startingGoal: 6_000n, startingGold: 10, startingTemper: 0, startingLives: 3,
    roster: repeatedDice(5, [{ key: 'tank', level: 3 }, { key: 'clockwork', level: 1 }]),
    flames: [{ key: 'straightShooter', investedGold: 40 }, { key: 'oneShort', investedGold: 40 }],
    handTraining: { all: 4, overrides: { largeStraight: 10, smallStraight: 8 } },
    featuredHands: ['smallStraight', 'largeStraight'],
  },
  {
    id: 'chicken-salesman', version: 1, name: 'Chicken Salesman', tagline: 'How long can you hold before you cash out?',
    startingGoal: 2_000n, startingGold: 0, startingTemper: 0, startingLives: 3,
    roster: repeatedDice(5, [{ key: 'vintage', level: 3 }]),
    flames: [{ key: 'vineyard', investedGold: 40 }],
    handTraining: { upper: 4, lower: 5 },
  },
  {
    id: 'short-circuit', version: 1, name: 'Short Circuit', tagline: 'Five magnets. One enormous payoff.',
    startingGoal: 6_000n, startingGold: 10, startingTemper: 0, startingLives: 3,
    roster: repeatedDice(5, [{ key: 'magnetic', level: 1 }]),
    flames: [{ key: 'fluxCapacitor', investedGold: 40 }, { key: 'dareDevil', investedGold: 40 }],
    handTraining: { all: 4, overrides: { fiveKind: 9 } },
    featuredHands: ['fiveKind'],
  },
  {
    id: 'popcorn', version: 1, name: 'Popcorn', tagline: 'Once they start popping, try to keep up.',
    startingGoal: 9_000n, startingGold: 5, startingTemper: 0, startingLives: 3,
    roster: repeatedDice(5, [{ key: 'jumpingBean', level: 5 }, { key: 'chameleon', level: 1 }, { key: 'weighted', level: 1 }]),
    flames: [{ key: 'minigun', investedGold: 40 }, { key: 'hailMary', investedGold: 40 }],
    handTraining: { upper: 6, lower: 4 },
    featuredHands: ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'],
  },
  {
    id: 'money-bags', version: 2, name: 'Money Bags', tagline: 'It takes money to make money.',
    startingGoal: 4_000n, startingGold: 15, startingTemper: 0, startingLives: 3,
    roster: repeatedDice(5, [{ key: 'golden', level: 1 }, { key: 'jackpot', level: 1 }, { key: 'furnace', level: 3 }]),
    flames: [{ key: 'bribery', investedGold: 40 }],
    handTraining: { upper: 4, lower: 5 },
  },
] as const;

export const scenarioById = (id: string | null | undefined): ScenarioDefinition | null =>
  SCENARIOS.find(scenario => scenario.id === id) ?? null;

export function handLevelsForScenario(definition: ScenarioDefinition): HandLevels {
  const levels = initialHandLevels();
  if (definition.handTraining.all !== undefined) for (const hand of HAND_IDS) levels[hand] = definition.handTraining.all;
  if (definition.handTraining.upper !== undefined) for (const hand of UPPER_HAND_IDS) levels[hand] = definition.handTraining.upper;
  if (definition.handTraining.lower !== undefined) for (const hand of LOWER_HAND_IDS) levels[hand] = definition.handTraining.lower;
  for (const [hand, level] of Object.entries(definition.handTraining.overrides ?? {}) as [HandId, number][]) levels[hand] = level;
  return levels;
}

export function inventoryForScenario(definition: ScenarioDefinition): DiceInventory {
  const instances: DiceInventory['instances'] = {};
  const roster = Array.from({ length: 5 }, () => null) as Array<number | null>;
  for (const item of definition.roster) {
    const die = createCollectibleDie(item.rosterSlot);
    die.effects = item.effects.map(effect => createDieEffect(die.id, effect.key, effect.level));
    instances[die.id] = die;
    roster[item.rosterSlot] = die.id;
  }
  return { instances, roster: rosterTuple(roster), storage: storageTuple(Array.from({ length: STORAGE_SLOT_COUNT }, () => null)),
    nextDieId: Math.max(...Object.keys(instances).map(Number), -1) + 1 };
}

export function canonicalRoundForScenarioGoal(goal: bigint, limit = 300): number | null {
  for (let round = 1; round <= limit; round++) if (targetForRound(round) === goal) return round;
  return null;
}

export function applyScenarioStart(state: GameState, definition: ScenarioDefinition): void {
  const canonicalRound = canonicalRoundForScenarioGoal(definition.startingGoal);
  if (canonicalRound === null) throw new Error(`${definition.name} starting Goal is not on the canonical Goal progression.`);
  state.runMode = 'scenario';
  state.scenario = { id: definition.id, version: definition.version, name: definition.name,
    completionPending: false, completionAcknowledged: false };
  state.goalProgressionOffset = canonicalRound - 1;
  state.gold = definition.startingGold;
  state.temper = definition.startingTemper;
  state.forgeUnlocked = definition.startingTemper > 0;
  state.lives = definition.startingLives;
  state.roundStartLives = definition.startingLives;
  state.diceInventory = inventoryForScenario(definition);
  state.dieRoundState = {};
  state.dice = [];
  state.handLevels = handLevelsForScenario(definition);
  state.flameSlots = emptyFlameSlots();
  definition.flames.forEach((item, slot) => {
    const instance = createFlameInstance(state, item.key);
    instance.investedGold = item.investedGold;
    instance.stage = item.investedGold >= 100 ? 'bonfire' : 'ember';
    state.flameSlots[slot] = instance;
  });
  recalculateMaxCharge(state);
  state.roundStartRosterSize = definition.roster.length;
  state.stats.roundReached = 1;
}

export function validateScenarioDefinition(definition: ScenarioDefinition): string[] {
  const errors: string[] = [];
  if (!definition.id || !Number.isSafeInteger(definition.version) || definition.version < 1) errors.push('Scenario identity is invalid.');
  if (canonicalRoundForScenarioGoal(definition.startingGoal) === null) errors.push('Starting Goal is not canonical.');
  if (definition.roster.length < 1 || definition.roster.length > 5) errors.push('Roster must contain 1–5 dice.');
  if (new Set(definition.roster.map(die => die.rosterSlot)).size !== definition.roster.length) errors.push('Roster slots must be unique.');
  for (const die of definition.roster) for (const effect of die.effects) {
    if (!Object.hasOwn(SPECIAL_DICE, effect.key)) errors.push(`Unknown die effect ${String(effect.key)}.`);
    if (!Number.isSafeInteger(effect.level) || effect.level < 1) errors.push(`Invalid ${effect.key} level.`);
  }
  if (definition.flames.length > 5) errors.push('A Scenario cannot start with more than five Flames.');
  for (const flame of definition.flames) {
    if (!Object.hasOwn(FLAMES, flame.key)) errors.push(`Unknown Flame ${String(flame.key)}.`);
    if (!Number.isSafeInteger(flame.investedGold) || flame.investedGold < 0 || flame.investedGold > 100) errors.push(`Invalid ${flame.key} investment.`);
  }
  for (const level of Object.values(handLevelsForScenario(definition))) if (!Number.isSafeInteger(level) || level < 1) errors.push('Hand levels must be positive integers.');
  return errors;
}

export function validateScenarioDefinitions(definitions: readonly ScenarioDefinition[] = SCENARIOS): void {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`Duplicate Scenario ID ${definition.id}.`);
    ids.add(definition.id);
    const errors = validateScenarioDefinition(definition);
    if (errors.length) throw new Error(`${definition.name}: ${errors.join(' ')}`);
  }
}

validateScenarioDefinitions();
