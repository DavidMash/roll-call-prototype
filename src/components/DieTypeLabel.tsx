import type { CSSProperties } from 'react';
import { SPECIAL_DIE_PRESENTATION } from '../game/specialDiePresentation';
import { SPECIAL_DICE } from '../game/specialDice';
import type { DieType } from '../game/types';

export function diePresentationStyle(type: DieType): CSSProperties {
  const { accent, tint } = SPECIAL_DIE_PRESENTATION[type];
  return { '--die-accent': accent, '--die-tint': tint } as CSSProperties;
}

export function DieTypeIcon({ type, size = 15 }: { type: DieType; size?: number }) {
  const Icon = SPECIAL_DIE_PRESENTATION[type].icon;
  return Icon ? <Icon className="die-type-icon" size={size} stroke={1.9} aria-hidden="true" /> : null;
}

export function DieTypeLabel({ type, level, className = '', uppercase = false }: {
  type: DieType; level?: number; className?: string; uppercase?: boolean;
}) {
  if (type === 'normal') return null;
  return <span className={`die-type-label${className ? ` ${className}` : ''}`} style={diePresentationStyle(type)}>
    <DieTypeIcon type={type} />
    <span>{uppercase ? SPECIAL_DICE[type].name.toUpperCase() : SPECIAL_DICE[type].name}
      {level === undefined ? '' : uppercase ? ` · LV${level}` : ` · Lv${level}`}</span>
  </span>;
}
