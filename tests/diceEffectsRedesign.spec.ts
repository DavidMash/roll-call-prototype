import path from 'node:path';
import { expect, test } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { createCollectibleDie } from '../src/game/dice';
import { placeFlameInstance, recalculateMaxCharge } from '../src/game/flames';
import { rosterDice, syncActiveDiceProjection } from '../src/game/inventory';
import { createDieEffect, effectOf, effectRuntime, resetDieRoundState } from '../src/game/specialDice';
import { enterRun, installRunState, readRunState } from './uiHelpers';

const screenshotDir = path.resolve('docs/dice-effects-redesign/screenshots');

function fiveForgedDice() {
  const state = newRun('five-forged-direct-actions').state;
  state.target = 1_000_000n;
  state.gold = 20;
  for (const die of rosterDice(state)) die.effects = [
    createDieEffect(die.id, 'chameleon', 2),
    createDieEffect(die.id, 'furnace', 2),
  ];
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  effectRuntime(state.dieRoundState[0], effectOf(rosterDice(state)[0], 'chameleon'))!.invocationsRemaining = 0;
  const capped = effectRuntime(state.dieRoundState[1], effectOf(rosterDice(state)[1], 'furnace'))!;
  capped.furnaceGoldFed = 5;
  capped.furnacePips = 30;
  return state;
}

function sevenForgedDice() {
  const state = fiveForgedDice();
  state.seed = 'seven-forged-direct-actions';
  for (let id = 5; id < 7; id++) {
    const die = createCollectibleDie(id, 'chameleon', 2);
    die.effects.push(createDieEffect(id, 'furnace', 2));
    state.diceInventory.instances[id] = die;
    state.diceInventory.roster.push(id);
  }
  state.diceInventory.nextDieId = 7;
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  return state;
}

