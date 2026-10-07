import type { Enhancement } from '../game/types';
import { ENHANCEMENTS } from '../game/enhancements';
import { formatPlayerNumber } from '../game/copy';

export function enhancementAccessibleName(enhancement: Enhancement, stacks?: number) {
  const name = ENHANCEMENTS[enhancement].name;
  return stacks === undefined ? name : `${name}, ${formatPlayerNumber(stacks)} ${stacks === 1 ? 'stack' : 'stacks'}`;
}

export function EnhancementSymbol({ enhancement, stacks, decorative = false, className = '' }: {
  enhancement: Enhancement;
  stacks?: number;
  decorative?: boolean;
  className?: string;
}) {
  const definition = ENHANCEMENTS[enhancement];
  const label = enhancementAccessibleName(enhancement, stacks);
  return <span className={`enhancement-icon enhancement-${enhancement}${className ? ` ${className}` : ''}`}
    aria-hidden={decorative || undefined} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label}
    title={`${definition.name}${stacks !== undefined && stacks > 1 ? ` ×${formatPlayerNumber(stacks)}` : ''}`}>
    <span aria-hidden="true">{definition.symbol}</span>
    {stacks !== undefined && stacks > 1 && <strong aria-hidden="true">×{formatPlayerNumber(stacks)}</strong>}
  </span>;
}

export function EnhancementIdentity({ enhancement, stacks, uppercase = false, className = '' }: {
  enhancement: Enhancement;
  stacks?: number;
  uppercase?: boolean;
  className?: string;
}) {
  const definition = ENHANCEMENTS[enhancement];
  return <span className={`enhancement-identity${className ? ` ${className}` : ''}`}>
    <EnhancementSymbol enhancement={enhancement} decorative />
    <span className="enhancement-identity-name">{uppercase ? definition.name.toUpperCase() : definition.name}</span>
    {stacks !== undefined && stacks > 1 && <span className="enhancement-identity-stacks">×{formatPlayerNumber(stacks)}</span>}
  </span>;
}
