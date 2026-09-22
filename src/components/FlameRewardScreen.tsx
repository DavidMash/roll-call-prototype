import { Badge, Button, Card, Group, Modal, Paper, Progress, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { useState } from 'react';
import { flameRerollCost } from '../game/config';
import {
  activeFlameId, activeFlameInvestment, chargeGainPerRoll, dragonsHoardMultiplier, FLAMES, flameProgress, hasXMultFlame,
  lowballMultiplier, moneyToBurnMultiplier, standardFlameMultiplier, targetPracticeMultiplier,
  trainerChance, wellTrainedMultiplier,
} from '../game/flames';
import type { Action, Board, Flame, GameEvent } from '../game/types';
import { Die } from './Die';
import { RoundPayoutSummary } from './RoundPayoutSummary';
import { ScoreResolution } from './ScoreResolution';

const number = (value: number) => Number(value.toFixed(4));
function currentEffect(id: Flame, invested: number, board: Board): string {
  switch (id) {
    case 'personalTrainer': return `${number(trainerChance(invested) * 100)}% chance`;
    case 'charge': return `+${number(chargeGainPerRoll(invested))} Charge per roll`;
    case 'targetPractice': return `×${number(targetPracticeMultiplier(invested))}`;
    case 'dragonsHoard': return `×${number(dragonsHoardMultiplier(invested, board.gold))} at ${board.gold} held Gold`;
    case 'wellTrained': return `×${number(wellTrainedMultiplier(invested, 10))} at 10 prior plays`;
    case 'moneyToBurn': return `×${number(moneyToBurnMultiplier(invested, board.lifetimeNormalShopGoldSpent))} at ${board.lifetimeNormalShopGoldSpent} shop Gold`;
    case 'lowball': return `up to ×${number(lowballMultiplier(invested, 2))}`;
    case 'hotStreak': return `+${number(0.5 * flameProgress(invested))} per chain step`;
    default: return `×${number(standardFlameMultiplier(invested))}`;
  }
}
function fullEffect(id: Flame): string {
  switch (id) {
    case 'personalTrainer': return '75% chance when this die scores';
    case 'charge': return '+0.5 Charge per gameplay roll';
    case 'targetPractice': return '×5 in the round target';
    case 'hotStreak': return '+0.5 per chain step';
    case 'dragonsHoard': return '×1–×3 from held Gold';
    case 'wellTrained': return 'up to ×3 from previous plays';
    case 'moneyToBurn': return '×1–×3 from normal-shop spend';
    case 'lowball': return '×1–×3 from printed-face average';
    default: return '×3 when its condition is met';
  }
}

export function FlameRewardScreen({ board, event, busy, progress, selectedOffer, setSelectedOffer, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean; progress: { current: number; total: number };
  selectedOffer: number | null; setSelectedOffer: (id: number | null) => void; submit: (action: Action) => void; skip: () => void;
}) {
  const reward = board.flameReward!;
  const offer = reward.acquired ? undefined : reward.offers.find(item => item.id === selectedOffer);
  const [replacementDie, setReplacementDie] = useState<number | null>(null);
  const [managedDieId, setManagedDieId] = useState<number | null>(null);
  const [stokeAmount, setStokeAmount] = useState(0);

  function chooseOrManage(dieId: number) {
    if (offer) {
      if (activeFlameId(board.dice[dieId].flame)) setReplacementDie(dieId);
      else submit({ type: 'CHOOSE_FLAME', offerId: offer.id, dieId });
      return;
    }
    if (activeFlameId(board.dice[dieId].flame)) { setManagedDieId(dieId); setStokeAmount(0); }
  }
  function confirmReplacement() {
    if (!offer || replacementDie === null) return;
    submit({ type: 'CHOOSE_FLAME', offerId: offer.id, dieId: replacementDie });
    setReplacementDie(null);
  }

  const managedDie = managedDieId === null ? null : board.dice.find(die => die.id === managedDieId) ?? null;
  const managedFlame = activeFlameId(managedDie?.flame);
  const managedInvestment = activeFlameInvestment(managedDie?.flame);
  const maxStoke = Math.min(board.gold, 100 - managedInvestment);
  const amount = Math.max(0, Math.min(Math.floor(stokeAmount || 0), maxStoke));
  function setAmount(value: number) { setStokeAmount(Math.max(0, Math.min(Math.floor(value || 0), maxStoke))); }
  function stoke() {
    if (!managedDie || !managedFlame || amount < 1) return;
    const createsBonfire = managedInvestment + amount === 100;
    submit({ type: 'STOKE_FLAME', dieId: managedDie.id, amount });
    setStokeAmount(0);
    if (createsBonfire) setManagedDieId(null);
  }

  const replacing = replacementDie === null ? null : board.dice[replacementDie];
  const replacingId = activeFlameId(replacing?.flame);
  return <>
    <Stack gap="xs" className="flame-reward-screen">
      <Group justify="space-between" className="shop-summary flame-reward-header">
        <div><Text fw={800}>FLAME REWARD</Text><Text size="xs" c="dimmed">Choose a new Flame or stoke your existing Embers.</Text></div>
        <Badge color="yellow" variant="light">{board.gold} Gold</Badge>
      </Group>
      <Paper p="xs" className="flame-payout"><RoundPayoutSummary board={board} /></Paper>
      {busy && <ScoreResolution event={event} busy={busy} {...progress} onSkip={skip} showXMult={hasXMultFlame(board.dice, board.bonfires)} />}
      {board.bonfires.length > 0 && <Paper p="xs" className="shop-section bonfire-strip" data-testid="bonfires">
        <Group gap="xs"><Text fw={700} size="sm" tt="uppercase">Bonfires</Text>{board.bonfires.map(id => <Tooltip key={id} label={FLAMES[id].bonfireDescription} withArrow>
          <Badge color="red" variant="light">🔥 {FLAMES[id].name} · {fullEffect(id)}</Badge>
        </Tooltip>)}</Group>
      </Paper>}
      <Paper p="xs" className="shop-section flame-offers-section">
        <Group justify="space-between" className="section-heading">
          <div><Text fw={700} size="sm" tt="uppercase">Flame offers</Text><Text size="xs" c="dimmed">{reward.acquired ? 'Acquisition complete — you may keep stoking.' : 'Taking a Flame is optional.'}</Text></div>
          <Button size="compact-xs" variant="default" disabled={busy || reward.acquired || board.gold < flameRerollCost(reward.offerRerolls)} onClick={() => submit({ type: 'REROLL_FLAMES' })}>↻ Reroll · {flameRerollCost(reward.offerRerolls)} Gold</Button>
        </Group>
        <div className="shop-grid flame-offers">{reward.offers.map(item => <Card key={item.id} p="sm" className={`flame-offer ${selectedOffer === item.id && !reward.acquired ? 'selected' : ''}`} data-testid={`flame-offer-${item.flame}`}>
          <Group justify="space-between"><Text fw={750}>🔥 {FLAMES[item.flame].name}</Text><Badge size="xs" color="teal">FREE</Badge></Group>
          <Text size="xs" c="dimmed" mt={6}>{FLAMES[item.flame].description}</Text>
          <Button size="compact-xs" fullWidth mt="xs" color="orange" variant={selectedOffer === item.id && !reward.acquired ? 'filled' : 'light'} disabled={busy || reward.acquired}
            onClick={() => setSelectedOffer(selectedOffer === item.id ? null : item.id)}>{selectedOffer === item.id ? 'Choose a die below' : 'Select Flame'}</Button>
        </Card>)}</div>
      </Paper>
      <Paper p="md" className="shop-section flame-dice-section">
        <Group justify="space-between" mb="xs"><div><Text fw={700} size="sm" tt="uppercase">Physical Dice & Embers</Text><Text size="xs" c="dimmed">Flames stay with their die until they become global Bonfires.</Text></div>
          <Text size="xs" c={offer ? 'orange' : 'dimmed'}>{offer ? `${FLAMES[offer.flame].name} selected — choose a die` : 'Select an Ember die to stoke it'}</Text></Group>
        <div className="flame-dice-grid">{board.dice.map(die => {
          const flameId = activeFlameId(die.flame);
          const invested = activeFlameInvestment(die.flame);
          const involved = event?.dieIds?.includes(die.id) ?? false;
          return <Card key={die.id} p="xs" className={`flame-die-card ${offer ? 'offer-target' : ''}`} data-testid={`flame-die-${die.id}`}>
            <Die die={die} selected={false} highlighted={involved && event?.type !== 'DIE_ROLLED'}
              rolling={involved && (event?.type === 'DICE_REROLL_STARTED' || event?.type === 'DIE_ROLLED')}
              ability={involved ? event?.enhancement : undefined} flameAbility={involved ? event?.flame : undefined}
              disabled={busy} eligible={!!offer} onClick={() => chooseOrManage(die.id)} />
            {flameId ? <div className="ember-details" data-testid={`active-flame-${flameId}`}>
              <Group justify="space-between" gap={4} wrap="nowrap"><Text size="xs" fw={800} c="orange">🔥 {FLAMES[flameId].name}</Text><Badge size="xs" color="orange" variant="light">EMBER</Badge></Group>
              <Text size="xs" fw={700}>{invested} / 100 → BONFIRE</Text>
              <Progress value={invested} color="orange" size="sm" my={4} />
              <Text size="xs" c="dimmed">Current: {currentEffect(flameId, invested, board)}</Text>
            </div> : <div className="ember-details empty"><Text size="xs" c="dimmed">Empty Flame slot</Text></div>}
          </Card>;
        })}</div>
      </Paper>
      <div className="shop-action-dock"><Text size="xs" c="dimmed">These exposed faces carry into the shop. No second free roll.</Text><Button disabled={busy} onClick={() => submit({ type: 'CONTINUE_FLAME_REWARD' })}>CONTINUE TO SHOP →</Button></div>
    </Stack>

    <Modal opened={!!managedDie && !!managedFlame} onClose={() => setManagedDieId(null)} title={managedDie && managedFlame ? `D${managedDie.id + 1} — Stoke ${FLAMES[managedFlame].name}` : 'Stoke Ember'} centered transitionProps={{ duration: 0 }}>
      {managedDie && managedFlame && <Stack gap="sm">
        <Group justify="space-between"><Badge color="orange" variant="light">🔥 EMBER</Badge><Badge color="yellow" variant="light">{board.gold} Gold held</Badge></Group>
        <div><Text fw={800}>{FLAMES[managedFlame].name}</Text><Text size="sm" c="dimmed">Spend Gold to stoke your Ember.</Text></div>
        <div><Group justify="space-between"><Text size="sm" fw={700}>{managedInvestment} / 100 → BONFIRE</Text><Text size="xs" c="dimmed">{100 - managedInvestment} remaining</Text></Group><Progress value={managedInvestment} color="orange" size="lg" mt={5} /></div>
        <div className="stoke-effects">
          <div className="modal-stat"><Text size="xs" c="dimmed" tt="uppercase">Current</Text><Text size="sm" fw={700}>{currentEffect(managedFlame, managedInvestment, board)}</Text></div>
          <div className="modal-stat"><Text size="xs" c="dimmed" tt="uppercase">Full strength</Text><Text size="sm" fw={700}>{fullEffect(managedFlame)}</Text></div>
          <div className="modal-stat"><Text size="xs" c="dimmed" tt="uppercase">At Bonfire</Text><Text size="sm" fw={700}>{FLAMES[managedFlame].bonfireDescription}</Text></div>
        </div>
        <Group gap="xs" wrap="wrap" className="stoke-controls">
          {[1, 5, 10].map(value => <Button key={value} variant="default" disabled={busy || maxStoke < 1} onClick={() => setAmount(amount + value)}>+{value}</Button>)}
          <Button variant="default" disabled={busy || maxStoke < 1} onClick={() => setAmount(maxStoke)}>Max</Button>
          <TextInput type="number" aria-label={`Stoke amount for ${FLAMES[managedFlame].name}`} value={amount}
            onChange={event => setAmount(Number(event.currentTarget.value))} min={0} max={maxStoke} className="stoke-input" />
        </Group>
        <Button color="orange" size="md" fullWidth disabled={busy || amount < 1} onClick={stoke}>Stoke {amount} Gold</Button>
      </Stack>}
    </Modal>

    <Modal opened={replacementDie !== null} onClose={() => setReplacementDie(null)} title="Replace Flame?" centered transitionProps={{ duration: 0 }}>
      {replacingId && offer && <><Text>Replace <strong>{FLAMES[replacingId].name}</strong> ({activeFlameInvestment(replacing?.flame)} Gold invested) with <strong>{FLAMES[offer.flame].name}</strong>?</Text>
        <Text size="sm" c="dimmed" mt="xs">The old Flame and all its investment are destroyed. Its type may return in a future reward.</Text>
        <Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setReplacementDie(null)}>Cancel</Button><Button color="orange" onClick={confirmReplacement}>Replace Flame</Button></Group></>}
    </Modal>
  </>;
}
