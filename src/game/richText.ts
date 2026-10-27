import type { Flame, SpecialDieType, SpecialOfferType } from './types';

export type GlossaryTermId =
  | 'roll' | 'manualReroll' | 'exposedFace' | 'play' | 'hand' | 'handQualification'
  | 'score' | 'pips' | 'mult' | 'xMult' | 'round' | 'roundTarget' | 'upperHand'
  | 'lowerSectionHand' | 'lastPlay' | 'freePlay' | 'onCommand' | 'wild' | 'charge'
  | 'bust' | 'training' | 'life' | 'interest' | 'ember' | 'bonfire' | 'stoke'
  | 'build' | 'targetHand' | 'weightedFace' | 'sellValue' | 'bossEffect' | 'possibleHand';

export type EffectReference =
  | { kind: 'die'; id: SpecialDieType }
  | { kind: 'flame'; id: Flame }
  | { kind: 'offer'; id: SpecialOfferType };

export type RichTextToken =
  | { kind: 'text'; value: string }
  | { kind: 'term'; id: GlossaryTermId; label?: string }
  | { kind: 'effect'; effect: EffectReference; label?: string };

export type RichText = readonly RichTextToken[];

export const text = (value: string): RichTextToken => ({ kind: 'text', value });
export const term = (id: GlossaryTermId, label?: string): RichTextToken => ({ kind: 'term', id, ...(label ? { label } : {}) });
export const effect = (effectReference: EffectReference, label?: string): RichTextToken =>
  ({ kind: 'effect', effect: effectReference, ...(label ? { label } : {}) });

export type RichTextResolver = {
  termLabel: (id: GlossaryTermId) => string;
  effectLabel: (reference: EffectReference) => string;
};

export function richTextToPlain(copy: RichText, resolver: RichTextResolver): string {
  return copy.map(token => token.kind === 'text' ? token.value
    : token.kind === 'term' ? token.label ?? resolver.termLabel(token.id)
      : token.label ?? resolver.effectLabel(token.effect)).join('');
}

export function glossaryReferences(copy: RichText): GlossaryTermId[] {
  return copy.flatMap(token => token.kind === 'term' ? [token.id] : []);
}
