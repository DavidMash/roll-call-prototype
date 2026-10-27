import { activeFace, wholeDieEffectSuppressed } from './dice';
import { activeEncounterDice, availablePlayableDice, currentlyPlayableManualHands, lastPlayDanger } from './bosses';
import { benchWarmerHand, encounterHandIds, handIsStructurallyImpossible, HANDS, LOWER_HAND_IDS, rankedHands, ultimateHands, UPPER_HAND_IDS } from './hands';
import { infernoMultiplier } from './scoring';
import type { Board, Flame, FlameActivationDiagnostics, FlameInstance, FlameInstanceId, FlameSlotIndex, FlameSlots, GameState, HandId, Rarity, SpecialDieType, XMultFactor } from './types';
import { formatPlayerNumber } from './copy';
import type { ExactScore } from './scoreMath';
import type { RichText } from './richText';
import { flameVerboseDescription, plainDescription } from './effectDescriptions';

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
  minigun: flameDefinition('minigun', 'Minigun', 'MINI', 'common', 'Consecutive Upper Hands spin up to ×4 XMult.'),
  hailMary: flameDefinition('hailMary', 'Hail Mary', 'HAIL', 'common', 'Hands played with no Rerolls left gain up to ×5 XMult.'),
  fullOfGrace: flameDefinition('fullOfGrace', 'Full of Grace', 'GRACE', 'common', 'Last Play gains up to ×5 XMult.'),
  momentum: flameDefinition('momentum', 'Momentum', 'MOM', 'common', 'Playing a hand builds Charge.'),
  thirdRail: flameDefinition('thirdRail', 'Third Rail', 'RAIL', 'uncommon', 'Rolling 3s builds Charge.'),
  jumpStart: flameDefinition('jumpStart', 'Jump Start', 'JUMP', 'uncommon', 'Rerolls build Charge.'),
  powerSurge: flameDefinition('powerSurge', 'Power Surge', 'SURGE', 'rare'),
  speedDemon: flameDefinition('speedDemon', 'Speed Demon', 'SPEED', 'rare', 'Play within 5 seconds for up to ×4 XMult.'),
  sixPack: flameDefinition('sixPack', 'Six Pack', 'SIX', 'rare', 'Starts at up to ×4 XMult and weakens after Upper Hands.'),
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
  potentialEnergy: flameDefinition('potentialEnergy', 'Potential Energy', 'POT', 'uncommon'),
  allHandsOnDeck: flameDefinition('allHandsOnDeck', 'All Hands on Deck', 'DECK', 'uncommon'),
  casual: flameDefinition('casual', 'Casual', 'CAS', 'common'),
  freeRealEstate: flameDefinition('freeRealEstate', 'Free Real Estate', 'FREE', 'uncommon'),
  heavyHitters: flameDefinition('heavyHitters', 'Heavy Hitters', 'HEAVY', 'uncommon'),
  frankenstein: flameDefinition('frankenstein', 'Frankenstein', 'FRANK', 'rare'),
  highRoller: flameDefinition('highRoller', 'High Roller', 'HIGH', 'common'),
  cleanSweep: flameDefinition('cleanSweep', 'Clean Sweep', 'SWEEP', 'rare'),
  benchWarmer: flameDefinition('benchWarmer', 'Bench Warmer', 'BENCH', 'uncommon'),
  epinephrine: flameDefinition('epinephrine', 'Epinephrine', 'EPI', 'rare'),
  punchCard: flameDefinition('punchCard', 'Punch Card', 'PUNCH', 'common'),
  blackHole: flameDefinition('blackHole', 'Black Hole', 'BLACK', 'rare'),
  assemblyLine: flameDefinition('assemblyLine', 'Assembly Line', 'LINE', 'uncommon'),
  gymBros: flameDefinition('gymBros', 'Gym Bros', 'GYM', 'uncommon'),
  burnItDown: flameDefinition('burnItDown', 'Burn It Down', 'BURN', 'rare'),
  greaseTheEngine: flameDefinition('greaseTheEngine', 'Grease the Engine', 'GREASE', 'uncommon'),
  lightningStrike: flameDefinition('lightningStrike', 'Lightning Strike', 'STRIKE', 'rare'),
  hotPotatoClock: flameDefinition('hotPotatoClock', 'Hot Potato Clock', 'POTATO', 'uncommon'),
  dareDevil: flameDefinition('dareDevil', 'Dare Devil', 'DARE', 'rare'),
  doubleOrNothing: flameDefinition('doubleOrNothing', 'Double or Nothing', 'DOUBLE', 'rare'),
  allIn: flameDefinition('allIn', 'All In', 'ALL IN', 'rare'),
  topDown: flameDefinition('topDown', 'Top Down', 'TOP', 'rare'),
  countDown: flameDefinition('countDown', 'Count Down', 'COUNT', 'uncommon'),
};
export const FLAME_IDS = Object.keys(FLAMES) as Flame[];
export const XMult_FLAME_IDS = FLAME_IDS.filter(flame => FLAMES[flame].affectsXMult);
export const CHARGE_FLAME_IDS = ['momentum', 'thirdRail', 'jumpStart', 'powerSurge', 'fluxCapacitor',
  'potentialEnergy', 'allHandsOnDeck', 'burnItDown', 'greaseTheEngine', 'lightningStrike',
  'hotPotatoClock'] as const satisfies readonly Flame[];
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
export const PROGRESSIVE_FLAME_SEQUENCES = {
  topDown: { hands: ['fiveKind', 'largeStraight', 'fourKind', 'fullHouse', 'smallStraight', 'threeKind', 'twoPair', 'pair'],
    bonfireFactors: [3, 4, 5, 6, 7, 8, 10, 12] },
  countDown: { hands: ['sixes', 'fives', 'fours', 'threes', 'twos', 'ones'],
    bonfireFactors: [1.5, 2, 2.5, 3, 3.5, 4.5] },
} as const satisfies Record<'topDown' | 'countDown', { hands: readonly HandId[]; bonfireFactors: readonly number[] }>;
export type ProgressiveSequenceFlame = keyof typeof PROGRESSIVE_FLAME_SEQUENCES;
export const flameProgress = (investedGold: number) => Math.max(0, Math.min(100, investedGold)) / 100;
export const FLAME_SCALING = {
  speedDemon: { fullBonus: 3, fullThroughMs: 1000, expiresAtMs: 5000 },
  sixPack: { fullBonus: 3, upperDecay: .5, exhaustionSteps: 6 },
  minigun: { upperStep: .5, cappedStreak: 6 },
  lowball: { fullBonus: 2.5 },
  fatCat: { perMatchingDie: .3, maximumPlayedDice: 5 },
  vineyard: { perMatchingDie: .4, maximumPlayedDice: 5 },
  missingPair: { fullBonus: 2 },
  handFamily: { doubleDown: 5, threesCompany: 8, straightShooter: 8, boxSet: 11 },
  potentialEnergy: { charge: 1 },
  allHandsOnDeck: { chargePerDie: .5 },
  casual: { fullBonus: 3 },
  freeRealEstate: { fullBonus: 2 },
  heavyHitters: { fullBonus: 2 },
  frankenstein: { fullBonus: 3 },
  highRoller: { fullBonus: 2 },
  cleanSweep: { fullBonus: 11 },
  benchWarmer: { fullBonus: 4 },
  epinephrine: { fullBonus: 6 },
  punchCard: { fullBonus: 2 },
  blackHole: { bonusPerMissingDie: 1 },
  assemblyLine: { perMatchingDie: .3, maximumPlayedDice: 5 },
  gymBros: { perMatchingDie: .3, maximumPlayedDice: 5 },
  burnItDown: { fullCharge: 5 },
  greaseTheEngine: { baseCost: 5, charge: 1 },
  lightningStrike: { charge: 3 },
  hotPotatoClock: { chargePerStreak: .5 },
  dareDevil: { bonusPerDare: 2, maximumDares: 4 },
  doubleOrNothing: { fullBonus: 8 },
  allIn: { fullBonus: 11 },
  progressiveSequences: PROGRESSIVE_FLAME_SEQUENCES,
} as const;
export const standardFlameMultiplier = (investedGold: number) => 1 + 4 * flameProgress(investedGold);
export const targetPracticeMultiplier = (investedGold: number) => 1 + 8 * flameProgress(investedGold);
export const momentumChargeGain = (investedGold: number) => 0.5 * flameProgress(investedGold);
export const thirdRailChargeGain = (investedGold: number) => 0.5 * flameProgress(investedGold);
export const jumpStartChargeGain = (investedGold: number) => 2 * flameProgress(investedGold);
export const fluxCapacitorChargeMultiplier = (investedGold: number, pulledMagneticFaces: number) =>
  1 + Math.max(0, pulledMagneticFaces) * flameProgress(investedGold);
