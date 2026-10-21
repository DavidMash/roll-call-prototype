import { FLAMES } from './flames';
import { HANDS, HAND_IDS } from './hands';
import { SPECIAL_DICE } from './specialDice';
import { formatExactScore, formatPlayerNumber } from './copy';
import { RUN_HISTORY_V2_RULESET, RUN_HISTORY_V2_SCHEMA_VERSION } from './runHistoryV2';
import { renderGroupedRunHistoryV2 } from './runHistoryV2Renderer';
import { summarizeRunHistoryV2, type OfferImpressions } from './runHistoryV2Summary';
import { classifyRunHistoryV2Timelines } from './runHistoryV2Timeline';
import { infernoMultiplier } from './scoring';
import type { DiceRarity, GameState } from './types';
import { toExactJsonValue } from './scoreMath';

const number = (value: number | bigint) => typeof value === 'bigint' ? formatExactScore(value) : formatPlayerNumber(value);
const entries = (record: Record<string, number | bigint> | Partial<Record<string, number | bigint>>) => Object.entries(record)
  .filter(([, value]) => value !== 0 && value !== 0n).map(([key, value]) => `${key} ${number(value ?? 0)}`).join(' · ') || 'None';
const forgeSpendEntries = (record: Partial<Record<string, number | bigint>>) => {
  const combined: Partial<Record<string, number | bigint>> = {
    ...record, forge: Number(record.forge ?? 0) + Number(record.fusion ?? 0),
  };
  delete combined.fusion;
  return entries(combined);
};
const percent = (value: number) => `${number(value * 100)}%`;

