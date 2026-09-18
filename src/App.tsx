import { Alert, Badge, Button, Container, Group, Paper, Progress, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { DebugPanel } from './components/DebugPanel';
import { DiceRow } from './components/DiceRow';
import { RoundScreen } from './components/RoundScreen';
import { ShopScreen } from './components/ShopScreen';
import { emptySelection } from './game/selection';
import type { Action } from './game/types';
import { useGame } from './useGame';
import type { PlaybackSpeed } from './useGame';

const query = new URLSearchParams(window.location.search);
const initialSeed = query.get('seed') || 'roll-call';
const initialSpeed = ['normal', 'fast', 'instant'].includes(query.get('speed') ?? '') ? query.get('speed') as PlaybackSpeed : 'normal';
const freshSeed = () => `roll-${Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('-')}`;

export default function App() {
  const [seedInput, setSeedInput] = useState(initialSeed);
  const [speed, setSpeed] = useState<PlaybackSpeed>(initialSpeed);
  const [selection, setSelection] = useState(emptySelection);
  const [selectedOffer, setSelectedOffer] = useState<number | null>(null);
  const game = useGame(initialSeed, speed);
  const { board, state, busy, event, progress } = game;
  function submit(action: Action) {
    if (busy) return;
    game.submit(action);
    // Buying an invalid placement retains the offer so the player can try another die.
    if (action.type !== 'BUY') setSelectedOffer(null);
    setSelection(emptySelection());
  }
  function restart(seed: string) {
    setSeedInput(seed);
    setSelection(emptySelection());
    setSelectedOffer(null);
    game.restart(seed);
  }
  return <Container size={980} py="xl">
    <Group justify="space-between" mb="lg">
      <div><Group gap="sm"><Title order={1} size="h2">ROLL CALL</Title><Badge color="gray" variant="light">Gameplay prototype</Badge></Group><Text size="sm" c="dimmed">Five dice. Build their faces. Keep the run alive.</Text></div>
      <SegmentedControl size="xs" aria-label="Playback speed" value={speed} onChange={value => setSpeed(value as PlaybackSpeed)}
        data={[{ label: 'NORMAL', value: 'normal' }, { label: 'FAST', value: 'fast' }, { label: 'INSTANT', value: 'instant' }]} />
    </Group>
    <Paper withBorder p="md" mb="lg">
      <div className={`stats-row ${board.phase !== 'shop' ? 'with-rerolls' : ''}`}>{[
        ['Round', board.round], ['Goal', board.target], ['Score', board.score], ['Gold', board.gold],
        ...(board.phase !== 'shop' ? [['Rerolls', board.manualRerollsRemaining]] : []),
      ].map(([label, value]) => <div key={label} data-testid={`stat-${String(label).toLowerCase()}`}><Text size="xs" c="dimmed" tt="uppercase">{label}</Text><Text size="xl" fw={700}>{value}</Text></div>)}</div>
      <Progress value={Math.min(100, board.score / board.target * 100)} size="xs" mt="md" aria-label="Round goal progress" />
    </Paper>
    {game.error && <Alert color="orange" withCloseButton onClose={game.clearError} mb="md" title="Action unavailable">{game.error}</Alert>}
    {board.phase === 'shop' && board.shop ? <ShopScreen board={board} event={event} busy={busy} progress={progress}
      selectedOffer={selectedOffer} setSelectedOffer={setSelectedOffer} submit={submit} skip={game.skip} />
      : board.phase === 'lost' || board.phase === 'error' ? <Stack gap="lg">
        <Paper withBorder p="xl" ta="center">
          <Title order={2}>{board.phase === 'lost' ? 'Run over' : 'Resolution stopped'}</Title>
          <Text mt="sm">{board.phase === 'lost' ? `Reached round ${board.round}. Final score ${board.score} / ${board.target}. No legal unconsumed hands or manual rerolls remain.` : state.stats.resolutionError}</Text>
          <Text size="sm" c="dimmed" mt="sm">Run data and the complete event log are available below.</Text>
          <Group justify="center" mt="lg"><Button onClick={() => restart(state.seed)}>Restart same seed</Button><Button variant="default" onClick={() => restart(freshSeed())}>New seed</Button></Group>
        </Paper>
        <DiceRow dice={board.dice} event={null} disabled selected={[]} onClick={() => {}} />
      </Stack>
      : <RoundScreen board={board} event={event} busy={busy} progress={progress} selection={selection} setSelection={setSelection} submit={submit} skip={game.skip} />}
    <DebugPanel state={state} visibleEventId={event?.id} busy={busy} />
    <Paper withBorder p="md" mt="lg">
      <Group justify="space-between" align="end">
        <TextInput label="Run seed" size="xs" value={seedInput} onChange={event => setSeedInput(event.currentTarget.value)} style={{ flex: '1 1 220px' }} />
        <Group gap="xs"><Button size="xs" variant="default" disabled={!seedInput.trim()} onClick={() => restart(seedInput.trim())}>Start seed</Button><Button size="xs" variant="default" onClick={() => restart(state.seed)}>Restart same seed</Button><Button size="xs" variant="light" onClick={() => restart(freshSeed())}>New seed</Button></Group>
      </Group>
      <Text size="xs" c="dimmed" mt="xs">Starting or restarting replaces this run. Copy its data first if you want to keep it.</Text>
    </Paper>
  </Container>;
}
