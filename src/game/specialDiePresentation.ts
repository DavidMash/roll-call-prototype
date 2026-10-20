import {
  IconBarbell, IconCirclesRelation, IconClockBolt, IconClockCog, IconClover, IconCoin, IconCopy,
  IconFlame, IconHourglassHigh, IconJumpRope, IconLink, IconMagnet, IconPalette, IconPlayerPlay,
  IconPlus, IconRecycle, IconRefresh, IconRoute, IconScale, IconShield, IconUser, IconUsersGroup, IconWand,
  type Icon,
} from '@tabler/icons-react';
import { activeFace } from './dice';
import { dieEffectDescription, dieSellBreakdown, fusionEffectSummary } from './diceEconomy';
import { invocationCapacity } from './specialDice';
import type { CollectibleDie, DieRoundRuntime, DieType, Rank } from './types';

export interface SpecialDiePresentation {
  icon: Icon | null;
  accent: string;
  tint: string;
}

const identity = (icon: Icon | null, accent: string, tint: string): SpecialDiePresentation => ({ icon, accent, tint });

/** One visual identity registry shared by Shop, collection, Round, details, and Fusion UI. */
export const SPECIAL_DIE_PRESENTATION: Record<DieType, SpecialDiePresentation> = {
  normal: identity(null, '#adb5bd', 'rgba(173, 181, 189, .035)'),
  bonus: identity(IconPlus, '#ffd43b', 'rgba(255, 212, 59, .10)'),
  workout: identity(IconBarbell, '#ff922b', 'rgba(255, 146, 43, .10)'),
  vintage: identity(IconHourglassHigh, '#d6a756', 'rgba(214, 167, 86, .10)'),
  golden: identity(IconCoin, '#fcc419', 'rgba(252, 196, 25, .11)'),
  weighted: identity(IconScale, '#74c0fc', 'rgba(116, 192, 252, .10)'),
  clockwork: identity(IconClockCog, '#a5d8ff', 'rgba(165, 216, 255, .10)'),
  teamPlayer: identity(IconUsersGroup, '#63e6be', 'rgba(99, 230, 190, .10)'),
  loneWolf: identity(IconUser, '#ffa8a8', 'rgba(255, 168, 168, .10)'),
  hitchhiker: identity(IconRoute, '#94d82d', 'rgba(148, 216, 45, .10)'),
  magnetic: identity(IconMagnet, '#22b8cf', 'rgba(34, 184, 207, .10)'),
  jackpot: identity(IconClover, '#69db7c', 'rgba(105, 219, 124, .10)'),
  freePlay: identity(IconPlayerPlay, '#38d9a9', 'rgba(56, 217, 169, .10)'),
  chameleon: identity(IconPalette, '#e599f7', 'rgba(229, 153, 247, .10)'),
  flywheel: identity(IconRefresh, '#4dabf7', 'rgba(77, 171, 247, .10)'),
  tank: identity(IconShield, '#ff8787', 'rgba(255, 135, 135, .10)'),
  mirror: identity(IconCopy, '#b197fc', 'rgba(177, 151, 252, .10)'),
  missingLink: identity(IconLink, '#9775fa', 'rgba(151, 117, 250, .10)'),
  doubleTime: identity(IconClockBolt, '#91a7ff', 'rgba(145, 167, 255, .10)'),
  jumpingBean: identity(IconJumpRope, '#ff6b6b', 'rgba(255, 107, 107, .10)'),
  furnace: identity(IconFlame, '#ff6b35', 'rgba(255, 107, 53, .11)'),
  sustainable: identity(IconRecycle, '#20c997', 'rgba(32, 201, 151, .10)'),
  magic: identity(IconWand, '#da77f2', 'rgba(218, 119, 242, .11)'),
  conjoined: identity(IconCirclesRelation, '#f783ac', 'rgba(247, 131, 172, .10)'),
};

export interface DieStatusRow {
  label: string;
  value: string;
}

export interface SpecialDieDetails {
  description: string;
  status: DieStatusRow[];
  freePlayRemaining: Record<Exclude<Rank, 7>, number> | null;
}

const usesRemaining = (die: CollectibleDie, runtime: DieRoundRuntime | undefined): string =>
  `${runtime?.invocationsRemaining ?? invocationCapacity(die)} / ${invocationCapacity(die)}`;

