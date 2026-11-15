import { ENGULFMENT_REQUIRED_MULTIPLIER, INFERNO_TIER_POWER_THRESHOLDS, infernoPowerForInterest } from './engulfment';
import type { FrozenInfernoMeterState, InfernoEvaluationState, InfernoMeterPresentationState,
  InfernoMeterSnapshot } from './types';

const FIRST_SECTION_WEIGHT = 55;
const LATER_SECTION_WEIGHT = 15;
const FINAL_TIER_HEADROOM = 1.05;

export const initialInfernoMeterPresentation = (): InfernoMeterPresentationState => ({
  revealedCheckpointCount: 0,
  lastPresentedFlamePower: 1,
  lastPresentedDieBasePower: null,
  lastPresentedDieFinalPower: null,
  lastScaleMaxPower: INFERNO_TIER_POWER_THRESHOLDS[1],
  frozen: null,
  current: null,
});

export function normalizeInfernoMeterPresentation(value: InfernoMeterPresentationState | null | undefined): InfernoMeterPresentationState {
  const defaults = initialInfernoMeterPresentation();
  const next = { ...defaults, ...(value ?? {}) };
  next.revealedCheckpointCount = Math.max(0, Math.min(INFERNO_TIER_POWER_THRESHOLDS.length,
    Math.floor(next.revealedCheckpointCount ?? 0)));
  // Discovery always happens in pairs, except a defensive clamp for malformed saves.
  if (next.revealedCheckpointCount % 2) next.revealedCheckpointCount--;
  next.lastPresentedFlamePower = finitePower(next.lastPresentedFlamePower, 1);
  next.lastPresentedDieBasePower = nullablePower(next.lastPresentedDieBasePower);
  next.lastPresentedDieFinalPower = nullablePower(next.lastPresentedDieFinalPower);
  next.lastScaleMaxPower = finitePower(next.lastScaleMaxPower, INFERNO_TIER_POWER_THRESHOLDS[1]);
  next.frozen = normalizeFrozen(next.frozen);
  next.current = normalizeSnapshot(next.current);
  return next;
}

function finitePower(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, value) : fallback;
}

function nullablePower(value: unknown): number | null {
  return value === null || value === undefined ? null : finitePower(value, 1);
}

function normalizeFrozen(value: FrozenInfernoMeterState | null | undefined): FrozenInfernoMeterState | null {
  if (!value) return null;
  return {
    flamePower: finitePower(value.flamePower, 1),
    dieBasePower: nullablePower(value.dieBasePower),
    dieFinalPower: nullablePower(value.dieFinalPower),
    checkpointCount: Math.max(0, Math.min(INFERNO_TIER_POWER_THRESHOLDS.length, Math.floor(value.checkpointCount ?? 0))),
    scaleMaxPower: finitePower(value.scaleMaxPower, INFERNO_TIER_POWER_THRESHOLDS[1]),
  };
}

function normalizeSnapshot(value: InfernoMeterSnapshot | null | undefined): InfernoMeterSnapshot | null {
  if (!value) return null;
  return {
    ...value,
    round: Math.max(1, Math.floor(value.round ?? 1)),
    actualFlamePower: finitePower(value.actualFlamePower, 1),
    startFlamePower: finitePower(value.startFlamePower, 1),
    displayedFlamePower: finitePower(value.displayedFlamePower, 1),
    dieBasePower: nullablePower(value.dieBasePower),
    dieFinalPower: nullablePower(value.dieFinalPower),
    startCheckpointCount: Math.max(0, Math.min(INFERNO_TIER_POWER_THRESHOLDS.length, Math.floor(value.startCheckpointCount ?? 0))),
    checkpointCount: Math.max(0, Math.min(INFERNO_TIER_POWER_THRESHOLDS.length, Math.floor(value.checkpointCount ?? 0))),
    startScaleMaxPower: finitePower(value.startScaleMaxPower, INFERNO_TIER_POWER_THRESHOLDS[1]),
    scaleMaxPower: finitePower(value.scaleMaxPower, INFERNO_TIER_POWER_THRESHOLDS[1]),
    maximumPotential: Math.max(0, Number.isFinite(value.maximumPotential) ? value.maximumPotential : 0),
    dormant: value.dormant === true,
    cooldownRounds: Math.max(0, Math.floor(value.cooldownRounds ?? 0)),
    reconciling: value.reconciling === true,
  };
}

/** The selected die contributes evaluator Interest, so convert both endpoints through the evaluator's inverse. */
export function infernoDiePowerRange(evaluation: InfernoEvaluationState | null): { base: number; final: number } | null {
  if (!evaluation || evaluation.requestedDieId === null || evaluation.requestedDieInterest <= 0
    || evaluation.finalInterest <= evaluation.flameInterest) return null;
  return { base: infernoPowerForInterest(evaluation.flameInterest), final: infernoPowerForInterest(evaluation.finalInterest) };
}

export function revealedInfernoCheckpointCount(previous: number, maximumPotential: number, reachedPower: number): number {
  let count = Math.max(0, Math.min(INFERNO_TIER_POWER_THRESHOLDS.length, Math.floor(previous)));
  if (count === 0 && Math.max(maximumPotential, reachedPower) >= ENGULFMENT_REQUIRED_MULTIPLIER)
    count = Math.min(2, INFERNO_TIER_POWER_THRESHOLDS.length);
  while (count >= 2 && count < INFERNO_TIER_POWER_THRESHOLDS.length
    && reachedPower >= INFERNO_TIER_POWER_THRESHOLDS[count - 1]) {
    count = Math.min(INFERNO_TIER_POWER_THRESHOLDS.length, count + 2);
  }
  return count;
}

