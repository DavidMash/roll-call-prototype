import { combinationsForHand, HANDS } from '../game/hands';
import { activeSpecialOfferStatusItems } from '../game/specialOffers';
import { enhancementLabel } from '../game/enhancements';
import type { HandId } from '../game/types';
import type { TutorialBeat, TutorialSession, TutorialUiState } from './types';
import { tutorialRequiredBeatIds as R } from './scenario';

type Candidate = TutorialBeat & { when: (session: TutorialSession, ui: TutorialUiState) => boolean };
const info = (id: string, title: string | undefined, body: string[], target: string | undefined,
  when: Candidate['when'], extras: Partial<TutorialBeat> = {}): Candidate => ({
  id, title, body, target, highlightTargets: target ? [target] : [], when, blocking: true,
  actionLabel: 'GOT IT', completion: { kind: 'acknowledge' }, ...extras,
});
const required = (id: string, title: string | undefined, body: string[], target: string,
  requiredAction: string, when: Candidate['when'], extras: Partial<TutorialBeat> = {}): Candidate => ({
  id, title, body, target, highlightTargets: [target], interactiveTargets: [target], when,
  blocking: false, requiredAction, completion: { kind: 'action', description: requiredAction }, ...extras,
});
const has = (session: TutorialSession, id: string) => session.scenario.completedBeatIds.includes(id);
const seen = (session: TutorialSession, id: TutorialSession['scenario']['seenLessonIds'][number]) => session.scenario.seenLessonIds.includes(id);
const die = (number: number) => `[data-tutorial="die-${number}"] .die`;
const hand = (id: HandId) => `[data-testid="scorecard-row-${id}"]`;
const PLAY = '[data-tutorial="play-action"]';
const REROLL = '[data-tutorial="reroll-button"]';
const BONUS = enhancementLabel('bonus');
const BONUS_UPPER = enhancementLabel('bonus', true);
const WORKOUT = enhancementLabel('workout');
const WORKOUT_UPPER = enhancementLabel('workout', true);
const VINTAGE = enhancementLabel('vintage');
const selected = (ui: TutorialUiState, selectedHand: HandId, dieIds?: number[]) =>
  ui.selection.hand === selectedHand
  && (!dieIds || (ui.selection.dieIds.length === dieIds.length && dieIds.every(id => ui.selection.dieIds.includes(id))));
const selectedEnhancement = (session: TutorialSession, ui: TutorialUiState, enhancement: 'bonus' | 'workout') =>
  session.game.shop?.offers.some(offer => offer.id === ui.selectedOffer && offer.enhancement === enhancement) ?? false;
const planIsPlayable = (session: TutorialSession, plan: TutorialSession['scenario']['round2Plan']) => !!plan
  && combinationsForHand(session.game.dice.filter(candidate => candidate.owner === 'player'), plan.upperHand)
    .some(ids => ids.includes(plan.singletonDieId));
const fullHouseIsPlayable = (session: TutorialSession) =>
  combinationsForHand(session.game.dice.filter(candidate => candidate.owner === 'player'), 'fullHouse').length > 0;
const planSelected = (ui: TutorialUiState, plan: NonNullable<TutorialSession['scenario']['round2Plan']>) =>
  selected(ui, plan.upperHand, [plan.singletonDieId]);
const flameDemoHand = (session: TutorialSession, payoff: boolean): HandId => {
  if (session.scenario.firstFlame === 'doubleDown') return payoff ? 'twoPair' : 'pair';
  if (session.scenario.firstFlame === 'straightShooter') return payoff ? 'largeStraight' : 'smallStraight';
  return 'sixes';
};
const flameSelectionReady = (session: TutorialSession, ui: TutorialUiState, payoff: boolean) => {
  const flameDieId = session.scenario.firstFlameDieId;
  return selected(ui, flameDemoHand(session, payoff))
    && flameDieId !== null && ui.selection.dieIds.includes(flameDieId);
};
const EMPTY_UI: TutorialUiState = {
  selection: { hand: null, dieIds: [] },
  selectedOffer: null,
  selectedFlameOffer: null,
  flameDetailsOpen: false,
};

/** Every required interaction is also a declared spotlight target. Parent card targets
 * remain useful context; the Director collapses nested regions before rendering. */
export function normalizeTutorialBeatTargets(beat: TutorialBeat): TutorialBeat {
  const interactiveTargets = beat.interactiveTargets ?? [];
  const highlightTargets = [...new Set([
    ...(beat.highlightTargets ?? (beat.target ? [beat.target] : [])),
    ...interactiveTargets,
  ])];
  return { ...beat, highlightTargets, interactiveTargets };
}

