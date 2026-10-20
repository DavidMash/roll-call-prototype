import { activeFace } from './dice';
import { dieEffectDescription, dieSellBreakdown, fusionEffectSummary } from './diceEconomy';
import { invocationCapacity } from './specialDice';
import type { CollectibleDie, DieRoundRuntime, Rank } from './types';

export interface DieStatusRow {
  label: string;
  value: string;
}

export interface SpecialDieDetails {
  description: string;
  status: DieStatusRow[];
  freePlayRemaining: Record<Exclude<Rank, 7>, number> | null;
}

const invocations = (die: CollectibleDie, runtime: DieRoundRuntime | undefined): string =>
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
      status.push({ label: 'Uses remaining', value: invocations(die, runtime) });
      break;
    case 'weighted':
      status.push(
        { label: 'Weighted face', value: String(runtime?.weightedFace ?? die.weightedFace) },
        { label: 'Uses remaining', value: invocations(die, runtime) },
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
        { label: 'Target', value: String(activeFace(die).rank) },
        { label: 'Uses remaining', value: invocations(die, runtime) },
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
      status.push({ label: 'Wild uses remaining', value: invocations(die, runtime) });
      break;
    case 'missingLink':
      status.push({ label: 'Straight wild uses remaining', value: invocations(die, runtime) });
      break;
    case 'doubleTime':
      status.push({ label: 'Additional Score chance', value: fusionEffectSummary('doubleTime', level, level).before });
      break;
    case 'jumpingBean':
    case 'chameleon':
      status.push({ label: 'On Command uses remaining', value: invocations(die, runtime) });
      break;
    case 'flywheel':
      status.push({ label: 'Free Rerolls remaining', value: invocations(die, runtime) });
      break;
    case 'magic':
      status.push(
        { label: 'Uses remaining', value: invocations(die, runtime) },
        { label: 'Next Reroll', value: runtime?.magicArmedFace === null || runtime?.magicArmedFace === undefined
          ? 'Not armed' : String(runtime.magicArmedFace) },
      );
      break;
    case 'conjoined':
      status.push({ label: 'Extra matching uses remaining', value: invocations(die, runtime) });
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
      status.push({ label: 'Hand saves remaining', value: String(runtime?.invocationsRemaining ?? level) });
      break;
  }

  return { description: dieEffectDescription(die.type, level), status, freePlayRemaining };
}
