import { Alert, Button, Container, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { RunInfoModal } from './components/DebugPanel';
import { DiceRow } from './components/DiceRow';
import { FlameRewardScreen } from './components/FlameRewardScreen';
import { HelpModal } from './components/HelpModal';
import { RoundScreen } from './components/RoundScreen';
import { ShopScreen } from './components/ShopScreen';
import { TopHud } from './components/TopHud';
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
  const [selectedFlameOffer, setSelectedFlameOffer] = useState<number | null>(null);
  const [runInfoOpen, setRunInfoOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const game = useGame(initialSeed, speed);
  const { board, state, busy, event, progress } = game;
  function submit(action: Action) {
    if (busy) return;
    game.submit(action);
    if (action.type !== 'BUY' && action.type !== 'SCRAP_ENHANCEMENT' && action.type !== 'STOKE_FLAME') setSelectedOffer(null);
    setSelectedFlameOffer(null);
    setSelection(emptySelection());
  }
  function restart(seed: string) {
    setSeedInput(seed);
    setSelection(emptySelection());
    setSelectedOffer(null);
    setSelectedFlameOffer(null);
    setRunInfoOpen(false);
    game.restart(seed);
  }
  return <Container size={1180} px={{ base: 6, sm: 'sm' }} py={8} className="app-container">
    <TopHud board={board} speed={speed} setSpeed={setSpeed} openRunInfo={() => setRunInfoOpen(true)} openHelp={() => setHelpOpen(true)} />
    {game.error && <Alert color="orange" withCloseButton onClose={game.clearError} my="xs" py={5} title="Action unavailable">{game.error}</Alert>}
    <main className="main-content">
      {board.phase === 'flameReward' && board.flameReward ? <FlameRewardScreen board={board} event={event} busy={busy} progress={progress}
        selectedOffer={selectedFlameOffer} setSelectedOffer={setSelectedFlameOffer} submit={submit} skip={game.skip} />
        : board.phase === 'shop' && board.shop ? <ShopScreen board={board} event={event} busy={busy} progress={progress}
        selectedOffer={selectedOffer} setSelectedOffer={setSelectedOffer} submit={submit} skip={game.skip} />
        : board.phase === 'lost' || board.phase === 'error' ? <Stack gap="sm">
          <Paper p="xl" ta="center" className="end-state">
            <Title order={2}>{board.phase === 'lost' ? 'Run over' : 'Resolution stopped'}</Title>
            <Text mt="sm">{board.phase === 'lost' ? `Reached round ${board.round}. Final score ${board.score} / ${board.target}. No legal unconsumed hands or manual rerolls remain.` : state.stats.resolutionError}</Text>
            <Text size="sm" c="dimmed" mt="sm">Run details and event history are available in Run Info.</Text>
            <Group justify="center" mt="lg"><Button onClick={() => restart(state.seed)}>Restart same seed</Button><Button variant="default" onClick={() => restart(freshSeed())}>New seed</Button></Group>
          </Paper>
          <Paper p="xs"><DiceRow dice={board.dice} event={null} disabled selected={[]} onClick={() => {}} /></Paper>
        </Stack>
        : <RoundScreen board={board} event={event} busy={busy} progress={progress} selection={selection} setSelection={setSelection} submit={submit} skip={game.skip} />}
    </main>
    <RunInfoModal state={state} visibleEventId={event?.id} busy={busy} opened={runInfoOpen} onClose={() => setRunInfoOpen(false)}
      seedInput={seedInput} setSeedInput={setSeedInput} startSeed={() => restart(seedInput.trim())}
      restartSeed={() => restart(state.seed)} newSeed={() => restart(freshSeed())} />
    <HelpModal opened={helpOpen} onClose={() => setHelpOpen(false)} />
  </Container>;
}
