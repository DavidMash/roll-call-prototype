import { Badge, Button, Group, Modal, Progress, Stack, Text } from '@mantine/core';
import { BRIBERY_ROUND_GOLD_CAP, briberyFactor, briberyXMultPerGold, flameDetailsPresentation, flameInstanceById, fluxCapacitorChargeMultiplier, FLAMES } from '../game/flames';
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
  kind: FlameStage | 'offer' | 'info';
}

export function FlameDetailsModal({ board, inventory: _inventory, target, busy: _busy, actionsEnabled: _actionsEnabled, onClose, submit: _submit }: {
  board: Board; inventory?: DiceInventory; target: FlameDetailsTarget | null; busy: boolean; actionsEnabled: boolean;
  onClose: () => void; submit: (action: Action) => void;
}) {
  const instance = target?.flameInstanceId === undefined ? null : flameInstanceById(board, target.flameInstanceId);
  const flameId = instance?.type ?? target?.flame ?? null;
  const invested = instance?.investedGold ?? 0;
  const isEmber = !!instance && instance.stage === 'ember';
  if (!flameId) return null;
  const definition = FLAMES[flameId];
  if (target?.kind === 'info') return <Modal opened onClose={onClose} title={definition.name} centered
    transitionProps={{ duration: 0 }} data-testid="flame-info-dialog" closeButtonProps={{ 'aria-label': 'Close' }}>
    <Stack gap="sm"><RichDescription copy={definition.verboseDescription} />
      <Button variant="default" onClick={onClose}>CLOSE</Button></Stack>
  </Modal>;
  const details = flameDetailsPresentation(flameId, invested, board);
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
        {details.maxChargeContribution !== null && <Text size="sm"><strong>Solo Max Charge:</strong> ×{formatPlayerNumber(details.maxChargeContribution)} <span>(multiple Charge Flames add pair synergy)</span></Text>}
        <Text size="sm"><strong>{details.currentLabel}:</strong> {details.currentValue}</Text>
      </div>
      <RichDescription copy={definition.verboseDescription} />
      {flameId === 'fluxCapacitor' && <Text size="xs" c="dimmed">Example at current strength: if Magnetic affects 2 other dice, your Charge is multiplied by ×{formatPlayerNumber(fluxCapacitorChargeMultiplier(invested, 2))}.</Text>}
      {flameId === 'fetch' && <Text size="sm" fw={700} c="orange">FETCH Face: {board.fetchTarget ? `${activeDieLabel(board, board.fetchTarget.dieId)} face ${board.fetchTarget.physicalFace}` : 'Not set'}</Text>}
      {flameId === 'targetPractice' && <Text size="sm" fw={700} c="orange">Target Hand: {board.targetPracticeHand ? HANDS[board.targetPracticeHand].name : 'Not set'}</Text>}
      {flameId === 'bribery' && <div className="modal-stat" data-testid="bribery-runtime-details">
        <Text size="sm"><strong>Added per Gold:</strong> +{formatPlayerNumber(briberyXMultPerGold(invested))} XMult</Text>
        <Text size="sm"><strong>Round cap:</strong> <CurrencyAmount currency="gold" value={BRIBERY_ROUND_GOLD_CAP} /></Text>
        <Text size="sm"><strong>Pending:</strong> {board.interactiveFlames.briberyPendingGold > 0
          ? `×${formatPlayerNumber(briberyFactor(invested, board.interactiveFlames.briberyPendingGold))} armed (${board.interactiveFlames.briberyPendingGold} Gold)`
          : '×1 · not armed'}</Text>
        {invested <= 0 && <Text size="xs" c="dimmed">Stoke this Ember before Bribery can add XMult.</Text>}
      </div>}
      {stage === 'bonfire' && <Text size="xs" c="dimmed">{definition.bonfireDescription}</Text>}
    </Stack>
  </Modal>;
}
