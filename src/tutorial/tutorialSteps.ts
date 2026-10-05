import { HANDS } from '../game/hands';
import { activeSpecialOfferStatusItems } from '../game/specialOffers';
import type { TutorialBeat, TutorialSession } from './types';
import { tutorialRequiredBeatIds as R } from './scenario';

type Candidate = TutorialBeat & { when: (session: TutorialSession) => boolean };
const info = (id: string, title: string | undefined, body: string[], target: string | undefined,
  when: Candidate['when'], extras: Partial<TutorialBeat> = {}): Candidate => ({
  id, title, body, target, when, blocking: true, actionLabel: 'GOT IT', ...extras,
});
const required = (id: string, title: string | undefined, body: string[], target: string,
  requiredAction: string, when: Candidate['when']): Candidate => ({
  id, title, body, target, when, blocking: false, requiredAction,
});
const has = (session: TutorialSession, id: string) => session.scenario.completedBeatIds.includes(id);
const seen = (session: TutorialSession, id: TutorialSession['scenario']['seenLessonIds'][number]) => session.scenario.seenLessonIds.includes(id);

const candidates: Candidate[] = [
  info('welcome', 'WELCOME TO ROLL CALL', ["We'll learn as we play. I'll explain things when they matter, then get out of your way."], undefined,
    s => s.game.round === 1),
  info('goal', 'THE GOAL', ['Score enough points to reach the Goal and clear the Round.'], '[data-tutorial="goal"]',
    s => s.game.round === 1 && has(s, 'welcome'), { side: 'right' }),
  info('scorecard', 'YOUR SCORECARD', ['Upper hands score matching numbers. Lower hands score patterns like Pairs, Straights, and Full Houses.'], '[data-tutorial="scorecard"]',
    s => s.game.round === 1 && has(s, 'goal')),
  required(R.reroll, "LET'S IMPROVE THIS ROLL", ['We already have a Pair of 1s. Select this 2 and use a Reroll to try for Three of a Kind.'], '[data-tutorial="die-2"]',
    'Select D2 and use Reroll.', s => s.game.round === 1 && s.game.phase === 'round' && has(s, 'scorecard')),
  info('c1-r1-nice', 'NICE', ['Three 1s gives us Three of a Kind.'], '[data-tutorial="hand-threeKind"]', s => has(s, R.reroll)),
  info('c1-r1-pips-mult', 'PIPS AND MULT', ['Every hand starts with Base Pips and a Mult. The dice that score add their own Pips too.'], '[data-tutorial="hand-threeKind"]',
    s => has(s, 'c1-r1-nice')),
  required(R.threeKind, 'SCORING', ['Your score is Pips × Mult. Play Three of a Kind and watch it add up.'], '[data-tutorial="hand-threeKind"]',
    'Play Three of a Kind with the three 1s.', s => s.game.round === 1 && s.game.phase === 'round' && has(s, 'c1-r1-pips-mult')),
  info('c1-r1-after-play', 'AFTER YOU PLAY', ['That hand is now Used for this Round, and the dice that scored reroll.'], '[data-tutorial="hand-threeKind"]',
    s => has(s, R.threeKind)),
  required(R.pair, 'PAIR', ['Now we have a Pair of 4s. Give it a try.'], '[data-tutorial="hand-pair"]', 'Play Pair with the two 4s.',
    s => s.game.round === 1 && s.game.phase === 'round' && has(s, 'c1-r1-after-play')),
  required(R.sixes, 'YOUR TURN', ['Try Sixes next.'], '[data-tutorial="hand-sixes"]', 'Play Sixes.',
    s => s.game.round === 1 && s.game.phase === 'round' && has(s, R.pair)),
  required(R.fives, undefined, ['Try Fives.'], '[data-tutorial="hand-fives"]', 'Play Fives.',
    s => s.game.round === 1 && s.game.phase === 'round' && has(s, R.sixes)),
  required(R.straight, 'SMALL STRAIGHT', ['That reroll gave us 1, 2, 3, 4. Play the Small Straight to finish the Round.'], '[data-tutorial="hand-smallStraight"]',
    'Play Small Straight.', s => s.game.round === 1 && s.game.phase === 'round' && has(s, R.fives)),
  info('c1-r1-payout', 'ROUND PAYOUT', ['Clearing a Round earns Gold. You also get +1 Gold for every normal Reroll you have left.'], '[data-tutorial="payout"]',
    s => s.game.round === 1 && s.game.phase === 'roundSummary' && has(s, R.straight)),
  info('c1-r1-payout-rerolls', undefined, ['You used one Reroll, so the other two earned you 2 extra Gold.'], '[data-tutorial="payout-rerolls"]',
    s => s.game.round === 1 && s.game.phase === 'roundSummary' && has(s, 'c1-r1-payout')),
  info('shop1-training', 'HAND TRAINING', ['Training makes a hand stronger by increasing its Base Pips and Mult.'], '[data-tutorial="hand-training"]',
    s => s.game.phase === 'shop' && s.game.round === 1),
  required(R.training, undefined, ["Let's train Full House so it's stronger when we find one."], '[data-tutorial="training-fullHouse"]',
    'Train Full House once.', s => s.game.phase === 'shop' && s.game.round === 1 && has(s, 'shop1-training')),
  info('shop1-training-result', 'FULL HOUSE · LV. 2', ['Its Base Pips and Mult are both higher now.'], '[data-tutorial="training-fullHouse"]',
    s => s.game.phase === 'shop' && s.game.round === 1 && has(s, R.training)),
  info('shop1-enhancements', 'ENHANCEMENTS', ['Training improves hands. Enhancements improve individual die faces.'], '[data-tutorial="enhancements"]',
    s => s.game.phase === 'shop' && s.game.round === 1 && has(s, 'shop1-training-result')),
  info('shop1-bonus-info', 'BONUS', ['When this face scores, Bonus adds +10 Pips.'], '[data-tutorial="enhancement-bonus"]',
    s => s.game.phase === 'shop' && s.game.round === 1 && has(s, 'shop1-enhancements')),
  required(R.bonus, undefined, ['Buy Bonus and put it on this 4.'], '[data-tutorial="enhancement-bonus"]', 'Select Bonus, then choose D2 showing 4.',
    s => s.game.phase === 'shop' && s.game.round === 1 && has(s, 'shop1-bonus-info')),
  info('shop1-face-persistence', undefined, ['Enhancements stay on that physical face, even after the die rolls away from it.'], '[data-tutorial="die-2"]',
    s => s.game.phase === 'shop' && s.game.round === 1 && has(s, R.bonus), { side: 'top' }),

  info('c1-r2-two-pair', 'WE ALREADY HAVE TWO PAIR', ["That's good, but we just trained Full House."], '[data-tutorial="hand-twoPair"]',
    s => s.game.round === 2 && s.game.phase === 'round'),
  info('c1-r2-choice', undefined, ['You could spend a Reroll on this 2, or play Twos and let it reroll after scoring.', "Let's save the Reroll. Play Twos."], '[data-tutorial="die-1"]',
    s => s.game.round === 2 && s.game.phase === 'round' && has(s, 'c1-r2-two-pair'), { side: 'top' }),
  required(R.r2Twos, undefined, ["Let's save the Reroll. Play Twos."], '[data-tutorial="hand-twos"]', 'Play Twos with D1.',
    s => s.game.round === 2 && s.game.phase === 'round' && has(s, 'c1-r2-choice')),
  info('c1-r2-nice', 'NICE', ['Playing Twos rerolled that die for free, and now we have Full House.'], '[data-tutorial="hand-fullHouse"]',
    s => s.game.round === 2 && s.game.phase === 'round' && has(s, R.r2Twos)),
  required(R.r2FullHouse, 'FULL HOUSE · LV. 2', ['This is the hand we trained. Its Base Pips and Mult are stronger now.'], '[data-tutorial="hand-fullHouse"]',
    'Play Full House.', s => s.game.round === 2 && s.game.phase === 'round' && has(s, 'c1-r2-nice')),
  info('c1-r2-bonus-trigger', 'BONUS', ['That 4 scored, so Bonus added +10 Pips.'], '[data-tutorial="die-2"]',
    s => s.game.round === 2 && (s.game.stats.triggers.bonus ?? 0) > 0, { contextual: true, side: 'top' }),

  info('c1-mini-boss', 'MINI-BOSS', ['Round 3 has a Mini-Boss. Each one changes the rules for this Round.'], '[data-tutorial="boss"]',
    s => s.game.round === 3 && s.game.phase === 'round'),
  info('c1-capital-return', 'CAPITAL RETURN', ['Playing a Lower hand costs 1 Gold this Round.'], '[data-tutorial="boss"]',
    s => s.game.round === 3 && s.game.phase === 'round' && has(s, 'c1-mini-boss')),
  info('c1-special-offer', 'SPECIAL OFFER', ['After beating a Mini-Boss, you get to claim one of three rewards.', 'Read the descriptions and pick your favorite.'], '[data-tutorial="special-offers"]',
    s => s.game.round === 3 && s.game.phase === 'specialOffer' && !s.game.specialOffer?.acquired),
  info('c1-special-confirm', undefined, [], '[data-tutorial="special-offers"]', s => s.game.round === 3 && s.game.phase === 'specialOffer' && !!s.game.specialOffer?.acquired),

  info('shop-r4-workout-info', 'WORKOUT', ['Some Enhancements grow over time. When this face scores, Workout permanently gives it +1 Pip.'], '[data-tutorial="enhancement-workout"]',
    s => s.game.phase === 'shop' && s.game.round === 3),
  required(R.workout, undefined, ['Buy Workout and put it on this 2.'], '[data-tutorial="enhancement-workout"]', 'Select Workout, then choose D1 showing 2.',
    s => s.game.phase === 'shop' && s.game.round === 3 && has(s, 'shop-r4-workout-info')),
  info('c1-r4-familiar', 'LOOK FAMILIAR?', ['We already have Two Pair again.', 'Play Twos and let the Workout face reroll.'], '[data-tutorial="die-1"]',
    s => s.game.round === 4 && s.game.phase === 'round', { side: 'top' }),
  required(R.r4Twos, undefined, ['Play Twos and let the Workout face reroll.'], '[data-tutorial="hand-twos"]', 'Play Twos with the Workout die.',
    s => s.game.round === 4 && s.game.phase === 'round' && has(s, 'c1-r4-familiar')),
  info('c1-r4-workout-result', 'WORKOUT', ['That face scored, so its Pips increased permanently.', 'This physical 2 will now be worth 3 Pips whenever it shows again.'], '[data-tutorial="die-1"]',
    s => s.game.round === 4 && s.game.phase === 'round' && has(s, R.r4Twos), { side: 'top' }),
  required(R.r4FullHouse, 'FULL HOUSE AGAIN', ['The reroll completed it. Now play the hand we trained earlier.'], '[data-tutorial="hand-fullHouse"]', 'Play Full House.',
    s => s.game.round === 4 && s.game.phase === 'round' && has(s, 'c1-r4-workout-result')),

  info('c1-boss-intro', 'BOSS', ['Round 6 ends the Chapter with a Boss. Bosses can change the rules in bigger ways.'], '[data-tutorial="boss"]',
    s => s.game.round === 6 && s.game.phase === 'round'),
  info('c1-quickdraw', 'QUICKDRAW', ['The Goal is lower, but you only get one Lower hand this Round. Choose it carefully.'], '[data-tutorial="boss"]',
    s => s.game.round === 6 && s.game.phase === 'round' && has(s, 'c1-boss-intro')),
  info('flame-selection-1', 'FLAME SELECTION', ['After beating a Boss, you get to choose a Flame.', 'Read the descriptions and pick the one you like best.'], '[data-tutorial="flame-offers"]',
    s => s.game.round === 6 && s.game.phase === 'flameSelection' && !s.game.flameSelection?.acquired),
  info('flame-basics', 'FLAMES', ['Enhancements belong to faces. Flames belong to whole dice.', 'Flames can add XMult when their condition is met.'], '[data-tutorial="dice-dock"]',
    s => s.game.round === 6 && s.game.phase === 'flameSelection' && !!s.game.flameSelection?.acquired, { side: 'top' }),
  info('flame-xmult', 'XMULT', ['XMult multiplies your score after Pips and Mult.', 'Pips × Mult × XMult'], '[data-tutorial="flame-cap"]',
    s => s.game.round === 6 && has(s, 'flame-basics'), { side: 'top' }),
  info('flame-ember', undefined, ["While it's an Ember, its effect only works when that die scores in the right hand."], '[data-tutorial="flame-cap"]',
    s => s.game.round === 6 && has(s, 'flame-xmult'), { side: 'top' }),
  required('flame-details', undefined, ['Tap your Flame to see its details.'], '[data-tutorial="flame-cap"]', 'Open the Flame details.',
    s => s.game.phase === 'shop' && s.game.round === 6 && !!s.scenario.firstFlame),
  required('flame-stoke', 'STOKE', ["Investing Gold makes a Flame's XMult effect stronger.", 'Stoke it once so you can see the effect grow.'], '[data-tutorial="stoke"]',
    'Stoke the Flame once.', s => s.game.phase === 'shop' && s.game.round === 6 && has(s, 'flame-details') && s.game.stats.flameStokes.length === 0),
  info('bonfire-explainer', 'BONFIRES', ['At 100 Gold, an Ember becomes a Bonfire.', 'Bonfires are global, so the Flame no longer needs its original die to score.', "Becoming a Bonfire also frees that die's Flame slot."], '[data-tutorial="flame-cap"]',
    s => s.game.phase === 'shop' && s.game.round === 6 && s.game.stats.flameStokes.length > 0, { side: 'top' }),

  info('chapter-2', 'CHAPTER 2', ["You've got the basics. I'll give you more room to make your own choices now."], undefined,
    s => s.game.round === 7),
  required(R.flameDemoSetup, undefined, [], '[data-tutorial="scorecard"]', 'Play the marked setup hand.',
    s => s.game.round === 7 && s.game.phase === 'round' && has(s, 'chapter-2') && s.scenario.firstFlame !== 'minigun'),
  required(R.flameDemoPayoff, undefined, [], '[data-tutorial="scorecard"]', 'Play the payoff hand with the Flame die.',
    s => s.game.round === 7 && s.game.phase === 'round' && has(s, 'chapter-2')),
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
  if (beat.id === 'c1-special-confirm') {
    const offer = session.game.specialOffer?.chosen;
    const body = offer?.type === 'carePackage' ? ['Those extra Rerolls carry over until you use them.']
      : offer?.type === 'focus' ? ['Full House just got a big training boost.']
        : ["Your next Shop's initial offers are free."];
    return { ...beat, body };
  }
  if (beat.id === 'c2-special-confirm') {
    const type = session.game.specialOffer?.chosen?.type;
    const body = type === 'orangeTheory' ? ['Every Workout stack just got stronger.']
      : type === 'cashBonus' ? ['Bonus can now earn extra Gold for the next 3 Rounds.']
        : ['Your Ember just moved halfway closer to Bonfire.'];
    return { ...beat, body };
  }
  if (beat.id === R.flameDemoSetup || beat.id === R.flameDemoPayoff) {
    const flame = session.scenario.firstFlame;
    if (flame === 'doubleDown') return beat.id === R.flameDemoSetup
      ? { ...beat, title: 'DOUBLE DOWN', body: ['Pair is marked because it sets up your Flame. Play Pair first.'], target: '[data-tutorial="hand-pair"]' }
      : { ...beat, title: "NOW IT'S READY", body: ['Two Pair is the payoff.', 'Include the die carrying Double Down so its XMult can apply.'], target: '[data-tutorial="hand-twoPair"]' };
    if (flame === 'straightShooter') return beat.id === R.flameDemoSetup
      ? { ...beat, title: 'STRAIGHT SHOOTER', body: ['Small Straight is marked because it sets up your Flame. Play it first.'], target: '[data-tutorial="hand-smallStraight"]' }
      : { ...beat, title: "NOW IT'S READY", body: ['Large Straight is the payoff.', 'Include the die carrying Straight Shooter so its XMult can apply.'], target: '[data-tutorial="hand-largeStraight"]' };
    return { ...beat, title: 'MINIGUN', body: ['Any Upper hand can trigger this Flame.', "Play an Upper hand with the die carrying Minigun and you'll get some extra XMult."], target: '[data-tutorial="hand-sixes"]' };
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
      ? ['That Vintage face has been building sell value.', 'You can sell it, or other Enhancements, to free up Gold and rework your build.']
      : ['You can sell Enhancements from your dice to free up Gold and rework your build.'] };
  }
  return beat;
}

export function activeTutorialBeat(session: TutorialSession): TutorialBeat | null {
  for (const candidate of candidates) {
    if (has(session, candidate.id)) continue;
    if (!candidate.when(session)) continue;
    return contextualCopy(candidate, session);
  }
  return null;
}

export function tutorialActionHint(session: TutorialSession): string | null {
  const beat = activeTutorialBeat(session);
  return beat?.requiredAction ?? null;
}

export const taughtBosses = new Set(['capitalReturn', 'quickdraw', 'juggler', 'warden']);
export const tutorialHandName = (hand: keyof typeof HANDS) => HANDS[hand].name;
