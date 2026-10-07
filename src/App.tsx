import { Alert, Button, Container, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useEffect, useLayoutEffect, useState } from 'react';
import { RunInfoModal } from './components/DebugPanel';
import { DiceDock } from './components/DiceDock';
import { BustScreen } from './components/BustScreen';
import { FlameSelectionScreen } from './components/FlameSelectionScreen';
import { HelpModal } from './components/HelpModal';
import { RoundScreen } from './components/RoundScreen';
import { RestoreLivesModal } from './components/RestoreLivesModal';
import { ShopScreen } from './components/ShopScreen';
import { TopHud } from './components/TopHud';
import { RunMapTransition } from './components/RunMapTransition';
import { ChapterSplash } from './components/ChapterSplash';
import { RoundSummaryScreen } from './components/RoundSummaryScreen';
import { SpecialOfferScreen } from './components/SpecialOfferScreen';
import { screenTheme } from './game/screenThemes';
import { emptySelection } from './game/selection';
import type { Action } from './game/types';
import { useGame } from './useGame';
import type { PlaybackSpeed } from './useGame';
import { loadDiceDisplay, saveDiceDisplay } from './uiSettings';
import { formatScoreProgress } from './game/copy';
import { chapterLabel, chapterNumberForRound } from './game/chapters';
import { FaceDetailsModal } from './components/FaceDetailsModal';
import type { FaceDetailsTarget } from './components/FaceDetailsModal';
import { FlameDetailsModal } from './components/FlameDetailsModal';
import type { FlameDetailsTarget } from './components/FlameDetailsModal';
import { LandingScreen } from './components/LandingScreen';
import { isResumableRun } from './game/persistence';
import { useTutorialGame } from './tutorial/useTutorialGame';
import { TutorialDirector } from './tutorial/TutorialDirector';
import { activeTutorialBeat } from './tutorial/tutorialSteps';
import { defaultOnboardingMetadata, isResumableTutorial, loadOnboardingMetadata, saveOnboardingMetadata } from './tutorial/tutorialPersistence';
import type { OnboardingMetadata, TutorialBeat } from './tutorial/types';
import { isChapterMapTransition } from './game/playback';
import { RunActionRow, RunActionRowContext } from './components/RunActionRow';

const freshSeed = () => `roll-${Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('-')}`;
const query = new URLSearchParams(window.location.search);
const requestedSeed = query.get('seed')?.trim() || null;
const initialSeed = requestedSeed ?? freshSeed();
const initialSpeed = ['normal', 'fast', 'instant'].includes(query.get('speed') ?? '') ? query.get('speed') as PlaybackSpeed : 'normal';

