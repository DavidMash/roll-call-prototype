import { dispatch, newRun } from '../game/engine';
import { SeededRng } from '../game/rng';
import { boardSnapshot } from '../game/telemetry';
import type { Action, GameState, Rank, Resolution } from '../game/types';
import { chapterNumberForRound } from '../game/chapters';
import { combinationsForHand, UPPER_HAND_IDS } from '../game/hands';
import { curateTutorialOffers } from './curatedOffers';
import { scriptedRollSource, targetMap, type EventAddressedRollSource } from './scriptedRolls';
import { initialTutorialScenario } from './tutorialPersistence';
import { TUTORIAL_SEED, TUTORIAL_VERSION, type TutorialScenarioState, type TutorialSession } from './types';

const REQUIRED_BEATS = {
  reroll: 'c1-r1-reroll', threeKind: 'c1-r1-three-kind', pair: 'c1-r1-pair', sixes: 'c1-r1-sixes',
  fives: 'c1-r1-fives', straight: 'c1-r1-small-straight', training: 'shop1-train-full-house',
  flameDemoSetup: 'c2-r1-setup', flameDemoPayoff: 'c2-r1-payoff',
} as const;

const complete = (scenario: TutorialScenarioState, id: string) => {
  if (!scenario.completedBeatIds.includes(id)) scenario.completedBeatIds.push(id);
};
const done = (scenario: TutorialScenarioState, id: string) => scenario.completedBeatIds.includes(id);

function withBossPlan(state: GameState): void {
  state.bossSchedule[3] = 'capitalReturn';
  state.bossSchedule[6] = 'magician';
  state.bossSchedule[9] = 'quickdraw';
  state.bossSchedule[12] = 'warden';
  state.chapterPlans[1] = { chapterNumber: 1, miniBoss: 'capitalReturn', boss: 'magician' };
  state.chapterPlans[2] = { chapterNumber: 2, miniBoss: 'quickdraw', boss: 'warden' };
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
  if (state.round === 7 && action.type === 'PLAY' && !done(scenario, REQUIRED_BEATS.flameDemoSetup)) {
    const primaryDie = action.dieIds[0] ?? 0;
    if (scenario.firstFlame === 'doubleDown' && action.hand === 'pair') {
      const other = action.dieIds.find(id => id !== primaryDie) ?? action.dieIds[0];
      targets = targetMap([2, 4], [primaryDie, other]);
    } else if (scenario.firstFlame === 'straightShooter' && action.hand === 'smallStraight') {
      const sorted = [...action.dieIds].sort((a, b) => a - b);
      targets = targetMap([2, 3, 4, 5], sorted);
    }
  }
  return targets ? scriptedRollSource(state.dice, targets, state.rngState, exclude) : undefined;
}

function openingTargetsForRound(session: TutorialSession, nextRound: number): Map<number, Rank> | null {
  if (nextRound !== 7) return null;
  const { scenario } = session;
  const primaryDie = 0;
  if (scenario.firstFlame === 'straightShooter') {
    const result = targetMap([1, 2, 3, 4, 6]);
    return result;
  }
  const other = [0, 1, 2, 3, 4].find(id => id !== primaryDie)!;
  const result = new Map<number, Rank>();
  result.set(primaryDie, 6);
  result.set(other, 6);
  const remaining = [0, 1, 2, 3, 4].filter(id => id !== primaryDie && id !== other);
  const held: Rank[] = scenario.firstFlame === 'doubleDown' ? [2, 4, 5] : [1, 3, 4];
  remaining.forEach((id, index) => result.set(id, held[index]));
  return result;
}

