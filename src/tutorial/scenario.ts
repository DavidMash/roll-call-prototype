import { dispatch, newRun } from '../game/engine';
import { SeededRng } from '../game/rng';
import { boardSnapshot } from '../game/telemetry';
import type { Action, GameState, HandId, Rank, Resolution } from '../game/types';
import { chapterNumberForRound } from '../game/chapters';
import { combinationsForHand, HANDS, UPPER_HAND_IDS } from '../game/hands';
import { curateTutorialOffers } from './curatedOffers';
import { scriptedRollSource, targetMap, type EventAddressedRollSource } from './scriptedRolls';
import { initialTutorialScenario } from './tutorialPersistence';
import { TUTORIAL_SEED, TUTORIAL_VERSION, type TutorialScenarioState, type TutorialSession } from './types';
import {
  bindingIsCurrent, buildRound2Plan, buildRound4Plan, planTargets, reconcileTutorialBindings,
} from './tutorialBindings';

const REQUIRED_BEATS = {
  reroll: 'c1-r1-reroll', threeKind: 'c1-r1-three-kind', pair: 'c1-r1-pair', sixes: 'c1-r1-sixes',
  fives: 'c1-r1-fives', straight: 'c1-r1-small-straight', training: 'shop1-train-full-house',
  bonus: 'shop1-place-bonus', r2Twos: 'c1-r2-twos', r2FullHouse: 'c1-r2-full-house',
  workout: 'shop-r4-place-workout', r4Twos: 'c1-r4-twos', r4FullHouse: 'c1-r4-full-house',
  flameDemoSetup: 'c2-r1-setup', flameDemoPayoff: 'c2-r1-payoff',
} as const;

const complete = (scenario: TutorialScenarioState, id: string) => {
  if (!scenario.completedBeatIds.includes(id)) scenario.completedBeatIds.push(id);
};
const done = (scenario: TutorialScenarioState, id: string) => scenario.completedBeatIds.includes(id);

function withBossPlan(state: GameState): void {
  state.bossSchedule[3] = 'capitalReturn';
  state.bossSchedule[6] = 'quickdraw';
  state.bossSchedule[9] = 'juggler';
  state.bossSchedule[12] = 'warden';
  state.chapterPlans[1] = { chapterNumber: 1, miniBoss: 'capitalReturn', boss: 'quickdraw' };
  state.chapterPlans[2] = { chapterNumber: 2, miniBoss: 'juggler', boss: 'warden' };
}

function patchFinalEvent(resolution: Resolution): void {
  const last = resolution.events.at(-1);
  if (last) last.board = boardSnapshot(resolution.state);
}

function sourceForAction(session: TutorialSession, action: Action): EventAddressedRollSource | undefined {
  const { game: state, scenario } = session;
  let targets: Map<number, Rank> | null = null;
  let exclude = false;
  if (state.round === 1 && state.phase === 'round') {
    if (action.type === 'MANUAL_REROLL' && !done(scenario, REQUIRED_BEATS.reroll)) { targets = targetMap([1], [1]); exclude = true; }
    if (action.type === 'PLAY' && action.hand === 'threeKind' && !done(scenario, REQUIRED_BEATS.threeKind)) targets = targetMap([4, 4, 2], [0, 1, 2]);
    if (action.type === 'PLAY' && action.hand === 'pair' && !done(scenario, REQUIRED_BEATS.pair)) targets = targetMap([3, 1], [0, 1]);
    if (action.type === 'PLAY' && action.hand === 'sixes' && !done(scenario, REQUIRED_BEATS.sixes)) targets = targetMap([6], [4]);
    if (action.type === 'PLAY' && action.hand === 'fives' && !done(scenario, REQUIRED_BEATS.fives)) targets = targetMap([4], [3]);
    if (action.type === 'PLAY' && action.hand === 'smallStraight' && !done(scenario, REQUIRED_BEATS.straight)) targets = targetMap([2, 4, 5, 1], [0, 1, 2, 3]);
  }
  const r2 = scenario.round2Plan;
  if (state.round === 2 && r2 && action.type === 'PLAY' && action.hand === r2.upperHand
    && action.dieIds.includes(r2.singletonDieId) && !done(scenario, REQUIRED_BEATS.r2Twos)) {
    targets = targetMap([r2.rerollRank], [r2.singletonDieId]);
  }
  const r4 = scenario.round4Plan;
  if (state.round === 4 && r4 && action.type === 'PLAY' && action.hand === r4.upperHand
    && action.dieIds.includes(r4.singletonDieId) && !done(scenario, REQUIRED_BEATS.r4Twos)) {
    targets = targetMap([r4.rerollRank], [r4.singletonDieId]);
  }

  if (state.round === 7 && action.type === 'PLAY' && !done(scenario, REQUIRED_BEATS.flameDemoSetup)) {
    const flameDie = scenario.firstFlameDieId ?? 0;
    if (scenario.firstFlame === 'doubleDown' && action.hand === 'pair') {
      const other = action.dieIds.find(id => id !== flameDie) ?? action.dieIds[0];
      targets = targetMap([2, 4], [flameDie, other]);
    } else if (scenario.firstFlame === 'straightShooter' && action.hand === 'smallStraight') {
      const sorted = [...action.dieIds].sort((a, b) => a - b);
      targets = targetMap([2, 3, 4, 5], sorted);
    }
  }
  return targets ? scriptedRollSource(state.dice, targets, state.rngState, exclude) : undefined;
}

