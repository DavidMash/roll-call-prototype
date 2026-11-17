import { describe, expect, it } from 'vitest';
import { createCollectibleDie } from './dice';
import { createDieEffect, initialDieRoundRuntime, SPECIAL_DICE, SPECIAL_DIE_TYPES } from './specialDice';
import {
  availableEffectColor, dieVisualPresentation, effectColor, effectColorAvailability, effectDetails,
  NORMAL_DIE_COLOR, saturationFactor,
} from './specialDiePresentation';

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

  it('blends invocation-backed colors by the fraction of Uses remaining', () => {
    const die = createCollectibleDie(5, 'magic', 4);
    const runtime = initialDieRoundRuntime(die);
    const effect = die.effects[0];
    expect(availableEffectColor(effect)).toBe(effectColor(effect));
    runtime.effects[effect.id].invocationsRemaining = 2;
    expect(effectColorAvailability(effect, runtime)).toBe(.5);
    expect(availableEffectColor(effect, runtime)).toBe(
      `color-mix(in srgb, ${effectColor(effect)} 50%, ${NORMAL_DIE_COLOR})`);
    runtime.effects[effect.id].invocationsRemaining = 0;
    expect(availableEffectColor(effect, runtime)).toBe(NORMAL_DIE_COLOR);
    expect(dieVisualPresentation(die, runtime)).toMatchObject({
      accent: NORMAL_DIE_COLOR,
      activeEffectColor: false,
    });
  });

  it('fades Clockwork controlled Rolls but leaves non-use caps fully colored', () => {
    const clockwork = createCollectibleDie(6, 'clockwork', 2);
    const clockworkRuntime = initialDieRoundRuntime(clockwork);
    clockworkRuntime.effects[clockwork.effects[0].id].clockworkRolls = 3;
    expect(effectColorAvailability(clockwork.effects[0], clockworkRuntime)).toBe(.5);
    clockworkRuntime.effects[clockwork.effects[0].id].clockworkRolls = 6;
    expect(availableEffectColor(clockwork.effects[0], clockworkRuntime)).toBe(NORMAL_DIE_COLOR);

    const golden = createCollectibleDie(7, 'golden', 2);
    const goldenRuntime = initialDieRoundRuntime(golden);
    goldenRuntime.effects[golden.effects[0].id].goldenGoldEarned = 6;
    expect(effectColorAvailability(golden.effects[0], goldenRuntime)).toBe(1);
    expect(availableEffectColor(golden.effects[0], goldenRuntime)).toBe(effectColor(golden.effects[0]));
  });

  it('neutralizes only the exhausted part of a multi-effect gradient', () => {
    const die = createCollectibleDie(7, 'magic', 2);
    die.effects.push(createDieEffect(7, 'golden', 2));
    const runtime = initialDieRoundRuntime(die);
    runtime.effects[die.effects[0].id].invocationsRemaining = 0;
    const presentation = dieVisualPresentation(die, runtime);
    expect(presentation.activeEffectColor).toBe(true);
    expect(presentation.background).toContain(NORMAL_DIE_COLOR);
    expect(presentation.background).toContain(effectColor(die.effects[1]));
    expect(presentation.background).not.toContain(effectColor(die.effects[0]));
  });

  it('reports status from the matching effect runtime rather than whole-die state', () => {
    const die = createCollectibleDie(8, 'magic', 2);
    die.effects.push(createDieEffect(8, 'furnace', 3));
    const runtime = initialDieRoundRuntime(die);
    runtime.effects['8:furnace'].furnaceGoldFed = 4;
    runtime.effects['8:furnace'].furnacePips = 36;
    expect(effectDetails(die, die.effects[0], runtime).status).toContainEqual({ label: 'Activation', value: 'Manual Reroll' });
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
      { label: 'Automatic lowest rank', value: '1' },
      { label: 'Uses Remaining', value: '6' },
    ]);
  });
});
