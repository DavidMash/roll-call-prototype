import { Badge, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { engulfmentAnimationProfile, engulfmentAssetKey, infernoEvaluationDuration, infernoMeterTransition, infernoRoman } from '../game/engulfment';
import { formatExactScore, formatPlayerNumber } from '../game/copy';
import { FLAMES } from '../game/flames';
import type { Action, Board, EngulfmentAssetRef } from '../game/types';

export const INFERNO_RESULT_REVEAL_PAUSE_MS = 180;

function offeredFlameStatus(board: Board, asset: EngulfmentAssetRef): string {
  if (asset.kind === 'bonfire') return 'BONFIRE';
  const diagnostic = board.infernoEvaluation?.flames.find(item => engulfmentAssetKey(item.asset) === engulfmentAssetKey(asset));
  return `EMBER · SLOT ${asset.slot + 1} · ${formatPlayerNumber(diagnostic?.investment ?? 0)} / 100 GOLD`;
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
    <Title order={2}>THE INFERNO WAITS</Title>
    <Text fw={850} ta="center">{evaluation.feedbackMessage}</Text>
    <Button size="md" color="orange" onClick={() => submit({ type: 'CONTINUE_INFERNO_EVALUATION' })}>CONTINUE</Button>
  </Stack>;

  if (!evaluation.engulfed) return <Stack gap="lg" align="center" justify="center"
    className="inferno-evaluation-screen inferno-ready" data-testid="inferno-ready">
    <div>
      <Text fw={950} tt="uppercase" lts=".18em" c="orange">ENGULFMENT AVAILABLE</Text>
      <Title order={1}>INFERNO {infernoRoman(evaluation.infernoLevelAfter)} IS READY</Title>
    </div>
    <Text className="inferno-ready-transition">
      Inferno ×{formatExactScore(evaluation.infernoMultiplierBefore)} → ×{formatExactScore(evaluation.infernoMultiplierAfter)}
    </Text>
    <Paper className="inferno-ready-consequences" p="md" withBorder>
      <Text size="xs" fw={900} tt="uppercase" c="red">Flames that will be snuffed</Text>
      <div className="offered-flames" aria-label="Offered Flames">{evaluation.flamesSnuffed.map(asset => <div
        className="offered-flame" key={engulfmentAssetKey(asset)} data-testid={`offered-flame-${asset.instanceId}`}>
        <Text fw={900}>{FLAMES[asset.flame].name}</Text>
        <Text size="xs" c="dimmed">{offeredFlameStatus(board, asset)}</Text>
      </div>)}</div>
      <Stack gap={3} mt="md">
        <Text fw={800}>Upper hand levels unify → Lv.{formatPlayerNumber(evaluation.upper.unifiedLevel)}</Text>
        <Text fw={800}>Lower hand levels unify → Lv.{formatPlayerNumber(evaluation.lower.unifiedLevel)}</Text>
        <Text size="sm" c="orange" fw={900} mt={5}>Successful Engulfment: +25 Temper</Text>
        <Text size="xs" c="red.3" fw={800} mt={5}>Engulfment cannot be undone.</Text>
      </Stack>
    </Paper>
    <Group className="inferno-ready-actions" justify="center">
      <Button size="md" color="red" onClick={() => submit({ type: 'ENGULF_NOW' })}>ENGULF NOW</Button>
      <Button size="md" variant="default" onClick={() => submit({ type: 'NOT_YET' })}>NOT YET</Button>
    </Group>
  </Stack>;

  return <Stack gap="md" align="center" justify="center"
    className="inferno-evaluation-screen engulfment-result-success" data-testid="engulfment-success">
    <Text fw={950} tt="uppercase" lts=".18em">ENGULFMENT</Text>
    <Title order={1}>INFERNO {infernoRoman(evaluation.infernoLevelAfter)}</Title>
    <Text className="engulfment-new-multiplier">×{formatExactScore(evaluation.infernoMultiplierAfter)}</Text>
    <div className="snuffed-flames" aria-label="Snuffed Flames">{evaluation.flamesSnuffed.map(asset => <Badge
      className="snuffed-flame" key={engulfmentAssetKey(asset)} color="dark" variant="filled">
      {FLAMES[asset.flame].name} · SNUFFED
    </Badge>)}</div>
    <Text>Upper hands unified → Lv.{formatPlayerNumber(evaluation.upper.unifiedLevel)}</Text>
    <Text>Lower hands unified → Lv.{formatPlayerNumber(evaluation.lower.unifiedLevel)}</Text>
    <Text c="orange" fw={900}>+25 TEMPER</Text>
    {evaluation.consumedFinalFlame && <Text c="orange">The Inferno craves more Flames.</Text>}
    <Button color="red" variant="white" onClick={() => submit({ type: 'CONTINUE_INFERNO_EVALUATION' })}>CONTINUE</Button>
  </Stack>;
}
