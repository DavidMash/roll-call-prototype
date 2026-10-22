import { activeFace, wholeDieEffectSuppressed } from './dice';
import { lastPlayDanger } from './bosses';
import { HANDS, LOWER_HAND_IDS, ultimateHands, UPPER_HAND_IDS } from './hands';
import { finalizeScore, handScore, infernoMultiplier } from './scoring';
import type { Board, Flame, FlameInstance, FlameInstanceId, FlameSlotIndex, FlameSlots, GameState, HandId, Rarity, XMultFactor } from './types';
import { formatPlayerNumber } from './copy';
import type { ExactScore } from './scoreMath';
import type { RichText } from './richText';
import { flameVerboseDescription, plainDescription } from './effectDescriptions';
import { hasEffect } from './specialDice';

export interface FlameDefinition {
  name: string;
  shortName: string;
  description: string;
  verboseDescription: RichText;
  shortDescription?: string;
  bonfireDescription: string;
  affectsXMult: boolean;
  rarity: Rarity;
}
const GLOBAL_BONFIRE = 'At 100 Gold invested, this Flame reaches full strength.';
const flameDefinition = (id: Flame, name: string, shortName: string, rarity: Rarity,
  shortDescription?: string): FlameDefinition => {
  const verboseDescription = flameVerboseDescription(id);
  return { name, shortName, rarity, affectsXMult: true, description: plainDescription(verboseDescription),
    verboseDescription, ...(shortDescription ? { shortDescription } : {}), bonfireDescription: GLOBAL_BONFIRE };
};
export const FLAMES: Record<Flame, FlameDefinition> = {
  ultimate: flameDefinition('ultimate', 'Ultimate', 'ULT', 'uncommon', 'Your highest level hand gains up to ×5 XMult.'),
  minigun: flameDefinition('minigun', 'Minigun', 'MINI', 'common', 'Ones–Sixes gain up to ×5 XMult.'),
  hailMary: flameDefinition('hailMary', 'Hail Mary', 'HAIL', 'common', 'Hands played with no Rerolls left gain up to ×5 XMult.'),
  fullOfGrace: flameDefinition('fullOfGrace', 'Full of Grace', 'GRACE', 'common', 'Last Play gains up to ×5 XMult.'),
  momentum: flameDefinition('momentum', 'Momentum', 'MOM', 'common', 'Playing a hand builds Charge.'),
  thirdRail: flameDefinition('thirdRail', 'Third Rail', 'RAIL', 'uncommon', 'Rolling 3s builds Charge.'),
  jumpStart: flameDefinition('jumpStart', 'Jump Start', 'JUMP', 'uncommon', 'Rerolls build Charge.'),
  powerSurge: flameDefinition('powerSurge', 'Power Surge', 'SURGE', 'rare'),
  speedDemon: flameDefinition('speedDemon', 'Speed Demon', 'SPEED', 'rare', 'Play quickly for up to ×5 XMult.'),
  sixPack: flameDefinition('sixPack', 'Six Pack', 'SIX', 'rare'),
  fluxCapacitor: flameDefinition('fluxCapacitor', 'Flux Capacitor', 'FLUX', 'rare'),
  fatCat: flameDefinition('fatCat', 'Fat Cat', 'CAT', 'uncommon'),
  vineyard: flameDefinition('vineyard', 'Vineyard', 'VINE', 'uncommon'),
  fetch: flameDefinition('fetch', 'Fetch', 'FETCH', 'uncommon'),
  targetPractice: flameDefinition('targetPractice', 'Target Practice', 'TARGET', 'rare'),
  hotStreak: flameDefinition('hotStreak', 'Hot Streak', 'STREAK', 'uncommon'),
  lowball: flameDefinition('lowball', 'Lowball', 'LOW', 'common'),
  straightShooter: flameDefinition('straightShooter', 'Straight Shooter', 'STR8', 'uncommon'),
  doubleDown: flameDefinition('doubleDown', 'Double Down', 'DBL', 'uncommon'),
  threesCompany: flameDefinition('threesCompany', 'Three’s Company', 'THREE', 'uncommon'),
  boxSet: flameDefinition('boxSet', 'Box Set', 'BOX', 'uncommon'),
  missingPair: flameDefinition('missingPair', 'Missing Pair', 'MISS', 'common'),
  oneShort: flameDefinition('oneShort', 'One Short', 'SHORT', 'common'),
};
export const FLAME_IDS = Object.keys(FLAMES) as Flame[];
export const XMult_FLAME_IDS = FLAME_IDS.filter(flame => FLAMES[flame].affectsXMult);
export const CHARGE_FLAME_IDS = ['momentum', 'thirdRail', 'jumpStart', 'powerSurge', 'fluxCapacitor'] as const satisfies readonly Flame[];
export type ChargeFlame = typeof CHARGE_FLAME_IDS[number];
export const HAND_FAMILY_FLAMES = {
  doubleDown: { setup: 'pair', payoff: 'twoPair' },
  threesCompany: { setup: 'threeKind', payoff: 'fullHouse' },
  straightShooter: { setup: 'smallStraight', payoff: 'largeStraight' },
  boxSet: { setup: 'fourKind', payoff: 'fiveKind' },
} as const satisfies Partial<Record<Flame, { setup: HandId; payoff: HandId }>>;
export type HandFamilyFlame = keyof typeof HAND_FAMILY_FLAMES;
export const HAND_FAMILY_FLAME_IDS = Object.keys(HAND_FAMILY_FLAMES) as HandFamilyFlame[];
export const HOT_STREAK_SEQUENCE: HandId[] = ['pair', 'twoPair', 'threeKind', 'smallStraight', 'fullHouse', 'fourKind', 'largeStraight', 'fiveKind'];
export const flameProgress = (investedGold: number) => Math.max(0, Math.min(100, investedGold)) / 100;
export const standardFlameMultiplier = (investedGold: number) => 1 + 4 * flameProgress(investedGold);
export const targetPracticeMultiplier = (investedGold: number) => 1 + 8 * flameProgress(investedGold);
export const momentumChargeGain = (investedGold: number) => 0.5 * flameProgress(investedGold);
export const thirdRailChargeGain = (investedGold: number) => 0.5 * flameProgress(investedGold);
export const jumpStartChargeGain = (investedGold: number) => 2 * flameProgress(investedGold);
export const fluxCapacitorChargeMultiplier = (investedGold: number, pulledMagneticFaces: number) =>
  1 + Math.max(0, pulledMagneticFaces) * flameProgress(investedGold);
