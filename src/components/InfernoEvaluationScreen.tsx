import { Badge, Button, Group, Paper, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { engulfmentAnimationProfile, engulfmentAssetKey, infernoEvaluationDuration, infernoMeterTransition, infernoRoman } from '../game/engulfment';
import { formatExactScore, formatPlayerNumber } from '../game/copy';
import { FLAMES } from '../game/flames';
import type { Action, Board, EngulfmentAssetRef } from '../game/types';
import { CurrencyAmount } from './CurrencyAmount';
import { RichDescription } from './RichDescription';
import { term, text } from '../game/richText';

export const INFERNO_RESULT_REVEAL_PAUSE_MS = 180;

function offeredFlameStatus(board: Board, asset: EngulfmentAssetRef): string {
  if (asset.kind === 'bonfire') return 'BONFIRE';
  const diagnostic = board.infernoEvaluation?.flames.find(item => engulfmentAssetKey(item.asset) === engulfmentAssetKey(asset));
  return `EMBER · SLOT ${asset.slot + 1} · ${formatPlayerNumber(diagnostic?.investment ?? 0)}G / 100G`;
}

export function InfernoEvaluationScreen({ board, submit }: {
  board: Board;
  submit: (action: Action) => void;
}) {
  const evaluation = board.infernoEvaluation!;
  const [stage, setStage] = useState<'meter' | 'result'>(() => evaluation.engulfed ? 'result' : 'meter');
  const profile = useMemo(() => engulfmentAnimationProfile(evaluation.effectiveValue), [evaluation.effectiveValue]);
  const durationMs = infernoEvaluationDuration(evaluation.effectiveValue);
  const meter = infernoMeterTransition(evaluation);

  useEffect(() => {
    if (evaluation.engulfed) { setStage('result'); return; }
    setStage('meter');
    const timer = window.setTimeout(() => setStage('result'), durationMs + INFERNO_RESULT_REVEAL_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [durationMs, evaluation.engulfed, evaluation.evaluationIndex]);

  if (stage === 'meter') return <Stack gap="lg" align="center"
    className={`inferno-evaluation-screen inferno-ritual strength-${profile.strength}`}
    data-testid="inferno-evaluation" data-evaluation-result={evaluation.success ? 'success' : 'failure'}>
    <Title order={2}>THE INFERNO STIRS</Title>
    <div className="inferno-vessel" role="progressbar" aria-label="The Inferno evaluates your Flames"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meter.endPercent)}>
      <div className={`inferno-fill ${profile.success ? 'is-success' : 'is-failure'}`}
        data-testid="inferno-meter-fill" data-start-percent={meter.startPercent} data-end-percent={meter.endPercent}
        style={{ '--inferno-start': `${meter.startPercent}%`, '--inferno-end': `${meter.endPercent}%`, '--inferno-duration': `${durationMs}ms` } as React.CSSProperties} />
    </div>
  </Stack>;

  if (!evaluation.success) return <Stack gap="md" align="center" justify="center"
    className="inferno-evaluation-screen inferno-failure" data-testid="inferno-feedback">
    <Title order={2}>THE INFERNO IS WATCHING</Title>
    <RichDescription size="md" className="inferno-explanation" copy={[
      text('It measures how much power you get from your Flames. Reach at least ×'),
      text(formatPlayerNumber(evaluation.threshold)),
      text(' total Flame power and you will be offered '),
      term('engulfment'),
      text('.'),
    ]} />
    <Stack gap={4} align="center">{(evaluation.feedbackMessages?.length ? evaluation.feedbackMessages
      : evaluation.feedbackMessage ? [evaluation.feedbackMessage] : []).map(message =>
      <Text key={message} fw={850} ta="center">{message}</Text>)}</Stack>
    <Button size="md" color="orange" onClick={() => submit({ type: 'CONTINUE_INFERNO_EVALUATION' })}>CONTINUE</Button>
  </Stack>;

  if (!evaluation.engulfed) return <Stack gap="lg" align="center" justify="center"
    className="inferno-evaluation-screen inferno-ready" data-testid="inferno-ready">
    <div>
      <Text fw={950} tt="uppercase" lts=".18em" c="orange">ENGULFMENT AVAILABLE</Text>
      <Title order={1}>CHOOSE YOUR OFFERING</Title>
    </div>
    <Paper className="inferno-ready-consequences" p="md" withBorder>
      <Text size="xs" fw={900} tt="uppercase" c="red">Select Flames to snuff</Text>
      <Text size="xs" c="dimmed" mb="sm">Individual power is diagnostic. Selected power is recalculated jointly and is not the sum of these values.</Text>
      <div className="offered-flames" aria-label="Selectable Flames">{evaluation.flames.map(item => {
        const asset = item.asset;
        const selected = evaluation.selectedFlameInstanceIds.includes(asset.instanceId);
        return <UnstyledButton className={`offered-flame ${selected ? 'is-selected' : ''}`}
          key={engulfmentAssetKey(asset)} data-testid={`offered-flame-${asset.instanceId}`}
          aria-pressed={selected} onClick={() => submit({ type: 'TOGGLE_ENGULFMENT_FLAME', flameInstanceId: asset.instanceId })}>
          <Text fw={900}>{selected ? '✓ ' : ''}{FLAMES[asset.flame].name}</Text>
          <Text size="xs" c="dimmed">{offeredFlameStatus(board, asset)}</Text>
          <Text size="xs" fw={850} c="orange">Individual power ×{formatPlayerNumber(item.hiddenStrength)}</Text>
        </UnstyledButton>;
      })}</div>
      <Stack gap={3} mt="md">
        <Text fw={950} data-testid="selected-effective-power">Selected joint power: ×{formatPlayerNumber(evaluation.selectedEffectiveValue)} / ×{formatPlayerNumber(evaluation.threshold)}</Text>
        <Text className="inferno-reward-preview">
          Earned Inferno factor ×{formatPlayerNumber(evaluation.earnedInfernoFactor)} · Cumulative ×{formatExactScore(evaluation.infernoMultiplierBefore)} → ×{formatExactScore(evaluation.infernoMultiplierAfter)}
        </Text>
        <Text fw={800}>Upper hand levels unify → Lv.{formatPlayerNumber(evaluation.upper.unifiedLevel)}</Text>
        <Text fw={800}>Lower hand levels unify → Lv.{formatPlayerNumber(evaluation.lower.unifiedLevel)}</Text>
        <Text size="sm" c="orange" fw={900} mt={5}>Successful Engulfment: <CurrencyAmount currency="temper" value={25} sign="+" /></Text>
        <Text size="xs" c="red.3" fw={800} mt={5}>Engulfment cannot be undone.</Text>
      </Stack>
    </Paper>
    <Group className="inferno-ready-actions" justify="center">
      <Button size="md" color="red" disabled={evaluation.selectedEffectiveValue < evaluation.threshold}
        onClick={() => submit({ type: 'ENGULF_NOW' })}>ENGULF SELECTED FLAMES</Button>
      <Button size="md" variant="default" onClick={() => submit({ type: 'NOT_YET' })}>NOT YET</Button>
    </Group>
  </Stack>;

  return <Stack gap="md" align="center" justify="center"
    className="inferno-evaluation-screen engulfment-result-success" data-testid="engulfment-success">
    <Text fw={950} tt="uppercase" lts=".18em">ENGULFMENT</Text>
    <Title order={1}>INFERNO {infernoRoman(evaluation.infernoLevelAfter)}</Title>
    <Text fw={850}>Selected power ×{formatPlayerNumber(evaluation.selectedEffectiveValue)} became ×{formatPlayerNumber(evaluation.earnedInfernoFactor)} Inferno</Text>
    <Text className="engulfment-new-multiplier">×{formatExactScore(evaluation.infernoMultiplierAfter)}</Text>
    <div className="snuffed-flames" aria-label="Snuffed Flames">{evaluation.flamesSnuffed.map(asset => <Badge
      className="snuffed-flame" key={engulfmentAssetKey(asset)} color="dark" variant="filled">
      {FLAMES[asset.flame].name} · SNUFFED
    </Badge>)}</div>
    <Text>Upper hands unified → Lv.{formatPlayerNumber(evaluation.upper.unifiedLevel)}</Text>
    <Text>Lower hands unified → Lv.{formatPlayerNumber(evaluation.lower.unifiedLevel)}</Text>
    <Text c="orange" fw={900}><CurrencyAmount currency="temper" value={25} sign="+" /></Text>
    <Paper withBorder p="sm" maw={620}><Stack gap={4}>{(evaluation.feedbackMessages ?? []).map(message =>
      <Text key={message} size="sm" ta="center">{message}</Text>)}</Stack></Paper>
    <Button color="red" variant="white" onClick={() => submit({ type: 'CONTINUE_INFERNO_EVALUATION' })}>CONTINUE</Button>
  </Stack>;
}
