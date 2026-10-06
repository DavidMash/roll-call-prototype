import { describe, expect, it } from 'vitest';
import { CHAPTER_MAP_POINTS, CHAPTER_MAP_SLOTS, chapterMapNodeState, formatMapTarget } from '../components/RunMapTransition';

describe('chapter map route geometry', () => {
  it('uses every anchor on a stable three-by-four board', () => {
    expect(CHAPTER_MAP_SLOTS).toHaveLength(12);
    expect(CHAPTER_MAP_SLOTS.slice(0, 4).map(point => point.row)).toEqual(Array(4).fill('bottom'));
    expect(CHAPTER_MAP_SLOTS.slice(4, 8).map(point => point.row)).toEqual(Array(4).fill('middle'));
    expect(CHAPTER_MAP_SLOTS.slice(8, 12).map(point => point.row)).toEqual(Array(4).fill('top'));
    expect(CHAPTER_MAP_SLOTS.slice(0, 4).map(point => point.x)).toEqual([16, 39, 61, 84]);
    expect(CHAPTER_MAP_SLOTS.slice(4, 8).map(point => point.x)).toEqual([84, 61, 39, 16]);
    expect(CHAPTER_MAP_SLOTS.slice(8, 12).map(point => point.x)).toEqual([16, 39, 61, 84]);

    expect(CHAPTER_MAP_POINTS).toHaveLength(12);
    expect(CHAPTER_MAP_POINTS.map(point => point.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(CHAPTER_MAP_POINTS.filter(point => point.row === 'bottom')).toHaveLength(4);
    expect(CHAPTER_MAP_POINTS.filter(point => point.row === 'middle')).toHaveLength(4);
    expect(CHAPTER_MAP_POINTS.filter(point => point.row === 'top')).toHaveLength(4);
  });

  it('starts at the lower-left and ends with the final Shop at the upper-right', () => {
    expect(CHAPTER_MAP_POINTS[0]).toMatchObject({ x: 16, y: 84, row: 'bottom', align: 'start', slot: 0 });
    expect(CHAPTER_MAP_POINTS.at(-1)).toMatchObject({ x: 84, y: 16, row: 'top', align: 'end', slot: 11 });
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

describe('current Round target copy', () => {
  it.each([
    [100, 'TARGET 100'],
    [56_500, 'TARGET 56,500'],
    [690_000, 'TARGET 690,000'],
    [1_600_000, 'TARGET 1,600,000'],
    [987_654_321_000, 'TARGET 987,654,321,000'],
  ])('formats %s in full without abbreviation', (target, expected) => {
    expect(formatMapTarget(target)).toBe(expected);
  });
});
