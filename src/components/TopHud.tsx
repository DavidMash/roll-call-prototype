import { ActionIcon, Badge, Box, Button, Divider, Drawer, Group, Progress, SegmentedControl, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { CONFIG } from '../game/config';
import type { Board } from '../game/types';
import { FLAMES } from '../game/flames';
import type { PlaybackSpeed } from '../useGame';
import type { DiceDisplay } from '../uiSettings';
import { formatExactScore, formatPlayerNumber } from '../game/copy';
import { activeSpecialOfferStatusItems } from '../game/specialOffers';
import { chapterPosition } from '../game/chapters';
import type { FlameDetailsTarget } from './FlameDetailsModal';
import { infernoMultiplier, infernoRoman } from '../game/engulfment';
import { exactRatioNumber } from '../game/scoreMath';

function HudStat({ testId, icon, label, value }: { testId: string; icon: string; label: string; value: number }) {
  const formatted = formatPlayerNumber(value);
  return <div className="hud-stat" data-testid={testId} aria-label={`${label} ${formatted}`}>
    <span aria-hidden="true" className="hud-stat-icon">{icon}</span>
    <span className="hud-stat-label">{label}</span>
    <strong>{formatted}</strong>
  </div>;
}

export function TopHud({ board, speed, setSpeed, diceDisplay, setDiceDisplay, openRunInfo, openHelp, openRestoreLives, openFlameDetails, returnToTitle, onMenuOpenChange }: {
  board: Board;
  speed: PlaybackSpeed;
  setSpeed: (speed: PlaybackSpeed) => void;
  diceDisplay: DiceDisplay;
  setDiceDisplay: (display: DiceDisplay) => void;
  openRunInfo: () => void;
  openHelp: () => void;
  openRestoreLives: () => void;
  openFlameDetails: (target: FlameDetailsTarget) => void;
  returnToTitle: () => void;
  onMenuOpenChange?: (opened: boolean) => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hearts = Array.from({ length: CONFIG.maxLives }, (_, index) => index < board.lives ? '♥' : '♡').join(' ');
  const specialOfferStatuses = activeSpecialOfferStatusItems(board.specialOfferEffects);
  const chapter = chapterPosition(board.round);
  function launch(action: () => void) {
    setDrawerOpen(false);
    onMenuOpenChange?.(false);
    action();
  }
  function setMenu(opened: boolean) {
    setDrawerOpen(opened);
    onMenuOpenChange?.(opened);
  }
  return <>
  <Box component="header" className="top-hud">
    <Group className="top-hud-row" justify="space-between" wrap="nowrap">
      <Text className="game-title">ROLL CALL</Text>
      <Group className="hud-stats" gap="xs" wrap="nowrap">
        <div className="hud-stat hud-stage" data-testid="stat-round"
          aria-label={`Chapter ${formatPlayerNumber(chapter.chapterNumber)}, Round ${formatPlayerNumber(chapter.chapterRound)}`}>
          <strong className="hud-stage-value">
            <span className="hud-stage-segment"><span className="hud-stage-letter">C</span>{formatPlayerNumber(chapter.chapterNumber)}</span>{' '}
            <span className="hud-stage-segment"><span className="hud-stage-letter">R</span>{formatPlayerNumber(chapter.chapterRound)}</span>
          </strong>
        </div>
        <HudStat testId="stat-gold" icon="●" label="Gold" value={board.gold} />
        {board.phase === 'shop'
          ? <Tooltip label="Restore lost lives" withArrow><UnstyledButton className="hud-lives interactive" data-testid="stat-lives"
            data-tutorial="lives"
            aria-label={`${board.lives} of ${CONFIG.maxLives} lives; restore lives`} onClick={openRestoreLives}>{hearts}</UnstyledButton></Tooltip>
          : <div className="hud-lives" data-testid="stat-lives" data-tutorial="lives" aria-label={`${board.lives} of ${CONFIG.maxLives} lives`}>{hearts}</div>}
      </Group>
      <ActionIcon className="menu-trigger" variant="subtle" color="gray" size="lg" aria-label="Open menu" onClick={() => setMenu(true)}>
        <span aria-hidden="true" className="hamburger-icon"><i /><i /><i /></span>
      </ActionIcon>
    </Group>
    {board.phase === 'round' && <Progress data-testid="round-goal-progress"
      value={board.target > 0n ? Math.min(100, exactRatioNumber(board.score, board.target) * 100) : 0} size={4} radius={0}
      aria-label="Round Goal progress" aria-valuetext={`${formatExactScore(board.score)} of ${formatExactScore(board.target)} points toward the Goal`} />}
    {board.flameSlots.some(Boolean) && <Group gap={4} px="xs" py={3} className="bonfire-strip" data-tutorial="flames" aria-label="Active Flames">
      <Text size="xs" fw={700} c="orange">FLAMES</Text>{board.flameSlots.flatMap(flame => flame ? [<Badge component="button" type="button" key={flame.instanceId}
        data-testid={`active-flame-${flame.instanceId}`} size="xs" color={flame.stage === 'bonfire' ? 'red' : 'orange'} variant="light" className="flame-detail-trigger" aria-label={`View ${FLAMES[flame.type].name} ${flame.stage} details`}
        onClick={() => openFlameDetails({ flameInstanceId: flame.instanceId, kind: flame.stage })}>🔥 {FLAMES[flame.type].shortName}</Badge>] : [])}
    </Group>}
    {board.engulfmentLevel > 0 && <Group gap="xs" px="xs" py={3}
      className="inferno-strip" aria-label="Inferno status">
      {board.engulfmentLevel > 0 && <Text size="xs" fw={900} c="red">INFERNO {infernoRoman(board.engulfmentLevel)} · ×{formatExactScore(infernoMultiplier(board.engulfmentLevel))}</Text>}
    </Group>}
    {specialOfferStatuses.length > 0 && <Group gap={4} px="xs" py={3} wrap="nowrap" className="special-effects-strip" data-tutorial="special-offer-status"
      aria-label="Active Special Offers" data-testid="special-effects-status">
      <Text className="special-effects-heading" size="xs" fw={700}>SPECIAL EFFECTS</Text>
      <div className="special-effects-badges">{specialOfferStatuses.map(status => <Tooltip key={status.type}
        label={status.description} multiline maw={320} withArrow events={{ hover: true, focus: true, touch: true }}>
        <Badge component="button" type="button" tabIndex={0} size="xs" color="teal" variant="light"
          className="special-effect-badge" data-testid={`special-effect-${status.type}`}
          aria-label={`${status.label}. ${status.description}`}>{status.label}</Badge>
      </Tooltip>)}</div>
    </Group>}
  </Box>
  <Drawer opened={drawerOpen} onClose={() => setMenu(false)} position="right" size={320} title="Menu"
    transitionProps={{ duration: 0 }} classNames={{ content: 'game-menu-drawer', header: 'game-menu-header' }}>
    <Stack gap="md">
      <div><Text size="xs" fw={800} tt="uppercase" mb={6}>Game speed</Text>
        <SegmentedControl fullWidth aria-label="Playback speed" value={speed}
          onChange={value => setSpeed(value as PlaybackSpeed)}
          data={[{ label: 'NORMAL', value: 'normal' }, { label: 'FAST', value: 'fast' }, { label: 'INSTANT', value: 'instant' }]} />
      </div>
      <div><Text size="xs" fw={800} tt="uppercase" mb={6}>Dice display</Text>
        <SegmentedControl fullWidth aria-label="Dice display" value={diceDisplay}
          onChange={value => setDiceDisplay(value as DiceDisplay)}
          data={[{ label: 'NUMERALS', value: 'numerals' }, { label: 'PIPS', value: 'pips' }]} />
      </div>
      <Divider />
      <Button variant="default" fullWidth onClick={() => launch(openRunInfo)}>Run Info</Button>
      <Button variant="default" fullWidth onClick={() => launch(openHelp)}>How to Play</Button>
      <Button variant="subtle" color="gray" fullWidth onClick={() => launch(returnToTitle)}>Return to Title</Button>
    </Stack>
  </Drawer>
  </>;
}