export const handFamilyFlameMultiplier = (id: HandFamilyFlame, investedGold: number) =>
  1 + FLAME_SCALING.handFamily[id] * flameProgress(investedGold);
export const speedDemonMultiplier = (investedGold: number, decisionMs: number) => {
  const { fullThroughMs, expiresAtMs, fullBonus } = FLAME_SCALING.speedDemon;
  const strength = decisionMs <= fullThroughMs ? 1
    : Math.max(0, Math.min(1, (expiresAtMs - decisionMs) / (expiresAtMs - fullThroughMs)));
  return Number((1 + fullBonus * flameProgress(investedGold) * strength).toFixed(12));
};
export const sixPackStartingMultiplier = (investedGold: number) =>
  1 + FLAME_SCALING.sixPack.fullBonus * flameProgress(investedGold);
export const sixPackMultiplierAfterUpperHands = (startingFactor: number, upperHandsPlayed: number) => {
  const progress = Math.max(0, Math.min(1, (Math.max(1, startingFactor) - 1) / FLAME_SCALING.sixPack.fullBonus));
  return Number(Math.max(1, startingFactor - Math.max(0, upperHandsPlayed)
    * FLAME_SCALING.sixPack.upperDecay * progress).toFixed(12));
};
export const minigunMultiplier = (investedGold: number, streakAfterThisPlay: number) =>
  Number((1 + Math.min(Math.max(0, streakAfterThisPlay), FLAME_SCALING.minigun.cappedStreak)
    * FLAME_SCALING.minigun.upperStep * flameProgress(investedGold)).toFixed(12));
export const maxChargeContribution = (investedGold: number) => 1 + 4 * flameProgress(investedGold);
export const hotStreakMultiplier = (investedGold: number, charges: number) => 1 + Math.max(0, charges) * flameProgress(investedGold);
export const lowballMultiplier = (investedGold: number) =>
  1 + FLAME_SCALING.lowball.fullBonus * flameProgress(investedGold);
export const enhancementDensityMultiplier = (investedGold: number, matchingPlayedDice: number, fullBonusPerDie: number) =>
  Number((1 + Math.max(0, matchingPlayedDice) * fullBonusPerDie * flameProgress(investedGold)).toFixed(12));
export const fatCatMultiplier = (investedGold: number, matchingPlayedDice: number) =>
  enhancementDensityMultiplier(investedGold, matchingPlayedDice, FLAME_SCALING.fatCat.perMatchingDie);
export const vineyardMultiplier = (investedGold: number, matchingPlayedDice: number) =>
  enhancementDensityMultiplier(investedGold, matchingPlayedDice, FLAME_SCALING.vineyard.perMatchingDie);
export const missingPairMultiplier = (investedGold: number) =>
  1 + FLAME_SCALING.missingPair.fullBonus * flameProgress(investedGold);
export const potentialEnergyChargeGain = (investedGold: number) =>
  FLAME_SCALING.potentialEnergy.charge * flameProgress(investedGold);
export const allHandsOnDeckChargeGain = (investedGold: number, availableDiceCount: number) =>
  FLAME_SCALING.allHandsOnDeck.chargePerDie * Math.max(0, availableDiceCount) * flameProgress(investedGold);
