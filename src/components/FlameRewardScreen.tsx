import { Badge, Button, Card, Group, Modal, Paper, Progress, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { useState } from 'react';
import { flameRerollCost } from '../game/config';
import {
  activeFlameId, activeFlameInvestment, chargeGainPerRoll, dragonsHoardMultiplier, FLAMES, flameProgress, hasXMultFlame,
  lowballMultiplier, moneyToBurnMultiplier, standardFlameMultiplier, targetPracticeMultiplier,
  trainerChance, wellTrainedMultiplier,
} from '../game/flames';
import type { Action, Board, Flame, GameEvent } from '../game/types';
import { DiceRow } from './DiceRow';
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
  if (id === 'personalTrainer') return '75% chance';
  if (id === 'charge') return '+0.5 Charge per roll';
  if (id === 'targetPractice' || id === 'hotStreak') return 'up to ×5';
  return 'up to ×3';
}

export function FlameRewardScreen({ board, event, busy, progress, selectedOffer, setSelectedOffer, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean; progress: { current: number; total: number };
  selectedOffer: number | null; setSelectedOffer: (id: number | null) => void; submit: (action: Action) => void; skip: () => void;
}) {
  const reward = board.flameReward!;
  const offer = reward.offers.find(item => item.id === selectedOffer);
  const [replacementDie, setReplacementDie] = useState<number | null>(null);
  const [donations, setDonations] = useState<Record<number, number>>({});
  function chooseDie(dieId: number) {
    if (!offer || reward.acquired) return;
    if (activeFlameId(board.dice[dieId].flame)) setReplacementDie(dieId);
    else submit({ type: 'CHOOSE_FLAME', offerId: offer.id, dieId });
  }
  function confirmReplacement() {
    if (!offer || replacementDie === null) return;
    submit({ type: 'CHOOSE_FLAME', offerId: offer.id, dieId: replacementDie });
    setReplacementDie(null);
  }
  function setDonation(dieId: number, amount: number) {
    const flame = board.dice[dieId].flame;
    const max = Math.min(board.gold, 100 - activeFlameInvestment(flame));
    setDonations(current => ({ ...current, [dieId]: Math.max(0, Math.min(Math.floor(amount || 0), max)) }));
  }
  const replacing = replacementDie === null ? null : board.dice[replacementDie];
  const replacingId = activeFlameId(replacing?.flame);
  return <>
    <Stack gap="xs" className="flame-reward-screen">
      <Group justify="space-between" className="shop-summary">
        <div><Text fw={800}>FLAME REWARD</Text><Text size="xs" c="dimmed">Invest in any active ember and optionally acquire one unique Flame.</Text></div>
        <Group gap="xs"><Badge color="yellow" variant="light">{board.gold} Gold</Badge><Badge color="orange" variant="light">Round {board.round}</Badge></Group>
      </Group>
      {busy && <ScoreResolution event={event} busy={busy} {...progress} onSkip={skip} showXMult={hasXMultFlame(board.dice, board.bonfires)} />}
      {board.bonfires.length > 0 && <Paper p="xs" className="shop-section" data-testid="bonfires">
        <Text fw={700} size="sm" tt="uppercase">Bonfires</Text>
        <Group gap="xs" mt="xs">{board.bonfires.map(id => <Tooltip key={id} label={FLAMES[id].bonfireDescription} withArrow>
          <Badge color="red" variant="light">🔥 {FLAMES[id].name} · {fullEffect(id)}</Badge>
        </Tooltip>)}</Group>
      </Paper>}
      <Paper p="xs" className="shop-section">
        <Text fw={700} size="sm" tt="uppercase" mb="xs">Active Embers</Text>
        <div className="shop-grid flame-offers">{board.dice.map(die => {
          const flame = die.flame;
          const flameId = activeFlameId(flame);
          const investedGold = activeFlameInvestment(flame);
          if (!flameId) return <Card key={die.id} p="sm"><Text fw={700}>D{die.id + 1}</Text><Text size="xs" c="dimmed">Empty Flame slot</Text></Card>;
          const max = Math.min(board.gold, 100 - investedGold);
          const amount = Math.min(donations[die.id] ?? 0, max);
          return <Card key={die.id} p="sm" data-testid={`active-flame-${flameId}`}>
            <Group justify="space-between"><Text fw={700}>D{die.id + 1} · {FLAMES[flameId].name}</Text><Badge color="orange">Ember</Badge></Group>
            <Text size="xs" mt={4}>{investedGold} / 100 Gold · {currentEffect(flameId, investedGold, board)}</Text>
            <Text size="xs" c="dimmed">Full: {fullEffect(flameId)}</Text>
            <Progress value={investedGold} color="orange" mt={6} />
            <Group gap={4} mt="xs" wrap="wrap">
              {[1, 5, 10].map(value => <Button key={value} size="compact-xs" variant="default" disabled={busy || max < 1} onClick={() => setDonation(die.id, amount + value)}>+{value}</Button>)}
              <Button size="compact-xs" variant="default" disabled={busy || max < 1} onClick={() => setDonation(die.id, max)}>Max</Button>
              <TextInput type="number" size="xs" aria-label={`Donation for ${FLAMES[flameId].name}`} value={amount}
                onChange={e => setDonation(die.id, Number(e.currentTarget.value))} min={0} max={max} styles={{ input: { width: 72 } }} />
              <Button size="compact-xs" color="orange" disabled={busy || amount < 1} onClick={() => { submit({ type: 'DONATE_FLAME', dieId: die.id, amount }); setDonations(current => ({ ...current, [die.id]: 0 })); }}>Donate</Button>
            </Group>
          </Card>;
        })}</div>
      </Paper>
      <Paper p="xs" className="shop-section flame-offers-section">
        <Group justify="space-between" className="section-heading">
          <div><Text fw={700} size="sm" tt="uppercase">Flame offers</Text><Text size="xs" c="dimmed">{reward.acquired ? 'Acquisition complete — you may keep investing.' : 'Taking a Flame is optional.'}</Text></div>
          <Button size="compact-xs" variant="default" disabled={busy || reward.acquired || board.gold < flameRerollCost(reward.offerRerolls)} onClick={() => submit({ type: 'REROLL_FLAMES' })}>↻ Reroll · {flameRerollCost(reward.offerRerolls)} Gold</Button>
        </Group>
        <div className="shop-grid flame-offers">{reward.offers.map(item => <Card key={item.id} p="sm" className={`flame-offer ${selectedOffer === item.id ? 'selected' : ''}`} data-testid={`flame-offer-${item.flame}`}>
          <Group justify="space-between"><Text fw={750}>🔥 {FLAMES[item.flame].name}</Text><Badge size="xs" color="teal">FREE</Badge></Group>
          <Text size="xs" c="dimmed" mt={6}>{FLAMES[item.flame].description}</Text>
          <Button size="compact-xs" fullWidth mt="xs" color="orange" variant={selectedOffer === item.id ? 'filled' : 'light'} disabled={busy || reward.acquired}
            onClick={() => setSelectedOffer(selectedOffer === item.id ? null : item.id)}>{selectedOffer === item.id ? 'Choose a die below' : 'Select Flame'}</Button>
        </Card>)}</div>
      </Paper>
      <Paper p="xs" className="shop-section flame-dice-section">
        <Group justify="space-between"><Text fw={700} size="sm" tt="uppercase">Physical Dice</Text><Text size="xs" c={offer ? 'orange' : 'dimmed'}>{offer ? `${FLAMES[offer.flame].name} selected` : 'Select an offer to place it'}</Text></Group>
        <DiceRow dice={board.dice} event={event} disabled={busy || reward.acquired} eligibleIds={offer ? board.dice.map(die => die.id) : []} onClick={chooseDie} />
      </Paper>
      <div className="shop-action-dock"><Text size="xs" c="dimmed">These exposed faces carry into the shop. No second free roll.</Text><Button disabled={busy} onClick={() => submit({ type: 'CONTINUE_FLAME_REWARD' })}>CONTINUE TO SHOP →</Button></div>
    </Stack>
    <Modal opened={replacementDie !== null} onClose={() => setReplacementDie(null)} title="Replace Flame?" centered transitionProps={{ duration: 0 }}>
      {replacingId && offer && <><Text>Replace <strong>{FLAMES[replacingId].name}</strong> ({activeFlameInvestment(replacing?.flame)} Gold invested) with <strong>{FLAMES[offer.flame].name}</strong>?</Text>
        <Text size="sm" c="dimmed" mt="xs">The old Flame and all its investment are destroyed. Its type may return in a future reward.</Text>
        <Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setReplacementDie(null)}>Cancel</Button><Button color="orange" onClick={confirmReplacement}>Replace Flame</Button></Group></>}
    </Modal>
  </>;
}
