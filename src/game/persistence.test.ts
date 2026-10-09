import { describe, expect, it } from 'vitest';
import { dispatch, newRun } from './engine';
import { projectWildfire, rankedRecipients } from './hoodedFigure';
import { compactGameStateForPersistence, isResumableRun, loadPersistedRun, RUN_STORAGE_KEY, RUN_STORAGE_VERSION, savePersistedRun } from './persistence';

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
    const loaded = loadPersistedRun(storage, null);
    expect(loaded).toEqual(compactGameStateForPersistence(state));
    expect(loaded?.historyV2).toEqual(state.historyV2);
    expect(loaded?.historyV2.some(event => event.kind === 'run_started')).toBe(true);
    expect(loadPersistedRun(storage, 'saved-run')).toEqual(compactGameStateForPersistence(state));
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
    expect(loadPersistedRun(storage, encounter.seed)).toEqual(compactGameStateForPersistence(encounter));
  });

  it('round-trips active Hooded Figure, contribution, and resolved Wildfire state', () => {
    const storage = new MemoryStorage();
    const state = newRun('saved-wildfire').state;
    state.bonfires = ['ultimate', 'minigun'];
    state.bonfireContributions.ultimate = { roundCount: 2, factorSum: 7 };
    state.wildfires = [{ flame: 'momentum', sacrificedFlame: 'vineyard', sacrificedAverage: 5,
      transferMultiplier: 6, resolved: { kind: 'charge', gain: 3, maxCharge: 30 } }];
    state.hoodedFigure.seen = true;
    state.hoodedFigure.previousChallengeId = 'beanSalad';
    state.hoodedFigure.active = {
      id: 'theLongWay', issuedChapter: 5, target: 3,
      committed: { value: 1, keys: [], invalid: false, jackpotPaid: false },
      attempt: { value: 2, keys: [], invalid: false, jackpotPaid: false }, complete: false, dialogueLine: 'persisted',
    };
    expect(savePersistedRun(storage, state)).toBe(true);
    const loaded = loadPersistedRun(storage, state.seed);
    expect(loaded?.hoodedFigure).toEqual(state.hoodedFigure);
    expect(loaded?.bonfireContributions).toEqual(state.bonfireContributions);
    expect(loaded?.wildfires).toEqual(state.wildfires);
    expect(loaded?.maxCharge).toBe(30);
  });

  it('loads a pre-feature save with ordinary Bonfires at neutral finite contribution', () => {
    const storage = new MemoryStorage();
    const state = newRun('pre-hooded-feature').state;
    state.bonfires = ['ultimate', 'minigun', 'hailMary', 'fullOfGrace', 'vineyard'];
    for (const key of ['wildfires', 'bonfireContributions', 'bonfireRoundContributions', 'chargeAttribution', 'hoodedFigure'] as const)
      delete (state as unknown as Record<string, unknown>)[key];
    if (!state.roundCheckpoint) throw new Error('Expected initial round checkpoint');
    for (const key of ['wildfires', 'bonfireContributions', 'bonfireRoundContributions', 'chargeAttribution', 'hoodedFigure'] as const)
      delete (state.roundCheckpoint.board as unknown as Record<string, unknown>)[key];
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: RUN_STORAGE_VERSION, state }));

    const loaded = loadPersistedRun(storage, null)!;
    expect(loaded.hoodedFigure).toEqual({ seen: false, previousChallengeId: null, active: null,
      interaction: null, contributionCheckpoint: null });
    expect(loaded.wildfires).toEqual([]);
    expect(rankedRecipients(loaded)).toEqual(['fullOfGrace', 'hailMary', 'minigun']);
    const projection = projectWildfire(loaded, 'fullOfGrace', 'ultimate');
    expect(projection.sacrificedAverage).toBe(1);
    expect(projection.transferMultiplier).toBe(1);
    expect(Number.isFinite((projection.resolved as { max: number }).max)).toBe(true);
  });

  it('round-trips recipient and sacrifice selection with an unchanged projection', () => {
    const storage = new MemoryStorage();
    const state = newRun('saved-selection').state;
    state.phase = 'hoodedFigure';
    state.bonfires = ['ultimate', 'minigun', 'hailMary', 'fullOfGrace', 'vineyard'];
    state.bonfireContributions.vineyard = { roundCount: 2, factorSum: 10 };
    state.hoodedFigure.interaction = { kind: 'return', stage: 'sacrifice', lines: [], lineIndex: 0,
      recipient: 'ultimate', sacrifice: null };
    expect(savePersistedRun(storage, state)).toBe(true);
    const recipientLoaded = loadPersistedRun(storage, state.seed)!;
    expect(recipientLoaded.hoodedFigure.interaction).toEqual(state.hoodedFigure.interaction);

    recipientLoaded.hoodedFigure.interaction = { ...recipientLoaded.hoodedFigure.interaction!,
      stage: 'confirm', sacrifice: 'vineyard' };
    const before = projectWildfire(recipientLoaded, 'ultimate', 'vineyard');
    expect(savePersistedRun(storage, recipientLoaded)).toBe(true);
    const sacrificeLoaded = loadPersistedRun(storage, state.seed)!;
    expect(sacrificeLoaded.hoodedFigure.interaction).toEqual(recipientLoaded.hoodedFigure.interaction);
    expect(projectWildfire(sacrificeLoaded, 'ultimate', 'vineyard')).toEqual(before);
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
    delete (state.stats.probabilityProcs as Partial<typeof state.stats.probabilityProcs>).doubleTime;
    state.dice[0].flame = { id: 'personalTrainer', investedGold: 75 } as unknown as typeof state.dice[0]['flame'];
    state.bonfires = ['personalTrainer' as unknown as typeof state.bonfires[number]];
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: RUN_STORAGE_VERSION, state }));

    const loaded = loadPersistedRun(storage, null);
    expect(loaded?.dice[0].flame).toBeNull();
    expect(loaded?.bonfires).toEqual([]);
    expect(loaded?.stats.probabilityProcs.personalTrainer).toEqual({ checks: 0, successes: 0, failures: 0, stacksAtCheck: [] });
    expect(loaded?.stats.probabilityProcs.doubleTime).toEqual({ checks: 0, successes: 0, failures: 0, stacksAtCheck: [] });
  });

  it('migrates the retired Charge Flame to Momentum and derives capacity in the run and checkpoint', () => {
    const storage = new MemoryStorage();
    const state = newRun('legacy-charge-flame').state;
    state.dice[0].flame = { id: 'charge', investedGold: 50 } as unknown as typeof state.dice[0]['flame'];
    if (!state.roundCheckpoint) throw new Error('Expected initial round checkpoint');
    state.roundCheckpoint.board.dice[0].flame = { id: 'charge', investedGold: 50 } as unknown as typeof state.dice[0]['flame'];
    delete (state as Partial<typeof state>).maxCharge;
    delete (state.roundCheckpoint.board as Partial<typeof state.roundCheckpoint.board>).maxCharge;
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: RUN_STORAGE_VERSION, state }));

    const loaded = loadPersistedRun(storage, null);
    expect(loaded?.dice[0].flame).toEqual({ id: 'momentum', investedGold: 50 });
    expect(loaded?.maxCharge).toBe(3);
    expect(loaded?.roundCheckpoint?.board.dice[0].flame).toEqual({ id: 'momentum', investedGold: 50 });
    expect(loaded?.roundCheckpoint?.board.maxCharge).toBe(3);
  });

  it('infers Six Pack progress for saves made before the Upper-hand counter', () => {
    const storage = new MemoryStorage();
    const state = newRun('legacy-six-pack').state;
    state.dice[0].flame = { id: 'sixPack', investedGold: 100 };
    state.sixPackXMult = 4.333333333333;
    delete (state as Partial<typeof state>).sixPackUpperHandsPlayed;
    if (!state.roundCheckpoint) throw new Error('Expected initial round checkpoint');
    state.roundCheckpoint.board.dice[0].flame = { id: 'sixPack', investedGold: 100 };
    state.roundCheckpoint.board.sixPackXMult = 5.166666666667;
    delete (state.roundCheckpoint.board as Partial<typeof state.roundCheckpoint.board>).sixPackUpperHandsPlayed;
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: RUN_STORAGE_VERSION, state }));

    const loaded = loadPersistedRun(storage, null);
    expect(loaded?.sixPackUpperHandsPlayed).toBe(2);
    expect(loaded?.sixPackXMult).toBeCloseTo(4.333333333333);
    expect(loaded?.roundCheckpoint?.board.sixPackUpperHandsPlayed).toBe(1);
    expect(loaded?.roundCheckpoint?.board.sixPackXMult).toBeCloseTo(5.166666666667);
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

  it('loads additive pre-V2 saves with an empty parallel history stream', () => {
    const storage = new MemoryStorage();
    const state = newRun('pre-v2-history').state;
    delete (state as Partial<typeof state>).historyV2;
    delete (state as Partial<typeof state>).historyV2TimelineId;
    delete (state as Partial<typeof state>).historyV2Coverage;
    delete (state as Partial<typeof state>).debugTrace;
    if (!state.roundCheckpoint) throw new Error('Expected initial round checkpoint');
    const legacyCheckpoint = structuredClone(state) as unknown as Record<string, unknown>;
    delete legacyCheckpoint.roundCheckpoint;
    delete legacyCheckpoint.badDreamCheckpoint;
    state.roundCheckpoint = legacyCheckpoint as unknown as typeof state.roundCheckpoint;
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: 2, state }));

    const loaded = loadPersistedRun(storage, null);
    expect(loaded?.historyV2).toEqual([]);
    expect(loaded?.historyV2TimelineId).toBe(0);
    expect(loaded?.historyV2Coverage).toMatchObject({ complete: false, firstRound: 1, firstActionId: 0 });
    expect(loaded?.debugTrace.mode).toBe('bounded');
    expect(loaded?.roundCheckpoint?.board).toBeDefined();
  });
});
