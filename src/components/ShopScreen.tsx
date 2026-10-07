import { Button, Group, Paper, Stack, Text } from '@mantine/core';
import { CONFIG, diceRerollCost, offerRerollCost } from '../game/config';
import type { Action, Board, GameEvent } from '../game/types';
import { EnhancementCard } from './EnhancementCard';
import { ScoreResolution } from './ScoreResolution';
import { TrainingCard } from './TrainingCard';
import { BossPreview } from './BossPanel';
import { BOSSES } from '../game/bosses';
import { formatPlayerNumber } from '../game/copy';
import { enhancementOfferIsFree, trainingOfferIsFree } from '../game/specialOffers';
import { chapterLabel, chapterRoundForRound } from '../game/chapters';
import { RunActionLayout, RunActionPortal } from './RunActionRow';
import { useEffect, useState } from 'react';

const hearts = (lives: number) => Array.from({ length: CONFIG.maxLives }, (_, index) => index < lives ? '♥' : '♡').join(' ');

export function ShopScreen({ board, event, busy, selectedOffer, setSelectedOffer, submit, skip, tutorialProgressNudgeEligible = false }: {
  board: Board; event: GameEvent | null; busy: boolean;
  selectedOffer: number | null; setSelectedOffer: (id: number | null) => void; submit: (action: Action) => void; skip: () => void;
  tutorialProgressNudgeEligible?: boolean;
}) {
  const shop = board.shop!;
  const returnedFromBust = board.bust;
  const nextChapter = !returnedFromBust && shop.kind === 'post_boss';
  const upcomingBoss = board.bossSchedule[board.round + 1];
  const retryRound = chapterRoundForRound(board.round);
  const rerollCost = diceRerollCost(shop.diceRerolls);
  const [showProgressNudge, setShowProgressNudge] = useState(false);
  useEffect(() => {
    setShowProgressNudge(false);
    if (!tutorialProgressNudgeEligible) return;
    const timer = window.setTimeout(() => setShowProgressNudge(true), 5000);
    return () => window.clearTimeout(timer);
  }, [tutorialProgressNudgeEligible]);

  return <Stack gap="xs" className="shop-screen">
    <div className="shop-summary phase-sticky-header">{returnedFromBust ? <Paper px="sm" py={6} className="bust-shop-banner" data-testid="bust-shop-banner">
      <Group justify="space-between" gap="xs" wrap="wrap">
        <div><Text size="sm" fw={850} c="red">{chapterLabel(returnedFromBust.round)} BUST</Text><Text size="xs" c="dimmed">1 Life Lost</Text></div>
        <Text fw={800} c="red" aria-label={`${board.lives} of ${CONFIG.maxLives} lives`}>{hearts(board.lives)}</Text>
      </Group>
    </Paper> : <Group justify="space-between"><Text fw={800}>SHOP</Text><Text size="xs" c="dimmed">{upcomingBoss
      ? `Prepare for ${BOSSES[upcomingBoss].name}` : `Prepare for ${chapterLabel(board.round + 1)}`}</Text></Group>}</div>
    {busy && <ScoreResolution event={event} busy={busy} onSkip={skip} />}
    <BossPreview board={board} />
    <Paper p="xs" className="shop-section" data-tutorial="hand-training">
      <Group justify="space-between" className="section-heading"><Text fw={700} size="sm" tt="uppercase" lts=".08em">Hand Training</Text></Group>
      <div className="shop-grid training-grid">{shop.trainingOffers.map(item => <TrainingCard
        key={item.kind === 'team' ? 'team' : item.hand} offer={item} handLevels={board.handLevels} gold={board.gold} busy={busy} free={trainingOfferIsFree(shop, item)}
        onTrain={() => submit(item.kind === 'team' ? { type: 'TRAIN_ALL_HANDS' } : { type: 'TRAIN_HAND', hand: item.hand })} />)}</div>
    </Paper>
    <Paper p="xs" className="shop-section" data-tutorial="enhancements">
      <Group justify="space-between" className="section-heading">
        <Text fw={700} size="sm" tt="uppercase" lts=".08em">Enhancements</Text>
        <Button size="compact-xs" variant="default" disabled={busy || board.gold < offerRerollCost(shop.offerRerolls)}
          aria-label={`REROLL OFFERS · ${formatPlayerNumber(offerRerollCost(shop.offerRerolls))} GOLD`}
          onClick={() => submit({ type: 'REROLL_OFFERS' })}>REROLL OFFERS · {formatPlayerNumber(offerRerollCost(shop.offerRerolls))} GOLD</Button>
      </Group>
      <div className="shop-grid enhancement-grid">{shop.offers.map(item => <EnhancementCard key={item.id} offer={item} selected={selectedOffer === item.id}
        gold={board.gold} busy={busy} free={enhancementOfferIsFree(shop, item.id)} onSelect={() => setSelectedOffer(selectedOffer === item.id ? null : item.id)} />)}</div>
    </Paper>
    <RunActionPortal><RunActionLayout className="shop-action-dock"
      left={<Button className="shop-dice-reroll" size="sm" variant="default" disabled={busy || board.gold < rerollCost}
        aria-label={`REROLL ALL DICE FOR ${formatPlayerNumber(rerollCost)} GOLD`} data-testid="shop-dice-reroll"
        onClick={() => submit({ type: 'REROLL_DICE' })}>REROLL ALL DICE FOR {formatPlayerNumber(rerollCost)} GOLD</Button>}
      right={<Button size="sm" disabled={busy} aria-label={returnedFromBust ? `RETRY ROUND ${formatPlayerNumber(retryRound)}` : nextChapter ? 'NEXT CHAPTER' : 'NEXT ROUND'}
        className={showProgressNudge ? 'tutorial-progression-nudge' : undefined}
        data-testid="shop-progression-action" data-tutorial-nudge={showProgressNudge || undefined}
        color={returnedFromBust ? 'red' : undefined} onClick={() => submit(returnedFromBust ? { type: 'RETRY_ROUND' } : nextChapter ? { type: 'NEXT_CHAPTER' } : { type: 'NEXT_ROUND' })}>
        {returnedFromBust ? `RETRY ROUND ${formatPlayerNumber(retryRound)}` : nextChapter ? 'NEXT CHAPTER' : 'NEXT ROUND'} →
      </Button>} /></RunActionPortal>
  </Stack>;
}
