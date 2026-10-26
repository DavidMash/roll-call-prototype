import { expect, test } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { placeFlameInstance } from '../src/game/flames';
import { rosterDice, syncActiveDiceProjection } from '../src/game/inventory';
import type { RandomSource } from '../src/game/types';
import { enterRun, installRunState } from './uiHelpers';
import { createDieEffect, resetDieRoundState } from '../src/game/specialDice';

const constant: RandomSource = { next: () => .8 };

function clarityRun() {
  const state = newRun('scoring-clarity-ui', constant).state;
  state.target = 1_000_000n;
  state.stats.rounds.at(-1)!.target = state.target;
  placeFlameInstance(state, 'missingPair', 100);
  const dice = rosterDice(state);
  [2, 2, 3, 4, 5].forEach((face, index) => { dice[index].value = face as 1 | 2 | 3 | 4 | 5; });
  dice[0].effects = [createDieEffect(dice[0].id, 'bonus')];
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(dice);
  return state;
}

test('320px scorecard removes Hand Pips, keeps inline MULT, and shows the canonical XMULT preview without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await installRunState(page, clarityRun());
  await enterRun(page);
  const pairStats = page.getByTestId('scorecard-stats-pair');
  await expect(pairStats).not.toContainText('PIPS');
  await expect(pairStats).toContainText('×2MULT');
  expect(await pairStats.locator('.hand-mult-stat').evaluate(element => getComputedStyle(element).flexDirection)).toBe('row');
  await page.getByTestId('scorecard-row-pair').click();
  const badge = page.locator('[data-testid^="active-flame-"]').first();
  await expect(badge).toHaveAttribute('data-flame-state', 'active');
  await expect(badge).toContainText('×3');
  await expect(page.getByTestId('play-action')).toContainText('XMULT');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('resolved die PIPS and Flame XMULT feedback originate from playback events', async ({ page }) => {
  await installRunState(page, clarityRun(), 'fast');
  await enterRun(page);
  await page.getByTestId('scorecard-row-pair').click();
  await page.evaluate(() => {
    (window as typeof window & { __resolutionPops?: string[]; __maxPops?: number }).__resolutionPops = [];
    (window as typeof window & { __maxPops?: number }).__maxPops = 0;
    const collect = () => document.querySelectorAll('.resolution-pop').forEach(node => {
      const text = node.textContent?.trim();
      const store = (window as typeof window & { __resolutionPops?: string[] }).__resolutionPops!;
      if (text && !store.includes(text)) store.push(text);
      const state = window as typeof window & { __maxPops?: number };
      state.__maxPops = Math.max(state.__maxPops ?? 0, document.querySelectorAll('.resolution-pop').length);
    });
    new MutationObserver(collect).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.getByTestId('play-action').click();
  await page.waitForFunction(() => {
    const values = (window as typeof window & { __resolutionPops?: string[] }).__resolutionPops ?? [];
    return values.some(value => value.includes('PIPS')) && values.some(value => value.includes('XMULT'));
  });
  const values = await page.evaluate(() => (window as typeof window & { __resolutionPops?: string[] }).__resolutionPops ?? []);
  expect(values).toEqual(expect.arrayContaining(['+12 PIPS', '+2 PIPS']));
  expect(values).toContain('×3 XMULT');
  expect(await page.evaluate(() => (window as typeof window & { __maxPops?: number }).__maxPops)).toBe(1);
});

test('reduced motion keeps contribution text while removing travel animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installRunState(page, clarityRun());
  await enterRun(page);
  const animation = await page.evaluate(() => {
    const node = document.createElement('span');
    node.className = 'resolution-pop';
    node.textContent = '+2 PIPS';
    document.body.append(node);
    const result = getComputedStyle(node).animationName;
    node.remove();
    return result;
  });
  expect(['none', 'contribution-pop-reduced']).toContain(animation);
});
