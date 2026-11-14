import { expect, test } from '@playwright/test';
import path from 'node:path';
import { createCursedDie } from '../src/game/bosses';
import { newRun } from '../src/game/engine';
import { BRIBERY_ROUND_GOLD_CAP, placeFlameInstance, recalculateMaxCharge } from '../src/game/flames';
import { rosterDice, syncActiveDiceProjection } from '../src/game/inventory';
import { createDieEffect, resetDieRoundState } from '../src/game/specialDice';
import type { Flame, GameState } from '../src/game/types';
import { enterRun, installRunState } from './uiHelpers';

const SCREENSHOT_DIR = path.resolve('docs/flame-ux-audit/screenshots');
const BREAKPOINTS = [
  { name: '375-mobile', width: 375, height: 812 },
  { name: '430-mobile', width: 430, height: 932 },
  { name: '768-tablet', width: 768, height: 1024 },
  { name: '1440-desktop', width: 1440, height: 1000 },
] as const;

function baseRound(seed: string): GameState {
  const state = newRun(seed, { next: () => .8 }).state;
  state.target = 100n;
  state.score = 25n;
  state.gold = 96;
  state.stats.rounds.at(-1)!.target = state.target;
  state.dice.forEach(die => { die.value = 5; });
  return state;
}

function own(state: GameState, flames: Flame[]): GameState {
  flames.forEach(flame => placeFlameInstance(state, flame, 100));
  recalculateMaxCharge(state);
  return state;
}

function contextualState(disabled = false): GameState {
  const state = own(baseRound(disabled ? 'flame-audit-disabled' : 'flame-audit-pending'),
    ['burnItDown', 'greaseTheEngine', 'dareDevil', 'allIn', 'bribery']);
  if (disabled) {
    state.score = 0n;
    state.gold = 0;
    state.chargeXMult = state.maxCharge;
    state.scoreWagers.allInUsedThisRound = true;
    state.interactiveFlames.briberyGoldSpentThisRound = BRIBERY_ROUND_GOLD_CAP;
  } else {
    state.scoreWagers.allInArmed = true;
    state.interactiveFlames.briberyGoldSpentThisRound = 4;
    state.interactiveFlames.briberyPendingGold = 4;
    state.interactiveFlames.dareDevilCount = 2;
  }
  return state;
}

function lightningState(): { state: GameState; selectedIds: number[] } {
  const state = own(baseRound('flame-audit-lightning'),
    ['lightningStrike', 'momentum', 'thirdRail', 'jumpStart', 'powerSurge']);
  const players = rosterDice(state);
  players[0]!.effects = [createDieEffect(players[0]!.id, 'chameleon', 1)];
  players[0]!.faces.forEach((face, index) => { face.rank = ([2, 2, 3, 3, 4, 4] as const)[index]!; });
  players[1]!.effects = [createDieEffect(players[1]!.id, 'clockwork', 1)];
  players[2]!.effects = [createDieEffect(players[2]!.id, 'weighted', 1)];
  players[3]!.effects = [createDieEffect(players[3]!.id, 'flywheel', 1)];
  const cursed = createCursedDie();
  cursed.value = 7;
  state.encounterDice = [cursed];
  state.boss = { type: 'hexer', cursedDieId: cursed.id };
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  state.manualRerollsRemaining = 5;
  return { state, selectedIds: [...players.slice(0, 4).map(die => die.id), cursed.id] };
}

async function openLightning(page: import('@playwright/test').Page, selectedIds: number[]) {
  for (const id of selectedIds) await page.locator(`[data-die-id="${id}"] .die`).click();
  await page.getByTestId('manual-reroll').click();
  await expect(page.getByRole('dialog', { name: /Lightning Strike/ })).toBeVisible();
}

