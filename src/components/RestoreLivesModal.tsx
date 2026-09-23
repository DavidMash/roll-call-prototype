import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { CONFIG, lifeRestoreCost } from '../game/config';
import type { Action, Board } from '../game/types';

const hearts = (lives: number) => Array.from({ length: CONFIG.maxLives }, (_, index) => index < lives ? '♥' : '♡').join(' ');

export function RestoreLivesModal({ board, opened, busy, onClose, submit }: {
  board: Board; opened: boolean; busy: boolean; onClose: () => void; submit: (action: Action) => void;
}) {
  const cost = lifeRestoreCost(board.livesPurchasedThisRun);
  const nextCost = lifeRestoreCost(board.livesPurchasedThisRun + 1);
  const full = board.lives >= CONFIG.maxLives;
  return <Modal opened={opened} onClose={onClose} title="RESTORE LIVES" centered transitionProps={{ duration: 0 }}>
    <Stack gap="sm">
      <Text size="xl" fw={800} c="red" aria-label={`${board.lives} of ${CONFIG.maxLives} lives`}>{hearts(board.lives)}</Text>
      {full ? <Text>All lives restored.</Text> : <>
        <Text>Restore one lost life.</Text>
        <Text fw={800}>{cost} Gold</Text>
      </>}
      <Text size="sm" c="dimmed">Next restore: {full ? cost : nextCost} Gold</Text>
      <Text size="sm" c="dimmed">Gold held: {board.gold}</Text>
      <Group justify="flex-end"><Button variant="default" onClick={onClose}>Close</Button>
        <Button color="red" disabled={busy || full || board.gold < cost} onClick={() => submit({ type: 'RESTORE_LIFE' })}>
          {full ? 'ALL LIVES RESTORED' : board.gold < cost ? 'NOT ENOUGH GOLD' : 'RESTORE LIFE'}
        </Button>
      </Group>
    </Stack>
  </Modal>;
}
