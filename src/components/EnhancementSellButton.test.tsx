import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EnhancementSellButton } from './EnhancementSellButton';

const renderButton = (value: number, disabled = false) => renderToStaticMarkup(
  <MantineProvider><EnhancementSellButton value={value} disabled={disabled} ariaLabel={`Sell for ${value} Gold`} onClick={() => {}} /></MantineProvider>,
);

describe('EnhancementSellButton', () => {
  it.each([3, 18, 60])('renders %s Gold as a separate secondary line', value => {
    const html = renderButton(value);
    expect(html).toContain('enhancement-sell-button-label">Sell</span>');
    expect(html).toContain(`enhancement-sell-button-value">${value} Gold</span>`);
  });

  it('keeps the current sell value visible while disabled', () => {
    const html = renderButton(18, true);
    expect(html).toContain('disabled=""');
    expect(html).toContain('enhancement-sell-button-value">18 Gold</span>');
  });
});
