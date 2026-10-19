import { describe, expect, it } from 'vitest';
import { newTutorialSession } from './scenario';
import { activeTutorialBeat, normalizeTutorialBeatTargets } from './tutorialSteps';

describe('current tutorial curriculum', () => {
  it('starts with the welcome beat and contains no face-Enhancement lesson copy', () => {
    const beat = activeTutorialBeat(newTutorialSession().session);
    expect(beat?.id).toBe('welcome');
    expect(JSON.stringify(beat).toLowerCase()).not.toContain('enhancement');
  });

  it('normalizes interactive targets into highlighted targets', () => {
    const beat = normalizeTutorialBeatTargets({ id: 'x', body: [], blocking: false,
      highlightTargets: ['a'], interactiveTargets: ['b'], completion: { kind: 'acknowledge' } });
    expect(beat.highlightTargets).toEqual(['a', 'b']);
  });
});