test('stacked direct controls remain independent, touchable, and responsive at audit widths', async ({ page }) => {
  const state = fiveForgedDice();
  await installRunState(page, state);
  await enterRun(page);
  await expect(page.getByTestId('dice-dock')).toBeVisible();
  await expect(page.locator('[data-testid^="chameleon-action-"]')).toHaveCount(5);
  await expect(page.locator('[data-testid^="furnace-action-"]')).toHaveCount(5);
  await expect(page.getByTestId('chameleon-action-0')).toBeDisabled();
  await expect(page.getByTestId('furnace-action-1')).toBeDisabled();
  await expect(page.getByTestId('furnace-action-0')).toBeEnabled();
  await expect(page.getByTestId('chameleon-action-1')).toHaveText('USE');
  await expect(page.getByTestId('chameleon-action-1').locator('.die-type-icon')).toHaveCount(1);
  await expect(page.getByTestId('furnace-action-0')).toHaveText('FEED');
  await expect(page.getByTestId('furnace-action-0').locator('.die-type-icon')).toHaveCount(1);
  await expect(page.getByTestId('chameleon-action-0')).toHaveAccessibleName(/0 of 2 Uses remaining.*no Uses remaining/i);
  await expect(page.getByTestId('furnace-action-1')).toHaveAccessibleName(/0 of 5 feeds remaining.*at most 5 Gold/i);
  await expect(page.getByTestId('chameleon-action-1')).toHaveAttribute('data-action-remaining', '2');
  await expect(page.getByTestId('chameleon-action-1')).toHaveAttribute('data-action-capacity', '2');
  await expect(page.getByTestId('chameleon-action-1')).toHaveAttribute('title', /2 of 2 Uses remaining/);
  await expect(page.getByTestId('furnace-action-0')).toHaveAttribute('data-action-remaining', '5');
  await expect(page.getByTestId('furnace-action-0')).toHaveAttribute('title', /5 of 5 feeds remaining/);
  expect(await page.getByTestId('chameleon-action-0').evaluate(element =>
    Number(getComputedStyle(element).getPropertyValue('--die-action-progress')))).toBe(0);
  expect(await page.getByTestId('chameleon-action-1').evaluate(element =>
    Number(getComputedStyle(element).getPropertyValue('--die-action-progress')))).toBe(1);
  expect(await page.getByTestId('furnace-action-1').evaluate(element =>
    Number(getComputedStyle(element).getPropertyValue('--die-action-progress')))).toBe(0);

  await page.getByTestId('chameleon-action-2').click();
  await expect(page.getByTestId('chameleon-action-2')).toHaveAttribute('data-action-remaining', '1');
  expect(await page.getByTestId('chameleon-action-2').evaluate(element =>
    Number(getComputedStyle(element).getPropertyValue('--die-action-progress')))).toBe(.5);
  await page.getByTestId('chameleon-action-2').click();
  await expect(page.getByTestId('chameleon-action-2')).toHaveAttribute('data-action-remaining', '0');
  await expect(page.getByTestId('chameleon-action-2')).toBeDisabled();
  expect(await page.getByTestId('chameleon-action-2').evaluate(element =>
    Number(getComputedStyle(element).getPropertyValue('--die-action-progress')))).toBe(0);
  await page.getByTestId('chameleon-action-3').click();
  await expect(page.getByTestId('chameleon-action-3')).toHaveAttribute('data-action-remaining', '1');

  for (const viewport of [
    { width: 320, height: 720 }, { width: 375, height: 812 }, { width: 430, height: 932 },
    { width: 768, height: 1024 }, { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    const audit = await page.getByTestId('dice-dock').evaluate(element => {
      const buttons = [...element.querySelectorAll<HTMLElement>('.die-direct-action')];
      const slotHeights = [...element.querySelectorAll<HTMLElement>('.die-direct-action-slot')]
        .map(slot => slot.getBoundingClientRect().height);
      return {
        bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        dockOverflow: element.scrollWidth > element.clientWidth,
        minimumWidth: Math.min(...buttons.map(button => button.getBoundingClientRect().width)),
        minimumHeight: Math.min(...buttons.map(button => button.getBoundingClientRect().height)),
        maximumHeight: Math.max(...buttons.map(button => button.getBoundingClientRect().height)),
        slotHeightVariance: Math.max(...slotHeights) - Math.min(...slotHeights),
      };
    });
    expect(audit).toMatchObject({ bodyOverflow: false, dockOverflow: false, slotHeightVariance: 0 });
    expect(audit.minimumWidth).toBeGreaterThanOrEqual(44);
    expect(audit.minimumHeight).toBeGreaterThanOrEqual(36);
    expect(audit.maximumHeight).toBeLessThanOrEqual(36.5);
    await page.screenshot({ path: path.join(screenshotDir, `${viewport.width}-five-forged-direct-controls.png`), fullPage: true });
  }

  await page.setViewportSize({ width: 430, height: 932 });
  await page.getByTestId('furnace-action-0').click();
  await expect(page.getByTestId('furnace-action-0')).toHaveAttribute('data-action-remaining', '4');
  expect(await page.getByTestId('furnace-action-0').evaluate(element =>
    Number(getComputedStyle(element).getPropertyValue('--die-action-progress')))).toBe(.8);
  await expect(page.locator('.die.is-die-selected')).toHaveCount(0);
  await expect.poll(async () => (await readRunState(page))?.gold).toBe(19);
  await page.getByTestId('flame-die-0').getByRole('button', { name: /View details/ }).click();
  const details = page.getByTestId('die-details-modal');
  await expect(details.locator('.die-details-actions')).toHaveCount(0);
  await expect(details).toContainText('0 / 2');
  await expect(details).toContainText('1 / 5');
  await expect(page.getByTestId('furnace-action-0')).toBeDisabled();
  await expect(page.getByTestId('furnace-action-0')).toHaveAccessibleName(/4 of 5 feeds remaining.*temporarily unavailable/i);
  expect(await page.getByTestId('furnace-action-0').evaluate(element =>
    Number(getComputedStyle(element).getPropertyValue('--die-action-progress')))).toBe(.8);
  await page.screenshot({ path: path.join(screenshotDir, '430-informational-die-details.png'), fullPage: true });

  const seven = sevenForgedDice();
  await installRunState(page, seven);
  await enterRun(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.locator('[data-testid^="chameleon-action-"]')).toHaveCount(7);
  const sevenAudit = await page.getByTestId('dice-dock').evaluate(element => ({
    bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    dockOverflowPixels: element.scrollWidth - element.clientWidth,
    dockWidth: element.clientWidth,
    dockScrollWidth: element.scrollWidth,
    minimumWidth: Math.min(...[...element.querySelectorAll<HTMLElement>('.die-direct-action')]
      .map(button => button.getBoundingClientRect().width)),
    minimumHeight: Math.min(...[...element.querySelectorAll<HTMLElement>('.die-direct-action')]
      .map(button => button.getBoundingClientRect().height)),
    actionSlotHeights: [...element.querySelectorAll<HTMLElement>('.die-direct-action-slot')]
      .map(slot => slot.getBoundingClientRect().height),
  }));
  expect(sevenAudit.bodyOverflow).toBe(false);
  expect(sevenAudit.dockOverflowPixels, JSON.stringify(sevenAudit)).toBeLessThanOrEqual(1);
  expect(sevenAudit.minimumWidth).toBeGreaterThanOrEqual(44);
  expect(sevenAudit.minimumHeight).toBeGreaterThanOrEqual(36);
  expect(new Set(sevenAudit.actionSlotHeights).size).toBe(1);
  await page.screenshot({ path: path.join(screenshotDir, '320-seven-forged-direct-controls.png'), fullPage: true });
});

test('Magic and Lightning use sequential cancellable modals and preserve selections on Back', async ({ page }) => {
  const state = newRun('magic-lightning-sequence').state;
  state.target = 1_000_000n;
  state.manualRerollsRemaining = 3;
  for (const die of rosterDice(state).slice(0, 2)) die.effects = [createDieEffect(die.id, 'magic', 2)];
  syncActiveDiceProjection(state);
  state.dieRoundState = resetDieRoundState(rosterDice(state));
  placeFlameInstance(state, 'lightningStrike', 100);
  recalculateMaxCharge(state);
  await installRunState(page, state);
  await enterRun(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByTestId('flame-die-0').locator('.die').click();
  await page.getByTestId('flame-die-1').locator('.die').click();
  await page.getByTestId('manual-reroll').click();

  const magic = page.getByRole('dialog', { name: /Magic/ });
  await expect(magic).toBeVisible();
  await magic.getByRole('button', { name: 'Force die 1 to 6' }).click();
  await magic.getByRole('button', { name: 'Force die 2 to 5' }).click();
  await page.screenshot({ path: path.join(screenshotDir, '768-magic-multiple-dice.png'), fullPage: true });
  await magic.getByRole('button', { name: 'CONTINUE TO LIGHTNING' }).click();

  const lightning = page.getByRole('dialog', { name: /Lightning Strike/ });
  await expect(lightning).toBeVisible();
  await expect(page.getByTestId('lightning-prediction-0').locator('.die')).toHaveAttribute('aria-label', /face 6/);
  await expect(page.getByTestId('lightning-prediction-1').locator('.die')).toHaveAttribute('aria-label', /face 5/);
  await page.screenshot({ path: path.join(screenshotDir, '768-magic-then-lightning.png'), fullPage: true });
  await lightning.getByRole('button', { name: 'BACK' }).click();
  await expect(magic.getByRole('button', { name: 'Force die 1 to 6' })).toHaveAttribute('aria-pressed', 'true');
  await magic.getByRole('button', { name: 'CONTINUE TO LIGHTNING' }).click();
  await lightning.getByRole('button', { name: 'CANCEL' }).click();
  await expect(page.getByTestId('manual-reroll')).toBeFocused();

  await expect.poll(async () => (await readRunState(page))?.manualRerollsRemaining).toBe(3);
  const cancelled = await readRunState(page);
  expect(effectRuntime(cancelled!.dieRoundState[0], effectOf(cancelled!.diceInventory.instances[0], 'magic'))?.invocationsRemaining).toBe(2);
  expect(effectRuntime(cancelled!.dieRoundState[1], effectOf(cancelled!.diceInventory.instances[1], 'magic'))?.invocationsRemaining).toBe(2);

  await page.getByTestId('manual-reroll').click();
  await expect(magic).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(magic).toHaveCount(0);
  await expect(page.getByTestId('manual-reroll')).toBeFocused();
});