const fixedFlameMultiplier = (investedGold: number, fullBonus: number) => 1 + fullBonus * flameProgress(investedGold);
export const casualMultiplier = (investedGold: number) => fixedFlameMultiplier(investedGold, FLAME_SCALING.casual.fullBonus);
export const freeRealEstateMultiplier = (investedGold: number) => fixedFlameMultiplier(investedGold, FLAME_SCALING.freeRealEstate.fullBonus);
export const heavyHittersMultiplier = (investedGold: number) => fixedFlameMultiplier(investedGold, FLAME_SCALING.heavyHitters.fullBonus);
export const frankensteinMultiplier = (investedGold: number) => fixedFlameMultiplier(investedGold, FLAME_SCALING.frankenstein.fullBonus);
export const highRollerMultiplier = (investedGold: number) => fixedFlameMultiplier(investedGold, FLAME_SCALING.highRoller.fullBonus);
export const cleanSweepMultiplier = (investedGold: number) => fixedFlameMultiplier(investedGold, FLAME_SCALING.cleanSweep.fullBonus);
export const benchWarmerMultiplier = (investedGold: number) => fixedFlameMultiplier(investedGold, FLAME_SCALING.benchWarmer.fullBonus);
export const epinephrineMultiplier = (investedGold: number) => fixedFlameMultiplier(investedGold, FLAME_SCALING.epinephrine.fullBonus);
export const punchCardMultiplier = (investedGold: number) => fixedFlameMultiplier(investedGold, FLAME_SCALING.punchCard.fullBonus);
export const blackHoleMultiplier = (investedGold: number, missingDice: number) =>
  fixedFlameMultiplier(investedGold, Math.max(0, missingDice) * FLAME_SCALING.blackHole.bonusPerMissingDie);
export const assemblyLineMultiplier = (investedGold: number, matchingPlayedDice: number) =>
  enhancementDensityMultiplier(investedGold, matchingPlayedDice, FLAME_SCALING.assemblyLine.perMatchingDie);
export const gymBrosMultiplier = (investedGold: number, matchingPlayedDice: number) =>
  enhancementDensityMultiplier(investedGold, matchingPlayedDice, FLAME_SCALING.gymBros.perMatchingDie);
export const burnItDownChargeGain = (investedGold: number, targetFraction: number) => Number((FLAME_SCALING.burnItDown.fullCharge
  * Math.max(0, Math.min(1, targetFraction)) * flameProgress(investedGold)).toFixed(12));
export const greaseTheEngineCost = (usesThisRound: number) => FLAME_SCALING.greaseTheEngine.baseCost * 2 ** Math.max(0, Math.floor(usesThisRound));
export const greaseTheEngineChargeGain = (investedGold: number) => FLAME_SCALING.greaseTheEngine.charge * flameProgress(investedGold);
export const lightningStrikeChargeGain = (investedGold: number) => FLAME_SCALING.lightningStrike.charge * flameProgress(investedGold);
export const hotPotatoClockChargeGain = (investedGold: number, streak: number) => Number((FLAME_SCALING.hotPotatoClock.chargePerStreak
  * Math.max(0, Math.floor(streak)) * flameProgress(investedGold)).toFixed(12));
export const dareDevilMultiplier = (investedGold: number, dareCount: number) => Number((1 + FLAME_SCALING.dareDevil.bonusPerDare
  * Math.min(FLAME_SCALING.dareDevil.maximumDares, Math.max(0, Math.floor(dareCount)))
  * flameProgress(investedGold)).toFixed(12));
export const doubleOrNothingMultiplier = (investedGold: number) =>
  fixedFlameMultiplier(investedGold, FLAME_SCALING.doubleOrNothing.fullBonus);
export const DOUBLE_OR_NOTHING_HAND_COUNT = 3;
export function doubleOrNothingEligibleHands(
  state: Pick<Board, 'handLevels' | 'dice' | 'boss' | 'bossSilenced'>,
): HandId[] {
  const activeDieCount = activeEncounterDice(state).length;
  const possibleHands = encounterHandIds(state)
    .filter(hand => !handIsStructurallyImpossible(hand, activeDieCount));
  return rankedHands(state.handLevels, possibleHands).slice(0, DOUBLE_OR_NOTHING_HAND_COUNT);
}
export const allInMultiplier = (investedGold: number) =>
  fixedFlameMultiplier(investedGold, FLAME_SCALING.allIn.fullBonus);
