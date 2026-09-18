import type { Board, GameState, RunStats } from './types';

export function createStats(seed: string): RunStats {
  return {
    seed, roundReached: 1, rounds: [], handsPlayed: {}, purchases: [],
    trainingPurchases: [], trainingPurchasesTotal: 0, trainingGoldSpent: 0, enhancedFaces: [],
    enhancementShopRerolls: 0, shopDiceRerolls: 0, goldEarned: 0,
    goldBySource: { golden: 0, jackpot: 0, roundClear: 0 }, goldSpent: 0,
    goldSpentBySource: { enhancement: 0, shopDiceReroll: 0, enhancementReroll: 0, handTraining: 0 },
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
  const { phase, round, target, score, gold, manualRerollsRemaining, dice, consumed, scoreByHand, effectScore, handLevels, shop } = state;
  return structuredClone({ phase, round, target, score, gold, manualRerollsRemaining, dice, consumed, scoreByHand, effectScore, handLevels, shop });
}
export function exportRun(state: GameState) {
  return { schemaVersion: 6, scoringModel: 'trained-hand-accumulator-v3', ...state.stats,
    finalHandLevels: structuredClone(state.handLevels), rngState: state.rngState, board: boardSnapshot(state) };
}
