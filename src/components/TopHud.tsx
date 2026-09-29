import { ActionIcon, Badge, Box, Button, Divider, Drawer, Group, Progress, SegmentedControl, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { CONFIG } from '../game/config';
import type { Board } from '../game/types';
import { FLAMES } from '../game/flames';
import type { PlaybackSpeed } from '../useGame';
import type { DiceDisplay } from '../uiSettings';

function HudStat({ testId, icon, label, value }: { testId: string; icon: string; label: string; value: number }) {
  return <div className="hud-stat" data-testid={testId} aria-label={`${label} ${value}`}>
    <span aria-hidden="true" className="hud-stat-icon">{icon}</span>
    <span className="hud-stat-label">{label}</span>
    <strong>{value}</strong>
  </div>;
}

export function TopHud({ board, speed, setSpeed, diceDisplay, setDiceDisplay, openRunInfo, openHelp, openRestoreLives }: {
  board: Board;
  speed: PlaybackSpeed;
  setSpeed: (speed: PlaybackSpeed) => void;
  diceDisplay: DiceDisplay;
  setDiceDisplay: (display: DiceDisplay) => void;
  openRunInfo: () => void;
  openHelp: () => void;
  openRestoreLives: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hearts = Array.from({ length: CONFIG.maxLives }, (_, index) => index < board.lives ? '♥' : '♡').join(' ');
  function launch(action: () => void) {
    setDrawerOpen(false);
    action();
  }
  return <>
  <Box component="header" className="top-hud">
    <Group className="top-hud-row" justify="space-between" wrap="nowrap">
      <Text className="game-title">ROLL CALL</Text>
      <Group className="hud-stats" gap="xs" wrap="nowrap">
        <HudStat testId="stat-round" icon="R" label="Round" value={board.round} />
        <HudStat testId="stat-gold" icon="●" label="Gold" value={board.gold} />
        {board.phase === 'shop'
          ? <Tooltip label="Restore lost lives" withArrow><UnstyledButton className="hud-lives interactive" data-testid="stat-lives"
            aria-label={`${board.lives} of ${CONFIG.maxLives} lives; restore lives`} onClick={openRestoreLives}>{hearts}</UnstyledButton></Tooltip>
          : <div className="hud-lives" data-testid="stat-lives" aria-label={`${board.lives} of ${CONFIG.maxLives} lives`}>{hearts}</div>}
        {board.phase === 'shop' || board.phase === 'flameSelection' || board.phase === 'roundSummary'
          ? <div className="hud-phase" aria-label={board.phase === 'shop' ? 'Shop phase' : board.phase === 'flameSelection' ? 'Flame Selection phase' : 'Round Summary phase'}>
            {board.phase === 'shop' ? 'SHOP' : board.phase === 'flameSelection' ? 'FLAME SELECTION' : 'SUMMARY'}
          </div>
          : board.phase === 'round' ? <div className="hud-phase" aria-label="Round phase">ROUND {board.round}</div>
            : <div className="hud-phase" aria-label={board.phase === 'bust' ? 'Bust phase' : 'Run ended'}>{board.phase === 'bust' ? 'BUST' : 'OVER'}</div>}
      </Group>
      <ActionIcon className="menu-trigger" variant="subtle" color="gray" size="lg" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
        <span aria-hidden="true" className="hamburger-icon"><i /><i /><i /></span>
      </ActionIcon>
    </Group>
    {board.phase === 'round' && <Progress data-testid="round-goal-progress"
      value={Math.min(100, board.score / board.target * 100)} size={4} radius={0}
      aria-label="Round Goal progress" aria-valuetext={`${board.score} of ${board.target} points toward the Goal`} />}
    {board.bonfires.length > 0 && <Group gap={4} px="xs" py={3} className="bonfire-strip" aria-label="Active Bonfires">
      <Text size="xs" fw={700} c="orange">BONFIRES</Text>{board.bonfires.map(id => <Tooltip key={id} label={FLAMES[id].bonfireDescription} withArrow><Badge size="xs" color="red" variant="light">🔥 {FLAMES[id].shortName}</Badge></Tooltip>)}
    </Group>}
  </Box>
  <Drawer opened={drawerOpen} onClose={() => setDrawerOpen(false)} position="right" size={320} title="Menu"
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
    </Stack>
  </Drawer>
  </>;
}
