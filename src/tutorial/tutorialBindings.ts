import { activeFace } from '../game/dice';
import type { Die, HandId, Rank } from '../game/types';
import type { TutorialFaceBinding, TutorialRankPlan, TutorialSession } from './types';

const RANKS: Rank[] = [1, 2, 3, 4, 5, 6];
const UPPER_BY_RANK: Record<Rank, HandId> = {
  1: 'ones', 2: 'twos', 3: 'threes', 4: 'fours', 5: 'fives', 6: 'sixes', 7: 'ones',
};

export const upperHandForRank = (rank: Rank): HandId => UPPER_BY_RANK[rank];
const firstRankExcept = (...excluded: Rank[]) => RANKS.find(rank => !excluded.includes(rank))!;
const playerDice = (dice: Die[]) => dice.filter(die => die.owner === 'player').sort((a, b) => a.id - b.id).slice(0, 5);

export function buildRound2Plan(dice: Die[], bonus: TutorialFaceBinding): TutorialRankPlan | null {
  const players = playerDice(dice);
  if (players.length < 5 || !players.some(die => die.id === bonus.dieId) || bonus.faceRank === 7) return null;
  const singletonRank = firstRankExcept(bonus.faceRank);
  const otherPairRank = firstRankExcept(bonus.faceRank, singletonRank);
  const singleton = players.find(die => die.id !== bonus.dieId)!;
  const secondBonus = players.find(die => die.id !== bonus.dieId && die.id !== singleton.id)!;
  const otherPairDice = players.filter(die => ![bonus.dieId, singleton.id, secondBonus.id].includes(die.id));
  return {
    singletonDieId: singleton.id,
    singletonRank,
    upperHand: upperHandForRank(singletonRank),
    pairRanks: [bonus.faceRank, otherPairRank],
    rerollRank: bonus.faceRank,
    opening: [
      { dieId: bonus.dieId, rank: bonus.faceRank },
      { dieId: secondBonus.id, rank: bonus.faceRank },
      ...otherPairDice.map(die => ({ dieId: die.id, rank: otherPairRank })),
      { dieId: singleton.id, rank: singletonRank },
    ].sort((a, b) => a.dieId - b.dieId),
  };
}

export function buildRound4Plan(dice: Die[], bonus: TutorialFaceBinding | null,
  workout: TutorialFaceBinding): TutorialRankPlan | null {
  const players = playerDice(dice);
  if (players.length < 5 || workout.faceRank === 7 || !players.some(die => die.id === workout.dieId)) return null;
  const others = players.filter(die => die.id !== workout.dieId);
  const canUseBonus = !!bonus && bonus.faceRank !== 7 && bonus.faceRank !== workout.faceRank
    && bonus.dieId !== workout.dieId && others.some(die => die.id === bonus.dieId);
  const firstPair = canUseBonus ? bonus!.faceRank : firstRankExcept(workout.faceRank);
  const secondPair = firstRankExcept(workout.faceRank, firstPair);
  const firstPairDice = canUseBonus
    ? [others.find(die => die.id === bonus!.dieId)!, others.find(die => die.id !== bonus!.dieId)!]
    : others.slice(0, 2);
  const firstPairIds = new Set(firstPairDice.map(die => die.id));
  return {
    singletonDieId: workout.dieId,
    singletonRank: workout.faceRank,
    upperHand: upperHandForRank(workout.faceRank),
    pairRanks: [firstPair, secondPair],
    rerollRank: firstPair,
    opening: [
      { dieId: workout.dieId, rank: workout.faceRank },
      ...others.map(die => ({ dieId: die.id, rank: firstPairIds.has(die.id) ? firstPair : secondPair })),
    ].sort((a, b) => a.dieId - b.dieId),
  };
}

const hasEnhancement = (session: TutorialSession, enhancement: 'bonus' | 'workout') =>
  session.game.dice.some(die => die.faces.some(face => (face.enhancements[enhancement] ?? 0) > 0));

function bindingFromEnhancement(session: TutorialSession, enhancement: 'bonus' | 'workout'): TutorialFaceBinding | null {
  for (const die of playerDice(session.game.dice)) {
    const face = die.faces.find(candidate => (candidate.enhancements[enhancement] ?? 0) > 0);
    if (face) return { dieId: die.id, faceRank: face.rank };
  }
  return null;
}

/** Reconciles old saves and pre-placement bindings without changing any die face. */
export function reconcileTutorialBindings(session: TutorialSession): void {
  const { game, scenario } = session;
  const actualBonus = bindingFromEnhancement(session, 'bonus');
  const actualWorkout = bindingFromEnhancement(session, 'workout');
  if (actualBonus) scenario.bonusBinding = actualBonus;
  if (actualWorkout) scenario.workoutBinding = actualWorkout;

  if (game.phase === 'shop' && game.round === 1 && !hasEnhancement(session, 'bonus')) {
    const intended = game.dice.find(die => die.owner === 'player' && die.id === (scenario.bonusBinding?.dieId ?? 1))
      ?? playerDice(game.dice)[0];
    if (intended) scenario.bonusBinding = { dieId: intended.id, faceRank: activeFace(intended).rank };
  }

  if (game.phase === 'shop' && game.round === 3 && !hasEnhancement(session, 'workout')) {
    const current = game.dice.find(die => die.owner === 'player' && die.id === scenario.workoutBinding?.dieId);
    const candidate = current ?? playerDice(game.dice).find(die => die.id !== scenario.bonusBinding?.dieId
      && Object.values(activeFace(die).enhancements).filter(count => (count ?? 0) > 0).length < 3);
    if (candidate) scenario.workoutBinding = { dieId: candidate.id, faceRank: activeFace(candidate).rank };
  }
  scenario.workoutDieId = scenario.workoutBinding?.dieId ?? scenario.workoutDieId;
  if (scenario.round2Plan && scenario.bonusBinding
    && (scenario.round2Plan.rerollRank !== scenario.bonusBinding.faceRank
      || scenario.round2Plan.opening.find(item => item.dieId === scenario.bonusBinding!.dieId)?.rank !== scenario.bonusBinding.faceRank))
    scenario.round2Plan = null;
  if (scenario.round4Plan && scenario.workoutBinding
    && (scenario.round4Plan.singletonDieId !== scenario.workoutBinding.dieId
      || scenario.round4Plan.singletonRank !== scenario.workoutBinding.faceRank)) scenario.round4Plan = null;
  if (game.phase === 'round' && game.round === 2 && !scenario.round2Plan && scenario.bonusBinding)
    scenario.round2Plan = buildRound2Plan(game.dice, scenario.bonusBinding);
  if (game.phase === 'round' && game.round === 4 && !scenario.round4Plan && scenario.workoutBinding)
    scenario.round4Plan = buildRound4Plan(game.dice, scenario.bonusBinding, scenario.workoutBinding);
}

export function bindingIsCurrent(session: TutorialSession, binding: TutorialFaceBinding | null): binding is TutorialFaceBinding {
  const die = binding && session.game.dice.find(candidate => candidate.id === binding.dieId && candidate.owner === 'player');
  return !!die && activeFace(die).rank === binding.faceRank;
}

export function planTargets(plan: TutorialRankPlan): Map<number, Rank> {
  return new Map(plan.opening.map(({ dieId, rank }) => [dieId, rank]));
}
