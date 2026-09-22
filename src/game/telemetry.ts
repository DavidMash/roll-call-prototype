import { activeFlameId } from './flames';
import type { Board, GameState, RunStats } from './types';

export function createStats(seed: string): RunStats {
  return {
    seed, roundReached: 1, rounds: [], handsPlayed: {}, purchases: [], scraps: [],
    trainingPurchases: [], trainingPurchasesTotal: 0, trainingGoldSpent: 0,
    flameAcquisitions: [], flameSkips: [], flameStokes: [], totalFlameInvestment: 0,
    bonfiresCreated: [], flameOfferRerolls: 0, flameRerollGoldSpent: 0, flameTriggers: {},
    xMultFactorsByFlame: {}, targetPracticeTargets: [], chargeGained: 0, chargeArmed: 0,
    chargeConsumed: 0, chargeResets: 0, personalTrainerAttempts: 0, personalTrainerSuccesses: 0,
    personalTrainerLevelsGranted: 0, hotStreakCharges: 0, hotStreakSkippedHands: [],
    lifetimeNormalShopGoldSpent: 0, moneyToBurnMultipliers: [], lowballAverages: [], magneticAnchorBatches: 0, magneticAttractions: 0,
    bumpControlledRolls: 0, enhancedFaces: [], enhancementShopRerolls: 0, shopDiceRerolls: 0,
    goldEarned: 0,
    goldBySource: { golden: 0, jackpot: 0, roundBase: 0, unusedRerolls: 0, interest: 0, flameBonus: 0 },
    goldSpent: 0,
    goldSpentBySource: { enhancement: 0, shopDiceReroll: 0, enhancementReroll: 0, handTraining: 0, flameReroll: 0, flameInvestment: 0 },
    manualRerollActions: 0, manualDiceRerolled: 0, manualRerolls: [], deadBoardRescues: 0,
    triggers: {}, probabilityProcs: {
      sticky: { checks: 0, successes: 0, failures: 0, stacksAtCheck: [] },
      hitchhiker: { checks: 0, successes: 0, failures: 0, stacksAtCheck: [] },
    }, scoreBySource: { hand: 0, jumpingBean: 0, hitchhiker: 0 }, scoreByHand: {},
    handScores: [], jumpingBeanFreePlays: [], standaloneScores: [], handBonusPips: 0, hitchhikerPipsContributed: 0,
    loss: null, actions: [], resolutionError: null,
  };
}
export function boardSnapshot(state: GameState): Board {
  const { phase, round, target, score, gold, manualRerollsRemaining, dice, bonfires, chargeXMult,
    chargeArmed, hotStreakGoal, hotStreakCharges, lifetimeNormalShopGoldSpent, consumed, scoreByHand, effectScore,
    handLevels, handPlayCounts, targetPracticeHand, lastRoundPayout, shop, flameReward } = state;
  return structuredClone({ phase, round, target, score, gold, manualRerollsRemaining, dice, bonfires,
    chargeXMult, chargeArmed, hotStreakGoal, hotStreakCharges, lifetimeNormalShopGoldSpent, consumed, scoreByHand, effectScore,
    handLevels, handPlayCounts, targetPracticeHand, lastRoundPayout, shop, flameReward });
}
export function exportRun(state: GameState) {
  return { schemaVersion: 11, scoringModel: 'free-upper-jumping-bean-v1', ...state.stats,
    bonfires: [...state.bonfires], finalHandLevels: structuredClone(state.handLevels),
    finalFlames: state.dice.map(die => ({ dieId: die.id, flame: activeFlameId(die.flame), investedGold: die.flame?.investedGold ?? 0 })),
    rngState: state.rngState, board: boardSnapshot(state) };
}
