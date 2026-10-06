import { ActionIcon, Badge, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { BOSSES, isMiniBossType } from '../game/bosses';
import { HANDS } from '../game/hands';
import type { Board } from '../game/types';
import { formatPlayerNumber } from '../game/copy';
import { chapterLabel } from '../game/chapters';
import { InfoCircleIcon } from './InfoPopover';

export function BossPanel({ board }: { board: Board }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const boss = board.boss;
  if (!boss) return null;
  const definition = BOSSES[boss.type];
  const tier = isMiniBossType(boss.type) ? 'MINI-BOSS' : 'BOSS';
  const compactStatus = (() => {
    if (board.bossSilenced) return 'SILENCED';
    switch (boss.type) {
      case 'caller': return `${HANDS[boss.calledHand].name} · ${formatPlayerNumber(boss.playsRemaining)} play${boss.playsRemaining === 1 ? '' : 's'} left`;
      case 'warden': return boss.pendingReinforcements > 0 ? 'Choose a die to unlock'
        : `${formatPlayerNumber(boss.activeDieIds.length)} of 5 dice unlocked`;
      case 'hexer': return 'Cursed Die required';
      case 'marathon': return 'Hands return after 7 plays';
      case 'quickdraw': return boss.lowerShotUsed ? 'Lower shot spent' : '1 Lower shot available';
      case 'fly': return boss.caught ? 'Caught' : `Catch: ${boss.flyHand ? HANDS[boss.flyHand].name : 'Lower hand'}`;
      case 'snakeEyes': return 'Scored faces become 1s';
      case 'infected': return `${formatPlayerNumber(boss.infectedFaces.length)} infected face${boss.infectedFaces.length === 1 ? '' : 's'}`;
      case 'juggler': return '1 extra die rerolls';
      case 'capitalReturn': return 'Lower hands cost 1 Gold';
      case 'neglected': return '2 hands unavailable';
      case 'clockmaker': return 'Every roll Bumps';
      case 'tightrope': return '0 Rerolls · half Goal';
      case 'crawler': return 'Only 1 scoring die rerolls';
      case 'magician': return `${formatPlayerNumber(boss.completedHands.length)} of ${formatPlayerNumber(boss.calledHands.length)} calls completed`;
      case 'mugger': return boss.spent && boss.revealedHand ? `${HANDS[boss.revealedHand].name} · spent` : 'Hidden Lower hand';
    }
  })();
  const modalState = (() => {
    if (board.bossSilenced) return 'This encounter rule is currently silenced.';
    switch (boss.type) {
      case 'caller': return `Current call: ${HANDS[boss.calledHand].name}. ${formatPlayerNumber(boss.playsRemaining)} play${boss.playsRemaining === 1 ? '' : 's'} remaining.`;
      case 'warden': return `${formatPlayerNumber(boss.activeDieIds.length)} of 5 dice unlocked${boss.nextUnlockTarget === null ? '.' : `. Next unlock at ${formatPlayerNumber(boss.nextUnlockTarget)} score.`}`;
      case 'fly': return boss.caught ? 'The Fly has been caught.' : `Current catch hand: ${boss.flyHand ? HANDS[boss.flyHand].name : 'none'}.`;
      case 'magician': return `${formatPlayerNumber(boss.completedHands.length)} of ${formatPlayerNumber(boss.calledHands.length)} calls completed.`;
      case 'marathon': return `${Object.keys(boss.cooldowns).length} hand${Object.keys(boss.cooldowns).length === 1 ? '' : 's'} currently cooling down.`;
      case 'quickdraw': return boss.lowerShotUsed ? `Lower shot used${boss.playedLowerHand ? ` on ${HANDS[boss.playedLowerHand].name}` : ''}.` : 'Your one Lower-hand shot is still available.';
      default: return compactStatus;
    }
  })();
  return <>
    <Paper p="xs" className={`boss-panel boss-${boss.type}`} data-testid="boss-panel" data-tutorial="boss">
      <div className="boss-compact-row" aria-label={`${definition.name}. ${compactStatus}`}>
        <div className="boss-bar-copy">
          <Text component="span" fw={900} className="boss-bar-name">{definition.name}</Text>
          <Text component="span" size="xs" fw={800} className="boss-bar-status" data-testid={`boss-status-${boss.type}`}> · {compactStatus}</Text>
        </div>
        <ActionIcon className="info-popover-trigger boss-info-button" size="sm" variant="subtle" color="gray"
          aria-label="Boss information" onClick={() => setInfoOpen(true)}><InfoCircleIcon /></ActionIcon>
      </div>
    </Paper>
    <Modal opened={infoOpen} onClose={() => setInfoOpen(false)} title={`${tier} · ${definition.name}`} centered
      classNames={{ root: 'boss-info-modal' }} data-testid="boss-info-modal">
      <Stack gap="sm">
        <Text>{definition.shortRule}</Text>
        <Paper p="sm" className="boss-info-current"><Text size="xs" fw={900} tt="uppercase" c="dimmed">Current state</Text>
          <Text size="sm" mt={3}>{modalState}</Text></Paper>
        {boss.type === 'magician' && !boss.returned && <Group gap={4} data-testid="magician-calls">
          {boss.calledHands.map(hand => <Badge key={hand} size="xs" variant="light"
            color={boss.completedHands.includes(hand) ? 'teal' : 'grape'}>{boss.completedHands.includes(hand) ? '✓ ' : ''}{HANDS[hand].name}</Badge>)}
        </Group>}
      </Stack>
    </Modal>
  </>;
}

export function BossPreview({ board }: { board: Board }) {
  const nextRound = board.bust ? board.round : board.round + 1;
  const bossType = board.bossSchedule[nextRound];
  if (!bossType) return null;
  const boss = BOSSES[bossType];
  return <Paper p="sm" className={`boss-preview boss-${bossType}`} data-testid="boss-preview">
    <Group justify="space-between"><div><Text size="xs" fw={900} tt="uppercase" lts=".14em">Incoming · {chapterLabel(nextRound)}</Text>
      <Text fw={950}>{boss.name}</Text></div><Badge variant="light">{isMiniBossType(bossType) ? 'MINI-BOSS' : 'BOSS'}</Badge></Group>
    <Text size="sm" mt={5}>{boss.shortRule}</Text>
  </Paper>;
}