function rankPlanForRound(session: TutorialSession, nextRound: number) {
  if (nextRound === 2) return session.scenario.round2Plan
    ?? (session.scenario.bonusBinding ? buildRound2Plan(session.game.dice, session.scenario.bonusBinding) : null);
  if (nextRound === 4) return session.scenario.round4Plan
    ?? (session.scenario.workoutBinding
      ? buildRound4Plan(session.game.dice, session.scenario.bonusBinding, session.scenario.workoutBinding) : null);
  return null;
}

function openingTargetsForRound(session: TutorialSession, nextRound: number): Map<number, Rank> | null {
  const plan = rankPlanForRound(session, nextRound);
  if (plan) return planTargets(plan);
  if (nextRound !== 7) return null;
  const { scenario } = session;
  const flameDie = scenario.firstFlameDieId ?? 0;
  if (scenario.firstFlame === 'straightShooter') {
    const result = targetMap([1, 2, 3, 4, 6]);
    if (flameDie === 4) { result.set(4, 4); result.set(3, 6); }
    return result;
  }
  const other = [0, 1, 2, 3, 4].find(id => id !== flameDie)!;
  const result = new Map<number, Rank>();
  result.set(flameDie, 6);
  result.set(other, 6);
  const remaining = [0, 1, 2, 3, 4].filter(id => id !== flameDie && id !== other);
  const held: Rank[] = scenario.firstFlame === 'doubleDown' ? [2, 4, 5] : [1, 3, 4];
  remaining.forEach((id, index) => result.set(id, held[index]));
  return result;
}

