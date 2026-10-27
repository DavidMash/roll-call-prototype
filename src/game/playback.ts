import type { Board, GameEvent } from './types';
import { CONFIG } from './config';

export type PlaybackSpeed = keyof typeof CONFIG.tickMs;

/** Scoring dice receive short individual beats without slowing the rest of playback. */
export const playbackTickMs = (event: GameEvent | null | undefined, speed: PlaybackSpeed): number =>
  event?.type === 'DIE_PIPS_RESOLVED' ? CONFIG.scoringDieTickMs[speed] : CONFIG.tickMs[speed];

export const SCORE_SUMMARY_HOLD_MS = 420;
export const SCORECARD_REFRESH_HOLD_MS = { normal: 720, fast: 260, instant: 420 } as const;

export const isChapterMapTransition = (event: GameEvent | null | undefined) => event?.type === 'MAP_TRANSITION'
  && event.nodeType !== 'special_offer' && event.nodeType !== 'flame_selection';

export const isPlaybackBarrier = (event: GameEvent | undefined) => event?.type === 'CHAPTER_STARTED'
  || isChapterMapTransition(event)
  || (event?.type === 'ROUND_BUST' && (event.board.bust?.livesAfter ?? 0) > 0);

export const isPlaybackCheckpoint = (event: GameEvent | undefined) =>
  isPlaybackBarrier(event) || event?.type === 'SCORECARD_REFRESHED';

export const nextScorecardRefreshIndex = (events: GameEvent[], fromIndex: number) =>
  events.findIndex((event, index) => index > fromIndex && event.type === 'SCORECARD_REFRESHED');

/**
 * Raw resolution events that remain authoritative for state, history, and
 * diagnostics but do not deserve their own timed presentation frame.
 */
export function isPresentationSilentEvent(event: GameEvent | null | undefined): boolean {
  if (!event) return false;
  if (event.type === 'DIE_ROLLED' || event.type === 'BOSS_CLEARED') return true;
  if (event.type === 'GOLD_ADDED') return event.goldSource === 'roundBase'
    || event.goldSource === 'unusedRerolls' || event.goldSource === 'interest' || event.goldSource === 'bossReward';
  if (event.type === 'TEMPER_CHANGED') return event.temperSource === 'overkill'
    || event.temperSource === 'miniBoss' || event.temperSource === 'boss';
  return false;
}

/** Advances to the next player-visible beat while retaining the raw event list. */
export function nextPresentedEventIndex(events: GameEvent[], fromIndex: number): number {
  let nextIndex = Math.max(0, Math.min(fromIndex + 1, events.length));
  while (nextIndex < events.length && isPresentationSilentEvent(events[nextIndex])) nextIndex++;
  return nextIndex;
}

export const firstPresentedEventIndex = (events: GameEvent[]) => nextPresentedEventIndex(events, -1);

export interface ScoreSummaryJump {
  summaryIndex: number;
  boundaryIndex: number;
}

export interface RollBatchPresentation {
  startIndex: number;
  settleIndex: number;
  dieIds: number[];
}

/**
 * Finds the logical base-roll batch surrounding an individual roll event.
 * The engine still emits deterministic per-die results and follow-up effects;
 * presentation can project the final base-roll faces while retaining those raw events.
 */
export function rollBatchPresentation(events: GameEvent[], index: number): RollBatchPresentation | null {
  let startIndex = index;
  while (startIndex >= 0 && events[startIndex]?.type !== 'DICE_REROLL_STARTED') startIndex--;
  if (startIndex < 0 || startIndex === index) return null;
  const dieIds = events[startIndex].dieIds ?? [];
  const pending = new Set(dieIds);
  for (let cursor = startIndex + 1; cursor < events.length; cursor++) {
    const event = events[cursor];
    if (event.type === 'DICE_REROLL_STARTED') return null;
    if (event.type === 'DIE_ROLLED') for (const dieId of event.dieIds ?? []) pending.delete(dieId);
    if (!pending.size) return index <= cursor ? { startIndex, settleIndex: cursor, dieIds } : null;
  }
  return null;
}

/** Shows all base-roll results together while retaining the current event's non-dice state. */
export function playbackBoard(events: GameEvent[], index: number, fallback: Board): Board {
  const current = events[index];
  if (!current) return fallback;
  const batch = rollBatchPresentation(events, index);
  if (!batch) return current.board;
  const settledDice = new Map(events[batch.settleIndex].board.dice.map(die => [die.id, die.value]));
  const participating = new Set(batch.dieIds);
  return {
    ...current.board,
    dice: current.board.dice.map(die => participating.has(die.id)
      ? { ...die, value: settledDice.get(die.id) ?? die.value }
      : die),
  };
}

/** Finds the authoritative final score snapshot for the current resolution batch. */
export function scoreSummaryJump(events: GameEvent[], fromIndex: number): ScoreSummaryJump | null {
  const nextBarrier = events.findIndex((event, index) => index > fromIndex && isPlaybackCheckpoint(event));
  const boundaryIndex = nextBarrier === -1 ? events.length : nextBarrier;
  let summaryIndex = -1;
  for (let index = 0; index < boundaryIndex; index++) {
    if (events[index].type === 'HAND_SCORE_FINALIZED' || events[index].type === 'STANDALONE_SCORE_CALCULATED') summaryIndex = index;
  }
  return summaryIndex === -1 ? null : { summaryIndex, boundaryIndex };
}
