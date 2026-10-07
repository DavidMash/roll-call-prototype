import { Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useEffect } from 'react';
import { flameEffectText, FLAMES } from '../game/flames';
import { projectWildfire, rankedRecipients, rankedSacrifices, wildfirePreview } from '../game/hoodedFigure';
import type { Action, Board, Flame } from '../game/types';

function FlameChoice({ flame, lines, onClick, testId }: { flame: Flame; lines?: string[]; onClick: () => void; testId: string }) {
  return <Paper component="button" type="button" className="wildfire-choice" p="md" onClick={onClick} data-testid={testId}>
    <Title order={3}>{FLAMES[flame].name}</Title>
    {lines ? lines.slice(1).map(line => <Text key={line} size="sm">{line}</Text>)
      : <Text size="sm" c="dimmed">{flameEffectText(flame, 100, { gold: 0, lifetimeNormalShopGoldSpent: 0 })}</Text>}
  </Paper>;
}

export function HoodedFigureScreen({ board, busy, submit }: { board: Board; busy: boolean; submit: (action: Action) => void }) {
  const interaction = board.hoodedFigure.interaction;
  useEffect(() => {
    if (!interaction || interaction.stage !== 'story' || busy) return;
    const advance = (event: KeyboardEvent) => {
      if (!['Enter', ' ', 'ArrowRight'].includes(event.key) || event.repeat) return;
      event.preventDefault(); submit({ type: 'ADVANCE_HOODED_FIGURE' });
    };
    window.addEventListener('keydown', advance);
    return () => window.removeEventListener('keydown', advance);
  }, [busy, interaction, submit]);
  if (!interaction) return null;
  if (interaction.stage === 'story') return <div className="hooded-figure-event" role="dialog" aria-modal="true"
    aria-label="Hooded Figure encounter" onClick={() => !busy && submit({ type: 'ADVANCE_HOODED_FIGURE' })}>
    <Text className="hooded-story-line" key={interaction.lineIndex}>{interaction.lines[interaction.lineIndex]}</Text>
    <Text className="hooded-advance-hint">Click, tap, or press Enter to continue</Text>
  </div>;

  const recipients = rankedRecipients(board);
  const sacrifices = interaction.recipient ? rankedSacrifices(board, interaction.recipient) : [];
  return <div className="hooded-figure-event hooded-selection" role="dialog" aria-modal="true" aria-label="Create a Wildfire">
    <Stack gap="lg" className="hooded-selection-content">
      {interaction.stage === 'recipient' && <>
        <Title order={2}>Choose a Bonfire to upgrade.</Title>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>{recipients.map(flame => <FlameChoice key={flame} flame={flame}
          testId={`wildfire-recipient-${flame}`} onClick={() => submit({ type: 'SELECT_WILDFIRE_RECIPIENT', flame })} />)}</SimpleGrid>
      </>}
      {interaction.stage === 'sacrifice' && interaction.recipient && <>
        <Text className="hooded-quote">"A Wildfire needs fuel!"</Text>
        <Title order={2}>Select a Bonfire to sacrifice.</Title>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>{sacrifices.map(flame => {
          const projection = projectWildfire(board, interaction.recipient!, flame);
          return <FlameChoice key={flame} flame={flame} lines={wildfirePreview(projection)}
            testId={`wildfire-sacrifice-${flame}`} onClick={() => submit({ type: 'SELECT_WILDFIRE_SACRIFICE', flame })} />;
        })}</SimpleGrid>
      </>}
      {interaction.stage === 'confirm' && interaction.recipient && interaction.sacrifice && (() => {
        const projection = projectWildfire(board, interaction.recipient!, interaction.sacrifice!);
        return <Paper p="xl" className="wildfire-confirmation">
          <Stack gap="sm">
            <Title order={2}>{FLAMES[interaction.recipient!].name} becomes a Wildfire</Title>
            <Text>Current Bonfire: {flameEffectText(interaction.recipient!, 100, board)}</Text>
            {wildfirePreview(projection).slice(1).map(line => <Text fw={800} key={line}>{line}</Text>)}
            <Text c="red.3">Sacrifice: {FLAMES[interaction.sacrifice!].name}</Text>
            <Group justify="center" mt="md"><Button variant="default" onClick={() => submit({ type: 'BACK_WILDFIRE' })}>Back</Button>
              <Button color="orange" onClick={() => submit({ type: 'CONFIRM_WILDFIRE' })}>Create Wildfire</Button></Group>
          </Stack>
        </Paper>;
      })()}
      <Group justify="center">
        {interaction.stage === 'sacrifice' && <Button variant="default" onClick={() => submit({ type: 'BACK_WILDFIRE' })}>Back</Button>}
        <Button variant="subtle" color="gray" onClick={() => submit({ type: 'WALK_AWAY_WILDFIRE' })}>Walk away</Button>
      </Group>
    </Stack>
  </div>;
}
