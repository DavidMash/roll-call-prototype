import { HANDS } from '../game/hands';
import { activeSpecialOfferStatusItems } from '../game/specialOffers';
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
const flameCard = (instanceId?: number | null) => instanceId === null || instanceId === undefined
  ? '[data-testid^="fire-keeping-flame-"]'
  : `[data-testid="fire-keeping-flame-${instanceId}"]`;
const activeFlame = (instanceId?: number | null) => instanceId === null || instanceId === undefined
  ? '[data-testid^="active-flame-"]'
  : `[data-testid="active-flame-${instanceId}"]`;
const hand = (id: HandId) => `[data-testid="scorecard-row-${id}"]`;
const PLAY = '[data-tutorial="play-action"]';
const REROLL = '[data-tutorial="reroll-button"]';
const selected = (ui: TutorialUiState, selectedHand: HandId, dieIds?: number[]) =>
  ui.selection.hand === selectedHand
  && (!dieIds || (ui.selection.dieIds.length === dieIds.length && dieIds.every(id => ui.selection.dieIds.includes(id))));
const flameDemoHand = (session: TutorialSession, payoff: boolean): HandId => {
  if (session.scenario.firstFlame === 'doubleDown') return payoff ? 'twoPair' : 'pair';
  if (session.scenario.firstFlame === 'straightShooter') return payoff ? 'largeStraight' : 'smallStraight';
  return 'sixes';
};
const flameSelectionReady = (session: TutorialSession, ui: TutorialUiState, payoff: boolean) => {
  return selected(ui, flameDemoHand(session, payoff));
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
  info('c1-r1-payout', 'ROUND PAYOUT', ['Clearing a Round earns Gold. You also get +1 Gold for every Reroll you have left.'], '[data-tutorial="payout"]',
    s => s.game.round === 1 && s.game.phase === 'roundSummary' && has(s, R.threeKind)),
  info('c1-r1-payout-rerolls', undefined, ['You used one Reroll, so the other two earned you 2 extra Gold.'], '[data-tutorial="payout-rerolls"]',
    s => s.game.round === 1 && s.game.phase === 'roundSummary' && has(s, 'c1-r1-payout')),
  required('shop1-to-training', 'SHOP SECTIONS', ['Start with Dice, then continue when you are ready to spend on Training.'], '[data-testid="shop-stage-continue"]',
    'Continue to Train.', s => s.game.phase === 'shop' && s.game.round === 1 && s.game.shop?.stage === 'shop'),
  info('shop1-training', 'HAND TRAINING', ['Every hand can be Trained. Training gets more expensive when a hand rises above the rest of its section.', 'Upper and Lower hands are compared separately, so a balanced scorecard stays affordable.'], '[data-tutorial="hand-training"]',
    s => s.game.phase === 'shop' && s.game.round === 1 && s.game.shop?.stage === 'train'),
  required(R.training, undefined, ["Let's train Full House so it's stronger when we find one."], '[data-tutorial="training-fullHouse"] .training-action',
    'Train Full House once.', s => s.game.phase === 'shop' && s.game.round === 1 && has(s, 'shop1-training'),
    { highlightTargets: ['[data-tutorial="training-fullHouse"]'], interactiveTargets: ['[data-tutorial="training-fullHouse"] .training-action'] }),
  info('shop1-training-result', 'FULL HOUSE · LV. 2', ['Its Base Pips and Mult are both higher now.'], '[data-tutorial="training-fullHouse"]',
    s => s.game.phase === 'shop' && s.game.round === 1 && has(s, R.training)),
  required('shop1-next-round', 'NEXT ROUND', ['You have no Flames to tend yet, so Training is the last stop in this Shop.'], '[data-testid="shop-progression-action"]',
    'Start the next Round.', s => s.game.phase === 'shop' && s.game.round === 1 && s.game.shop?.stage === 'train'
      && has(s, 'shop1-training-result')),
  info('c1-mini-boss', 'MINI-BOSS', ['Round 3 has a Mini-Boss. Each one changes the rules for this Round.'], '[data-tutorial="boss"]',
    s => s.game.round === 3 && s.game.phase === 'round'),
  info('c1-capital-return', 'CAPITAL RETURN', ['Playing a Lower hand costs 1 Gold this Round.'], '[data-tutorial="boss"]',
    s => s.game.round === 3 && s.game.phase === 'round' && has(s, 'c1-mini-boss')),
  info('c1-special-offer', 'SPECIAL OFFER', ['After beating a Mini-Boss, you get to claim one of three rewards.', 'Read the descriptions and pick your favorite.'], '[data-tutorial="special-offers"]',
    s => s.game.round === 3 && s.game.phase === 'specialOffer' && !s.game.specialOffer?.acquired),
  info('c1-special-confirm', undefined, [], '[data-tutorial="special-offers"]', s => s.game.round === 3 && s.game.phase === 'specialOffer' && !!s.game.specialOffer?.acquired),


  info('c1-boss-intro', 'BOSS', ['Round 6 ends the Chapter with a Boss. Bosses can change the rules in bigger ways.'], '[data-tutorial="boss"]',
    s => s.game.round === 6 && s.game.phase === 'round'),
  info('c1-quickdraw', 'THE MAGICIAN', ['One die has disappeared. Complete the three called Upper hands to bring it back.'], '[data-tutorial="boss"]',
    s => s.game.round === 6 && s.game.phase === 'round' && has(s, 'c1-boss-intro')),
  info('flame-selection-1', 'FLAME SELECTION', ['After beating a Boss, you get to choose a Flame.', 'Read the descriptions and pick the one you like best.'], '[data-tutorial="flame-offers"]',
    s => s.game.round === 6 && s.game.phase === 'flameSelection' && !s.game.flameSelection?.acquired),
  required('flame-select-first', 'CHOOSE A FLAME', ['Select the Flame you want.'], '.flame-offer-action', 'Select a Flame.',
    s => s.game.round === 6 && s.game.phase === 'flameSelection' && has(s, 'flame-selection-1') && !s.game.flameSelection?.acquired,
    { highlightTargets: ['[data-testid^="flame-offer-"]'], interactiveTargets: ['.flame-offer-action', '.flame-offer-info'] }),
  required('flame-shop-to-training', 'RETURN TO THE SHOP', ['Review Dice first, then continue to Training.'], '[data-testid="shop-stage-continue"]',
    'Continue through the Shop.', s => s.game.round === 6 && s.game.phase === 'shop' && s.game.shop?.stage === 'shop' && !!s.scenario.firstFlame),
  required('flame-shop-to-fire-keeping', 'FIRE KEEPING', ['This is where you invest in the Flame you just earned.'], '[data-testid="shop-stage-continue"]',
    'Continue to Flames.', s => s.game.round === 6 && s.game.phase === 'shop' && s.game.shop?.stage === 'train' && !!s.scenario.firstFlame),
  info('flame-basics', 'FLAMES', ['Flames boost your score with XMult.', 'Each Flame tells you exactly when it helps.'], '[data-tutorial="flames"]',
    s => s.game.round === 6 && s.game.phase === 'shop' && s.game.shop?.stage === 'flames'
      && !!s.scenario.firstFlame && !s.game.flameTutorial.completed, { side: 'top' }),
  info('flame-xmult', 'XMULT', ['XMult multiplies your score after Pips and Mult.', 'Pips × Mult × XMult'], flameCard(),
    s => s.game.round === 6 && has(s, 'flame-basics'), { side: 'top' }),
  info('flame-ember', undefined, ['Meet the condition on a Flame to gain its XMult.'], flameCard(),
    s => s.game.round === 6 && has(s, 'flame-xmult'), { side: 'top' }),
  required('flame-details', undefined, ['Tap your Flame to see its details.'], flameCard(), 'Open the Flame details.',
    s => s.game.phase === 'shop' && s.game.shop?.stage === 'flames' && s.game.round === 6 && !!s.scenario.firstFlame && !s.game.flameTutorial.completed,
    { gateInteractions: false }),
  required('flame-stoke', 'STOKE', ["Investing Gold makes a Flame's XMult effect stronger.", 'Stoke it once so you can see the effect grow.'], '[data-tutorial="stoke"]',
    'Stoke the Flame once.', (s, ui) => s.game.phase === 'shop' && s.game.round === 6 && has(s, 'flame-details') && ui.flameDetailsOpen && s.game.stats.flameStokes.length === 0,
    { side: 'right', highlightTargets: ['[data-tutorial="stoke"]'], interactiveTargets: ['[data-tutorial="stoke"] button'] }),
  info('bonfire-explainer', 'BONFIRES', ['At 100 Gold, an Ember becomes a Bonfire.', 'It remains yours and reaches full strength.'], flameCard(),
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
  required('c2-r1-payoff-select', undefined, [], '[data-tutorial="scorecard"]', 'Select the Flame payoff hand.',
    (s, ui) => s.game.round === 7 && s.game.phase === 'round' && has(s, 'chapter-2')
      && (s.scenario.firstFlame === 'minigun' || has(s, R.flameDemoSetup)) && !has(s, R.flameDemoPayoff) && !flameSelectionReady(s, ui, true),
    { completion: { kind: 'selection', description: 'Payoff hand selected' }, recoveryBeatId: R.flameDemoPayoff }),
  required(R.flameDemoPayoff, undefined, [], PLAY, 'Play the Flame payoff hand.',
    (s, ui) => s.game.round === 7 && s.game.phase === 'round' && has(s, 'chapter-2')
      && (s.scenario.firstFlame === 'minigun' || has(s, R.flameDemoSetup)) && !has(s, R.flameDemoPayoff) && flameSelectionReady(s, ui, true),
    { interactiveTargets: [PLAY] }),
  info('c2-juggler', 'QUICKDRAW', ['Your first Lower hand scores normally. Later Lower hands score at ×0.25.'], '[data-tutorial="boss"]',
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
  info('build-synergies', 'BUILD SYNERGIES', ['Dice, Hand Training, Flames, and rewards can all reinforce each other.', 'There are a lot of combinations to discover.'], '[data-tutorial="dice-dock"]',
    s => s.game.round === 12 && s.game.phase === 'flameSelection' && !!s.game.flameSelection?.acquired, { side: 'top' }),
  info('curriculum-complete', "YOU'VE GOT THE BASICS", ['From here, play it your way.', "I'll only pop in when something new is worth calling out."], undefined,
    s => s.game.round > 12 || s.scenario.structuredCurriculumComplete),

  info('context-interest', 'INTEREST', ['Holding Gold can earn you more Gold at the end of a Round.', 'You get +1 Gold for every 5 Gold you hold, up to +10.', 'Spend now to improve your build, or save and earn more later.'], '[data-tutorial="payout-interest"]',
    s => !seen(s, 'interest') && s.game.phase === 'roundSummary' && (s.game.roundSummary?.sources.interestGold ?? 0) > 0, { contextual: true }),
  info('context-bust', 'BUST', ['Busting costs a Life. If you still have Lives left, you get another shot at the Round.'], '[data-tutorial="lives"]',
    s => !seen(s, 'bust') && s.game.phase === 'shop' && !!s.game.bust && s.game.lives > 0, { contextual: true }),
  info('context-restore-lives', 'RESTORE LIVES', ['You can buy lost Lives back here in the Shop.'], '[data-tutorial="lives"]',
    s => s.game.phase === 'shop' && !!s.game.bust && has(s, 'context-bust'), { contextual: true }),
  info('context-selling', 'NEED GOLD?', ['You can sell collectible dice from Roster or Storage to free up Gold and reshape your build.'], '[data-tutorial="dice-collection"]',
    s => !seen(s, 'selling') && s.game.phase === 'shop' && !!s.game.bust, { contextual: true }),
  info('context-care-package', 'CARE PACKAGE', [], '[data-tutorial="reroll-button"]',
    s => !seen(s, 'care-package') && s.game.phase === 'round' && s.game.manualRerollsRemaining === 0 && s.game.specialOfferEffects.carePackageRerolls > 0,
    { contextual: true, side: 'top' }),
  info('context-persistent', 'SPECIAL EFFECT', ['Some Special Offers last across multiple Rounds.', 'You can check active effects here.'], '[data-tutorial="special-offer-status"]',
    s => !seen(s, 'persistent-effect') && activeSpecialOfferStatusItems(s.game.specialOfferEffects).length > 0
      && !(s.game.manualRerollsRemaining === 0 && s.game.specialOfferEffects.carePackageRerolls > 0), { contextual: true }),
  info('context-bonfire', 'BONFIRE', ['Nice. That Flame is fully stoked now.', 'It now grants its full effect whenever you meet its condition.'], '[data-tutorial="flames"]',
    s => !seen(s, 'bonfire') && s.game.flameSlots.some(flame => flame?.stage === 'bonfire'), { contextual: true }),
  info('context-later-boss', 'NEW BOSS', ['Check its rule here before you make your first move.'], '[data-tutorial="boss"]',
    s => !seen(s, 'later-boss') && s.game.round > 12 && s.game.phase === 'round' && !!s.game.boss
      && !['capitalReturn', 'magician', 'quickdraw', 'warden'].includes(s.game.boss.type), { contextual: true }),
  info('context-safeguard', 'KEEP GOING', ['Your final Life is safe during the guided Chapters.', 'Used hands are refreshed, you have 3 Rerolls, and this encounter rule is disabled.'], '[data-tutorial="reroll-button"]',
    s => !seen(s, 'safeguard') && s.scenario.safeguardActivations > 0, { contextual: true, side: 'top' }),
  info('tutorial-run-over', 'RUN OVER', ['Every run gives you different options and challenges you in different ways.', 'I hope you enjoy playing Roll Call!'], undefined,
    s => s.game.phase === 'lost', { actionLabel: 'BACK TO TITLE' }),
];

function contextualCopy(beat: TutorialBeat, session: TutorialSession): TutorialBeat {
  if (beat.id === 'flame-details' && session.scenario.firstFlameInstanceId !== null) {
    const card = flameCard(session.scenario.firstFlameInstanceId);
    const target = `${card} button`;
    return { ...beat, target, highlightTargets: [card], interactiveTargets: [target] };
  }
  if (beat.id === 'c1-special-confirm') {
    const offer = session.game.specialOffer?.chosen;
    const body = offer?.type === 'carePackage' ? ['Those extra Rerolls carry over until you use them.']
      : offer?.type === 'focus' ? ['Full House just got a big training boost.']
        : ["Your next Shop's initial offers are free."];
    return { ...beat, body };
  }
  if (beat.id === 'c2-special-confirm') return { ...beat, body: ['Your chosen reward is now part of this run.'] };
  if (['c2-r1-setup-select', R.flameDemoSetup, 'c2-r1-payoff-select', R.flameDemoPayoff].includes(beat.id)) {
    const flame = session.scenario.firstFlame;
    const setup = beat.id === 'c2-r1-setup-select' || beat.id === R.flameDemoSetup;
    const selecting = beat.id.endsWith('-select');
    const selectedHand = flameDemoHand(session, !setup);
    const handTarget = hand(selectedHand);
    const flameTarget = activeFlame(session.scenario.firstFlameInstanceId);
    const title = flame === 'doubleDown' ? (setup ? 'DOUBLE DOWN' : "NOW IT'S READY")
      : flame === 'straightShooter' ? (setup ? 'STRAIGHT SHOOTER' : "NOW IT'S READY") : 'MINIGUN';
    const body = flame === 'doubleDown' ? (setup
      ? [`Pair is marked because it sets up your Flame. ${selecting ? 'Select' : 'Play'} Pair first.`]
      : ['Two Pair is the payoff. The Flame activates when you meet its condition.'])
      : flame === 'straightShooter' ? (setup
        ? [`Small Straight is marked because it sets up your Flame. ${selecting ? 'Select' : 'Play'} it first.`]
        : ['Large Straight is the payoff. The Flame activates when you meet its condition.'])
        : ['Any Upper hand can trigger this Flame.', `${selecting ? 'Select' : 'Play'} an Upper hand and you'll get some extra XMult.`];
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
    `Your Rerolls are gone, but Care Package still has ${session.game.specialOfferEffects.carePackageRerolls} left.`,
    'These extra Rerolls carry over until you use them.',
  ] };
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

export const taughtBosses = new Set(['capitalReturn', 'magician', 'quickdraw', 'warden']);
export const tutorialHandName = (hand: keyof typeof HANDS) => HANDS[hand].name;