export const progressiveSequenceMultiplier = (id: ProgressiveSequenceFlame, investedGold: number, stepIndex: number) => {
  const rewards = PROGRESSIVE_FLAME_SEQUENCES[id].bonfireFactors;
  const bonfireFactor = rewards[Math.max(0, Math.min(rewards.length - 1, Math.floor(stepIndex)))] ?? 1;
  return Number((1 + (bonfireFactor - 1) * flameProgress(investedGold)).toFixed(12));
};
type FlameDisplayContext = Pick<Board, 'gold' | 'lifetimeNormalShopGoldSpent'>;
export function flameEffectText(id: Flame, investedGold: number, _board: FlameDisplayContext): string {
  switch (id) {
    case 'momentum': return `Each Play adds +${formatPlayerNumber(momentumChargeGain(investedGold))} Charge.`;
    case 'thirdRail': return `Each Rolled 3 adds +${formatPlayerNumber(thirdRailChargeGain(investedGold))} Charge.`;
    case 'jumpStart': return `Each Manual Reroll adds +${formatPlayerNumber(jumpStartChargeGain(investedGold))} Charge.`;
    case 'powerSurge': return 'Playing your highest-level Hand triples current Charge.';
    case 'fluxCapacitor': return `A Magnetic activation multiplies Charge by 1 + (${formatPlayerNumber(flameProgress(investedGold))} × other dice affected).`;
    case 'speedDemon': return `A Play within 1 second reaches ×${formatPlayerNumber(speedDemonMultiplier(investedGold, 0))} XMult; the bonus expires after 5 seconds.`;
    case 'sixPack': return `Each Round starts at ×${formatPlayerNumber(sixPackStartingMultiplier(investedGold))} XMult and loses ×${formatPlayerNumber(FLAME_SCALING.sixPack.upperDecay * flameProgress(investedGold))} after each Upper Hand.`;
    case 'minigun': return `Consecutive Upper Hands spin up from ×${formatPlayerNumber(minigunMultiplier(investedGold, 1))} to ×${formatPlayerNumber(minigunMultiplier(investedGold, 6))} XMult.`;
    case 'targetPractice': return `Target Hand gains ×${formatPlayerNumber(targetPracticeMultiplier(investedGold))} XMult.`;
    case 'fatCat': return `Five Played Golden or Jackpot dice reach ×${formatPlayerNumber(fatCatMultiplier(investedGold, 5))} XMult.`;
    case 'vineyard': return `Five Played Vintage dice reach ×${formatPlayerNumber(vineyardMultiplier(investedGold, 5))} XMult.`;
    case 'fetch': return `The marked FETCH face grants ×${formatPlayerNumber(standardFlameMultiplier(investedGold))} XMult, then moves.`;
    case 'hotStreak': return `A full top-to-bottom Lower Section Hand sequence reaches ×${formatPlayerNumber(hotStreakMultiplier(investedGold, HOT_STREAK_SEQUENCE.length))} XMult.`;
    case 'lowball': return `A majority of Played dice showing 1, 2, or 3 grants ×${formatPlayerNumber(lowballMultiplier(investedGold))} XMult.`;
    case 'straightShooter':
    case 'doubleDown':
    case 'threesCompany':
    case 'boxSet': return `The payoff reaches ×${formatPlayerNumber(handFamilyFlameMultiplier(id, investedGold))} XMult after its setup hand.`;
    case 'missingPair': return `Pair and Three of a Kind gain ×${formatPlayerNumber(missingPairMultiplier(investedGold))} XMult.`;
    case 'potentialEnergy': return `Playing a different Hand while Ultimate is playable adds +${formatPlayerNumber(potentialEnergyChargeGain(investedGold))} Charge.`;
    case 'allHandsOnDeck': return `Playing every available die adds ${formatPlayerNumber(FLAME_SCALING.allHandsOnDeck.chargePerDie * flameProgress(investedGold))} Charge per die.`;
    case 'casual': return `Ultimate gains ×${formatPlayerNumber(casualMultiplier(investedGold))} XMult before any Manual Reroll is used.`;
    case 'freeRealEstate': return `Free Plays gain ×${formatPlayerNumber(freeRealEstateMultiplier(investedGold))} XMult.`;
    case 'heavyHitters': return `Enhanced Played-die Pips grant ×${formatPlayerNumber(heavyHittersMultiplier(investedGold))} XMult.`;
    case 'frankenstein': return `A sufficiently enhancement-dense scoring group gains ×${formatPlayerNumber(frankensteinMultiplier(investedGold))} XMult.`;
    case 'highRoller': return `A majority of Played dice showing 4, 5, or 6 grants ×${formatPlayerNumber(highRollerMultiplier(investedGold))} XMult.`;
    case 'cleanSweep': return `The final Possible Hand completing the scorecard gains ×${formatPlayerNumber(cleanSweepMultiplier(investedGold))} XMult.`;
    case 'benchWarmer': return `Your lowest-level Hand gains ×${formatPlayerNumber(benchWarmerMultiplier(investedGold))} XMult.`;
    case 'epinephrine': return `Starting with exactly 1 Life gives the first Play ×${formatPlayerNumber(epinephrineMultiplier(investedGold))} XMult.`;
    case 'punchCard': return `Buying a die in the previous Shop gives the first Play ×${formatPlayerNumber(punchCardMultiplier(investedGold))} XMult.`;
    case 'blackHole': return `The first Play gains XMult for each Roster die missing at Round start.`;
    case 'assemblyLine': return `Five Played Clockwork dice reach ×${formatPlayerNumber(assemblyLineMultiplier(investedGold, 5))} XMult.`;
    case 'gymBros': return `Five Played Workout dice reach ×${formatPlayerNumber(gymBrosMultiplier(investedGold, 5))} XMult.`;
    case 'burnItDown': return `On Command, sacrifice your current Round Score to add up to +${formatPlayerNumber(burnItDownChargeGain(investedGold, 1))} Charge.`;
    case 'greaseTheEngine': return `On Command, pay escalating Gold for +${formatPlayerNumber(greaseTheEngineChargeGain(investedGold))} Charge.`;
    case 'lightningStrike': return `Predict one die's Manual Reroll for +${formatPlayerNumber(lightningStrikeChargeGain(investedGold))} Charge on a hit.`;
    case 'hotPotatoClock': return 'Avoid Playing the Hot Potato die to build increasingly large Charge.';
    case 'dareDevil': return `Each Dare stores more XMult for your next Ultimate Hand, up to ×${formatPlayerNumber(dareDevilMultiplier(investedGold, 4))}.`;
    case 'doubleOrNothing': return `Wager one of your three highest-level Possible Hands, then replay it later for ×${formatPlayerNumber(doubleOrNothingMultiplier(investedGold))} XMult.`;
    case 'allIn': return `Arm your next manual Play for ×${formatPlayerNumber(allInMultiplier(investedGold))} XMult; if it does not clear the Round, that Play's Score is removed.`;
    case 'topDown': return `Play Lower Section Hands from Five of a Kind down to Pair; the final step reaches ×${formatPlayerNumber(progressiveSequenceMultiplier('topDown', investedGold, 7))} XMult.`;
    case 'countDown': return `Play Upper Hands from Sixes down to Ones; the final step reaches ×${formatPlayerNumber(progressiveSequenceMultiplier('countDown', investedGold, 5))} XMult.`;
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
            : id === 'fluxCapacitor' ? `×${formatPlayerNumber(fluxCapacitorChargeMultiplier(investment, 1))} Charge when 1 other die is affected`
              : id === 'potentialEnergy' ? `+${formatPlayerNumber(potentialEnergyChargeGain(investment))} Charge per qualifying Play`
                : id === 'allHandsOnDeck' ? `+${formatPlayerNumber(allHandsOnDeckChargeGain(investment, 1))} Charge per available die`
                  : id === 'burnItDown' ? `up to +${formatPlayerNumber(burnItDownChargeGain(investment, 1))} Charge per sacrifice`
                    : id === 'greaseTheEngine' ? `+${formatPlayerNumber(greaseTheEngineChargeGain(investment))} Charge per bribe`
                      : id === 'lightningStrike' ? `+${formatPlayerNumber(lightningStrikeChargeGain(investment))} Charge on a correct prediction`
                        : `+${formatPlayerNumber(hotPotatoClockChargeGain(investment, 1))} Charge per current avoidance streak`;
    return { currentLabel: 'Current Effect', currentValue,
      maxChargeContribution: maxChargeContribution(investment) };
  }
  if (id === 'hotStreak') {
    return { currentLabel: 'Current XMult',
      currentValue: `×${formatPlayerNumber(hotStreakMultiplier(investment, board.hotStreakCharges))} at current chain`,
      maxChargeContribution: null };
  }
  if (id === 'topDown' || id === 'countDown') {
    const sequence = PROGRESSIVE_FLAME_SEQUENCES[id];
    const progress = Math.max(0, Math.min(sequence.hands.length, board.progressiveFlames[id] ?? 0));
    return { currentLabel: 'Current XMult',
      currentValue: progress >= sequence.hands.length
        ? `Complete · ${progress}/${sequence.hands.length}`
        : `Next: ${HANDS[sequence.hands[progress]].name} · ${progress}/${sequence.hands.length} · ×${formatPlayerNumber(progressiveSequenceMultiplier(id, investment, progress))}`,
      maxChargeContribution: null };
  }
  const multiplier = id === 'targetPractice' ? targetPracticeMultiplier(investment)
    : id === 'speedDemon' ? speedDemonMultiplier(investment, 0)
    : id === 'sixPack' ? sixPackStartingMultiplier(investment)
      : id === 'minigun' ? minigunMultiplier(investment, FLAME_SCALING.minigun.cappedStreak)
      : isHandFamilyFlame(id) ? handFamilyFlameMultiplier(id, investment)
        : id === 'lowball' ? lowballMultiplier(investment)
          : id === 'fatCat' ? fatCatMultiplier(investment, FLAME_SCALING.fatCat.maximumPlayedDice)
            : id === 'vineyard' ? vineyardMultiplier(investment, FLAME_SCALING.vineyard.maximumPlayedDice)
              : id === 'missingPair' ? missingPairMultiplier(investment)
                : id === 'casual' ? casualMultiplier(investment)
                  : id === 'freeRealEstate' ? freeRealEstateMultiplier(investment)
                    : id === 'heavyHitters' ? heavyHittersMultiplier(investment)
                      : id === 'frankenstein' ? frankensteinMultiplier(investment)
                        : id === 'highRoller' ? highRollerMultiplier(investment)
                          : id === 'cleanSweep' ? cleanSweepMultiplier(investment)
                            : id === 'benchWarmer' ? benchWarmerMultiplier(investment)
                              : id === 'epinephrine' ? epinephrineMultiplier(investment)
                                : id === 'punchCard' ? punchCardMultiplier(investment)
                                  : id === 'blackHole' ? blackHoleMultiplier(investment, 4)
                                    : id === 'assemblyLine' ? assemblyLineMultiplier(investment, 5)
                                      : id === 'gymBros' ? gymBrosMultiplier(investment, 5)
                                        : id === 'dareDevil' ? dareDevilMultiplier(investment, 4)
                                          : id === 'doubleOrNothing' ? doubleOrNothingMultiplier(investment)
                                            : id === 'allIn' ? allInMultiplier(investment)
                                              : standardFlameMultiplier(investment);
  return { currentLabel: 'Current XMult', currentValue: `up to ×${formatPlayerNumber(multiplier)}`,
    maxChargeContribution: null };
}

