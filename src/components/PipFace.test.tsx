import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Rank } from '../game/types';
import { PipFace, pipPositions } from './PipFace';

describe('PipFace', () => {
  it.each([1, 2, 3, 4, 5, 6, 7] as Rank[])('renders %s positioned decorative pips with a numeric accessible label', value => {
    const positions = pipPositions(value);
    const html = renderToStaticMarkup(<PipFace value={value} label={`Test die showing ${value}`} />);
    expect(positions).toHaveLength(value);
    expect(new Set(positions).size).toBe(value);
    expect(html).toContain(`aria-label="Test die showing ${value}"`);
    expect(html.match(/class="pip pip-/g)).toHaveLength(value);
    for (const position of positions) expect(html).toContain(`pip-${position}`);
  });

  it('uses the impossible six-plus-center layout for Cursed 7', () => {
    expect(pipPositions(7)).toEqual([
      'top-left', 'middle-left', 'bottom-left', 'center', 'top-right', 'middle-right', 'bottom-right',
    ]);
  });
});