export const handFamilyFlameMultiplier = (investedGold: number) => 1 + 8 * flameProgress(investedGold);
export const speedDemonMultiplier = (investedGold: number, decisionMs: number) => {
  const strength = decisionMs <= 1000 ? 1 : Math.max(0, Math.min(1, (10000 - decisionMs) / 9000));
  return Number((1 + 4 * flameProgress(investedGold) * strength).toFixed(12));
};
export const sixPackStartingMultiplier = (investedGold: number) => 1 + 5 * flameProgress(investedGold);
export const sixPackMultiplierAfterUpperHands = (startingFactor: number, upperHandsPlayed: number) =>
  Number(Math.max(1, 1 + (Math.max(1, startingFactor) - 1) * (1 - Math.min(6, Math.max(0, upperHandsPlayed)) / 6)).toFixed(12));
export const maxChargeContribution = (investedGold: number) => 1 + 4 * flameProgress(investedGold);
export const hotStreakMultiplier = (investedGold: number, charges: number) => 1 + Math.max(0, charges) * flameProgress(investedGold);
export function lowballFullMultiplier(averageQualifyingFace: number): number {
  if (averageQualifyingFace <= 2) return 3;
  if (averageQualifyingFace <= 3) return 2.5;
  return 1;
}
export const lowballMultiplier = (investedGold: number, averageFace: number) =>
  1 + 2 * (lowballFullMultiplier(averageFace) - 1) * flameProgress(investedGold);
