import { Button, Group, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { useRef, useState } from 'react';
import { chapterPosition } from '../game/chapters';
import { formatPlayerNumber } from '../game/copy';
import type { GameState } from '../game/types';
import type { OnboardingMetadata, TutorialSession } from '../tutorial/types';

const lifeDisplay = (lives: number) => '♥'.repeat(Math.max(0, lives));

export function LandingScreen({ resumableRun, resumableTutorial, onboarding, onContinue, onTutorial, onNewRun }: {
  resumableRun: GameState | null;
  resumableTutorial: TutorialSession | null;
  onboarding: OnboardingMetadata;
  onContinue: () => void;
  onTutorial: () => void;
  onNewRun: () => void;
}) {
  const [confirmingNewRun, setConfirmingNewRun] = useState(false);
  const newRunButton = useRef<HTMLButtonElement>(null);
  const position = resumableRun ? chapterPosition(resumableRun.round) : null;
  const summary = resumableRun && position
    ? `C${position.chapterNumber} R${position.chapterRound} · ${formatPlayerNumber(resumableRun.gold)} Gold · ${lifeDisplay(resumableRun.lives)}` : '';
  const continueLabel = resumableRun && position
    ? `Continue Chapter ${position.chapterNumber} Round ${position.chapterRound}, ${formatPlayerNumber(resumableRun.gold)} Gold, ${formatPlayerNumber(resumableRun.lives)} ${resumableRun.lives === 1 ? 'life' : 'lives'}` : '';
  const tutorialProminent = !onboarding.tutorialCompleted && !onboarding.normalRunFinishedOnce;
  const tutorialLabel = resumableTutorial ? 'CONTINUE TUTORIAL' : onboarding.tutorialCompleted ? 'REPLAY TUTORIAL' : 'PLAY TUTORIAL';
  function requestNewRun() {
    if (resumableRun) setConfirmingNewRun(true);
    else onNewRun();
  }
  function confirmNewRun() {
    setConfirmingNewRun(false);
    onNewRun();
  }

  return <>
    <main className="landing-screen" aria-labelledby="landing-title">
      <Stack className="landing-content" gap="lg" align="stretch">
        <div className="landing-title-block">
          <Text className="landing-kicker" aria-hidden="true">A DICE-BUILDING RUN</Text>
          <Title id="landing-title" order={1}>ROLL CALL</Title>
        </div>
        {tutorialProminent && <Paper component="button" type="button" withBorder className="tutorial-card"
          aria-label={tutorialLabel} onClick={onTutorial}>
          <Text className="tutorial-card-title">{tutorialLabel}</Text>
          <Text className="tutorial-card-copy">Learn the basics in a guided run.</Text>
        </Paper>}
        {resumableRun && <Paper component="button" type="button" withBorder className="continue-card"
          aria-label={continueLabel} onClick={onContinue}>
          <Text className="continue-card-title">CONTINUE</Text>
          <Text className="continue-card-summary" aria-hidden="true">{summary}</Text>
        </Paper>}
        {!tutorialProminent && <Button ref={newRunButton} size="lg" variant={resumableRun ? 'default' : 'filled'}
          className="new-run-action" onClick={requestNewRun}>NEW RUN</Button>}
        <div className="landing-future-actions">
          {tutorialProminent ? <Button ref={newRunButton} variant="subtle" color="gray" size="sm"
            className="skip-tutorial-action" onClick={requestNewRun}>SKIP TUTORIAL</Button>
            : <Button variant="subtle" color="gray" size="sm" className="secondary-tutorial-action"
              onClick={onTutorial}>{tutorialLabel}</Button>}
        </div>
      </Stack>
    </main>
    <Modal opened={confirmingNewRun} onClose={() => setConfirmingNewRun(false)}
      title="Start a new run?" centered returnFocus transitionProps={{ duration: 0 }}>
      <Text>Your current run will be replaced.</Text>
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={() => setConfirmingNewRun(false)}>CANCEL</Button>
        <Button color="red" onClick={confirmNewRun}>START NEW RUN</Button>
      </Group>
    </Modal>
  </>;
}
