import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { newRun } from '../game/engine';
import { Resolver } from '../game/effects';
import { rosterDice } from '../game/inventory';
import { placeFlameInstance } from '../game/flames';
import type { GameState } from '../game/types';
import { Die } from './Die';
import { ShopScreen } from './ShopScreen';
import { CollectibleDieVisual } from './CollectibleDieVisual';
import { createDieEffect } from '../game/specialDice';
import { DieEffectsLabel, DieTypeLabel } from './DieTypeLabel';

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
  it('omits level I, removes the separator at II+, and compacts multi-effect labels to icons', () => {
    expect(wrap(<DieTypeLabel type="weighted" level={1} />)).toContain('>Weighted<');
    expect(wrap(<DieTypeLabel type="weighted" level={1} />)).not.toContain('·');
    expect(wrap(<DieTypeLabel type="weighted" level={2} />)).toContain('Weighted II');
    const compact = wrap(<DieEffectsLabel compact effects={[createDieEffect(1, 'weighted'), createDieEffect(1, 'bonus', 2)]} />);
    expect(compact).toContain('die-effects-label compact');
    expect(compact).toContain('compact-effect-level');
    expect(compact).toContain('aria-label="Weighted + Bonus II"');
    expect(compact).not.toContain('>Weighted<');
  });

  it('leaves Normal dice unlabeled while naming special dice without a side-count suffix', () => {
    const state = newRun('die-presentation', fixed).state;
    const normal = state.dice[0];
    const props = { rosterSlot: 0, display: 'pips' as const, selected: false, highlighted: false, rolling: false,
      disabled: false, onClick: () => {}, onDetails: () => {} };
    const normalHtml = wrap(<Die die={normal} {...props} />);
    expect(normalHtml).not.toContain('FACES');
    expect(normalHtml).not.toContain('Normal D6');
    expect(normalHtml).not.toContain('>NORMAL<');

    const golden = { ...normal, effects: [createDieEffect(normal.id, 'golden')] };
    const specialHtml = wrap(<Die die={golden} {...props} />);
    expect(specialHtml).toContain('Golden');
    expect(specialHtml).toContain('die-type-icon');
    expect(specialHtml).not.toContain('Golden D6');
  });

  it('keeps special identity outside the pip field and uses the shared selected primitive', () => {
    const specialVisual = wrap(<CollectibleDieVisual effects={[createDieEffect(5, 'magnetic')]} face={5} />);
    expect(specialVisual).toContain('data-effect-count="1"');
    expect(specialVisual).not.toContain('collectible-die-mark');
    expect(specialVisual.match(/class="pip pip-/g)).toHaveLength(5);

    const state = newRun('selected-presentation', fixed).state;
    const props = { rosterSlot: 0, display: 'pips' as const, highlighted: false, rolling: false,
      disabled: false, onClick: () => {}, onDetails: () => {} };
    expect(wrap(<Die die={state.dice[0]} {...props} selected />)).toContain('is-die-selected');
    expect(wrap(<Die die={{ ...rosterDice(state)[0], effects: [createDieEffect(0, 'magic')] }} {...props} selected />)).toContain('is-die-selected');
    expect(wrap(<Die die={state.dice[0]} {...props} selected={false} />)).not.toContain('is-die-selected');
  });

  it('renders three die-first offers plus aligned five-slot Storage and Roster rows', () => {
    const html = shopMarkup(openShop('compact-dice-shop'));
    expect(html.match(/class="[^"]*dice-offer /g)).toHaveLength(3);
    expect(html.match(/class="[^"]*collectible-die-visual/g)).toHaveLength(8);
    expect(html.match(/data-testid="collection-slot-storage-/g)).toHaveLength(5);
    expect(html.match(/data-testid="collection-slot-roster-/g)).toHaveLength(5);
    expect(html).toContain('data-testid="storage-strip"');
    expect(html).toContain('data-testid="shop-roster-dock"');
    expect(html).toContain('role="tablist"');
    expect(html).not.toMatch(/\bD6\b/);
    // Three Buy totals + one offer-reroll total; the other five are legitimate sale values.
    expect(html.match(/currency-amount currency-gold/g)).toHaveLength(9);
    expect(html).not.toContain('dice-offer-price');
  });

  it('keeps each unaffordable offer total on its disabled Buy button without shortage copy', () => {
    const state = openShop('unaffordable-dice-shop');
    state.gold = 0;
    const html = shopMarkup(state);
    for (const offer of state.shop!.offers) {
      expect(html).toContain(`Buy die for ${offer.price} Gold, unavailable`);
      expect(html).toContain(`currency-value">${offer.price}</span><span class="currency-symbol">G`);
    }
    expect(html).not.toContain('NEED ');
  });
});

describe('responsive Shop-stage presentation', () => {
  it('uses the compact unordered Forge equation and consistent Back-to-Shop copy', () => {
    const state = openShop('forge-presentation');
    state.temper = 10; state.forgeUnlocked = true; state.shop!.stage = 'forge';
    state.diceInventory.instances[0].effects = [createDieEffect(0, 'bonus')];
    state.shop!.forgeSelection = { dieAId: 0, dieBId: 1 };
    const html = shopMarkup(state);
    expect(html).toContain('Choose two dice to combine');
    expect(html).not.toContain('INGREDIENT 1');
    expect(html).not.toContain('INGREDIENT 2');
    expect(html).not.toContain('TRUE FORGE');
    expect(html).not.toContain('FUSION');
    expect(html).toContain('data-testid="forge-result-preview"');
    expect(html).toContain('FORGE <span');
    expect(html).toContain('BACK TO SHOP');
    expect(html).not.toContain('shop-stage-gold');
    expect(html).not.toContain('shop-stage-temper');
  });

  it('uses a two-section scorecard for all fourteen Training hands', () => {
    const state = openShop('training-presentation');
    state.shop!.stage = 'train';
    const html = shopMarkup(state);
    expect(html).toContain('class="scorecard-grid"');
    expect(html.match(/data-testid="training-offer-/g)).toHaveLength(14);
    expect(html).toContain('Baseline · Lv. 1');
    expect(html).not.toContain('PIPS');
    expect(html).toContain('MULT');
    expect(html).toContain('TRAIN <span');
    expect(html).not.toContain('Frozen baseline');
  });

  it('omits Fire Keeping without Flames and renders only owned Flames when present', () => {
    const empty = openShop('empty-fire-keeping');
    empty.shop!.stage = 'train';
    const emptyHtml = shopMarkup(empty);
    expect(emptyHtml).not.toContain('shop-stage-fire-keeping');
    expect(emptyHtml).not.toContain('CONTINUE TO FIRE KEEPING');
    expect(emptyHtml).toContain('NEXT ROUND');

    const owned = openShop('owned-fire-keeping');
    const flame = placeFlameInstance(owned, 'doubleDown', 25, 3);
    owned.shop!.stage = 'flames';
    const ownedHtml = shopMarkup(owned);
    expect(ownedHtml).toContain(`fire-keeping-flame-${flame.instanceId}`);
    expect(ownedHtml.match(/class="[^"]*fire-keeping-card/g)).toHaveLength(1);
    expect(ownedHtml).not.toContain('FLAME SLOT');
    expect(ownedHtml).not.toContain('>EMPTY<');
    expect(ownedHtml).not.toContain('global Flames');
    expect(ownedHtml).not.toContain('written conditions');
  });
});