type FlameDisplayContext = Pick<Board, 'gold' | 'lifetimeNormalShopGoldSpent'>;
export function flameEffectText(id: Flame, investedGold: number, _board: FlameDisplayContext): string {
  switch (id) {
    case 'momentum': return `Each Play adds +${formatPlayerNumber(momentumChargeGain(investedGold))} Charge.`;
    case 'thirdRail': return `Each Rolled 3 adds +${formatPlayerNumber(thirdRailChargeGain(investedGold))} Charge.`;
    case 'jumpStart': return `Each Manual Reroll adds +${formatPlayerNumber(jumpStartChargeGain(investedGold))} Charge.`;
    case 'powerSurge': return 'Playing your highest-level Hand triples current Charge.';
    case 'fluxCapacitor': return `A Magnetic activation multiplies Charge by 1 + (${formatPlayerNumber(flameProgress(investedGold))} × other dice affected).`;
    case 'speedDemon': return `A sufficiently fast Play reaches ×${formatPlayerNumber(speedDemonMultiplier(investedGold, 0))} XMult.`;
    case 'sixPack': return `Each Round starts at ×${formatPlayerNumber(sixPackStartingMultiplier(investedGold))} XMult.`;
    case 'targetPractice': return `Target Hand gains ×${formatPlayerNumber(targetPracticeMultiplier(investedGold))} XMult.`;
    case 'fatCat': return `A scoring Golden or Jackpot face grants ×${formatPlayerNumber(standardFlameMultiplier(investedGold))} XMult.`;
    case 'vineyard': return `A scoring Vintage face grants ×${formatPlayerNumber(standardFlameMultiplier(investedGold))} XMult.`;
    case 'fetch': return `The marked FETCH face grants ×${formatPlayerNumber(standardFlameMultiplier(investedGold))} XMult, then moves.`;
    case 'hotStreak': return `A full top-to-bottom Lower Section Hand sequence reaches ×${formatPlayerNumber(hotStreakMultiplier(investedGold, HOT_STREAK_SEQUENCE.length))} XMult.`;
    case 'lowball': return `Scoring faces 1, 2, or 3 gain up to ×${formatPlayerNumber(lowballMultiplier(investedGold, 2))} XMult.`;
    case 'straightShooter':
    case 'doubleDown':
    case 'threesCompany':
    case 'boxSet': return `The payoff reaches ×${formatPlayerNumber(handFamilyFlameMultiplier(investedGold))} XMult after its setup hand.`;
    default: return `The condition grants ×${formatPlayerNumber(standardFlameMultiplier(investedGold))} XMult.`;
  }
}

export interface FlameDetailsPresentation {
  currentLabel: 'Current XMult' | 'Current Effect';
  currentValue: string;
  maxChargeContribution: number | null;
}

/** Player-facing numeric Flame state, derived exclusively from the authoritative Flame formulas above. */
export function flameDetailsPresentation(id: Flame, investedGold: number, board: Board): FlameDetailsPresentation {
  const investment = Math.max(0, Math.min(100, investedGold));
  if (isChargeFlame(id)) {
    const currentValue = id === 'momentum' ? `+${formatPlayerNumber(momentumChargeGain(investment))} Charge per Play`
      : id === 'thirdRail' ? `+${formatPlayerNumber(thirdRailChargeGain(investment))} Charge per Rolled 3`
        : id === 'jumpStart' ? `+${formatPlayerNumber(jumpStartChargeGain(investment))} Charge per Manual Reroll`
          : id === 'powerSurge' ? '×3 current Charge on highest-level Hand'
            : `×${formatPlayerNumber(fluxCapacitorChargeMultiplier(investment, 1))} Charge when 1 other die is affected`;
    return { currentLabel: 'Current Effect', currentValue,
      maxChargeContribution: maxChargeContribution(investment) };
  }
  if (id === 'hotStreak') {
    return { currentLabel: 'Current XMult',
      currentValue: `×${formatPlayerNumber(hotStreakMultiplier(investment, board.hotStreakCharges))} at current chain`,
      maxChargeContribution: null };
  }
  const multiplier = id === 'targetPractice' ? targetPracticeMultiplier(investment)
    : id === 'speedDemon' ? speedDemonMultiplier(investment, 0)
    : id === 'sixPack' ? sixPackStartingMultiplier(investment)
      : isHandFamilyFlame(id) ? handFamilyFlameMultiplier(investment)
        : id === 'lowball' ? lowballMultiplier(investment, 2)
          : standardFlameMultiplier(investment);
  return { currentLabel: 'Current XMult', currentValue: `up to ×${formatPlayerNumber(multiplier)}`,
    maxChargeContribution: null };
}

