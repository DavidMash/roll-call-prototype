import { describe, expect, it } from 'vitest';
import { GLOSSARY, GLOSSARY_TERM_IDS } from './glossary';
import { glossaryReferences } from './richText';
import { flameVerboseDescription, plainDescription, specialDieVerboseDescription, specialOfferVerboseDescription } from './effectDescriptions';
import { SPECIAL_DICE, SPECIAL_DIE_TYPES } from './specialDice';
import { FLAMES, FLAME_IDS } from './flames';
import { SPECIAL_OFFERS, SPECIAL_OFFER_IDS } from './specialOffers';
import type { RichText } from './richText';

const effectCopies = (): RichText[] => [
  ...SPECIAL_DIE_TYPES.map(type => specialDieVerboseDescription(type, 1)),
  ...FLAME_IDS.map(flameVerboseDescription),
  ...SPECIAL_OFFER_IDS.map(type => specialOfferVerboseDescription(type)),
];

describe('structured beginner-facing effect copy', () => {
  it('registers every glossary term and resolves nested references without self-definition', () => {
    expect(GLOSSARY_TERM_IDS).toHaveLength(31);
    for (const id of GLOSSARY_TERM_IDS) {
      const definition = GLOSSARY[id];
      expect(definition.label).not.toBe('');
      expect(plainDescription(definition.definition)).not.toBe('');
      expect(glossaryReferences(definition.definition)).not.toContain(id);
      for (const reference of glossaryReferences(definition.definition)) expect(GLOSSARY[reference]).toBeDefined();
    }
    expect(glossaryReferences(GLOSSARY.roll.definition)).toEqual(expect.arrayContaining(['round', 'play', 'manualReroll', 'exposedFace']));
  });

  it('resolves every glossary and named-effect reference in canonical descriptions', () => {
    for (const copy of effectCopies()) for (const token of copy) {
      if (token.kind === 'term') expect(GLOSSARY[token.id]).toBeDefined();
      if (token.kind === 'effect') {
        const registry = token.effect.kind === 'die' ? SPECIAL_DICE
          : token.effect.kind === 'flame' ? FLAMES : SPECIAL_OFFERS;
        expect(registry[token.effect.id as keyof typeof registry]).toBeDefined();
      }
    }
  });

  it('provides canonical verbose descriptions for every die, Flame, and Special Offer', () => {
    for (const type of SPECIAL_DIE_TYPES) {
      expect(SPECIAL_DICE[type].verboseDescription(1)).toEqual(specialDieVerboseDescription(type, 1));
      expect(plainDescription(SPECIAL_DICE[type].verboseDescription(1))).not.toBe('');
    }
    for (const id of FLAME_IDS) {
      expect(FLAMES[id].verboseDescription).toEqual(flameVerboseDescription(id));
      expect(FLAMES[id].description).toBe(plainDescription(FLAMES[id].verboseDescription));
    }
    for (const id of SPECIAL_OFFER_IDS) {
      expect(SPECIAL_OFFERS[id].verboseDescription).toEqual(specialOfferVerboseDescription(id));
      expect(SPECIAL_OFFERS[id].description).toBe(plainDescription(SPECIAL_OFFERS[id].verboseDescription));
    }
  });

  it('pluralizes level-scaled Uses and includes the required clarity language', () => {
    for (const type of SPECIAL_DIE_TYPES.filter(type => SPECIAL_DICE[type].invocationScale === 'level')) {
      const first = type === 'jumpingBean' ? 3 : 1;
      const second = type === 'jumpingBean' ? 6 : 2;
      expect(plainDescription(specialDieVerboseDescription(type, 1)), type).toContain(`${first} ${first === 1 ? 'time' : 'times'} per Round`);
      expect(plainDescription(specialDieVerboseDescription(type, 2)), type).toContain(`${second} times per Round`);
    }
    expect(plainDescription(specialDieVerboseDescription('freePlay', 3))).toBe("Before you Manually Reroll this die, it Free Plays the Upper Hand matching its current Exposed Face. During that Free Play, this die's Pips are multiplied by its Curtain Call level.");
    expect(plainDescription(flameVerboseDescription('targetPractice'))).toContain('Target Hand');
    expect(plainDescription(flameVerboseDescription('lowball'))).toContain('1, 2, or 3');
    expect(plainDescription(flameVerboseDescription('hotStreak'))).toContain('top to bottom');
    expect(plainDescription(specialDieVerboseDescription('chameleon', 1))).toContain('permanently');
    expect(plainDescription(specialDieVerboseDescription('conjoined', 1))).toContain('acts like two dice');
  });

  it('keeps dynamic values and Round terminology tied to the canonical descriptions', () => {
    expect(plainDescription(specialDieVerboseDescription('bonus', 3))).toContain('+12 Pips');
    expect(plainDescription(specialDieVerboseDescription('clockwork', 2))).toContain('next 6 Rolls');
    expect(plainDescription(specialDieVerboseDescription('teamPlayer', 2))).toContain('3 times as many Pips');
    expect(plainDescription(specialDieVerboseDescription('doubleTime', 5))).toContain('1 additional time, with a 25% chance');
    expect(plainDescription(specialDieVerboseDescription('jackpot', 2))).toContain('6 Gold');
    expect(plainDescription(specialDieVerboseDescription('jackpot', 2))).toContain('Round Target');
    expect(plainDescription(specialOfferVerboseDescription('focus'))).toContain('[HAND]');
  });

  it('keeps deprecated Invocation wording out of all player descriptions', () => {
    expect(effectCopies().map(plainDescription).join('\n')).not.toMatch(/Invocation/i);
  });
});
