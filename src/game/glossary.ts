import type { RichText, GlossaryTermId } from './richText';
import { term, text } from './richText';

export interface GlossaryDefinition {
  label: string;
  definition: RichText;
}

export const GLOSSARY: Record<GlossaryTermId, GlossaryDefinition> = {
  roll: { label: 'Roll', definition: [text('A die is Rolled at the beginning of a '), term('round'), text(', after it participates in a normal '),
    term('play'), text(', or when an effect or '), term('manualReroll'), text(' Rolls it again. A Roll changes the die\'s '),
    term('exposedFace'), text(' unless another effect controls the result.')] },
  manualReroll: { label: 'Manual Reroll', definition: [text('A Manual Reroll lets you choose one or more dice and '),
    term('roll'), text(' them again without '), term('play', 'Playing'), text(' a '), term('hand'),
    text('. Each die consumes one of your available Rerolls.')] },
  exposedFace: { label: 'Exposed Face', definition: [text('The Exposed Face is the die face that is currently showing. Its value can be used for '),
    term('handQualification'), text(' and '), term('score', 'Scoring'), text('.')] },
  play: { label: 'Play', definition: [text('A Play submits a qualifying '), term('hand'),
    text('. You usually choose the dice, but a '), term('freePlay'), text(' or another effect may choose them for you. Dice that participate will '), term('score'), text('.')] },
  hand: { label: 'Hand', definition: [text('A Hand is a scoring pattern made from dice, such as Ones, Pair, Full House, or Large Straight.')] },
  handQualification: { label: 'Hand Qualification', definition: [text('Hand Qualification determines whether the '),
    term('exposedFace', 'Exposed Faces'), text(' of the selected dice satisfy the requirements of a '), term('hand'), text('.')] },
  score: { label: 'Score', definition: [text('A die Scores when it contributes its value and scoring effects to a Played '), term('hand'),
    text('. Some effects can also cause a die to Score when it was not originally selected.')] },
  pips: { label: 'Pips', definition: [text('Pips are points added to a '), term('hand'), text(' before its multipliers are applied. Dice and other effects can add extra Pips.')] },
  mult: { label: 'Mult', definition: [text('Mult multiplies the '), term('pips'), text(' in a '), term('hand'), text(' as part of its normal score calculation.')] },
  xMult: { label: 'XMult', definition: [text('XMult is an additional multiplier applied to the Hand\'s score after its '), term('pips'), text(' and '), term('mult'), text('.')] },
  round: { label: 'Round', definition: [text('A Round is one scoring challenge. You must reach the '), term('roundTarget'), text(' before the Round ends.')] },
  roundTarget: { label: 'Round Target', definition: [text('The Round Target is the score you need to reach to successfully clear the current '), term('round'), text('.')] },
  upperHand: { label: 'Upper Hand', definition: [text('Upper Hands are Ones, Twos, Threes, Fours, Fives, and Sixes.')] },
  lowerSectionHand: { label: 'Lower Section Hand', definition: [text('Lower Section Hands are the combination Hands shown in the lower section of the scorecard, such as Pair, Full House, Straights, and the different kinds of a Kind.')] },
  lastPlay: { label: 'Last Play', definition: [text('Your Last Play is the final normal '), term('play'), text(' you have available during the current '), term('round'), text('.')] },
  freePlay: { label: 'Free Play', definition: [text('A Free Play lets you '), term('play'), text(' the specified '), term('hand'), text(' without using one of your normal Plays.')] },
  onCommand: { label: 'On Command', definition: [text('An On Command effect does not activate automatically. You choose when to activate it while it is available.')] },
  wild: { label: 'Wild', definition: [text('A Wild die can stand in for a needed face value during '), term('handQualification'), text('. Its actual '), term('exposedFace'), text(' does not change.')] },
  charge: { label: 'Charge', definition: [text('Charge is power built by certain Flames. Other Flame effects can increase or multiply the Charge you have already built.')] },
  bust: { label: 'Bust', definition: [text('You Bust when a '), term('round'), text(' ends unsuccessfully before you clear its '), term('roundTarget'), text('.')] },
  training: { label: 'Training', definition: [text('Training permanently increases the level of a '), term('hand'), text(' for the rest of the run.')] },
  life: { label: 'Life', definition: [text('A Life lets your run continue after a failed '), term('round'), text('. Your run ends when you fail without any Lives remaining.')] },
  interest: { label: 'Interest', definition: [text('Interest is bonus Gold earned for holding Gold between '), term('round', 'Rounds'), text('.')] },
  ember: { label: 'Ember', definition: [text('An Ember is a Flame that has not yet reached full strength, including a newly acquired Flame with 0 Gold invested.')] },
  bonfire: { label: 'Bonfire', definition: [text('A Flame becomes a Bonfire when it reaches 100 Gold invested. A Bonfire has reached that Flame\'s full strength.')] },
  stoke: { label: 'Stoke', definition: [text('To Stoke a Flame means to invest Gold into it, making its effect stronger.')] },
  build: { label: 'Build', definition: [text('Your Build is the collection of dice, Flames, Hand levels, and other upgrades you currently have in the run.')] },
  targetHand: { label: 'Target Hand', definition: [text('Your Target Hand is the specific '), term('hand'),
    text(' currently selected by Target Practice. Playing that Hand activates Target Practice\'s bonus.')] },
  weightedFace: { label: 'Weighted Face', definition: [text('The Weighted Face is the face a Weighted die is guaranteed to show when its Weighted power activates.')] },
  sellValue: { label: 'Sell Value', definition: [text('Sell Value is the amount of Gold you receive when you sell a die in the Shop.')] },
  bossEffect: { label: 'Boss Effect', definition: [text('A Boss Effect is the special rule imposed by a Boss encounter.')] },
};

export const GLOSSARY_TERM_IDS = Object.keys(GLOSSARY) as GlossaryTermId[];