export function flameFullEffectText(id: Flame): string {
  return FLAMES[id].bonfireDescription;
}
export const isFlame = (value: unknown): value is Flame => typeof value === 'string' && Object.hasOwn(FLAMES, value);
export const emptyFlameSlots = (): FlameSlots => [null, null, null, null, null];
export const flameInstances = (state: Pick<Board, 'flameSlots'>): FlameInstance[] =>
  state.flameSlots.filter((flame): flame is FlameInstance => flame !== null);
export const flameInstanceById = (state: Pick<Board, 'flameSlots'>, instanceId: FlameInstanceId): FlameInstance | null =>
  flameInstances(state).find(flame => flame.instanceId === instanceId) ?? null;
export const flameSlotOf = (state: Pick<Board, 'flameSlots'>, instanceId: FlameInstanceId): FlameSlotIndex | null => {
  const index = state.flameSlots.findIndex(flame => flame?.instanceId === instanceId);
  return index < 0 ? null : index as FlameSlotIndex;
};
export const flameByType = (state: Pick<Board, 'flameSlots'>, type: Flame): FlameInstance | null =>
  flameInstances(state).find(flame => flame.type === type) ?? null;
export const flameInvestment = (flame: FlameInstance | null | undefined) =>
  Math.max(0, Math.min(100, flame?.investedGold ?? 0));

export interface FlameStokeLimits {
  remainingCapacity: number;
  affordableAmount: number;
  maximumAmount: number;
}

/** Shared investment limits used by both action validation and the Shop control. */
export function flameStokeLimits(state: Pick<Board, 'flameSlots' | 'gold'>,
  instanceId: FlameInstanceId): FlameStokeLimits {
  const flame = flameInstanceById(state, instanceId);
  const remainingCapacity = flame?.stage === 'ember' ? Math.max(0, 100 - flameInvestment(flame)) : 0;
  const affordableAmount = Math.max(0, Math.floor(state.gold));
  return { remainingCapacity, affordableAmount,
    maximumAmount: Math.min(remainingCapacity, affordableAmount) };
}

type FlameInstanceRuntime = Pick<Board, 'flameSlots' | 'nextFlameInstanceId'>;

export function normalizeFlameInstanceRuntime(state: FlameInstanceRuntime): void {
  if (!Array.isArray(state.flameSlots) || state.flameSlots.length !== 5) state.flameSlots = emptyFlameSlots();
  state.nextFlameInstanceId = Math.max(1, Math.floor(state.nextFlameInstanceId ?? 1));
  const normalized = emptyFlameSlots();
  const used = new Set<number>();
  const types = new Set<Flame>();
  for (let index = 0; index < state.flameSlots.length; index++) {
    const candidate = state.flameSlots[index];
    if (!candidate || !isFlame(candidate.type) || types.has(candidate.type)) continue;
    let instanceId = Number.isInteger(candidate.instanceId) && candidate.instanceId > 0 && !used.has(candidate.instanceId)
      ? candidate.instanceId : state.nextFlameInstanceId++;
    while (used.has(instanceId)) instanceId = state.nextFlameInstanceId++;
    const investedGold = flameInvestment(candidate);
    normalized[index as FlameSlotIndex] = { ...candidate, instanceId, investedGold,
      stage: investedGold >= 100 || candidate.stage === 'bonfire' ? 'bonfire' : 'ember' };
    used.add(instanceId); types.add(candidate.type);
  }
  state.flameSlots = normalized;
  if (used.size) state.nextFlameInstanceId = Math.max(state.nextFlameInstanceId, Math.max(...used) + 1);
}

export function currentFlameInstanceId(state: Pick<Board, 'flameSlots'>, flame: Flame): FlameInstanceId | null {
  return flameByType(state, flame)?.instanceId ?? null;
}

