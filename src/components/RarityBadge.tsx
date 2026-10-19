import { Badge } from '@mantine/core';
import { diceRarityClassName, diceRarityLabel } from '../game/rarity';
import type { DiceRarity } from '../game/types';

export function RarityBadge({ rarity, compact = false }: { rarity: DiceRarity; compact?: boolean }) {
  return <Badge component="span" className={`rarity-badge ${diceRarityClassName(rarity)}`} size={compact ? 'xs' : 'sm'} variant="light">
    {diceRarityLabel(rarity)}
  </Badge>;
}