const candidates: Candidate[] = [
  info('welcome', 'WELCOME TO ROLL CALL', ["We'll learn as we play. I'll explain things when they matter, then get out of your way."], undefined,
    s => s.game.round === 1),
  info('goal', 'THE GOAL', ['Score enough points to reach the Goal and clear the Round.'], '[data-tutorial="goal"]',
    s => s.game.round === 1 && has(s, 'welcome'), { side: 'right' }),
  info('scorecard', 'YOUR SCORECARD', ['Upper hands score matching numbers. Lower hands score patterns like Pairs, Straights, and Full Houses.'], '[data-tutorial="scorecard"]',
    s => s.game.round === 1 && has(s, 'goal')),
  required('c1-r1-select-reroll-die', 'SELECT THIS DIE', ['Tap this 2.'], die(2), 'Select D2.',
    (s, ui) => s.game.round === 1 && s.game.phase === 'round' && has(s, 'scorecard') && !has(s, R.reroll)
      && !(ui.selection.dieIds.length === 1 && ui.selection.dieIds[0] === 1),
    { completion: { kind: 'selection', description: 'D2 selected' }, recoveryBeatId: R.reroll }),
  required(R.reroll, 'NOW REROLL IT', ['Use one Reroll and see what we get.'], REROLL, 'Reroll selected D2.',
    (s, ui) => s.game.round === 1 && s.game.phase === 'round' && has(s, 'scorecard') && !has(s, R.reroll)
      && ui.selection.dieIds.length === 1 && ui.selection.dieIds[0] === 1,
    { highlightTargets: [die(2), REROLL], interactiveTargets: [REROLL] }),
  info('c1-r1-nice', 'THREE OF A KIND', ['These three 1s make Three of a Kind.'], hand('threeKind'), s => has(s, R.reroll),
    { highlightTargets: [hand('threeKind'), die(1), die(2), die(3)] }),
  info('c1-r1-pips-mult', 'PIPS AND MULT', ['Every hand starts with Base Pips and a Mult. The dice that score add their own Pips too.'], '[data-tutorial="hand-threeKind"]',
    s => has(s, 'c1-r1-nice'), { highlightTargets: [hand('threeKind'), die(1), die(2), die(3)] }),
  required('c1-r1-select-three-kind', 'SELECT THE HAND', ['Choose Three of a Kind.'], hand('threeKind'),
    'Select Three of a Kind.', (s, ui) => s.game.round === 1 && s.game.phase === 'round' && has(s, 'c1-r1-pips-mult')
      && !has(s, R.threeKind) && !selected(ui, 'threeKind', [0, 1, 2]),
    { highlightTargets: [hand('threeKind'), die(1), die(2), die(3)], interactiveTargets: [hand('threeKind')],
      completion: { kind: 'selection', description: 'Three of a Kind selected' }, recoveryBeatId: R.threeKind }),
  required(R.threeKind, 'SCORING', ['Your score is Pips × Mult. Play it and watch it add up.'], PLAY,
    'Play Three of a Kind.', (s, ui) => s.game.round === 1 && s.game.phase === 'round' && has(s, 'c1-r1-pips-mult')
      && !has(s, R.threeKind) && selected(ui, 'threeKind', [0, 1, 2]),
    { highlightTargets: [hand('threeKind'), die(1), die(2), die(3), PLAY], interactiveTargets: [PLAY] }),
  info('c1-r1-after-play', 'AFTER YOU PLAY', ['That hand is now Used for this Round, and the dice that scored reroll.'], '[data-tutorial="hand-threeKind"]',
    s => has(s, R.threeKind)),
  info('c1-r1-your-turn', 'YOUR TURN', ["You've got it. Keep playing hands until you reach the Goal."], '[data-tutorial="scorecard"]',
    s => s.game.round === 1 && s.game.phase === 'round' && has(s, 'c1-r1-after-play')),
  info('c1-r1-payout', 'ROUND PAYOUT', ['Clearing a Round earns Gold. You also get +1 Gold for every normal Reroll you have left.'], '[data-tutorial="payout"]',
    s => s.game.round === 1 && s.game.phase === 'roundSummary' && has(s, R.threeKind)),
  info('c1-r1-payout-rerolls', undefined, ['You used one Reroll, so the other two earned you 2 extra Gold.'], '[data-tutorial="payout-rerolls"]',
    s => s.game.round === 1 && s.game.phase === 'roundSummary' && has(s, 'c1-r1-payout')),
  info('shop1-training', 'HAND TRAINING', ['Training makes a hand stronger by increasing its Base Pips and Mult.'], '[data-tutorial="hand-training"]',
    s => s.game.phase === 'shop' && s.game.round === 1),
  required(R.training, undefined, ["Let's train Full House so it's stronger when we find one."], '[data-tutorial="training-fullHouse"] .training-action',
    'Train Full House once.', s => s.game.phase === 'shop' && s.game.round === 1 && has(s, 'shop1-training'),
    { highlightTargets: ['[data-tutorial="training-fullHouse"]'], interactiveTargets: ['[data-tutorial="training-fullHouse"] .training-action'] }),
  info('shop1-training-result', 'FULL HOUSE · LV. 2', ['Its Base Pips and Mult are both higher now.'], '[data-tutorial="training-fullHouse"]',
    s => s.game.phase === 'shop' && s.game.round === 1 && has(s, R.training)),
  info('shop1-enhancements', 'ENHANCEMENTS', ['Training improves hands. Enhancements improve individual die faces.'], '[data-tutorial="enhancements"]',
    s => s.game.phase === 'shop' && s.game.round === 1 && has(s, 'shop1-training-result')),
  info('shop1-bonus-info', BONUS_UPPER, [`When this face scores, ${BONUS} adds +10 Pips.`], '[data-tutorial="enhancement-bonus"]',
    s => s.game.phase === 'shop' && s.game.round === 1 && has(s, 'shop1-enhancements')),
  required('shop1-select-bonus', `BUY ${BONUS_UPPER}`, [`Buy ${BONUS}.`], '[data-tutorial="enhancement-bonus"] .offer-action', `Buy ${BONUS}.`,
    (s, ui) => s.game.phase === 'shop' && s.game.round === 1 && has(s, 'shop1-bonus-info') && !has(s, R.bonus) && !selectedEnhancement(s, ui, 'bonus'),
    { highlightTargets: ['[data-tutorial="enhancement-bonus"]'], interactiveTargets: ['[data-tutorial="enhancement-bonus"] .offer-action'],
      completion: { kind: 'selection', description: 'Bonus selected' }, recoveryBeatId: R.bonus }),
  required(R.bonus, 'PUT IT HERE', [`Put ${BONUS} on the highlighted face.`], die(2), 'Choose the highlighted die.',
    (s, ui) => s.game.phase === 'shop' && s.game.round === 1 && has(s, 'shop1-bonus-info') && !has(s, R.bonus)
      && !!s.scenario.bonusBinding && selectedEnhancement(s, ui, 'bonus'),
    { highlightTargets: ['[data-tutorial="enhancement-bonus"]', die(2)], interactiveTargets: [die(2)] }),
  info('shop1-face-persistence', undefined, ['Enhancements stay on that physical face, even after the die rolls away from it.'], '[data-tutorial="die-2"]',
    s => s.game.phase === 'shop' && s.game.round === 1 && has(s, R.bonus), { side: 'top' }),

  info('c1-r2-two-pair', 'WE ALREADY HAVE TWO PAIR', ["That's good, but we just trained Full House."], '[data-tutorial="hand-twoPair"]',
    s => s.game.round === 2 && s.game.phase === 'round' && planIsPlayable(s, s.scenario.round2Plan),
    { highlightTargets: [hand('twoPair'), hand('fullHouse'), die(1)] }),
  info('c1-r2-choice', undefined, ['You could spend a Reroll on the singleton, or play its Upper hand and let it reroll after scoring.'], '[data-tutorial="die-1"]',
    s => s.game.round === 2 && s.game.phase === 'round' && has(s, 'c1-r2-two-pair'),
    { side: 'top', highlightTargets: [die(1), hand('twos'), REROLL] }),
  required('c1-r2-select-twos', "LET'S SAVE THE REROLL", ['Play the matching Upper hand.'], hand('twos'), 'Select the matching Upper hand.',
    (s, ui) => s.game.round === 2 && s.game.phase === 'round' && has(s, 'c1-r2-choice') && !has(s, R.r2Twos)
      && !!s.scenario.round2Plan && !planSelected(ui, s.scenario.round2Plan),
    { highlightTargets: [hand('twos'), die(1)], interactiveTargets: [hand('twos')], completion: { kind: 'selection', description: 'Twos selected' }, recoveryBeatId: R.r2Twos }),
  required(R.r2Twos, 'PLAY THE UPPER HAND', ['Let the singleton reroll after scoring.'], PLAY, 'Play the matching Upper hand.',
    (s, ui) => s.game.round === 2 && s.game.phase === 'round' && has(s, 'c1-r2-choice') && !has(s, R.r2Twos)
      && !!s.scenario.round2Plan && planSelected(ui, s.scenario.round2Plan),
    { highlightTargets: [hand('twos'), die(1), PLAY], interactiveTargets: [PLAY] }),
  info('c1-r2-nice', 'NICE', ['Playing the Upper hand rerolled that die for free, and now we have Full House.'], '[data-tutorial="hand-fullHouse"]',
    s => s.game.round === 2 && s.game.phase === 'round' && has(s, R.r2Twos)),
  required('c1-r2-select-full-house', 'FULL HOUSE · LV. 2', ['This is the hand we trained. Its Base Pips and Mult are stronger now.'], hand('fullHouse'),
    'Select Full House.', (s, ui) => s.game.round === 2 && s.game.phase === 'round' && has(s, 'c1-r2-nice') && !has(s, R.r2FullHouse)
      && fullHouseIsPlayable(s) && !selected(ui, 'fullHouse'),
    { highlightTargets: [hand('fullHouse'), die(1), die(2), die(3), die(4), die(5)], interactiveTargets: [hand('fullHouse')], completion: { kind: 'selection', description: 'Full House selected' }, recoveryBeatId: R.r2FullHouse }),
  required(R.r2FullHouse, 'PLAY FULL HOUSE', ['The trained hand is ready.'], PLAY, 'Play Full House.',
    (s, ui) => s.game.round === 2 && s.game.phase === 'round' && has(s, 'c1-r2-nice') && !has(s, R.r2FullHouse)
      && fullHouseIsPlayable(s) && selected(ui, 'fullHouse'),
    { highlightTargets: [hand('fullHouse'), PLAY], interactiveTargets: [PLAY] }),
  info('c1-r2-bonus-trigger', BONUS_UPPER, [`That enhanced face scored, so ${BONUS} added +10 Pips.`], '[data-tutorial="die-2"]',
    s => s.game.round === 2 && (s.game.stats.triggers.bonus ?? 0) > 0, { contextual: true, side: 'top' }),

  info('c1-mini-boss', 'MINI-BOSS', ['Round 3 has a Mini-Boss. Each one changes the rules for this Round.'], '[data-tutorial="boss"]',
    s => s.game.round === 3 && s.game.phase === 'round'),
  info('c1-capital-return', 'CAPITAL RETURN', ['Playing a Lower hand costs 1 Gold this Round.'], '[data-tutorial="boss"]',
    s => s.game.round === 3 && s.game.phase === 'round' && has(s, 'c1-mini-boss')),
  info('c1-special-offer', 'SPECIAL OFFER', ['After beating a Mini-Boss, you get to claim one of three rewards.', 'Read the descriptions and pick your favorite.'], '[data-tutorial="special-offers"]',
    s => s.game.round === 3 && s.game.phase === 'specialOffer' && !s.game.specialOffer?.acquired),
  info('c1-special-confirm', undefined, [], '[data-tutorial="special-offers"]', s => s.game.round === 3 && s.game.phase === 'specialOffer' && !!s.game.specialOffer?.acquired),

  info('shop-r4-workout-info', WORKOUT_UPPER, [`Some Enhancements grow over time. When this face scores, ${WORKOUT} permanently gives it +1 Pip.`], '[data-tutorial="enhancement-workout"]',
    s => s.game.phase === 'shop' && s.game.round === 3),
  required('shop-r4-select-workout', `BUY ${WORKOUT_UPPER}`, [`Select ${WORKOUT}.`], '[data-tutorial="enhancement-workout"] .offer-action', `Select ${WORKOUT}.`,
    (s, ui) => s.game.phase === 'shop' && s.game.round === 3 && has(s, 'shop-r4-workout-info') && !has(s, R.workout) && !selectedEnhancement(s, ui, 'workout'),
    { highlightTargets: ['[data-tutorial="enhancement-workout"]'], interactiveTargets: ['[data-tutorial="enhancement-workout"] .offer-action'],
      completion: { kind: 'selection', description: 'Workout selected' }, recoveryBeatId: R.workout }),
  required(R.workout, `PLACE ${WORKOUT_UPPER}`, ['Put it on the highlighted face.'], die(1), 'Choose the highlighted die.',
    (s, ui) => s.game.phase === 'shop' && s.game.round === 3 && has(s, 'shop-r4-workout-info') && !has(s, R.workout)
      && !!s.scenario.workoutBinding && selectedEnhancement(s, ui, 'workout'),
    { highlightTargets: ['[data-tutorial="enhancement-workout"]', die(1)], interactiveTargets: [die(1)] }),
  info('c1-r4-familiar', 'LOOK FAMILIAR?', ['We already have Two Pair again.', `Play the matching Upper hand and let the ${WORKOUT} face reroll.`], '[data-tutorial="die-1"]',
    s => s.game.round === 4 && s.game.phase === 'round' && planIsPlayable(s, s.scenario.round4Plan), { side: 'top', highlightTargets: [hand('twos'), die(1)] }),
  required('c1-r4-select-twos', undefined, [`Play the matching Upper hand and let the ${WORKOUT} face reroll.`], hand('twos'), 'Select the matching Upper hand.',
    (s, ui) => s.game.round === 4 && s.game.phase === 'round' && has(s, 'c1-r4-familiar') && !has(s, R.r4Twos)
      && !!s.scenario.round4Plan && !planSelected(ui, s.scenario.round4Plan),
    { highlightTargets: [hand('twos'), die(1)], interactiveTargets: [hand('twos')], completion: { kind: 'selection', description: 'Workout Twos selected' }, recoveryBeatId: R.r4Twos }),
  required(R.r4Twos, 'PLAY THE UPPER HAND', [`Let the ${WORKOUT} face reroll.`], PLAY, `Play the matching Upper hand with the ${WORKOUT} die.`,
    (s, ui) => s.game.round === 4 && s.game.phase === 'round' && has(s, 'c1-r4-familiar') && !has(s, R.r4Twos)
      && !!s.scenario.round4Plan && planSelected(ui, s.scenario.round4Plan),
    { highlightTargets: [hand('twos'), die(1), PLAY], interactiveTargets: [PLAY] }),
  info('c1-r4-workout-result', WORKOUT_UPPER, ['That face scored, so its Pips increased permanently.', 'That physical face will now be worth more Pips whenever it shows again.'], '[data-tutorial="die-1"]',
    s => s.game.round === 4 && s.game.phase === 'round' && has(s, R.r4Twos) && !!s.scenario.workoutBinding, { side: 'top' }),
  required('c1-r4-select-full-house', 'FULL HOUSE AGAIN', ['The reroll completed it. Select the hand we trained earlier.'], hand('fullHouse'), 'Select Full House.',
    (s, ui) => s.game.round === 4 && s.game.phase === 'round' && has(s, 'c1-r4-workout-result') && !has(s, R.r4FullHouse)
      && fullHouseIsPlayable(s) && !selected(ui, 'fullHouse'),
    { highlightTargets: [hand('fullHouse'), die(1), die(2), die(3), die(4), die(5)], interactiveTargets: [hand('fullHouse')], completion: { kind: 'selection', description: 'Full House selected' }, recoveryBeatId: R.r4FullHouse }),
  required(R.r4FullHouse, 'PLAY FULL HOUSE', ['The trained hand is ready.'], PLAY, 'Play Full House.',
    (s, ui) => s.game.round === 4 && s.game.phase === 'round' && has(s, 'c1-r4-workout-result') && !has(s, R.r4FullHouse)
      && fullHouseIsPlayable(s) && selected(ui, 'fullHouse'),
    { highlightTargets: [hand('fullHouse'), PLAY], interactiveTargets: [PLAY] }),

  info('c1-boss-intro', 'BOSS', ['Round 6 ends the Chapter with a Boss. Bosses can change the rules in bigger ways.'], '[data-tutorial="boss"]',
    s => s.game.round === 6 && s.game.phase === 'round'),
  info('c1-quickdraw', 'QUICKDRAW', ['The Goal is lower, but you only get one Lower hand this Round. Choose it carefully.'], '[data-tutorial="boss"]',
    s => s.game.round === 6 && s.game.phase === 'round' && has(s, 'c1-boss-intro')),
  info('flame-selection-1', 'FLAME SELECTION', ['After beating a Boss, you get to choose a Flame.', 'Read the descriptions and pick the one you like best.'], '[data-tutorial="flame-offers"]',
    s => s.game.round === 6 && s.game.phase === 'flameSelection' && !s.game.flameSelection?.acquired),
  required('flame-select-first', 'CHOOSE A FLAME', ['Select the Flame you want.'], '.flame-offer-action', 'Select a Flame.',
    (s, ui) => s.game.round === 6 && s.game.phase === 'flameSelection' && has(s, 'flame-selection-1') && !s.game.flameSelection?.acquired && ui.selectedFlameOffer === null,
    { highlightTargets: ['[data-testid^="flame-offer-"]'], interactiveTargets: ['.flame-offer-action'],
      completion: { kind: 'selection', description: 'Flame selected' } }),
  required('flame-assign-first', 'ASSIGN YOUR FLAME', ['Put the Flame on any die you like.'], '[data-tutorial="dice-dock"] .die', 'Choose a die.',
    (s, ui) => s.game.round === 6 && s.game.phase === 'flameSelection' && !s.game.flameSelection?.acquired && ui.selectedFlameOffer !== null,
    { highlightTargets: ['[data-testid^="flame-offer-"].selected', '[data-tutorial="dice-dock"] .die'], interactiveTargets: ['[data-tutorial="dice-dock"] .die'] }),
  info('flame-basics', 'FLAMES', ['Enhancements belong to faces. Flames belong to whole dice.', 'Flames can add XMult when their condition is met.'], '[data-tutorial="dice-dock"]',
    s => s.game.round === 6 && s.game.phase === 'flameSelection' && !!s.game.flameSelection?.acquired, { side: 'top' }),
  info('flame-xmult', 'XMULT', ['XMult multiplies your score after Pips and Mult.', 'Pips × Mult × XMult'], '[data-tutorial="flame-cap"]',
    s => s.game.round === 6 && has(s, 'flame-basics'), { side: 'top' }),
  info('flame-ember', undefined, ["While it's an Ember, its effect only works when that die scores in the right hand."], '[data-tutorial="flame-cap"]',
    s => s.game.round === 6 && has(s, 'flame-xmult'), { side: 'top' }),
  required('flame-details', undefined, ['Tap your Flame to see its details.'], '[data-tutorial="flame-cap"]', 'Open the Flame details.',
    s => s.game.phase === 'shop' && s.game.round === 6 && !!s.scenario.firstFlame),
  required('flame-stoke', 'STOKE', ["Investing Gold makes a Flame's XMult effect stronger.", 'Stoke it once so you can see the effect grow.'], '[data-tutorial="stoke"]',
    'Stoke the Flame once.', (s, ui) => s.game.phase === 'shop' && s.game.round === 6 && has(s, 'flame-details') && ui.flameDetailsOpen && s.game.stats.flameStokes.length === 0,
    { side: 'right', highlightTargets: ['[data-tutorial="stoke"]'], interactiveTargets: ['[data-tutorial="stoke"] button', '[data-tutorial="stoke"] input'] }),
  info('bonfire-explainer', 'BONFIRES', ['At 100 Gold, an Ember becomes a Bonfire.', 'Bonfires are global, so the Flame no longer needs its original die to score.', "Becoming a Bonfire also frees that die's Flame slot."], '[data-tutorial="flame-cap"]',
    s => s.game.phase === 'shop' && s.game.round === 6 && s.game.stats.flameStokes.length > 0, { side: 'top' }),

  info('chapter-2', 'CHAPTER 2', ["You've got the basics. I'll give you more room to make your own choices now."], undefined,
    s => s.game.round === 7),
  required('c2-r1-setup-select', undefined, [], '[data-tutorial="scorecard"]', 'Select the marked setup hand.',
    (s, ui) => s.game.round === 7 && s.game.phase === 'round' && has(s, 'chapter-2') && s.scenario.firstFlame !== 'minigun'
      && !has(s, R.flameDemoSetup) && !flameSelectionReady(s, ui, false),
    { completion: { kind: 'selection', description: 'Setup hand selected' }, recoveryBeatId: R.flameDemoSetup }),
  required(R.flameDemoSetup, undefined, [], PLAY, 'Play the marked setup hand.',
    (s, ui) => s.game.round === 7 && s.game.phase === 'round' && has(s, 'chapter-2') && s.scenario.firstFlame !== 'minigun'
      && !has(s, R.flameDemoSetup) && flameSelectionReady(s, ui, false), { interactiveTargets: [PLAY] }),
  required('c2-r1-payoff-select', undefined, [], '[data-tutorial="scorecard"]', 'Select the payoff hand with the Flame die.',
    (s, ui) => s.game.round === 7 && s.game.phase === 'round' && has(s, 'chapter-2')
      && (s.scenario.firstFlame === 'minigun' || has(s, R.flameDemoSetup)) && !has(s, R.flameDemoPayoff) && !flameSelectionReady(s, ui, true),
    { completion: { kind: 'selection', description: 'Payoff hand selected' }, recoveryBeatId: R.flameDemoPayoff }),
  required(R.flameDemoPayoff, undefined, [], PLAY, 'Play the payoff hand with the Flame die.',
    (s, ui) => s.game.round === 7 && s.game.phase === 'round' && has(s, 'chapter-2')
      && (s.scenario.firstFlame === 'minigun' || has(s, R.flameDemoSetup)) && !has(s, R.flameDemoPayoff) && flameSelectionReady(s, ui, true),
    { interactiveTargets: [PLAY] }),
  info('c2-juggler', 'THE JUGGLER', ['After every hand, one extra die rerolls.', 'Watch how it changes the board.'], '[data-tutorial="boss"]',
    s => s.game.round === 9 && s.game.phase === 'round'),
  info('c2-special-offer', 'LOOK AT YOUR BUILD', ['These rewards can strengthen things you already own.', 'Read all three and pick what fits your build.'], '[data-tutorial="special-offers"]',
    s => s.game.round === 9 && s.game.phase === 'specialOffer' && !s.game.specialOffer?.acquired),
  info('c2-special-confirm', undefined, [], '[data-tutorial="special-offers"]',
    s => s.game.round === 9 && s.game.phase === 'specialOffer' && !!s.game.specialOffer?.acquired),
  info('c2-warden', 'THE WARDEN', ['You start with one die. Score enough to unlock the rest.', "Locked dice keep their faces and build. You'll get them back as you score."], '[data-tutorial="boss"]',
    s => s.game.round === 12 && s.game.phase === 'round'),
  info('flame-selection-2', 'LOOK FOR SYNERGIES', ['Your build is starting to take shape.', 'See if one of these Flames works especially well with what you already have.'], '[data-tutorial="flame-offers"]',
    s => s.game.round === 12 && s.game.phase === 'flameSelection' && !s.game.flameSelection?.acquired),
  info('flame-synergy-hint', undefined, [], '[data-tutorial="recommended-flame"]',
    s => s.game.round === 12 && s.game.phase === 'flameSelection' && !s.game.flameSelection?.acquired && has(s, 'flame-selection-2')),
  info('build-synergies', 'BUILD SYNERGIES', ['Hand Training, Enhancements, Flames, and rewards can all reinforce each other.', 'There are a lot of combinations to discover.'], '[data-tutorial="dice-dock"]',
    s => s.game.round === 12 && s.game.phase === 'flameSelection' && !!s.game.flameSelection?.acquired, { side: 'top' }),
  info('curriculum-complete', "YOU'VE GOT THE BASICS", ['From here, play it your way.', "I'll only pop in when something new is worth calling out."], undefined,
    s => s.game.round > 12 || s.scenario.structuredCurriculumComplete),

  info('context-interest', 'INTEREST', ['Holding Gold can earn you more Gold at the end of a Round.', 'You get +1 Gold for every 5 Gold you hold, up to +10.', 'Spend now to improve your build, or save and earn more later.'], '[data-tutorial="payout-interest"]',
    s => !seen(s, 'interest') && s.game.phase === 'roundSummary' && (s.game.roundSummary?.sources.interestGold ?? 0) > 0, { contextual: true }),
  info('context-bust', 'BUST', ['Busting costs a Life. If you still have Lives left, you get another shot at the Round.'], '[data-tutorial="lives"]',
    s => !seen(s, 'bust') && s.game.phase === 'shop' && !!s.game.bust && s.game.lives > 0, { contextual: true }),
  info('context-restore-lives', 'RESTORE LIVES', ['You can buy lost Lives back here in the Shop.'], '[data-tutorial="lives"]',
    s => s.game.phase === 'shop' && !!s.game.bust && has(s, 'context-bust'), { contextual: true }),
  info('context-selling', 'NEED GOLD?', [], '[data-tutorial="enhancements"]',
    s => !seen(s, 'selling') && s.game.phase === 'shop' && !!s.game.bust, { contextual: true }),
  info('context-care-package', 'CARE PACKAGE', [], '[data-tutorial="reroll-button"]',
    s => !seen(s, 'care-package') && s.game.phase === 'round' && s.game.manualRerollsRemaining === 0 && s.game.specialOfferEffects.carePackageRerolls > 0,
    { contextual: true, side: 'top' }),
  info('context-persistent', 'SPECIAL EFFECT', ['Some Special Offers last across multiple Rounds.', 'You can check active effects here.'], '[data-tutorial="special-offer-status"]',
    s => !seen(s, 'persistent-effect') && activeSpecialOfferStatusItems(s.game.specialOfferEffects).length > 0
      && !(s.game.manualRerollsRemaining === 0 && s.game.specialOfferEffects.carePackageRerolls > 0), { contextual: true }),
  info('context-bonfire', 'BONFIRE', ['Nice. That Flame is fully stoked now.', "Its effect is global, so it can work even when the original die doesn't score.", "That die's Flame slot is free again too."], '[data-tutorial="bonfires"]',
    s => !seen(s, 'bonfire') && s.game.bonfires.length > 0, { contextual: true }),
  info('context-later-boss', 'NEW BOSS', ['Check its rule here before you make your first move.'], '[data-tutorial="boss"]',
    s => !seen(s, 'later-boss') && s.game.round > 12 && s.game.phase === 'round' && !!s.game.boss
      && !['capitalReturn', 'quickdraw', 'juggler', 'warden'].includes(s.game.boss.type), { contextual: true }),
  info('context-safeguard', 'KEEP GOING', ['Your final Life is safe during the guided Chapters.', 'Used hands are refreshed, you have 3 Rerolls, and this encounter rule is disabled.'], '[data-tutorial="reroll-button"]',
    s => !seen(s, 'safeguard') && s.scenario.safeguardActivations > 0, { contextual: true, side: 'top' }),
  info('tutorial-run-over', 'RUN OVER', ['Every run gives you different options and challenges you in different ways.', 'I hope you enjoy playing Roll Call!'], undefined,
    s => s.game.phase === 'lost', { actionLabel: 'BACK TO TITLE' }),
];

