import { activeFace, weightedNumberProbability } from './dice';
import { dieEffectDescription, fusionEffectSummary } from './diceEconomy';
import { dieSellBreakdown } from './forge';
import { SPECIAL_DICE, effectRuntime, invocationCapacity } from './specialDice';
import type { CollectibleDie, DieEffectInstance, DieEffectRoundRuntime, DieRoundRuntime, SpecialDieType } from './types';
import { CONFIG } from './config';

export const saturationFactor = (level: number): number => Math.min(1, .8 + .03 * (Math.max(1, level) - 1));

function adjustedColor(hex: string, level: number): string {
  const raw = hex.replace('#', '');
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const delta = max - min;
  let s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  s *= saturationFactor(level);
  return `hsl(${h.toFixed(1)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

export const effectColor = (effect: DieEffectInstance): string => adjustedColor(SPECIAL_DICE[effect.type].color, effect.level);

export interface DieVisualPresentation {
  accent: string;
  tint: string;
  background: string;
}

export function dieVisualPresentation(die: Pick<CollectibleDie, 'effects'>): DieVisualPresentation {
  if (!die.effects.length) return { accent: '#adb5bd', tint: 'rgba(173, 181, 189, .035)', background: 'rgba(173, 181, 189, .035)' };
  const colors = die.effects.map(effectColor);
  const stops = colors.map((color, index) =>
    `color-mix(in srgb, ${color} 24%, #17191f) ${Math.round(index * 100 / (colors.length - 1))}%`);
  return {
    accent: colors[0],
    tint: `color-mix(in srgb, ${colors[0]} 12%, transparent)`,
    background: colors.length === 1
      ? `linear-gradient(145deg, color-mix(in srgb, ${colors[0]} 15%, #17191f), #17191f 72%)`
      : `linear-gradient(135deg, ${stops.join(', ')})`,
  };
}

export interface DieStatusRow { label: string; value: string }
export interface EffectDetails {
  description: string;
  status: DieStatusRow[];
}

const usesRemaining = (effect: DieEffectInstance, runtime: DieEffectRoundRuntime | undefined): string =>
  `${runtime?.invocationsRemaining ?? invocationCapacity(effect)} / ${invocationCapacity(effect)}`;

export function effectDetails(die: CollectibleDie, effect: DieEffectInstance,
  dieRuntime: DieRoundRuntime | undefined): EffectDetails {
  const level = effect.level;
  const runtime = effectRuntime(dieRuntime, effect);
  const status: DieStatusRow[] = [];
  switch (effect.type) {
    case 'basic': status.push({ label: 'Raw face Pips', value: `×${level}` }); break;
    case 'bonus': status.push({ label: 'Current bonus', value: `+${CONFIG.bonusPips * level} Pips` }); break;
    case 'workout': status.push({ label: 'Current bonus this Round', value: `+${runtime?.temporaryPips ?? 0} Pips` },
      { label: 'Gains per Score', value: `+${CONFIG.workoutPipsPerScore * level} Pips` }); break;
    case 'vintage': {
      const sale = dieSellBreakdown(die);
      status.push({ label: 'Current sell value', value: `${sale.total} Gold` },
        { label: 'Appreciation', value: `+${effect.persistent.vintageAppreciation} Gold` }); break;
    }
    case 'golden': status.push({ label: 'Gold earned this Round', value: `${runtime?.goldenGoldEarned ?? 0} / ${3 * level}` }); break;
    case 'hitchhiker': case 'mirror': case 'missingLink': case 'chameleon':
    case 'flywheel': case 'conjoined': case 'sustainable':
      status.push({ label: 'Uses Remaining', value: usesRemaining(effect, runtime) }); break;
    case 'weighted': {
      const number = effect.persistent.weightedFace;
      status.push({ label: 'Weighted Number', value: String(number) },
        { label: `Chance to Roll ${number}`, value: `${(weightedNumberProbability(die, number, level) * 100).toFixed(1)}%` });
      break;
    }
    case 'jumpingBean': status.push({ label: 'Jumping Bean Number', value: String(effect.persistent.jumpingBeanNumber) },
      { label: 'Uses Remaining', value: String(runtime?.invocationsRemaining ?? invocationCapacity(effect)) }); break;
    case 'clockwork': {
      const capacity = 3 * level, used = runtime?.clockworkRolls ?? 0;
      status.push({ label: 'Controlled Rolls remaining', value: `${Math.max(0, capacity - used)} / ${capacity}` });
      if (used < capacity) status.push({ label: 'Next face', value: String(activeFace(die).rank % 6 + 1) });
      break;
    }
    case 'magnetic': status.push({ label: 'Matching Face', value: String(activeFace(die).rank) },
      { label: 'Uses Remaining', value: usesRemaining(effect, runtime) }); break;
    case 'jackpot': status.push({ label: 'Winning-hand reward', value: `+${3 * level} Gold` }); break;
    case 'teamPlayer': status.push({ label: 'Other played dice', value: `×${level + 1} Pips` }); break;
    case 'loneWolf': status.push({ label: 'Scores when played alone', value: `×${level + 1}` }); break;
    case 'tank': status.push({ label: 'Bonus this Round', value: `+${runtime?.temporaryPips ?? 0} Pips` },
      { label: 'Face locked', value: String(activeFace(die).rank) }); break;
    case 'freePlay': status.push({ label: 'Manual Reroll Free Play', value: `×${level} die Pips` }); break;
    case 'doubleTime': status.push({ label: 'Additional Score chance', value: fusionEffectSummary('doubleTime', level, level).before }); break;
    case 'magic': status.push({ label: 'Uses Remaining', value: usesRemaining(effect, runtime) },
      { label: 'Next Reroll', value: runtime?.magicArmedFace == null ? 'Not armed' : String(runtime.magicArmedFace) }); break;
    case 'furnace': {
      const goldFed = runtime?.furnaceGoldFed ?? 0;
      status.push({ label: 'Gold fed this Round', value: `${goldFed} / ${CONFIG.furnaceMaxGoldPerRound}` },
        { label: 'Furnace reserve', value: `+${runtime?.furnacePips ?? 0} Pips` });
      break;
    }
  }
  return { description: dieEffectDescription(effect.type, level), status };
}

export const effectDefinition = (type: SpecialDieType) => SPECIAL_DICE[type];