function recoverImpossibleLesson(session: TutorialSession): void {
  const { game: state, scenario } = session;
  const playerDice = state.dice.filter(die => die.owner === 'player');
  if (state.round === 7 && state.phase === 'round') {
    if (!done(scenario, REQUIRED_BEATS.flameDemoSetup)) {
      const setup = scenario.firstFlame === 'doubleDown' ? 'pair' : scenario.firstFlame === 'straightShooter' ? 'smallStraight' : null;
      if (setup && combinationsForHand(playerDice, setup).length === 0) { complete(scenario, REQUIRED_BEATS.flameDemoSetup); complete(scenario, REQUIRED_BEATS.flameDemoPayoff); }
    } else if (!done(scenario, REQUIRED_BEATS.flameDemoPayoff)) {
      const payoff = scenario.firstFlame === 'doubleDown' ? 'twoPair' : scenario.firstFlame === 'straightShooter' ? 'largeStraight' : null;
      const minigunPlayable = scenario.firstFlame === 'minigun' && UPPER_HAND_IDS.some(hand => combinationsForHand(playerDice, hand).length > 0);
      if ((payoff && combinationsForHand(playerDice, payoff).length === 0) || (scenario.firstFlame === 'minigun' && !minigunPlayable)) complete(scenario, REQUIRED_BEATS.flameDemoPayoff);
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
  }
  if (action.type === 'CHOOSE_FLAME' && !scenario.firstFlame) {
    const acquisition = state.stats.flameAcquisitions.at(-1);
    if (acquisition) {
      scenario.firstFlame = acquisition.flame;
      scenario.firstFlameInstanceId = acquisition.instanceId;
    }
  }
  if (action.type === 'STOKE_FLAME') complete(scenario, 'flame-stoke');
  if (action.type === 'DISMISS_FLAME_TUTORIAL'
    || ((action.type === 'NEXT_ROUND' || action.type === 'NEXT_CHAPTER') && previous.game.phase === 'shop'
      && !!previous.scenario.firstFlame && !done(previous.scenario, 'flame-details'))) complete(scenario, 'flame-details');
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
    if (event.type === 'CHAPTER_STARTED') { event.chapterMiniBoss = 'capitalReturn'; event.chapterBoss = 'magician'; }
    event.board.bossSchedule[3] = 'capitalReturn';
    event.board.bossSchedule[6] = 'magician';
    event.board.bossSchedule[9] = 'quickdraw';
    event.board.bossSchedule[12] = 'warden';
    event.board.chapterPlans[1] = { chapterNumber: 1, miniBoss: 'capitalReturn', boss: 'magician' };
    event.board.chapterPlans[2] = { chapterNumber: 2, miniBoss: 'quickdraw', boss: 'warden' };
  }
  const scenario = initialTutorialScenario();
  curateTutorialOffers(resolution.state, scenario);
  patchFinalEvent(resolution);
  return { session: { tutorialVersion: TUTORIAL_VERSION, game: resolution.state, scenario }, resolution };
}

export function tutorialActionError(session: TutorialSession, action: Action): string | null {
  const { game: state, scenario } = session;
  const requires = (id: string) => !done(scenario, id);
  if (state.round === 1 && state.phase === 'round') {
    if (requires(REQUIRED_BEATS.reroll) && (action.type !== 'MANUAL_REROLL' || action.dieIds.length !== 1 || action.dieIds[0] !== 1)) return 'Select D2 and use one Reroll.';
    if (!requires(REQUIRED_BEATS.reroll) && requires(REQUIRED_BEATS.threeKind) && (action.type !== 'PLAY' || action.hand !== 'threeKind' || action.dieIds.some(id => ![0, 1, 2].includes(id)))) return 'Play Three of a Kind with the three 1s.';
  }
  if (state.phase === 'shop' && state.round === 1) {
    if (requires(REQUIRED_BEATS.training) && state.shop?.stage === 'shop') {
      if (action.type !== 'SET_SHOP_STAGE' || action.stage !== 'train') return 'Continue to Train first.';
    } else if (requires(REQUIRED_BEATS.training) && (action.type !== 'TRAIN_HAND' || action.hand !== 'fullHouse')) return 'Train Full House once.';
  }
  if (state.round === 7 && state.phase === 'round') {
    if (requires(REQUIRED_BEATS.flameDemoSetup) && scenario.firstFlame === 'doubleDown'
      && (action.type !== 'PLAY' || action.hand !== 'pair')) return 'Play Pair to set up Double Down.';
    if (requires(REQUIRED_BEATS.flameDemoSetup) && scenario.firstFlame === 'straightShooter'
      && (action.type !== 'PLAY' || action.hand !== 'smallStraight')) return 'Play Small Straight to set up Straight Shooter.';
    if ((!requires(REQUIRED_BEATS.flameDemoSetup) || scenario.firstFlame === 'minigun') && requires(REQUIRED_BEATS.flameDemoPayoff)) {
      if (scenario.firstFlame === 'doubleDown' && (action.type !== 'PLAY' || action.hand !== 'twoPair')) return 'Play Two Pair for Double Down.';
      if (scenario.firstFlame === 'straightShooter' && (action.type !== 'PLAY' || action.hand !== 'largeStraight')) return 'Play Large Straight for Straight Shooter.';
      if (scenario.firstFlame === 'minigun' && (action.type !== 'PLAY' || !['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].includes(action.hand))) return 'Play an Upper hand for Minigun.';
    }
  }
  if (state.round === 6 && state.phase === 'flameSelection' && action.type === 'CONTINUE_FLAME_SELECTION' && !state.flameSelection?.acquired)
    return 'Choose one of the three Flames.';
  return null;
}

export function dispatchTutorial(session: TutorialSession, action: Action): { session: TutorialSession; resolution: Resolution; error?: string } {
  const prepared = structuredClone(session);
  const restriction = tutorialActionError(prepared, action);
  if (restriction) return { session: prepared, resolution: { state: prepared.game, events: [], error: restriction }, error: restriction };
  let source = sourceForAction(prepared, action);
  const nextRound = action.type === 'NEXT_ROUND' || action.type === 'NEXT_CHAPTER' ? prepared.game.round + 1
    : action.type === 'RETRY_ROUND' ? prepared.game.round : null;
  if (action.type === 'NEXT_ROUND' || action.type === 'NEXT_CHAPTER' || action.type === 'RETRY_ROUND') {
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
  withBossPlan(next.game);
  synchronizeScenario(prepared, action, next, resolution);
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
