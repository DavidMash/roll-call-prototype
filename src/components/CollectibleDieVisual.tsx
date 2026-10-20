import type { CollectibleDie, DieEffectInstance, Rank } from '../game/types';
import { PipFace } from './PipFace';
import { diePresentationStyle } from './DieTypeLabel';

export function CollectibleDieVisual({ effects, face, slotLabel, compact = false, rolling = false }: {
  effects: readonly DieEffectInstance[];
  face: Exclude<Rank, 7>;
  slotLabel?: string;
  compact?: boolean;
  rolling?: boolean;
}) {
  const die = { effects } as Pick<CollectibleDie, 'effects'>;
  const names = effects.map(effect => effect.type).join(' + ') || 'Normal';
  return <div className={`collectible-die-visual${compact ? ' compact' : ''}${effects.length ? ' special' : ' normal'}${rolling ? ' rolling' : ''}`}
    style={diePresentationStyle(die)} data-effect-count={effects.length} aria-hidden="true">
    {slotLabel && <span className="collectible-die-slot-label">{slotLabel}</span>}
    <PipFace value={face} label={`${names} die showing ${face}`} />
  </div>;
}
