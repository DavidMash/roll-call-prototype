import { describe, expect, it, vi } from 'vitest';
import { diceRerollCost } from './config';
import { activeFace, rollDie } from './dice';
import { dispatch, newRun, validateAction } from './engine';
import { canAttach, diminishingHalfChance, ENHANCEMENT_IDS, faceEnhancementTypes } from './enhancements';
import type { Enhancement, GameState, RandomSource, Rank } from './types';

const constant = (value = 0.99): RandomSource => ({ next: () => value });
function board(values: Rank[] = [1, 2, 3, 4, 5]): GameState {
  const state = newRun('overhaul', constant()).state;
  state.dice.forEach((die, index) => { die.value = values[index]; });
  state.target = 100000; state.stats.rounds[0].target = state.target;
  return state;
}
function shop(): GameState {
  const state = board(); state.phase = 'shop'; state.gold = 100;
  state.shop = { diceRerolls: 0, offerRerolls: 0, trainingOffers: [], offers: [] };
  return state;
}
function offer(state: GameState, id: number, enhancement: Enhancement) { state.shop!.offers.push({ id, enhancement, purchased: false }); }

describe('flat round Gold economy', () => {
  it.each([0, 1, 2, 3])('pays five base plus %s unused rerolls', remaining => {
    const state = board(); state.target = 1; state.manualRerollsRemaining = remaining;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant());
    expect(result.state.lastRoundPayout).toEqual({ base: 5, unusedRerolls: remaining, interest: 0, heldGoldSnapshot: 0, total: 5 + remaining });
  });
  it.each([[0, 0], [4, 0], [5, 1], [14, 2], [25, 5], [100, 5]] as const)('calculates capped interest from %s held Gold', (gold, interest) => {
    const state = board(); state.target = 1; state.gold = gold;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant());
    expect(result.state.lastRoundPayout?.interest).toBe(interest);
    expect(result.state.lastRoundPayout?.total).toBe(8 + interest);
  });
  it('includes scoring Gold in the interest snapshot', () => {
    const state = board(); state.target = 1; state.gold = 4; activeFace(state.dice[0]).enhancements.golden = 1;
    const result = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant());
    expect(result.state.lastRoundPayout).toMatchObject({ heldGoldSnapshot: 5, interest: 1, total: 9 });
  });
  it('uses shop dice prices 2/4/8/16 and resets the counter in a new shop', () => {
    expect([0, 1, 2, 3].map(diceRerollCost)).toEqual([2, 4, 8, 16]);
    let state = shop(); state = dispatch(state, { type: 'REROLL_DICE' }, constant()).state;
    state = dispatch(state, { type: 'REROLL_DICE' }, constant()).state;
    expect(state.shop?.diceRerolls).toBe(2); expect(state.stats.lifetimeNormalShopGoldSpent).toBe(6);
    state = dispatch(state, { type: 'NEXT_ROUND' }, constant()).state;
    state.target = 1; state.dice.forEach(die => { die.value = 1; });
    state = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant()).state;
    expect(state.shop?.diceRerolls).toBe(0); expect(diceRerollCost(state.shop!.diceRerolls)).toBe(2);
  });
});

describe('enhancement metadata, face slots, caps, and scrapping', () => {
  it('allows three distinct types, rejects a fourth, and permits an existing stack', () => {
    const state = shop(); const face = activeFace(state.dice[0]);
    face.enhancements.bonus = 1; face.enhancements.workout = 1; face.enhancements.golden = 1;
    expect(faceEnhancementTypes(face)).toHaveLength(3);
    expect(canAttach(face, 'mirror')).toBe(false);
    expect(canAttach(face, 'bonus')).toBe(true);
    state.dice[0].flame = { id: 'ultimate', investedGold: 0 };
    expect(faceEnhancementTypes(face)).toHaveLength(3);
  });
  it('caps Sticky and Hitchhiker at three stacks and 87.5%', () => {
    expect([1, 2, 3].map(diminishingHalfChance)).toEqual([0.5, 0.75, 0.875]);
    for (const id of ['sticky', 'hitchhiker'] as const) {
      const state = shop(); activeFace(state.dice[0]).enhancements[id] = 3;
      expect(canAttach(activeFace(state.dice[0]), id)).toBe(false);
    }
  });
  it('scraps every stack for no Gold and frees a type slot', () => {
    const state = shop(); const face = state.dice[0].faces[3];
    face.enhancements.sticky = 3; face.enhancements.bonus = 2; face.enhancements.workout = 1;
    const result = dispatch(state, { type: 'SCRAP_ENHANCEMENT', dieId: 0, face: 4, enhancement: 'sticky' });
    expect(result.state.gold).toBe(100); expect(result.state.dice[0].faces[3].enhancements.sticky).toBeUndefined();
    expect(canAttach(result.state.dice[0].faces[3], 'bump')).toBe(true);
    expect(result.state.stats.scraps[0]).toMatchObject({ stacksRemoved: 3, face: 4 });
  });
  it('rejects a fourth type authoritatively during purchase', () => {
    const state = shop(); const face = activeFace(state.dice[0]);
    face.enhancements.bonus = 1; face.enhancements.workout = 1; face.enhancements.golden = 1; offer(state, 1, 'bump');
    expect(validateAction(state, { type: 'BUY', offerId: 1, dieId: 0 })).toContain('3 enhancement types');
  });
  it('excludes Sustainable and includes Bump in the offer catalog', () => {
    expect(ENHANCEMENT_IDS).toContain('bump'); expect(ENHANCEMENT_IDS).not.toContain('sustainable');
  });
});

describe('Bump roll control', () => {
  it.each([[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 1]] as [Rank, Rank][])('%s → %s without RNG', (from, to) => {
    const state = board(); const die = state.dice[0]; die.value = from; activeFace(die).enhancements.bump = 1;
    const rng = { next: vi.fn(() => 0.5) };
    expect(rollDie(die, rng)).toEqual({ value: to, weighted: false }); expect(rng.next).not.toHaveBeenCalled();
  });
  it('does nothing merely by appearing and controls the next actual roll', () => {
    const state = board(); state.dice[0].faces[0].enhancements.bump = 1;
    expect(state.dice[0].value).toBe(1);
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0.99));
    expect(result.state.dice[0].value).toBe(2); expect(result.state.stats.bumpControlledRolls).toBe(1);
  });
  it('lets destination rolled-face effects trigger without recursively Bumping', () => {
    const state = board(); state.dice[0].faces[0].enhancements.bump = 1;
    state.dice[0].faces[1].enhancements.jumpingBean = 1;
    state.dice[0].faces[1].enhancements.sticky = 1;
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, constant(0));
    expect(result.state.stats.bumpControlledRolls).toBe(1);
    expect(result.state.stats.triggers.jumpingBean).toBe(1);
    expect(result.state.score).toBeGreaterThan(0);
  });
});
