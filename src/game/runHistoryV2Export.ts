import { ENHANCEMENTS } from './enhancements';
import { FLAMES } from './flames';
import { HANDS, HAND_IDS } from './hands';
import { formatPlayerNumber } from './copy';
import { RUN_HISTORY_V2_RULESET, RUN_HISTORY_V2_SCHEMA_VERSION } from './runHistoryV2';
import { renderGroupedRunHistoryV2 } from './runHistoryV2Renderer';
import { summarizeRunHistoryV2, type OfferImpressions } from './runHistoryV2Summary';
import { classifyRunHistoryV2Timelines } from './runHistoryV2Timeline';
import type { GameState, Rarity } from './types';

const number = (value: number) => formatPlayerNumber(value);
const entries = (record: Record<string, number> | Partial<Record<string, number>>) => Object.entries(record)
  .filter(([, value]) => value !== 0).map(([key, value]) => `${key} ${number(value ?? 0)}`).join(' · ') || 'None';
const percent = (value: number) => `${number(value * 100)}%`;

function offerLine(label: string, offers: OfferImpressions): string {
  const rarities = (Object.entries(offers.byRarity) as [Rarity, number][])
    .map(([rarity, count]) => `${rarity} ${number(count)} (${offers.total ? percent(count / offers.total) : '0%'})`).join(' · ');
  const sources = Object.entries(offers.bySource)
    .map(([source, count]) => `${source} ${number(count)} (${offers.total ? percent(count / offers.total) : '0%'})`).join(' · ');
  return `${label}: ${number(offers.total)} total${rarities ? ` · rarity: ${rarities}` : ''}${sources ? ` · source: ${sources}` : ''}`;
}

export function renderRunSummaryV2(state: GameState): string {
  const summary = summarizeRunHistoryV2(state.historyV2, state);
  const { identity, experienced, canonical, coverage } = summary;
  const incomplete = coverage.complete ? [] : [
    `INCOMPLETE V2 HISTORY · begins at Round ${number(coverage.firstRound)}, action ${number(coverage.firstActionId)}. Earlier activity is unavailable in V2 format.`,
    'Experienced totals and percentages below cover only the available V2 interval.',
  ];
  const largest = experienced.largestHand
    ? `${HANDS[experienced.largestHand.hand].name} ${number(experienced.largestHand.score)} · R${number(experienced.largestHand.round)} A${number(experienced.largestHand.attempt)}${experienced.largestHand.abandoned ? ' · rolled back' : ''}`
    : 'None';
  const build = canonical.retainedEnhancements.map(item => `D${item.dieId + 1}/side ${item.side}: ${Object.entries(item.enhancements)
    .map(([id, count]) => `${ENHANCEMENTS[id as keyof typeof ENHANCEMENTS].name} ×${number(count ?? 0)}`).join(', ')}`).join(' · ') || 'None';
  const embers = canonical.currentEmbers.map(item => `D${item.dieId + 1} ${FLAMES[item.flame].name} ${number(item.investedGold)}/100`).join(' · ') || 'None';
  const shares = experienced.largestHandShare;
  return [
    'ROLL CALL · RUN HISTORY V2',
    ...incomplete,
    '',
    'RESULT',
    `Seed: ${identity.seed ?? state.seed}`,
    `Ruleset: ${identity.ruleset ?? RUN_HISTORY_V2_RULESET} · History schema: ${identity.schemaVersion ?? RUN_HISTORY_V2_SCHEMA_VERSION}`,
    `Outcome: ${canonical.outcome} · Chapter ${canonical.finalChapter} · Round ${canonical.finalRound} · Local ${canonical.finalLocalRound}${canonical.finalBoss ? ` · Boss ${canonical.finalBoss}` : ''}`,
    `Cleared: ${number(canonical.roundsCleared)} canonical · ${number(experienced.roundsCleared)} experienced · Attempts ${number(experienced.attempts)} · Busts ${number(experienced.busts)}`,
    `Lives: ${number(canonical.finalLives)} final · ${number(experienced.livesLost)} lost · ${number(experienced.livesRestored)} restored`,
    `Largest hand experienced: ${largest}`,
    `Highest cleared-Round score: ${number(experienced.highestClearedRoundScore)} experienced · ${number(canonical.highestClearedRoundScore)} canonical`,
    '',
    'FINAL CANONICAL BUILD',
    `Hand levels: ${HAND_IDS.map(hand => `${HANDS[hand].name} ${number(canonical.finalHandLevels[hand] ?? 1)}`).join(' · ')}`,
    `Enhancements: ${build}`,
    `Embers: ${embers}`,
    `Bonfires: ${canonical.bonfires.map(flame => FLAMES[flame].name).join(' · ') || 'None'}`,
    `Wildfires: ${canonical.wildfires.map(item => `${FLAMES[item.flame].name} (sacrificed ${FLAMES[item.sacrificedFlame].name})`).join(' · ') || 'None'}`,
    `Flame timeline experienced: ${experienced.flameTimeline.map(item => `R${item.round} ${item.type}${item.flame ? ` ${FLAMES[item.flame].name}` : ''}${item.abandoned ? ' [rolled back]' : ''}`).join(' · ') || 'None'}`,
    '',
    'ECONOMY · CANONICAL',
    `Final Gold: ${number(canonical.finalGold)}`,
    `Earned: ${entries(canonical.goldEarnedBySource)}`,
    `Spent: ${entries(canonical.goldSpentByCategory)}`,
    `Training spend: individual ${number(canonical.trainingGoldSpent.individual)} · Team ${number(canonical.trainingGoldSpent.team)}`,
    `Vintage revenue experienced: ${number(experienced.vintageRevenue)} · Shop reroll spend experienced: ${number(experienced.shopRerollSpend)}`,
    '',
    'BALANCE',
    offerLine('Enhancement offers', experienced.offerImpressions.enhancement),
    offerLine('Flame offers', experienced.offerImpressions.flame),
    offerLine('Special Offer impressions', experienced.offerImpressions.special_offer),
    `Enhancement purchases by rarity: ${entries(experienced.enhancementPurchasesByRarity)}`,
    `Hands used: ${entries(experienced.handUsage)}`,
    `Score by hand: ${entries(experienced.scoreByHand)}`,
    `Largest-hand share: median ${shares.median === null ? '—' : percent(shares.median)} · P90 ${shares.p90 === null ? '—' : percent(shares.p90)} · max ${shares.maximum === null ? '—' : percent(shares.maximum)} · >50% ${shares.over50Percent}/${shares.samples} · >80% ${shares.over80Percent}/${shares.samples}`,
    `Flame activations: ${entries(experienced.flameActivations)}`,
    `Charge: armed ${number(experienced.charge.arms)} · consumed ${number(experienced.charge.consumes)} · resets ${number(experienced.charge.resets)}`,
    `Boss outcomes: ${entries(experienced.bossOutcomes)} · Special Offers: ${entries(experienced.specialOffers)} · Hooded: ${entries(experienced.hoodedOutcomes)}`,
  ].join('\n');
}

