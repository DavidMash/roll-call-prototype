import { expect, test } from '@playwright/test';
import { newRun } from '../src/game/engine';
import { RUN_STORAGE_KEY, RUN_STORAGE_VERSION } from '../src/game/persistence';
import { initialSpecialOfferEffects, SPECIAL_OFFERS } from '../src/game/specialOffers';
import type { GameState } from '../src/game/types';
import { enterRun } from './uiHelpers';

async function installRun(page: import('@playwright/test').Page, state: GameState) {
  await page.evaluate(([key, version, saved]) => {
    localStorage.setItem(key, JSON.stringify({ version, state: saved }));
  }, [RUN_STORAGE_KEY, RUN_STORAGE_VERSION, state] as const);
  await page.reload();
  await expect(page.locator('main')).toBeVisible();
  await enterRun(page);
}

test('active Special Offers render compact responsive status badges with canonical details', async ({ page }) => {
  const seed = 'active-special-offer-status';
  const state = newRun(seed).state;
  Object.assign(state.specialOfferEffects, {
    onTheHouse: true,
    carePackageRerolls: 2,
    silence: true,
    taxEvasionRounds: 1,
    cashBonusRounds: 3,
    powerballRounds: 2,
    powerballAvailable: true,
    bottledFairyRounds: 2,
    bottledFairyTriggeredThisRound: true,
    badDreamRounds: 3,
  });

  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto(`/?seed=${seed}&speed=instant`);
  await installRun(page, state);

  const status = page.getByTestId('special-effects-status');
  await expect(status).toBeVisible();
  await expect(status).toContainText('SPECIAL EFFECTS');
  for (const [type, label] of [
    ['onTheHouse', 'On The House · Next Shop'],
    ['carePackage', 'Care Package · 2 Rerolls Left'],
    ['silence', 'Silence · Next Boss'],
    ['taxEvasion', 'Tax Evasion · 1 Round'],
    ['cashBonus', 'Cash Bonus · 3 Rounds'],
    ['powerball', 'Powerball · Ready · 2 Rounds'],
    ['bottledFairy', 'Bottled Fairy · 2 Rounds'],
    ['badDream', 'Bad Dream · 3 Rounds'],
  ] as const) {
    await expect(page.getByTestId(`special-effect-${type}`)).toHaveText(label);
  }

  const taxBadge = page.getByTestId('special-effect-taxEvasion');
  await taxBadge.hover();
  await expect(page.getByRole('tooltip')).toHaveText(SPECIAL_OFFERS.taxEvasion.description);

  const layout = await status.evaluate(element => {
    const box = element.getBoundingClientRect();
    const badges = element.querySelector<HTMLElement>('.special-effects-badges')!;
    return {
      insideViewport: box.left >= 0 && box.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth,
      compactHeight: box.height <= 28,
      horizontallyScrollable: badges.scrollWidth > badges.clientWidth,
    };
  });
  expect(layout).toEqual({ insideViewport: true, compactHeight: true, horizontallyScrollable: true });

  state.specialOfferEffects = initialSpecialOfferEffects();
  await installRun(page, state);
  await expect(page.getByTestId('special-effects-status')).toHaveCount(0);
});
