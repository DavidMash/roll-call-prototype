import { describe, expect, it } from 'vitest';
import { acknowledgeBeat, dispatchTutorial, newTutorialSession, tutorialRequiredBeatIds as R } from './scenario';
import { activeTutorialBeat, normalizeTutorialBeatTargets } from './tutorialSteps';
import type { TutorialSession, TutorialUiState } from './types';
import { buildRound2Plan, buildRound4Plan } from './tutorialBindings';

const ui = (overrides: Partial<TutorialUiState> = {}): TutorialUiState => ({
  selection: { hand: null, dieIds: [] }, selectedOffer: null, selectedFlameOffer: null, flameDetailsOpen: false, ...overrides,
});

function action(session: TutorialSession, next: Parameters<typeof dispatchTutorial>[1]) {
  const result = dispatchTutorial(session, next);
  expect(result.error).toBeUndefined();
  return result.session;
}

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

describe('tutorial guided interaction beats', () => {
  it('normalizes every interactive selector into the visible highlight set', () => {
    const normalized = normalizeTutorialBeatTargets({
      id: 'invariant', body: [], target: '.card', highlightTargets: ['.card'],
      interactiveTargets: ['.card button'], blocking: false,
    });
    expect(normalized.highlightTargets).toEqual(['.card', '.card button']);
    expect(normalized.interactiveTargets?.every(target => normalized.highlightTargets?.includes(target))).toBe(true);
  });

  it('splits the first reroll and first scored hand using live selection state', () => {
    const { session } = newTutorialSession();
    session.scenario.completedBeatIds.push('welcome', 'goal', 'scorecard');
    expect(activeTutorialBeat(session, ui())).toMatchObject({
      id: 'c1-r1-select-reroll-die',
      highlightTargets: ['[data-tutorial="die-2"] .die'],
      interactiveTargets: ['[data-tutorial="die-2"] .die'],
      completion: { kind: 'selection' },
    });
    expect(activeTutorialBeat(session, ui({ selection: { hand: 'twos', dieIds: [1] } }))).toMatchObject({
      id: R.reroll,
      highlightTargets: ['[data-tutorial="die-2"] .die', '[data-tutorial="reroll-button"]'],
      interactiveTargets: ['[data-tutorial="reroll-button"]'],
      completion: { kind: 'action' },
    });

    session.scenario.completedBeatIds.push(R.reroll, 'c1-r1-nice', 'c1-r1-pips-mult');
    const selectHand = activeTutorialBeat(session, ui());
    expect(selectHand).toMatchObject({ id: 'c1-r1-select-three-kind', interactiveTargets: ['[data-testid="scorecard-row-threeKind"]'] });
    expect(selectHand?.highlightTargets).toHaveLength(4);
    expect(activeTutorialBeat(session, ui({ selection: { hand: 'threeKind', dieIds: [0, 1, 2] } }))).toMatchObject({
      id: R.threeKind,
      interactiveTargets: ['[data-tutorial="play-action"]'],
    });
  });

  it('separates Training, Bonus, and Workout purchase targets from placement targets', () => {
    let { session } = newTutorialSession();
    session = action(session, { type: 'MANUAL_REROLL', dieIds: [1] });
    session = action(session, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] });
    session = action(session, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] });
    session = action(session, { type: 'PLAY', hand: 'sixes', dieIds: [4] });
    session = action(session, { type: 'PLAY', hand: 'fives', dieIds: [3] });
    session = action(session, { type: 'PLAY', hand: 'smallStraight', dieIds: [0, 1, 2, 3] });
    session = action(session, { type: 'CONTINUE_ROUND_SUMMARY' });
    session.scenario.completedBeatIds.push('welcome', 'goal', 'scorecard', 'c1-r1-nice', 'c1-r1-pips-mult',
      'c1-r1-after-play', 'c1-r1-payout', 'c1-r1-payout-rerolls', 'shop1-training');
    expect(activeTutorialBeat(session, ui())).toMatchObject({ id: R.training,
      interactiveTargets: ['[data-tutorial="training-fullHouse"] .training-action'] });

    session = action(session, { type: 'TRAIN_HAND', hand: 'fullHouse' });
    session.scenario.completedBeatIds.push('shop1-training-result', 'shop1-enhancements', 'shop1-bonus-info');
    const bonus = session.game.shop!.offers.find(offer => offer.enhancement === 'bonus')!;
    expect(activeTutorialBeat(session, ui())).toMatchObject({ id: 'shop1-select-bonus', completion: { kind: 'selection' } });
    expect(activeTutorialBeat(session, ui({ selectedOffer: bonus.id }))).toMatchObject({
      id: R.bonus,
      body: [`Put + Bonus on this ${session.scenario.bonusBinding!.faceRank}.`],
      interactiveTargets: ['[data-tutorial="die-2"] .die'],
    });

    session.game.round = 3;
    session.scenario.completedBeatIds.push(R.bonus, 'shop-r4-workout-info');
    session.scenario.workoutBinding = { dieId: 0, faceRank: session.game.dice[0].value };
    session.game.shop!.offers[0] = { ...session.game.shop!.offers[0], enhancement: 'workout', purchased: false };
    const workoutId = session.game.shop!.offers[0].id;
    expect(activeTutorialBeat(session, ui())).toMatchObject({ id: 'shop-r4-select-workout' });
    expect(activeTutorialBeat(session, ui({ selectedOffer: workoutId }))).toMatchObject({
      id: R.workout,
      interactiveTargets: ['[data-tutorial="die-1"] .die'],
    });
  });

  it('returns control after the first scored hand instead of prescribing later Round 1 hands', () => {
    let { session } = newTutorialSession();
    session = action(session, { type: 'MANUAL_REROLL', dieIds: [1] });
    session = action(session, { type: 'PLAY', hand: 'threeKind', dieIds: [0, 1, 2] });
    session.scenario.completedBeatIds.push('welcome', 'goal', 'scorecard', 'c1-r1-nice', 'c1-r1-pips-mult', 'c1-r1-after-play');

    const yourTurn = activeTutorialBeat(session, ui());
    expect(yourTurn).toMatchObject({
      id: 'c1-r1-your-turn',
      body: ["You've got it. Keep playing hands until you reach the Goal."],
      interactiveTargets: [],
    });

    session = acknowledgeBeat(session, 'c1-r1-your-turn');
    expect(activeTutorialBeat(session, ui())).toBeNull();
    expect(dispatchTutorial(session, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }).error).toBeUndefined();
  });

  it('keeps the rank-relative Round 2 and Workout lessons multi-target and moves PLAY into its own beat', () => {
    const { session } = newTutorialSession();
    session.scenario.bonusBinding = { dieId: 1, faceRank: 4 };
    session.scenario.round2Plan = buildRound2Plan(session.game.dice, session.scenario.bonusBinding)!;
    session.scenario.round2Plan.opening.forEach(({ dieId, rank }) => { session.game.dice[dieId].value = rank; });
    session.game.round = 2;
    session.game.phase = 'round';
    const round2 = session.scenario.round2Plan;
    const round2Hand = `[data-testid="scorecard-row-${round2.upperHand}"]`;
    const round2Die = `[data-tutorial="die-${round2.singletonDieId + 1}"] .die`;
    expect(activeTutorialBeat(session, ui())).toMatchObject({
      id: 'c1-r2-two-pair',
      highlightTargets: expect.arrayContaining([
        '[data-testid="scorecard-row-twoPair"]',
        '[data-testid="scorecard-row-fullHouse"]',
        round2Die,
      ]),
    });
    session.scenario.completedBeatIds.push('c1-r2-two-pair');
    expect(activeTutorialBeat(session, ui())).toMatchObject({
      id: 'c1-r2-choice',
      highlightTargets: expect.arrayContaining([
        round2Die,
        round2Hand,
        '[data-tutorial="reroll-button"]',
      ]),
      interactiveTargets: [],
    });

    session.scenario.completedBeatIds.push('c1-r2-choice');
    expect(activeTutorialBeat(session, ui())).toMatchObject({
      id: 'c1-r2-select-twos',
      interactiveTargets: [round2Hand],
    });
    expect(activeTutorialBeat(session, ui({ selection: { hand: round2.upperHand, dieIds: [round2.singletonDieId] } }))).toMatchObject({
      id: R.r2Twos,
      interactiveTargets: ['[data-tutorial="play-action"]'],
    });

    session.scenario.workoutBinding = { dieId: 0, faceRank: 5 };
    session.scenario.round4Plan = buildRound4Plan(session.game.dice, session.scenario.bonusBinding, session.scenario.workoutBinding)!;
    session.scenario.round4Plan.opening.forEach(({ dieId, rank }) => { session.game.dice[dieId].value = rank; });
    session.game.round = 4;
    const round4 = session.scenario.round4Plan;
    const round4Hand = `[data-testid="scorecard-row-${round4.upperHand}"]`;
    const round4Die = `[data-tutorial="die-${round4.singletonDieId + 1}"] .die`;
    session.scenario.completedBeatIds.push('c1-r4-familiar');
    expect(activeTutorialBeat(session, ui())).toMatchObject({
      id: 'c1-r4-select-twos',
      highlightTargets: expect.arrayContaining([
        round4Hand,
        round4Die,
      ]),
      interactiveTargets: [round4Hand],
    });
  });

  it('gates first Flame assignment and Stoke as distinct guided actions', () => {
    const { session } = newTutorialSession();
    session.game.round = 6;
    session.game.phase = 'flameSelection';
    session.scenario.completedBeatIds.push('flame-selection-1');
    expect(activeTutorialBeat(session, ui())).toMatchObject({
      id: 'flame-select-first', interactiveTargets: ['.flame-offer-action'], completion: { kind: 'selection' },
    });
    expect(activeTutorialBeat(session, ui({ selectedFlameOffer: 7 }))).toMatchObject({
      id: 'flame-assign-first', interactiveTargets: ['[data-tutorial="dice-dock"] .die'], completion: { kind: 'action' },
    });

    session.game.phase = 'shop';
    session.scenario.firstFlame = 'doubleDown';
    session.scenario.completedBeatIds.push('flame-details');
    expect(activeTutorialBeat(session, ui({ flameDetailsOpen: true }))).toMatchObject({
      id: 'flame-stoke',
      interactiveTargets: ['[data-tutorial="stoke"] button', '[data-tutorial="stoke"] input'],
    });
  });

  it.each([
    ['doubleDown', 'pair', 'twoPair'],
    ['straightShooter', 'smallStraight', 'largeStraight'],
    ['minigun', null, 'sixes'],
  ] as const)('keeps the %s Chapter 2 branch atomic and highlights its Flame die', (flame, setup, payoff) => {
    const { session } = newTutorialSession();
    session.game.round = 7;
    session.game.phase = 'round';
    session.scenario.firstFlame = flame;
    session.scenario.firstFlameDieId = 2;
    session.scenario.completedBeatIds.push('chapter-2');
    if (setup === null) session.scenario.completedBeatIds.push(R.flameDemoSetup);

    const selectBeat = activeTutorialBeat(session, ui());
    expect(selectBeat?.id).toBe(setup === null ? 'c2-r1-payoff-select' : 'c2-r1-setup-select');
    expect(selectBeat?.highlightTargets).toEqual(expect.arrayContaining([
      `[data-testid="scorecard-row-${setup ?? payoff}"]`,
      '[data-tutorial="die-3"] .die',
    ]));
    expect(selectBeat?.interactiveTargets).toEqual(expect.arrayContaining([
      `[data-testid="scorecard-row-${setup ?? payoff}"]`,
      '[data-tutorial="die-3"] .die',
    ]));

    const actionBeat = activeTutorialBeat(session, ui({ selection: { hand: (setup ?? payoff), dieIds: [2] } }));
    expect(actionBeat?.id).toBe(setup === null ? R.flameDemoPayoff : R.flameDemoSetup);
    expect(actionBeat?.interactiveTargets).toEqual(['[data-tutorial="play-action"]']);
  });
});
