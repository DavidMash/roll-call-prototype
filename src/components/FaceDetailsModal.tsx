import { Badge, Button, Group, Modal, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { activeFace, scoringPips } from '../game/dice';
import { validateAction } from '../game/engine';
import { specialDieDetails } from '../game/specialDiePresentation';
import { SPECIAL_DICE } from '../game/specialDice';
import type { Action, Board, CollectibleDie, HexerFace, Rank } from '../game/types';
import type { DiceDisplay } from '../uiSettings';
import { CollectibleDieVisual } from './CollectibleDieVisual';
import { PipFace } from './PipFace';

export interface FaceDetailsTarget { dieId: number; face: Rank }

const hexerEffectLabel = (face: HexerFace): string => {
  const effect = face.hexerEffect;
  switch (effect.kind) {
    case 'goldenWeighted': return `Earn 1 Gold when Scored · weighted toward ${effect.target}`;
    case 'wild': return 'Wild for matching and straight Qualification';
    case 'wildWorkout': return `Wild for matching Qualification · gains +${effect.growthPips} Pips when Scored`;
    case 'workoutClockwork': return `Gains +${effect.growthPips} Pips when Scored · advances predictably when Rerolled`;
    case 'wildBonus': return `Wild for matching Qualification · +${effect.bonusPips} Pips when Scored`;
  }
};

function CommandControls({ board, die, busy, actionsEnabled, submit, closeAfter }: {
  board: Board;
  die: CollectibleDie;
  busy: boolean;
  actionsEnabled: boolean;
  submit: (action: Action) => void;
  closeAfter: () => void;
}) {
  const runtime = board.dieRoundState[die.id];
  const invoke = die.type === 'jumpingBean' ? { type: 'INVOKE_JUMPING_BEAN', dieId: die.id } as const
    : die.type === 'chameleon' ? { type: 'INVOKE_CHAMELEON', dieId: die.id } as const
      : die.type === 'flywheel' ? { type: 'INVOKE_FLYWHEEL', dieId: die.id } as const : null;
  if (board.phase !== 'round') return null;

  return <Stack gap={6} className="die-details-actions" data-testid="die-details-actions">
    {invoke && <Button size="sm" disabled={busy || !actionsEnabled || validateAction(board, invoke) !== null}
      onClick={() => { submit(invoke); closeAfter(); }}>USE ON COMMAND</Button>}
    {die.type === 'magic' && runtime && <>
      <Text size="xs" fw={800}>CHOOSE THE NEXT REROLL</Text>
      <Group gap={4} grow>
        {([1, 2, 3, 4, 5, 6] as const).map(face => {
          const action: Action = { type: 'ARM_MAGIC', dieId: die.id, face };
          return <Button key={face} size="compact-sm" variant={runtime.magicArmedFace === face ? 'filled' : 'default'}
            disabled={busy || !actionsEnabled || validateAction(board, action) !== null}
            aria-label={`Arm Magic die ${die.id} for face ${face}`} onClick={() => submit(action)}>{face}</Button>;
        })}
      </Group>
      {runtime.magicArmedFace !== null && <Button size="compact-sm" variant="default" disabled={busy || !actionsEnabled}
        onClick={() => submit({ type: 'DISARM_MAGIC', dieId: die.id })}>DISARM MAGIC</Button>}
    </>}
    {die.type === 'furnace' && runtime && <Button size="sm" color="yellow"
      disabled={busy || !actionsEnabled || validateAction(board, { type: 'FEED_FURNACE', dieId: die.id, amount: 1 }) !== null}
      onClick={() => submit({ type: 'FEED_FURNACE', dieId: die.id, amount: 1 })}>FEED 1 GOLD</Button>}
  </Stack>;
}

function CollectibleDetails({ board, die, busy, actionsEnabled, onClose, submit }: {
  board: Board;
  die: CollectibleDie;
  busy: boolean;
  actionsEnabled: boolean;
  onClose: () => void;
  submit: (action: Action) => void;
}) {
  const definition = SPECIAL_DICE[die.type];
  const details = specialDieDetails(die, board.dieRoundState[die.id]);
  const face = activeFace(die);
  const mutation = face.bossMutation;
  const title = die.type === 'normal' ? 'DIE DETAILS' : `${definition.name.toUpperCase()} · LV${die.level}`;

  return <Modal opened onClose={onClose} title={title} size="sm" centered transitionProps={{ duration: 0 }}
    data-testid="die-details-modal" classNames={{ content: 'die-details-modal' }}>
    <Stack gap="sm">
      <Group align="center" wrap="nowrap" className="die-details-identity">
        <CollectibleDieVisual type={die.type} face={die.value as Exclude<Rank, 7>} />
        <Stack gap={4} className="die-details-heading">
          <Text fw={900}>{definition.name}{die.type === 'normal' ? '' : ` · Lv${die.level}`}</Text>
          {definition.rarity && <Badge size="sm" variant="light" className={`rarity-badge rarity-${definition.rarity}`}>
            {definition.rarity}
          </Badge>}
        </Stack>
      </Group>

      {die.type !== 'normal' && <section className="die-details-effect" aria-label="Effect">
        <Text size="xs" fw={850} tt="uppercase" c="dimmed">Effect</Text>
        <Text size="sm">{details.description}</Text>
      </section>}

      {(details.status.length > 0 || details.freePlayRemaining) && <section aria-label="Current status">
        <Text size="xs" fw={850} tt="uppercase" c="dimmed" mb={4}>Current status</Text>
        <div className="die-details-status-list">
          {details.status.map(item => <div className="die-details-status-row" key={item.label}>
            <span>{item.label}</span><strong>{item.value}</strong>
          </div>)}
        </div>
        {details.freePlayRemaining && <div className="free-play-status" data-testid="free-play-status">
          <Text size="xs">Free Plays remaining by face</Text>
          <div>{([1, 2, 3, 4, 5, 6] as const).map(rank => <span key={rank}><b>{rank}:</b> {details.freePlayRemaining![rank]}</span>)}</div>
        </div>}
      </section>}

      {mutation?.kind === 'infected' && <Paper className="die-mutation-warning infected" p="xs" role="status">
        <Text size="xs" fw={900}>INFECTED FACE</Text>
        <Text size="sm">−3 Pips while exposed.{die.type === 'normal' ? '' : " This die's special effect is suppressed."}</Text>
      </Paper>}
      {mutation?.kind === 'snakeEyes' && <Paper className="die-mutation-warning snake-eyes" p="xs" role="status">
        <Text size="xs" fw={900}>SNAKE EYES</Text>
        <Text size="sm">This face was changed from {mutation.originalRank} to 1 for this encounter.</Text>
      </Paper>}

      <CommandControls board={board} die={die} busy={busy} actionsEnabled={actionsEnabled}
        submit={submit} closeAfter={onClose} />
      <Button variant="default" onClick={onClose}>Close</Button>
    </Stack>
  </Modal>;
}

function CursedDieDetails({ board, dieId, initialFace, diceDisplay, onClose }: {
  board: Board;
  dieId: number;
  initialFace: Rank;
  diceDisplay: DiceDisplay;
  onClose: () => void;
}) {
  const [focusedFace, setFocusedFace] = useState<Rank>(initialFace);
  const die = board.dice.find(item => item.id === dieId && item.owner === 'boss');
  useEffect(() => setFocusedFace(initialFace), [dieId, initialFace]);
  if (!die) return null;
  const face = die.faces[focusedFace - 1];
  if (!face || !('hexerEffect' in face)) return null;

  return <Modal opened onClose={onClose} title="CURSED DIE · FACES" size="lg" centered transitionProps={{ duration: 0 }}
    data-testid="cursed-die-details-modal">
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 3, sm: 7 }} spacing="xs" className="manage-face-grid" aria-label="Cursed Die faces">
        {die.faces.map((candidate, index) => {
          const physicalFace = index + 1 as Rank;
          return <Paper component="button" type="button" key={physicalFace} withBorder p="xs"
            className={`manage-face-tile ${focusedFace === physicalFace ? 'focused' : ''} ${die.value === physicalFace ? 'exposed-face' : ''}`}
            aria-label={`Cursed Die face ${physicalFace}`} aria-pressed={focusedFace === physicalFace}
            onClick={() => setFocusedFace(physicalFace)}>
            {diceDisplay === 'pips' ? <PipFace value={candidate.rank} compact label={`Cursed Die face ${physicalFace}`} />
              : <span className="manage-face-number" aria-label={`Cursed Die face ${physicalFace}`}>{candidate.rank}</span>}
            <strong>FACE {physicalFace}</strong>
            {die.value === physicalFace && <span className="manage-face-exposed">EXPOSED</span>}
          </Paper>;
        })}
      </SimpleGrid>
      <Text fw={850}>Face {focusedFace} · {scoringPips(face)} Pips</Text>
      <Text c="violet">{hexerEffectLabel(face)}</Text>
      <Button variant="default" onClick={onClose}>Close</Button>
    </Stack>
  </Modal>;
}

export function FaceDetailsModal({ board, target, diceDisplay, busy, actionsEnabled, onClose, submit }: {
  board: Board;
  target: FaceDetailsTarget | null;
  diceDisplay: DiceDisplay;
  busy: boolean;
  actionsEnabled: boolean;
  onClose: () => void;
  submit: (action: Action) => void;
}) {
  const die = target ? board.dice.find(item => item.id === target.dieId) ?? null : null;
  if (!target || !die) return null;
  return die.owner === 'boss'
    ? <CursedDieDetails board={board} dieId={die.id} initialFace={target.face} diceDisplay={diceDisplay} onClose={onClose} />
    : <CollectibleDetails board={board} die={die} busy={busy} actionsEnabled={actionsEnabled} onClose={onClose} submit={submit} />;
}
