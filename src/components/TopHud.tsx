import { ActionIcon, Badge, Box, Group, Progress, SegmentedControl, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { CONFIG } from '../game/config';
import type { Board } from '../game/types';
import { FLAMES } from '../game/flames';
import type { PlaybackSpeed } from '../useGame';
import { BOSSES } from '../game/bosses';

function HudStat({ testId, icon, label, value }: { testId: string; icon: string; label: string; value: number }) {
  return <div className="hud-stat" data-testid={testId} aria-label={`${label} ${value}`}>
    <span aria-hidden="true" className="hud-stat-icon">{icon}</span>
    <span className="hud-stat-label">{label}</span>
    <strong>{value}</strong>
  </div>;
}

export function TopHud({ board, speed, setSpeed, openRunInfo, openHelp, openRestoreLives }: {
  board: Board;
  speed: PlaybackSpeed;
  setSpeed: (speed: PlaybackSpeed) => void;
  openRunInfo: () => void;
  openHelp: () => void;
  openRestoreLives: () => void;
}) {
  const hearts = Array.from({ length: CONFIG.maxLives }, (_, index) => index < board.lives ? '♥' : '♡').join(' ');
  return <Box component="header" className="top-hud">
    <Group className="top-hud-row" justify="space-between" wrap="nowrap">
      <Text className="game-title">ROLL CALL</Text>
      <Group className="hud-stats" gap="xs" wrap="nowrap">
        <HudStat testId="stat-round" icon="R" label="Round" value={board.round} />
        <HudStat testId="stat-goal" icon="◎" label="Goal" value={board.target} />
        <HudStat testId="stat-score" icon="★" label="Score" value={board.score} />
        <HudStat testId="stat-gold" icon="●" label="Gold" value={board.gold} />
        {board.phase === 'shop'
          ? <Tooltip label="Restore lost lives" withArrow><UnstyledButton className="hud-lives interactive" data-testid="stat-lives"
            aria-label={`${board.lives} of ${CONFIG.maxLives} lives; restore lives`} onClick={openRestoreLives}>{hearts}</UnstyledButton></Tooltip>
          : <div className="hud-lives" data-testid="stat-lives" aria-label={`${board.lives} of ${CONFIG.maxLives} lives`}>{hearts}</div>}
        {board.phase === 'shop' || board.phase === 'flameReward'
          ? <div className="hud-phase" aria-label={board.phase === 'shop' ? 'Shop phase' : 'Flame Reward phase'}>{board.phase === 'shop' ? 'SHOP' : 'FLAME'}</div>
          : board.phase === 'round' ? <><HudStat testId="stat-rerolls" icon="↻" label="Rerolls" value={board.manualRerollsRemaining} />
            {board.boss && <div className="hud-phase" data-testid="boss-hud-label">{BOSSES[board.boss.type].name}</div>}</>
            : <div className="hud-phase" aria-label={board.phase === 'bust' ? 'Bust phase' : 'Run ended'}>{board.phase === 'bust' ? 'BUST' : 'OVER'}</div>}
      </Group>
      <Group className="hud-actions" gap={6} wrap="nowrap">
        <SegmentedControl size="xs" aria-label="Playback speed" value={speed}
          onChange={value => setSpeed(value as PlaybackSpeed)}
          data={[{ label: 'NORMAL', value: 'normal' }, { label: 'FAST', value: 'fast' }, { label: 'INSTANT', value: 'instant' }]} />
        <Tooltip label="Run Info" withArrow>
          <ActionIcon variant="subtle" color="gray" aria-label="Run Info" onClick={openRunInfo}>◉</ActionIcon>
        </Tooltip>
        <Tooltip label="How to Play" withArrow>
          <ActionIcon variant="subtle" color="gray" aria-label="How to Play" onClick={openHelp}>?</ActionIcon>
        </Tooltip>
      </Group>
    </Group>
    <Progress value={Math.min(100, board.score / board.target * 100)} size={4} radius={0} aria-label="Round goal progress" />
    {board.bonfires.length > 0 && <Group gap={4} px="xs" py={3} className="bonfire-strip" aria-label="Active Bonfires">
      <Text size="xs" fw={700} c="orange">BONFIRES</Text>{board.bonfires.map(id => <Tooltip key={id} label={FLAMES[id].bonfireDescription} withArrow><Badge size="xs" color="red" variant="light">🔥 {FLAMES[id].shortName}</Badge></Tooltip>)}
    </Group>}
  </Box>;
}
