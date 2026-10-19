import type { CollectibleDie, DiceInventory, Die, DieId, EncounterDie, GameState, RosterSlots } from './types';

export const ROSTER_SLOT_COUNT = 5;
export const INITIAL_STORAGE_SLOT_COUNT = 3;

type DiceCollectionState = Pick<GameState, 'diceInventory' | 'encounterDice' | 'dice'>;

export function ownedDice(state: Pick<GameState, 'diceInventory'>): CollectibleDie[] {
  const locations = [...state.diceInventory.roster, ...state.diceInventory.storage];
  return locations.filter((id): id is DieId => id !== null).map(id => {
    const die = state.diceInventory.instances[id];
    if (!die) throw new Error(`Dice inventory slot references unknown die ${id}.`);
    return die;
  });
}

export function rosterDice(state: Pick<GameState, 'diceInventory'>): CollectibleDie[] {
  return state.diceInventory.roster.filter((id): id is DieId => id !== null).map(id => {
    const die = state.diceInventory.instances[id];
    if (!die) throw new Error(`Roster slot references unknown die ${id}.`);
    return die;
  });
}

export function storageDice(state: Pick<GameState, 'diceInventory'>): CollectibleDie[] {
  return state.diceInventory.storage.filter((id): id is DieId => id !== null).map(id => {
    const die = state.diceInventory.instances[id];
    if (!die) throw new Error(`Storage slot references unknown die ${id}.`);
    return die;
  });
}

export function collectibleDieById(state: Pick<GameState, 'diceInventory'>, id: DieId): CollectibleDie | undefined {
  return state.diceInventory.instances[id];
}

export function dieById(state: Pick<GameState, 'diceInventory' | 'encounterDice'>, id: DieId): Die | undefined {
  return state.diceInventory.instances[id] ?? state.encounterDice.find(die => die.id === id);
}

export function rosterSlotOf(state: Pick<GameState, 'diceInventory'>, id: DieId): number | null {
  const slot = state.diceInventory.roster.indexOf(id);
  return slot < 0 ? null : slot;
}

export function encounterDice(state: Pick<GameState, 'diceInventory' | 'encounterDice'>): Die[] {
  return [...rosterDice(state), ...state.encounterDice];
}

/** Rebuilds the legacy Board projection from authoritative collection state. */
export function syncActiveDiceProjection(state: DiceCollectionState): void {
  state.dice = encounterDice(state);
}

export function orderDieIdsByEncounter<T extends DieId>(state: Pick<GameState, 'diceInventory' | 'encounterDice'>,
  ids: readonly T[]): T[] {
  const order = new Map(encounterDice(state).map((die, index) => [die.id, index]));
  return [...ids].sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
}

export function assertDiceInventory(inventory: DiceInventory, encounter: readonly EncounterDie[] = []): void {
  if (!Array.isArray(inventory.roster) || inventory.roster.length !== ROSTER_SLOT_COUNT)
    throw new Error(`Dice inventory must have exactly ${ROSTER_SLOT_COUNT} Roster slots.`);
  if (!Array.isArray(inventory.storage)) throw new Error('Dice inventory Storage must be an array.');
  const instanceIds = Object.keys(inventory.instances).map(Number);
  const locations = [...inventory.roster, ...inventory.storage].filter((id): id is number => id !== null);
  const equippedCount = inventory.roster.filter(id => id !== null).length;
  if (equippedCount < 1) throw new Error('At least one collectible die must be equipped in the Roster.');
  const seen = new Set<number>();
  for (const id of locations) {
    if (!Number.isSafeInteger(id) || id < 0) throw new Error(`Invalid collectible die ID ${id}.`);
    if (seen.has(id)) throw new Error(`Collectible die ${id} occupies more than one slot.`);
    if (!inventory.instances[id]) throw new Error(`Dice inventory slot references unknown die ${id}.`);
    seen.add(id);
  }
  for (const id of instanceIds) {
    const die = inventory.instances[id];
    if (die.id !== id) throw new Error(`Collectible die record ${id} contains mismatched ID ${die.id}.`);
    if (!seen.has(id)) throw new Error(`Owned collectible die ${id} does not occupy a Roster or Storage slot.`);
    if (die.owner !== 'player' || die.type !== 'normal' || die.level !== 1)
      throw new Error(`Collectible die ${id} has invalid Stage 2 identity data.`);
  }
  const maximumId = instanceIds.length ? Math.max(...instanceIds) : -1;
  if (!Number.isSafeInteger(inventory.nextDieId) || inventory.nextDieId <= maximumId)
    throw new Error('nextDieId must be greater than every owned collectible die ID.');
  if (new Set(inventory.storageAwardedChapters).size !== inventory.storageAwardedChapters.length
    || inventory.storageAwardedChapters.some(chapter => !Number.isSafeInteger(chapter) || chapter < 1))
    throw new Error('Storage Chapter awards must contain unique positive Chapter numbers.');
  const encounterIds = new Set<number>();
  for (const die of encounter) {
    if (die.owner !== 'boss' || !die.encounterId) throw new Error('Encounter dice must have tagged boss identity.');
    if (die.id >= 0 || seen.has(die.id) || encounterIds.has(die.id))
      throw new Error(`Encounter die ID ${die.id} collides with another die.`);
    encounterIds.add(die.id);
  }
}

export function grantChapterStorageSlot(inventory: DiceInventory, chapter: number): boolean {
  if (inventory.storageAwardedChapters.includes(chapter)) return false;
  inventory.storageAwardedChapters.push(chapter);
  inventory.storage.push(null);
  return true;
}

export function rosterTuple(ids: Array<DieId | null>): RosterSlots {
  if (ids.length !== ROSTER_SLOT_COUNT) throw new Error(`Expected ${ROSTER_SLOT_COUNT} Roster slots.`);
  return ids as RosterSlots;
}
