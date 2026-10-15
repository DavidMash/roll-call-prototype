import { Badge, Button, Stack, Text, Title } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { engulfmentAnimationProfile, engulfmentAssetKey, infernoEvaluationDuration, infernoRoman } from '../game/engulfment';
import { formatExactScore, formatPlayerNumber } from '../game/copy';
import { FLAMES } from '../game/flames';
import type { Action, Board } from '../game/types';

export const INFERNO_RESULT_REVEAL_PAUSE_MS = 180;

export function InfernoEvaluationScreen({ board, submit }: {
  board: Board;
  submit: (action: Action) => void;
}) {
  const evaluation = board.infernoEvaluation!;
  const [stage, setStage] = useState<'meter' | 'result'>('meter');
  const profile = useMemo(() => engulfmentAnimationProfile(evaluation.effectiveValue), [evaluation.effectiveValue]);
  const durationMs = infernoEvaluationDuration(evaluation.effectiveValue);

  useEffect(() => {
    setStage('meter');
    const timer = window.setTimeout(() => setStage('result'), durationMs + INFERNO_RESULT_REVEAL_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [durationMs, evaluation.evaluationIndex]);

  if (stage === 'meter') return <Stack gap="lg" align="center"
    className={`inferno-evaluation-screen inferno-ritual strength-${profile.strength}`}
    data-testid="inferno-evaluation" data-evaluation-result={evaluation.success ? 'success' : 'failure'}>
    <Title order={2}>THE INFERNO STIRS</Title>
    <div className="inferno-vessel" role="progressbar" aria-label="The Inferno evaluates your Flames">
      <div className={`inferno-fill ${profile.success ? 'is-success' : 'is-failure'}`}
        style={{ '--inferno-peak': `${profile.peakPercent}%`, '--inferno-duration': `${durationMs}ms` } as React.CSSProperties} />
    </div>
  </Stack>;

  if (!evaluation.success) return <Stack gap="md" align="center" justify="center"
    className="inferno-evaluation-screen inferno-failure" data-testid="inferno-feedback">
    <Title order={2}>THE INFERNO WAITS</Title>
    <Text fw={850} ta="center">{evaluation.feedbackMessage}</Text>
    <Button size="md" color="orange" onClick={() => submit({ type: 'CONTINUE_INFERNO_EVALUATION' })}>CONTINUE</Button>
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
    {evaluation.consumedFinalFlame && <Text c="orange">The Inferno craves more Flames.</Text>}
    <Button color="red" variant="white" onClick={() => submit({ type: 'CONTINUE_INFERNO_EVALUATION' })}>CONTINUE</Button>
  </Stack>;
}
