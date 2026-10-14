import { describe, expect, it } from 'vitest';
import { ENHANCEMENTS, ENHANCEMENT_IDS, enhancementLabel } from './enhancements';
import type { Enhancement } from './types';

const IMPLEMENTED_ENHANCEMENTS: Enhancement[] = [
  'bonus', 'golden', 'workout', 'vintage', 'boomerang',
  'hitchhiker', 'weighted', 'bump', 'magnetic', 'jackpot',
  'teamwork', 'loneWolf', 'tank', 'freePlay',
  'mirror', 'missingLink', 'doubleTime', 'jumpingBean',
  'shifter', 'flywheel', 'holiday', 'personalTrainer',
  'magic', 'conjoined', 'furnace', 'sustainable',
];

describe('canonical Enhancement visual metadata', () => {
  it('covers every implemented Enhancement exactly once with a unique symbol', () => {
    expect(ENHANCEMENT_IDS).toEqual(IMPLEMENTED_ENHANCEMENTS);
    expect(Object.keys(ENHANCEMENTS)).toEqual(IMPLEMENTED_ENHANCEMENTS);
    expect(ENHANCEMENT_IDS.every(id => ENHANCEMENTS[id].symbol.trim().length > 0)).toBe(true);
    expect(new Set(ENHANCEMENT_IDS.map(id => ENHANCEMENTS[id].symbol)).size).toBe(ENHANCEMENT_IDS.length);
  });

  it('builds player-facing labels deterministically from the registry', () => {
    for (const id of ENHANCEMENT_IDS) {
      expect(enhancementLabel(id)).toBe(`${ENHANCEMENTS[id].symbol} ${ENHANCEMENTS[id].name}`);
      expect(enhancementLabel(id, true)).toBe(`${ENHANCEMENTS[id].symbol} ${ENHANCEMENTS[id].name.toUpperCase()}`);
    }
  });
});