async function expectNoPageOverflow(page: import('@playwright/test').Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function expectMinimumTouchTarget(locator: import('@playwright/test').Locator) {
  const box = await locator.boundingBox();
  expect(box, 'interactive control should have a rendered box').not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(43.9);
  expect(box!.height).toBeGreaterThanOrEqual(43.9);
}

test.describe.serial('Flame UX audit captures', () => {
  for (const viewport of BREAKPOINTS) {
    test(`${viewport.name}: contextual armed and pending controls`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await installRunState(page, contextualState());
      await enterRun(page);
      await expect(page.getByTestId('all-in-toggle')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('bribery-invest')).toContainText('×3');
      await expectNoPageOverflow(page);
      if (viewport.width <= 430) {
        const modifier = await page.getByTestId('all-in-toggle').boundingBox();
        const primary = await page.getByTestId('manual-reroll').boundingBox();
        expect(modifier!.y).toBeLessThan(primary!.y);
      }
      for (const testId of ['burn-it-down-action', 'grease-the-engine-action', 'all-in-toggle', 'bribery-invest', 'manual-reroll', 'play-action']) {
        await expectMinimumTouchTarget(page.getByTestId(testId));
      }
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${viewport.name}-contextual-pending-after.png`), fullPage: true });
    });

    test(`${viewport.name}: five-die Lightning Strike modal`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { state, selectedIds } = lightningState();
      await installRunState(page, state);
      await enterRun(page);
      await openLightning(page, selectedIds);
      const dialog = page.getByRole('dialog', { name: /Lightning Strike/ });
      await expect(dialog.locator('.lightning-prediction-die')).toHaveCount(5);
      await expect(dialog.getByText('Chameleon', { exact: false })).toBeVisible();
      await expect(dialog.getByTestId('cursed-die-slot')).toBeVisible();
      await expect(page.getByTestId('lightning-strike-stakes')).toContainText('IF ALL 5 HIT: ×243');
      await expect(page.getByTestId('lightning-scroll-guidance')).toContainText('5 DICE TO PREDICT');
      for (const arrow of await dialog.locator('.lightning-prediction-arrow').all()) await expectMinimumTouchTarget(arrow);
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${viewport.name}-lightning-five-mixed-after.png`) });

      if (viewport.width <= 430) {
        const shell = dialog.locator('.lightning-prediction-scroll');
        await expect(shell).toHaveClass(/has-more-after/);
        await expect(page.getByTestId('lightning-scroll-guidance')).toContainText('SWIPE FOR MORE DICE');
        await page.getByTestId('lightning-prediction-row').evaluate(row => row.scrollTo({ left: row.scrollWidth, behavior: 'auto' }));
        await expect(shell).toHaveClass(/has-more-before/);
        await expect(shell).not.toHaveClass(/has-more-after/);
        await expect(page.getByTestId('lightning-scroll-guidance')).toContainText('FINAL DIE REACHED');
        const rowBox = await page.getByTestId('lightning-prediction-row').boundingBox();
        const cursedBox = await dialog.getByTestId('cursed-die-slot').boundingBox();
        expect(cursedBox!.x + cursedBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${viewport.name}-lightning-final-die-after.png`) });
      }

      const close = page.getByRole('button', { name: 'Close Lightning Strike prediction' });
      await expect(close).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Next prediction for Die 1' })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId('manual-reroll')).toBeFocused();
    });
  }

  test('375-mobile: action rows adapt when one or no modifier Flames are owned', async ({ page }) => {
    await page.setViewportSize(BREAKPOINTS[0]);
    await installRunState(page, own(baseRound('flame-audit-one-modifier'), ['allIn']));
    await enterRun(page);
    const oneModifierLayout = page.locator('.round-action-layout');
    await expect(oneModifierLayout).toHaveClass(/has-play-modifiers/);
    expect((await page.getByTestId('all-in-toggle').boundingBox())!.y)
      .toBeLessThan((await page.getByTestId('manual-reroll').boundingBox())!.y);
    await expect(page.getByTestId('bribery-invest')).toHaveCount(0);

    await installRunState(page, baseRound('flame-audit-no-modifiers'));
    await enterRun(page);
    const noModifierLayout = page.locator('.round-action-layout');
    await expect(noModifierLayout).not.toHaveClass(/has-play-modifiers/);
    const reroll = await page.getByTestId('manual-reroll').boundingBox();
    const play = await page.getByTestId('play-action').boundingBox();
    expect(Math.abs(reroll!.y - play!.y)).toBeLessThan(1);
    expect((await page.getByTestId('run-action-row').boundingBox())!.height).toBeLessThanOrEqual(54);
  });

  for (const viewport of BREAKPOINTS) {
    test(`${viewport.name}: disabled contextual controls`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await installRunState(page, contextualState(true));
      await enterRun(page);
      await expect(page.getByTestId('burn-it-down-action')).toBeDisabled();
      await expect(page.getByTestId('grease-the-engine-action')).toBeDisabled();
      await expect(page.getByTestId('all-in-toggle')).toBeDisabled();
      await expect(page.getByTestId('bribery-invest')).toBeDisabled();
      await expect(page.getByTestId('grease-unavailable-reason')).toBeVisible();
      await expect(page.getByTestId('all-in-unavailable-reason')).toBeVisible();
      await expect(page.getByTestId('bribery-unavailable-reason')).toBeVisible();
      await page.getByTestId('grease-unavailable-reason').click();
      await expect(page.getByRole('tooltip')).toContainText(/Charge|Gold/);
      await expectNoPageOverflow(page);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${viewport.name}-contextual-disabled-after.png`), fullPage: true });
    });

    test(`${viewport.name}: Dare Devil interception`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const state = own(baseRound('flame-audit-dare'), ['dareDevil']);
      state.interactiveFlames.dareDevilCount = 2;
      await installRunState(page, state);
      await enterRun(page);
      await page.getByTestId('scorecard-row-fiveKind').click();
      await page.getByTestId('play-action').click();
      const dialog = page.getByRole('dialog', { name: /Dare Devil/ });
      await expect(dialog).toContainText('DARE 2/4');
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${viewport.name}-dare-devil-after.png`) });
      await expect(page.getByRole('button', { name: 'Close Dare Devil choice' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId('play-action')).toBeFocused();
    });
  }
});
