import { expect, test, type Page } from '@playwright/test';
import { dispatch, newRun } from '../src/game/engine';
import { RUN_STORAGE_KEY } from '../src/game/persistence';
import type { GameState } from '../src/game/types';
import { enterRun, installRunState } from './uiHelpers';

function r3SummaryState(seed: string): GameState {
  const state = newRun(seed, { next: () => .2 }).state;
  state.round = 27;
  state.presentedChapters = [1, 2, 3, 4, 5];
  state.phase = 'roundSummary';
  state.boss = null;
  state.roundSummary = {
    round: 27, encounterType: 'boss', bossType: 'juggler',
    score: 1_000, target: 1_000, goldBefore: 10, goldAfter: 15, totalGoldEarned: 5,
    sources: { baseRewardGold: 5, unusedRerollGold: 0, interestGold: 0, bossRewardGold: 0,
      goldenGold: 0, jackpotGold: 0, otherGold: 0 },
  };
  state.bonfires = ['ultimate', 'minigun', 'hailMary', 'fullOfGrace', 'vineyard'];
  state.bonfireContributions = {
    ultimate: { roundCount: 4, factorSum: 12 }, minigun: { roundCount: 3, factorSum: 6 },
  };
  state.hoodedFigure = {
    seen: true, previousChallengeId: 'theLongWay',
    active: {
      id: 'theLongWay', issuedChapter: 5, target: 3,
      committed: { value: 3, keys: [], invalid: false, jackpotPaid: false },
      attempt: { value: 3, keys: [], invalid: false, jackpotPaid: false },
      complete: true, dialogueLine: 'audit',
    },
    interaction: null,
    contributionCheckpoint: { ultimate: { roundCount: 1, factorSum: 2 } },
  };
  return state;
}

function stateOfferingTimeTravel(): GameState {
  for (let index = 0; index < 500; index++) {
    const state = r3SummaryState(`hooded-time-travel-${index}`);
    const opened = dispatch(state, { type: 'CONTINUE_ROUND_SUMMARY' }).state;
    if (opened.specialOffer?.offers.some(offer => offer.type === 'timeTravel')) return state;
  }
  throw new Error('Could not find deterministic Time Travel offer seed');
}

async function loadGame(page: Page, state: GameState) {
  await installRunState(page, state);
  await enterRun(page);
}

async function persistedState(page: Page): Promise<GameState> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state as GameState, RUN_STORAGE_KEY);
}

test('R3 normal order is Mini-Boss summary, Special Offer, Hooded return, then Shop', async ({ page }) => {
  await loadGame(page, r3SummaryState('hooded-normal-order'));
  await expect(page.getByRole('heading', { name: 'MINI-BOSS DEFEATED' })).toBeVisible();

  await page.getByRole('button', { name: /CONTINUE/ }).click();
  await expect(page.getByRole('heading', { name: 'SPECIAL OFFER' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Hooded Figure encounter' })).toHaveCount(0);
  const ordinaryOffer = page.locator('.special-offer-card').filter({ hasNotText: 'Time Travel' }).first();
  await ordinaryOffer.getByRole('button', { name: 'CHOOSE' }).click();
  await page.getByRole('button', { name: /CONTINUE/ }).click();

  const story = page.getByRole('dialog', { name: 'Hooded Figure encounter' });
  await expect(story).toContainText('The hooded figure approaches again.');
  const stateAtReturn = await persistedState(page);
  const types = stateAtReturn.history.map(record => record.type);
  expect(types.lastIndexOf('SPECIAL_OFFER_OPENED')).toBeLessThan(types.lastIndexOf('SPECIAL_OFFER_SELECTED'));
  expect(types.lastIndexOf('SPECIAL_OFFER_SELECTED')).toBeLessThan(types.lastIndexOf('HOODED_FIGURE_RETURNED'));

  await story.click(); await story.click(); await story.click();
  await expect(page.getByRole('dialog', { name: 'Create a Wildfire' })).toBeVisible();
  await page.getByRole('button', { name: 'Walk away' }).click();
  await page.getByRole('dialog', { name: 'Hooded Figure encounter' }).click();
  await expect(page.getByText('SHOP', { exact: true }).first()).toBeVisible();
});

test('R3 Time Travel rewinds before any Hooded return and restores the Chapter checkpoint', async ({ page }) => {
  const state = stateOfferingTimeTravel();
  await loadGame(page, state);
  await page.getByRole('button', { name: /CONTINUE/ }).click();
  await expect(page.getByRole('heading', { name: 'SPECIAL OFFER' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Hooded Figure encounter' })).toHaveCount(0);

  const timeTravel = page.locator('.special-offer-card').filter({ hasText: 'Time Travel' });
  await timeTravel.getByRole('button', { name: 'CHOOSE' }).click();
  await page.getByRole('button', { name: /CONTINUE/ }).click();
  await expect(page.getByTestId('challenge-tracker')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Hooded Figure encounter' })).toHaveCount(0);

  await page.getByRole('button', { name: 'About The Long Way challenge' }).click();
  const details = page.getByRole('dialog', { name: 'The Long Way', exact: true });
  await expect(details).toContainText('0 / 3');
  await expect(details).toContainText('3 Rounds Remaining');

  const rewound = await persistedState(page);
  expect(rewound.round).toBe(25);
  expect(rewound.hoodedFigure.active?.id).toBe('theLongWay');
  expect(rewound.hoodedFigure.active?.complete).toBe(false);
  expect(rewound.hoodedFigure.active?.committed.value).toBe(0);
  expect(rewound.hoodedFigure.interaction).toBeNull();
  expect(rewound.bonfireContributions).toEqual({ ultimate: { roundCount: 1, factorSum: 2 } });
  expect(rewound.history.some(record => record.type === 'HOODED_FIGURE_RETURNED')).toBe(false);
  expect(rewound.history.some(record => record.type === 'HOODED_CHALLENGE_TIME_TRAVEL_RESET')).toBe(true);
});
