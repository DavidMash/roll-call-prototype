import { createInfernoEvaluation } from '../src/game/engulfment';
import { newRun } from '../src/game/engine';
import { placeFlameInstance } from '../src/game/flames';
import type { GameState } from '../src/game/types';
import type { RunHistoryV2Event } from '../src/game/runHistoryV2';

export function readyInfernoDeal(seed: string, factor = 25): GameState {
  const state = newRun(seed).state;
  const flame = placeFlameInstance(state, 'vineyard');
  for (let round = 1; round <= 3; round++) {
    const awarded = BigInt(Math.round(100 * factor));
    state.historyV2.push({ kind: 'hand_scored', seq: state.nextHistorySeq++, round, attempt: 1,
      actionId: state.nextActionId++, timelineId: state.historyV2TimelineId, scorePackageId: `deal:${round}`,
      rootPlayId: `deal:${round}`, parentPlayId: null, hand: 'ones', level: 1, playSource: 'manual',
      selectedDice: [0], scoringDice: [], scoreOccurrences: [{ id: `score:${round}`, rootId: `score:${round}`,
        dieId: 0, cause: 'play_selection', originallySelected: true, playerSelected: true, additional: false,
        suppressedEffects: [] }], consumed: true, score: { infernoMultiplier: 1n, finalPips: 100, handMult: 1,
        finalMult: 1, finalXMult: factor, bossFactor: 1, raw: awarded.toString(), awarded,
        rounding: { mode: 'nearest_integer', delta: '0' } }, roundScore: { before: 0n, afterAward: awarded, after: awarded },
      pipsContributions: [], resolvedDicePips: [], multContributions: [], xMultContributions: [{ sourceId: flame.type,
        origin: flame.stage, factor, sourceInstanceId: flame.instanceId }], sideEffects: [] } as unknown as RunHistoryV2Event);
    state.historyV2.push({ kind: 'round_attempt_finished', seq: state.nextHistorySeq++, round, attempt: 1,
      actionId: state.nextActionId++, timelineId: state.historyV2TimelineId, outcome: 'cleared', score: awarded,
      target: 1n, boss: null, livesBefore: 3, livesAfter: 3 } as RunHistoryV2Event);
  }
  state.infernoEvaluation = createInfernoEvaluation(state)!;
  state.phase = 'inferno';
  return state;
}
