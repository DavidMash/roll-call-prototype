import { Badge, Button, Group, Modal, Progress, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useState } from 'react';
import { activeFlameId, activeFlameInvestment, flameEffectText, FLAMES } from '../game/flames';
import type { Action, Board, Flame } from '../game/types';
import { formatPlayerNumber } from '../game/copy';

export interface FlameDetailsTarget {
  flame: Flame;
  kind: 'ember' | 'bonfire' | 'offer';
  dieId?: number;
}

export function FlameDetailsModal({ board, target, busy, actionsEnabled, onClose, submit }: {
  board: Board;
  target: FlameDetailsTarget | null;
  busy: boolean;
  actionsEnabled: boolean;
  onClose: () => void;
  submit: (action: Action) => void;
}) {
  const [stokeAmount, setStokeAmount] = useState(0);
  const die = target?.dieId === undefined ? null : board.dice.find(item => item.id === target.dieId) ?? null;
  const activeId = activeFlameId(die?.flame);
  const flameId = target?.flame ?? null;
  const isEmber = target?.kind === 'ember' && !!die && activeId === flameId;
  const invested = isEmber ? activeFlameInvestment(die.flame) : 0;
  const maxStoke = isEmber ? Math.min(board.gold, 100 - invested) : 0;
  const amount = Math.max(0, Math.min(Math.floor(stokeAmount || 0), maxStoke));
  const canStoke = isEmber && board.phase === 'shop' && actionsEnabled;
  useEffect(() => { setStokeAmount(0); }, [target?.dieId, target?.flame, target?.kind]);
  if (!flameId) return null;
  const definition = FLAMES[flameId];
  const afterInvestment = invested + amount;
  const afterBoard = { ...board, gold: board.gold - amount };
  function setAmount(value: number) { setStokeAmount(Math.max(0, Math.min(Math.floor(value || 0), maxStoke))); }
  function stoke() {
    if (!die || !canStoke || amount < 1) return;
    const createsBonfire = invested + amount === 100;
    submit({ type: 'STOKE_FLAME', dieId: die.id, amount });
    setStokeAmount(0);
    if (createsBonfire) onClose();
  }

  return <Modal opened={target !== null && (target.kind !== 'ember' || isEmber)} onClose={onClose}
    title={definition.name} centered transitionProps={{ duration: 0 }} data-testid="flame-details-modal">
    <Stack gap="sm">
      <Group justify="space-between">
        <Badge color={target?.kind === 'bonfire' ? 'red' : 'orange'} variant="light">
          🔥 {target?.kind === 'bonfire' ? 'BONFIRE' : target?.kind === 'ember' ? 'EMBER' : 'FLAME'}
        </Badge>
        {isEmber && <Badge color="yellow" variant="light">{formatPlayerNumber(board.gold)} Gold held</Badge>}
      </Group>
      {isEmber && <div className="flame-detail-progress">
        <Group justify="space-between"><Text size="sm" fw={800}>Ember · {formatPlayerNumber(invested)} / 100 Gold</Text><Text size="xs" c="dimmed">BONFIRE AT 100</Text></Group>
        <Progress value={invested} color="orange" size="lg" mt={5} aria-label={`${definition.name} Ember progress`} />
      </div>}
      {target?.kind === 'bonfire' && <Text size="sm" fw={800}>Bonfire</Text>}
      <Text size="sm">{target?.kind === 'bonfire' ? definition.bonfireDescription : definition.description}</Text>
      {isEmber && <Text size="xs" c="dimmed">Current: {flameEffectText(flameId, invested, board)}</Text>}
      {canStoke && <Stack gap="sm" data-testid="stoke-flame-controls" data-tutorial="stoke">
        {amount > 0 && <div className="modal-stat stoke-preview"><Text size="xs" c="teal" tt="uppercase">AFTER STOKE · {formatPlayerNumber(afterInvestment)}/100</Text>
          <Text size="sm" fw={700}>{afterInvestment === 100 ? definition.bonfireDescription : flameEffectText(flameId, afterInvestment, afterBoard)}</Text></div>}
        <Group gap="xs" wrap="wrap" className="stoke-controls">
          {[1, 5, 10].map(value => <Button key={value} variant="default" disabled={busy || maxStoke < 1} onClick={() => setAmount(amount + value)}>+{value}</Button>)}
          <Button variant="default" disabled={busy || maxStoke < 1} onClick={() => setAmount(maxStoke)}>Max</Button>
          <TextInput type="number" aria-label={`Stoke amount for ${definition.name}`} value={amount}
            onChange={event => setAmount(Number(event.currentTarget.value))} min={0} max={maxStoke} className="stoke-input" />
        </Group>
        <Button color="orange" size="md" fullWidth disabled={busy || amount < 1} onClick={stoke}>STOKE {formatPlayerNumber(amount)} GOLD</Button>
      </Stack>}
    </Stack>
  </Modal>;
}