/** Player-facing Round details derived from the same die/runtime values used by resolution. */
export function specialDieDetails(die: CollectibleDie, runtime: DieRoundRuntime | undefined): SpecialDieDetails {
  const level = die.level;
  const status: DieStatusRow[] = [];
  let freePlayRemaining: SpecialDieDetails['freePlayRemaining'] = null;

  switch (die.type) {
    case 'normal': break;
    case 'bonus':
      status.push({ label: 'Current bonus', value: `+${10 * level} Pips` });
      break;
    case 'workout':
      status.push(
        { label: 'Current bonus this Round', value: `+${runtime?.temporaryPips ?? 0} Pips` },
        { label: 'Gains per Score', value: `+${2 * level} Pips` },
      );
      break;
    case 'vintage': {
      const sale = dieSellBreakdown(die);
      status.push(
        { label: 'Current sell value', value: `${sale.total} Gold` },
        { label: 'Appreciation', value: `+${sale.vintageAppreciation} Gold` },
      );
      break;
    }
    case 'golden':
      status.push({ label: 'Gold earned this Round', value: `${runtime?.goldenGoldEarned ?? 0} / ${3 * level}` });
      break;
    case 'hitchhiker':
      status.push({ label: 'Uses Remaining', value: usesRemaining(die, runtime) });
      break;
    case 'weighted':
      status.push(
        { label: 'Weighted face', value: String(runtime?.weightedFace ?? die.weightedFace) },
        { label: 'Uses Remaining', value: usesRemaining(die, runtime) },
      );
      break;
    case 'clockwork': {
      const capacity = 3 * level;
      const used = runtime?.clockworkRolls ?? 0;
      status.push({ label: 'Controlled Rolls remaining', value: `${Math.max(0, capacity - used)} / ${capacity}` });
      if (used < capacity) status.push({ label: 'Next face', value: String(activeFace(die).rank % 6 + 1) });
      break;
    }
    case 'magnetic':
      status.push(
        { label: 'Matching Face', value: String(activeFace(die).rank) },
        { label: 'Uses Remaining', value: usesRemaining(die, runtime) },
      );
      break;
    case 'jackpot':
      status.push({ label: 'Winning-hand reward', value: `+${3 * level} Gold` });
      break;
    case 'teamPlayer':
      status.push({ label: 'Other played dice', value: `×${level + 1} Pips` });
      break;
    case 'loneWolf':
      status.push({ label: 'Scores when played alone', value: `×${level + 1}` });
      break;
    case 'tank':
      status.push(
        { label: 'Bonus this Round', value: `+${runtime?.temporaryPips ?? 0} Pips` },
        { label: 'Face locked', value: String(activeFace(die).rank) },
      );
      break;
    case 'freePlay':
      freePlayRemaining = Object.fromEntries(([1, 2, 3, 4, 5, 6] as const)
        .map(face => [face, Math.max(0, level - (runtime?.freePlayUsesByFace[face] ?? 0))])) as Record<Exclude<Rank, 7>, number>;
      break;
    case 'mirror':
      status.push({ label: 'Uses Remaining', value: usesRemaining(die, runtime) });
      break;
    case 'missingLink':
      status.push({ label: 'Uses Remaining', value: usesRemaining(die, runtime) });
      break;
    case 'doubleTime':
      status.push({ label: 'Additional Score chance', value: fusionEffectSummary('doubleTime', level, level).before });
      break;
    case 'jumpingBean':
    case 'chameleon':
      status.push({ label: 'Uses Remaining', value: usesRemaining(die, runtime) });
      break;
    case 'flywheel':
      status.push({ label: 'Uses Remaining', value: usesRemaining(die, runtime) });
      break;
    case 'magic':
      status.push(
        { label: 'Uses Remaining', value: usesRemaining(die, runtime) },
        { label: 'Next Reroll', value: runtime?.magicArmedFace === null || runtime?.magicArmedFace === undefined
          ? 'Not armed' : String(runtime.magicArmedFace) },
      );
      break;
    case 'conjoined':
      status.push({ label: 'Uses Remaining', value: usesRemaining(die, runtime) });
      break;
    case 'furnace': {
      const units = runtime?.furnaceUnits ?? 0;
      status.push(
        { label: 'Fed Gold', value: `${units} / 5` },
        { label: 'Current bonus', value: `+${units * 3 * level} Pips` },
      );
      break;
    }
    case 'sustainable':
      status.push({ label: 'Uses Remaining', value: usesRemaining(die, runtime) });
      break;
  }

  return { description: dieEffectDescription(die.type, level), status, freePlayRemaining };
}
