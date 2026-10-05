import { describe, expect, it } from 'vitest';
import { newRun } from './engine';
import { CHARGE_FLAME_IDS, flameDetailsPresentation, maxChargeContribution } from './flames';
import type { Flame } from './types';

const board = () => newRun('flame-details', { next: () => 0 }).state;

describe('shared Flame numeric details', () => {
  it('reports authoritative conditional XMult scaling at Ember and Bonfire strength', () => {
    expect(flameDetailsPresentation('doubleDown', 35, board())).toMatchObject({
      currentLabel: 'Current XMult', currentValue: 'up to ×3.8', maxChargeContribution: null,
    });
    expect(flameDetailsPresentation('doubleDown', 100, board()).currentValue).toBe('up to ×9');
  });

  it.each(CHARGE_FLAME_IDS)('%s reports its authoritative Max Charge contribution', flame => {
    expect(flameDetailsPresentation(flame, 25, board()).maxChargeContribution).toBe(maxChargeContribution(25));
    expect(flameDetailsPresentation(flame, 100, board()).maxChargeContribution).toBe(5);
  });

  it.each<[Flame, string]>([
    ['momentum', '+0.125 Charge per hand'],
    ['thirdRail', '+0.125 Charge per rolled 3'],
    ['jumpStart', '+0.5 Charge per manual Reroll'],
    ['powerSurge', '×3 current Charge on highest level hand'],
    ['fluxCapacitor', '×1.25 Charge per pulled Magnetic face'],
  ])('%s keeps its own Current Effect wording', (flame, currentValue) => {
    expect(flameDetailsPresentation(flame, 25, board())).toMatchObject({ currentLabel: 'Current Effect', currentValue });
  });

  it('uses formatted live state for non-static effects without float artifacts', () => {
    const state = board();
    state.gold = 65;
    state.lifetimeNormalShopGoldSpent = 37;
    expect(flameDetailsPresentation('dragonsHoard', 35, state).currentValue).toBe('×1.91 at current Gold');
    expect(flameDetailsPresentation('moneyToBurn', 35, state).currentValue).toBe('×1.518 at current Shop spend');
  });
});
