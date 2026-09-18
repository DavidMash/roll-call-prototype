import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { combinationsForHand, HANDS, LOWER_HAND_IDS, UPPER_HAND_IDS } from '../game/hands';
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
        const consumed = board.consumed.includes(hand);
        const compatible = combinationsForHand(board.dice, hand)
          .some(set => selection.dieIds.every(dieId => set.includes(dieId)));
        const playable = !consumed && compatible;
        const selected = selection.hand === hand;
        const score = board.scoreByHand[hand];
        const state = consumed ? 'consumed' : selected ? 'selected' : playable ? 'playable' : 'unavailable';
        return <Button key={hand} variant={selected ? 'light' : 'subtle'} color={selected ? 'teal' : 'gray'}
          className={`scorecard-row ${state}`} data-testid={`scorecard-row-${hand}`} data-state={state}
          disabled={busy || !playable} onClick={() => onSelect(hand)} aria-pressed={selected}>
          <span className="scorecard-row-copy">
            <span className="scorecard-hand-name">{definition.name}</span>
            <span className="scorecard-base">{definition.basePips} Pips · ×{definition.baseMultiplier}</span>
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
  return <Stack gap="sm">
    <Group justify="space-between">
      <div><Text fw={600}>Scorecard</Text><Text size="xs" c="dimmed">Select a playable row, then press Play.</Text></div>
      <Button size="compact-xs" variant="subtle" color="gray" onClick={onClear} disabled={busy || !selection.dieIds.length}>Clear selection</Button>
    </Group>
    <div className="scorecard-grid">
      <ScorecardSection title="Upper" hands={UPPER_HAND_IDS} {...{ board, selection, busy, onSelect }} />
      <ScorecardSection title="Lower" hands={LOWER_HAND_IDS} {...{ board, selection, busy, onSelect }} />
    </div>
    {selection.dieIds.length > 0 && !hasCompatibleHand && <Text size="sm" c="dimmed">No available hand contains all selected dice. Deselect a die or clear the selection.</Text>}
    {selection.hand && combinationsForHand(board.dice, selection.hand).length > 1 && <Text size="xs" c="dimmed">{HANDS[selection.hand].rank
      ? 'Upper hands may use any non-empty matching subset. Deselect dice to preserve them for another hand.'
      : 'Other physical-die combinations are available. Deselect a die, then choose its replacement.'}</Text>}
    <div className="scorecard-totals" aria-label="Round score breakdown">
      <Group justify="space-between"><Text size="sm" c="dimmed">Effect Score</Text><Text fw={600} data-testid="scorecard-effect-score">{board.effectScore}</Text></Group>
      <Group justify="space-between"><Text fw={700}>Round Total</Text><Text fw={700} data-testid="scorecard-round-total">{board.score} / {board.target}</Text></Group>
    </div>
  </Stack>;
}
