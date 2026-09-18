import type { Board, GameState, RunStats } from './types';

export function createStats(seed: string): RunStats {
  return {
    seed, roundReached: 1, rounds: [], handsPlayed: {}, purchases: [], enhancedFaces: [],
    enhancementShopRerolls: 0, shopDiceRerolls: 0, goldEarned: 0, goldSpent: 0,
    manualRerollActions: 0, manualDiceRerolled: 0, manualRerolls: [], deadBoardRescues: 0,
    triggers: {}, probabilityProcs: {
      sticky: { checks: 0, successes: 0, failures: 0, stacksAtCheck: [] },
      sustainable: { checks: 0, successes: 0, failures: 0, stacksAtCheck: [] },
    }, scoreBySource: { hand: 0, jumpingBean: 0, hitchhiker: 0 }, scoreByHand: {},
    handScores: [], handBonusPips: 0, hitchhikerPipsContributed: 0,
    loss: null, actions: [], resolutionError: null,
  };
}
export function boardSnapshot(state: GameState): Board {
  const { phase, round, target, score, gold, manualRerollsRemaining, dice, consumed, scoreByHand, effectScore, shop } = state;
  return structuredClone({ phase, round, target, score, gold, manualRerollsRemaining, dice, consumed, scoreByHand, effectScore, shop });
}
export function exportRun(state: GameState) {
  return { schemaVersion: 4, scoringModel: 'hand-base-pips-accumulator-v2', ...state.stats,
    rngState: state.rngState, board: boardSnapshot(state) };
}
