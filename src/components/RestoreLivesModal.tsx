import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { CONFIG, lifeRestoreCost } from '../game/config';
import type { Action, Board } from '../game/types';
import { CurrencyAmount } from './CurrencyAmount';

const hearts = (lives: number) => Array.from({ length: CONFIG.maxLives }, (_, index) => index < lives ? '♥' : '♡').join(' ');

export function RestoreLivesModal({ board, opened, busy, onClose, submit }: {
  board: Board; opened: boolean; busy: boolean; onClose: () => void; submit: (action: Action) => void;
}) {
  const restoresAtThisShop = board.shop?.lifeRestores ?? 0;
  const cost = lifeRestoreCost(restoresAtThisShop);
  const nextCost = lifeRestoreCost(restoresAtThisShop + 1);
  const full = board.lives >= CONFIG.maxLives;
  return <Modal opened={opened} onClose={onClose} title="RESTORE LIVES" centered transitionProps={{ duration: 0 }}>
    <Stack gap="sm">
      <Text size="xl" fw={800} c="red" aria-label={`${board.lives} of ${CONFIG.maxLives} lives`}>{hearts(board.lives)}</Text>
      {full ? <Text>All lives restored.</Text> : <>
        <Text>Restore one lost life.</Text>
      </>}
      <Text size="sm" c="dimmed">Next restore: <CurrencyAmount currency="gold" value={full ? cost : nextCost} /></Text>
      <Text size="sm" c="dimmed">Gold held: <CurrencyAmount currency="gold" value={board.gold} /></Text>
      <Group justify="flex-end"><Button variant="default" onClick={onClose}>Close</Button>
        <Button color="red" disabled={busy || full || board.gold < cost} onClick={() => submit({ type: 'RESTORE_LIFE' })}>
          {full ? 'ALL LIVES RESTORED' : <span aria-label={`Restore life for ${cost} Gold${board.gold < cost ? ', unavailable' : ''}`}>RESTORE LIFE <CurrencyAmount currency="gold" value={cost} accessible={false} /></span>}
        </Button>
      </Group>
    </Stack>
  </Modal>;
}