function recoverImpossibleLesson(session: TutorialSession): void {
  const { game: state, scenario } = session;
  const playerDice = state.dice.filter(die => die.owner === 'player');
  const includes = (hand: HandId, dieId: number) => combinationsForHand(playerDice, hand).some(ids => ids.includes(dieId));
  if (state.round === 2 && state.phase === 'round') {
    const plan = scenario.round2Plan;
    if (!plan || (!done(scenario, REQUIRED_BEATS.r2Twos) && !includes(plan.upperHand, plan.singletonDieId))) {
      complete(scenario, REQUIRED_BEATS.r2Twos);
      complete(scenario, REQUIRED_BEATS.r2FullHouse);
    } else if (done(scenario, REQUIRED_BEATS.r2Twos) && !done(scenario, REQUIRED_BEATS.r2FullHouse)
      && combinationsForHand(playerDice, 'fullHouse').length === 0) complete(scenario, REQUIRED_BEATS.r2FullHouse);
  }
  if (state.round === 4 && state.phase === 'round') {
    const plan = scenario.round4Plan;
    if (!plan || (!done(scenario, REQUIRED_BEATS.r4Twos) && !includes(plan.upperHand, plan.singletonDieId))) {
      complete(scenario, REQUIRED_BEATS.r4Twos);
      complete(scenario, 'c1-r4-familiar');
      complete(scenario, 'c1-r4-workout-result');
      complete(scenario, REQUIRED_BEATS.r4FullHouse);
    } else if (done(scenario, REQUIRED_BEATS.r4Twos) && !done(scenario, REQUIRED_BEATS.r4FullHouse)
      && combinationsForHand(playerDice, 'fullHouse').length === 0) complete(scenario, REQUIRED_BEATS.r4FullHouse);
  }
  if (state.round === 7 && state.phase === 'round') {
    const flameDie = scenario.firstFlameDieId;
    if (flameDie === null) { complete(scenario, REQUIRED_BEATS.flameDemoSetup); complete(scenario, REQUIRED_BEATS.flameDemoPayoff); return; }
    if (!done(scenario, REQUIRED_BEATS.flameDemoSetup)) {
      const setup = scenario.firstFlame === 'doubleDown' ? 'pair' : scenario.firstFlame === 'straightShooter' ? 'smallStraight' : null;
      if (setup && !includes(setup, flameDie)) { complete(scenario, REQUIRED_BEATS.flameDemoSetup); complete(scenario, REQUIRED_BEATS.flameDemoPayoff); }
    } else if (!done(scenario, REQUIRED_BEATS.flameDemoPayoff)) {
      const payoff = scenario.firstFlame === 'doubleDown' ? 'twoPair' : scenario.firstFlame === 'straightShooter' ? 'largeStraight' : null;
      const minigunPlayable = scenario.firstFlame === 'minigun' && UPPER_HAND_IDS.some(hand => includes(hand, flameDie));
      if ((payoff && !includes(payoff, flameDie)) || (scenario.firstFlame === 'minigun' && !minigunPlayable)) complete(scenario, REQUIRED_BEATS.flameDemoPayoff);
    }
  }
}

function synchronizeScenario(previous: TutorialSession, action: Action, next: TutorialSession, resolution: Resolution): void {
  const scenario = next.scenario;
  const state = next.game;
  if (previous.game.round === 1) {
    if (action.type === 'MANUAL_REROLL' && action.dieIds.length === 1 && action.dieIds[0] === 1) complete(scenario, REQUIRED_BEATS.reroll);
    if (action.type === 'PLAY' && action.hand === 'threeKind') complete(scenario, REQUIRED_BEATS.threeKind);
    if (action.type === 'PLAY' && action.hand === 'pair') complete(scenario, REQUIRED_BEATS.pair);
    if (action.type === 'PLAY' && action.hand === 'sixes') complete(scenario, REQUIRED_BEATS.sixes);
    if (action.type === 'PLAY' && action.hand === 'fives') complete(scenario, REQUIRED_BEATS.fives);
    if (action.type === 'PLAY' && action.hand === 'smallStraight') complete(scenario, REQUIRED_BEATS.straight);
    if (action.type === 'TRAIN_HAND' && action.hand === 'fullHouse') complete(scenario, REQUIRED_BEATS.training);
    if (action.type === 'BUY') {
      const purchased = state.stats.purchases.at(-1);
      if (purchased?.enhancement === 'bonus') {
        scenario.bonusBinding = { dieId: purchased.dieId, faceRank: purchased.face };
        complete(scenario, REQUIRED_BEATS.bonus);
      }
    }
  }
  if (previous.game.round === 2 && action.type === 'PLAY' && action.hand === previous.scenario.round2Plan?.upperHand
    && action.dieIds.includes(previous.scenario.round2Plan.singletonDieId)) complete(scenario, REQUIRED_BEATS.r2Twos);
  if (previous.game.round === 2 && action.type === 'PLAY' && action.hand === 'fullHouse') complete(scenario, REQUIRED_BEATS.r2FullHouse);
  if (previous.game.round === 3 && action.type === 'BUY') {
    const purchased = state.stats.purchases.at(-1);
    if (purchased?.enhancement === 'workout') {
      scenario.workoutBinding = { dieId: purchased.dieId, faceRank: purchased.face };
      scenario.workoutDieId = purchased.dieId;
      complete(scenario, REQUIRED_BEATS.workout);
    }
  }
  if (previous.game.round === 4 && action.type === 'PLAY' && action.hand === previous.scenario.round4Plan?.upperHand
    && action.dieIds.includes(previous.scenario.round4Plan.singletonDieId)) complete(scenario, REQUIRED_BEATS.r4Twos);
  if (previous.game.round === 4 && action.type === 'PLAY' && action.hand === 'fullHouse') complete(scenario, REQUIRED_BEATS.r4FullHouse);
  if (action.type === 'CHOOSE_FLAME' && !scenario.firstFlame) {
    const acquisition = state.stats.flameAcquisitions.at(-1);
    if (acquisition) { scenario.firstFlame = acquisition.flame; scenario.firstFlameDieId = acquisition.dieId; }
  }
  if (action.type === 'BUY' && state.stats.purchases.at(-1)?.enhancement === 'vintage') scenario.vintagePurchased = true;
  if (action.type === 'STOKE_FLAME') complete(scenario, 'flame-stoke');
  if (previous.game.round === 7 && action.type === 'PLAY') {
    if ((scenario.firstFlame === 'doubleDown' && action.hand === 'pair')
      || (scenario.firstFlame === 'straightShooter' && action.hand === 'smallStraight')) complete(scenario, REQUIRED_BEATS.flameDemoSetup);
    if ((scenario.firstFlame === 'doubleDown' && action.hand === 'twoPair')
      || (scenario.firstFlame === 'straightShooter' && action.hand === 'largeStraight')
      || (scenario.firstFlame === 'minigun' && ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].includes(action.hand))) {
      complete(scenario, REQUIRED_BEATS.flameDemoPayoff);
      complete(scenario, REQUIRED_BEATS.flameDemoSetup);
    }
  }
  const safeguard = resolution.events.some(event => event.type === 'TUTORIAL_SAFEGUARD');
  if (safeguard) {
    scenario.safeguardActivations++;
    scenario.safeguardRerollsGranted = 3;
    scenario.suppressedEncounterRound = state.boss ? state.round : null;
  } else if (action.type === 'MANUAL_REROLL' && scenario.safeguardRerollsGranted > 0) {
    scenario.safeguardRerollsGranted = Math.max(0, scenario.safeguardRerollsGranted - action.dieIds.length);
  }
  if (chapterNumberForRound(state.round) > 2) scenario.structuredCurriculumComplete = true;
}

