import { describe, expect, it } from 'vitest';
import { newRun } from './engine';
import { rosterDice } from './inventory';
import { specialDieDetails } from './specialDiePresentation';
import { initialDieRoundRuntime } from './specialDice';
import type { CollectibleDie, DieType } from './types';

function details(type: DieType, level = 1) {
  const die = rosterDice(newRun(`details-${type}-${level}`).state)[0] as CollectibleDie;
  Object.assign(die, { type, level, vintageAppreciation: 0 });
  return { die, runtime: initialDieRoundRuntime(die) };
}

describe('special die Round details', () => {
  it('reports Workout, Golden, and Furnace progress from live Round state', () => {
    const workout = details('workout', 2);
    workout.runtime.temporaryPips = 12;
    expect(specialDieDetails(workout.die, workout.runtime).status).toEqual([
      { label: 'Current bonus this Round', value: '+12 Pips' },
      { label: 'Gains per Score', value: '+4 Pips' },
    ]);

    const golden = details('golden', 2);
    golden.runtime.goldenGoldEarned = 4;
    expect(specialDieDetails(golden.die, golden.runtime).status).toContainEqual(
      { label: 'Gold earned this Round', value: '4 / 6' },
    );

    const furnace = details('furnace', 2);
    furnace.runtime.furnaceUnits = 3;
    expect(specialDieDetails(furnace.die, furnace.runtime).status).toEqual([
      { label: 'Fed Gold', value: '3 / 5' },
      { label: 'Current bonus', value: '+18 Pips' },
    ]);
  });

  it('reports Magnetic target, Magic armed state, and Double Time wording', () => {
    const magnetic = details('magnetic', 2);
    magnetic.die.value = 4;
    magnetic.runtime.invocationsRemaining = 1;
    expect(specialDieDetails(magnetic.die, magnetic.runtime).status).toEqual([
      { label: 'Target', value: '4' },
      { label: 'Uses remaining', value: '1 / 2' },
    ]);

    const magic = details('magic', 1);
    magic.runtime.magicArmedFace = 5;
    expect(specialDieDetails(magic.die, magic.runtime).status).toContainEqual({ label: 'Next Reroll', value: '5' });

    const doubleTime = details('doubleTime', 1);
    expect(specialDieDetails(doubleTime.die, doubleTime.runtime)).toMatchObject({
      description: '25% chance to Score twice.',
      status: [{ label: 'Additional Score chance', value: '25% chance to Score twice' }],
    });
  });

  it('reports compact Free Play uses for every face', () => {
    const freePlay = details('freePlay', 2);
    freePlay.runtime.freePlayUsesByFace = { 1: 0, 2: 1, 3: 2, 4: 0, 5: 1, 6: 2 };
    expect(specialDieDetails(freePlay.die, freePlay.runtime).freePlayRemaining).toEqual({
      1: 2, 2: 1, 3: 0, 4: 2, 5: 1, 6: 0,
    });
  });
});
