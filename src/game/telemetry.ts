import type { Board, GameState, RunStats } from './types';
import { toExactJsonValue } from './scoreMath';

export function createStats(seed: string): RunStats {
  return {
    seed, roundReached: 1, rounds: [], busts: [],
    mapTransitions: [], bossEncounters: [], callerEvents: [], wardenEvents: [], hexerEvents: [],
    lifeRestores: [],
    trainingPurchases: [], trainingPurchasesTotal: 0, trainingGoldSpent: 0,
    flameAcquisitions: [], flameStokes: [], totalFlameInvestment: 0, flameTriggers: {},
    chargeGained: 0, chargeArmed: 0,
    chargeConsumed: 0, chargeResets: 0, hotStreakCharges: 0, hotStreakSkippedHands: [],
    lifetimeNormalShopGoldSpent: 0, diceOfferRerolls: 0,
    goldEarned: 0,
    goldBySource: { golden: 0, jackpot: 0, diceSale: 0, roundBase: 0, unusedRerolls: 0, interest: 0, bossReward: 0, specialOffer: 0 },
    goldSpent: 0,
    goldSpentBySource: { dicePurchase: 0, diceOfferReroll: 0, handTraining: 0, flameInvestment: 0, lifeRestore: 0, furnace: 0, greaseTheEngine: 0 },
    temperEarned: 0, temperSpent: 0,
    temperBySource: { overkill: 0, boardRefresh: 0, miniBoss: 0, boss: 0, bonfire: 0, engulfment: 0 },
    temperSpentBySource: { fusion: 0, forge: 0 }, temperTransactions: [],
    fusions: 0, forges: 0, highestEffectCount: 0, highestForgeRating: '0', mostValuableDieSold: 0,
    manualRerollActions: 0, manualDiceRerolled: 0, manualRerolls: [], deadBoardRescues: 0,
    scoreBySource: { hand: 0n, curtainCall: 0n, jumpingBean: 0n, hitchhiker: 0n, boss: 0n },
    handScores: [], jumpingBeanFreePlays: [], standaloneScores: [], handBonusPips: 0, hitchhikerPipsContributed: 0,
    loss: null, resolutionError: null,
  };
}
export function boardSnapshot(state: GameState): Board {
  const { phase, round, target, score, gold, temper, forgeUnlocked, roundTemper, lives, engulfmentLevel, nextShopVisitId, nextFlameInstanceId, roundAttemptNumber, bossSchedule, chapterPlans, presentedChapters, chapterLifecycle, boss, currentNodeId, bust, bustPresentationDice, flameTutorial,
    manualRerollsRemaining, manualRerollsUsedThisRound, specialOfferEffects, bossSilenced, dice, dieRoundState, flameSlots, chargeAttribution, infernoProgress, infernoEvaluation, infernoEvaluationSuspendedUntilNewFlame, chargeXMult, maxCharge, decisionId, sixPackXMult, sixPackUpperHandsPlayed, minigunUpperStreak, roundPlayCount, roundStartLives, roundStartRosterSize, precedingShopDiePurchase, interactiveFlames, scoreWagers,
    chargeArmed, hotStreakGoal, hotStreakCharges, handFamilyFlameStages, progressiveFlames, lifetimeNormalShopGoldSpent, consumed, scorecardCycleConsumed, scoreByHand, effectScore,
    handLevels, handPlayCounts, targetPracticeHand, fetchTarget, lastRoundPayout, roundSummary, shop, flameSelection, specialOffer } = state;
  return structuredClone({ phase, round, target, score, gold, temper, forgeUnlocked, roundTemper, lives, engulfmentLevel, nextShopVisitId, nextFlameInstanceId, roundAttemptNumber, bossSchedule, chapterPlans, presentedChapters, chapterLifecycle, boss, currentNodeId, bust, bustPresentationDice, flameTutorial,
    manualRerollsRemaining, manualRerollsUsedThisRound, specialOfferEffects, bossSilenced, dice, dieRoundState, flameSlots, chargeAttribution, infernoProgress, infernoEvaluation, infernoEvaluationSuspendedUntilNewFlame,
    chargeXMult, maxCharge, chargeArmed, decisionId, sixPackXMult, sixPackUpperHandsPlayed, minigunUpperStreak, roundPlayCount, roundStartLives, roundStartRosterSize, precedingShopDiePurchase, interactiveFlames, scoreWagers, hotStreakGoal, hotStreakCharges, handFamilyFlameStages, progressiveFlames, lifetimeNormalShopGoldSpent, consumed, scorecardCycleConsumed, scoreByHand, effectScore,
    handLevels, handPlayCounts, targetPracticeHand, fetchTarget, lastRoundPayout, roundSummary, shop, flameSelection, specialOffer });
}
export function exportRun(state: GameState) {
  return toExactJsonValue({ schemaVersion: 31, scoringModel: 'composable-die-effects-v1', ...state.stats,
    actions: structuredClone(state.actionJournal),
    scoreByHand: structuredClone(state.scoreByHand),
    finalHandLevels: structuredClone(state.handLevels),
    finalFlameSlots: structuredClone(state.flameSlots),
    rngState: state.rngState, board: boardSnapshot(state) });
}
