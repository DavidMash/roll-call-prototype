import type { CSSProperties } from 'react';
import { formatEffectLevel } from '../game/effectLevel';
import { dieVisualPresentation, effectColor } from '../game/specialDiePresentation';
import { SPECIAL_DICE } from '../game/specialDice';
import type { CollectibleDie, DieEffectInstance, SpecialDieType } from '../game/types';

export function diePresentationStyle(die: Pick<CollectibleDie, 'effects'>): CSSProperties {
  const { accent, tint, background } = dieVisualPresentation(die);
  return { '--die-accent': accent, '--die-tint': tint, '--die-background': background } as CSSProperties;
}

export function DieTypeIcon({ type, size = 15 }: { type: SpecialDieType; size?: number }) {
  const Icon = SPECIAL_DICE[type].icon;
  return <Icon className="die-type-icon" size={size} stroke={1.9} aria-hidden="true" />;
}

export function DieTypeLabel({ type, level, className = '', uppercase = false }: {
  type: SpecialDieType; level?: number; className?: string; uppercase?: boolean;
}) {
  const effect = { type, level: level ?? 1 } as DieEffectInstance;
  return <span className={`die-type-label${className ? ` ${className}` : ''}`}
    style={{ '--die-accent': effectColor(effect) } as CSSProperties}>
    <DieTypeIcon type={type} />
    <span>{uppercase ? SPECIAL_DICE[type].name.toUpperCase() : SPECIAL_DICE[type].name}
      {level === undefined || level === 1 ? '' : ` ${formatEffectLevel(level)}`}</span>
  </span>;
}

export function DieEffectsLabel({ effects, className = '', uppercase = false, compact = false }: {
  effects: readonly DieEffectInstance[]; className?: string; uppercase?: boolean; compact?: boolean;
}) {
  if (!effects.length) return null;
  const accessible = effects.map(effect => `${SPECIAL_DICE[effect.type].name}${effect.level > 1 ? ` ${formatEffectLevel(effect.level)}` : ''}`).join(' + ');
  if (compact && effects.length > 1) return <span className={`die-effects-label compact${className ? ` ${className}` : ''}`}
    aria-label={accessible} title={accessible}>
    {effects.map(effect => <span key={effect.id} className="compact-die-effect"
      style={{ '--die-accent': effectColor(effect) } as CSSProperties}>
      <DieTypeIcon type={effect.type} size={16} />
      {effect.level > 1 && <span className="compact-effect-level">{formatEffectLevel(effect.level)}</span>}
    </span>)}
  </span>;
  return <span className={`die-effects-label${className ? ` ${className}` : ''}`} aria-label={accessible}>
    {effects.map((effect, index) => <span key={effect.id} className="die-effect-label-part">
      {index > 0 && <span className="die-effect-separator" aria-hidden="true"> + </span>}
      <DieTypeLabel type={effect.type} level={effect.level} uppercase={uppercase} />
    </span>)}
  </span>;
}
