import { expect, test } from '@playwright/test';
import { BOSSES } from '../src/game/bosses';
import { newRun } from '../src/game/engine';
import { RUN_STORAGE_KEY, RUN_STORAGE_VERSION } from '../src/game/persistence';
import type { GameState } from '../src/game/types';
import { enterRun } from './uiHelpers';

async function installRun(page: import('@playwright/test').Page, state: GameState) {
  await page.evaluate(([key, version, saved]) => localStorage.setItem(key, JSON.stringify({ version, state: saved })),
    [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, state] as const);
  await page.reload();
  await page.locator('main').waitFor();
  await enterRun(page);
}

test('Chapter splash leads into one complete current-Chapter map without revealing encounters', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seed = 'chapter-presentation';
  const expected = newRun(seed).state.chapterPlans[1]!;
  await page.goto(`/?seed=${seed}&speed=normal`);
  await enterRun(page);

  const splash = page.getByTestId('chapter-splash');
  await expect(splash).toBeVisible();
  const dock = page.getByTestId('dice-dock');
  const dockHandle = await dock.elementHandle();
  await expect(dock).toBeVisible();
  await expect(dock).toHaveAttribute('data-cinematic', 'true');
  await expect(dock.locator('.die')).toHaveCount(5);
  expect(await dock.locator('button').evaluateAll(buttons => buttons.every(button => (button as HTMLButtonElement).disabled))).toBe(true);
  await expect(splash).toHaveText(/CHAPTER 1/);
  await expect(splash).toHaveAttribute('data-start-color', BOSSES[expected.miniBoss].primary);
  await expect(splash).toHaveAttribute('data-end-color', BOSSES[expected.boss].primary);
  await expect(splash).not.toContainText(BOSSES[expected.miniBoss].name);
  await expect(splash).not.toContainText(BOSSES[expected.boss].name);
  expect(await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main')!.getBoundingClientRect();
    const dock = document.querySelector<HTMLElement>('[data-testid="dice-dock"]')!.getBoundingClientRect();
    return document.documentElement.scrollHeight <= innerHeight && main.bottom <= dock.top + 1 && dock.bottom <= innerHeight;
  })).toBe(true);

  const map = page.getByTestId('run-map-transition');
  await expect(map).toBeVisible({ timeout: 4_000 });
  expect(await dockHandle!.evaluate(element => element === document.querySelector('[data-testid="dice-dock"]'))).toBe(true);
  await expect(dock).not.toHaveAttribute('data-cinematic', 'true');
  await expect(page.locator('[data-testid="dice-dock"]')).toHaveCount(1);
  await expect(map.locator('.map-kicker')).toHaveText('CHAPTER 1');
  expect(await map.locator('.run-map-node').evaluateAll(nodes => nodes.map(node => (node.parentElement as HTMLElement).dataset.nodeLabel))).toEqual([
    'R1', 'SHOP', 'R2', 'SHOP', 'MINI-BOSS', 'SHOP',
    'R4', 'SHOP', 'R5', 'SHOP', 'BOSS',
  ]);
  await expect(map.locator('[aria-current="step"] .node-label')).toHaveText('R1');
  await expect(map.locator('[aria-current="step"]')).not.toContainText('Goal');
  await expect(map.locator('[aria-current="step"]')).not.toContainText('Prepare for');
  await expect(map.locator('[aria-current="step"] .node-glyph')).toHaveCount(0);
  await expect(map.locator('.run-map-stop.is-current')).toHaveCount(1);
  await expect(map.locator('.run-map-stop:not(.is-current) .node-label')).toHaveCount(0);
  await expect(map.locator('.run-map-stop:not(.is-current) .node-glyph')).toHaveCount(10);
  await expect(map.locator('.node-shop')).toHaveCount(5);
  await expect(map.locator('.node-shop .node-glyph')).toHaveText(['$', '$', '$', '$', '$']);
  await expect(map.locator('[data-node-kind="special_offer"]')).toHaveCount(0);
  await expect(map.locator('[data-node-kind="flame_selection"]')).toHaveCount(0);
  await expect(map.locator('[data-tutorial="chapter-map"]')).toHaveCount(1);
  await expect(map.locator('[data-tutorial="chapter-map-current"]')).toHaveCount(1);
  await expect(map.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('run-action-row').getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await expect(map.locator('.map-route-segment')).toHaveCount(10);
  await expect(map.locator('.map-route-segment[d*="C"]')).toHaveCount(2);
  await expect(map.locator('.run-map-track')).toHaveAttribute('data-slot-count', '12');
  expect(await map.locator('.run-map-node').evaluateAll(nodes => nodes.every(node => {
    const before = getComputedStyle(node, '::before').content;
    const after = getComputedStyle(node, '::after').content;
    return (before === 'none' || before === '') && (after === 'none' || after === '');
  }))).toBe(true);
  expect(await map.locator('.run-map-node').evaluateAll(nodes => nodes.every(node => node.children.length === 1))).toBe(true);
  const mobileLayout = await map.evaluate(element => {
    const root = element as HTMLElement;
    const track = root.querySelector<HTMLElement>('.run-map-track')!;
    const dock = document.querySelector<HTMLElement>('[data-testid="dice-dock"]')!;
    const actionRow = document.querySelector<HTMLElement>('[data-testid="run-action-row"]')!;
    const stops = [...root.querySelectorAll<HTMLElement>('.run-map-stop')];
    const nodeRects = stops.map(stop => stop.querySelector<HTMLElement>('.run-map-node')!.getBoundingClientRect());
    const sizes = nodeRects.map(rect => Math.max(rect.width, rect.height));
    const overlaps = nodeRects.flatMap((a, index) => nodeRects.slice(index + 1).map((b, offset) => ({
      a: index, b: index + offset + 1,
      overlaps: Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1,
    }))).filter(pair => pair.overlaps);
    const rows = stops.map(stop => stop.dataset.row);
    const positions = stops.map(stop => ({ x: Number(stop.dataset.mapX), y: Number(stop.dataset.mapY) }));
    const bossRect = nodeRects[10];
    const currentStop = root.querySelector<HTMLElement>('.run-map-stop.is-current')!;
    const currentNode = currentStop.querySelector<HTMLElement>('.run-map-node')!;
    const currentRect = currentNode.getBoundingClientRect();
    const anchorX = track.getBoundingClientRect().left + Number(currentStop.dataset.mapX) / 100 * track.clientWidth;
    const anchorY = track.getBoundingClientRect().top + Number(currentStop.dataset.mapY) / 100 * track.clientHeight;
    const centerElement = document.elementFromPoint(anchorX, anchorY);
    return {
      rows,
      positions,
      slots: stops.map(stop => Number(stop.dataset.slotIndex)),
      sizes,
      overlaps,
      allNodesInsideTrack: nodeRects.every(rect => rect.left >= track.getBoundingClientRect().left - 1
        && rect.right <= track.getBoundingClientRect().right + 1
        && rect.top >= track.getBoundingClientRect().top - 1
        && rect.bottom <= track.getBoundingClientRect().bottom + 1),
      noDocumentHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      noMapHorizontalOverflow: track.scrollWidth <= track.clientWidth,
      mapAboveDock: root.getBoundingClientRect().bottom <= dock.getBoundingClientRect().top + 1,
      dockAboveActions: dock.getBoundingClientRect().bottom <= actionRow.getBoundingClientRect().top + 1,
      actionInsideViewport: actionRow.getBoundingClientRect().bottom <= innerHeight,
      currentAnchorAligned: Math.abs(currentRect.left + currentRect.width / 2 - anchorX) < 1
        && Math.abs(currentRect.top + currentRect.height / 2 - anchorY) < 1,
      routeMaskedByCurrentNode: !!centerElement?.closest('.run-map-node'),
      bossVisible: bossRect.left >= 0 && bossRect.right <= innerWidth && bossRect.top >= 0 && bossRect.bottom <= innerHeight,
    };
  });
  expect(mobileLayout.rows).toEqual([
    'bottom', 'bottom', 'bottom', 'bottom',
    'middle', 'middle', 'middle', 'middle',
    'top', 'top', 'top',
  ]);
  expect(mobileLayout.slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11]);
  expect(mobileLayout.positions.slice(0, 4).map(point => point.x)).toEqual([16, 39, 61, 84]);
  expect(mobileLayout.positions.slice(4, 8).map(point => point.x)).toEqual([84, 61, 39, 16]);
  expect(mobileLayout.positions.slice(8).map(point => point.x)).toEqual([16, 61, 84]);
  expect(mobileLayout.positions[0].y).toBeGreaterThan(mobileLayout.positions[4].y);
  expect(mobileLayout.positions[4].y).toBeGreaterThan(mobileLayout.positions[10].y);
  expect(mobileLayout.sizes[1]).toBeLessThan(mobileLayout.sizes[2]);
  expect(mobileLayout.sizes[2]).toBeLessThan(mobileLayout.sizes[4]);
  expect(mobileLayout.sizes[4]).toBeLessThan(mobileLayout.sizes[10]);
  expect(mobileLayout.overlaps).toEqual([]);
  expect(mobileLayout.allNodesInsideTrack).toBe(true);
  expect(mobileLayout.noDocumentHorizontalOverflow).toBe(true);
  expect(mobileLayout.noMapHorizontalOverflow).toBe(true);
  expect(mobileLayout.mapAboveDock).toBe(true);
  expect(mobileLayout.dockAboveActions).toBe(true);
  expect(mobileLayout.actionInsideViewport).toBe(true);
  expect(mobileLayout.currentAnchorAligned).toBe(true);
  expect(mobileLayout.routeMaskedByCurrentNode).toBe(true);
  expect(mobileLayout.bossVisible).toBe(true);
  expect(await map.locator('.run-map-node').evaluateAll(nodes => nodes.every(node => {
    const label = node.getAttribute('aria-label') ?? '';
    return label.length > 0 && /completed|current|upcoming/.test(label);
  }))).toBe(true);
  expect(await page.evaluate(() => {
    const hud = document.querySelector<HTMLElement>('.top-hud')!.getBoundingClientRect();
    const main = document.querySelector<HTMLElement>('main')!.getBoundingClientRect();
    const dock = document.querySelector<HTMLElement>('[data-testid="dice-dock"]')!.getBoundingClientRect();
    return document.documentElement.scrollHeight <= innerHeight && main.top >= hud.bottom && main.bottom <= dock.top + 1 && dock.bottom <= innerHeight;
  })).toBe(true);
});

