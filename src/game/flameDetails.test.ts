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
    ['momentum', '+0.125 Charge per Play'],
    ['thirdRail', '+0.125 Charge per Rolled 3'],
    ['jumpStart', '+0.5 Charge per Manual Reroll'],
    ['powerSurge', '×3 current Charge on highest-level Hand'],
    ['fluxCapacitor', '×1.25 Charge when 1 other die is affected'],
  ])('%s keeps its own Current Effect wording', (flame, currentValue) => {
    expect(flameDetailsPresentation(flame, 25, board())).toMatchObject({ currentLabel: 'Current Effect', currentValue });
  });

  it('uses the standard curve for the new scoring-condition Flames', () => {
    const state = board();
    expect(flameDetailsPresentation('fatCat', 35, state).currentValue).toBe('up to ×2.4');
    expect(flameDetailsPresentation('vineyard', 35, state).currentValue).toBe('up to ×2.4');
    expect(flameDetailsPresentation('fetch', 35, state).currentValue).toBe('up to ×2.4');
  });
});
