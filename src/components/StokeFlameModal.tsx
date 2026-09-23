import { Badge, Button, Group, Modal, Progress, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useState } from 'react';
import { activeFlameId, activeFlameInvestment, flameEffectText, flameFullEffectText, FLAMES } from '../game/flames';
import type { Action, Board } from '../game/types';

export function StokeFlameModal({ board, dieId, opened, busy, onClose, submit }: {
  board: Board;
  dieId: number | null;
  opened: boolean;
  busy: boolean;
  onClose: () => void;
  submit: (action: Action) => void;
}) {
  const [stokeAmount, setStokeAmount] = useState(0);
  const die = dieId === null ? null : board.dice.find(item => item.id === dieId) ?? null;
  const flameId = activeFlameId(die?.flame);
  const invested = activeFlameInvestment(die?.flame);
  const maxStoke = Math.min(board.gold, 100 - invested);
  const amount = Math.max(0, Math.min(Math.floor(stokeAmount || 0), maxStoke));
  useEffect(() => { if (opened) setStokeAmount(0); }, [opened, dieId]);
  function setAmount(value: number) { setStokeAmount(Math.max(0, Math.min(Math.floor(value || 0), maxStoke))); }
  function stoke() {
    if (!die || !flameId || amount < 1) return;
    const createsBonfire = invested + amount === 100;
    submit({ type: 'STOKE_FLAME', dieId: die.id, amount });
    setStokeAmount(0);
    if (createsBonfire) onClose();
  }
  const afterBoard = { ...board, gold: board.gold - amount };
  const afterInvestment = invested + amount;
  return <Modal opened={opened && !!die && !!flameId} onClose={onClose}
    title={die && flameId ? `D${die.id + 1} — Stoke ${FLAMES[flameId].name}` : 'Stoke Ember'} centered transitionProps={{ duration: 0 }}>
    {die && flameId && <Stack gap="sm" data-testid="stoke-flame-controls">
      <Group justify="space-between"><Badge color="orange" variant="light">🔥 EMBER</Badge><Badge color="yellow" variant="light">{board.gold} Gold held</Badge></Group>
      <div><Text fw={800}>{FLAMES[flameId].name}</Text><Text size="sm" c="dimmed">Spend Gold to Stoke this Ember in the Shop.</Text></div>
      <div><Group justify="space-between"><Text size="sm" fw={700}>{invested} / 100 → BONFIRE</Text><Text size="xs" c="dimmed">{100 - invested} remaining</Text></Group><Progress value={invested} color="orange" size="lg" mt={5} /></div>
      <div className="stoke-effects">
        <div className="modal-stat"><Text size="xs" c="dimmed" tt="uppercase">Current</Text><Text size="sm" fw={700}>{flameEffectText(flameId, invested, board)}</Text></div>
        {amount > 0 && <div className="modal-stat stoke-preview"><Text size="xs" c="teal" tt="uppercase">After Stoke · {afterInvestment}/100 · {afterBoard.gold} Gold</Text>
          <Text size="sm" fw={700}>{afterInvestment === 100 ? `Bonfire: ${FLAMES[flameId].bonfireDescription}` : flameEffectText(flameId, afterInvestment, afterBoard)}</Text></div>}
        <div className="modal-stat"><Text size="xs" c="dimmed" tt="uppercase">Full strength</Text><Text size="sm" fw={700}>{flameFullEffectText(flameId)}</Text></div>
        <div className="modal-stat"><Text size="xs" c="dimmed" tt="uppercase">At Bonfire</Text><Text size="sm" fw={700}>{FLAMES[flameId].bonfireDescription}</Text></div>
      </div>
      <Group gap="xs" wrap="wrap" className="stoke-controls">
        {[1, 5, 10].map(value => <Button key={value} variant="default" disabled={busy || maxStoke < 1} onClick={() => setAmount(amount + value)}>+{value}</Button>)}
        <Button variant="default" disabled={busy || maxStoke < 1} onClick={() => setAmount(maxStoke)}>Max</Button>
        <TextInput type="number" aria-label={`Stoke amount for ${FLAMES[flameId].name}`} value={amount}
          onChange={event => setAmount(Number(event.currentTarget.value))} min={0} max={maxStoke} className="stoke-input" />
      </Group>
      <Button color="orange" size="md" fullWidth disabled={busy || amount < 1} onClick={stoke}>Stoke {amount} Gold</Button>
    </Stack>}
  </Modal>;
}
