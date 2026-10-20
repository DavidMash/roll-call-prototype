import type { Flame, SpecialDieType, SpecialOffer, SpecialOfferType } from './types';
import type { RichText } from './richText';
import { effect, richTextToPlain, term, text } from './richText';
import { GLOSSARY } from './glossary';

const uses = (count: number): RichText => [text(`This power can be used ${count} ${count === 1 ? 'time' : 'times'} per Round.`)];
const sentenceWithUses = (sentence: RichText, count: number): RichText => [...sentence, text(' '), ...uses(count)];

export function specialDieVerboseDescription(type: SpecialDieType, level: number): RichText {
  const count = Math.max(1, Math.floor(level));
  const guaranteedAdditionalScores = Math.floor(count / 4);
  const additionalScoreChance = (count % 4) * 25;
  const doubleTimeCopy: RichText = guaranteedAdditionalScores === 0
    ? [text('Each time this die '), term('score', 'Scores'), text(`, there is a ${additionalScoreChance}% chance that it will Score a second time.`)]
    : [text('Each time this die '), term('score', 'Scores'),
      text(`, it will Score ${guaranteedAdditionalScores} additional ${guaranteedAdditionalScores === 1 ? 'time' : 'times'}`),
      ...(additionalScoreChance ? [text(`, with a ${additionalScoreChance}% chance to Score one more time`)] : []), text('.')];
  const descriptions: Record<SpecialDieType, RichText> = {
    bonus: [text('Whenever this die '), term('score', 'Scores'), text(`, it adds +${10 * count} `), term('pips'), text(' to the '), term('hand'), text('.')],
    workout: [text('Each time this die '), term('score', 'Scores'), text(`, it gains +${2 * count} `), term('pips'), text(' for the rest of the current '), term('round'), text('.')],
    vintage: [text('Each time this die '), term('score', 'Scores'), text(`, its `), term('sellValue'), text(` increases by ${count} Gold. Its Sell Value can increase by up to ${90 * count} Gold this way.`)],
    golden: [text('Each time this die '), term('score', 'Scores'), text(`, you earn 1 Gold. This die can earn up to ${3 * count} Gold each `), term('round'), text('.')],
    weighted: sentenceWithUses([text('When this die would be '), term('roll', 'Rolled'), text(', it shows its chosen '), term('weightedFace'), text(' instead of being randomized.')], count),
    clockwork: [text('After this die is '), term('roll', 'Rolled'), text(` for the first time in a `), term('round'), text(`, its next ${3 * count} Rolls show the next face in sequence instead of being randomized normally.`)],
    teamPlayer: [text(`When you `), term('play'), text(` this die together with other dice, each of those other dice contributes ${count + 1} times as many `), term('pips'), text(' when it '), term('score', 'Scores'), text('.')],
    loneWolf: [text('When you '), term('play'), text(` this die by itself, it Scores ${count + 1} times instead of once.`)],
    hitchhiker: sentenceWithUses([text('This die automatically '), term('score', 'Scores'), text(' as part of another '), term('hand'), text(' even when you did not select it for that '), term('play'), text('.')], count),
    magnetic: sentenceWithUses([text('The next other die to be '), term('roll', 'Rolled'), text(' while this power is available will show the same '), term('exposedFace'), text(' as this die instead of being randomized.')], count),
    jackpot: [text(`If this die `), term('score', 'Scores'), text(` in the `), term('play'), text(` that reaches the `), term('roundTarget'), text(`, you earn ${3 * count} Gold.`)],
    freePlay: [text('After this die is '), term('roll', 'Rolled'), text(', you can '), term('freePlay'), text(' the '), term('upperHand'), text(` that matches its `), term('exposedFace'), text(`. Each face can do this ${count} ${count === 1 ? 'time' : 'times'} per Round.`)],
    chameleon: sentenceWithUses([term('onCommand'), text(', permanently change this die\'s '), term('exposedFace'), text(' to match the face currently shown by most of your other dice.')], count),
    flywheel: sentenceWithUses([term('onCommand'), text(', '), term('roll'), text(' this die again without spending a '), term('manualReroll'), text('.')], count),
    tank: [text('After this die\'s first '), term('roll'), text(' of the '), term('round'), text(', its '), term('exposedFace'), text(` becomes locked and will no longer change. Each time the die `), term('score', 'Scores'), text(`, or each time an action or effect attempts to Reroll it, it gains +${10 * count} `), term('pips'), text('.')],
    mirror: sentenceWithUses([text('During '), term('handQualification'), text(' for a matching '), term('hand'), text(', this die can act as any face value you need. Its actual '), term('exposedFace'), text(' does not change.')], count),
    missingLink: sentenceWithUses([text('During '), term('handQualification'), text(' for a Straight, this die can act as any face value you need. Its actual '), term('exposedFace'), text(' does not change.')], count),
    doubleTime: doubleTimeCopy,
    jumpingBean: sentenceWithUses([term('onCommand'), text(', '), term('freePlay'), text(' the '), term('upperHand'), text(' that matches this die\'s '), term('exposedFace'), text('. After that Play, this die is '), term('roll', 'Rolled'), text(' again.')], count),
    furnace: [text('During a Round, you can feed this effect up to 5 Gold units. Each remaining unit adds '),
      text(`+${3 * count} `), term('pips'), text(' whenever this die '), term('score', 'Scores'),
      text('. One unit is consumed per Score, and all remaining units reset at the end of the Round.')],
    sustainable: sentenceWithUses([text('If this die '), term('score', 'Scores'), text(' in a '), term('hand'), text(', that Hand remains available and can be '), term('play', 'Played'), text(' again later in the '), term('round'), text('.')], count),
    magic: sentenceWithUses([term('onCommand'), text(', choose which '), term('exposedFace'), text(' this die will show the next time it is Rerolled.')], count),
    conjoined: sentenceWithUses([text('This die acts like two dice showing the same face. For example, this die can be '), term('play', 'Played'), text(' by itself as a Pair, or '), term('score'), text(' in an '), term('upperHand'), text(' as if two dice were Played.')], count),
  };
  return descriptions[type];
}