function contextualCopy(beat: TutorialBeat, session: TutorialSession): TutorialBeat {
  if (beat.id === R.bonus && session.scenario.bonusBinding) {
    const binding = session.scenario.bonusBinding;
    const target = die(binding.dieId + 1);
    return {
      ...beat,
      body: [`Put ${BONUS} on this ${binding.faceRank}.`],
      target,
      requiredAction: `Choose D${binding.dieId + 1} showing ${binding.faceRank}.`,
      highlightTargets: ['[data-tutorial="enhancement-bonus"]', target],
      interactiveTargets: [target],
    };
  }
  if (['c1-r2-two-pair', 'c1-r2-choice', 'c1-r2-select-twos', R.r2Twos, 'c1-r2-nice'].includes(beat.id)
    && session.scenario.round2Plan) {
    const plan = session.scenario.round2Plan;
    const upperName = HANDS[plan.upperHand].name;
    const upperTarget = hand(plan.upperHand);
    const singletonTarget = die(plan.singletonDieId + 1);
    if (beat.id === 'c1-r2-two-pair') return {
      ...beat, highlightTargets: [hand('twoPair'), hand('fullHouse'), singletonTarget],
    };
    if (beat.id === 'c1-r2-choice') return {
      ...beat,
      body: [`You could spend a Reroll on this ${plan.singletonRank}, or play ${upperName} and let it reroll after scoring.`],
      target: singletonTarget,
      highlightTargets: [singletonTarget, upperTarget, REROLL],
    };
    if (beat.id === 'c1-r2-select-twos') return {
      ...beat,
      body: [`Play ${upperName}.`],
      target: upperTarget,
      requiredAction: `Select ${upperName}.`,
      highlightTargets: [upperTarget, singletonTarget],
      interactiveTargets: [upperTarget],
    };
    if (beat.id === R.r2Twos) return {
      ...beat,
      title: `PLAY ${upperName.toUpperCase()}`,
      body: [`Let this ${plan.singletonRank} reroll after scoring.`],
      requiredAction: `Play ${upperName} with D${plan.singletonDieId + 1}.`,
      highlightTargets: [upperTarget, singletonTarget, PLAY],
      interactiveTargets: [PLAY],
    };
    return { ...beat, body: [`Playing ${upperName} rerolled that die for free, and now we have Full House.`] };
  }
  if (beat.id === 'c1-r2-bonus-trigger' && session.scenario.bonusBinding) {
    const binding = session.scenario.bonusBinding;
    return {
      ...beat,
      body: [`That ${binding.faceRank} scored, so ${BONUS} added +10 Pips.`],
      target: die(binding.dieId + 1),
      highlightTargets: [die(binding.dieId + 1)],
    };
  }
  if (beat.id === R.workout && session.scenario.workoutBinding) {
    const binding = session.scenario.workoutBinding;
    const target = die(binding.dieId + 1);
    return {
      ...beat,
      body: [`Put it on this ${binding.faceRank}.`],
      target,
      requiredAction: `Choose D${binding.dieId + 1} showing ${binding.faceRank}.`,
      highlightTargets: ['[data-tutorial="enhancement-workout"]', target],
      interactiveTargets: [target],
    };
  }
  if (['c1-r4-familiar', 'c1-r4-select-twos', R.r4Twos, 'c1-r4-workout-result'].includes(beat.id)
    && session.scenario.round4Plan && session.scenario.workoutBinding) {
    const plan = session.scenario.round4Plan;
    const binding = session.scenario.workoutBinding;
    const upperName = HANDS[plan.upperHand].name;
    const upperTarget = hand(plan.upperHand);
    const workoutTarget = die(plan.singletonDieId + 1);
    if (beat.id === 'c1-r4-familiar') return {
      ...beat,
      body: ['We already have Two Pair again.', `Play ${upperName} and let the ${WORKOUT} face reroll.`],
      target: workoutTarget,
      highlightTargets: [upperTarget, workoutTarget],
    };
    if (beat.id === 'c1-r4-select-twos') return {
      ...beat,
      body: [`Play ${upperName} and let the ${WORKOUT} face reroll.`],
      target: upperTarget,
      requiredAction: `Select ${upperName}.`,
      highlightTargets: [upperTarget, workoutTarget],
      interactiveTargets: [upperTarget],
    };
    if (beat.id === R.r4Twos) return {
      ...beat,
      title: `PLAY ${upperName.toUpperCase()}`,
      requiredAction: `Play ${upperName} with the ${WORKOUT} die.`,
      highlightTargets: [upperTarget, workoutTarget, PLAY],
      interactiveTargets: [PLAY],
    };
    const face = session.game.dice.find(candidate => candidate.id === binding.dieId)?.faces
      .find(candidate => candidate.rank === binding.faceRank);
    const pips = binding.faceRank + (face?.workoutPips ?? 0);
    return {
      ...beat,
      body: ['That face scored, so its Pips increased permanently.',
        `This physical ${binding.faceRank} will now be worth ${pips} Pips whenever it shows again.`],
      target: workoutTarget,
      highlightTargets: [workoutTarget],
    };
  }
  if (beat.id === 'c1-special-confirm') {
    const offer = session.game.specialOffer?.chosen;
    const body = offer?.type === 'carePackage' ? ['Those extra Rerolls carry over until you use them.']
      : offer?.type === 'focus' ? ['Full House just got a big training boost.']
        : ["Your next Shop's initial offers are free."];
    return { ...beat, body };
  }
  if (beat.id === 'c2-special-confirm') {
    const type = session.game.specialOffer?.chosen?.type;
    const body = type === 'orangeTheory' ? [`Every ${WORKOUT} stack just got stronger.`]
      : type === 'cashBonus' ? [`${BONUS} can now earn extra Gold for the next 3 Rounds.`]
        : ['Your Ember just moved halfway closer to Bonfire.'];
    return { ...beat, body };
  }
  if (['c2-r1-setup-select', R.flameDemoSetup, 'c2-r1-payoff-select', R.flameDemoPayoff].includes(beat.id)) {
    const flame = session.scenario.firstFlame;
    const setup = beat.id === 'c2-r1-setup-select' || beat.id === R.flameDemoSetup;
    const selecting = beat.id.endsWith('-select');
    const selectedHand = flameDemoHand(session, !setup);
    const handTarget = hand(selectedHand);
    const flameTarget = session.scenario.firstFlameDieId === null ? '[data-tutorial="flame-cap"]' : die(session.scenario.firstFlameDieId + 1);
    const title = flame === 'doubleDown' ? (setup ? 'DOUBLE DOWN' : "NOW IT'S READY")
      : flame === 'straightShooter' ? (setup ? 'STRAIGHT SHOOTER' : "NOW IT'S READY") : 'MINIGUN';
    const body = flame === 'doubleDown' ? (setup
      ? [`Pair is marked because it sets up your Flame. ${selecting ? 'Select' : 'Play'} Pair first.`]
      : ['Two Pair is the payoff.', 'Include the die carrying Double Down so its XMult can apply.'])
      : flame === 'straightShooter' ? (setup
        ? [`Small Straight is marked because it sets up your Flame. ${selecting ? 'Select' : 'Play'} it first.`]
        : ['Large Straight is the payoff.', 'Include the die carrying Straight Shooter so its XMult can apply.'])
        : ['Any Upper hand can trigger this Flame.', `${selecting ? 'Select' : 'Play'} an Upper hand with the die carrying Minigun and you'll get some extra XMult.`];
    return {
      ...beat,
      title,
      body,
      target: selecting ? handTarget : PLAY,
      highlightTargets: [handTarget, flameTarget, ...(selecting ? [] : [PLAY])],
      interactiveTargets: selecting ? [handTarget, flameTarget] : [PLAY],
    };
  }
  if (beat.id === 'flame-synergy-hint') {
    const flame = session.scenario.firstFlame;
    const body = flame === 'doubleDown' ? ['Missing Pair strengthens Pair, and Pair is what sets up Double Down.']
      : flame === 'straightShooter' ? ['One Short strengthens Small Straight, and Small Straight sets up Straight Shooter.']
        : ["You trained Full House back in Chapter 1. Three's Company gives you another way to build around it."];
    return { ...beat, body };
  }
  if (beat.id === 'context-care-package') return { ...beat, body: [
    `Your normal Rerolls are gone, but Care Package still has ${session.game.specialOfferEffects.carePackageRerolls} left.`,
    'These extra Rerolls carry over until you use them.',
  ] };
  if (beat.id === 'context-selling') {
    const vintage = session.game.dice.some(die => die.faces.some(face => (face.enhancements.vintage ?? 0) > 0));
    return { ...beat, body: vintage
      ? [`That ${VINTAGE} face has been building sell value.`, 'You can sell it, or other Enhancements, to free up Gold and rework your build.']
      : ['You can sell Enhancements from your dice to free up Gold and rework your build.'] };
  }
  return beat;
}

export function activeTutorialBeat(session: TutorialSession, ui: TutorialUiState = EMPTY_UI): TutorialBeat | null {
  for (const candidate of candidates) {
    if (has(session, candidate.id)) continue;
    if (!candidate.when(session, ui)) continue;
    return normalizeTutorialBeatTargets(contextualCopy(candidate, session));
  }
  return null;
}

export function tutorialActionHint(session: TutorialSession): string | null {
  const beat = activeTutorialBeat(session);
  return beat?.requiredAction ?? null;
}

export const taughtBosses = new Set(['capitalReturn', 'quickdraw', 'juggler', 'warden']);
export const tutorialHandName = (hand: keyof typeof HANDS) => HANDS[hand].name;