export function infernoMeterScaleMax(checkpointCount: number, reachedPower: number): number {
  if (checkpointCount <= 0) return INFERNO_TIER_POWER_THRESHOLDS[0];
  const finalCheckpoint = INFERNO_TIER_POWER_THRESHOLDS[Math.min(checkpointCount, INFERNO_TIER_POWER_THRESHOLDS.length) - 1];
  return checkpointCount === INFERNO_TIER_POWER_THRESHOLDS.length && reachedPower > finalCheckpoint
    ? reachedPower * FINAL_TIER_HEADROOM : finalCheckpoint;
}

/** Piecewise visual map: the baseline-to-first-tier span is broad, later tier spans are compact and equal. */
export function infernoMeterPosition(power: number, checkpointCount: number, scaleMaxPower: number): number {
  const scaleMax = Math.max(1, scaleMaxPower);
  const checkpoints = INFERNO_TIER_POWER_THRESHOLDS.slice(0, Math.max(0, checkpointCount))
    .filter(value => value < scaleMax - 1e-9);
  const boundaries = [1, ...checkpoints, scaleMax];
  const weights = boundaries.slice(1).map((_, index) => index === 0 ? FIRST_SECTION_WEIGHT : LATER_SECTION_WEIGHT);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const target = Math.max(1, Math.min(scaleMax, power));
  let traversed = 0;
  for (let index = 0; index < weights.length; index++) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (target <= end || index === weights.length - 1) {
      const progress = end > start ? (target - start) / (end - start) : 1;
      return 100 * (traversed + weights[index] * Math.max(0, Math.min(1, progress))) / totalWeight;
    }
    traversed += weights[index];
  }
  return 100;
}

export function prepareInfernoMeterPresentation(
  presentation: InfernoMeterPresentationState,
  input: { round: number; actualFlamePower: number; maximumPotential: number;
    evaluation: InfernoEvaluationState | null; cooldownRounds: number },
): InfernoMeterPresentationState {
  const next = normalizeInfernoMeterPresentation(presentation);
  const dormant = input.cooldownRounds > 0 && next.frozen !== null;
  if (dormant) {
    const frozen = next.frozen!;
    next.current = {
      round: input.round, actualFlamePower: input.actualFlamePower,
      startFlamePower: frozen.flamePower, displayedFlamePower: frozen.flamePower,
      dieBasePower: frozen.dieBasePower, dieFinalPower: frozen.dieFinalPower,
      startCheckpointCount: frozen.checkpointCount, checkpointCount: frozen.checkpointCount,
      startScaleMaxPower: frozen.scaleMaxPower, scaleMaxPower: frozen.scaleMaxPower,
      maximumPotential: input.maximumPotential, dormant: true, cooldownRounds: input.cooldownRounds,
      reconciling: false,
    };
    return next;
  }

  const die = infernoDiePowerRange(input.evaluation);
  const reachedPower = Math.max(input.actualFlamePower, die?.final ?? 1);
  const checkpointCount = revealedInfernoCheckpointCount(next.revealedCheckpointCount,
    input.maximumPotential, reachedPower);
  let scaleMaxPower = infernoMeterScaleMax(checkpointCount, reachedPower);
  // The final tier has no invented checkpoint. Add unlabeled headroom until a
  // die's evaluator-derived interval fits after the factual all-Flame endpoint.
  if (checkpointCount === INFERNO_TIER_POWER_THRESHOLDS.length && die) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const combinedPosition = infernoMeterPosition(input.actualFlamePower, checkpointCount, scaleMaxPower)
        + Math.max(0, infernoMeterPosition(die.final, checkpointCount, scaleMaxPower)
          - infernoMeterPosition(die.base, checkpointCount, scaleMaxPower));
      if (combinedPosition <= 97) break;
      scaleMaxPower *= 1.15;
    }
  }
  const prior = next.frozen;
  next.current = {
    round: input.round, actualFlamePower: input.actualFlamePower,
    startFlamePower: prior?.flamePower ?? next.lastPresentedFlamePower,
    displayedFlamePower: input.actualFlamePower,
    dieBasePower: die?.base ?? null, dieFinalPower: die?.final ?? null,
    startCheckpointCount: prior?.checkpointCount ?? next.revealedCheckpointCount,
    checkpointCount,
    startScaleMaxPower: prior?.scaleMaxPower ?? next.lastScaleMaxPower,
    scaleMaxPower, maximumPotential: input.maximumPotential, dormant: false, cooldownRounds: 0,
    reconciling: prior !== null,
  };
  next.revealedCheckpointCount = checkpointCount;
  next.lastPresentedFlamePower = input.actualFlamePower;
  next.lastPresentedDieBasePower = die?.base ?? null;
  next.lastPresentedDieFinalPower = die?.final ?? null;
  next.lastScaleMaxPower = scaleMaxPower;
  next.frozen = null;
  return next;
}

export function freezeInfernoMeter(presentation: InfernoMeterPresentationState): InfernoMeterPresentationState {
  const next = normalizeInfernoMeterPresentation(presentation);
  const current = next.current;
  next.frozen = current ? {
    flamePower: current.displayedFlamePower,
    dieBasePower: current.dieBasePower,
    dieFinalPower: current.dieFinalPower,
    checkpointCount: current.checkpointCount,
    scaleMaxPower: current.scaleMaxPower,
  } : {
    flamePower: next.lastPresentedFlamePower,
    dieBasePower: next.lastPresentedDieBasePower,
    dieFinalPower: next.lastPresentedDieFinalPower,
    checkpointCount: next.revealedCheckpointCount,
    scaleMaxPower: next.lastScaleMaxPower,
  };
  return next;
}
