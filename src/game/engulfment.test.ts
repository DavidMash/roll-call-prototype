import { describe, expect, it } from 'vitest';
import { createCollectibleDie } from './dice';
import { dispatch, newRun, normalizeGameState } from './engine';
import { Resolver } from './effects';
import {
  ENGULFMENT_EVIDENCE_ROUNDS, ENGULFMENT_MIN_EVIDENCE_ROUNDS, createInfernoEvaluation,
  evaluateEngulfmentOffering, flameInterest, infernoDieEligible, infernoTier, infernoTierFactor,
  infernoTierRewardClaims, intrinsicDiePower,
  ownedEngulfmentAssets, perceivedFlamePower, rankInfernoDice, recentDieRelevance,
  selectRequestedFlameSubset,
} from './engulfment';
import { placeFlameInstance } from './flames';
import { createDieEffect } from './specialDice';
import type { GameState, RandomSource } from './types';
import type { RunHistoryV2Event } from './runHistoryV2';

const constant: RandomSource = { next: () => .5 };

function appendEvidenceRound(state: GameState, round: number,
  flames: readonly { instanceId: number; factor: number }[],
  scores: readonly { dieIds: number[]; awarded?: bigint; hand?: 'ones' | 'twos' }[] = [{ dieIds: [0] }]): void {
  const timelineId = state.historyV2TimelineId;
  scores.forEach((item, handIndex) => {
    const factor = flames.reduce((product, flame) => product * flame.factor, 1);
    const awarded = item.awarded ?? BigInt(Math.round(100 * factor));
    state.historyV2.push({
      kind: 'hand_scored', seq: state.nextHistorySeq++, round, attempt: 1, actionId: state.nextActionId++, timelineId,
      scorePackageId: `test:${round}:${handIndex}`, rootPlayId: `test:${round}:${handIndex}`, parentPlayId: null,
      hand: item.hand ?? 'ones', level: 1, playSource: 'manual', selectedDice: item.dieIds,
      scoringDice: [], scoreOccurrences: item.dieIds.map((dieId, index) => ({ id: `s:${round}:${handIndex}:${index}`,
        rootId: `s:${round}:${handIndex}:${index}`, dieId, cause: 'play_selection', originallySelected: true,
        playerSelected: true, additional: false, suppressedEffects: [] })), consumed: true,
      score: { infernoMultiplier: 1n, finalPips: 100, handMult: 1, finalMult: 1, finalXMult: factor,
        bossFactor: 1, raw: awarded.toString(), awarded, rounding: { mode: 'nearest_integer', delta: '0' } },
      roundScore: { before: 0n, afterAward: awarded, after: awarded }, pipsContributions: [], resolvedDicePips: [],
      multContributions: [], xMultContributions: flames.map(flame => ({ sourceId: 'ultimate', origin: 'bonfire',
        factor: flame.factor, sourceInstanceId: flame.instanceId })), sideEffects: [],
    } as unknown as RunHistoryV2Event);
  });
  state.historyV2.push({ kind: 'round_attempt_finished', seq: state.nextHistorySeq++, round, attempt: 1,
    actionId: state.nextActionId++, timelineId, outcome: 'cleared', score: 1_000n, target: 1n,
    boss: null, livesBefore: 3, livesAfter: 3 } as RunHistoryV2Event);
}

function readyState(factors: readonly number[] = [20, 20, 20]): GameState {
  const state = newRun('inferno-deal', constant).state;
  const flame = placeFlameInstance(state, 'ultimate', 100);
  factors.forEach((factor, index) => appendEvidenceRound(state, index + 1, [{ instanceId: flame.instanceId, factor }]));
  return state;
}

