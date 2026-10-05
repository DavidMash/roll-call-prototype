import { describe, expect, it } from 'vitest';
import { newTutorialSession } from './scenario';
import { activeTutorialBeat } from './tutorialSteps';

describe('tutorial contextual lessons', () => {
  it('triggers positive Interest once from payout state in any later Chapter', () => {
    const { session } = newTutorialSession();
    session.game.round = 19;
    session.game.phase = 'roundSummary';
    session.game.roundSummary = {
      round: 19, encounterType: 'normal', bossType: null, score: 500, target: 400,
      goldBefore: 10, goldAfter: 17, totalGoldEarned: 7,
      sources: { baseRewardGold: 5, unusedRerollGold: 0, interestGold: 2, bossRewardGold: 0, goldenGold: 0, jackpotGold: 0, otherGold: 0 },
    };
    session.scenario.completedBeatIds.push('curriculum-complete');
    expect(activeTutorialBeat(session)?.id).toBe('context-interest');
    session.scenario.seenLessonIds.push('interest');
    expect(activeTutorialBeat(session)?.id).not.toBe('context-interest');
  });

  it('uses event state for Care Package, Bonfire, safeguard, and unfamiliar Boss coaching', () => {
    const { session } = newTutorialSession();
    session.game.round = 20;
    session.scenario.completedBeatIds.push('curriculum-complete');
    session.game.manualRerollsRemaining = 0;
    session.game.specialOfferEffects.carePackageRerolls = 2;
    expect(activeTutorialBeat(session)).toMatchObject({ id: 'context-care-package', body: expect.arrayContaining([expect.stringContaining('2 left')]) });

    session.scenario.seenLessonIds.push('care-package');
    session.game.specialOfferEffects.carePackageRerolls = 0;
    session.game.bonfires = ['minigun'];
    expect(activeTutorialBeat(session)?.id).toBe('context-bonfire');

    session.scenario.seenLessonIds.push('bonfire');
    session.scenario.safeguardActivations = 1;
    expect(activeTutorialBeat(session)?.id).toBe('context-safeguard');

    session.scenario.seenLessonIds.push('safeguard');
    session.game.boss = { type: 'fly', flyHand: null, caught: false, moves: 0 };
    expect(activeTutorialBeat(session)?.id).toBe('context-later-boss');
    session.game.boss = { type: 'quickdraw', lowerShotUsed: false, playedLowerHand: null };
    expect(activeTutorialBeat(session)?.id).not.toBe('context-later-boss');
  });
});
