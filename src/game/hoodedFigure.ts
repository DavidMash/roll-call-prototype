import { activeFace } from './dice';
import { magneticPullCapable, stacks } from './enhancements';
import { FLAMES, isChargeFlame } from './flames';
import { LOWER_HAND_IDS, UPPER_HAND_IDS } from './hands';
import { randomIndex } from './rng';
import type {
  ActiveHoodedChallenge, Board, BonfireContribution, ChallengeId, ChallengeProgress,
  Flame, GameState, HandId, MiniBossType, RandomSource, Wildfire, WildfireResolved,
} from './types';

export const HOODED_FIGURE_CONFIG = {
  minimumChapter: 5,
  minimumOrdinaryBonfires: 5,
  sacrificePremium: 1.25,
  beanSaladPerFace: 6,
  vintagePerFace: 4,
  magneticPerFace: 3,
  workoutPerStack: 3,
} as const;

export type ChallengeScope = 'chapter' | 'round';
export interface ChallengeDefinition {
  id: ChallengeId;
  name: string;
  short: string;
  full: string;
  scope: ChallengeScope;
  baseTarget: number;
  eligible: (state: Pick<GameState, 'dice' | 'bossSchedule' | 'round'>, miniBoss: MiniBossType) => boolean;
  target: (state: Pick<GameState, 'dice'>) => number;
}

const physicalFacesWith = (state: Pick<GameState, 'dice'>, enhancement: import('./types').Enhancement) =>
  state.dice.filter(die => die.owner === 'player').flatMap(die => die.faces)
    .filter(face => stacks(face, enhancement) > 0).length;
const totalStacks = (state: Pick<GameState, 'dice'>, enhancement: import('./types').Enhancement) =>
  state.dice.filter(die => die.owner === 'player').flatMap(die => die.faces)
    .reduce((sum, face) => sum + stacks(face, enhancement), 0);
const distinctEnhancements = (state: Pick<GameState, 'dice'>) => new Set(state.dice
  .filter(die => die.owner === 'player').flatMap(die => die.faces)
  .flatMap(face => Object.entries(face.enhancements).filter(([, count]) => (count ?? 0) > 0).map(([id]) => id))).size;
const always = () => true;
const fixed = (target: number) => () => target;

