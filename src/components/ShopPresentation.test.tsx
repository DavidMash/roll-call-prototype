import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { newRun } from '../game/engine';
import { Resolver } from '../game/effects';
import { placeFlameInstance } from '../game/flames';
import type { GameState } from '../game/types';
import { Die } from './Die';
import { ShopScreen } from './ShopScreen';

const fixed = { next: () => .2 };
const wrap = (node: React.ReactNode) => renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);

function openShop(seed: string): GameState {
  const state = newRun(seed, fixed).state;
  state.gold = 100;
  new Resolver(state, fixed).openShop();
  state.shop!.exitUnlocked = true;
  return state;
}

function shopMarkup(state: GameState): string {
  return wrap(<ShopScreen board={state} inventory={state.diceInventory} event={null} busy={false}
    submit={() => {}} skip={() => {}} openFlameDetails={() => {}} />);
}

describe('collectible Dice presentation', () => {
  it('leaves Normal dice unlabeled while naming special dice without a side-count suffix', () => {
    const state = newRun('die-presentation', fixed).state;
    const normal = state.dice[0];
    const props = { rosterSlot: 0, display: 'pips' as const, selected: false, highlighted: false, rolling: false,
      disabled: false, onClick: () => {}, onDetails: () => {} };
    const normalHtml = wrap(<Die die={normal} {...props} />);
    expect(normalHtml).not.toContain('FACES');
    expect(normalHtml).not.toContain('Normal D6');
    expect(normalHtml).not.toContain('>NORMAL<');

    const golden = { ...normal, type: 'golden' as const };
    const specialHtml = wrap(<Die die={golden} {...props} />);
    expect(specialHtml).toContain('>Golden<');
    expect(specialHtml).not.toContain('Golden D6');
  });

  it('renders three die-first offers plus horizontal Storage and one five-slot Roster', () => {
    const html = shopMarkup(openShop('compact-dice-shop'));
    expect(html.match(/class="[^"]*dice-offer rarity-/g)).toHaveLength(3);
    expect(html.match(/class="[^"]*collectible-die-visual/g)).toHaveLength(8);
    expect(html).toContain('data-testid="storage-strip"');
    expect(html).toContain('data-testid="shop-roster-dock"');
    expect(html).not.toMatch(/\bD6\b/);
  });
});

describe('responsive Shop-stage presentation', () => {
  it('uses a two-section scorecard for all fourteen Training hands', () => {
    const state = openShop('training-presentation');
    state.shop!.stage = 'training';
    const html = shopMarkup(state);
    expect(html).toContain('class="scorecard-grid"');
    expect(html.match(/data-testid="training-offer-/g)).toHaveLength(14);
    expect(html).toContain('Baseline · Lv. 1');
    expect(html).not.toContain('Frozen baseline');
  });

  it('omits Fire Keeping without Flames and renders only owned Flames when present', () => {
    const empty = openShop('empty-fire-keeping');
    empty.shop!.stage = 'training';
    const emptyHtml = shopMarkup(empty);
    expect(emptyHtml).not.toContain('shop-stage-fire-keeping');
    expect(emptyHtml).not.toContain('CONTINUE TO FIRE KEEPING');
    expect(emptyHtml).toContain('NEXT ROUND');

    const owned = openShop('owned-fire-keeping');
    const flame = placeFlameInstance(owned, 'doubleDown', 25, 3);
    owned.shop!.stage = 'fireKeeping';
    const ownedHtml = shopMarkup(owned);
    expect(ownedHtml).toContain(`fire-keeping-flame-${flame.instanceId}`);
    expect(ownedHtml.match(/class="[^"]*fire-keeping-card/g)).toHaveLength(1);
    expect(ownedHtml).not.toContain('FLAME SLOT');
    expect(ownedHtml).not.toContain('>EMPTY<');
    expect(ownedHtml).not.toContain('global Flames');
    expect(ownedHtml).not.toContain('written conditions');
  });
});
