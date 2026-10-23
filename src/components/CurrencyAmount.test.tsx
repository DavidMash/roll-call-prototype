import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CurrencyAmount } from './CurrencyAmount';

describe('CurrencyAmount', () => {
  it('uses distinct letter symbols while retaining full accessible currency names', () => {
    const gold = renderToStaticMarkup(<CurrencyAmount currency="gold" value={97} />);
    const temper = renderToStaticMarkup(<CurrencyAmount currency="temper" value={14} />);
    expect(gold).toContain('aria-label="97 Gold"');
    expect(gold).toContain('currency-symbol">G<');
    expect(temper).toContain('aria-label="14 Temper"');
    expect(temper).toContain('currency-symbol">T<');
    expect(`${gold}${temper}`).not.toMatch(/[●◆]/);
  });
});