export function flameFullEffectText(id: Flame): string {
  return FLAMES[id].bonfireDescription;
}
export const isFlame = (value: unknown): value is Flame => typeof value === 'string' && Object.hasOwn(FLAMES, value);
export const FLAME_SLOT_COUNT = 5;
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
  if (!Array.isArray(state.flameSlots) || state.flameSlots.length !== FLAME_SLOT_COUNT) state.flameSlots = emptyFlameSlots();
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
  if (slot === undefined || slot < 0 || slot >= FLAME_SLOT_COUNT || state.flameSlots[slot] !== null)
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
  manualRerollsUsed: number;
  playSource: import('./types').HandPlaySource;
  roundPlayCount: number;
  roundStartLives: number;
  roundStartRosterSize: number;
  precedingShopDiePurchase: boolean;
  dareDevilCount: number;
  allIn: boolean;
  doubleOrNothingRedemption: boolean;
  previousPlays: number;
  ultimateHands: HandId[];
  ultimatePlayable: boolean;
  benchWarmerHand: HandId;
  targetPracticeHand: HandId | null;
  hotStreakGoal: HandId | null;
  hotStreakCharges: number;
  handFamilyFlameStages: Partial<Record<Flame, import('./types').HandFamilyFlameStage>>;
  progressiveFlames: import('./types').ProgressiveFlameRuntime;
  chargeXMult: number;
  chargeArmed: boolean;
  speedDemonDecisionMs: number | null;
  sixPackXMult: number;
  sixPackUpperHandsPlayed: number;
  minigunUpperStreak: number;
  lastPlayDanger: import('./bosses').LastPlayDanger;
  selectedDieIds: number[];
  availablePlayableDieIds: number[];
  playedDiceScoringPips: number;
  cleanSweepCompletesCycle: boolean;
  scoringDiceEnhancementCount: number;
  bossFactor: number;
  lifetimeNormalShopGoldSpent: number;
  flames: FlameInstance[];
  fetchTarget: { dieId: number; physicalFace: import('./types').Rank } | null;
  dice: { dieId: number; rosterSlot: number | null; faceValue: number; physicalFace: import('./types').Rank;
    activeEffects: SpecialDieType[]; enhancementCount: number }[];
}