export const CHALLENGES: Record<ChallengeId, ChallengeDefinition> = {
  fiveAlive: { id: 'fiveAlive', name: 'Five Alive', short: 'play 3 Five of a Kinds', full: 'Manually play Five of a Kind 3 times across R1–R3.', scope: 'chapter', baseTarget: 3, eligible: always, target: fixed(3) },
  theLongWay: { id: 'theLongWay', name: 'The Long Way', short: 'play 3 Large Straights', full: 'Manually play Large Straight 3 times across R1–R3.', scope: 'chapter', baseTarget: 3, eligible: always, target: fixed(3) },
  upperClass: { id: 'upperClass', name: 'Upper Class', short: 'play all 6 Upper hands in one Round', full: 'In one successfully cleared Round, manually play Ones, Twos, Threes, Fours, Fives, and Sixes.', scope: 'round', baseTarget: 6, eligible: always, target: fixed(6) },
  lowerClass: { id: 'lowerClass', name: 'Lower Class', short: 'play every Lower hand', full: 'Across R1–R3, manually play Pair, Two Pair, Three of a Kind, Full House, Four of a Kind, Five of a Kind, Small Straight, and Large Straight.', scope: 'chapter', baseTarget: 8, eligible: always, target: fixed(8) },
  varietyPack: { id: 'varietyPack', name: 'Variety Pack', short: 'play 5 different Lower hands in one Round', full: 'Manually play five distinct Lower-hand types during one successfully cleared Round.', scope: 'round', baseTarget: 5, eligible: always, target: fixed(5) },
  closeCall: { id: 'closeCall', name: 'Close Call', short: 'clear a Round within 10% of its Goal', full: 'Successfully clear a challenge Round with a final score from 100% through 110% of its Goal.', scope: 'round', baseTarget: 1, eligible: always, target: fixed(1) },
  noTakebacks: { id: 'noTakebacks', name: 'No Takebacks', short: 'clear a Round without using a Reroll', full: 'Clear one Round without using any player-initiated manual Reroll.', scope: 'round', baseTarget: 1, eligible: (_state, miniBoss) => miniBoss !== 'tightrope', target: fixed(1) },
  upperManagement: { id: 'upperManagement', name: 'Upper Management', short: 'clear a Round using only Upper hands', full: 'Clear one Round where every manually selected scorecard hand is an Upper hand. Free plays do not spoil this.', scope: 'round', baseTarget: 1, eligible: always, target: fixed(1) },
  rollCall: { id: 'rollCall', name: 'Roll Call', short: 'score every face from 1 through 6 in one Round', full: 'During one successfully cleared Round, every printed die value from 1 through 6 must participate in a genuine scoring event.', scope: 'round', baseTarget: 6, eligible: always, target: fixed(6) },
  lowProfile: { id: 'lowProfile', name: 'Low Profile', short: 'clear a Round without scoring a 5 or 6', full: 'Clear one Round without any genuine scoring event containing a printed 5 or 6.', scope: 'round', baseTarget: 1, eligible: always, target: fixed(1) },
  oppositesAttract: { id: 'oppositesAttract', name: 'Opposites Attract', short: 'score 4 hands containing both a 1 and a 6', full: 'Across R1–R3, have four genuine scoring events that each contain both a printed 1 and a printed 6.', scope: 'chapter', baseTarget: 4, eligible: always, target: fixed(4) },
  beanSalad: { id: 'beanSalad', name: 'Bean Salad', short: 'trigger Jumping Bean {N} times', full: 'Trigger Jumping Bean {N} times across R1–R3.', scope: 'chapter', baseTarget: 0, eligible: state => physicalFacesWith(state, 'jumpingBean') >= 1, target: state => HOODED_FIGURE_CONFIG.beanSaladPerFace * physicalFacesWith(state, 'jumpingBean') },
  bonusRound: { id: 'bonusRound', name: 'Bonus Round', short: 'activate Bonus {N} times in one Round', full: 'During one successfully cleared Round, activate a Bonus-bearing physical face {N} times.', scope: 'round', baseTarget: 0, eligible: state => physicalFacesWith(state, 'bonus') >= 3, target: state => physicalFacesWith(state, 'bonus') },
  goldRush: { id: 'goldRush', name: 'Gold Rush', short: 'activate Golden {N} times in one Round', full: 'During one successfully cleared Round, activate a Golden-bearing physical face {N} times.', scope: 'round', baseTarget: 0, eligible: state => physicalFacesWith(state, 'golden') >= 3, target: state => physicalFacesWith(state, 'golden') },
  agedToPerfection: { id: 'agedToPerfection', name: 'Aged to Perfection', short: 'score Vintage {N} times', full: 'Score Vintage-bearing physical faces {N} times across R1–R3.', scope: 'chapter', baseTarget: 0, eligible: state => physicalFacesWith(state, 'vintage') >= 1, target: state => HOODED_FIGURE_CONFIG.vintagePerFace * physicalFacesWith(state, 'vintage') },
  magneticPersonality: { id: 'magneticPersonality', name: 'Magnetic Personality', short: 'pull {N} faces with Magnetic', full: 'Accumulate {N} destination-face pulls caused by Magnetic across R1–R3.', scope: 'chapter', baseTarget: 0, eligible: state => magneticPullCapable(state.dice), target: state => HOODED_FIGURE_CONFIG.magneticPerFace * physicalFacesWith(state, 'magnetic') },
  jackpot: { id: 'jackpot', name: 'Jackpot!', short: 'trigger Jackpot in 2 different Rounds', full: 'Jackpot must genuinely pay on the clearing hand of two different successfully completed challenge Rounds.', scope: 'chapter', baseTarget: 2, eligible: state => physicalFacesWith(state, 'jackpot') >= 1, target: fixed(2) },
  getYourRepsIn: { id: 'getYourRepsIn', name: 'Get Your Reps In', short: 'activate {N} Workout stacks', full: 'Accumulate {N} actual Workout-stack activations across R1–R3.', scope: 'chapter', baseTarget: 0, eligible: state => totalStacks(state, 'workout') >= 3, target: state => HOODED_FIGURE_CONFIG.workoutPerStack * totalStacks(state, 'workout') },
  fullyLoaded: { id: 'fullyLoaded', name: 'Fully Loaded', short: 'score 3 hands using at least 3 Enhancement types', full: 'Have three genuine scoring events where scoring dice collectively contain at least three distinct Enhancement types.', scope: 'chapter', baseTarget: 3, eligible: state => distinctEnhancements(state) >= 3, target: fixed(3) },
};
export const CHALLENGE_IDS = Object.keys(CHALLENGES) as ChallengeId[];

