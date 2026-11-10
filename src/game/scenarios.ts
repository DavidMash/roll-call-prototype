import { createCollectibleDie } from './dice';
import { createFlameInstance, emptyFlameSlots, FLAMES, recalculateMaxCharge } from './flames';
import { HAND_IDS, LOWER_HAND_IDS, UPPER_HAND_IDS, initialHandLevels } from './hands';
import { rosterTuple, storageTuple, STORAGE_SLOT_COUNT } from './inventory';
import { applyStructuralInfernoReward, infernoRewardEligible, INFERNO_REWARD_OFFERS } from './infernoRewards';
import { createDieEffect, SPECIAL_DICE } from './specialDice';
import type { DiceInventory, Flame, GameState, HandId, HandLevels, InfernoRewardOfferId, SpecialDieType } from './types';

export type ScenarioId = 'scared-straight' | 'short-circuit' | 'popcorn' | 'money-bags'
  | 'extra-die' | 'house-rules';

export interface ScenarioDieEffectDefinition { key: SpecialDieType; level: number }
export interface ScenarioDieDefinition {
  rosterSlot: number;
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
  /** Chapter 1 base for the shared authoritative Round-target calculation. */
  startingTarget: bigint;
  startingGold: number;
  startingTemper: number;
  startingLives: number;
  roster: readonly ScenarioDieDefinition[];
  flames: readonly ScenarioFlameDefinition[];
  /** Structural Inferno Rewards owned before Round 1, applied through the canonical reward state model. */
  startingInfernoRewards?: readonly InfernoRewardOfferId[];
  /** Requested design assets that are not present in the current canonical registry. Never applied to gameplay. */
  unavailableStartingFlames?: readonly { name: string; investedGold: number; reason: string }[];
  handTraining: ScenarioHandTrainingDefinition;
  featuredHands?: readonly HandId[];
  /** Reserved for future data-driven puzzle configuration, such as fixed opening faces. */
  configuration?: Readonly<Record<string, unknown>>;
}

const repeatedDice = (count: number, effects: readonly ScenarioDieEffectDefinition[]): ScenarioDieDefinition[] =>
  Array.from({ length: count }, (_, rosterSlot) => ({ rosterSlot, effects }));

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'scared-straight', version: 2, name: 'Scared Straight',
    tagline: 'Build a straight-focused engine and prove it can survive all the way to Engulfment.',
    startingTarget: 6_000n, startingGold: 10, startingTemper: 0, startingLives: 3,
    roster: repeatedDice(5, [{ key: 'tank', level: 3 }, { key: 'clockwork', level: 1 }]),
    flames: [{ key: 'straightShooter', investedGold: 40 }, { key: 'oneShort', investedGold: 40 },
      { key: 'hailMary', investedGold: 40 }],
    handTraining: { all: 4, overrides: { largeStraight: 10, smallStraight: 8 } },
    featuredHands: ['smallStraight', 'largeStraight'],
  },
  {
    id: 'short-circuit', version: 1, name: 'Short Circuit',
    tagline: 'Turn precision and Charge into an engine powerful enough to Engulf.',
    startingTarget: 6_000n, startingGold: 10, startingTemper: 0, startingLives: 3,
    roster: repeatedDice(5, [{ key: 'magnetic', level: 1 }]),
    flames: [{ key: 'fluxCapacitor', investedGold: 40 }, { key: 'dareDevil', investedGold: 40 }],
    handTraining: { all: 4, overrides: { fiveKind: 9 } },
    featuredHands: ['fiveKind'],
  },
  {
    id: 'popcorn', version: 1, name: 'Popcorn',
    tagline: 'Ride a chaotic chain of jumping dice and rerolls all the way to Engulfment.',
    startingTarget: 9_000n, startingGold: 5, startingTemper: 0, startingLives: 3,
    roster: repeatedDice(5, [{ key: 'jumpingBean', level: 5 }, { key: 'chameleon', level: 1 }, { key: 'weighted', level: 1 }]),
    flames: [{ key: 'minigun', investedGold: 40 }, { key: 'hailMary', investedGold: 40 }],
    handTraining: { upper: 6, lower: 4 },
    featuredHands: ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'],
  },
  {
    id: 'money-bags', version: 3, name: 'Money Bags',
    tagline: 'Make money, spend money, and turn an economy engine into real scoring power.',
    startingTarget: 4_000n, startingGold: 15, startingTemper: 0, startingLives: 3,
    roster: repeatedDice(5, [{ key: 'golden', level: 1 }, { key: 'jackpot', level: 1 }, { key: 'furnace', level: 3 }]),
    flames: [{ key: 'bribery', investedGold: 40 }, { key: 'fatCat', investedGold: 40 }],
    handTraining: { upper: 4, lower: 5 },
  },
  {
    id: 'extra-die', version: 3, name: 'Extra Die!',
    tagline: 'Start with six Basic dice and new six-die Hands. Build from scratch and prove the expanded roster can reach Engulfment.',
    startingTarget: 2_000n, startingGold: 0, startingTemper: 0, startingLives: 3,
    roster: repeatedDice(6, [{ key: 'basic', level: 1 }]),
    flames: [],
    startingInfernoRewards: ['expandedRoster', 'handThreePair', 'handWideStraight'],
    handTraining: { upper: 4, lower: 5 },
    featuredHands: ['threePair', 'wideStraight'],
  },
  {
    id: 'house-rules', version: 3, name: 'House Rules',
    tagline: 'Start with a normal Basic roster but an expanded scorecard. Use the extra scoring options to build toward Engulfment.',
    startingTarget: 2_000n, startingGold: 0, startingTemper: 0, startingLives: 3,
    roster: repeatedDice(5, [{ key: 'basic', level: 1 }]),
    flames: [],
    startingInfernoRewards: ['handOdds', 'handEvens', 'handChance', 'handMiniStraight', 'handOddStraight', 'handEvenStraight'],
    handTraining: { upper: 5, lower: 5 },
    featuredHands: ['odds', 'evens', 'chance', 'miniStraight', 'oddStraight', 'evenStraight'],
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
  const roster = Array.from({ length: scenarioRosterCapacity(definition) }, () => null) as Array<number | null>;
  for (const item of definition.roster) {
    const die = createCollectibleDie(item.rosterSlot);
    die.effects = item.effects.map(effect => createDieEffect(die.id, effect.key, effect.level));
    instances[die.id] = die;
    roster[item.rosterSlot] = die.id;
  }
  return { instances, roster: rosterTuple(roster), storage: storageTuple(Array.from({ length: STORAGE_SLOT_COUNT }, () => null)),
    nextDieId: Math.max(...Object.keys(instances).map(Number), -1) + 1 };
}

