import { Badge, Button, Card, Group, Modal, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { useState } from 'react';
import { flameRerollCost } from '../game/config';
import { FLAMES, hasXMultFlame } from '../game/flames';
import type { Action, Board, GameEvent } from '../game/types';
import { DiceRow } from './DiceRow';
import { ScoreResolution } from './ScoreResolution';

export function FlameRewardScreen({ board, event, busy, progress, selectedOffer, setSelectedOffer, submit, skip }: {
  board: Board; event: GameEvent | null; busy: boolean; progress: { current: number; total: number };
  selectedOffer: number | null; setSelectedOffer: (id: number | null) => void; submit: (action: Action) => void; skip: () => void;
}) {
  const reward = board.flameReward!;
  const offer = reward.offers.find(item => item.id === selectedOffer);
  const [replacementDie, setReplacementDie] = useState<number | null>(null);
  function chooseDie(dieId: number) {
    if (!offer) return;
    if (board.dice[dieId].flame) setReplacementDie(dieId);
    else submit({ type: 'CHOOSE_FLAME', offerId: offer.id, dieId });
  }
  function confirmReplacement() {
    if (!offer || replacementDie === null) return;
    submit({ type: 'CHOOSE_FLAME', offerId: offer.id, dieId: replacementDie });
    setReplacementDie(null);
  }
  const replacing = replacementDie === null ? null : board.dice[replacementDie];
  return <>
    <Stack gap="xs" className="flame-reward-screen">
      <Group justify="space-between" className="shop-summary">
        <div><Text fw={800}>FLAME REWARD</Text><Text size="xs" c="dimmed">Choose one free Flame, then attach it to one physical die.</Text></div>
        <Badge color="orange" variant="light">Round {board.round} milestone</Badge>
      </Group>
      {busy && <ScoreResolution event={event} busy={busy} {...progress} onSkip={skip} showXMult={hasXMultFlame(board.dice)} />}
      <Paper p="xs" className="shop-section flame-offers-section">
        <Group justify="space-between" className="section-heading">
          <Text fw={700} size="sm" tt="uppercase" lts=".08em">Choose a Flame</Text>
          <Button size="compact-xs" variant="default" disabled={busy || board.gold < flameRerollCost(reward.offerRerolls)}
            onClick={() => submit({ type: 'REROLL_FLAMES' })}>↻ Reroll · {flameRerollCost(reward.offerRerolls)} gold</Button>
        </Group>
        <div className="shop-grid flame-offers">{reward.offers.map(item => <Card key={item.id} p="sm"
          className={`flame-offer ${selectedOffer === item.id ? 'selected' : ''}`} data-testid={`flame-offer-${item.flame}`}>
          <Group justify="space-between"><Group gap="xs"><span className="flame-card-icon" aria-hidden="true">🔥</span><Text fw={750}>{FLAMES[item.flame].name}</Text></Group><Badge size="xs" color="teal">FREE</Badge></Group>
          <Tooltip label={FLAMES[item.flame].description} multiline maw={340} withArrow><Text size="xs" c="dimmed" mt={6} className="flame-description">{FLAMES[item.flame].description}</Text></Tooltip>
          <Button size="compact-xs" fullWidth mt="xs" color="orange" variant={selectedOffer === item.id ? 'filled' : 'light'}
            disabled={busy} aria-pressed={selectedOffer === item.id} onClick={() => setSelectedOffer(selectedOffer === item.id ? null : item.id)}>
            {selectedOffer === item.id ? 'Choose a die' : 'Select Flame'}
          </Button>
        </Card>)}</div>
      </Paper>
      <Paper p="xs" className="shop-section flame-dice-section">
        <Group justify="space-between" className="section-heading">
          <Text fw={700} size="sm" tt="uppercase" lts=".08em">Physical Dice</Text>
          <Text size="xs" c={offer ? 'orange' : 'dimmed'}>{offer ? `${FLAMES[offer.flame].name} selected — choose its die` : 'Select a Flame first'}</Text>
        </Group>
        <DiceRow dice={board.dice} event={event} disabled={busy} eligibleIds={offer ? board.dice.map(die => die.id) : []} onClick={chooseDie} />
      </Paper>
    </Stack>
    <Modal opened={replacementDie !== null} onClose={() => setReplacementDie(null)} title="Replace Flame?" centered transitionProps={{ duration: 0 }}>
      {replacing && offer && <>
        <Text>Replace <strong>{FLAMES[replacing.flame!].name}</strong> on D{replacing.id + 1} with <strong>{FLAMES[offer.flame].name}</strong>?</Text>
        <Text size="sm" c="dimmed" mt="xs">The old Flame is permanently lost.</Text>
        <Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setReplacementDie(null)}>Cancel</Button><Button color="orange" onClick={confirmReplacement}>Replace Flame</Button></Group>
      </>}
    </Modal>
  </>;
}