export function createFlameInstance(state: Pick<Board, 'nextFlameInstanceId'>, flame: Flame): FlameInstance {
  const instanceId = Math.max(1, Math.floor(state.nextFlameInstanceId));
  state.nextFlameInstanceId = instanceId + 1;
  return { instanceId, type: flame, investedGold: 0, stage: 'ember' };
}

/** Low-level authoritative placement used by acquisition and curated/debug fixtures. */
export function placeFlameInstance(state: Pick<Board, 'flameSlots' | 'nextFlameInstanceId'>,
  type: Flame, investedGold = 0, requestedSlot?: FlameSlotIndex): FlameInstance {
  if (flameByType(state, type)) throw new Error(`Flame type ${type} is already owned.`);
  const available = state.flameSlots.findIndex(slot => slot === null);
  const slot = requestedSlot ?? (available < 0 ? undefined : available as FlameSlotIndex);
  if (slot === undefined || slot < 0 || slot >= 5 || state.flameSlots[slot] !== null)
    throw new Error('Choose an empty Flame slot.');
  const instance = createFlameInstance(state, type);
  instance.investedGold = Math.max(0, Math.min(100, investedGold));
  instance.stage = instance.investedGold >= 100 ? 'bonfire' : 'ember';
  state.flameSlots[slot] = instance;
  return instance;
}

export function removeFlameInstance(state: Pick<Board, 'flameSlots'>, instanceId: FlameInstanceId): void {
  const slot = flameSlotOf(state, instanceId);
  if (slot !== null) state.flameSlots[slot] = null;
}
export const hasOwnedFlame = (state: Pick<Board, 'flameSlots'>, id: Flame) => flameByType(state, id) !== null;
export const isChargeFlame = (id: Flame | null | undefined): id is ChargeFlame =>
  id !== null && id !== undefined && (CHARGE_FLAME_IDS as readonly Flame[]).includes(id);
export const hasOwnedChargeFlame = (state: Pick<Board, 'flameSlots'>) => flameInstances(state).some(flame => isChargeFlame(flame.type));
export function calculateMaxCharge(state: Pick<Board, 'flameSlots'>): number {
  return Number(Math.max(1, flameInstances(state).reduce((sum, flame) => isChargeFlame(flame.type)
    ? sum + maxChargeContribution(flameInvestment(flame)) : sum, 0)).toFixed(12));
}
export function recalculateMaxCharge(state: Pick<Board, 'flameSlots' | 'chargeXMult' | 'maxCharge' | 'chargeArmed'>): void {
  state.maxCharge = calculateMaxCharge(state);
  state.chargeXMult = Number(Math.min(Math.max(1, state.chargeXMult), state.maxCharge).toFixed(12));
  if (state.chargeXMult <= 1) state.chargeArmed = false;
}
export const hasXMultFlame = (state: Pick<Board, 'flameSlots'>) =>
  flameInstances(state).some(flame => FLAMES[flame.type].affectsXMult);

export interface HandStartSnapshot {
  score: ExactScore;
  target: ExactScore;
  infernoMultiplier: ExactScore;
  gold: number;
  manualRerollsRemaining: number;
  previousPlays: number;
  ultimateHands: HandId[];
  targetPracticeHand: HandId | null;
  hotStreakGoal: HandId | null;
  hotStreakCharges: number;
  handFamilyFlameStages: Partial<Record<Flame, import('./types').HandFamilyFlameStage>>;
  chargeXMult: number;
  chargeArmed: boolean;
  speedDemonDecisionMs: number | null;
  sixPackXMult: number;
  sixPackUpperHandsPlayed: number;
  lastPlayDanger: import('./bosses').LastPlayDanger;
  selectedBasePips: number;
  selectedBaseMultiplier: number;
  selectedDieIds: number[];
  bossFactor: number;
  lifetimeNormalShopGoldSpent: number;
  flames: FlameInstance[];
  fetchTarget: { dieId: number; physicalFace: import('./types').Rank } | null;
  dice: { dieId: number; rosterSlot: number | null; faceValue: number; physicalFace: import('./types').Rank;
    golden: boolean; jackpot: boolean; vintage: boolean }[];
}

