import { Badge, Button, Group, Modal, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { activeFace, scoringPips } from '../game/dice';
import { chameleonTieDetail } from '../game/effectDescriptions';
import { validateAction } from '../game/engine';
import { dieSellBreakdown } from '../game/forge';
import { effectDetails } from '../game/specialDiePresentation';
import { SPECIAL_DICE, runtimeFor } from '../game/specialDice';
import type { Action, Board, CollectibleDie, DieEffectInstance, Rank } from '../game/types';
import type { DiceDisplay } from '../uiSettings';
import { CollectibleDieVisual } from './CollectibleDieVisual';
import { DieNumberSelector } from './DieNumberSelector';
import { DieEffectsLabel, DieTypeLabel } from './DieTypeLabel';
import { PipFace } from './PipFace';
import { RichDescription } from './RichDescription';

export interface FaceDetailsTarget { dieId: number; face: Rank }

function EffectCommands({ board, die, effect, busy, actionsEnabled, submit, closeAfter }: {
  board: Board; die: CollectibleDie; effect: DieEffectInstance; busy: boolean; actionsEnabled: boolean;
  submit: (action: Action) => void; closeAfter: () => void;
}) {
  if (board.phase !== 'round') return null;
  const runtime = runtimeFor(die, board.dieRoundState[die.id], effect.type);
  const invoke: Action | null = effect.type === 'chameleon' ? { type: 'INVOKE_CHAMELEON', dieId: die.id }
      : effect.type === 'flywheel' ? { type: 'INVOKE_FLYWHEEL', dieId: die.id } : null;
  return <Stack gap={6} className="die-details-actions" data-testid={`die-details-actions-${effect.id}`}>
    {invoke && <Button size="sm" disabled={busy || !actionsEnabled || validateAction(board, invoke) !== null}
      onClick={() => { submit(invoke); closeAfter(); }}>USE {SPECIAL_DICE[effect.type].name.toUpperCase()}</Button>}
    {effect.type === 'magic' && runtime && <>
      <DieNumberSelector label="Magic · choose the next Reroll" value={runtime.magicArmedFace}
        disabled={busy || !actionsEnabled}
        optionDisabled={face => validateAction(board, { type: 'ARM_MAGIC', dieId: die.id, face }) !== null}
        onChange={face => submit({ type: 'ARM_MAGIC', dieId: die.id, face })}
        testId={`number-selector-${effect.id}`} />
      {runtime.magicArmedFace !== null && <Button size="compact-sm" variant="default" disabled={busy || !actionsEnabled}
        onClick={() => submit({ type: 'DISARM_MAGIC', dieId: die.id })}>DISARM MAGIC</Button>}
    </>}
    {effect.type === 'furnace' && runtime && <Button size="sm" color="yellow"
      disabled={busy || !actionsEnabled || validateAction(board, { type: 'FEED_FURNACE', dieId: die.id, amount: 1 }) !== null}
      onClick={() => submit({ type: 'FEED_FURNACE', dieId: die.id, amount: 1 })}>FEED 1 GOLD</Button>}
    {(effect.type === 'weighted' || effect.type === 'jumpingBean') && <DieNumberSelector
      label={`${SPECIAL_DICE[effect.type].name} · choose a number`}
      value={effect.type === 'weighted' ? effect.persistent.weightedFace : effect.persistent.jumpingBeanNumber}
      disabled={busy || !actionsEnabled}
      optionDisabled={number => validateAction(board,
        { type: 'SET_DIE_EFFECT_NUMBER', dieId: die.id, effect: effect.type as 'weighted' | 'jumpingBean', number }) !== null}
      onChange={number => submit({ type: 'SET_DIE_EFFECT_NUMBER', dieId: die.id,
        effect: effect.type as 'weighted' | 'jumpingBean', number })}
      testId={`number-selector-${effect.id}`} />}
  </Stack>;
}

function EffectPanel({ board, die, effect, busy, actionsEnabled, submit, onClose }: {
  board: Board; die: CollectibleDie; effect: DieEffectInstance; busy: boolean; actionsEnabled: boolean;
  submit: (action: Action) => void; onClose: () => void;
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
    <EffectCommands board={board} die={die} effect={effect} busy={busy} actionsEnabled={actionsEnabled} submit={submit} closeAfter={onClose} />
  </Paper>;
}

function CollectibleDetails({ board, die, busy, actionsEnabled, onClose, submit }: {
  board: Board; die: CollectibleDie; busy: boolean; actionsEnabled: boolean; onClose: () => void; submit: (action: Action) => void;
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
          <Text size="sm" c="dimmed">Current sell value: {sale.total} Gold</Text></Stack>
      </Group>
      {die.effects.map(effect => <EffectPanel key={effect.id} board={board} die={die} effect={effect} busy={busy}
        actionsEnabled={actionsEnabled} submit={submit} onClose={onClose} />)}
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

export function FaceDetailsModal({ board, target, diceDisplay, busy, actionsEnabled, onClose, submit }: {
  board: Board; target: FaceDetailsTarget | null; diceDisplay: DiceDisplay; busy: boolean; actionsEnabled: boolean;
  onClose: () => void; submit: (action: Action) => void;
}) {
  const die = target ? board.dice.find(item => item.id === target.dieId) ?? null : null;
  if (!target || !die) return null;
  return die.owner === 'boss' ? <CursedDieDetails board={board} dieId={die.id} initialFace={target.face} diceDisplay={diceDisplay} onClose={onClose} />
    : <CollectibleDetails board={board} die={die} busy={busy} actionsEnabled={actionsEnabled} onClose={onClose} submit={submit} />;
}