export function scenarioRosterCapacity(definition: ScenarioDefinition): number {
  if (definition.startingInfernoRewards?.includes('expandedRoster2')) return 7;
  if (definition.startingInfernoRewards?.includes('expandedRoster')) return 6;
  return 5;
}

export function applyScenarioStart(state: GameState, definition: ScenarioDefinition): void {
  state.runMode = 'scenario';
  state.scenario = { id: definition.id, version: definition.version, name: definition.name,
    startingTarget: definition.startingTarget,
    completionPending: false, completionAcknowledged: false };
  state.gold = definition.startingGold;
  state.temper = definition.startingTemper;
  state.forgeUnlocked = definition.startingTemper > 0;
  state.lives = definition.startingLives;
  state.roundStartLives = definition.startingLives;
  state.diceInventory = inventoryForScenario(definition);
  state.dieRoundState = {};
  state.dice = [];
  state.handLevels = handLevelsForScenario(definition);
  for (const offerId of definition.startingInfernoRewards ?? []) {
    if (!infernoRewardEligible(state, offerId)) throw new Error(`${definition.name} cannot claim starting reward ${offerId}.`);
    if (!applyStructuralInfernoReward(state, offerId))
      throw new Error(`${definition.name} starting reward ${offerId} is not a structural Scenario reward.`);
    state.infernoRewards.claimedOfferIds.push(offerId);
  }
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
  if (definition.startingTarget <= 0n) errors.push('Starting Target must be positive.');
  const rosterCapacity = scenarioRosterCapacity(definition);
  if (definition.roster.length < 1 || definition.roster.length > rosterCapacity)
    errors.push(`Roster must contain 1-${rosterCapacity} dice.`);
  if (new Set(definition.roster.map(die => die.rosterSlot)).size !== definition.roster.length) errors.push('Roster slots must be unique.');
  if (definition.roster.some(die => !Number.isSafeInteger(die.rosterSlot) || die.rosterSlot < 0 || die.rosterSlot >= rosterCapacity))
    errors.push('Roster slots must fit the starting Roster capacity.');
  const startingRewards = definition.startingInfernoRewards ?? [];
  if (new Set(startingRewards).size !== startingRewards.length) errors.push('Starting Inferno Rewards must be unique.');
  for (const id of startingRewards) {
    const reward = INFERNO_REWARD_OFFERS[id];
    if (!reward) errors.push(`Unknown Inferno Reward ${String(id)}.`);
    else if (reward.category !== 'hand' && id !== 'expandedRoster' && id !== 'expandedRoster2')
      errors.push(`${id} is not a structural Scenario reward.`);
  }
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