export function newTutorialSession(): { session: TutorialSession; resolution: Resolution } {
  const initialDice = newRun(TUTORIAL_SEED).state.dice;
  const source = scriptedRollSource(initialDice, targetMap([1, 2, 1, 5, 6]), new SeededRng(0).state);
  const resolution = newRun(TUTORIAL_SEED, source);
  withBossPlan(resolution.state);
  for (const event of resolution.events) {
    if (event.type === 'CHAPTER_STARTED') { event.chapterMiniBoss = 'capitalReturn'; event.chapterBoss = 'quickdraw'; }
    event.board.bossSchedule[3] = 'capitalReturn';
    event.board.bossSchedule[6] = 'quickdraw';
    event.board.bossSchedule[9] = 'juggler';
    event.board.bossSchedule[12] = 'warden';
    event.board.chapterPlans[1] = { chapterNumber: 1, miniBoss: 'capitalReturn', boss: 'quickdraw' };
    event.board.chapterPlans[2] = { chapterNumber: 2, miniBoss: 'juggler', boss: 'warden' };
  }
  const scenario = initialTutorialScenario();
  curateTutorialOffers(resolution.state, scenario);
  patchFinalEvent(resolution);
  return { session: { tutorialVersion: TUTORIAL_VERSION, game: resolution.state, scenario }, resolution };
}