test('desktop Chapter map stays centered and compact instead of stretching into a timeline', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?seed=chapter-map-desktop&speed=normal');
  await enterRun(page);

  const map = page.getByTestId('run-map-transition');
  await expect(map).toBeVisible({ timeout: 4_000 });
  const layout = await map.evaluate(element => {
    const panel = (element as HTMLElement).getBoundingClientRect();
    const trackElement = element.querySelector<HTMLElement>('.run-map-track')!;
    const track = trackElement.getBoundingClientRect();
    const stops = [...element.querySelectorAll<HTMLElement>('.run-map-stop')];
    return {
      panelWidth: panel.width,
      trackWidth: track.width,
      centered: Math.abs((track.left + track.width / 2) - (panel.left + panel.width / 2)) < 2,
      horizontalScroll: trackElement.scrollWidth > trackElement.clientWidth,
      distinctBands: new Set(stops.map(stop => stop.dataset.mapY)).size,
      anchorSizes: stops.map(stop => ({ width: stop.offsetWidth, height: stop.offsetHeight })),
    };
  });

  expect(layout.panelWidth).toBeLessThanOrEqual(902);
  expect(layout.trackWidth).toBeLessThanOrEqual(782);
  expect(layout.trackWidth).toBeLessThan(page.viewportSize()!.width * .7);
  expect(layout.centered).toBe(true);
  expect(layout.horizontalScroll).toBe(false);
  expect(layout.distinctBands).toBe(3);
  expect(layout.anchorSizes.every(size => size.width === 0 && size.height === 0)).toBe(true);
});

