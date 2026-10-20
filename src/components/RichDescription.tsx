import { ActionIcon, Button, Group, Popover, Stack, Text } from '@mantine/core';
import { IconArrowLeft, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import type { EffectReference, GlossaryTermId, RichText } from '../game/richText';
import { GLOSSARY } from '../game/glossary';
import { flameVerboseDescription, specialDieVerboseDescription, specialOfferVerboseDescription } from '../game/effectDescriptions';
import { SPECIAL_DICE } from '../game/specialDice';
import { FLAMES } from '../game/flames';
import { SPECIAL_OFFERS } from '../game/specialOffers';

type Reference = { kind: 'term'; id: GlossaryTermId } | { kind: 'effect'; effect: EffectReference };

const effectName = (reference: EffectReference): string => reference.kind === 'die' ? SPECIAL_DICE[reference.id].name
  : reference.kind === 'flame' ? FLAMES[reference.id].name : SPECIAL_OFFERS[reference.id].name;
const effectCopy = (reference: EffectReference): RichText => reference.kind === 'die'
  ? specialDieVerboseDescription(reference.id, 1)
  : reference.kind === 'flame' ? flameVerboseDescription(reference.id) : specialOfferVerboseDescription(reference.id);

function RichTokens({ copy, open }: { copy: RichText; open: (reference: Reference) => void }) {
  return <>{copy.map((token, index) => token.kind === 'text' ? <span key={index}>{token.value}</span>
    : token.kind === 'term' ? <button key={index} type="button" className="glossary-term"
      aria-label={`Explain ${token.label ?? GLOSSARY[token.id].label}`}
      onClick={event => { event.stopPropagation(); open({ kind: 'term', id: token.id }); }}>
      {token.label ?? GLOSSARY[token.id].label}
    </button>
      : <button key={index} type="button" className="glossary-term effect-reference"
        aria-label={`Explain ${token.label ?? effectName(token.effect)}`}
        onClick={event => { event.stopPropagation(); open({ kind: 'effect', effect: token.effect }); }}>
        {token.label ?? effectName(token.effect)}
      </button>)}</>;
}

export function RichDescription({ copy, size = 'sm', className }: {
  copy: RichText;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const [stack, setStack] = useState<Reference[]>([]);
  const current = stack.at(-1);
  const title = current?.kind === 'term' ? GLOSSARY[current.id].label
    : current?.kind === 'effect' ? effectName(current.effect) : '';
  const detail = current?.kind === 'term' ? GLOSSARY[current.id].definition
    : current?.kind === 'effect' ? effectCopy(current.effect) : [];
  const open = (reference: Reference) => setStack(previous => [...previous, reference]);
  const close = () => setStack([]);
  return <Popover opened={stack.length > 0} onChange={opened => { if (!opened) close(); }}
    position="bottom-start" width={340} shadow="xl" trapFocus withinPortal>
    <Popover.Target>
      <Text component="span" size={size} className={`rich-description ${className ?? ''}`}>
        <RichTokens copy={copy} open={open} />
      </Text>
    </Popover.Target>
    <Popover.Dropdown>
      <Stack gap="xs" role="dialog" aria-label={`${title} definition`}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            {stack.length > 1 && <ActionIcon variant="subtle" size="sm" aria-label="Back to previous definition"
              onClick={() => setStack(previous => previous.slice(0, -1))}><IconArrowLeft size={16} /></ActionIcon>}
            <Text fw={800}>{title}</Text>
          </Group>
          <ActionIcon variant="subtle" size="sm" aria-label="Close definition" onClick={close}><IconX size={16} /></ActionIcon>
        </Group>
        <Text component="div" size="sm"><RichTokens copy={detail} open={open} /></Text>
        {stack.length > 1 && <Button variant="subtle" size="compact-xs" onClick={() => setStack(previous => previous.slice(0, -1))}>BACK</Button>}
      </Stack>
    </Popover.Dropdown>
  </Popover>;
}
