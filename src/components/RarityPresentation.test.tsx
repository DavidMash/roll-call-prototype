import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { newRun } from '../game/engine';
import { EnhancementCard } from './EnhancementCard';
import { FlameSelectionScreen } from './FlameSelectionScreen';
import { SpecialOfferScreen } from './SpecialOfferScreen';

const wrap = (node: React.ReactNode) => renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);

describe('restrained rarity presentation', () => {
  it('labels and styles Common, Uncommon, and Rare Enhancement offers accessibly', () => {
    for (const [enhancement, rarity] of [['bonus', 'Common'], ['sticky', 'Uncommon'], ['mirror', 'Rare']] as const) {
      const html = wrap(<EnhancementCard offer={{ id: 1, enhancement, purchased: false }} selected={false}
        gold={100} busy={false} onSelect={() => {}} />);
      expect(html).toContain(`aria-label="${enhancement === 'bonus' ? 'Bonus' : enhancement === 'sticky' ? 'Sticky' : 'Mirror'}, ${rarity} Enhancement"`);
      expect(html).toContain(`rarity-${rarity.toLowerCase()}`);
      expect(html).toContain(`>${rarity}<`);
    }
  });

  it('labels Flame and Special Offer cards without adding rarity to owned compact badges', () => {
    const flameBoard = newRun('rarity-ui', { next: () => .5 }).state;
    flameBoard.phase = 'flameSelection';
    flameBoard.flameSelection = { offers: [
      { id: 1, flame: 'minigun' }, { id: 2, flame: 'ultimate' }, { id: 3, flame: 'powerSurge' },
    ], acquired: false };
    const flameHtml = wrap(<FlameSelectionScreen board={flameBoard} event={null} busy={false} selectedOffer={null}
      setSelectedOffer={() => {}} submit={() => {}} skip={() => {}} openFlameDetails={() => {}} />);
    expect(flameHtml).toContain('aria-label="Minigun, Common Flame"');
    expect(flameHtml).toContain('aria-label="Ultimate, Uncommon Flame"');
    expect(flameHtml).toContain('aria-label="Power Surge, Rare Flame"');

    const specialBoard = newRun('rarity-special-ui', { next: () => .5 }).state;
    specialBoard.phase = 'specialOffer';
    specialBoard.specialOffer = { offers: [
      { id: 1, type: 'carePackage' }, { id: 2, type: 'semester' }, { id: 3, type: 'timeTravel' },
    ], acquired: false };
    const specialHtml = wrap(<SpecialOfferScreen board={specialBoard} busy={false} submit={() => {}} />);
    expect(specialHtml).toContain('aria-label="Care Package, Common Special Offer"');
    expect(specialHtml).toContain('aria-label="Semester, Uncommon Special Offer"');
    expect(specialHtml).toContain('aria-label="Time Travel, Rare Special Offer"');
  });
});
