import type { GameEvent } from './types';

export const SCORE_SUMMARY_HOLD_MS = 420;

export const isChapterMapTransition = (event: GameEvent | null | undefined) => event?.type === 'MAP_TRANSITION'
  && event.nodeType !== 'special_offer' && event.nodeType !== 'flame_selection';

export const isPlaybackBarrier = (event: GameEvent | undefined) => event?.type === 'CHAPTER_STARTED'
  || isChapterMapTransition(event)
  || (event?.type === 'ROUND_BUST' && (event.board.bust?.livesAfter ?? 0) > 0);

export interface ScoreSummaryJump {
  summaryIndex: number;
  boundaryIndex: number;
}

/** Finds the authoritative final score snapshot for the current resolution batch. */
export function scoreSummaryJump(events: GameEvent[], fromIndex: number): ScoreSummaryJump | null {
  const nextBarrier = events.findIndex((event, index) => index > fromIndex && isPlaybackBarrier(event));
  const boundaryIndex = nextBarrier === -1 ? events.length : nextBarrier;
  let summaryIndex = -1;
  for (let index = 0; index < boundaryIndex; index++) {
    if (events[index].type === 'HAND_SCORE_FINALIZED' || events[index].type === 'STANDALONE_SCORE_CALCULATED') summaryIndex = index;
  }
  return summaryIndex === -1 ? null : { summaryIndex, boundaryIndex };
}
