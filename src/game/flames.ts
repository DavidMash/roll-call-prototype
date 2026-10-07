import { activeFace } from './dice';
import { stacks } from './enhancements';
import { lastPlayDanger } from './bosses';
import { LOWER_HAND_IDS, ultimateHands, UPPER_HAND_IDS } from './hands';
import { finalizeScore, handScore } from './scoring';
import type { ActiveFlame, Board, Die, Flame, GameState, HandId, Rarity, XMultFactor } from './types';
import { formatPlayerNumber } from './copy';
import { wildfireFactor } from './hoodedFigure';

export interface FlameDefinition {
  name: string;
  shortName: string;
  description: string;
  bonfireDescription: string;
  affectsXMult: boolean;
  rarity: Rarity;
}
const GLOBAL_BONFIRE = 'This Flame now works globally.';
export const FLAMES: Record<Flame, FlameDefinition> = {
  ultimate: { name: 'Ultimate', shortName: 'ULT', rarity: 'uncommon', affectsXMult: true, description: 'Your highest level hand gains up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  minigun: { name: 'Minigun', shortName: 'MINI', rarity: 'common', affectsXMult: true, description: 'Ones–Sixes gain up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  hailMary: { name: 'Hail Mary', shortName: 'HAIL', rarity: 'common', affectsXMult: true, description: 'Hands played with no Rerolls left gain up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  fullOfGrace: { name: 'Full of Grace', shortName: 'GRACE', rarity: 'common', affectsXMult: true, description: 'Last Play gains up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  momentum: { name: 'Momentum', shortName: 'MOM', rarity: 'common', affectsXMult: true, description: 'Playing a hand builds Charge.', bonfireDescription: 'Charge can now be used on any hand.' },
  thirdRail: { name: 'Third Rail', shortName: 'RAIL', rarity: 'uncommon', affectsXMult: true, description: 'Rolling 3s builds Charge.', bonfireDescription: 'Charge can now be used on any hand.' },
  jumpStart: { name: 'Jump Start', shortName: 'JUMP', rarity: 'uncommon', affectsXMult: true, description: 'Rerolls build Charge.', bonfireDescription: 'Charge can now be used on any hand.' },
  powerSurge: { name: 'Power Surge', shortName: 'SURGE', rarity: 'rare', affectsXMult: true, description: 'Playing your highest level hand triples your current Charge.', bonfireDescription: 'Charge can now be used on any hand.' },
  speedDemon: { name: 'Speed Demon', shortName: 'SPEED', rarity: 'rare', affectsXMult: true, description: 'Play quickly for up to ×9 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  sixPack: { name: 'Six Pack', shortName: 'SIX', rarity: 'rare', affectsXMult: true, description: 'Starts at up to ×6 XMult. Reduces when an Upper hand is played.', bonfireDescription: GLOBAL_BONFIRE },
  fluxCapacitor: { name: 'Flux Capacitor', shortName: 'FLUX', rarity: 'rare', affectsXMult: true, description: 'Pulling Magnetic faces multiplies your XMult Charge.', bonfireDescription: 'Charge can now be used on any hand.' },
  fatCat: { name: 'Fat Cat', shortName: 'CAT', rarity: 'uncommon', affectsXMult: true, description: 'Hands with Golden or Jackpot gain up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  vineyard: { name: 'Vineyard', shortName: 'VINE', rarity: 'uncommon', affectsXMult: true, description: 'Hands with Vintage gain up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  fetch: { name: 'Fetch', shortName: 'FETCH', rarity: 'uncommon', affectsXMult: true, description: 'Score the marked FETCH face for up to ×5 XMult. Then FETCH moves.', bonfireDescription: GLOBAL_BONFIRE },
  targetPractice: { name: 'Target Practice', shortName: 'TARGET', rarity: 'rare', affectsXMult: true, description: 'Hit your Target for up to ×9 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  hotStreak: { name: 'Hot Streak', shortName: 'STREAK', rarity: 'uncommon', affectsXMult: true, description: 'Chain Lower hands in order to build XMult, up to ×9.', bonfireDescription: GLOBAL_BONFIRE },
  lowball: { name: 'Lowball', shortName: 'LOW', rarity: 'common', affectsXMult: true, description: 'Low face values earn up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  straightShooter: { name: 'Straight Shooter', shortName: 'STR8', rarity: 'uncommon', affectsXMult: true, description: 'Play Small Straight before Large Straight for up to ×9 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  doubleDown: { name: 'Double Down', shortName: 'DBL', rarity: 'uncommon', affectsXMult: true, description: 'Play Pair before Two Pair for up to ×9 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  threesCompany: { name: 'Three’s Company', shortName: 'THREE', rarity: 'uncommon', affectsXMult: true, description: 'Play Three of a Kind before Full House for up to ×9 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  boxSet: { name: 'Box Set', shortName: 'BOX', rarity: 'uncommon', affectsXMult: true, description: 'Play Four of a Kind before Five of a Kind for up to ×9 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  missingPair: { name: 'Missing Pair', shortName: 'MISS', rarity: 'common', affectsXMult: true, description: 'Pair and Three of a Kind gain up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
  oneShort: { name: 'One Short', shortName: 'SHORT', rarity: 'common', affectsXMult: true, description: 'Small Straight and Four of a Kind gain up to ×5 XMult.', bonfireDescription: GLOBAL_BONFIRE },
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
  return Number((1 + 8 * flameProgress(investedGold) * strength).toFixed(12));
};
export const sixPackStartingMultiplier = (investedGold: number) => 1 + 5 * flameProgress(investedGold);
export const sixPackMultiplierAfterUpperHands = (startingFactor: number, upperHandsPlayed: number) =>
  Number(Math.max(1, 1 + (Math.max(1, startingFactor) - 1) * (1 - Math.min(6, Math.max(0, upperHandsPlayed)) / 6)).toFixed(12));
export const maxChargeContribution = (investedGold: number) => 1 + 4 * flameProgress(investedGold);
export const hotStreakMultiplier = (investedGold: number, charges: number) => 1 + Math.max(0, charges) * flameProgress(investedGold);
export function lowballFullMultiplier(averageFace: number): number {
  if (averageFace <= 2) return 3;
  if (averageFace <= 3) return 2.5;
  if (averageFace <= 4) return 2;
  if (averageFace <= 5) return 1.5;
  return 1;
}
export const lowballMultiplier = (investedGold: number, averageFace: number) =>
  1 + 2 * (lowballFullMultiplier(averageFace) - 1) * flameProgress(investedGold);
type FlameDisplayContext = Pick<Board, 'gold' | 'lifetimeNormalShopGoldSpent'>;
export function flameEffectText(id: Flame, investedGold: number, _board: FlameDisplayContext): string {
  switch (id) {
    case 'momentum': return `Hands build +${formatPlayerNumber(momentumChargeGain(investedGold))} Charge.`;
    case 'thirdRail': return `Rolled 3s build +${formatPlayerNumber(thirdRailChargeGain(investedGold))} Charge.`;
    case 'jumpStart': return `Each Reroll builds +${formatPlayerNumber(jumpStartChargeGain(investedGold))} Charge.`;
    case 'powerSurge': return 'Your highest level hand triples current Charge.';
    case 'fluxCapacitor': return `Each activation multiplies Charge by 1 + (${formatPlayerNumber(flameProgress(investedGold))} × pulled faces).`;
    case 'speedDemon': return `A quick play reaches ×${formatPlayerNumber(speedDemonMultiplier(investedGold, 0))} XMult.`;
    case 'sixPack': return `Each Round starts at ×${formatPlayerNumber(sixPackStartingMultiplier(investedGold))} XMult.`;
    case 'targetPractice': return `Target gains ×${formatPlayerNumber(targetPracticeMultiplier(investedGold))} XMult.`;
    case 'fatCat': return `A scoring Golden or Jackpot face grants ×${formatPlayerNumber(standardFlameMultiplier(investedGold))} XMult.`;
    case 'vineyard': return `A scoring Vintage face grants ×${formatPlayerNumber(standardFlameMultiplier(investedGold))} XMult.`;
    case 'fetch': return `The marked FETCH face grants ×${formatPlayerNumber(standardFlameMultiplier(investedGold))} XMult, then moves.`;
    case 'hotStreak': return `A full Lower-hand chain reaches ×${formatPlayerNumber(hotStreakMultiplier(investedGold, HOT_STREAK_SEQUENCE.length))} XMult.`;
    case 'lowball': return `Low Faces gain up to ×${formatPlayerNumber(lowballMultiplier(investedGold, 2))} XMult.`;
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
    const currentValue = id === 'momentum' ? `+${formatPlayerNumber(momentumChargeGain(investment))} Charge per hand`
      : id === 'thirdRail' ? `+${formatPlayerNumber(thirdRailChargeGain(investment))} Charge per rolled 3`
        : id === 'jumpStart' ? `+${formatPlayerNumber(jumpStartChargeGain(investment))} Charge per manual Reroll`
          : id === 'powerSurge' ? '×3 current Charge on highest level hand'
            : `×${formatPlayerNumber(fluxCapacitorChargeMultiplier(investment, 1))} Charge per pulled Magnetic face`;
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
export const activeFlameId = (flame: ActiveFlame | null | unknown): Flame | null => {
  if (!flame) return null;
  if (typeof flame === 'object' && 'id' in flame && isFlame((flame as { id: unknown }).id)) return (flame as ActiveFlame).id;
  return isFlame(flame) ? flame : null;
};
export const activeFlameInvestment = (flame: ActiveFlame | null | unknown) =>
  typeof flame === 'object' && flame !== null && 'investedGold' in flame && Number.isFinite((flame as ActiveFlame).investedGold)
    ? Math.max(0, Math.min(100, (flame as ActiveFlame).investedGold)) : 0;
export const hasOwnedFlame = (state: Pick<GameState, 'dice' | 'bonfires' | 'wildfires'>, id: Flame) =>
  state.bonfires.includes(id) || state.wildfires.some(wildfire => wildfire.flame === id)
  || state.dice.some(die => activeFlameId(die.flame) === id);
export const isChargeFlame = (id: Flame | null | undefined): id is ChargeFlame =>
  id !== null && id !== undefined && (CHARGE_FLAME_IDS as readonly Flame[]).includes(id);
export const hasChargeBonfire = (state: Pick<Board, 'bonfires' | 'wildfires'>) => state.bonfires.some(isChargeFlame)
  || state.wildfires.some(wildfire => isChargeFlame(wildfire.flame));
export const hasOwnedChargeFlame = (state: Pick<Board, 'dice' | 'bonfires' | 'wildfires'>) =>
  hasChargeBonfire(state) || state.dice.some(die => isChargeFlame(activeFlameId(die.flame)));
export const chargeFlameDieIds = (state: Pick<Board, 'dice'>) => state.dice
  .filter(die => isChargeFlame(activeFlameId(die.flame))).map(die => die.id).sort((a, b) => a - b);
export function calculateMaxCharge(state: Pick<Board, 'dice' | 'bonfires' | 'wildfires'>): number {
  const emberCapacity = state.dice.reduce((sum, die) => isChargeFlame(activeFlameId(die.flame))
    ? sum + maxChargeContribution(activeFlameInvestment(die.flame)) : sum, 0);
  const bonfireCapacity = state.bonfires.filter(isChargeFlame).length * maxChargeContribution(100);
  const wildfireCapacity = state.wildfires.reduce((sum, wildfire) => sum
    + (wildfire.resolved.kind === 'charge' ? wildfire.resolved.maxCharge : 0), 0);
  return Number(Math.max(1, emberCapacity + bonfireCapacity + wildfireCapacity).toFixed(12));
}
export function recalculateMaxCharge(state: Pick<Board, 'dice' | 'bonfires' | 'wildfires' | 'chargeXMult' | 'maxCharge' | 'chargeArmed'>): void {
  state.maxCharge = calculateMaxCharge(state);
  state.chargeXMult = Number(Math.min(Math.max(1, state.chargeXMult), state.maxCharge).toFixed(12));
  if (state.chargeXMult <= 1) state.chargeArmed = false;
}
export const hasXMultFlame = (dice: Die[], bonfires: Flame[] = [], wildfires: import('./types').Wildfire[] = []) =>
  bonfires.some(id => FLAMES[id]?.affectsXMult) || wildfires.some(item => FLAMES[item.flame]?.affectsXMult) || dice.some(die => {
    const id = activeFlameId(die.flame);
    return id !== null && FLAMES[id].affectsXMult;
  });

export interface HandStartSnapshot {
  score: number;
  target: number;
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
  bonfires: Flame[];
  wildfires: import('./types').Wildfire[];
  fetchTarget: { dieId: number; physicalFace: import('./types').Rank } | null;
  dice: { dieId: number; flame: Flame | null; investedGold: number; faceValue: number; physicalFace: import('./types').Rank;
    golden: boolean; jackpot: boolean; vintage: boolean }[];
}

export function captureHandStart(state: Pick<GameState, 'score' | 'target' | 'gold' | 'manualRerollsRemaining' | 'specialOfferEffects' | 'handPlayCounts' | 'handLevels' | 'targetPracticeHand' | 'hotStreakGoal' | 'hotStreakCharges' | 'handFamilyFlameStages' | 'chargeXMult' | 'chargeArmed' | 'sixPackXMult' | 'sixPackUpperHandsPlayed' | 'bonfires' | 'wildfires' | 'dice' | 'lifetimeNormalShopGoldSpent' | 'boss' | 'bossSilenced' | 'consumed' | 'scorecardCycleConsumed' | 'fetchTarget'>, hand: HandId, selectedDieIds: number[], speedDemonDecisionMs: number | null = null): HandStartSnapshot {
  const selectedScore = handScore(state.dice, hand, selectedDieIds, state.handLevels[hand]);
  return {
    score: state.score,
    target: state.target,
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
    bossFactor: !state.bossSilenced && state.boss?.type === 'fly' && !state.boss.caught && hand !== state.boss.flyHand ? .5 : 1,
    lifetimeNormalShopGoldSpent: state.lifetimeNormalShopGoldSpent,
    fetchTarget: state.fetchTarget ? { ...state.fetchTarget } : null,
    bonfires: [...state.bonfires],
    wildfires: structuredClone(state.wildfires),
    dice: state.dice.map(die => ({ dieId: die.id, flame: activeFlameId(die.flame), investedGold: activeFlameInvestment(die.flame),
      faceValue: activeFace(die).rank, physicalFace: die.value, golden: stacks(activeFace(die), 'golden') > 0,
      jackpot: stacks(activeFace(die), 'jackpot') > 0, vintage: stacks(activeFace(die), 'vintage') > 0 })),
  };
}

const qualifies = (id: Flame, snapshot: HandStartSnapshot, hand: HandId, scoringDieIds: number[]) => {
  switch (id) {
    case 'ultimate': return snapshot.ultimateHands.includes(hand);
    case 'minigun': return UPPER_HAND_IDS.includes(hand);
    case 'hailMary': return snapshot.manualRerollsRemaining === 0;
    case 'fullOfGrace': return snapshot.lastPlayDanger !== 'none';
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
      const scorers = snapshot.dice.filter(die => scoringDieIds.includes(die.dieId));
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
  if (id === 'fatCat') return { detail: 'scoring Golden or Jackpot face' };
  if (id === 'vineyard') return { detail: 'scoring Vintage face' };
  if (id === 'fetch' && snapshot.fetchTarget) return { detail: `FETCH target D${snapshot.fetchTarget.dieId + 1} face ${snapshot.fetchTarget.physicalFace}` };
  if (id === 'lowball') {
    const scorers = snapshot.dice.filter(die => scoringDieIds.includes(die.dieId));
    const average = scorers.reduce((sum, die) => sum + die.faceValue, 0) / Math.max(1, scorers.length);
    return { input: average, detail: `${formatPlayerNumber(average)} average printed face` };
  }
  if (id === 'hotStreak') return { input: snapshot.hotStreakCharges + 1, detail: `successful sequence charge ${formatPlayerNumber(snapshot.hotStreakCharges + 1)}` };
  return {};
}
function contributions(snapshot: HandStartSnapshot, hand: HandId, scoringDieIds: number[], includeFullOfGrace: boolean): XMultFactor[] {
  const scoring = new Set(scoringDieIds);
  const result: XMultFactor[] = [];
  if (snapshot.chargeArmed && snapshot.chargeXMult > 1) result.push({ source: 'charge', value: snapshot.chargeXMult, dieId: null, detail: 'armed stored Charge' });
  for (const id of snapshot.bonfires) {
    if (!FLAMES[id]?.affectsXMult || isChargeFlame(id) || (!includeFullOfGrace && id === 'fullOfGrace') || !qualifies(id, snapshot, hand, scoringDieIds)) continue;
    const value = factorValue(id, 100, snapshot, scoringDieIds);
    if (value > 1 || id === 'speedDemon' || id === 'fetch' || isHandFamilyFlame(id)) {
      const context = factorInput(id, snapshot, scoringDieIds);
      result.push({ source: id, value, dieId: null, ...context, detail: `Bonfire${context.detail ? `; ${context.detail}` : ''}` });
    }
  }
  for (const wildfire of snapshot.wildfires) {
    const id = wildfire.flame;
    if (!FLAMES[id]?.affectsXMult || isChargeFlame(id) || (!includeFullOfGrace && id === 'fullOfGrace') || !qualifies(id, snapshot, hand, scoringDieIds)) continue;
    const ordinary = id === 'sixPack' ? sixPackMultiplierAfterUpperHands(6, snapshot.sixPackUpperHandsPlayed)
      : factorValue(id, 100, snapshot, scoringDieIds);
    const value = wildfireFactor(wildfire, ordinary);
    if (value > 1 || id === 'speedDemon' || id === 'fetch' || isHandFamilyFlame(id)) {
      const context = factorInput(id, snapshot, scoringDieIds);
      result.push({ source: id, value, dieId: null, ...context, detail: `Wildfire${context.detail ? `; ${context.detail}` : ''}` });
    }
  }
  for (const die of snapshot.dice) {
    const id = die.flame;
    if (!id || !scoring.has(die.dieId) || !FLAMES[id].affectsXMult || isChargeFlame(id)
      || (!includeFullOfGrace && id === 'fullOfGrace') || !qualifies(id, snapshot, hand, scoringDieIds)) continue;
    const value = factorValue(id, die.investedGold, snapshot, scoringDieIds);
    if (value > 1 || id === 'speedDemon' || id === 'fetch' || isHandFamilyFlame(id)) result.push({ source: id, value, dieId: die.dieId, ...factorInput(id, snapshot, scoringDieIds) });
  }
  return result;
}
export function handXMultContributions(snapshot: HandStartSnapshot, hand: HandId, _handLevel: number, scoringDieIds: number[]): XMultFactor[] {
  const guaranteedFactors = contributions(snapshot, hand, snapshot.selectedDieIds, false);
  const xMult = composeXMult(guaranteedFactors);
  const guaranteed = snapshot.score + finalizeScore(snapshot.selectedBasePips, snapshot.selectedBaseMultiplier,
    xMult * snapshot.bossFactor).finalScore >= snapshot.target;
  return contributions(snapshot, hand, scoringDieIds, !guaranteed);
}
export function isGuaranteedWinningPlay(snapshot: HandStartSnapshot, hand: HandId): boolean {
  const xMult = composeXMult(contributions(snapshot, hand, snapshot.selectedDieIds, false));
  return snapshot.score + finalizeScore(snapshot.selectedBasePips, snapshot.selectedBaseMultiplier,
    xMult * snapshot.bossFactor).finalScore >= snapshot.target;
}
export const composeXMult = (factors: readonly (number | XMultFactor)[]) =>
  Number(factors.map(item => typeof item === 'number' ? item : item.value).sort((a, b) => a - b)
    .reduce((product, value) => product * value, 1).toFixed(12));
export const ownedFlameIds = (state: Pick<GameState, 'dice' | 'bonfires' | 'wildfires'>) => new Set<Flame>([
  ...state.bonfires,
  ...state.wildfires.map(wildfire => wildfire.flame),
  ...state.dice.map(die => activeFlameId(die.flame)).filter((id): id is Flame => id !== null),
]);
export const isHandFamilyFlame = (id: Flame | null | undefined): id is HandFamilyFlame =>
  id !== null && id !== undefined && Object.hasOwn(HAND_FAMILY_FLAMES, id);
export function initialHandFamilyFlameStages(state: Pick<GameState, 'dice' | 'bonfires' | 'wildfires'>): Pick<Partial<Record<Flame, import('./types').HandFamilyFlameStage>>, HandFamilyFlame> {
  const owned = ownedFlameIds(state);
  return Object.fromEntries(HAND_FAMILY_FLAME_IDS.filter(id => owned.has(id)).map(id => [id, 'setup'])) as Pick<Partial<Record<Flame, import('./types').HandFamilyFlameStage>>, HandFamilyFlame>;
}
export function handFamilyFlameTargets(state: Pick<Board, 'dice' | 'bonfires' | 'wildfires' | 'handFamilyFlameStages'>): HandId[] {
  const owned = ownedFlameIds(state);
  return HAND_FAMILY_FLAME_IDS.flatMap(id => {
    if (!owned.has(id)) return [];
    const stage = state.handFamilyFlameStages[id];
    return stage === 'setup' ? [HAND_FAMILY_FLAMES[id].setup] : stage === 'payoff' ? [HAND_FAMILY_FLAMES[id].payoff] : [];
  });
}
export const lowerHand = (hand: HandId) => LOWER_HAND_IDS.includes(hand);