export const emptyChallengeProgress = (): ChallengeProgress => ({ value: 0, keys: [], invalid: false, jackpotPaid: false });
export const cloneProgress = (progress: ChallengeProgress): ChallengeProgress => ({ ...progress, keys: [...progress.keys] });

export function eligibleChallenges(state: Pick<GameState, 'dice' | 'bossSchedule' | 'round'>, miniBoss: MiniBossType): ChallengeDefinition[] {
  return CHALLENGE_IDS.map(id => CHALLENGES[id]).filter(definition => definition.eligible(state, miniBoss));
}

export function selectChallenge(state: Pick<GameState, 'dice' | 'bossSchedule' | 'round'>, miniBoss: MiniBossType,
  previous: ChallengeId | null, rng: RandomSource): ChallengeDefinition | null {
  const eligible = eligibleChallenges(state, miniBoss);
  if (!eligible.length) return null;
  const withoutPrevious = eligible.filter(item => item.id !== previous);
  const pool = withoutPrevious.length ? withoutPrevious : eligible;
  return pool[randomIndex(rng, pool.length)];
}

export function createActiveChallenge(definition: ChallengeDefinition, state: Pick<GameState, 'dice'>, chapter: number,
  dialogueLine: string): ActiveHoodedChallenge {
  const target = definition.target(state);
  const committed = emptyChallengeProgress();
  return { id: definition.id, issuedChapter: chapter, target, committed, attempt: cloneProgress(committed),
    complete: false, dialogueLine };
}

export function challengeText(challenge: ActiveHoodedChallenge, kind: 'short' | 'full'): string {
  return CHALLENGES[challenge.id][kind].replaceAll('{N}', String(challenge.target));
}

export function beginChallengeRound(challenge: ActiveHoodedChallenge): void {
  if (challenge.complete) return;
  challenge.attempt = CHALLENGES[challenge.id].scope === 'chapter'
    ? cloneProgress(challenge.committed) : emptyChallengeProgress();
  challenge.attempt.jackpotPaid = false;
}

const addKey = (progress: ChallengeProgress, key: string) => {
  if (!progress.keys.includes(key)) progress.keys.push(key);
  progress.value = progress.keys.length;
};

export function observeManualHand(challenge: ActiveHoodedChallenge | null, hand: HandId): void {
  if (!challenge || challenge.complete) return;
  const progress = challenge.attempt;
  if (challenge.id === 'fiveAlive' && hand === 'fiveKind') progress.value++;
  else if (challenge.id === 'theLongWay' && hand === 'largeStraight') progress.value++;
  else if (challenge.id === 'upperClass' && UPPER_HAND_IDS.includes(hand)) addKey(progress, hand);
  else if (challenge.id === 'lowerClass' && LOWER_HAND_IDS.includes(hand)) addKey(progress, hand);
  else if (challenge.id === 'varietyPack' && LOWER_HAND_IDS.includes(hand)) addKey(progress, hand);
  else if (challenge.id === 'upperManagement' && !UPPER_HAND_IDS.includes(hand)) progress.invalid = true;
}

