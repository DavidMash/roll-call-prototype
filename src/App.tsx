import { Alert, Button, Container, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useLayoutEffect, useRef, useState } from 'react';
import { RunInfoModal } from './components/DebugPanel';
import { DiceRow } from './components/DiceRow';
import { BustScreen } from './components/BustScreen';
import { FlameSelectionScreen } from './components/FlameSelectionScreen';
import { HelpModal } from './components/HelpModal';
import { RoundScreen } from './components/RoundScreen';
import { RestoreLivesModal } from './components/RestoreLivesModal';
import { ShopScreen } from './components/ShopScreen';
import { TopHud } from './components/TopHud';
import { RunMapTransition } from './components/RunMapTransition';
import { RoundSummaryScreen } from './components/RoundSummaryScreen';
import { screenTheme } from './game/screenThemes';
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
  const [restoreLivesOpen, setRestoreLivesOpen] = useState(false);
  const [hudHeight, setHudHeight] = useState(60);
  const appRef = useRef<HTMLDivElement>(null);
  const game = useGame(initialSeed, speed);
  const { board, state, busy, event, progress } = game;
  const theme = screenTheme(board);
  useLayoutEffect(() => {
    const hud = appRef.current?.querySelector<HTMLElement>('.top-hud');
    if (!hud) return;
    const measure = () => setHudHeight(Math.ceil(hud.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(hud);
    return () => observer.disconnect();
  }, []);
  function submit(action: Action) {
    if (busy) return;
    if (!game.submit(action)) return;
    if (!['BUY', 'SELL_ENHANCEMENT', 'STOKE_FLAME', 'RESTORE_LIFE', 'DISMISS_FLAME_TUTORIAL'].includes(action.type)) setSelectedOffer(null);
    setSelectedFlameOffer(null);
    setSelection(emptySelection());
  }
  function restart(seed: string) {
    setSeedInput(seed);
    setSelection(emptySelection());
    setSelectedOffer(null);
    setSelectedFlameOffer(null);
    setRunInfoOpen(false);
    setRestoreLivesOpen(false);
    game.restart(seed);
  }
  return <Container ref={appRef} size={1180} px={{ base: 6, sm: 'sm' }} py={8} className="app-container screen-theme"
    data-screen-theme={theme.id} style={{ '--screen-primary': theme.accent, '--screen-secondary': theme.accentStrong,
      '--hud-sticky-offset': `${hudHeight + 8}px` } as React.CSSProperties}>
    <TopHud board={board} speed={speed} setSpeed={setSpeed} openRunInfo={() => setRunInfoOpen(true)} openHelp={() => setHelpOpen(true)}
      openRestoreLives={() => setRestoreLivesOpen(true)} />
    {game.error && <Alert color="orange" withCloseButton onClose={game.clearError} my="xs" py={5} title="Action unavailable">{game.error}</Alert>}
    <main className="main-content">
      {event?.type === 'MAP_TRANSITION' ? <RunMapTransition seed={state.seed} event={event} onContinue={game.continueTransition} />
        : board.phase === 'roundSummary' && board.roundSummary ? <RoundSummaryScreen board={board} busy={busy} submit={submit} />
        : board.phase === 'flameSelection' && board.flameSelection ? <FlameSelectionScreen board={board} event={event} busy={busy} progress={progress}
        selectedOffer={selectedFlameOffer} setSelectedOffer={setSelectedFlameOffer} submit={submit} skip={game.skip} />
        : board.phase === 'shop' && board.shop ? <ShopScreen board={board} event={event} busy={busy} progress={progress}
        selectedOffer={selectedOffer} setSelectedOffer={setSelectedOffer} submit={submit} skip={game.skip} />
        : (board.phase === 'bust' || (board.phase === 'lost' && board.bust)) ? <BustScreen board={board}
          restartSame={() => restart(state.seed)} newRun={() => restart(freshSeed())} />
        : board.phase === 'lost' || board.phase === 'error' ? <Stack gap="sm">
          <Paper p="xl" ta="center" className="end-state">
            <Title order={2}>{board.phase === 'lost' ? 'RUN OVER' : 'Resolution stopped'}</Title>
            <Text mt="sm">{board.phase === 'lost' && board.bust ? `Bust on round ${board.bust.round}: ${board.bust.score} / ${board.bust.target}. No lives remain.` : state.stats.resolutionError}</Text>
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
    <RestoreLivesModal board={board} opened={restoreLivesOpen && board.phase === 'shop'} busy={busy}
      onClose={() => setRestoreLivesOpen(false)} submit={submit} />
  </Container>;
}
