import { Badge } from '@mantine/core';
import { rarityClassName, rarityLabel } from '../game/rarity';
import type { Rarity } from '../game/types';

export function RarityBadge({ rarity, compact = false }: { rarity: Rarity; compact?: boolean }) {
  return <Badge component="span" className={`rarity-badge ${rarityClassName(rarity)}`} size={compact ? 'xs' : 'sm'} variant="light">
    {rarityLabel(rarity)}
  </Badge>;
}