export const chameleonTieDetail: RichText = [text('If multiple faces are tied for most common, one of those tied faces is chosen at random.')];

export function flameVerboseDescription(id: Flame): RichText {
  const descriptions: Record<Flame, RichText> = {
    ultimate: [text('When you '), term('play'), text(' your highest-level '), term('hand'), text(', that Hand gains extra '), term('xMult'), text('. The bonus increases as this Flame gets stronger, up to ×5 XMult.')],
    minigun: [text('Whenever you '), term('play'), text(' an '), term('upperHand'), text(', that Hand gains extra '), term('xMult'), text('. The bonus can increase up to ×5 XMult.')],
    hailMary: [text('If you '), term('play'), text(' a '), term('hand'), text(' after using all of your normal '), term('manualReroll', 'Manual Rerolls'), text(', that Hand gains extra '), term('xMult'), text(', up to ×5.')],
    fullOfGrace: [text('Your '), term('lastPlay'), text(' of each '), term('round'), text(' gains extra '), term('xMult'), text('. The bonus can increase up to ×5.')],
    momentum: [text('Each time you '), term('play'), text(' a '), term('hand'), text(', this Flame adds '), term('charge'), text('.')],
    thirdRail: [text('Whenever a die is '), term('roll', 'Rolled'), text(' and its '), term('exposedFace'), text(' is a 3, this Flame adds '), term('charge'), text('.')],
    jumpStart: [text('Each time you use a '), term('manualReroll'), text(', this Flame adds '), term('charge'), text('.')],
    powerSurge: [text('When you '), term('play'), text(' your highest-level '), term('hand'), text(', the '), term('charge'), text(' you currently have is tripled.')],
    speedDemon: [text('The faster you make a '), term('play'), text(', the more '), term('xMult'), text(' that Hand receives. A sufficiently fast Play can earn up to ×5 XMult.')],
    sixPack: [text('At the beginning of each '), term('round'), text(', this Flame gives you extra '), term('xMult'), text(', up to ×6. Playing an '), term('upperHand'), text(' reduces that bonus.')],
    fluxCapacitor: [text('When a '), effect({ kind: 'die', id: 'magnetic' }, 'Magnetic'), text(' die activates its ability, this Flame multiplies your '), term('charge'), text(' based on how many other dice were affected.')],
    fatCat: [text('If a '), effect({ kind: 'die', id: 'golden' }, 'Golden'), text(' or '), effect({ kind: 'die', id: 'jackpot' }, 'Jackpot'), text(' die '), term('score', 'Scores'), text(' in a '), term('hand'), text(', that Hand gains extra '), term('xMult'), text(', up to ×5.')],
    vineyard: [text('If a '), effect({ kind: 'die', id: 'vintage' }, 'Vintage'), text(' die '), term('score', 'Scores'), text(' in a '), term('hand'), text(', that Hand gains extra '), term('xMult'), text(', up to ×5.')],
    fetch: [text('One specific die face is marked as FETCH. If that exact face '), term('score', 'Scores'), text(', the '), term('hand'), text(' gains extra '), term('xMult'), text(', up to ×5, and FETCH moves to another face.')],
    targetPractice: [text('When you '), term('play'), text(' your '), term('targetHand'), text(', that Hand gains extra '), term('xMult'), text(', up to ×9.')],
    hotStreak: [text('Play '), term('lowerSectionHand', 'Lower Section Hands'), text(' sequentially from top to bottom to build an increasingly large '), term('xMult'), text(' bonus. Completing the full sequence can reach ×9 XMult.')],
    lowball: [text('When a die showing a 1, 2, or 3 '), term('score', 'Scores'), text(', the '), term('hand'), text(' gains extra '), term('xMult'), text(' from Lowball. The bonus can increase up to ×5.')],
    straightShooter: [text('Play a Small Straight before a Large Straight. The following Large Straight gains extra '), term('xMult'), text(', up to ×9.')],
    doubleDown: [text('Play a Pair before Two Pair. The following Two Pair gains extra '), term('xMult'), text(', up to ×9.')],
    threesCompany: [text('Play Three of a Kind before Full House. The following Full House gains extra '), term('xMult'), text(', up to ×9.')],
    boxSet: [text('Play Four of a Kind before Five of a Kind. The following Five of a Kind gains extra '), term('xMult'), text(', up to ×9.')],
    missingPair: [text('Pair and Three of a Kind both gain extra '), term('xMult'), text('. The bonus can increase up to ×5.')],
    oneShort: [text('Small Straight and Four of a Kind both gain extra '), term('xMult'), text('. The bonus can increase up to ×5.')],
  };
  return descriptions[id];
}