function offerLine(label: string, offers: OfferImpressions): string {
  const rarities = (Object.entries(offers.byRarity) as [DiceRarity, number][])
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
  const dieBuildLabel = (item: typeof canonical.ownedDice[number]) => (item.effects.length
    ? item.effects.map(effect => `${SPECIAL_DICE[effect.type].name} Lv${effect.level}`).join(' + ') : 'Normal')
    + ` [ID #${item.dieId}]`;
  const roster = canonical.ownedDice.filter(item => item.rosterSlot !== null)
    .sort((a, b) => a.rosterSlot! - b.rosterSlot!).map(item => `R${item.rosterSlot! + 1} ${dieBuildLabel(item)}`).join(' · ') || 'None';
  const storage = canonical.ownedDice.filter(item => item.storageSlot !== null)
    .sort((a, b) => a.storageSlot! - b.storageSlot!).map(item => `S${item.storageSlot! + 1} ${dieBuildLabel(item)}`).join(' · ') || 'Empty';
  const flames = canonical.flameSlots.map(item => `Slot ${item.slot + 1} ${FLAMES[item.flame.type].name} ${item.flame.stage} ${number(item.flame.investedGold)}/100`).join(' · ') || 'None';
  const diceEconomy = Object.entries(experienced.diceEconomy.byType)
    .map(([type, metric]) => `${SPECIAL_DICE[type as keyof typeof SPECIAL_DICE].name}: bought ${metric.purchased}, sold ${metric.sold}, forged ${metric.fused}`).join(' · ') || 'None';
  const training = Object.entries(experienced.trainingByHand)
    .map(([hand, metric]) => `${HANDS[hand as keyof typeof HANDS].name}: ${metric.purchases} purchase${metric.purchases === 1 ? '' : 's'}, ${number(metric.goldSpent)} Gold, max tier ${metric.maximumRelativeTier}, max quote ${number(metric.maximumNormalPrice)}`).join(' · ') || 'None';
  const specialDice = Object.entries(experienced.specialDice)
    .filter(([type]) => type !== 'normal')
    .map(([type, metric]) => `${SPECIAL_DICE[type as keyof typeof SPECIAL_DICE].name}: ${metric.activations} activations, ${metric.invocationsSpent} Uses, ${metric.commandUses} commands, ${metric.scoreOccurrences} Scores (${metric.additionalScores} additional)`).join(' · ') || 'None';
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
    `Inferno: Level ${number(canonical.infernoLevel)} · ×${number(canonical.infernoMultiplier)}`,
    `Hand levels: ${HAND_IDS.map(hand => `${HANDS[hand].name} ${number(canonical.finalHandLevels[hand] ?? 1)}`).join(' · ')}`,
    `Active Roster: ${roster}`,
    `Storage: ${storage}`,
    `Flame slots: ${flames}`,
    `Flame timeline experienced: ${experienced.flameTimeline.map(item => `R${item.round} ${item.type}${item.flame ? ` ${FLAMES[item.flame].name}` : ''}${item.abandoned ? ' [rolled back]' : ''}`).join(' · ') || 'None'}`,
    '',
    'ECONOMY · CANONICAL',
    `Final Gold: ${number(canonical.finalGold)}`,
    `Final Temper: ${number(canonical.finalTemper)} · earned ${number(experienced.temperEarned)} (${entries(experienced.temperBySource)}) · spent ${number(experienced.temperSpent)} (${forgeSpendEntries(experienced.temperSpentBySource)})`,
    `Earned: ${entries(canonical.goldEarnedBySource)}`,
    `Spent: ${entries(canonical.goldSpentByCategory)}`,
    `Training spend: ${number(canonical.trainingGoldSpent)} Gold`,
    `Dice economy: ${number(experienced.diceEconomy.purchases)} purchases / ${number(experienced.diceEconomy.purchaseGold)} Gold · ${number(experienced.diceEconomy.sales)} sales / ${number(experienced.diceEconomy.saleGold)} Gold · ${number(experienced.diceEconomy.moves)} moves · ${number(experienced.diceEconomy.fusions)} fusions`,
    `Dice types: ${diceEconomy}`,
    `Training by hand: ${training}`,
    `Shop reroll spend experienced: ${number(experienced.shopRerollSpend)}`,
    '',
    'BALANCE',
    offerLine('Dice offers', experienced.offerImpressions.dice),
    offerLine('Flame offers', experienced.offerImpressions.flame),
    offerLine('Special Offer impressions', experienced.offerImpressions.special_offer),
    `Hands used: ${entries(experienced.handUsage)}`,
    `Score by hand: ${entries(experienced.scoreByHand)}`,
    `Largest-hand share: median ${shares.median === null ? '—' : percent(shares.median)} · P90 ${shares.p90 === null ? '—' : percent(shares.p90)} · max ${shares.maximum === null ? '—' : percent(shares.maximum)} · >50% ${shares.over50Percent}/${shares.samples} · >80% ${shares.over80Percent}/${shares.samples}`,
    `Flame activations: ${entries(experienced.flameActivations)}`,
    `Flame lifecycle: acquired ${number(experienced.flameLifecycle.acquired)} · replaced ${number(experienced.flameLifecycle.replaced)} · invested ${number(experienced.flameLifecycle.stokedGold)} Gold · Bonfires ${number(experienced.flameLifecycle.bonfires)} · Engulfed ${number(experienced.flameLifecycle.engulfed)}`,
    `Special dice: ${specialDice}`,
    `Charge: armed ${number(experienced.charge.arms)} · consumed ${number(experienced.charge.consumes)} · resets ${number(experienced.charge.resets)}`,
    `Boss outcomes: ${entries(experienced.bossOutcomes)} · Special Offers: ${entries(experienced.specialOffers)}`,
  ].join('\n');
}

export function createRunHistoryTextV2(state: GameState): string {
  return `${renderRunSummaryV2(state)}\n\nCHRONOLOGICAL HISTORY\n${renderGroupedRunHistoryV2(state.historyV2, state.historyV2Coverage)}`;
}

export function exportRunHistoryV2(state: GameState) {
  const summary = summarizeRunHistoryV2(state.historyV2, state);
  const timelines = classifyRunHistoryV2Timelines(state.historyV2, state.historyV2Coverage);
  return toExactJsonValue({
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
      infernoLevel: state.engulfmentLevel, infernoMultiplier: infernoMultiplier(state.engulfmentLevel),
      shopVisit: state.shop ? { id: state.shop.visitId } : null,
      build: summary.canonical, consumedHands: [...state.consumed], specialOfferEffects: structuredClone(state.specialOfferEffects),
    },
    events: state.historyV2.map(event => ({ ...event, timelineStatus: timelines.status(event) })),
  });
}

export function exportDebugTrace(state: GameState) {
  return toExactJsonValue({
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
  });
}
