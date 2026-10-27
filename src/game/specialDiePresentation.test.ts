import { describe, expect, it } from 'vitest';
import { createCollectibleDie } from './dice';
import { createDieEffect, initialDieRoundRuntime, SPECIAL_DICE, SPECIAL_DIE_TYPES } from './specialDice';
import { dieVisualPresentation, effectColor, effectDetails, saturationFactor } from './specialDiePresentation';

describe('special-die presentation', () => {
  it('uses a neutral presentation for Normal dice', () => {
    const presentation = dieVisualPresentation(createCollectibleDie(1));
    expect(presentation.accent).toBe('#adb5bd');
  });

  it('derives every special color from the authoritative registry and effect level', () => {
    for (const type of SPECIAL_DIE_TYPES) {
      const die = createCollectibleDie(1, type, 1);
      expect(effectColor(die.effects[0])).toMatch(/^hsl\(/);
      expect(dieVisualPresentation(die).background).toContain('linear-gradient');
      expect(SPECIAL_DICE[type].icon).toBeTruthy();
    }
    expect(saturationFactor(1)).toBe(.8);
    expect(saturationFactor(8)).toBe(1);
    expect(saturationFactor(100)).toBe(1);
  });

  it('builds a deterministic multi-effect gradient in stored effect order', () => {
    const die = createCollectibleDie(4, 'magnetic');
    die.effects.push(createDieEffect(4, 'golden', 2));
    const first = dieVisualPresentation(die);
    die.effects.reverse();
    const reversed = dieVisualPresentation(die);
    expect(first.background).not.toBe(reversed.background);
    expect(first.background).toContain('color-mix');
  });

  it('reports status from the matching effect runtime rather than whole-die state', () => {
    const die = createCollectibleDie(8, 'magic', 2);
    die.effects.push(createDieEffect(8, 'furnace', 3));
    const runtime = initialDieRoundRuntime(die);
    runtime.effects['8:magic'].magicArmedFace = 5;
    runtime.effects['8:furnace'].furnaceGoldFed = 4;
    runtime.effects['8:furnace'].furnacePips = 36;
    expect(effectDetails(die, die.effects[0], runtime).status).toContainEqual({ label: 'Next Reroll', value: '5' });
    expect(effectDetails(die, die.effects[1], runtime).status).toContainEqual({ label: 'Furnace reserve', value: '+36 Pips' });
  });

  it('reports Curtain Call scaling without old per-face counters and Jumping Bean uses at three per level', () => {
    const die = createCollectibleDie(9, 'freePlay', 3);
    die.effects.push(createDieEffect(9, 'jumpingBean', 2));
    const runtime = initialDieRoundRuntime(die);
    expect(effectDetails(die, die.effects[0], runtime)).toEqual({
      description: expect.stringContaining('Curtain Call level'),
      status: [{ label: 'Manual Reroll Free Play', value: '×3 die Pips' }],
    });
    expect(effectDetails(die, die.effects[1], runtime).status).toEqual([
      { label: 'Jumping Bean Number', value: '1' },
      { label: 'Uses Remaining', value: '6' },
    ]);
  });
});
