import { Badge, Button, Card, Group, Modal, Paper, Progress, Stack, Text, Tooltip } from '@mantine/core';
import { useState } from 'react';
import { flameRerollCost } from '../game/config';
import { activeFlameId, activeFlameInvestment, flameEffectText, flameFullEffectText, FLAMES, hasXMultFlame } from '../game/flames';
import type { Action, Board, GameEvent } from '../game/types';
import { Die } from './Die';
import { RoundPayoutSummary } from './RoundPayoutSummary';
import { ScoreResolution } from './ScoreResolution';
import { StokeFlameModal } from './StokeFlameModal';

export function FlameRewardScreen({ board, event, busy, progress, selectedOffer, setSelectedOffer, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean; progress: { current: number; total: number };
  selectedOffer: number | null; setSelectedOffer: (id: number | null) => void; submit: (action: Action) => void; skip: () => void;
}) {
  const reward = board.flameReward!;
  const offer = reward.acquired ? undefined : reward.offers.find(item => item.id === selectedOffer);
  const [replacementDie, setReplacementDie] = useState<number | null>(null);
  const [managedDieId, setManagedDieId] = useState<number | null>(null);

  function chooseOrManage(dieId: number) {
    if (offer) {
      if (activeFlameId(board.dice[dieId].flame)) setReplacementDie(dieId);
      else submit({ type: 'CHOOSE_FLAME', offerId: offer.id, dieId });
      return;
    }
    if (activeFlameId(board.dice[dieId].flame)) setManagedDieId(dieId);
  }
  function confirmReplacement() {
    if (!offer || replacementDie === null) return;
    submit({ type: 'CHOOSE_FLAME', offerId: offer.id, dieId: replacementDie });
    setReplacementDie(null);
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
          <Badge color="red" variant="light">🔥 {FLAMES[id].name} · {flameFullEffectText(id)}</Badge>
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
              <Text size="xs" c="dimmed">Current: {flameEffectText(flameId, invested, board)}</Text>
            </div> : <div className="ember-details empty"><Text size="xs" c="dimmed">Empty Flame slot</Text></div>}
          </Card>;
        })}</div>
      </Paper>
      <div className="shop-action-dock"><Text size="xs" c="dimmed">These exposed faces carry into the shop. No second free roll.</Text><Button disabled={busy} onClick={() => submit({ type: 'CONTINUE_FLAME_REWARD' })}>CONTINUE TO SHOP →</Button></div>
    </Stack>

    <StokeFlameModal board={board} dieId={managedDieId} opened={managedDieId !== null} busy={busy}
      onClose={() => setManagedDieId(null)} submit={submit} />

    <Modal opened={replacementDie !== null} onClose={() => setReplacementDie(null)} title="Replace Flame?" centered transitionProps={{ duration: 0 }}>
      {replacingId && offer && <><Text>Replace <strong>{FLAMES[replacingId].name}</strong> ({activeFlameInvestment(replacing?.flame)} Gold invested) with <strong>{FLAMES[offer.flame].name}</strong>?</Text>
        <Text size="sm" c="dimmed" mt="xs">The old Flame and all its investment are destroyed. Its type may return in a future reward.</Text>
        <Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setReplacementDie(null)}>Cancel</Button><Button color="orange" onClick={confirmReplacement}>Replace Flame</Button></Group></>}
    </Modal>
  </>;
}
