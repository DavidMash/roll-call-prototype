import { Badge, Button, Group, Text, Tooltip } from '@mantine/core';
import { combinationsForHand, handStats, HANDS, LOWER_HAND_IDS, UPPER_HAND_IDS } from '../game/hands';
import type { Selection } from '../game/selection';
import type { Board, HandId } from '../game/types';

function ScorecardSection({ title, hands, board, selection, busy, onSelect }: {
  title: string; hands: HandId[]; board: Board; selection: Selection; busy: boolean; onSelect: (hand: HandId) => void;
}) {
  return <section className="scorecard-section" aria-labelledby={`scorecard-${title.toLowerCase()}`}>
    <Text id={`scorecard-${title.toLowerCase()}`} className="scorecard-section-title" size="xs" fw={700} tt="uppercase">{title}</Text>
    <div className="scorecard-rows">
      {hands.map(hand => {
        const definition = HANDS[hand];
        const stats = handStats(hand, board.handLevels[hand]);
        const consumed = board.consumed.includes(hand);
        const compatible = combinationsForHand(board.dice, hand)
          .some(set => selection.dieIds.every(dieId => set.includes(dieId)));
        const playable = !consumed && compatible;
        const selected = selection.hand === hand;
        const score = board.scoreByHand[hand];
        const state = consumed ? 'consumed' : selected ? 'selected' : playable ? 'playable' : 'unavailable';
        const scoreLabel = score === undefined ? 'no score' : `${score} points`;
        return <Button key={hand} variant={selected ? 'light' : 'subtle'} color={selected ? 'teal' : 'gray'}
          className={`scorecard-row ${state}`} data-testid={`scorecard-row-${hand}`} data-state={state}
          disabled={busy || !playable} onClick={() => onSelect(hand)} aria-pressed={selected}
          aria-label={`${definition.name} · Lv. ${stats.level} ${stats.basePips} Pips · ×${stats.baseMultiplier} ${scoreLabel}${consumed ? ' used' : ''}`}>
          <span className="scorecard-row-copy">
            <span className="scorecard-hand-name">{definition.name} <span>· Lv. {stats.level}</span></span>
            <Tooltip label={`${stats.basePips} Base Pips · ×${stats.baseMultiplier} Base Mult`} position="right" withArrow>
              <span className="scorecard-base" data-testid={`scorecard-stats-${hand}`}>{stats.basePips} · ×{stats.baseMultiplier}</span>
            </Tooltip>
          </span>
          <span className="scorecard-row-result">
            <span data-testid={`scorecard-score-${hand}`}>{score ?? '—'}</span>
            {consumed && <Badge size="xs" color="gray" variant="light">used</Badge>}
          </span>
        </Button>;
      })}
    </div>
  </section>;
}

export function HandScorecard({ board, selection, busy, onSelect, onClear }: {
  board: Board; selection: Selection; busy: boolean; onSelect: (hand: HandId) => void; onClear: () => void;
}) {
  const hasCompatibleHand = [...UPPER_HAND_IDS, ...LOWER_HAND_IDS].some(hand => !board.consumed.includes(hand)
    && combinationsForHand(board.dice, hand).some(set => selection.dieIds.every(id => set.includes(id))));
  return <div className="scorecard">
    <Group justify="space-between" className="scorecard-header">
      <Text fw={700} size="sm" tt="uppercase" lts=".08em">Scorecard</Text>
      <Button size="compact-xs" variant="subtle" color="gray" onClick={onClear} disabled={busy || !selection.dieIds.length}>Clear selection</Button>
    </Group>
    <div className="scorecard-grid">
      <ScorecardSection title="Upper" hands={UPPER_HAND_IDS} {...{ board, selection, busy, onSelect }} />
      <ScorecardSection title="Lower" hands={LOWER_HAND_IDS} {...{ board, selection, busy, onSelect }} />
    </div>
    {selection.dieIds.length > 0 && !hasCompatibleHand && <Text size="xs" c="orange" className="scorecard-hint">No available hand contains all selected dice.</Text>}
    <div className="scorecard-totals" aria-label="Round score breakdown">
      <Group gap="xs"><Text size="xs" c="dimmed">Effects</Text><Text size="sm" fw={600} data-testid="scorecard-effect-score">{board.effectScore}</Text></Group>
      <Group gap="xs"><Text size="xs" c="dimmed">Total</Text><Text size="sm" fw={700} data-testid="scorecard-round-total">{board.score} / {board.target}</Text></Group>
    </div>
  </div>;
}
