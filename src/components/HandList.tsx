import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { combinationsForHand, defaultCombination, handMultiplier, handOptions, HANDS } from '../game/hands';
import { handScore } from '../game/scoring';
import type { Selection } from '../game/selection';
import type { Board, HandId } from '../game/types';

export function HandList({ board, selection, busy, onSelect, onClear }: {
  board: Board; selection: Selection; busy: boolean; onSelect: (hand: HandId) => void; onClear: () => void;
}) {
  const options = handOptions(board.dice, board.consumed, selection.dieIds);
  return <Stack gap="sm">
    <Group justify="space-between">
      <Text fw={600}>Available hands</Text>
      <Button size="compact-xs" variant="subtle" color="gray" onClick={onClear} disabled={busy || !selection.dieIds.length}>Clear selection</Button>
    </Group>
    <div className="hand-list">
      {options.map(option => {
        const score = handScore(board.dice, option.id, defaultCombination(board.dice, option.id, selection.dieIds)!).score;
        return <Button key={option.id} variant={selection.hand === option.id ? 'filled' : 'default'}
          disabled={busy || option.consumed} className={`hand-button ${option.consumed ? 'consumed' : ''}`}
          onClick={() => onSelect(option.id)} aria-pressed={selection.hand === option.id}>
          <span>{HANDS[option.id].name}</span>
          <Badge variant="light" color={option.consumed ? 'gray' : 'teal'} size="sm">
            {option.consumed ? 'used' : `${score} · ×${handMultiplier(option.id)}`}
          </Badge>
        </Button>;
      })}
    </div>
    {!options.length && <Text size="sm" c="dimmed">No hand contains all selected dice. Deselect a die or clear the selection.</Text>}
    {selection.hand && combinationsForHand(board.dice, selection.hand).length > 1 && <Text size="xs" c="dimmed">{HANDS[selection.hand].rank
      ? 'Upper hands may use any non-empty matching subset. Deselect dice to preserve them for another hand.'
      : 'Other physical-die combinations are available. Deselect a die, then choose its replacement.'}</Text>}
  </Stack>;
}
