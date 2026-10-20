import { expect, test } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { Resolver } from '../src/game/effects';
import { RUN_STORAGE_KEY } from '../src/game/persistence';
import type { GameState, Rank } from '../src/game/types';
import { enterRun, goToShopStage, installRunState } from './uiHelpers';

const fixed = { next: () => .2 };

function shopState(seed: string): GameState {
  const state = newRun(seed, fixed).state;
  state.gold = 100;
  new Resolver(state, fixed).openShop();
  state.shop!.exitUnlocked = true;
  return state;
}

function setType(state: GameState, id: number, type: GameState['diceInventory']['instances'][number]['type'], level = 1) {
  Object.assign(state.diceInventory.instances[id], { type, level, vintageAppreciation: 0 });
}

function setValues(state: GameState, values: Rank[]) {
  values.forEach((value, index) => {
    state.diceInventory.instances[index].value = value;
    const projected = state.dice.find(die => die.id === index);
    if (projected) projected.value = value;
  });
}

async function persisted(page: import('@playwright/test').Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, RUN_STORAGE_KEY) as Promise<GameState>;
}

test('Shop click movement, roster sale warning, and pre-Round warning are explicit', async ({ page }) => {
  await installRunState(page, shopState('stage4-click-sale'));
  await enterRun(page);
  const first = page.getByTestId('collection-slot-roster-0');
  const second = page.getByTestId('collection-slot-roster-1');
  await first.locator('.collection-slot-main').click();
  await second.locator('.collection-slot-main').click();
  await expect(first).toHaveAttribute('data-die-id', '1');
  await expect(second).toHaveAttribute('data-die-id', '0');

  await first.getByRole('button', { name: 'SELL' }).click();
  const sale = page.getByRole('dialog', { name: 'SELL DIE?' });
  await expect(sale).toContainText('EMPTY ROSTER SLOT');
  await expect(sale).toContainText('only 4 dice equipped');
  await sale.getByRole('button', { name: 'SELL ANYWAY' }).click();
  await expect(first.getByRole('button', { name: /Roster 1, empty/ })).toBeVisible();

  await goToShopStage(page, 'fireKeeping');
  await page.getByRole('button', { name: 'NEXT ROUND', exact: true }).click();
  const warning = page.getByRole('dialog', { name: 'ONLY 4 OF 5 DICE EQUIPPED' });
  await expect(warning).toContainText('Some hands may be impossible');
  await warning.getByRole('button', { name: 'GO BACK' }).click();
  await expect(page.getByTestId('shop-stage-training')).toHaveAttribute('data-active', 'true');
});

test('Weighted configuration is an owned-die Shop action and survives the details modal', async ({ page }) => {
  const state = shopState('stage4-weighted');
  setType(state, 0, 'weighted', 2);
  await installRunState(page, state);
  await enterRun(page);
  const slot = page.getByTestId('collection-slot-roster-0');
  await slot.getByRole('button', { name: 'INFO' }).click();
  const details = page.getByRole('dialog', { name: 'DIE DETAILS' });
  await expect(details).toContainText('WEIGHTED FACE · 6');
  await details.getByRole('button', { name: '4', exact: true }).click();
  await expect(details).toContainText('WEIGHTED FACE · 4');
  expect((await persisted(page)).diceInventory.instances[0].weightedFace).toBe(4);
});

