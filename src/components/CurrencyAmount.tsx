import { formatExactScore, formatPlayerNumber } from '../game/copy';

export type Currency = 'gold' | 'temper';

const PRESENTATION: Record<Currency, { symbol: 'G' | 'T'; name: 'Gold' | 'Temper' }> = {
  gold: { symbol: 'G', name: 'Gold' },
  temper: { symbol: 'T', name: 'Temper' },
};

export function CurrencyAmount({ currency, value, sign = '', accessible = true, className }: {
  currency: Currency;
  value: number | bigint;
  sign?: '' | '+' | '−';
  accessible?: boolean;
  className?: string;
}) {
  const presentation = PRESENTATION[currency];
  const formatted = typeof value === 'bigint' ? formatExactScore(value) : formatPlayerNumber(value);
  const spokenSign = sign === '+' ? 'plus ' : sign === '−' ? 'minus ' : '';
  return <span className={`currency-amount currency-${currency}${className ? ` ${className}` : ''}`}
    data-currency={currency} {...(accessible ? { 'aria-label': `${spokenSign}${formatted} ${presentation.name}` } : { 'aria-hidden': true })}>
    <span className="currency-value">{sign}{formatted}</span><span className="currency-symbol">{presentation.symbol}</span>
  </span>;
}
