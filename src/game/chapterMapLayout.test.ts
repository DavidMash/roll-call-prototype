import { describe, expect, it } from 'vitest';
import { CHAPTER_MAP_POINTS, chapterMapNodeState } from '../components/RunMapTransition';

describe('chapter map route geometry', () => {
  it('keeps the authoritative 13 stops on a stable bottom, middle, top, reward route', () => {
    expect(CHAPTER_MAP_POINTS).toHaveLength(13);
    expect(CHAPTER_MAP_POINTS.slice(0, 5).map(point => point.row)).toEqual(Array(5).fill('bottom'));
    expect(CHAPTER_MAP_POINTS.slice(5, 9).map(point => point.row)).toEqual(Array(4).fill('middle'));
    expect(CHAPTER_MAP_POINTS.slice(9, 12).map(point => point.row)).toEqual(Array(3).fill('top'));
    expect(CHAPTER_MAP_POINTS[12].row).toBe('reward');

    expect(CHAPTER_MAP_POINTS.slice(0, 5).map(point => point.x)).toEqual([9, 27, 45, 63, 85]);
    expect(CHAPTER_MAP_POINTS.slice(5, 9).map(point => point.x)).toEqual([85, 60, 35, 10]);
    expect(CHAPTER_MAP_POINTS.slice(9, 12).map(point => point.x)).toEqual([10, 48, 85]);
    expect(CHAPTER_MAP_POINTS[0].y).toBeGreaterThan(CHAPTER_MAP_POINTS[5].y);
    expect(CHAPTER_MAP_POINTS[5].y).toBeGreaterThan(CHAPTER_MAP_POINTS[11].y);
  });

  it('ends the main journey at the upper-right Boss and attaches the Flame reward nearby', () => {
    const boss = CHAPTER_MAP_POINTS[11];
    const flame = CHAPTER_MAP_POINTS[12];

    expect(boss).toMatchObject({ x: 85, y: 14, row: 'top', align: 'end' });
    expect(flame.x).toBeGreaterThan(boss.x);
    expect(Math.abs(flame.x - boss.x)).toBeLessThanOrEqual(10);
    expect(Math.abs(flame.y - boss.y)).toBeLessThanOrEqual(20);
  });
});

describe('chapter map node states', () => {
  it('moves expansion without changing route geometry', () => {
    const before = CHAPTER_MAP_POINTS.map((point, index) => ({ point, state: chapterMapNodeState(index, 4) }));
    const after = CHAPTER_MAP_POINTS.map((point, index) => ({ point, state: chapterMapNodeState(index, 5) }));

    expect(before.filter(node => node.state === 'current')).toHaveLength(1);
    expect(after.filter(node => node.state === 'current')).toHaveLength(1);
    expect(after[4].state).toBe('completed');
    expect(after[5].state).toBe('current');
    expect(after.map(node => node.point)).toEqual(before.map(node => node.point));
  });
});
