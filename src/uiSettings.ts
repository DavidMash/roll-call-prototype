export type DiceDisplay = 'numerals' | 'pips';

export const DICE_DISPLAY_STORAGE_KEY = 'roll-call:dice-display';

export function loadDiceDisplay(): DiceDisplay {
  try {
    const value = window.localStorage.getItem(DICE_DISPLAY_STORAGE_KEY);
    return value === 'pips' || value === 'numerals' ? value : 'numerals';
  } catch {
    return 'numerals';
  }
}

export function saveDiceDisplay(value: DiceDisplay): void {
  try {
    window.localStorage.setItem(DICE_DISPLAY_STORAGE_KEY, value);
  } catch {
    // The preference is nonessential when browser storage is unavailable.
  }
}
