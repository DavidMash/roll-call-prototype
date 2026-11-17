import { Badge, Button, Group, Modal, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { activeFace, scoringPips } from '../game/dice';
import { chameleonTieDetail } from '../game/effectDescriptions';
import { dieSellBreakdown } from '../game/forge';
import { effectDetails } from '../game/specialDiePresentation';
import { SPECIAL_DICE } from '../game/specialDice';
import type { Action, Board, CollectibleDie, DieEffectInstance, Rank } from '../game/types';
import type { DiceDisplay } from '../uiSettings';
import { CollectibleDieVisual } from './CollectibleDieVisual';
import { DieEffectsLabel, DieTypeLabel } from './DieTypeLabel';
import { PipFace } from './PipFace';
import { RichDescription } from './RichDescription';
import { CurrencyAmount } from './CurrencyAmount';

export interface FaceDetailsTarget { dieId: number; face: Rank }

function EffectPanel({ board, die, effect }: {
  board: Board; die: CollectibleDie; effect: DieEffectInstance;
}) {
  const definition = SPECIAL_DICE[effect.type];
  const details = effectDetails(die, effect, board.dieRoundState[die.id]);
  return <Paper withBorder p="sm" className="die-details-effect" data-effect-id={effect.id}>
    <Group justify="space-between" align="center"><Text fw={900}><DieTypeLabel type={effect.type} level={effect.level} /></Text>
      <Badge size="sm" variant="light" className={`rarity-badge rarity-${definition.rarity}`}>{definition.rarity}</Badge></Group>
    <RichDescription copy={definition.verboseDescription(effect.level)} />
    {effect.type === 'chameleon' && <RichDescription copy={chameleonTieDetail} size="xs" className="die-effect-detail" />}
    {details.status.length > 0 && <section aria-label={`${definition.name} current status`}>
      <Text size="xs" fw={850} tt="uppercase" c="dimmed" mt="xs" mb={4}>Current status</Text>
      <div className="die-details-status-list">{details.status.map(item => <div className="die-details-status-row" key={item.label}>
        <span>{item.label}</span><strong>{item.value}</strong></div>)}</div>
    </section>}
  </Paper>;
}

function CollectibleDetails({ board, die, onClose }: {
  board: Board; die: CollectibleDie; onClose: () => void;
}) {
  const face = activeFace(die);
  const mutation = face.bossMutation;
  const sale = dieSellBreakdown(die);
  return <Modal opened onClose={onClose} title={die.effects.length ? <DieEffectsLabel effects={die.effects} uppercase /> : 'DIE DETAILS'}
    size="lg" centered transitionProps={{ duration: 0 }} data-testid="die-details-modal" classNames={{ content: 'die-details-modal' }}>
    <Stack gap="sm">
      <Group align="center" wrap="nowrap" className="die-details-identity">
        <CollectibleDieVisual effects={die.effects} face={die.value as Exclude<Rank, 7>} />
        <Stack gap={4} className="die-details-heading"><Text fw={900}>{die.effects.length ? <DieEffectsLabel effects={die.effects} /> : 'Normal'}</Text>
          <Text size="sm" c="dimmed">Current sell value: <CurrencyAmount currency="gold" value={sale.total} /></Text></Stack>
      </Group>
      {die.effects.map(effect => <EffectPanel key={effect.id} board={board} die={die} effect={effect} />)}
      {!die.effects.length && <Text c="dimmed">Normal dice have no special effects.</Text>}
      {mutation?.kind === 'infected' && <Paper className="die-mutation-warning infected" p="xs" role="status"><Text size="xs" fw={900}>INFECTED FACE</Text>
        <Text size="sm">−3 Pips while exposed.{die.effects.length ? " This die's effects are suppressed." : ''}</Text></Paper>}
      {mutation?.kind === 'snakeEyes' && <Paper className="die-mutation-warning snake-eyes" p="xs" role="status"><Text size="xs" fw={900}>SNAKE EYES</Text>
        <Text size="sm">This face was changed from {mutation.originalRank} to 1 for this encounter.</Text></Paper>}
      <Button variant="default" onClick={onClose}>Close</Button>
    </Stack>
  </Modal>;
}

function CursedDieDetails({ board, dieId, initialFace, diceDisplay, onClose }: {
  board: Board; dieId: number; initialFace: Rank; diceDisplay: DiceDisplay; onClose: () => void;
}) {
  const [focusedFace, setFocusedFace] = useState<Rank>(initialFace);
  const die = board.dice.find(item => item.id === dieId && item.owner === 'boss');
  useEffect(() => setFocusedFace(initialFace), [dieId, initialFace]);
  if (!die) return null;
  const face = die.faces[focusedFace - 1];
  if (!face) return null;
  return <Modal opened onClose={onClose} title="CURSED DIE · FACES" size="lg" centered transitionProps={{ duration: 0 }} data-testid="cursed-die-details-modal">
    <Stack gap="sm"><SimpleGrid cols={{ base: 3, sm: 7 }} spacing="xs" className="manage-face-grid" aria-label="Cursed Die faces">
      {die.faces.map((candidate, index) => { const physicalFace = index + 1 as Rank; return <Paper component="button" type="button" key={physicalFace} withBorder p="xs"
        className={`manage-face-tile ${focusedFace === physicalFace ? 'focused' : ''} ${die.value === physicalFace ? 'exposed-face' : ''}`}
        aria-label={`Cursed Die face ${physicalFace}`} aria-pressed={focusedFace === physicalFace} onClick={() => setFocusedFace(physicalFace)}>
        {diceDisplay === 'pips' ? <PipFace value={candidate.rank} compact label={`Cursed Die face ${physicalFace}`} />
          : <span className="manage-face-number" aria-label={`Cursed Die face ${physicalFace}`}>{candidate.rank}</span>}
        <strong>FACE {physicalFace}</strong>{die.value === physicalFace && <span className="manage-face-exposed">EXPOSED</span>}</Paper>; })}
    </SimpleGrid><Text fw={850}>Face {focusedFace} · {scoringPips(face)} Pips</Text><Text c="dimmed">Cursed Die</Text>
    <Button variant="default" onClick={onClose}>Close</Button></Stack>
  </Modal>;
}

export function FaceDetailsModal({ board, target, diceDisplay, busy: _busy, actionsEnabled: _actionsEnabled, onClose, submit: _submit }: {
  board: Board; target: FaceDetailsTarget | null; diceDisplay: DiceDisplay; busy: boolean; actionsEnabled: boolean;
  onClose: () => void; submit: (action: Action) => void;
}) {
  const die = target ? board.dice.find(item => item.id === target.dieId) ?? null : null;
  if (!target || !die) return null;
  return die.owner === 'boss' ? <CursedDieDetails board={board} dieId={die.id} initialFace={target.face} diceDisplay={diceDisplay} onClose={onClose} />
    : <CollectibleDetails board={board} die={die} onClose={onClose} />;
}
