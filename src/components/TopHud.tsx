import { ActionIcon, Box, Group, Progress, SegmentedControl, Text, Tooltip } from '@mantine/core';
import type { Board } from '../game/types';
import type { PlaybackSpeed } from '../useGame';

function HudStat({ testId, icon, label, value }: { testId: string; icon: string; label: string; value: number }) {
  return <div className="hud-stat" data-testid={testId} aria-label={`${label} ${value}`}>
    <span aria-hidden="true" className="hud-stat-icon">{icon}</span>
    <span className="hud-stat-label">{label}</span>
    <strong>{value}</strong>
  </div>;
}

export function TopHud({ board, speed, setSpeed, openRunInfo, openHelp }: {
  board: Board;
  speed: PlaybackSpeed;
  setSpeed: (speed: PlaybackSpeed) => void;
  openRunInfo: () => void;
  openHelp: () => void;
}) {
  return <Box component="header" className="top-hud">
    <Group className="top-hud-row" justify="space-between" wrap="nowrap">
      <Text className="game-title">ROLL CALL</Text>
      <Group className="hud-stats" gap="xs" wrap="nowrap">
        <HudStat testId="stat-round" icon="R" label="Round" value={board.round} />
        <HudStat testId="stat-goal" icon="◎" label="Goal" value={board.target} />
        <HudStat testId="stat-score" icon="★" label="Score" value={board.score} />
        <HudStat testId="stat-gold" icon="●" label="Gold" value={board.gold} />
        {board.phase === 'shop'
          ? <div className="hud-phase" aria-label="Shop phase">SHOP</div>
          : <HudStat testId="stat-rerolls" icon="↻" label="Rerolls" value={board.manualRerollsRemaining} />}
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
  </Box>;
}