export interface ChallengeScoringFace {
  printed: number;
  enhancements: Partial<Record<import('./types').Enhancement, number>>;
  /** Mirrors the authoritative stacks() rule: infected faces cannot activate Enhancements. */
  enhancementsActive?: boolean;
}
export function observeScoringEvent(challenge: ActiveHoodedChallenge | null, faces: ChallengeScoringFace[], playSource: import('./types').HandPlaySource): void {
  if (!challenge || challenge.complete) return;
  const progress = challenge.attempt;
  const printed = new Set(faces.map(face => face.printed));
  if (challenge.id === 'rollCall') {
    for (const value of printed) if (value >= 1 && value <= 6) addKey(progress, String(value));
  }
  else if (challenge.id === 'lowProfile' && (printed.has(5) || printed.has(6))) progress.invalid = true;
  else if (challenge.id === 'oppositesAttract' && printed.has(1) && printed.has(6)) progress.value++;
  else if (challenge.id === 'beanSalad' && playSource === 'jumpingBean') progress.value++;
  else if (challenge.id === 'bonusRound') progress.value += faces.filter(face => face.enhancementsActive !== false && (face.enhancements.bonus ?? 0) > 0).length;
  else if (challenge.id === 'goldRush') progress.value += faces.filter(face => face.enhancementsActive !== false && (face.enhancements.golden ?? 0) > 0).length;
  else if (challenge.id === 'agedToPerfection') progress.value += faces.filter(face => face.enhancementsActive !== false && (face.enhancements.vintage ?? 0) > 0).length;
  else if (challenge.id === 'getYourRepsIn') progress.value += faces.reduce((sum, face) => sum
    + (face.enhancementsActive === false ? 0 : face.enhancements.workout ?? 0), 0);
  else if (challenge.id === 'fullyLoaded') {
    const types = new Set(faces.flatMap(face => Object.entries(face.enhancements)
      .filter(([, count]) => (count ?? 0) > 0).map(([id]) => id)));
    if (types.size >= 3) progress.value++;
  }
}

export function observeManualReroll(challenge: ActiveHoodedChallenge | null): void {
  if (challenge?.id === 'noTakebacks' && !challenge.complete) challenge.attempt.invalid = true;
}
export function observeMagneticPulls(challenge: ActiveHoodedChallenge | null, count: number): void {
  if (challenge?.id === 'magneticPersonality' && !challenge.complete) challenge.attempt.value += count;
}
export function observeClearingJackpot(challenge: ActiveHoodedChallenge | null, paid: boolean): void {
  if (challenge?.id === 'jackpot' && !challenge.complete && paid) challenge.attempt.jackpotPaid = true;
}

export function displayedChallengeProgress(challenge: ActiveHoodedChallenge): number {
  return challenge.complete ? challenge.target : Math.min(challenge.target, challenge.attempt.value);
}

export function completeChallengeRound(challenge: ActiveHoodedChallenge | null, finalScore: number, goal: number): boolean {
  if (!challenge || challenge.complete) return false;
  const definition = CHALLENGES[challenge.id];
  const attempt = challenge.attempt;
  if (challenge.id === 'closeCall' && finalScore >= goal && finalScore * 10 <= goal * 11) attempt.value = 1;
  if (challenge.id === 'noTakebacks' && !attempt.invalid) attempt.value = 1;
  if (challenge.id === 'upperManagement' && !attempt.invalid) attempt.value = 1;
  if (challenge.id === 'lowProfile' && !attempt.invalid) attempt.value = 1;
  if (challenge.id === 'jackpot' && attempt.jackpotPaid) attempt.value = challenge.committed.value + 1;
  const satisfied = attempt.value >= challenge.target;
  if (definition.scope === 'chapter' || satisfied) challenge.committed = cloneProgress(attempt);
  challenge.complete = satisfied;
  return satisfied;
}

export function challengeRoundsRemaining(board: Pick<Board, 'round'>): number {
  return Math.max(1, 4 - (((board.round - 1) % 6) + 1));
}

export function contributionAverage(entry: BonfireContribution | undefined): number {
  return entry && entry.roundCount > 0 ? entry.factorSum / entry.roundCount : 1;
}
export function weightedRoundFactor(observations: readonly { factor: number; weight: number }[]): number {
  const totalWeight = observations.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  return totalWeight > 0 ? observations.reduce((sum, item) => sum + Math.max(0, item.weight) * Math.max(1, item.factor), 0) / totalWeight : 1;
}
export function rankedRecipients(state: Pick<GameState, 'bonfires' | 'bonfireContributions'>): Flame[] {
  return [...state.bonfires].sort((a, b) => contributionAverage(state.bonfireContributions[a]) - contributionAverage(state.bonfireContributions[b]) || a.localeCompare(b)).slice(0, 3);
}
export function rankedSacrifices(state: Pick<GameState, 'bonfires' | 'bonfireContributions'>, recipient: Flame): Flame[] {
  return state.bonfires.filter(id => id !== recipient)
    .sort((a, b) => contributionAverage(state.bonfireContributions[b]) - contributionAverage(state.bonfireContributions[a]) || a.localeCompare(b)).slice(0, 3);
}
export const transferMultiplier = (sacrificedAverage: number) => 1 + HOODED_FIGURE_CONFIG.sacrificePremium * (Math.max(1, sacrificedAverage) - 1);
export const roundHalf = (value: number) => Math.round(value * 2) / 2;

