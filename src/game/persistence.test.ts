import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { isResumableRun, loadPersistedRun, RUN_STORAGE_KEY, RUN_STORAGE_VERSION, savePersistedRun } from './persistence';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('run persistence', () => {
  it('only treats valid non-terminal game phases as resumable', () => {
    const active = newRun('resumable').state;
    expect(isResumableRun(active)).toBe(true);
    expect(isResumableRun({ ...active, phase: 'shop' })).toBe(true);
    expect(isResumableRun({ ...active, phase: 'lost' })).toBe(false);
    expect(isResumableRun({ ...active, phase: 'error' })).toBe(false);
    expect(isResumableRun(null)).toBe(false);
  });

  it('round-trips the complete settled game state', () => {
    const storage = new MemoryStorage();
    const started = newRun('saved-run').state;
    const matchingDice = started.dice.filter(die => die.value === 1);
    const action = matchingDice.length > 0
      ? { type: 'PLAY' as const, hand: 'ones' as const, dieIds: matchingDice.map(die => die.id) }
      : { type: 'MANUAL_REROLL' as const, dieIds: [0] };
    const state = dispatch(started, action).state;

    expect(savePersistedRun(storage, state)).toBe(true);
    expect(loadPersistedRun(storage, null)).toEqual(state);
    expect(loadPersistedRun(storage, 'saved-run')).toEqual(state);
    expect(loadPersistedRun(storage, 'another-run')).toBeNull();
  });

  it('round-trips an active Mini-Boss encounter and its retry checkpoint', () => {
    const storage = new MemoryStorage();
    const rng = { next: () => .2 };
    const state = newRun('saved-mini-boss', rng).state;
    state.phase = 'shop';
    state.round = 2;
    state.currentNodeId = 'shop:before-round:3';
    state.shop = { offers: [], trainingOffers: [], diceRerolls: 0, offerRerolls: 0, lifeRestores: 0 };
    state.bossSchedule[3] = 'magician';
    const encounter = dispatch(state, { type: 'NEXT_ROUND' }, rng).state;

    expect(savePersistedRun(storage, encounter)).toBe(true);
    expect(loadPersistedRun(storage, encounter.seed)).toEqual(encounter);
  });

  it('rejects malformed, unsupported, and incomplete saves', () => {
    const storage = new MemoryStorage();
    storage.setItem(RUN_STORAGE_KEY, '{not-json');
    expect(loadPersistedRun(storage, null)).toBeNull();

    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: RUN_STORAGE_VERSION + 1, state: newRun('old').state }));
    expect(loadPersistedRun(storage, null)).toBeNull();

    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: RUN_STORAGE_VERSION, state: { seed: 'partial', phase: 'round' } }));
    expect(loadPersistedRun(storage, null)).toBeNull();
  });

  it('loads an older run while removing retired Personal Trainer Flames', () => {
    const storage = new MemoryStorage();
    const state = newRun('retired-trainer-flame').state;
    delete (state.stats.probabilityProcs as Partial<typeof state.stats.probabilityProcs>).personalTrainer;
    state.dice[0].flame = { id: 'personalTrainer', investedGold: 75 } as unknown as typeof state.dice[0]['flame'];
    state.bonfires = ['personalTrainer' as unknown as typeof state.bonfires[number]];
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: RUN_STORAGE_VERSION, state }));

    const loaded = loadPersistedRun(storage, null);
    expect(loaded?.dice[0].flame).toBeNull();
    expect(loaded?.bonfires).toEqual([]);
    expect(loaded?.stats.probabilityProcs.personalTrainer).toEqual({ checks: 0, successes: 0, failures: 0, stacksAtCheck: [] });
  });

  it('migrates the retired Charge Flame to Momentum and derives capacity in the run and checkpoint', () => {
    const storage = new MemoryStorage();
    const state = newRun('legacy-charge-flame').state;
    state.dice[0].flame = { id: 'charge', investedGold: 50 } as unknown as typeof state.dice[0]['flame'];
    if (!state.roundCheckpoint) throw new Error('Expected initial round checkpoint');
    state.roundCheckpoint.dice[0].flame = { id: 'charge', investedGold: 50 } as unknown as typeof state.dice[0]['flame'];
    delete (state as Partial<typeof state>).maxCharge;
    delete (state.roundCheckpoint as Partial<typeof state.roundCheckpoint>).maxCharge;
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: RUN_STORAGE_VERSION, state }));

    const loaded = loadPersistedRun(storage, null);
    expect(loaded?.dice[0].flame).toEqual({ id: 'momentum', investedGold: 50 });
    expect(loaded?.maxCharge).toBe(3);
    expect(loaded?.roundCheckpoint?.dice[0].flame).toEqual({ id: 'momentum', investedGold: 50 });
    expect(loaded?.roundCheckpoint?.maxCharge).toBe(3);
  });

  it('infers Six Pack progress for saves made before the Upper-hand counter', () => {
    const storage = new MemoryStorage();
    const state = newRun('legacy-six-pack').state;
    state.dice[0].flame = { id: 'sixPack', investedGold: 100 };
    state.sixPackXMult = 4.333333333333;
    delete (state as Partial<typeof state>).sixPackUpperHandsPlayed;
    if (!state.roundCheckpoint) throw new Error('Expected initial round checkpoint');
    state.roundCheckpoint.dice[0].flame = { id: 'sixPack', investedGold: 100 };
    state.roundCheckpoint.sixPackXMult = 5.166666666667;
    delete (state.roundCheckpoint as Partial<typeof state.roundCheckpoint>).sixPackUpperHandsPlayed;
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: RUN_STORAGE_VERSION, state }));

    const loaded = loadPersistedRun(storage, null);
    expect(loaded?.sixPackUpperHandsPlayed).toBe(2);
    expect(loaded?.sixPackXMult).toBeCloseTo(4.333333333333);
    expect(loaded?.roundCheckpoint?.sixPackUpperHandsPlayed).toBe(1);
    expect(loaded?.roundCheckpoint?.sixPackXMult).toBeCloseTo(5.166666666667);
  });

  it('treats storage read and write failures as non-fatal', () => {
    const broken = {
      getItem(): string | null { throw new Error('blocked'); },
      setItem(): void { throw new Error('full'); },
    };
    const state = newRun('storage-failure').state;
    expect(loadPersistedRun(broken, null)).toBeNull();
    expect(savePersistedRun(broken, state)).toBe(false);
  });
});
