import { validateAction } from './engine';
import {
  allHandsOnDeckChargeGain, flameInstances, FLAMES, HAND_FAMILY_FLAMES,
  hotPotatoClockChargeGain, isChargeFlame, momentumChargeGain, potentialEnergyChargeGain,
  PROGRESSIVE_FLAME_SEQUENCES, speedDemonMultiplier,
} from './flames';
import { HANDS, ultimateHands } from './hands';
import { canonicalPlayPreview, type CanonicalPlayPreview } from './playPreview';
import { legalHandCombinations } from './selection';
import type { Board, Flame, FlameInstance, HandId } from './types';
import { availablePlayableDice } from './bosses';
import { formatPlayerNumber } from './copy';

export type FlameVisualState = 'normal' | 'setup' | 'possible' | 'active';
export interface FlameContributionView { kind: 'xmult' | 'charge'; value: number }
export interface FlamePresentation {
  instanceId: number;
  flame: Flame;
  state: FlameVisualState;
  progress?: number;
  statusText?: string;
  contribution?: FlameContributionView;
  targetHand?: HandId;
  accessibleLabel: string;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const atChargeCap = (board: Board) => Math.max(0, board.maxCharge - board.chargeXMult);
const candidateFactorCache = new WeakMap<Board, { signature: string; flames: Set<Flame> }>();

const candidateSignature = (board: Board) => JSON.stringify({
  decisionId: board.decisionId,
  consumed: board.consumed,
  levels: board.handLevels,
  family: board.handFamilyFlameStages,
  progressive: board.progressiveFlames,
  wagers: [board.scoreWagers.doubleOrNothing?.hand, board.scoreWagers.doubleOrNothing?.factor, board.scoreWagers.allInArmed],
  dare: board.interactiveFlames.dareDevilCount,
  dice: board.dice.map(die => [die.id, die.value, die.faces[die.value - 1], die.owner === 'player'
    ? die.effects.map(effect => [effect.type, effect.level]) : []]),
});

function possibleXMultFlames(board: Board): Set<Flame> {
  const signature = candidateSignature(board);
  const cached = candidateFactorCache.get(board);
  if (cached?.signature === signature) return cached.flames;
  const result = new Set<Flame>();
  if (board.phase === 'round') for (const hand of Object.keys(board.handLevels) as HandId[]) {
    for (const combination of legalHandCombinations(board, hand)) {
      for (const factor of canonicalPlayPreview(board, hand, combination).xMultFactors) {
        if (factor.source in FLAMES) result.add(factor.source as Flame);
      }
    }
  }
  candidateFactorCache.set(board, { signature, flames: result });
  return result;
}

function sequenceState(board: Board, flame: FlameInstance): Partial<FlamePresentation> {
  if (flame.type in HAND_FAMILY_FLAMES) {
    const id = flame.type as keyof typeof HAND_FAMILY_FLAMES;
    const definition = HAND_FAMILY_FLAMES[id];
    const stage = board.handFamilyFlameStages[id] ?? 'setup';
    if (stage === 'payoff') return { state: 'setup', targetHand: definition.payoff,
      statusText: `${HANDS[definition.setup].name.toUpperCase()} PLAYED · NEED ${HANDS[definition.payoff].name.toUpperCase()}`, progress: .5 };
  }
  if (flame.type === 'topDown' || flame.type === 'countDown') {
    const definition = PROGRESSIVE_FLAME_SEQUENCES[flame.type];
    const step = Math.min(board.progressiveFlames[flame.type], definition.hands.length);
    if (step > 0 && step < definition.hands.length) return { state: 'setup', targetHand: definition.hands[step],
      statusText: `${step}/${definition.hands.length} · NEXT: ${HANDS[definition.hands[step]].name.toUpperCase()}`,
      progress: step / definition.hands.length };
    if (step >= definition.hands.length) return { state: 'setup', statusText: `COMPLETE · ${step}/${definition.hands.length}`, progress: 1 };
  }
  if (flame.type === 'hotStreak' && board.hotStreakCharges > 0) return { state: 'setup', targetHand: board.hotStreakGoal ?? undefined,
    statusText: `${board.hotStreakCharges}/8${board.hotStreakGoal ? ` · NEXT: ${HANDS[board.hotStreakGoal].name.toUpperCase()}` : ''}`,
    progress: clamp01(board.hotStreakCharges / 8) };
  if (flame.type === 'doubleOrNothing' && board.scoreWagers.doubleOrNothing) return { state: 'setup',
    targetHand: board.scoreWagers.doubleOrNothing.hand,
    statusText: `REPLAY ${HANDS[board.scoreWagers.doubleOrNothing.hand].name.toUpperCase()} · ×${board.scoreWagers.doubleOrNothing.factor}` };
  if (flame.type === 'dareDevil' && board.interactiveFlames.dareDevilCount > 0) return { state: 'setup',
    targetHand: ultimateHands(board.handLevels)[0], progress: board.interactiveFlames.dareDevilCount / 4,
    statusText: `${board.interactiveFlames.dareDevilCount} DARE${board.interactiveFlames.dareDevilCount === 1 ? '' : 'S'} STORED` };
  if (flame.type === 'allIn' && board.scoreWagers.allInArmed) return { state: 'setup', statusText: 'ARMED · NEXT MANUAL PLAY' };
  return {};
}

function actionPossible(board: Board, flame: Flame): boolean {
  if (flame === 'burnItDown') return validateAction(board, { type: 'ACTIVATE_BURN_IT_DOWN' }) === null;
  if (flame === 'greaseTheEngine') return validateAction(board, { type: 'ACTIVATE_GREASE_THE_ENGINE' }) === null;
  if (flame === 'dareDevil') return validateAction(board, { type: 'ACTIVATE_DARE_DEVIL' }) === null;
  if (flame === 'allIn') return validateAction(board, { type: 'ARM_ALL_IN' }) === null;
  if (flame === 'lightningStrike') {
    return availablePlayableDice(board).some(die =>
      validateAction(board, { type: 'ACTIVATE_LIGHTNING_STRIKE', dieId: die.id, predictedFace: 1 }) === null);
  }
  return false;
}

function chargePlayPossible(board: Board, flame: Flame): boolean {
  const playableHands = (Object.keys(board.handLevels) as HandId[]).filter(hand => legalHandCombinations(board, hand).length > 0);
  if (!playableHands.length) return false;
  if (flame === 'momentum') return true;
  if (flame === 'powerSurge') return ultimateHands(board.handLevels).some(hand => playableHands.includes(hand));
  if (flame === 'potentialEnergy') {
    const ultimate = ultimateHands(board.handLevels);
    return ultimate.some(hand => playableHands.includes(hand)) && playableHands.some(hand => !ultimate.includes(hand));
  }
  if (flame === 'allHandsOnDeck') {
    const available = new Set(availablePlayableDice(board).map(die => die.id));
    return available.size > 0 && playableHands.some(hand => legalHandCombinations(board, hand)
      .some(combo => combo.length === available.size && combo.every(id => available.has(id))));
  }
  if (flame === 'hotPotatoClock' && board.interactiveFlames.hotPotatoDieId !== null) return playableHands.some(hand =>
    legalHandCombinations(board, hand).some(combo => !combo.includes(board.interactiveFlames.hotPotatoDieId!)));
  return false;
}

export function deriveFlamePresentations(board: Board, preview: CanonicalPlayPreview | null,
  decisionMs = 0): FlamePresentation[] {
  const candidateFactors = possibleXMultFlames(board);
  const activeFactors = new Map<Flame, number>();
  for (const factor of preview?.xMultFactors ?? []) if (factor.source in FLAMES) activeFactors.set(factor.source as Flame, factor.value);
  const selected = new Set(preview?.diePips.filter(item => item.role === 'selected').map(item => item.dieId) ?? []);
  const chargeRoom = atChargeCap(board);
  return flameInstances(board).map(flame => {
    let state: FlameVisualState = 'normal';
    let statusText: string | undefined;
    let progress: number | undefined;
    let targetHand: HandId | undefined;
    let contribution: FlameContributionView | undefined;
    const setup = sequenceState(board, flame);
    if (setup.state) ({ state, statusText, progress, targetHand } = { state: setup.state, statusText: setup.statusText,
      progress: setup.progress, targetHand: setup.targetHand });
    const factor = activeFactors.get(flame.type);
    if (factor !== undefined && factor > 1) {
      state = 'active'; contribution = { kind: 'xmult', value: factor }; statusText = `×${formatPlayerNumber(factor)}`;
    } else if (candidateFactors.has(flame.type)) state = 'possible';
    if (actionPossible(board, flame.type) && state !== 'active') state = 'possible';
    if (isChargeFlame(flame.type) && chargePlayPossible(board, flame.type) && state !== 'active') state = 'possible';

    if (preview && isChargeFlame(flame.type)) {
      let requested = 0;
      if (flame.type === 'momentum') requested = momentumChargeGain(flame.investedGold);
      if (flame.type === 'potentialEnergy') {
        const ultimate = ultimateHands(board.handLevels);
        const ultimatePlayable = ultimate.some(hand => legalHandCombinations(board, hand).length > 0);
        if (ultimatePlayable && !ultimate.includes(preview.hand)) requested = potentialEnergyChargeGain(flame.investedGold);
      }
      if (flame.type === 'allHandsOnDeck') {
        const available = new Set(availablePlayableDice(board).map(die => die.id));
        if (available.size > 0 && selected.size === available.size && [...available].every(id => selected.has(id)))
          requested = allHandsOnDeckChargeGain(flame.investedGold, available.size);
      }
      if (flame.type === 'hotPotatoClock' && board.interactiveFlames.hotPotatoDieId !== null
        && !selected.has(board.interactiveFlames.hotPotatoDieId)) {
        requested = hotPotatoClockChargeGain(flame.investedGold, board.interactiveFlames.hotPotatoStreak + 1);
      }
      const gain = Math.min(requested, chargeRoom);
      if (gain > 0) { state = 'active'; contribution = { kind: 'charge', value: gain }; statusText = `+${formatPlayerNumber(gain)} CHARGE`; }
      else if (flame.type === 'hotPotatoClock' && board.interactiveFlames.hotPotatoStreak > 0) {
        progress = clamp01(board.interactiveFlames.hotPotatoStreak / 6);
        statusText ??= `${board.interactiveFlames.hotPotatoStreak} AVOIDED`;
      }
    }
    if (flame.type === 'speedDemon') {
      const current = speedDemonMultiplier(flame.investedGold, decisionMs);
      const maximum = speedDemonMultiplier(flame.investedGold, 0);
      progress = clamp01((current - 1) / Math.max(.0001, maximum - 1));
      if (current <= 1) { state = 'normal'; contribution = undefined; statusText = undefined; }
      else if (factor === undefined) {
        state = 'active';
        contribution = { kind: 'xmult', value: current };
        statusText = `×${current.toFixed(1).replace(/\.0$/, '')}`;
      }
    }
    if (flame.type === 'sixPack') {
      progress = clamp01((board.sixPackXMult - 1) / Math.max(.0001, 3));
      statusText ??= board.sixPackXMult > 1 ? `×${formatPlayerNumber(board.sixPackXMult)}` : undefined;
    }
    if (flame.type === 'minigun' && board.minigunUpperStreak > 0) {
      progress = clamp01(board.minigunUpperStreak / 6);
      statusText ??= `${board.minigunUpperStreak}/6`;
    }
    const label = `${FLAMES[flame.type].name}: ${state}${statusText ? `. ${statusText}` : ''}`;
    return { instanceId: flame.instanceId, flame: flame.type, state, progress, statusText, contribution, targetHand,
      accessibleLabel: label };
  });
}