export function captureHandStart(state: Pick<GameState, 'score' | 'target' | 'engulfmentLevel' | 'gold' | 'manualRerollsRemaining' | 'specialOfferEffects' | 'handPlayCounts' | 'handLevels' | 'targetPracticeHand' | 'hotStreakGoal' | 'hotStreakCharges' | 'handFamilyFlameStages' | 'chargeXMult' | 'chargeArmed' | 'sixPackXMult' | 'sixPackUpperHandsPlayed' | 'flameSlots' | 'dice' | 'dieRoundState' | 'lifetimeNormalShopGoldSpent' | 'boss' | 'bossSilenced' | 'consumed' | 'scorecardCycleConsumed' | 'fetchTarget'>, hand: HandId, selectedDieIds: number[], speedDemonDecisionMs: number | null = null): HandStartSnapshot {
  const selectedScore = handScore(state.dice, hand, selectedDieIds, state.handLevels[hand]);
  return {
    score: state.score,
    target: state.target,
    infernoMultiplier: infernoMultiplier(state.engulfmentLevel),
    gold: state.gold,
    manualRerollsRemaining: state.manualRerollsRemaining,
    previousPlays: state.handPlayCounts[hand],
    ultimateHands: ultimateHands(state.handLevels),
    targetPracticeHand: state.targetPracticeHand,
    hotStreakGoal: state.hotStreakGoal,
    hotStreakCharges: state.hotStreakCharges,
    handFamilyFlameStages: { ...state.handFamilyFlameStages },
    chargeXMult: state.chargeXMult,
    chargeArmed: state.chargeArmed,
    speedDemonDecisionMs,
    sixPackXMult: state.sixPackXMult,
    sixPackUpperHandsPlayed: state.sixPackUpperHandsPlayed,
    lastPlayDanger: lastPlayDanger(state, hand),
    selectedBasePips: selectedScore.pips,
    selectedBaseMultiplier: selectedScore.multiplier,
    selectedDieIds: [...selectedDieIds],
    bossFactor: state.bossSilenced ? 1
      : state.boss?.type === 'fly' && !state.boss.caught && hand !== state.boss.flyHand ? .5
        : state.boss?.type === 'quickdraw' && !HANDS[hand].rank && state.boss.lowerShotUsed ? .25
          : state.boss?.type === 'pendulum'
            && (HANDS[hand].rank ? 'upper' : 'lower') !== state.boss.requestedSection ? .5 : 1,
    lifetimeNormalShopGoldSpent: state.lifetimeNormalShopGoldSpent,
    fetchTarget: state.fetchTarget ? { ...state.fetchTarget } : null,
    flames: structuredClone(flameInstances(state)),
    dice: state.dice.map(die => ({ dieId: die.id,
      rosterSlot: die.owner === 'player' ? state.dice.filter(item => item.owner === 'player').findIndex(item => item.id === die.id) : null,
      faceValue: activeFace(die).rank, physicalFace: die.value,
      golden: die.owner === 'player' && hasEffect(die, 'golden') && !wholeDieEffectSuppressed(die),
      jackpot: die.owner === 'player' && hasEffect(die, 'jackpot') && !wholeDieEffectSuppressed(die),
      vintage: die.owner === 'player' && hasEffect(die, 'vintage') && !wholeDieEffectSuppressed(die) })),
  };
}