export function bonfireMaximum(id: Flame): number {
  if (id === 'targetPractice' || id === 'speedDemon' || id === 'hotStreak'
    || id === 'straightShooter' || id === 'doubleDown' || id === 'threesCompany' || id === 'boxSet') return 9;
  if (id === 'sixPack') return 6;
  return 5;
}

export function resolveWildfire(id: Flame, transfer: number): WildfireResolved {
  if (isChargeFlame(id)) {
    const maxCharge = roundHalf(5 * transfer);
    if (id === 'momentum' || id === 'thirdRail') return { kind: 'charge', gain: roundHalf(.5 * transfer), maxCharge };
    if (id === 'jumpStart') return { kind: 'charge', gain: roundHalf(2 * transfer), maxCharge };
    if (id === 'powerSurge') return { kind: 'charge', ratio: roundHalf(1 + 2 * transfer), maxCharge };
    return { kind: 'charge', coefficient: roundHalf(transfer), maxCharge };
  }
  const baseMax = bonfireMaximum(id);
  return { kind: 'xMult', baseMax, max: Math.round(baseMax * transfer) };
}

export function projectWildfire(state: Pick<GameState, 'bonfireContributions'>, recipient: Flame, sacrifice: Flame): Wildfire {
  const sacrificedAverage = contributionAverage(state.bonfireContributions[sacrifice]);
  const transfer = transferMultiplier(sacrificedAverage);
  return { flame: recipient, sacrificedFlame: sacrifice, sacrificedAverage, transferMultiplier: transfer,
    resolved: resolveWildfire(recipient, transfer) };
}

export function wildfireFactor(wildfire: Wildfire, ordinaryFactor: number): number {
  if (wildfire.resolved.kind !== 'xMult') return ordinaryFactor;
  const { baseMax, max } = wildfire.resolved;
  if (baseMax <= 1 || ordinaryFactor <= 1) return 1;
  return Number((1 + ((ordinaryFactor - 1) / (baseMax - 1)) * (max - 1)).toFixed(12));
}

export function wildfirePreview(wildfire: Wildfire): string[] {
  const name = FLAMES[wildfire.flame].name.toUpperCase();
  const resolved = wildfire.resolved;
  if (resolved.kind === 'xMult') {
    const variable = ['speedDemon', 'sixPack', 'hotStreak', 'lowball', 'targetPractice'].includes(wildfire.flame);
    return [name, variable ? `Up to ×${resolved.baseMax} → Up to ×${resolved.max}`
      : `×${resolved.baseMax} → ×${resolved.max}`];
  }
  if (wildfire.flame === 'powerSurge') return [name, `Charge ×3 → Charge ×${resolved.ratio}`, `Max Charge: +5 → +${resolved.maxCharge}`];
  if (wildfire.flame === 'fluxCapacitor') return [name,
    `Charge multiplier: 1 + faces pulled → 1 + (${resolved.coefficient} × faces pulled)`,
    `Max Charge: +5 → +${resolved.maxCharge}`];
  const old = wildfire.flame === 'jumpStart' ? 2 : .5;
  const trigger = wildfire.flame === 'momentum' ? 'Played hand'
    : wildfire.flame === 'thirdRail' ? 'Rolled 3' : 'Manual Reroll';
  return [name, `${trigger}: +${old} → +${resolved.gain} Charge`, `Max Charge: +5 → +${resolved.maxCharge}`];
}

export function currentScoringFaces(state: Pick<GameState, 'dice'>, dieIds: number[]): ChallengeScoringFace[] {
  return dieIds.map(id => state.dice.find(die => die.id === id)).filter((die): die is NonNullable<typeof die> => !!die)
    .map(die => ({ printed: die.value, enhancements: { ...activeFace(die).enhancements } }));
}
