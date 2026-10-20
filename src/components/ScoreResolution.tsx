import { Button, Group, Paper, Text } from '@mantine/core';
import { FLAMES } from '../game/flames';
import { HANDS } from '../game/hands';
import type { GameEvent } from '../game/types';
import { formatExactScore, formatPlayerNumber } from '../game/copy';
import type { ExactScore } from '../game/scoreMath';
import { scoreAnnouncement, scorePresentation, type ScoreMetric } from '../game/scorePresentation';
import type { ReactNode } from 'react';
import { DieTypeIcon, DieTypeLabel } from './DieTypeLabel';

function ScoreBox({ label, value, color, active, tutorial }: {
  label: 'INFERNO' | 'PIPS' | 'MULT' | 'XMULT';
  value: number | ExactScore;
  color: 'inferno' | 'pips' | 'mult' | 'xmult';
  active: ScoreMetric;
  tutorial: string;
}) {
  const formatted = typeof value === 'bigint' ? formatExactScore(value) : formatPlayerNumber(value);
  const lengthClass = formatted.length > 16 ? ' is-very-long' : formatted.length > 10 ? ' is-long' : '';
  return <div className={`score-box score-box-${color}${active === color ? ' is-changing' : ''}`}
    data-tutorial={tutorial} data-testid={`score-box-${color}`}>
    <Text component="span" className="score-box-label">{label}</Text>
    <Text component="strong" className={`score-box-value${lengthClass}`}
      data-testid={color === 'inferno' ? 'hand-inferno' : color === 'mult' ? 'hand-multiplier' : color === 'xmult' ? 'hand-xmult' : 'hand-pips'}>
      {formatted}
    </Text>
  </div>;
}

export function ScoreResolution({ event, busy, onSkip, idleText, scoreText }: {
  event: GameEvent | null;
  busy: boolean;
  onSkip: () => void;
  idleText?: string;
  scoreText?: string;
}) {
  const score = scorePresentation(event);
  const scoreDieType = event?.dieType ?? (event?.type === 'HITCHHIKER_ADDED_PIPS' ? 'hitchhiker' : null);
  let heading: ReactNode = idleText ?? '';
  if (event?.type === 'HAND_SCORE_FINALIZED' || event?.type === 'STANDALONE_SCORE_CALCULATED') heading = `+${typeof event.amount === 'bigint' ? formatExactScore(event.amount) : formatPlayerNumber(event.amount ?? 0)}`;
  else if (event?.type === 'JUMPING_BEAN_FREE_PLAY' && event.hand) heading = <><DieTypeIcon type="jumpingBean" /> JUMPING BEAN · FREE {HANDS[event.hand].name.toUpperCase()}</>;
  else if (event?.type === 'SCORE_ADDED') {
    const scoreAmount = typeof event.amount === 'bigint' ? event.amount : BigInt(event.amount ?? 0);
    heading = scoreAmount < 0n ? `−${formatExactScore(-scoreAmount)}` : `+${formatExactScore(scoreAmount)}`;
  }
  else if (event?.flame) heading = FLAMES[event.flame].name.toUpperCase();
  else if (event?.dieType) heading = <DieTypeLabel type={event.dieType} />;
  else if (event?.type === 'TRAINING_PURCHASED' && event.hand) heading = `${HANDS[event.hand].name} · Lv. ${formatPlayerNumber(event.board.handLevels[event.hand])}`;
  else if (event?.type === 'GOLD_ADDED') heading = `+${formatPlayerNumber(typeof event.amount === 'number' ? event.amount : 0)} Gold`;
  else if (event?.type === 'MANUAL_REROLL_STARTED') heading = 'Reroll';
  else if (event?.type === 'DEAD_BOARD') heading = 'Use a Reroll';
  else if (event?.type === 'DEAD_BOARD_RESCUED') heading = 'Dead board rescued';
  else if (event?.type === 'ROUND_CLEARED') heading = 'ROUND CLEARED';
  else if (event?.type === 'DICE_REROLL_STARTED' || event?.type === 'DIE_ROLLED') heading = 'Rolling dice';
  else if (event) heading = '';

  return <Paper className={`resolution ${busy ? 'active' : ''}${score ? ' is-score-resolution' : ''}`} p="xs">
    <Group justify={scoreText ? 'space-between' : 'flex-end'} className="resolution-meta is-round-score">
      {scoreText && <Text className="round-score-readout" data-testid="round-score-progress" data-tutorial="goal">{scoreText}</Text>}
      {busy && <Button size="compact-xs" variant="subtle" color="gray" onClick={onSkip}>Skip playback</Button>}
    </Group>
    {score ? <div className="score-resolution-stage" data-testid="hand-accumulator">
      <div className={`score-formula${score.showXMult ? ' has-xmult' : ''}${score.inferno > 1n ? ' has-inferno' : ''}`} aria-hidden="true">
        {score.inferno > 1n && <>
          <ScoreBox label="INFERNO" value={score.inferno} color="inferno" active={score.activeMetric} tutorial="score-inferno" />
          <span className="score-operator">×</span>
        </>}
        <ScoreBox label="PIPS" value={score.pips} color="pips" active={score.activeMetric} tutorial="score-pips" />
        <span className="score-operator">×</span>
        <ScoreBox label="MULT" value={score.mult} color="mult" active={score.activeMetric} tutorial="score-mult" />
        {score.showXMult && <>
          <span className="score-operator score-xmult-entry">×</span>
          <ScoreBox label="XMULT" value={score.xMult} color="xmult" active={score.activeMetric} tutorial="score-xmult" />
        </>}
      </div>
      {score.bossFactor !== 1 && <div className="score-boss-stage" data-testid="hand-boss-factor">
        <span>×</span><small>BOSS MODIFIER</small><strong>{formatPlayerNumber(score.bossFactor)}</strong>
      </div>}
      {score.callout && <Text key={event?.id} className="score-effect-callout score-tick" fw={800}>
        {scoreDieType && <DieTypeIcon type={scoreDieType} />} {score.callout}
      </Text>}
      {score.finalScore !== null && <div className={`score-final${score.activeMetric === 'final' ? ' is-awarded' : ''}`} data-testid="hand-final-score" aria-hidden="true">
        <span>FINAL SCORE</span><strong className={formatExactScore(score.finalScore).length > 16 ? 'is-very-long' : formatExactScore(score.finalScore).length > 10 ? 'is-long' : ''}>{formatExactScore(score.finalScore)}</strong>
      </div>}
      <span className="visually-hidden" role={score.finalScore !== null ? 'status' : undefined}
        aria-live={score.finalScore !== null ? 'polite' : 'off'} aria-atomic="true">{scoreAnnouncement(score)}</span>
    </div> : heading && <Text key={event?.id ?? 'ready'} className="score-tick" fw={700} aria-live="polite">{heading}</Text>}
  </Paper>;
}