test('finishing the Boss reward enters a fresh Chapter once before its map and preserves the inter-Chapter Shop', async ({ page }) => {
  const state = newRun('chapter-boundary').state;
  state.round = 6;
  state.phase = 'flameSelection';
  state.currentNodeId = 'flame:after-round:6';
  state.flameSelection = { offers: [], acquired: true };
  state.shop = null;
  state.roundSummary = null;
  state.presentedChapters = [1];
  delete state.chapterPlans[2];
  delete state.bossSchedule[9];
  delete state.bossSchedule[12];

  await page.goto(`/?seed=${state.seed}&speed=normal`);
  await installRun(page, state);
  await page.getByRole('button', { name: 'CONTINUE TO SHOP', exact: false }).click();

  const splash = page.getByTestId('chapter-splash');
  await expect(splash).toHaveAttribute('data-chapter', '2');
  await expect(splash).toHaveText(/CHAPTER 2/);
  const map = page.getByTestId('run-map-transition');
  await expect(map).toBeVisible({ timeout: 4_000 });
  await expect(map.locator('.map-kicker')).toHaveText('CHAPTER 2');
  await expect(map.locator('.run-map-track')).toHaveAttribute('data-chapter', '2');
  expect(await map.locator('.run-map-node').evaluateAll(nodes => nodes.map(node => (node.parentElement as HTMLElement).dataset.nodeLabel))).toEqual([
    'R1', 'SHOP', 'R2', 'SHOP', 'MINI-BOSS', 'SHOP',
    'R4', 'SHOP', 'R5', 'SHOP', 'BOSS',
  ]);
  await expect(map.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(map.locator('.node-shop')).toHaveCount(5);
  await expect(map).not.toContainText('R6');

  await page.getByTestId('run-action-row').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(map).toHaveCount(0);
  await expect(page.locator('.shop-summary').getByText('SHOP', { exact: true })).toBeVisible();
  await expect(page.getByTestId('chapter-splash')).toHaveCount(0);
});
