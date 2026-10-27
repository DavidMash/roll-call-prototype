import { Badge, Button, Group, Modal, Progress, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { briberyFactor, briberyNextCost, briberyXMultIncrement, flameDetailsPresentation, flameEffectText, flameInstanceById, flameStokeLimits, fluxCapacitorChargeMultiplier, FLAMES } from '../game/flames';
import type { Action, Board, DiceInventory, Flame, FlameInstanceId, FlameStage } from '../game/types';
import { formatPlayerNumber } from '../game/copy';
import { RarityBadge } from './RarityBadge';
import { activeDieLabel } from '../game/inventory';
import { RichDescription } from './RichDescription';
import { HANDS } from '../game/hands';
import { CurrencyAmount } from './CurrencyAmount';

export interface FlameDetailsTarget {
  flame?: Flame;
  flameInstanceId?: FlameInstanceId;
  kind: FlameStage | 'offer';
}

export function FlameDetailsModal({ board, inventory: _inventory, target, busy, actionsEnabled, onClose, submit }: {
  board: Board; inventory?: DiceInventory; target: FlameDetailsTarget | null; busy: boolean; actionsEnabled: boolean;
  onClose: () => void; submit: (action: Action) => void;
}) {
  const [stokeDraft, setStokeDraft] = useState('0');
  const instance = target?.flameInstanceId === undefined ? null : flameInstanceById(board, target.flameInstanceId);
  const flameId = instance?.type ?? target?.flame ?? null;
  const invested = instance?.investedGold ?? 0;
  const isEmber = !!instance && instance.stage === 'ember';
  const maxStoke = isEmber ? flameStokeLimits(board, instance.instanceId).maximumAmount : 0;
  function normalizedAmount(value: string): number {
    if (!/^\d+$/.test(value)) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(Math.floor(parsed), maxStoke)) : maxStoke;
  }
  const amount = normalizedAmount(stokeDraft);
  const canStoke = isEmber && board.phase === 'shop' && board.shop?.stage === 'flames' && actionsEnabled;
  useEffect(() => { setStokeDraft('0'); }, [target?.flameInstanceId, target?.flame, target?.kind]);
  if (!flameId) return null;
  const definition = FLAMES[flameId];
  const details = flameDetailsPresentation(flameId, invested, board);
  const afterInvestment = invested + amount;
  const afterDetails = flameDetailsPresentation(flameId, afterInvestment, { ...board, gold: board.gold - amount });
  function setAmount(value: number) { setStokeDraft(String(normalizedAmount(String(value)))); }
  function stepAmount(delta: -1 | 1) { setStokeDraft(current => String(normalizedAmount(String(normalizedAmount(current) + delta)))); }
  function stoke() {
    if (!instance || !canStoke || amount < 1) return;
    submit({ type: 'STOKE_FLAME', flameInstanceId: instance.instanceId, amount });
    setStokeDraft('0');
    if (afterInvestment === 100) onClose();
  }
  const stage = instance?.stage ?? 'ember';
  return <Modal opened={target !== null && (target.kind === 'offer' || !!instance)} onClose={onClose}
    title={definition.name} centered transitionProps={{ duration: 0 }} data-testid="flame-details-modal"
    closeButtonProps={{ 'aria-label': 'Close' }}>
    <Stack gap="sm">
      <Group justify="space-between"><Group gap="xs"><Badge color={stage === 'bonfire' ? 'red' : 'orange'} variant="light">
        🔥 {target?.kind === 'offer' ? 'FLAME' : stage.toUpperCase()}
      </Badge><RarityBadge rarity={definition.rarity} /></Group>
        {isEmber && <Badge color="yellow" variant="light"><CurrencyAmount currency="gold" value={board.gold} /> held</Badge>}</Group>
      <div className="flame-detail-progress"><Group justify="space-between"><Text size="sm" fw={800}>Investment: <CurrencyAmount currency="gold" value={invested} /> / <CurrencyAmount currency="gold" value={100} /></Text>
        <Text size="xs" c="dimmed">{stage === 'bonfire' ? 'FULL STRENGTH' : 'BONFIRE AT 100'}</Text></Group>
        <Progress value={invested} color="orange" size="lg" mt={5} aria-label={`${definition.name} investment`} /></div>
      {isEmber && <Text size="sm" fw={850} c="orange">Complete this Bonfire: <CurrencyAmount currency="temper" value={10} sign="+" /></Text>}
      <div className="modal-stat flame-current-effect" data-testid="flame-current-effect">
        {details.maxChargeContribution !== null && <Text size="sm"><strong>Max Flame Contribution:</strong> +{formatPlayerNumber(details.maxChargeContribution)} Max Charge</Text>}
        <Text size="sm"><strong>{details.currentLabel}:</strong> {details.currentValue}</Text>
      </div>
      <RichDescription copy={definition.verboseDescription} />
      {flameId === 'fluxCapacitor' && <Text size="xs" c="dimmed">Example at current strength: if Magnetic affects 2 other dice, your Charge is multiplied by ×{formatPlayerNumber(fluxCapacitorChargeMultiplier(invested, 2))}.</Text>}
      {flameId === 'fetch' && <Text size="sm" fw={700} c="orange">FETCH Face: {board.fetchTarget ? `${activeDieLabel(board, board.fetchTarget.dieId)} face ${board.fetchTarget.physicalFace}` : 'Not set'}</Text>}
      {flameId === 'targetPractice' && <Text size="sm" fw={700} c="orange">Target Hand: {board.targetPracticeHand ? HANDS[board.targetPracticeHand].name : 'Not set'}</Text>}
      {flameId === 'bribery' && <div className="modal-stat" data-testid="bribery-runtime-details">
        <Text size="sm"><strong>Added per Bribe:</strong> +{formatPlayerNumber(briberyXMultIncrement(invested))} XMult</Text>
        <Text size="sm"><strong>Next Bribe:</strong> <CurrencyAmount currency="gold" value={briberyNextCost(board.interactiveFlames.briberyPurchasedThisRound)} /></Text>
        <Text size="sm"><strong>Pending:</strong> {board.interactiveFlames.briberyPendingCount > 0
          ? `×${formatPlayerNumber(briberyFactor(invested, board.interactiveFlames.briberyPendingCount))} armed (${board.interactiveFlames.briberyPendingCount} Bribe${board.interactiveFlames.briberyPendingCount === 1 ? '' : 's'})`
          : '×1 · not armed'}</Text>
        {invested <= 0 && <Text size="xs" c="dimmed">Stoke this Ember before Bribery can add XMult.</Text>}
      </div>}
      {stage === 'bonfire' && <Text size="xs" c="dimmed">{definition.bonfireDescription}</Text>}
      {canStoke && <Stack gap="sm" data-testid="stoke-flame-controls" data-tutorial="stoke">
        {amount > 0 && <div className="modal-stat stoke-preview"><Text size="xs" c="teal" tt="uppercase">AFTER STOKE · {formatPlayerNumber(afterInvestment)}/100</Text>
          {afterDetails.maxChargeContribution !== null && <Text size="sm" fw={700}>+{formatPlayerNumber(afterDetails.maxChargeContribution)} Max Charge</Text>}
          <Text size="sm" fw={700}>{afterInvestment === 100 ? definition.bonfireDescription : flameEffectText(flameId, afterInvestment, board)}</Text></div>}
        <Group gap="xs" wrap="wrap" className="stoke-controls"><div className="stoke-stepper">
          <input className="stoke-stepper-value" type="number" inputMode="numeric" step={1} min={0} max={maxStoke}
            aria-label={`Stoke amount for ${definition.name}`} disabled={busy} value={stokeDraft}
            onChange={event => { if (/^\d*$/.test(event.currentTarget.value)) setStokeDraft(event.currentTarget.value); }}
            onBlur={() => setAmount(amount)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); stoke(); } }} />
          <div className="stoke-stepper-buttons"><button type="button" aria-label="Increase investment" disabled={busy || amount >= maxStoke} onClick={() => stepAmount(1)}>▲</button>
            <button type="button" aria-label="Decrease investment" disabled={busy || amount <= 0} onClick={() => stepAmount(-1)}>▼</button></div></div>
          <Button variant="default" disabled={busy || maxStoke < 1} onClick={() => setAmount(maxStoke)}>Max</Button></Group>
        <Button color="orange" size="md" fullWidth disabled={busy || amount < 1} onClick={stoke}><span className="button-currency-label">STOKE <CurrencyAmount currency="gold" value={amount} /></span></Button>
      </Stack>}
    </Stack>
  </Modal>;
}
