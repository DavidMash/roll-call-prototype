import { expect, test } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { Resolver } from '../src/game/effects';
import { createCollectibleDie } from '../src/game/dice';
import { createDieEffect, resetDieRoundState } from '../src/game/specialDice';
import { rosterDice, syncActiveDiceProjection } from '../src/game/inventory';
import { placeFlameInstance } from '../src/game/flames';
import type { GameState, SpecialDieType } from '../src/game/types';
import { enterRun, goToShopStage, installRunState } from './uiHelpers';

const fixed = { next: () => .2 };
function shopState(seed: string): GameState {
  const state = newRun(seed, fixed).state;
  state.gold = 100;
  new Resolver(state, fixed).openShop();
  state.shop!.exitUnlocked = true;
  return state;
}
function setEffect(state: GameState, id: number, type: SpecialDieType, level = 1) {
  state.diceInventory.instances[id].effects = [createDieEffect(id, type, level)];
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
}

for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`${viewport.name} fixed Storage aligns five columns with Roster`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const state = shopState(`five-slots-${viewport.name}`);
    for (const [index, type] of (['golden', 'magic', 'clockwork'] as const).entries()) {
      const die = createCollectibleDie(state.diceInventory.nextDieId++, type);
      state.diceInventory.instances[die.id] = die; state.diceInventory.storage[index] = die.id;
    }
    await installRunState(page, state); await enterRun(page);
    const storage = page.locator('.storage-grid .collection-slot');
    const roster = page.locator('.roster-grid .collection-slot');
    await expect(storage).toHaveCount(5); await expect(roster).toHaveCount(5);
    const storageGeometry = await storage.evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, width: rect.width }; }));
    const rosterGeometry = await roster.evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, width: rect.width }; }));
    storageGeometry.forEach((slot, index) => {
      expect(slot.x).toBeCloseTo(rosterGeometry[index].x, 0);
      expect(slot.width).toBeCloseTo(rosterGeometry[index].width, 0);
    });
    expect(await page.getByTestId('storage-strip').evaluate(element => getComputedStyle(element).overflowX)).not.toBe('auto');
    await page.screenshot({ path: test.info().outputPath(`collection-${viewport.name}.png`), fullPage: true });
  });

  test(`${viewport.name} selected Normal and multi-effect dice use the same lift primitive`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const round = newRun(`selection-${viewport.name}`, fixed).state;
    setEffect(round, 1, 'magnetic');
    round.diceInventory.instances[1].effects.push(createDieEffect(1, 'golden'));
    syncActiveDiceProjection(round); round.dieRoundState = resetDieRoundState(rosterDice(round));
    await installRunState(page, round); await enterRun(page);
    for (const id of [0, 1]) {
      const die = page.getByTestId(`flame-die-${id}`).locator('.die');
      await die.click(); await expect(die).toHaveClass(/is-die-selected/);
      const visual = await die.evaluate(element => ({ transform: getComputedStyle(element).transform, shadow: getComputedStyle(element).boxShadow }));
      expect(visual.transform).not.toBe('none'); expect(visual.shadow).not.toBe('none');
      if (viewport.name === 'desktop' && id === 1)
        await page.screenshot({ path: test.info().outputPath('selected-multi-effect-round.png'), fullPage: true });
      await die.click(); await expect(die).not.toHaveClass(/is-die-selected/);
    }
  });
}

test('Shop uses clickable Mantine tabs, keeps Gold/Temper visible, and has no physical-dice reroll', async ({ page }) => {
  const state = shopState('shop-tabs-ui');
  state.temper = 12; state.forgeUnlocked = true;
  placeFlameInstance(state, 'ultimate', 0);
  await installRunState(page, state); await enterRun(page);
  await expect(page.getByRole('tablist')).toBeVisible();
  await expect(page.getByTestId('shop-stage-shop')).toHaveAttribute('data-active', 'true');
  await expect(page.getByText(/REROLL ALL DICE/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /REROLL OFFERS/i })).toBeVisible();
  await expect(page.getByTestId('shop-stage-gold')).toBeVisible();
  await expect(page.getByTestId('shop-stage-temper')).toContainText('12 TEMPER');
  await goToShopStage(page, 'forge'); await expect(page.getByTestId('forge-shop')).toBeVisible();
  await page.getByTestId('shop-back').click(); await expect(page.getByTestId('dice-shop')).toBeVisible();
  await goToShopStage(page, 'train'); await expect(page.getByTestId('shop-back')).toBeVisible();
  await page.getByTestId('shop-back').click(); await expect(page.getByTestId('dice-shop')).toBeVisible();
  await goToShopStage(page, 'flames'); await expect(page.getByTestId('shop-back')).toBeVisible();
  await page.getByTestId('shop-back').click(); await expect(page.getByTestId('dice-shop')).toBeVisible();
});

test('Forge reuses inventory staging, treats ingredients as unordered, and places the result Roster-first', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = shopState('forge-ui');
  setEffect(state, 0, 'bonus', 2); setEffect(state, 1, 'bonus', 1);
  state.temper = 20; state.forgeUnlocked = true;
  await installRunState(page, state); await enterRun(page); await goToShopStage(page, 'forge');
  await page.getByTestId('collection-slot-roster-0').locator('.collection-slot-main').click();
  await page.getByTestId('forge-socket-a').click();
  await page.getByTestId('collection-slot-roster-1').locator('.collection-slot-main').click();
  await page.getByTestId('forge-socket-b').click();
  await expect(page.locator('.forge-staged')).toHaveCount(2);
  await expect(page.getByTestId('forge-preview')).toContainText('FUSION');
  await expect(page.getByTestId('forge-preview')).toContainText('3 TEMPER');
  await page.getByTestId('forge-preview').getByRole('button', { name: 'FORGE · 3 TEMPER' }).click();
  await expect(page.getByTestId('forge-shop')).toBeVisible();
  await expect(page.getByTestId('shop-stage-temper')).toContainText('17 TEMPER');
  await expect(page.locator('.forge-staged')).toHaveCount(0);
  await expect(page.getByTestId('collection-slot-roster-0')).toContainText('Bonus · III');
  await expect(page.getByTestId('shop-back')).toBeVisible();
  expect(await page.getByTestId('forge-shop').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('forge-mobile.png'), fullPage: true });
});

test('special icons are labels outside the pip field and multi-effect gradients remain readable', async ({ page }) => {
  const state = shopState('effect-visuals');
  setEffect(state, 0, 'magic', 2);
  state.diceInventory.instances[0].effects.push(createDieEffect(0, 'golden', 3), createDieEffect(0, 'mirror', 1));
  syncActiveDiceProjection(state);
  await installRunState(page, state); await enterRun(page);
  const card = page.getByTestId('collection-slot-roster-0');
  await expect(card.locator('.die-type-icon')).toHaveCount(3);
  await expect(card.locator('.collectible-die-visual .die-type-icon')).toHaveCount(0);
  const pipFace = card.locator('.collectible-die-visual .pip-face');
  const faceValue = Number(await pipFace.getAttribute('data-value'));
  await expect(card.locator('.collectible-die-visual .pip')).toHaveCount(faceValue);
  expect(await card.locator('.collectible-die-visual').evaluate(element => getComputedStyle(element).backgroundImage)).toContain('linear-gradient');
  await page.screenshot({ path: test.info().outputPath('multi-effect-collection.png'), fullPage: true });
});