describe('deterministic Flame deal calculation', () => {
  it('uses a geometric mean and latest 3–6 canonical clears', () => {
    expect(perceivedFlamePower([4, 16])).toBeCloseTo(8, 12);
    expect(ENGULFMENT_MIN_EVIDENCE_ROUNDS).toBe(3);
    expect(ENGULFMENT_EVIDENCE_ROUNDS).toBe(6);
    for (const count of [3, 4, 5, 6]) {
      const state = readyState(Array.from({ length: count }, (_, index) => 2 ** (index + 1)));
      expect(evaluateEngulfmentOffering(state, ownedEngulfmentAssets(state)).evidenceRounds).toHaveLength(count);
    }
    const state = readyState([2, 4, 8, 16, 32, 64, 128]);
    const evaluation = evaluateEngulfmentOffering(state, ownedEngulfmentAssets(state));
    expect(evaluation.evidenceRounds.map(round => round.round)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(evaluation.offeringMultiplier).toBeCloseTo(perceivedFlamePower([4, 8, 16, 32, 64, 128]), 11);
  });

  it('has exact Interest/tier boundaries and no deal below ×15', () => {
    expect(flameInterest(15)).toBe(0);
    for (const boundary of [15, 30, 45, 60, 75]) {
      expect(infernoTier(boundary - Number.EPSILON * boundary)).toBe(Math.min(6, boundary / 15));
      expect(infernoTier(boundary)).toBe(Math.min(6, boundary / 15 + 1));
    }
    expect(infernoTier(10_000)).toBe(6);
    expect([1, 2, 3, 4, 5, 6].map(infernoTierFactor)).toEqual([15, 20, 25, 32, 40, 50]);
    expect([1, 2, 3, 4, 5, 6].map(infernoTierRewardClaims)).toEqual([1, 1, 1, 2, 2, 3]);
    expect(createInfernoEvaluation(readyState([14, 14, 14]))).toBeNull();
    expect(createInfernoEvaluation(readyState([15, 15]))).toBeNull();
  });

  it('exhaustively selects the fewest qualifying instances, then strongest and stable slot order', () => {
    const state = newRun('subset', constant).state;
    const a = placeFlameInstance(state, 'ultimate', 100, 0);
    const b = placeFlameInstance(state, 'minigun', 100, 1);
    const c = placeFlameInstance(state, 'vineyard', 100, 2);
    for (let round = 1; round <= 3; round++) appendEvidenceRound(state, round,
      [{ instanceId: a.instanceId, factor: 20 }, { instanceId: b.instanceId, factor: 20 },
        { instanceId: c.instanceId, factor: 1 }]);
    expect(selectRequestedFlameSubset(state, ownedEngulfmentAssets(state))?.assets.map(asset => asset.instanceId))
      .toEqual([a.instanceId, b.instanceId]);

    const tie = newRun('subset-tie', constant).state;
    const first = placeFlameInstance(tie, 'ultimate', 100, 0);
    const second = placeFlameInstance(tie, 'minigun', 100, 1);
    for (let round = 1; round <= 3; round++) appendEvidenceRound(tie, round,
      [{ instanceId: first.instanceId, factor: 20 }, { instanceId: second.instanceId, factor: 20 }]);
    expect(selectRequestedFlameSubset(tie, ownedEngulfmentAssets(tie))?.assets.map(asset => asset.instanceId))
      .toEqual([first.instanceId, second.instanceId]);
  });

  it('is synergy-sensitive when only the joint factual contribution qualifies', () => {
    const state = newRun('synergy', constant).state;
    const a = placeFlameInstance(state, 'ultimate', 100, 0);
    const b = placeFlameInstance(state, 'minigun', 100, 1);
    for (let round = 1; round <= 3; round++) appendEvidenceRound(state, round,
      [{ instanceId: a.instanceId, factor: 4 }, { instanceId: b.instanceId, factor: 4 }]);
    expect(evaluateEngulfmentOffering(state, [ownedEngulfmentAssets(state)[0]]).offeringMultiplier).toBe(4);
    expect(selectRequestedFlameSubset(state, ownedEngulfmentAssets(state))?.assets).toHaveLength(2);
  });
});

describe('die value and relevance', () => {
  it('values Basic levels, enhancement levels, and rarities exactly', () => {
    const die = createCollectibleDie(10, 'basic', 1);
    expect(intrinsicDiePower(die)).toBe(1);
    expect(infernoDieEligible(die)).toBe(false);
    die.effects[0].level = 2;
    expect(intrinsicDiePower(die)).toBe(2);
    die.effects[0].level = 3;
    expect(intrinsicDiePower(die)).toBe(3);
    die.effects = [createDieEffect(10, 'magnetic', 2)];
    expect(intrinsicDiePower(die)).toBe(4);
    die.effects = [createDieEffect(10, 'basic', 2), createDieEffect(10, 'golden', 1)];
    expect(intrinsicDiePower(die)).toBe(3);
  });

  it('counts scoring, key Hands, and Golden economic activity but not mere ownership', () => {
    const state = readyState([24, 24, 24]);
    const die = state.diceInventory.instances[0];
    const evidence = evaluateEngulfmentOffering(state, ownedEngulfmentAssets(state)).evidenceRounds;
    expect(recentDieRelevance(state, die, evidence)).toMatchObject({ activityRate: 1, keyHandRate: 1, recentRelevance: 1 });
    const inactive = state.diceInventory.instances[1];
    inactive.effects = [createDieEffect(inactive.id, 'doubleTime', 4)];
    expect(recentDieRelevance(state, inactive, evidence).recentRelevance).toBe(0);
    state.historyV2.push({ kind: 'special_die_activated', seq: state.nextHistorySeq++, round: 3, attempt: 1,
      actionId: state.nextActionId++, timelineId: state.historyV2TimelineId, dieId: inactive.id, dieType: 'golden',
      effectInstanceId: `${inactive.id}:golden`, level: 1, context: 'hand', effectCause: 'score',
      detail: 'Golden earned 1 Gold' } as RunHistoryV2Event);
    expect(recentDieRelevance(state, inactive, evidence).activityRate).toBeCloseTo(1 / 3);
  });

  it('ranks active and Storage dice deterministically and only adds a die when it improves the tier', () => {
    const state = readyState([24, 24, 24]);
    const active = state.diceInventory.instances[1];
    active.effects = [createDieEffect(active.id, 'bonus', 2)];
    const stored = createCollectibleDie(state.diceInventory.nextDieId++, 'magnetic', 2);
    state.diceInventory.instances[stored.id] = stored;
    state.diceInventory.storage[0] = stored.id;
    const evidence = evaluateEngulfmentOffering(state, ownedEngulfmentAssets(state)).evidenceRounds;
    expect(rankInfernoDice(state, evidence)[0].dieId).toBe(stored.id);
    const deal = createInfernoEvaluation(state)!;
    expect(deal.requestedDieId).toBe(stored.id);
    expect(deal.tier).toBeGreaterThan(infernoTier(deal.flameInterest));

    const noUpgrade = readyState([16, 16, 16]);
    noUpgrade.diceInventory.instances[1].effects = [createDieEffect(1, 'bonus', 1)];
    expect(createInfernoEvaluation(noUpgrade)!.requestedDieId).toBeNull();

    const jump = readyState([15, 15, 15]);
    jump.diceInventory.instances[1].effects = [createDieEffect(1, 'doubleTime', 20)];
    expect(createInfernoEvaluation(jump)!.tier).toBeGreaterThanOrEqual(4);

    const ceiling = readyState([1_000, 1_000, 1_000]);
    ceiling.diceInventory.instances[1].effects = [createDieEffect(1, 'doubleTime', 20)];
    expect(createInfernoEvaluation(ceiling)!.requestedDieId).toBeNull();
  });
});

describe('frozen lifecycle, sacrifice, Forge lineage, and migration', () => {
  it('replaces an active sacrifice with fresh Basic I and removes Storage without replacement', () => {
    const activeState = readyState([15, 15, 15]);
    activeState.diceInventory.instances[1].effects = [createDieEffect(1, 'doubleTime', 10)];
    const activeDeal = createInfernoEvaluation(activeState)!;
    activeState.infernoEvaluation = activeDeal; activeState.phase = 'inferno';
    const oldActive = activeDeal.requestedDieId!;
    const activeSlot = activeState.diceInventory.roster.indexOf(oldActive);
    new Resolver(activeState, constant).engulfNow();
    const replacementId = activeState.diceInventory.roster[activeSlot]!;
    expect(activeState.diceInventory.instances[oldActive]).toBeUndefined();
    expect(replacementId).not.toBe(oldActive);
    expect(activeState.diceInventory.instances[replacementId].effects.map(effect => [effect.type, effect.level]))
      .toEqual([['basic', 1]]);

    const storageState = readyState([15, 15, 15]);
    const stored = createCollectibleDie(storageState.diceInventory.nextDieId++, 'doubleTime', 10);
    storageState.diceInventory.instances[stored.id] = stored; storageState.diceInventory.storage[2] = stored.id;
    const storageDeal = createInfernoEvaluation(storageState)!;
    storageState.infernoEvaluation = storageDeal; storageState.phase = 'inferno';
    new Resolver(storageState, constant).engulfNow();
    expect(storageState.diceInventory.storage[2]).toBeNull();
    expect(storageState.diceInventory.instances[stored.id]).toBeUndefined();
  });

  it('declines once per evidence clear and freezes across save/load', () => {
    const state = readyState();
    const deal = createInfernoEvaluation(state)!;
    state.infernoEvaluation = deal; state.phase = 'inferno';
    new Resolver(state, constant).deferEngulfment();
    expect(createInfernoEvaluation(state)).toBeNull();
    appendEvidenceRound(state, 4, [{ instanceId: ownedEngulfmentAssets(state)[0].instanceId, factor: 16 }]);
    const fresh = createInfernoEvaluation(state)!;
    expect(fresh.evidenceRounds.map(round => round.round)).toEqual([1, 2, 3, 4]);
    state.infernoEvaluation = fresh; state.phase = 'inferno';
    expect(normalizeGameState(structuredClone(state)).infernoEvaluation).toEqual(fresh);
  });

  it('inherits only the stronger parent lineage, transitively, with intrinsic and ID tie-breaks', () => {
    let state = readyState();
    state.phase = 'shop'; state.temper = 1_000;
    state.shop = { visitId: 1, stage: 'forge', navigationHistory: ['forge'], offers: [], offerRerolls: 0,
      lifeRestores: 0, forgeSelection: { dieAId: 0, dieBId: 1 } };
    state.diceInventory.instances[0].effects = [createDieEffect(0, 'bonus', 2)];
    state.diceInventory.instances[1].effects = [createDieEffect(1, 'basic', 2)];
    const first = dispatch(state, { type: 'CONFIRM_FORGE', destination: { area: 'roster', index: 0 } }, constant).state;
    const firstResult = first.diceInventory.roster[0]!;
    expect(first.diceInventory.instances[firstResult].lineage).toEqual([0, firstResult]);
    first.shop!.forgeSelection = { dieAId: firstResult, dieBId: 2 };
    first.diceInventory.instances[2].effects = [createDieEffect(2, 'basic', 1)];
    const second = dispatch(first, { type: 'CONFIRM_FORGE', destination: { area: 'roster', index: 0 } }, constant).state;
    const secondResult = second.diceInventory.roster[0]!;
    expect(second.diceInventory.instances[secondResult].lineage).toEqual([0, firstResult, secondResult]);
  });
});
