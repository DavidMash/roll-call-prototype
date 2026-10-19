import { describe, expect, it } from 'vitest';
import { dispatchTutorial, newTutorialSession } from './scenario';

describe('whole-die tutorial scenario', () => {
  it('starts from the current inventory model and curated boss plan', () => {
    const { session } = newTutorialSession();
    expect(session.game.diceInventory.roster).toEqual([0, 1, 2, 3, 4]);
    expect(session.game.dice.every(die => die.faces.every(face => !Object.hasOwn(face, 'enhancements')))).toBe(true);
    expect(Object.values(session.game.bossSchedule)).not.toContain('clockmaker');
  });

  it('continues to dispatch scripted whole-game actions deterministically', () => {
    const { session } = newTutorialSession();
    const first = dispatchTutorial(session, { type: 'MANUAL_REROLL', dieIds: [1] });
    expect(first.error).toBeUndefined();
    expect(first.session.game.manualRerollsRemaining).toBe(2);
  });
});
