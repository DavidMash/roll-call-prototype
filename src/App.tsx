import { Alert, Button, Container, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
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
import { InfernoEvaluationScreen } from './components/InfernoEvaluationScreen';
import type { FlamePresentation } from './game/flamePresentation';
import { ScenarioBrowser } from './components/ScenarioBrowser';
import { ScenarioDetails } from './components/ScenarioDetails';
import { ScenarioCompleteScreen } from './components/ScenarioCompleteScreen';
import { SCENARIOS, scenarioById, type ScenarioDefinition } from './game/scenarios';
import { emptyScenarioProgress, loadScenarioProgress, recordScenarioCompletion } from './game/scenarioProgress';
import { newRun } from './game/engine';

const freshSeed = () => `roll-${Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('-')}`;
const query = new URLSearchParams(window.location.search);
const requestedSeed = query.get('seed')?.trim() || null;
const initialSeed = requestedSeed ?? freshSeed();
const initialSpeed = ['normal', 'fast', 'instant'].includes(query.get('speed') ?? '') ? query.get('speed') as PlaybackSpeed : 'normal';
const initialDebugTraceMode = query.get('debugTrace') === 'full' ? 'full' as const : 'bounded' as const;

export default function App() {
  const [runMode, setRunMode] = useState<'normal' | 'tutorial' | 'scenario' | null>(null);
  const [scenarioView, setScenarioView] = useState<'browser' | 'details' | 'playing'>('browser');
  const [selectedScenario, setSelectedScenario] = useState<ScenarioDefinition>(SCENARIOS[0]);
  const [scenarioProgress, setScenarioProgress] = useState(() => {
    try { return loadScenarioProgress(window.localStorage); } catch { return emptyScenarioProgress(); }
  });
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
  const [flamePresentation, setFlamePresentation] = useState<FlamePresentation[]>([]);
  const updateFlamePresentation = useCallback((next: FlamePresentation[]) => {
    setFlamePresentation(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
  }, []);
  const normalGame = useGame(requestedSeed, initialSeed, speed, runMode === 'normal', initialDebugTraceMode);
  const tutorialGame = useTutorialGame(speed, runMode === 'tutorial');
  const scenarioGame = useGame(null, `scenario-${initialSeed}`, speed,
    runMode === 'scenario' && scenarioView === 'playing', initialDebugTraceMode, undefined, 'scenario');
  const game = runMode === 'tutorial' ? tutorialGame : runMode === 'scenario' ? scenarioGame : normalGame;
  const [onboarding, setOnboarding] = useState<OnboardingMetadata>(() => {
    try { return loadOnboardingMetadata(window.localStorage); }
    catch { return defaultOnboardingMetadata(); }
  });
  const { board, state, busy, event, progress } = game;
  const resumableRun = normalGame.hasStoredRun && isResumableRun(normalGame.state) ? normalGame.state : null;
  const resumableTutorial = tutorialGame.hasStoredRun && isResumableTutorial(tutorialGame.session) ? tutorialGame.session : null;
  const theme = screenTheme(board);
  const diceBoard = board.bustPresentationDice ? { ...board, dice: board.bustPresentationDice } : board;
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
  const contextualFlameCue: TutorialBeat | null = runMode === 'normal' && board.phase === 'shop' && board.shop?.stage === 'flames'
    && board.flameTutorial.pendingFlameInstanceId !== null && !board.flameTutorial.completed ? {
      id: 'first-flame-ember', title: 'NEW EMBER',
      body: ['Stoke Flames in the Shop. At 100 Gold, they become Bonfires.'],
      target: `[data-testid="fire-keeping-flame-${board.flameTutorial.pendingFlameInstanceId}"]`,
      highlightTargets: [`[data-testid="fire-keeping-flame-${board.flameTutorial.pendingFlameInstanceId}"]`],
      interactiveTargets: [`[data-testid="fire-keeping-flame-${board.flameTutorial.pendingFlameInstanceId}"]`],
      blocking: false, gateInteractions: false, actionLabel: 'GOT IT',
      completion: { kind: 'acknowledge' },
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
  useEffect(() => {
    const scenario = scenarioGame.state.scenario;
    if (!scenario || (!scenario.completionPending && !scenario.completionAcknowledged)) return;
    try {
      setScenarioProgress(recordScenarioCompletion(window.localStorage, scenario.id, scenario.version,
        scenarioGame.runSession.ledger.runId));
    } catch { /* Scenario completion remains in the durable run even if local progress storage is unavailable. */ }
  }, [scenarioGame.state.scenario, scenarioGame.runSession.ledger.runId]);
  function submit(action: Action) {
    if (busy) return;
    if (!game.submit(action)) return;
    if (!['BUY_DIE', 'MOVE_DIE', 'SELL_DIE', 'STOKE_FLAME', 'RESTORE_LIFE', 'DISMISS_FLAME_TUTORIAL', 'UNLOCK_SHOP_EXIT'].includes(action.type)) setSelectedOffer(null);
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
    if (runMode === 'scenario') {
      const definition = scenarioById(state.scenario?.id) ?? selectedScenario;
      const resolution = newRun(seed, undefined, { debugTraceMode: initialDebugTraceMode, scenario: definition });
      if (scenarioGame.restartResolution(resolution)) {
        setSelectedScenario(definition); setScenarioView('playing'); setSeedInput(seed);
        setSelection(emptySelection()); setSelectedOffer(null); setSelectedFlameOffer(null);
      }
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
  function openScenarios() {
    try { setScenarioProgress(loadScenarioProgress(window.localStorage)); } catch { /* keep in-memory progress */ }
    setScenarioView('browser');
    setRunMode('scenario');
  }
  function startScenario(definition: ScenarioDefinition) {
    const seed = `scenario-${definition.id}-${freshSeed()}`;
    const resolution = newRun(seed, undefined, { debugTraceMode: initialDebugTraceMode, scenario: definition });
    if (!scenarioGame.restartResolution(resolution)) return;
    setSelectedScenario(definition); setSeedInput(seed); setScenarioView('playing');
    setSelection(emptySelection()); setSelectedOffer(null); setSelectedFlameOffer(null);
    setRunInfoOpen(false); setRestoreLivesOpen(false); setFaceDetails(null); setFlameDetails(null);
  }
  function continueScenarioCompletion(destination: 'run' | 'scenarios' | 'home') {
    submit({ type: 'CONTINUE_SCENARIO_RUN' });
    if (destination === 'scenarios') setScenarioView('browser');
    if (destination === 'home') setRunMode(null);
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
  if (runMode === 'scenario' && scenarioView === 'browser') return <Container size={1180} px={{ base: 8, sm: 'sm' }} py="md"
    className="scenario-page-container">
    <ScenarioBrowser progress={scenarioProgress} onOpen={scenario => { setSelectedScenario(scenario); setScenarioView('details'); }}
      activeScenario={scenarioGame.hasStoredRun && isResumableRun(scenarioGame.state) && scenarioGame.state.scenario
        ? { name: scenarioGame.state.scenario.name, round: scenarioGame.state.round } : null}
      onResume={() => { const definition = scenarioById(scenarioGame.state.scenario?.id); if (definition) setSelectedScenario(definition); setScenarioView('playing'); }}
      onBack={() => setRunMode(null)} />
  </Container>;
  if (runMode === 'scenario' && scenarioView === 'details') return <Container size={1050} px={{ base: 8, sm: 'sm' }} py="md"
    className="scenario-page-container">
    <ScenarioDetails scenario={selectedScenario} completed={scenarioProgress.completions[selectedScenario.id]?.completed === true}
      onBack={() => setScenarioView('browser')} onStart={() => startScenario(selectedScenario)} />
  </Container>;
  function openFlameDetails(target: FlameDetailsTarget) {
    if (target.kind === 'ember' && target.flameInstanceId === state.flameTutorial.pendingFlameInstanceId && !state.flameTutorial.completed) {
      submit({ type: 'DISMISS_FLAME_TUTORIAL' });
    } else if (runMode === 'tutorial' && target.kind === 'ember'
      && target.flameInstanceId === tutorialGame.session.scenario.firstFlameInstanceId
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
        : closing.flameInstanceId !== undefined
          ? `[data-testid="fire-keeping-flame-${closing.flameInstanceId}"]`
          : null;
      if (selector) document.querySelector<HTMLElement>(selector)?.focus();
    }, 0);
  }
  if (atLanding) return <Container size={1180} px={{ base: 6, sm: 'sm' }} py={8} className="landing-container">
    <LandingScreen resumableRun={resumableRun} resumableTutorial={resumableTutorial} onboarding={onboarding}
      onContinue={() => setRunMode('normal')} onTutorial={startTutorialFromLanding} onNewRun={startNewRunFromLanding}
      onScenarios={openScenarios} />
  </Container>;
  return <RunActionRowContext.Provider value={actionRowTarget}><Container size={1180} px={{ base: 6, sm: 'sm' }} py={8}
    className={`app-container screen-theme ${board.phase === 'round' ? 'active-gameplay' : ''}`}
    data-screen-theme={theme.id} data-playback-speed={speed}
    style={{ '--screen-primary': theme.accent, '--screen-secondary': theme.accentStrong } as React.CSSProperties}>
    {!showingChapterSplash && <TopHud board={board} event={event} flamePresentation={board.phase === 'round' ? flamePresentation : []} speed={speed} setSpeed={setSpeed} diceDisplay={diceDisplay} setDiceDisplay={setDiceDisplay}
      openRunInfo={() => setRunInfoOpen(true)} openHelp={() => setHelpOpen(true)}
      openRestoreLives={() => setRestoreLivesOpen(true)} openFlameDetails={openFlameDetails} onMenuOpenChange={setGameMenuOpen}
      returnToTitle={returnToTitle} />}
    {game.error && <Alert color="orange" withCloseButton onClose={game.clearError} my="xs" py={5} title="Action unavailable">{game.error}</Alert>}
    {game.persistenceStatus.kind === 'unsaved' && <Alert color="red" my="xs" py={5} title="Run is not saved">
      <Group justify="space-between" align="center" wrap="wrap" gap="xs">
        <Text size="sm">{game.persistenceStatus.message}{game.persistenceStatus.partialHistory
          ? ' Oldest diagnostic history was discarded after the unsaved queue exceeded 16 MiB; exports are partial.' : ' Gameplay can continue while saving retries automatically.'}</Text>
        <Button size="compact-xs" color="red" variant="light" onClick={game.retryPersistence}>RETRY</Button>
      </Group>
    </Alert>}
    {game.persistenceStatus.kind === 'saved' && !state.historyV2Coverage.complete
      && <Alert color="orange" my="xs" py={5} title="Run history is partial">
        <Text size="sm">Saving has recovered, but the oldest diagnostic history was discarded while storage was unavailable. Gameplay remains saved and exports identify the missing interval.</Text>
      </Alert>}
    <main className="main-content">
      {busy && !showingMap && event?.type !== 'ROUND_BUST' && event?.type !== 'CHAPTER_STARTED'
        && <span className="visually-hidden">EVENT {progress.current} / {progress.total}</span>}
      {event?.type === 'CHAPTER_STARTED' ? <ChapterSplash key={event.id} event={event} onComplete={game.continuePlayback} />
        : showingMap ? <RunMapTransition key={event!.id} seed={state.seed} event={event!} onContinue={game.continuePlayback} />
        : board.phase === 'roundSummary' && board.roundSummary ? <RoundSummaryScreen board={board} busy={busy} submit={submit} />
        : board.phase === 'inferno' && board.infernoEvaluation ? <InfernoEvaluationScreen board={board} submit={submit} />
        : board.phase === 'scenarioComplete' && board.scenario ? <ScenarioCompleteScreen board={board}
          onContinue={() => continueScenarioCompletion('run')} onScenarios={() => continueScenarioCompletion('scenarios')}
          onHome={() => continueScenarioCompletion('home')} />
        : board.phase === 'flameSelection' && board.flameSelection ? <FlameSelectionScreen board={board} event={event} busy={busy}
        selectedOffer={selectedFlameOffer} setSelectedOffer={setSelectedFlameOffer} submit={submit} skip={game.skip} openFlameDetails={openFlameDetails} />
        : board.phase === 'specialOffer' && board.specialOffer ? <SpecialOfferScreen board={board} busy={busy} submit={submit} />
        : board.phase === 'shop' && board.shop ? <ShopScreen board={board} inventory={state.diceInventory} event={event} busy={busy}
        submit={submit} skip={game.skip} openFlameDetails={openFlameDetails}
        tutorialProgressNudgeEligible={tutorialProgressNudgeEligible} />
      : (board.phase === 'bust' || (board.phase === 'lost' && board.bust)) ? <BustScreen board={board}
          onContinue={event?.type === 'ROUND_BUST' && (board.bust?.livesAfter ?? 0) > 0 ? game.continuePlayback : undefined}
          restartSame={() => restart(runMode === 'scenario' ? `scenario-${state.scenario?.id}-${freshSeed()}` : state.seed)}
          newRun={() => restart(freshSeed())} scenarioFailure={runMode === 'scenario'}
          backToScenarios={runMode === 'scenario' ? () => setScenarioView('browser') : undefined} />
        : board.phase === 'lost' || board.phase === 'error' ? <Stack gap="sm">
          <Paper p="xl" ta="center" className="end-state">
            <Title order={2}>{board.phase === 'lost' ? 'Run Over' : 'Resolution stopped'}</Title>
            <Text mt="sm">{board.phase === 'lost' && board.bust ? `Bust on ${chapterLabel(board.bust.round)}: ${formatScoreProgress(board.bust.score, board.bust.target)}. No lives remain.` : state.stats.resolutionError}</Text>
            <Text size="sm" c="dimmed" mt="sm">Run details and event history are available in Run Info.</Text>
            {runMode === 'scenario' ? <Group justify="center" mt="lg"><Button onClick={() => restart(`scenario-${state.scenario?.id}-${freshSeed()}`)}>TRY AGAIN</Button>
              <Button variant="default" onClick={() => setScenarioView('browser')}>BACK TO SCENARIOS</Button></Group>
              : <Group justify="center" mt="lg"><Button onClick={() => restart(state.seed)}>Restart same seed</Button><Button variant="default" onClick={() => restart(freshSeed())}>New seed</Button></Group>}
          </Paper>
        </Stack>
        : <RoundScreen board={board} event={event} busy={busy} inputBlocked={busy || gameMenuOpen || runInfoOpen || helpOpen || restoreLivesOpen || faceDetails !== null || flameDetails !== null}
          selection={selection} setSelection={setSelection} submit={submit} skip={game.skip}
          onFlamePresentationChange={updateFlamePresentation} />}
    </main>
    {(board.phase === 'round' || board.phase === 'flameSelection') && <DiceDock board={diceBoard} event={event} busy={busy} actionsEnabled={dockActionsEnabled} cinematic={showingChapterSplash}
      display={diceDisplay} selection={selection} setSelection={setSelection}
      selectedFlameOffer={selectedFlameOffer}
      submit={submit} openFaceDetails={setFaceDetails} openFlameDetails={openFlameDetails} />}
    {board.phase !== 'inferno' && <RunActionRow setTarget={setActionRowTarget} />}
    {runInfoOpen && <RunInfoModal state={state} repository={game.repository} runId={game.runSession.ledger.runId}
      busy={busy} opened onClose={() => setRunInfoOpen(false)}
      seedInput={seedInput} setSeedInput={setSeedInput} startSeed={() => restart(seedInput.trim())}
      restartSeed={() => restart(state.seed)} newSeed={() => restart(freshSeed())} />}
    <HelpModal opened={helpOpen} onClose={() => setHelpOpen(false)} />
    <RestoreLivesModal board={board} opened={restoreLivesOpen && board.phase === 'shop'} busy={busy}
      onClose={() => setRestoreLivesOpen(false)} submit={submit} />
    <FaceDetailsModal board={board} target={faceDetails} diceDisplay={diceDisplay}
      busy={busy} actionsEnabled={!busy && !showingChapterSplash && !showingMap}
      onClose={() => setFaceDetails(null)} submit={submit} />
    <FlameDetailsModal board={board} inventory={state.diceInventory} target={flameDetails} busy={busy} actionsEnabled={!busy && !showingChapterSplash && !showingMap}
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