export function createRunHistoryTextV2(state: GameState): string {
  return `${renderRunSummaryV2(state)}\n\nCHRONOLOGICAL HISTORY\n${renderGroupedRunHistoryV2(state.historyV2, state.historyV2Coverage)}`;
}

export function exportRunHistoryV2(state: GameState) {
  const summary = summarizeRunHistoryV2(state.historyV2, state);
  const timelines = classifyRunHistoryV2Timelines(state.historyV2, state.historyV2Coverage);
  return {
    exportType: 'roll_call_run_history_v2',
    schemaVersion: RUN_HISTORY_V2_SCHEMA_VERSION,
    ruleset: RUN_HISTORY_V2_RULESET,
    identity: { seed: state.seed, rngState: state.rngState },
    coverage: state.historyV2Coverage,
    summary,
    timeline: summary.timelines,
    canonicalState: {
      phase: state.phase, round: state.round, attempt: state.roundAttemptNumber, score: state.score,
      target: state.target, gold: state.gold, lives: state.lives, currentNodeId: state.currentNodeId,
      build: summary.canonical, consumedHands: [...state.consumed], specialOfferEffects: structuredClone(state.specialOfferEffects),
    },
    events: state.historyV2.map(event => ({ ...event, timelineStatus: timelines.status(event) })),
  };
}

export function exportDebugTrace(state: GameState) {
  return {
    exportType: 'roll_call_debug_trace',
    debugTraceSchemaVersion: state.debugTrace.schemaVersion,
    historySchemaVersion: RUN_HISTORY_V2_SCHEMA_VERSION,
    ruleset: RUN_HISTORY_V2_RULESET,
    reproduction: { seed: state.seed, rngState: state.rngState, phase: state.phase, round: state.round,
      attempt: state.roundAttemptNumber, actionCount: state.actionJournal.length, traceMode: state.debugTrace.mode },
    historyCoverage: state.historyV2Coverage,
    actionJournal: state.actionJournal,
    trace: { mode: state.debugTrace.mode, firstAvailableSeq: state.debugTrace.firstAvailableSeq,
      nextSeq: state.debugTrace.nextSeq, droppedRecords: state.debugTrace.droppedRecords,
      bufferBytes: state.debugTrace.bufferBytes, records: state.debugTrace.records,
      criticalDiagnostics: state.debugTrace.critical },
  };
}
