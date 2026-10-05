import { describe, expect, it } from 'vitest';
import { CHAPTER_MAP_POINTS, CHAPTER_MAP_SLOTS, chapterMapNodeState } from '../components/RunMapTransition';

describe('chapter map route geometry', () => {
  it('uses a stable three-by-four board with one intentional non-node gap', () => {
    expect(CHAPTER_MAP_SLOTS).toHaveLength(12);
    expect(CHAPTER_MAP_SLOTS.slice(0, 4).map(point => point.row)).toEqual(Array(4).fill('bottom'));
    expect(CHAPTER_MAP_SLOTS.slice(4, 8).map(point => point.row)).toEqual(Array(4).fill('middle'));
    expect(CHAPTER_MAP_SLOTS.slice(8, 12).map(point => point.row)).toEqual(Array(4).fill('top'));
    expect(CHAPTER_MAP_SLOTS.slice(0, 4).map(point => point.x)).toEqual([10, 37, 63, 90]);
    expect(CHAPTER_MAP_SLOTS.slice(4, 8).map(point => point.x)).toEqual([90, 63, 37, 10]);
    expect(CHAPTER_MAP_SLOTS.slice(8, 12).map(point => point.x)).toEqual([10, 37, 63, 90]);

    expect(CHAPTER_MAP_POINTS).toHaveLength(11);
    expect(CHAPTER_MAP_POINTS.map(point => point.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11]);
    expect(CHAPTER_MAP_POINTS.filter(point => point.row === 'bottom')).toHaveLength(4);
    expect(CHAPTER_MAP_POINTS.filter(point => point.row === 'middle')).toHaveLength(4);
    expect(CHAPTER_MAP_POINTS.filter(point => point.row === 'top')).toHaveLength(3);
  });

  it('starts at the lower-left and ends with the Boss at the upper-right', () => {
    expect(CHAPTER_MAP_POINTS[0]).toMatchObject({ x: 10, y: 84, row: 'bottom', align: 'start', slot: 0 });
    expect(CHAPTER_MAP_POINTS.at(-1)).toMatchObject({ x: 90, y: 16, row: 'top', align: 'end', slot: 11 });
    expect(CHAPTER_MAP_POINTS[0].y).toBeGreaterThan(CHAPTER_MAP_POINTS[4].y);
    expect(CHAPTER_MAP_POINTS[4].y).toBeGreaterThan(CHAPTER_MAP_POINTS.at(-1)!.y);
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