const qualifies = (id: Flame, snapshot: HandStartSnapshot, hand: HandId, scoringDieIds: number[]) => {
  switch (id) {
    case 'ultimate': return snapshot.ultimateHands.includes(hand);
    case 'minigun': return UPPER_HAND_IDS.includes(hand);
    case 'hailMary': return snapshot.manualRerollsRemaining === 0;
    case 'fullOfGrace': return snapshot.lastPlayDanger !== 'none';
    case 'lowball': return snapshot.dice.some(die => scoringDieIds.includes(die.dieId) && die.faceValue >= 1 && die.faceValue <= 3);
    case 'targetPractice': return hand === snapshot.targetPracticeHand;
    case 'fatCat': return snapshot.dice.some(die => scoringDieIds.includes(die.dieId) && (die.golden || die.jackpot));
    case 'vineyard': return snapshot.dice.some(die => scoringDieIds.includes(die.dieId) && die.vintage);
    case 'fetch': return snapshot.fetchTarget !== null && snapshot.dice.some(die => scoringDieIds.includes(die.dieId)
      && die.dieId === snapshot.fetchTarget!.dieId && die.physicalFace === snapshot.fetchTarget!.physicalFace);
    case 'straightShooter':
    case 'doubleDown':
    case 'threesCompany':
    case 'boxSet': return snapshot.handFamilyFlameStages[id] === 'payoff' && hand === HAND_FAMILY_FLAMES[id].payoff;
    case 'missingPair': return hand === 'pair' || hand === 'threeKind';
    case 'oneShort': return hand === 'smallStraight' || hand === 'fourKind';
    case 'hotStreak': return hand === snapshot.hotStreakGoal;
    case 'speedDemon': return snapshot.speedDemonDecisionMs !== null;
    default: return true;
  }
};
function factorValue(id: Flame, investedGold: number, snapshot: HandStartSnapshot, scoringDieIds: number[]): number {
  switch (id) {
    case 'targetPractice': return targetPracticeMultiplier(investedGold);
    case 'lowball': {
      const scorers = snapshot.dice.filter(die => scoringDieIds.includes(die.dieId) && die.faceValue >= 1 && die.faceValue <= 3);
      const average = scorers.reduce((sum, die) => sum + die.faceValue, 0) / Math.max(1, scorers.length);
      return lowballMultiplier(investedGold, average);
    }
    case 'hotStreak': return hotStreakMultiplier(investedGold, snapshot.hotStreakCharges + 1);
    case 'speedDemon': return speedDemonMultiplier(investedGold, snapshot.speedDemonDecisionMs ?? 10000);
    case 'sixPack': return snapshot.sixPackXMult;
    case 'straightShooter':
    case 'doubleDown':
    case 'threesCompany':
    case 'boxSet': return handFamilyFlameMultiplier(investedGold);
    default: return standardFlameMultiplier(investedGold);
  }
}
function factorInput(id: Flame, snapshot: HandStartSnapshot, scoringDieIds: number[]): { input?: number; detail?: string } {
  if (id === 'fatCat') return { detail: 'scoring Golden or Jackpot die' };
  if (id === 'vineyard') return { detail: 'scoring Vintage die' };
  if (id === 'fetch' && snapshot.fetchTarget) {
    const slot = snapshot.dice.find(die => die.dieId === snapshot.fetchTarget!.dieId)?.rosterSlot;
    return { detail: `FETCH target ${slot === null || slot === undefined ? `die #${snapshot.fetchTarget.dieId}` : `D${slot + 1}`} face ${snapshot.fetchTarget.physicalFace}` };
  }
  if (id === 'lowball') {
    const scorers = snapshot.dice.filter(die => scoringDieIds.includes(die.dieId) && die.faceValue >= 1 && die.faceValue <= 3);
    const average = scorers.reduce((sum, die) => sum + die.faceValue, 0) / Math.max(1, scorers.length);
    return { input: average, detail: `${formatPlayerNumber(average)} average printed face` };
  }
  if (id === 'hotStreak') return { input: snapshot.hotStreakCharges + 1, detail: `successful sequence charge ${formatPlayerNumber(snapshot.hotStreakCharges + 1)}` };
  return {};
}
function contributions(snapshot: HandStartSnapshot, hand: HandId, scoringDieIds: number[], includeFullOfGrace: boolean): XMultFactor[] {
  const result: XMultFactor[] = [];
  if (snapshot.chargeArmed && snapshot.chargeXMult > 1) result.push({ source: 'charge', value: snapshot.chargeXMult, dieId: null, detail: 'armed stored Charge' });
  for (const flame of snapshot.flames) {
    const id = flame.type;
    if (!FLAMES[id]?.affectsXMult || isChargeFlame(id) || (!includeFullOfGrace && id === 'fullOfGrace') || !qualifies(id, snapshot, hand, scoringDieIds)) continue;
    const value = factorValue(id, flame.investedGold, snapshot, scoringDieIds);
    if (value > 1 || id === 'speedDemon' || id === 'fetch' || isHandFamilyFlame(id)) {
      const context = factorInput(id, snapshot, scoringDieIds);
      result.push({ source: id, value, dieId: null, flameInstanceId: flame.instanceId, ...context,
        detail: `${flame.stage === 'bonfire' ? 'Bonfire' : 'Ember'}${context.detail ? `; ${context.detail}` : ''}` });
    }
  }
  return result;
}
export function handXMultContributions(snapshot: HandStartSnapshot, hand: HandId, _handLevel: number, scoringDieIds: number[]): XMultFactor[] {
  const guaranteedFactors = contributions(snapshot, hand, snapshot.selectedDieIds, false);
  const xMult = composeXMult(guaranteedFactors);
  const guaranteed = snapshot.score + finalizeScore(snapshot.selectedBasePips, snapshot.selectedBaseMultiplier,
    xMult * snapshot.bossFactor, snapshot.infernoMultiplier).finalScore >= snapshot.target;
  return contributions(snapshot, hand, scoringDieIds, !guaranteed);
}
export function isGuaranteedWinningPlay(snapshot: HandStartSnapshot, hand: HandId): boolean {
  const xMult = composeXMult(contributions(snapshot, hand, snapshot.selectedDieIds, false));
  return snapshot.score + finalizeScore(snapshot.selectedBasePips, snapshot.selectedBaseMultiplier,
    xMult * snapshot.bossFactor, snapshot.infernoMultiplier).finalScore >= snapshot.target;
}
export const composeXMult = (factors: readonly (number | XMultFactor)[]) =>
  Number(factors.map(item => typeof item === 'number' ? item : item.value).sort((a, b) => a - b)
    .reduce((product, value) => product * value, 1).toFixed(12));
export const ownedFlameIds = (state: Pick<Board, 'flameSlots'>) => new Set<Flame>(flameInstances(state).map(flame => flame.type));
const hasBuildDie = (state: Pick<GameState, 'dice'>, types: readonly import('./types').DieType[]) =>
  state.dice.some(die => die.owner === 'player' && die.effects.some(effect => types.includes(effect.type)));

/** Build prerequisites required by actual Flame activation paths. Self-enabling Flames remain unrestricted. */
export function flameEligible(state: Pick<GameState, 'dice' | 'flameSlots'>, id: Flame): boolean {
  if (id === 'fatCat') return hasBuildDie(state, ['golden', 'jackpot']);
  if (id === 'vineyard') return hasBuildDie(state, ['vintage']);
  if (id === 'fluxCapacitor') return hasBuildDie(state, ['magnetic']);
  return true;
}

export const eligibleFlameIds = (state: Pick<GameState, 'dice' | 'flameSlots'>): Flame[] =>
  FLAME_IDS.filter(id => flameEligible(state, id));
export const isHandFamilyFlame = (id: Flame | null | undefined): id is HandFamilyFlame =>
  id !== null && id !== undefined && Object.hasOwn(HAND_FAMILY_FLAMES, id);
export function initialHandFamilyFlameStages(state: Pick<GameState, 'flameSlots'>): Pick<Partial<Record<Flame, import('./types').HandFamilyFlameStage>>, HandFamilyFlame> {
  const owned = ownedFlameIds(state);
  return Object.fromEntries(HAND_FAMILY_FLAME_IDS.filter(id => owned.has(id)).map(id => [id, 'setup'])) as Pick<Partial<Record<Flame, import('./types').HandFamilyFlameStage>>, HandFamilyFlame>;
}
export function handFamilyFlameTargets(state: Pick<Board, 'flameSlots' | 'handFamilyFlameStages'>): HandId[] {
  const owned = ownedFlameIds(state);
  return HAND_FAMILY_FLAME_IDS.flatMap(id => {
    if (!owned.has(id)) return [];
    const stage = state.handFamilyFlameStages[id];
    return stage === 'setup' ? [HAND_FAMILY_FLAMES[id].setup] : stage === 'payoff' ? [HAND_FAMILY_FLAMES[id].payoff] : [];
  });
}
export const lowerHand = (hand: HandId) => LOWER_HAND_IDS.includes(hand);
