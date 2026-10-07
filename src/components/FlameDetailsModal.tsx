import { Badge, Button, Group, Modal, Progress, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useState } from 'react';
import { activeFlameId, activeFlameInvestment, flameDetailsPresentation, flameEffectText, FLAMES } from '../game/flames';
import type { Action, Board, Flame } from '../game/types';
import { formatPlayerNumber } from '../game/copy';
import { RarityBadge } from './RarityBadge';

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
  const invested = target?.kind === 'bonfire' ? 100 : isEmber ? activeFlameInvestment(die.flame) : 0;
  const maxStoke = isEmber ? Math.min(board.gold, 100 - invested) : 0;
  const amount = Math.max(0, Math.min(Math.floor(stokeAmount || 0), maxStoke));
  const canStoke = isEmber && board.phase === 'shop' && actionsEnabled;
  useEffect(() => { setStokeAmount(0); }, [target?.dieId, target?.flame, target?.kind]);
  if (!flameId) return null;
  const definition = FLAMES[flameId];
  const details = flameDetailsPresentation(flameId, invested, board);
  const afterInvestment = invested + amount;
  const afterBoard = { ...board, gold: board.gold - amount };
  const afterDetails = flameDetailsPresentation(flameId, afterInvestment, afterBoard);
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
        <Group gap="xs"><Badge color={target?.kind === 'bonfire' ? 'red' : 'orange'} variant="light">
          🔥 {target?.kind === 'bonfire' ? 'BONFIRE' : target?.kind === 'ember' ? 'EMBER' : 'FLAME'}
        </Badge><RarityBadge rarity={definition.rarity} /></Group>
        {isEmber && <Badge color="yellow" variant="light">{formatPlayerNumber(board.gold)} Gold held</Badge>}
      </Group>
      <div className="flame-detail-progress">
        <Group justify="space-between"><Text size="sm" fw={800}>Investment: {formatPlayerNumber(invested)} / 100 Gold</Text><Text size="xs" c="dimmed">{target?.kind === 'bonfire' ? 'FULL STRENGTH' : 'BONFIRE AT 100'}</Text></Group>
        <Progress value={invested} color="orange" size="lg" mt={5} aria-label={`${definition.name} investment`} />
      </div>
      <div className="modal-stat flame-current-effect" data-testid="flame-current-effect">
        {details.maxChargeContribution !== null && <Text size="sm">
          <strong>Max Flame Contribution:</strong> +{formatPlayerNumber(details.maxChargeContribution)} Max Charge
        </Text>}
        <Text size="sm"><strong>{details.currentLabel}:</strong> {details.currentValue}</Text>
      </div>
      <Text size="sm">{definition.description}</Text>
      {flameId === 'fetch' && <Text size="sm" fw={700} c="orange">
        Target: {board.fetchTarget ? `D${board.fetchTarget.dieId + 1} face ${board.fetchTarget.physicalFace}` : 'Not set'}
      </Text>}
      {target?.kind === 'bonfire' && definition.bonfireDescription !== definition.description
        && <Text size="xs" c="dimmed">{definition.bonfireDescription}</Text>}
      {canStoke && <Stack gap="sm" data-testid="stoke-flame-controls" data-tutorial="stoke">
        {amount > 0 && <div className="modal-stat stoke-preview"><Text size="xs" c="teal" tt="uppercase">AFTER STOKE · {formatPlayerNumber(afterInvestment)}/100</Text>
          {afterDetails.maxChargeContribution !== null && <Text size="sm" fw={700}>+{formatPlayerNumber(afterDetails.maxChargeContribution)} Max Charge</Text>}
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
