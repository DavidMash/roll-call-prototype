export function formatEffectLevel(level: number): string {
  const value = Math.max(1, Math.floor(level));
  if (value > 20) return String(value);
  const table: [number, string][] = [
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let remaining = value;
  let result = '';
  while (remaining > 0) {
    const [amount, numeral] = table.find(([amount]) => amount <= remaining)!;
    result += numeral;
    remaining -= amount;
  }
  return result;
}
