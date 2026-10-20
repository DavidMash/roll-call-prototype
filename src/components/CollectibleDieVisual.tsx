import { SPECIAL_DICE } from '../game/specialDice';
import type { DieType, Rank } from '../game/types';
import { PipFace } from './PipFace';
import { diePresentationStyle } from './DieTypeLabel';

export function CollectibleDieVisual({ type, face, slotLabel, compact = false, rolling = false }: {
  type: DieType;
  face: Exclude<Rank, 7>;
  slotLabel?: string;
  compact?: boolean;
  rolling?: boolean;
}) {
  const definition = SPECIAL_DICE[type];
  return <div className={`collectible-die-visual${compact ? ' compact' : ''}${type === 'normal' ? ' normal' : ' special'}${rolling ? ' rolling' : ''}`}
    style={diePresentationStyle(type)} data-die-type={type} aria-hidden="true">
    {slotLabel && <span className="collectible-die-slot-label">{slotLabel}</span>}
    <PipFace value={face} label={`${definition.name} showing ${face}`} />
  </div>;
}
