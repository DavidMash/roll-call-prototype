import { SPECIAL_DICE } from '../game/specialDice';
import type { DieType, Rank } from '../game/types';
import { PipFace } from './PipFace';

export function CollectibleDieVisual({ type, face, slotLabel, compact = false, rolling = false }: {
  type: DieType;
  face: Exclude<Rank, 7>;
  slotLabel?: string;
  compact?: boolean;
  rolling?: boolean;
}) {
  const definition = SPECIAL_DICE[type];
  const rarity = definition.rarity;
  return <div className={`collectible-die-visual${compact ? ' compact' : ''}${type === 'normal' ? ' normal' : ' special'}${rarity ? ` rarity-${rarity}` : ''}${rolling ? ' rolling' : ''}`}
    aria-hidden="true">
    {slotLabel && <span className="collectible-die-slot-label">{slotLabel}</span>}
    <PipFace value={face} label={`${definition.name} showing ${face}`} />
    {type !== 'normal' && <span className="collectible-die-mark">◆</span>}
  </div>;
}
