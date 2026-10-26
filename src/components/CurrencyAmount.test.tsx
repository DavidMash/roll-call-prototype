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
    expect(gold.indexOf('currency-value">97')).toBeLessThan(gold.indexOf('currency-symbol">G'));
    expect(temper.indexOf('currency-value">14')).toBeLessThan(temper.indexOf('currency-symbol">T'));
  });

  it('keeps signs before the amount and the currency suffix after it', () => {
    const gain = renderToStaticMarkup(<CurrencyAmount currency="gold" value={5} sign="+" />);
    const spend = renderToStaticMarkup(<CurrencyAmount currency="temper" value={3} sign="−" />);
    expect(gain).toContain('aria-label="plus 5 Gold"');
    expect(gain).toContain('currency-value">+5</span><span class="currency-symbol">G');
    expect(spend).toContain('aria-label="minus 3 Temper"');
    expect(spend).toContain('currency-value">−3</span><span class="currency-symbol">T');
  });
});
