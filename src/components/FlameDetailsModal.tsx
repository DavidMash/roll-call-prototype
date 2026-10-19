import { Badge, Button, Group, Modal, Progress, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { activeFlameId, activeFlameInvestment, flameDetailsPresentation, flameEffectText, flameStokeLimits, FLAMES } from '../game/flames';
import type { Action, Board, DiceInventory, Flame } from '../game/types';
import { formatPlayerNumber } from '../game/copy';
import { RarityBadge } from './RarityBadge';

export interface FlameDetailsTarget {
  flame: Flame;
  kind: 'ember' | 'bonfire' | 'offer';
  dieId?: number;
}

export function FlameDetailsModal({ board, inventory, target, busy, actionsEnabled, onClose, submit }: {
  board: Board;
  inventory?: DiceInventory;
  target: FlameDetailsTarget | null;
  busy: boolean;
  actionsEnabled: boolean;
  onClose: () => void;
  submit: (action: Action) => void;
}) {
  const [stokeDraft, setStokeDraft] = useState('0');
  const die = target?.dieId === undefined ? null
    : inventory?.instances[target.dieId] ?? board.dice.find(item => item.id === target.dieId) ?? null;
  const activeId = activeFlameId(die?.flame);
  const flameId = target?.flame ?? null;
  const isEmber = target?.kind === 'ember' && !!die && activeId === flameId;
  const invested = target?.kind === 'bonfire' ? 100 : isEmber ? activeFlameInvestment(die.flame) : 0;
  const maxStoke = isEmber ? flameStokeLimits(board, die.id, inventory).maximumAmount : 0;
  function normalizedAmount(value: string): number {
    if (!/^\d+$/.test(value)) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(Math.floor(parsed), maxStoke)) : maxStoke;
  }
  const amount = normalizedAmount(stokeDraft);
  const canStoke = isEmber && board.phase === 'shop' && board.shop?.stage === 'fireKeeping' && actionsEnabled;
  useEffect(() => { setStokeDraft('0'); }, [target?.dieId, target?.flame, target?.kind]);
  if (!flameId) return null;
  const definition = FLAMES[flameId];
  const details = flameDetailsPresentation(flameId, invested, board);
  const afterInvestment = invested + amount;
  const afterBoard = { ...board, gold: board.gold - amount };
  const afterDetails = flameDetailsPresentation(flameId, afterInvestment, afterBoard);
  function commitDraft(value = stokeDraft): number {
    const normalized = normalizedAmount(value);
    setStokeDraft(String(normalized));
    return normalized;
  }
  function setAmount(value: number) { setStokeDraft(String(normalizedAmount(String(value)))); }
  function stepAmount(delta: -1 | 1) {
    setStokeDraft(current => String(normalizedAmount(String(normalizedAmount(current) + delta))));
  }
  function stoke() {
    const committedAmount = commitDraft();
    if (!die || !canStoke || committedAmount < 1) return;
    const createsBonfire = invested + committedAmount === 100;
    submit({ type: 'STOKE_FLAME', dieId: die.id, amount: committedAmount });
    setStokeDraft('0');
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
        <>{details.maxChargeContribution !== null && <Text size="sm">
          <strong>Max Flame Contribution:</strong> +{formatPlayerNumber(details.maxChargeContribution)} Max Charge
        </Text>}
        <Text size="sm"><strong>{details.currentLabel}:</strong> {details.currentValue}</Text></>
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
          <div className="stoke-stepper">
            <input className="stoke-stepper-value" type="number" inputMode="numeric" step={1} min={0} max={maxStoke}
              aria-label={`Stoke amount for ${definition.name}`} disabled={busy} value={stokeDraft}
              onChange={event => { if (/^\d*$/.test(event.currentTarget.value)) setStokeDraft(event.currentTarget.value); }}
              onBlur={() => commitDraft()} onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); stoke(); }
              }} />
            <div className="stoke-stepper-buttons">
              <button type="button" aria-label="Increase investment" disabled={busy || amount >= maxStoke}
                onClick={() => stepAmount(1)}>▲</button>
              <button type="button" aria-label="Decrease investment" disabled={busy || amount <= 0}
                onClick={() => stepAmount(-1)}>▼</button>
            </div>
          </div>
          <Button variant="default" disabled={busy || maxStoke < 1} onClick={() => setAmount(maxStoke)}>Max</Button>
        </Group>
        <Button color="orange" size="md" fullWidth disabled={busy || amount < 1} onClick={stoke}>STOKE {formatPlayerNumber(amount)} GOLD</Button>
      </Stack>}
    </Stack>
  </Modal>;
}