export default function App() {
  const [runMode, setRunMode] = useState<'normal' | 'tutorial' | null>(null);
  const atLanding = runMode === null;
  const [seedInput, setSeedInput] = useState(initialSeed);
  const [speed, setSpeed] = useState<PlaybackSpeed>(initialSpeed);
  const [diceDisplay, setDiceDisplay] = useState(loadDiceDisplay);
  const [selection, setSelection] = useState(emptySelection);
  const [selectedOffer, setSelectedOffer] = useState<number | null>(null);
  const [selectedFlameOffer, setSelectedFlameOffer] = useState<number | null>(null);
  const [runInfoOpen, setRunInfoOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [restoreLivesOpen, setRestoreLivesOpen] = useState(false);
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  const [faceDetails, setFaceDetails] = useState<FaceDetailsTarget | null>(null);
  const [flameDetails, setFlameDetails] = useState<FlameDetailsTarget | null>(null);
  const [actionRowTarget, setActionRowTarget] = useState<HTMLDivElement | null>(null);
  const normalGame = useGame(requestedSeed, initialSeed, speed, runMode === 'normal');
  const tutorialGame = useTutorialGame(speed, runMode === 'tutorial');
  const game = runMode === 'tutorial' ? tutorialGame : normalGame;
  const [onboarding, setOnboarding] = useState<OnboardingMetadata>(() => {
    try { return loadOnboardingMetadata(window.localStorage); }
    catch { return defaultOnboardingMetadata(); }
  });
  const { board, state, busy, event, progress } = game;
  const resumableRun = normalGame.hasStoredRun && isResumableRun(normalGame.state) ? normalGame.state : null;
  const resumableTutorial = tutorialGame.hasStoredRun && isResumableTutorial(tutorialGame.session) ? tutorialGame.session : null;
  const theme = screenTheme(board);
  const showingChapterSplash = event?.type === 'CHAPTER_STARTED';
  const showingMap = isChapterMapTransition(event);
  const dockActionsEnabled = !busy && !showingChapterSplash && !showingMap && !gameMenuOpen && !runInfoOpen && !helpOpen
    && !restoreLivesOpen && faceDetails === null && flameDetails === null;
  const tutorialUiState = { selection, selectedOffer, selectedFlameOffer, flameDetailsOpen: flameDetails !== null };
  const tutorialPaused = busy || showingChapterSplash || showingMap || gameMenuOpen || runInfoOpen || helpOpen || restoreLivesOpen || faceDetails !== null
    || (flameDetails !== null && !(tutorialGame.session.scenario.completedBeatIds.includes('flame-details')
      && tutorialGame.session.game.stats.flameStokes.length === 0));
  const currentTutorialBeat = runMode === 'tutorial' && !tutorialPaused
    ? activeTutorialBeat(tutorialGame.session, tutorialUiState) : null;
  const tutorialProgressNudgeEligible = runMode === 'tutorial' && board.phase === 'shop' && !!board.shop && !board.bust
    && chapterNumberForRound(board.round) <= 2 && !tutorialPaused && currentTutorialBeat === null
    && selectedOffer === null && selectedFlameOffer === null;
  const contextualFlameCue: TutorialBeat | null = runMode === 'normal' && board.phase === 'shop'
    && board.flameTutorial.pendingDieId !== null && !board.flameTutorial.completed ? {
      id: 'first-flame-ember', title: 'NEW EMBER',
      body: ['Stoke Flames in the Shop. At 100 Gold, they become Bonfires.'],
      target: `[data-tutorial="flame-badge"][data-flame-die-id="${board.flameTutorial.pendingDieId}"]`,
      highlightTargets: [`[data-tutorial="flame-badge"][data-flame-die-id="${board.flameTutorial.pendingDieId}"]`],
      interactiveTargets: [`[data-tutorial="flame-badge"][data-flame-die-id="${board.flameTutorial.pendingDieId}"]`],
      blocking: false, gateInteractions: false, requiredAction: 'Open the Flame details.',
      completion: { kind: 'action', description: 'Open the Flame details.' },
    } : null;
  useLayoutEffect(() => setSeedInput(state.seed), [state.seed]);
  useEffect(() => saveDiceDisplay(diceDisplay), [diceDisplay]);
  useEffect(() => { saveOnboardingMetadata(window.localStorage, onboarding); }, [onboarding]);
  useEffect(() => {
    if (normalGame.hasStoredRun && normalGame.state.phase === 'lost' && !onboarding.normalRunFinishedOnce) {
      const next = { ...onboarding, normalRunFinishedOnce: true };
      saveOnboardingMetadata(window.localStorage, next);
      setOnboarding(next);
    }
  }, [normalGame.hasStoredRun, normalGame.state.phase, onboarding]);
  function submit(action: Action) {
    if (busy) return;
    if (!game.submit(action)) return;
    if (!['BUY', 'SELL_ENHANCEMENT', 'STOKE_FLAME', 'RESTORE_LIFE', 'DISMISS_FLAME_TUTORIAL'].includes(action.type)) setSelectedOffer(null);
    setSelectedFlameOffer(null);
    if (action.type !== 'TOGGLE_CHARGE') setSelection(emptySelection());
  }
  function restart(seed: string) {
    if (runMode === 'tutorial') {
      tutorialGame.restart();
      setSelection(emptySelection());
      setSelectedOffer(null);
      setSelectedFlameOffer(null);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('seed', seed);
    window.history.replaceState(window.history.state, '', url);
    setSeedInput(seed);
    setSelection(emptySelection());
    setSelectedOffer(null);
    setSelectedFlameOffer(null);
    setRunInfoOpen(false);
    setRestoreLivesOpen(false);
    setFaceDetails(null);
    setFlameDetails(null);
    normalGame.restart(seed);
  }
  function startNewRunFromLanding() {
    restart(requestedSeed ?? (game.hasStoredRun ? freshSeed() : initialSeed));
    setRunMode('normal');
  }
  function startTutorialFromLanding() {
    if (!resumableTutorial || onboarding.tutorialCompleted) tutorialGame.restart();
    setSelection(emptySelection());
    setSelectedOffer(null);
    setSelectedFlameOffer(null);
    setRunMode('tutorial');
  }
  function returnToTitle() {
    setGameMenuOpen(false);
    setRunMode(null);
  }
  function finishTutorial() {
    const next = { ...onboarding, tutorialCompleted: true };
    saveOnboardingMetadata(window.localStorage, next);
    setOnboarding(next);
    tutorialGame.clearStored();
    setRunMode(null);
  }
  function openFlameDetails(target: FlameDetailsTarget) {
    if (target.kind === 'ember' && target.dieId === state.flameTutorial.pendingDieId && !state.flameTutorial.completed) {
      submit({ type: 'DISMISS_FLAME_TUTORIAL' });
    } else if (runMode === 'tutorial' && target.kind === 'ember'
      && target.dieId === tutorialGame.session.scenario.firstFlameDieId
      && !tutorialGame.session.scenario.completedBeatIds.includes('flame-details')) {
      tutorialGame.completeBeat('flame-details');
    }
    setFlameDetails(target);
  }
  function closeFlameDetails() {
    const closing = flameDetails;
    setFlameDetails(null);
    window.setTimeout(() => {
      if (!closing) return;
      const selector = closing.kind === 'offer'
        ? `[data-testid="flame-offer-${closing.flame}"] .flame-offer-info`
        : closing.kind === 'ember' && closing.dieId !== undefined
          ? `[data-tutorial="flame-badge"][data-flame-die-id="${closing.dieId}"]`
          : null;
      if (selector) document.querySelector<HTMLElement>(selector)?.focus();
    }, 0);
  }
  if (atLanding) return <Container size={1180} px={{ base: 6, sm: 'sm' }} py={8} className="landing-container">
    <LandingScreen resumableRun={resumableRun} resumableTutorial={resumableTutorial} onboarding={onboarding}
      onContinue={() => setRunMode('normal')} onTutorial={startTutorialFromLanding} onNewRun={startNewRunFromLanding} />
  </Container>;
  return <RunActionRowContext.Provider value={actionRowTarget}><Container size={1180} px={{ base: 6, sm: 'sm' }} py={8}
    className={`app-container screen-theme ${board.phase === 'round' ? 'active-gameplay' : ''}`}
    data-screen-theme={theme.id} data-playback-speed={speed}
    style={{ '--screen-primary': theme.accent, '--screen-secondary': theme.accentStrong } as React.CSSProperties}>
    {!showingChapterSplash && <TopHud board={board} speed={speed} setSpeed={setSpeed} diceDisplay={diceDisplay} setDiceDisplay={setDiceDisplay}
      openRunInfo={() => setRunInfoOpen(true)} openHelp={() => setHelpOpen(true)}
      openRestoreLives={() => setRestoreLivesOpen(true)} openFlameDetails={openFlameDetails} onMenuOpenChange={setGameMenuOpen}
      returnToTitle={returnToTitle} />}
    {game.error && <Alert color="orange" withCloseButton onClose={game.clearError} my="xs" py={5} title="Action unavailable">{game.error}</Alert>}
    <main className="main-content">
      {busy && !showingMap && event?.type !== 'ROUND_BUST' && event?.type !== 'CHAPTER_STARTED'
        && <span className="visually-hidden">EVENT {progress.current} / {progress.total}</span>}
      {event?.type === 'CHAPTER_STARTED' ? <ChapterSplash key={event.id} event={event} onComplete={game.continuePlayback} />
        : showingMap ? <RunMapTransition key={event!.id} seed={state.seed} event={event!} onContinue={game.continuePlayback} />
        : board.phase === 'roundSummary' && board.roundSummary ? <RoundSummaryScreen board={board} busy={busy} submit={submit} />
        : board.phase === 'flameSelection' && board.flameSelection ? <FlameSelectionScreen board={board} event={event} busy={busy}
        selectedOffer={selectedFlameOffer} setSelectedOffer={setSelectedFlameOffer} submit={submit} skip={game.skip} openFlameDetails={openFlameDetails} />
        : board.phase === 'specialOffer' && board.specialOffer ? <SpecialOfferScreen board={board} busy={busy} submit={submit} />
        : board.phase === 'shop' && board.shop ? <ShopScreen board={board} event={event} busy={busy}
        selectedOffer={selectedOffer} setSelectedOffer={setSelectedOffer} submit={submit} skip={game.skip}
        tutorialProgressNudgeEligible={tutorialProgressNudgeEligible} />
      : (board.phase === 'bust' || (board.phase === 'lost' && board.bust)) ? <BustScreen board={board}
          onContinue={event?.type === 'ROUND_BUST' && (board.bust?.livesAfter ?? 0) > 0 ? game.continuePlayback : undefined}
          restartSame={() => restart(state.seed)} newRun={() => restart(freshSeed())} />
        : board.phase === 'lost' || board.phase === 'error' ? <Stack gap="sm">
          <Paper p="xl" ta="center" className="end-state">
            <Title order={2}>{board.phase === 'lost' ? 'Run Over' : 'Resolution stopped'}</Title>
            <Text mt="sm">{board.phase === 'lost' && board.bust ? `Bust on ${chapterLabel(board.bust.round)}: ${formatScoreProgress(board.bust.score, board.bust.target)}. No lives remain.` : state.stats.resolutionError}</Text>
            <Text size="sm" c="dimmed" mt="sm">Run details and event history are available in Run Info.</Text>
            <Group justify="center" mt="lg"><Button onClick={() => restart(state.seed)}>Restart same seed</Button><Button variant="default" onClick={() => restart(freshSeed())}>New seed</Button></Group>
          </Paper>
        </Stack>
        : <RoundScreen board={board} event={event} busy={busy} inputBlocked={busy || gameMenuOpen || runInfoOpen || helpOpen || restoreLivesOpen || faceDetails !== null || flameDetails !== null}
          selection={selection} setSelection={setSelection} submit={submit} skip={game.skip} />}
    </main>
    <DiceDock board={board} event={event} busy={busy} actionsEnabled={dockActionsEnabled} cinematic={showingChapterSplash}
      display={diceDisplay} selection={selection} setSelection={setSelection}
      selectedOffer={selectedOffer} setSelectedOffer={setSelectedOffer} selectedFlameOffer={selectedFlameOffer}
      submit={submit} openFaceDetails={setFaceDetails} openFlameDetails={openFlameDetails} />
    <RunActionRow setTarget={setActionRowTarget} />
    <RunInfoModal state={state} visibleEventId={event?.id} busy={busy} opened={runInfoOpen} onClose={() => setRunInfoOpen(false)}
      seedInput={seedInput} setSeedInput={setSeedInput} startSeed={() => restart(seedInput.trim())}
      restartSeed={() => restart(state.seed)} newSeed={() => restart(freshSeed())} />
    <HelpModal opened={helpOpen} onClose={() => setHelpOpen(false)} />
    <RestoreLivesModal board={board} opened={restoreLivesOpen && board.phase === 'shop'} busy={busy}
      onClose={() => setRestoreLivesOpen(false)} submit={submit} />
    <FaceDetailsModal board={board} target={faceDetails} diceDisplay={diceDisplay} selectedOffer={selectedOffer}
      setSelectedOffer={setSelectedOffer} busy={busy} actionsEnabled={!busy && !showingChapterSplash && !showingMap}
      onClose={() => setFaceDetails(null)} submit={submit} />
    <FlameDetailsModal board={board} target={flameDetails} busy={busy} actionsEnabled={!busy && !showingChapterSplash && !showingMap}
      onClose={closeFlameDetails} submit={submit} />
    {runMode === 'tutorial' && <TutorialDirector session={tutorialGame.session}
      uiState={tutorialUiState}
      paused={tutorialPaused}
      onAcknowledge={tutorialGame.acknowledge} onRecover={tutorialGame.completeBeat} onFinish={finishTutorial} />}
    {contextualFlameCue && <TutorialDirector session={tutorialGame.session} uiState={tutorialUiState}
      beatOverride={contextualFlameCue}
      paused={busy || showingChapterSplash || showingMap || gameMenuOpen || runInfoOpen || helpOpen || restoreLivesOpen
        || faceDetails !== null || flameDetails !== null}
      onAcknowledge={() => submit({ type: 'DISMISS_FLAME_TUTORIAL' })}
      onRecover={() => submit({ type: 'DISMISS_FLAME_TUTORIAL' })} onFinish={() => undefined} />}
  </Container></RunActionRowContext.Provider>;
}
