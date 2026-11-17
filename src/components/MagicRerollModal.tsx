import { Button, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import { distinctDieOutcomes, outcomeIdentityKey, wholeDieEffectSuppressed } from '../game/dice';
import { validateAction } from '../game/engine';
import { effectOf, effectRuntime } from '../game/specialDice';
import type { Board, CollectibleDie, DieOutcomeIdentity, MagicRerollChoice, Rank } from '../game/types';
import type { DiceDisplay } from '../uiSettings';
import { Die } from './Die';

export type MagicSelectionMap = Record<number, DieOutcomeIdentity | null>;

export function eligibleMagicDice(board: Board, dieIds: readonly number[]): CollectibleDie[] {
  const selected = new Set(dieIds);
  return board.dice.filter((die): die is CollectibleDie => die.owner === 'player' && selected.has(die.id))
    .filter(die => {
      const effect = effectOf(die, 'magic');
      return !!effect && !wholeDieEffectSuppressed(die)
        && (effectRuntime(board.dieRoundState[die.id], effect)?.invocationsRemaining ?? 0) > 0
        && distinctDieOutcomes(die).length > 0;
    });
}

export function magicChoicesFromSelections(dice: readonly CollectibleDie[], selections: MagicSelectionMap): MagicRerollChoice[] {
  return dice.flatMap(die => selections[die.id] ? [{ dieId: die.id, outcome: selections[die.id]! }] : []);
}

export function MagicRerollModal({ board, dieIds, display, opened, selections, onSelectionsChange, onClose,
  onContinue, continuesToLightning }: {
  board: Board;
  dieIds: number[];
  display: DiceDisplay;
  opened: boolean;
  selections: MagicSelectionMap;
  onSelectionsChange: (value: MagicSelectionMap) => void;
  onClose: () => void;
  onContinue: (choices: MagicRerollChoice[]) => void;
  continuesToLightning: boolean;
}) {
  const dice = eligibleMagicDice(board, dieIds);
  const choices = magicChoicesFromSelections(dice, selections);
  const action = { type: 'MANUAL_REROLL' as const, dieIds, ...(choices.length ? { magicChoices: choices } : {}) };
  const reason = validateAction(board, action);
  const roster = board.dice.filter(die => die.owner === 'player');

  return <Modal opened={opened} onClose={onClose} centered size="lg" className="magic-reroll-modal"
    transitionProps={{ duration: 0 }}
    title={<Stack gap={0}><Text fw={900}>Magic</Text><Text size="sm" c="dimmed">Choose optional Manual Reroll outcomes</Text></Stack>}
    closeButtonProps={{ 'aria-label': 'Cancel Magic Manual Reroll' }}>
    <Stack gap="md">
      <Text size="sm">Choose an outcome for each Magic die, or leave it on Normal Roll to preserve its Uses.</Text>
      <div className="magic-dice-list" data-testid="magic-dice-list">
        {dice.map(die => {
          const effect = effectOf(die, 'magic')!;
          const remaining = effectRuntime(board.dieRoundState[die.id], effect)?.invocationsRemaining ?? 0;
          const outcome = selections[die.id] ?? null;
          const physicalIndex = outcome?.kind === 'rank' ? die.faces.findIndex(face => face.rank === outcome.rank) : -1;
          const preview = { ...die, value: (physicalIndex >= 0 ? physicalIndex + 1 : die.value) as Rank };
          const slot = roster.findIndex(candidate => candidate.id === die.id);
          return <Paper withBorder p="xs" className="magic-die-choice" key={die.id} data-testid={`magic-choice-${die.id}`}>
            <div className="magic-die-art"><Die die={preview} rosterSlot={slot} display={display} selected={false}
              highlighted={false} rolling={false} disabled detailsDisabled onClick={() => undefined} onDetails={() => undefined} /></div>
            <Stack gap={5} className="magic-choice-controls">
              <Group justify="space-between" gap="xs"><Text size="xs" fw={850}>D{slot + 1} · MAGIC {effect.level > 1 ? `LV ${effect.level}` : ''}</Text>
                <Text size="xs" c="dimmed">{remaining} Uses</Text></Group>
              <div className="magic-outcome-options" role="group" aria-label={`Magic outcome for die ${slot + 1}`}>
                <Button size="compact-sm" variant={outcome === null ? 'filled' : 'default'} color="gray"
                  aria-pressed={outcome === null} onClick={() => onSelectionsChange({ ...selections, [die.id]: null })}>NORMAL</Button>
                {distinctDieOutcomes(die).map(candidate => <Button key={outcomeIdentityKey(candidate)} size="compact-sm"
                  variant={outcome && outcomeIdentityKey(outcome) === outcomeIdentityKey(candidate) ? 'filled' : 'default'} color="grape"
                  aria-pressed={!!outcome && outcomeIdentityKey(outcome) === outcomeIdentityKey(candidate)}
                  aria-label={`Force die ${slot + 1} to ${candidate.rank}`}
                  onClick={() => onSelectionsChange({ ...selections, [die.id]: candidate })}>{candidate.rank}</Button>)}
              </div>
            </Stack>
          </Paper>;
        })}
      </div>
      {reason && <Text size="xs" c="dimmed" role="status">{reason}</Text>}
      <Group justify="flex-end"><Button variant="subtle" color="gray" onClick={onClose}>CANCEL</Button>
        <Button color="grape" disabled={reason !== null} data-testid="confirm-magic-reroll"
          onClick={() => { if (reason === null) onContinue(choices); }}>
          {continuesToLightning ? 'CONTINUE TO LIGHTNING' : 'ROLL DICE!'}
        </Button></Group>
    </Stack>
  </Modal>;
}