export function specialOfferVerboseDescription(type: SpecialOfferType, handName?: string): RichText {
  const descriptions: Record<SpecialOfferType, RichText> = {
    onTheHouse: [text('In the next Shop, the first die you purchase and the first individual '), term('training'), text(' you purchase will both be free.')],
    greatFairy: [text('Restore all of your missing '), term('life', 'Lives'), text('. If you already have the maximum number of Lives, gain 15 Gold instead.')],
    focus: [term('training', 'Train'), text(` ${handName ?? '[HAND]'} four times without spending any Gold.`)],
    timeTravel: [text('Return to Round 1 of the current Chapter while keeping your current '), term('build'), text('.')],
    carePackage: [text('Gain 3 additional '), term('manualReroll', 'Manual Rerolls'), text('. Unlike your normal Rerolls, any of these that you do not use will carry over into later '), term('round', 'Rounds'), text('.')],
    silence: [text('The next '), term('bossEffect'), text(' that would affect your run will be disabled.')],
    taxEvasion: [text('For the next 3 '), term('round', 'Rounds'), text(', the amount of '), term('interest'), text(' you earn will be doubled.')],
    fireKeeper: [text('A random '), term('ember'), text(' you currently hold moves halfway from its current investment toward '), term('bonfire'), text('. If the halfway point is not a whole number, it rounds up.')],
    bottledFairy: [text('For the next 3 '), term('round', 'Rounds'), text(', if you would '), term('bust'), text(', your '), term('manualReroll', 'Manual Rerolls'), text(' will refill once during that Round.')],
    badDream: [text('For the next 3 '), term('round', 'Rounds'), text(', if your run ends, you will return to the Shop after Round 3 with your current '), term('build'), text(' and 1 '), term('life'), text('.')],
    teamTraining: [text('Increase the level of every '), term('hand'), text(' by 1 for the rest of the run.')],
  };
  return descriptions[type];
}

export const plainDescription = (copy: RichText): string => richTextToPlain(copy, {
  termLabel: id => GLOSSARY[id].label,
  effectLabel: reference => reference.id,
});

export const specialOfferCopy = (offer: SpecialOffer, handName?: string): RichText =>
  specialOfferVerboseDescription(offer.type, handName);