export function captureHandStart(state: Pick<GameState, 'score' | 'target' | 'engulfmentLevel' | 'gold' | 'manualRerollsRemaining' | 'manualRerollsUsedThisRound' | 'specialOfferEffects' | 'handPlayCounts' | 'handLevels' | 'targetPracticeHand' | 'hotStreakGoal' | 'hotStreakCharges' | 'handFamilyFlameStages' | 'progressiveFlames' | 'chargeXMult' | 'chargeArmed' | 'sixPackXMult' | 'sixPackUpperHandsPlayed' | 'minigunUpperStreak' | 'flameSlots' | 'dice' | 'dieRoundState' | 'lifetimeNormalShopGoldSpent' | 'boss' | 'bossSilenced' | 'consumed' | 'scorecardCycleConsumed' | 'fetchTarget' | 'roundPlayCount' | 'roundStartLives' | 'roundStartRosterSize' | 'precedingShopDiePurchase' | 'interactiveFlames'>, hand: HandId, selectedDieIds: number[], speedDemonDecisionMs: number | null = null, playSource: import('./types').HandPlaySource = 'manual', wager: { allIn?: boolean; doubleOrNothingRedemption?: boolean } = {}): HandStartSnapshot {
  const ultimate = ultimateHands(state.handLevels);
  const availableDice = availablePlayableDice(state);
  return {
    score: state.score,
    target: state.target,
    infernoMultiplier: infernoMultiplier(state.engulfmentLevel),
    gold: state.gold,
    manualRerollsRemaining: state.manualRerollsRemaining,
    manualRerollsUsed: state.manualRerollsUsedThisRound,
    playSource,
    roundPlayCount: state.roundPlayCount,
    roundStartLives: state.roundStartLives,
    roundStartRosterSize: state.roundStartRosterSize,
    precedingShopDiePurchase: state.precedingShopDiePurchase,
    dareDevilCount: state.interactiveFlames.dareDevilCount,
    allIn: wager.allIn === true,
    doubleOrNothingRedemption: wager.doubleOrNothingRedemption === true,
    previousPlays: state.handPlayCounts[hand],
    ultimateHands: ultimate,
    ultimatePlayable: ultimate.some(target => currentlyPlayableManualHands(state).includes(target)),
    benchWarmerHand: benchWarmerHand(state.handLevels),
    targetPracticeHand: state.targetPracticeHand,
    hotStreakGoal: state.hotStreakGoal,
    hotStreakCharges: state.hotStreakCharges,
    handFamilyFlameStages: { ...state.handFamilyFlameStages },
    progressiveFlames: { ...state.progressiveFlames },
    chargeXMult: state.chargeXMult,
    chargeArmed: state.chargeArmed,
    speedDemonDecisionMs,
    sixPackXMult: state.sixPackXMult,
    sixPackUpperHandsPlayed: state.sixPackUpperHandsPlayed,
    minigunUpperStreak: state.minigunUpperStreak,
    lastPlayDanger: lastPlayDanger(state, hand),
    selectedDieIds: [...selectedDieIds],
    availablePlayableDieIds: availableDice.map(die => die.id),
    playedDiceScoringPips: 0,
    cleanSweepCompletesCycle: false,
    scoringDiceEnhancementCount: 0,
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
      activeEffects: die.owner === 'player' && !wholeDieEffectSuppressed(die)
        ? [...new Set(die.effects.map(effect => effect.type))] : [],
      enhancementCount: die.owner === 'player' ? die.effects.length : 0 })),
  };
}

export const playedDice = (snapshot: HandStartSnapshot) => {
  const selected = new Set(snapshot.selectedDieIds);
  return snapshot.dice.filter(die => selected.has(die.dieId));
};

/** Counts selected/Played dice with at least one requested active effect. Each die counts at most once. */
export function countPlayedDiceWithActiveEffects(snapshot: HandStartSnapshot,
  requestedEffects: readonly SpecialDieType[]): number {
  const requested = new Set<SpecialDieType>(requestedEffects);
  return playedDice(snapshot).filter(die => die.activeEffects.some(effect => requested.has(effect))).length;
}

export function playedDiceFaceMajorityCounts(snapshot: HandStartSnapshot, faces: readonly number[]): {
  played: number; matching: number; qualifies: boolean;
} {
  const dice = playedDice(snapshot);
  const requested = new Set(faces);
  const matching = dice.filter(die => requested.has(die.faceValue)).length;
  return { played: dice.length, matching, qualifies: matching > dice.length / 2 };
}
export function lowballPlayedDiceCounts(snapshot: HandStartSnapshot): { played: number; low: number; qualifies: boolean } {
  const { played, matching, qualifies } = playedDiceFaceMajorityCounts(snapshot, [1, 2, 3]);
  return { played, low: matching, qualifies };
}
export function highRollerPlayedDiceCounts(snapshot: HandStartSnapshot): { played: number; high: number; qualifies: boolean } {
  const { played, matching, qualifies } = playedDiceFaceMajorityCounts(snapshot, [4, 5, 6]);
  return { played, high: matching, qualifies };
}
export function countScoringDiceEnhancementComponents(snapshot: HandStartSnapshot, scoringDieIds: readonly number[]): number {
  const scoring = new Set(scoringDieIds);
  return snapshot.dice.filter(die => scoring.has(die.dieId)).reduce((sum, die) => sum + die.enhancementCount, 0);
}

