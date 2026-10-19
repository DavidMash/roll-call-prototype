import { Button, Modal, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { scoringPips } from '../game/dice';
import type { Action, Board, HexerFace, Rank } from '../game/types';
import type { DiceDisplay } from '../uiSettings';
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

export function FaceDetailsModal({ board, target, diceDisplay, onClose }: {
  board: Board;
  target: FaceDetailsTarget | null;
  diceDisplay: DiceDisplay;
  busy: boolean;
  actionsEnabled: boolean;
  onClose: () => void;
  submit: (action: Action) => void;
}) {
  const [focusedFace, setFocusedFace] = useState<Rank>(1);
  const die = target ? board.dice.find(item => item.id === target.dieId) ?? null : null;
  useEffect(() => { if (target) setFocusedFace(target.face); }, [target?.dieId, target?.face]);
  if (!die) return null;
  const rosterSlot = board.dice.filter(item => item.owner === 'player').findIndex(item => item.id === die.id);
  const dieCode = die.owner === 'boss' ? 'CURSED DIE' : `D${rosterSlot + 1}`;
  const face = die.faces[focusedFace - 1];
  if (!face) return null;
  const mutation = face.bossMutation;
  const isHexerFace = 'hexerEffect' in face;

  return <Modal opened={target !== null} onClose={onClose} title={`${dieCode} · PHYSICAL FACES`}
    size="lg" centered transitionProps={{ duration: 0 }} data-testid="face-details-modal">
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 3, sm: die.faces.length > 6 ? 7 : 6 }} spacing="xs" className="manage-face-grid" aria-label={`Faces on ${dieCode}`}>
        {die.faces.map((candidate, index) => {
          const physicalFace = index + 1 as Rank;
          const isFetchTarget = board.fetchTarget?.dieId === die.id && board.fetchTarget.physicalFace === physicalFace;
          return <Paper component="button" type="button" key={physicalFace} withBorder p="xs" data-testid={`manage-face-${physicalFace}`}
            className={`manage-face-tile ${focusedFace === physicalFace ? 'focused' : ''} ${die.value === physicalFace ? 'exposed-face' : ''}`}
            aria-label={`${dieCode} face ${physicalFace}${isFetchTarget ? ', Fetch target' : ''}`}
            aria-pressed={focusedFace === physicalFace} onClick={() => setFocusedFace(physicalFace)}>
            {diceDisplay === 'pips' ? <PipFace value={candidate.rank} compact label={`${dieCode} face ${physicalFace}`} />
              : <span className="manage-face-number" aria-label={`${dieCode} face ${physicalFace}`}>{candidate.rank}</span>}
            <strong>FACE {physicalFace}</strong>
            {die.value === physicalFace && <span className="manage-face-exposed">EXPOSED</span>}
            {isFetchTarget && <span className="manage-face-fetch">FETCH</span>}
          </Paper>;
        })}
      </SimpleGrid>
      <Text fw={850}>{dieCode} · Face {focusedFace} · {scoringPips(face)} Pips</Text>
      {mutation?.kind === 'infected' && <Text c="red">Infected: −3 Pips and this die's whole-die effect is suppressed while exposed.</Text>}
      {mutation?.kind === 'snakeEyes' && <Text c="orange">Snake Eyes changed this face from {mutation.originalRank} to 1 for this encounter.</Text>}
      {isHexerFace && <Text c="violet">Hexer face rule: {hexerEffectLabel(face)}</Text>}
      {!mutation && !isHexerFace && <Text c="dimmed">This physical face has no additional face rule.</Text>}
      <Button variant="default" onClick={onClose}>Close</Button>
    </Stack>
  </Modal>;
}