export function tutorialActionError(session: TutorialSession, action: Action): string | null {
  const { game: state, scenario } = session;
  const requires = (id: string) => !done(scenario, id);
  const planPlayable = (plan: TutorialScenarioState['round2Plan']) => !!plan
    && combinationsForHand(state.dice.filter(die => die.owner === 'player'), plan.upperHand)
      .some(ids => ids.includes(plan.singletonDieId));
  if (state.round === 1 && state.phase === 'round') {
    if (requires(REQUIRED_BEATS.reroll) && (action.type !== 'MANUAL_REROLL' || action.dieIds.length !== 1 || action.dieIds[0] !== 1)) return 'Select D2 and use one Reroll.';
    if (!requires(REQUIRED_BEATS.reroll) && requires(REQUIRED_BEATS.threeKind) && (action.type !== 'PLAY' || action.hand !== 'threeKind' || action.dieIds.some(id => ![0, 1, 2].includes(id)))) return 'Play Three of a Kind with the three 1s.';
  }
  if (state.phase === 'shop' && state.round === 1) {
    if (requires(REQUIRED_BEATS.training) && (action.type !== 'TRAIN_HAND' || action.hand !== 'fullHouse')) return 'Train Full House once.';
    if (!requires(REQUIRED_BEATS.training) && requires(REQUIRED_BEATS.bonus)) {
      const binding = scenario.bonusBinding;
      if (!binding || !bindingIsCurrent(session, binding)) return null;
      const offer = state.shop?.offers.find(item => item.id === (action.type === 'BUY' ? action.offerId : -1));
      if (action.type !== 'BUY' || offer?.enhancement !== 'bonus' || action.dieId !== binding.dieId)
        return `Buy Bonus and put it on D${binding.dieId + 1} showing ${binding.faceRank}.`;
    }
  }
  if (state.round === 2 && state.phase === 'round') {
    const plan = scenario.round2Plan;
    if (planPlayable(plan) && plan && requires(REQUIRED_BEATS.r2Twos)
      && (action.type !== 'PLAY' || action.hand !== plan.upperHand || !action.dieIds.includes(plan.singletonDieId)))
      return `Play ${HANDS[plan.upperHand].name} to reroll the lone die for free.`;
    if (plan && !requires(REQUIRED_BEATS.r2Twos) && requires(REQUIRED_BEATS.r2FullHouse)
      && combinationsForHand(state.dice.filter(die => die.owner === 'player'), 'fullHouse').length > 0
      && (action.type !== 'PLAY' || action.hand !== 'fullHouse')) return 'Play the trained Full House.';
  }
  if (state.phase === 'shop' && state.round === 3 && requires(REQUIRED_BEATS.workout)) {
    const binding = scenario.workoutBinding;
    if (!binding || !bindingIsCurrent(session, binding)) return null;
    const offer = state.shop?.offers.find(item => item.id === (action.type === 'BUY' ? action.offerId : -1));
    if (action.type !== 'BUY' || offer?.enhancement !== 'workout' || action.dieId !== binding.dieId)
      return `Buy Workout and put it on D${binding.dieId + 1} showing ${binding.faceRank}.`;
  }
  if (state.round === 4 && state.phase === 'round') {
    const plan = scenario.round4Plan;
    if (planPlayable(plan) && plan && requires(REQUIRED_BEATS.r4Twos)
      && (action.type !== 'PLAY' || action.hand !== plan.upperHand || !action.dieIds.includes(plan.singletonDieId)))
      return `Play ${HANDS[plan.upperHand].name} with the Workout die.`;
    if (plan && !requires(REQUIRED_BEATS.r4Twos) && requires(REQUIRED_BEATS.r4FullHouse)
      && combinationsForHand(state.dice.filter(die => die.owner === 'player'), 'fullHouse').length > 0
      && (action.type !== 'PLAY' || action.hand !== 'fullHouse')) return 'Play Full House again.';
  }
  if (state.round === 7 && state.phase === 'round') {
    const flameDie = scenario.firstFlameDieId;
    const includesFlame = (candidate: Action) => candidate.type === 'PLAY' && flameDie !== null && candidate.dieIds.includes(flameDie);
    if (requires(REQUIRED_BEATS.flameDemoSetup) && scenario.firstFlame === 'doubleDown'
      && (action.type !== 'PLAY' || action.hand !== 'pair' || !includesFlame(action))) return 'Play Pair with the die carrying Double Down.';
    if (requires(REQUIRED_BEATS.flameDemoSetup) && scenario.firstFlame === 'straightShooter'
      && (action.type !== 'PLAY' || action.hand !== 'smallStraight' || !includesFlame(action))) return 'Play Small Straight with the die carrying Straight Shooter.';
    if ((!requires(REQUIRED_BEATS.flameDemoSetup) || scenario.firstFlame === 'minigun') && requires(REQUIRED_BEATS.flameDemoPayoff)) {
      if (scenario.firstFlame === 'doubleDown' && (action.type !== 'PLAY' || action.hand !== 'twoPair' || !includesFlame(action))) return 'Play Two Pair with the Double Down die.';
      if (scenario.firstFlame === 'straightShooter' && (action.type !== 'PLAY' || action.hand !== 'largeStraight' || !includesFlame(action))) return 'Play Large Straight with the Straight Shooter die.';
      if (scenario.firstFlame === 'minigun' && (action.type !== 'PLAY' || !['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].includes(action.hand) || !includesFlame(action))) return 'Play an Upper hand with the Minigun die.';
    }
  }
  if (state.round === 6 && state.phase === 'flameSelection' && action.type === 'CONTINUE_FLAME_SELECTION' && !state.flameSelection?.acquired)
    return 'Choose one of the three Flames, then assign it to a die.';
  return null;
}

export function dispatchTutorial(session: TutorialSession, action: Action): { session: TutorialSession; resolution: Resolution; error?: string } {
  const prepared = structuredClone(session);
  reconcileTutorialBindings(prepared);
  const restriction = tutorialActionError(prepared, action);
  if (restriction) return { session: prepared, resolution: { state: prepared.game, events: [], error: restriction }, error: restriction };
  let source = sourceForAction(prepared, action);
  const nextRound = action.type === 'NEXT_ROUND' ? prepared.game.round + 1
    : action.type === 'RETRY_ROUND' ? prepared.game.round : null;
  const pendingPlan = nextRound === null ? null : rankPlanForRound(prepared, nextRound);
  if (action.type === 'NEXT_ROUND' || action.type === 'RETRY_ROUND') {
    const targets = openingTargetsForRound(prepared, nextRound!);
    if (targets) source = scriptedRollSource(prepared.game.dice, targets, prepared.game.rngState);
  }
  const chapter = chapterNumberForRound(prepared.game.round);
  const resolution = dispatch(prepared.game, action, source, {
    tutorialFinalLifeSafeguard: chapter <= 2,
    nonPayingManualRerolls: prepared.scenario.safeguardRerollsGranted,
  });
  if (resolution.error) return { session: prepared, resolution, error: resolution.error };
  if (source) resolution.state.rngState = source.fallback.state;
  const next: TutorialSession = { tutorialVersion: TUTORIAL_VERSION, game: resolution.state, scenario: structuredClone(prepared.scenario) };
  if (nextRound === 2 && pendingPlan) next.scenario.round2Plan = pendingPlan;
  if (nextRound === 4 && pendingPlan) next.scenario.round4Plan = pendingPlan;
  withBossPlan(next.game);
  synchronizeScenario(prepared, action, next, resolution);
  reconcileTutorialBindings(next);
  curateTutorialOffers(next.game, next.scenario);
  recoverImpossibleLesson(next);
  patchFinalEvent(resolution);
  return { session: next, resolution };
}

export function acknowledgeBeat(session: TutorialSession, beatId: string): TutorialSession {
  const next = structuredClone(session);
  complete(next.scenario, beatId);
  const lessonByBeat: Record<string, TutorialScenarioState['seenLessonIds'][number]> = {
    'context-interest': 'interest', 'context-bust': 'bust', 'context-selling': 'selling',
    'context-care-package': 'care-package', 'context-persistent': 'persistent-effect',
    'context-bonfire': 'bonfire', 'context-later-boss': 'later-boss',
    'context-safeguard': 'safeguard',
  };
  const lesson = lessonByBeat[beatId];
  if (lesson && !next.scenario.seenLessonIds.includes(lesson)) next.scenario.seenLessonIds.push(lesson);
  return next;
}

export function markLessonSeen(session: TutorialSession, lesson: TutorialScenarioState['seenLessonIds'][number]): TutorialSession {
  const next = structuredClone(session);
  if (!next.scenario.seenLessonIds.includes(lesson)) next.scenario.seenLessonIds.push(lesson);
  return next;
}

export const tutorialRequiredBeatIds = REQUIRED_BEATS;