test('Magic and Furnace controls expose armed state, free disarm, Invocations, and Furnace power', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = newRun('stage4-command-controls', fixed).state;
  state.gold = 7;
  setType(state, 0, 'magic', 2);
  setType(state, 1, 'furnace', 2);
  setType(state, 2, 'flywheel', 2);
  setType(state, 3, 'chameleon', 2);
  setType(state, 4, 'jumpingBean', 2);
  await installRunState(page, state);
  await enterRun(page);
  await expect(page.getByTestId('special-dice-controls')).toHaveCount(0);

  await page.getByTestId('flame-die-0').getByRole('button', { name: 'View details for Magic' }).click();
  let details = page.getByRole('dialog', { name: 'MAGIC · LV2' });
  await expect(details).toContainText(/Uses remaining\s*2 \/ 2/);
  await details.getByRole('button', { name: 'Arm Magic die 0 for face 6' }).click();
  await expect(details).toContainText(/Next Reroll\s*6/);
  await page.screenshot({ path: test.info().outputPath('magic-armed-details-mobile.png'), fullPage: true });
  let saved = await persisted(page);
  expect(saved.dieRoundState[0].magicArmedFace).toBe(6);
  expect(saved.dieRoundState[0].invocationsRemaining).toBe(2);
  await details.getByRole('button', { name: 'DISARM MAGIC' }).click();
  await expect(details).toContainText(/Next Reroll\s*Not armed/);
  saved = await persisted(page);
  expect(saved.dieRoundState[0].magicArmedFace).toBeNull();
  expect(saved.dieRoundState[0].invocationsRemaining).toBe(2);
  await details.getByRole('button', { name: 'Close' }).click();

  await page.getByTestId('flame-die-1').getByRole('button', { name: 'View details for Furnace' }).click();
  details = page.getByRole('dialog', { name: 'FURNACE · LV2' });
  await expect(details).toContainText(/Fed Gold\s*0 \/ 5/);
  await expect(details).toContainText(/Current bonus\s*\+0 Pips/);
  await details.getByRole('button', { name: 'FEED 1 GOLD' }).click();
  await expect(details).toContainText(/Fed Gold\s*1 \/ 5/);
  await expect(details).toContainText(/Current bonus\s*\+6 Pips/);
  saved = await persisted(page);
  expect(saved.dieRoundState[1].furnaceUnits).toBe(1);
  expect(saved.gold).toBe(6);
  await details.getByRole('button', { name: 'Close' }).click();

  for (const [id, name] of [[3, 'Chameleon'], [2, 'Flywheel'], [4, 'Jumping Bean']] as const) {
    await page.getByTestId(`flame-die-${id}`).getByRole('button', { name: `View details for ${name}` }).click();
    details = page.getByRole('dialog', { name: new RegExp(`${name.toUpperCase()} .* LV2`) });
    await expect(details.getByRole('button', { name: 'USE ON COMMAND' })).toBeEnabled();
    await details.getByRole('button', { name: 'USE ON COMMAND' }).click();
    await expect(details).toHaveCount(0);
  }
  saved = await persisted(page);
  expect(saved.dieRoundState[2].invocationsRemaining).toBe(1);
  expect(saved.dieRoundState[3].invocationsRemaining).toBe(1);
  expect(saved.dieRoundState[4].invocationsRemaining).toBe(1);
});

test('ambiguous qualification previews spend nothing and let the player choose the exact die', async ({ page }) => {
  const state = newRun('stage4-qualification', fixed).state;
  setType(state, 0, 'mirror');
  setType(state, 1, 'mirror');
  setValues(state, [1, 2, 3, 4, 5]);
  await installRunState(page, state);
  await enterRun(page);

  await page.getByTestId('flame-die-0').locator('.die').click();
  await page.getByTestId('flame-die-1').locator('.die').click();
  await page.getByTestId('scorecard-row-pair').click();
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  let chooser = page.getByRole('dialog', { name: 'HOW SHOULD THIS HAND QUALIFY?' });
  await expect(chooser.getByRole('button', { name: /Mirror · Roster 1 · Lv1/ })).toBeVisible();
  await expect(chooser.getByRole('button', { name: /Mirror · Roster 2 · Lv1/ })).toBeVisible();
  await chooser.getByRole('button', { name: 'CANCEL' }).click();

  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  chooser = page.getByRole('dialog', { name: 'HOW SHOULD THIS HAND QUALIFY?' });
  await expect(chooser.getByRole('button', { name: /Mirror · Roster 1 · Lv1.*1 Invocation remaining/ })).toBeVisible();
  await expect(chooser.getByRole('button', { name: /Mirror · Roster 2 · Lv1.*1 Invocation remaining/ })).toBeVisible();
  await chooser.getByRole('button', { name: /Mirror · Roster 2 · Lv1/ }).click();
  await expect(chooser).toHaveCount(0);
  const saved = await persisted(page);
  expect(saved.dieRoundState[0].invocationsRemaining).toBe(1);
  expect(saved.dieRoundState[1].invocationsRemaining).toBe(0);
});