const qualifies = (id: Flame, snapshot: HandStartSnapshot, hand: HandId, scoringDieIds: number[]) => {
  switch (id) {
    case 'ultimate': return snapshot.ultimateHands.includes(hand);
    case 'minigun': return UPPER_HAND_IDS.includes(hand);
    case 'hailMary': return snapshot.manualRerollsRemaining === 0;
    case 'fullOfGrace': return snapshot.lastPlayDanger !== 'none';
    case 'lowball': return lowballPlayedDiceCounts(snapshot).qualifies;
    case 'highRoller': return highRollerPlayedDiceCounts(snapshot).qualifies;
    case 'targetPractice': return hand === snapshot.targetPracticeHand;
    case 'fatCat': return countPlayedDiceWithActiveEffects(snapshot, ['golden', 'jackpot']) > 0;
    case 'vineyard': return countPlayedDiceWithActiveEffects(snapshot, ['vintage']) > 0;
    case 'fetch': return snapshot.fetchTarget !== null && snapshot.dice.some(die => scoringDieIds.includes(die.dieId)
      && die.dieId === snapshot.fetchTarget!.dieId && die.physicalFace === snapshot.fetchTarget!.physicalFace);
    case 'straightShooter':
    case 'doubleDown':
    case 'threesCompany':
    case 'boxSet': return snapshot.handFamilyFlameStages[id] === 'payoff' && hand === HAND_FAMILY_FLAMES[id].payoff;
    case 'missingPair': return hand === 'pair' || hand === 'threeKind';
    case 'oneShort': return hand === 'smallStraight' || hand === 'fourKind';
    case 'casual': return snapshot.ultimateHands.includes(hand) && snapshot.manualRerollsUsed === 0;
    case 'freeRealEstate': return snapshot.playSource !== 'manual';
    case 'heavyHitters': return snapshot.playedDiceScoringPips > playedDice(snapshot)
      .reduce((sum, die) => sum + die.faceValue, 0);
    case 'frankenstein': return snapshot.scoringDiceEnhancementCount > 2 * snapshot.selectedDieIds.length;
    case 'cleanSweep': return snapshot.cleanSweepCompletesCycle;
    case 'benchWarmer': return hand === snapshot.benchWarmerHand;
    case 'epinephrine': return snapshot.roundStartLives === 1 && snapshot.roundPlayCount === 0;
    case 'punchCard': return snapshot.precedingShopDiePurchase && snapshot.roundPlayCount === 0;
    case 'blackHole': return snapshot.roundStartRosterSize < 5 && snapshot.roundPlayCount === 0;
    case 'assemblyLine': return countPlayedDiceWithActiveEffects(snapshot, ['clockwork']) > 0;
    case 'gymBros': return countPlayedDiceWithActiveEffects(snapshot, ['workout']) > 0;
    case 'dareDevil': return snapshot.dareDevilCount > 0 && snapshot.ultimateHands.includes(hand);
    case 'doubleOrNothing': return snapshot.playSource === 'manual' && snapshot.doubleOrNothingRedemption;
    case 'allIn': return snapshot.playSource === 'manual' && snapshot.allIn;
    case 'topDown':
    case 'countDown': {
      const sequence = PROGRESSIVE_FLAME_SEQUENCES[id];
      return sequence.hands[snapshot.progressiveFlames[id]] === hand;
    }
    case 'hotStreak': return hand === snapshot.hotStreakGoal;
    case 'speedDemon': return snapshot.speedDemonDecisionMs !== null;
    default: return true;
  }
};
function factorValue(id: Flame, investedGold: number, snapshot: HandStartSnapshot, _scoringDieIds: number[]): number {
  switch (id) {
    case 'targetPractice': return targetPracticeMultiplier(investedGold);
    case 'minigun': return minigunMultiplier(investedGold, snapshot.minigunUpperStreak + 1);
    case 'lowball': return lowballMultiplier(investedGold);
    case 'fatCat': return fatCatMultiplier(investedGold, countPlayedDiceWithActiveEffects(snapshot, ['golden', 'jackpot']));
    case 'vineyard': return vineyardMultiplier(investedGold, countPlayedDiceWithActiveEffects(snapshot, ['vintage']));
    case 'hotStreak': return hotStreakMultiplier(investedGold, snapshot.hotStreakCharges + 1);
    case 'speedDemon': return speedDemonMultiplier(investedGold, snapshot.speedDemonDecisionMs ?? 10000);
    case 'sixPack': return snapshot.sixPackXMult;
    case 'straightShooter':
    case 'doubleDown':
    case 'threesCompany':
    case 'boxSet': return handFamilyFlameMultiplier(id, investedGold);
    case 'missingPair': return missingPairMultiplier(investedGold);
    case 'highRoller': return highRollerMultiplier(investedGold);
    case 'casual': return casualMultiplier(investedGold);
    case 'freeRealEstate': return freeRealEstateMultiplier(investedGold);
    case 'heavyHitters': return heavyHittersMultiplier(investedGold);
    case 'frankenstein': return frankensteinMultiplier(investedGold);
    case 'cleanSweep': return cleanSweepMultiplier(investedGold);
    case 'benchWarmer': return benchWarmerMultiplier(investedGold);
    case 'epinephrine': return epinephrineMultiplier(investedGold);
    case 'punchCard': return punchCardMultiplier(investedGold);
    case 'blackHole': return blackHoleMultiplier(investedGold, Math.max(0, 5 - snapshot.roundStartRosterSize));
    case 'assemblyLine': return assemblyLineMultiplier(investedGold, countPlayedDiceWithActiveEffects(snapshot, ['clockwork']));
    case 'gymBros': return gymBrosMultiplier(investedGold, countPlayedDiceWithActiveEffects(snapshot, ['workout']));
    case 'dareDevil': return dareDevilMultiplier(investedGold, snapshot.dareDevilCount);
    case 'doubleOrNothing': return doubleOrNothingMultiplier(investedGold);
    case 'allIn': return allInMultiplier(investedGold);
    case 'topDown':
    case 'countDown': return progressiveSequenceMultiplier(id, investedGold, snapshot.progressiveFlames[id]);
    default: return standardFlameMultiplier(investedGold);
  }
}
function factorInput(id: Flame, snapshot: HandStartSnapshot, _scoringDieIds: number[]): {
  input?: number; detail?: string; diagnostics?: FlameActivationDiagnostics;
} {
  if (id === 'fatCat') {
    const matching = countPlayedDiceWithActiveEffects(snapshot, ['golden', 'jackpot']);
    return { input: matching, detail: `${matching} matching Played dice`, diagnostics: {
      playedDiceCount: snapshot.selectedDieIds.length, matchingPlayedDiceCount: matching } };
  }
  if (id === 'vineyard') {
    const matching = countPlayedDiceWithActiveEffects(snapshot, ['vintage']);
    return { input: matching, detail: `${matching} matching Played dice`, diagnostics: {
      playedDiceCount: snapshot.selectedDieIds.length, matchingPlayedDiceCount: matching } };
  }
  if (id === 'assemblyLine' || id === 'gymBros') {
    const matching = countPlayedDiceWithActiveEffects(snapshot, [id === 'assemblyLine' ? 'clockwork' : 'workout']);
    return { input: matching, detail: `${matching} matching Played dice`, diagnostics: {
      playedDiceCount: snapshot.selectedDieIds.length, matchingPlayedDiceCount: matching } };
  }
  if (id === 'fetch' && snapshot.fetchTarget) {
    const slot = snapshot.dice.find(die => die.dieId === snapshot.fetchTarget!.dieId)?.rosterSlot;
    return { detail: `FETCH target ${slot === null || slot === undefined ? `die #${snapshot.fetchTarget.dieId}` : `D${slot + 1}`} face ${snapshot.fetchTarget.physicalFace}` };
  }
  if (id === 'lowball') {
    const counts = lowballPlayedDiceCounts(snapshot);
    return { input: counts.low, detail: `${counts.low} of ${counts.played} Played dice showed 1–3`, diagnostics: {
      playedDiceCount: counts.played, qualifyingLowFaceCount: counts.low } };
  }
  if (id === 'highRoller') {
    const counts = highRollerPlayedDiceCounts(snapshot);
    return { input: counts.high, detail: `${counts.high} of ${counts.played} Played dice showed 4–6`, diagnostics: {
      playedDiceCount: counts.played, qualifyingHighFaceCount: counts.high } };
  }
  if (id === 'casual') return { diagnostics: { ultimateHand: snapshot.ultimateHands[0],
    manualRerollsUsed: snapshot.manualRerollsUsed } };
  if (id === 'freeRealEstate') return { diagnostics: { freePlaySource: snapshot.playSource } };
  if (id === 'heavyHitters') return { diagnostics: {
    playedFaceValueTotal: playedDice(snapshot).reduce((sum, die) => sum + die.faceValue, 0),
    playedDiceScoringPips: snapshot.playedDiceScoringPips } };
  if (id === 'frankenstein') return { diagnostics: { scoringDiceEnhancementCount: snapshot.scoringDiceEnhancementCount,
    playedDiceCount: snapshot.selectedDieIds.length, enhancementThreshold: 2 * snapshot.selectedDieIds.length } };
  if (id === 'cleanSweep') return { diagnostics: { scorecardCycleCompletion: true } };
  if (id === 'benchWarmer') return { diagnostics: { benchWarmerHand: snapshot.benchWarmerHand } };
  if (id === 'epinephrine') return { diagnostics: { roundStartLives: snapshot.roundStartLives } };
  if (id === 'punchCard') return { diagnostics: { precedingShopDiePurchase: snapshot.precedingShopDiePurchase } };
  if (id === 'blackHole') return { input: Math.max(0, 5 - snapshot.roundStartRosterSize), diagnostics: {
    roundStartRosterSize: snapshot.roundStartRosterSize, missingRosterDice: Math.max(0, 5 - snapshot.roundStartRosterSize) } };
  if (id === 'dareDevil') return { input: snapshot.dareDevilCount, diagnostics: {
    dareCount: snapshot.dareDevilCount, storedUltimateFactor: dareDevilMultiplier(
      snapshot.flames.find(flame => flame.type === 'dareDevil')?.investedGold ?? 0, snapshot.dareDevilCount),
    ultimateHand: snapshot.ultimateHands[0] } };
  if (id === 'sixPack') return { input: snapshot.sixPackUpperHandsPlayed, diagnostics: {
    currentFactor: snapshot.sixPackXMult, upperDecayStep: snapshot.sixPackUpperHandsPlayed } };
  if (id === 'minigun') return { input: snapshot.minigunUpperStreak + 1, diagnostics: {
    upperStreak: snapshot.minigunUpperStreak + 1 } };
  if (id === 'speedDemon') return { input: snapshot.speedDemonDecisionMs ?? undefined,
    diagnostics: { decisionMs: snapshot.speedDemonDecisionMs ?? undefined } };
  if (id === 'hotStreak') return { input: snapshot.hotStreakCharges + 1, detail: `successful sequence charge ${formatPlayerNumber(snapshot.hotStreakCharges + 1)}` };
  if (id === 'topDown' || id === 'countDown') {
    const step = snapshot.progressiveFlames[id];
    const required = PROGRESSIVE_FLAME_SEQUENCES[id].hands[step];
    return { input: step + 1, detail: `sequence step ${step + 1}`,
      diagnostics: { sequenceStepIndex: step, sequenceRequiredHand: required,
        sequenceCompleted: step + 1 >= PROGRESSIVE_FLAME_SEQUENCES[id].hands.length } };
  }
  return {};
}
function contributions(snapshot: HandStartSnapshot, hand: HandId, scoringDieIds: number[]): XMultFactor[] {
  const result: XMultFactor[] = [];
  if (snapshot.chargeArmed && snapshot.chargeXMult > 1) result.push({ source: 'charge', value: snapshot.chargeXMult, dieId: null, detail: 'armed stored Charge' });
  for (const flame of snapshot.flames) {
    const id = flame.type;
    if (!FLAMES[id]?.affectsXMult || isChargeFlame(id) || !qualifies(id, snapshot, hand, scoringDieIds)) continue;
    const value = factorValue(id, flame.investedGold, snapshot, scoringDieIds);
    if (value > 1 || id === 'speedDemon' || id === 'fetch' || isHandFamilyFlame(id)) {
      const context = factorInput(id, snapshot, scoringDieIds);
      result.push({ source: id, value, dieId: null, flameInstanceId: flame.instanceId, ...context,
        diagnostics: { ...context.diagnostics, currentFactor: value },
        detail: `${flame.stage === 'bonfire' ? 'Bonfire' : 'Ember'}${context.detail ? `; ${context.detail}` : ''}` });
    }
  }
  return result;
}
export function handXMultContributions(snapshot: HandStartSnapshot, hand: HandId, _handLevel: number, scoringDieIds: number[]): XMultFactor[] {
  return contributions(snapshot, hand, scoringDieIds);
}
export const composeXMult = (factors: readonly (number | XMultFactor)[]) =>
  Number(factors.map(item => typeof item === 'number' ? item : item.value).sort((a, b) => a - b)
    .reduce((product, value) => product * value, 1).toFixed(12));
export const ownedFlameIds = (state: Pick<Board, 'flameSlots'>) => new Set<Flame>(flameInstances(state).map(flame => flame.type));
const hasBuildDie = (state: Pick<GameState, 'dice'>, types: readonly import('./types').DieType[]) =>
  state.dice.some(die => die.owner === 'player' && die.effects.some(effect => types.includes(effect.type)));
export const FREE_PLAY_EFFECT_TYPES = ['freePlay', 'jumpingBean'] as const satisfies readonly SpecialDieType[];
export const buildCanProduceFreePlays = (state: Pick<GameState, 'dice'>) => hasBuildDie(state, FREE_PLAY_EFFECT_TYPES);

/** Build prerequisites required by actual Flame activation paths. Self-enabling Flames remain unrestricted. */
export function flameEligible(state: Pick<GameState, 'dice' | 'flameSlots'>, id: Flame): boolean {
  if (id === 'fatCat') return hasBuildDie(state, ['golden', 'jackpot']);
  if (id === 'vineyard') return hasBuildDie(state, ['vintage']);
  if (id === 'fluxCapacitor') return hasBuildDie(state, ['magnetic']);
  if (id === 'freeRealEstate') return buildCanProduceFreePlays(state);
  if (id === 'assemblyLine') return hasBuildDie(state, ['clockwork']);
  if (id === 'gymBros') return hasBuildDie(state, ['workout']);
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
