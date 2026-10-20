import { FLAMES } from './flames';
import { HANDS } from './hands';
import { formatExactScore, formatPlayerNumber } from './copy';
import type { FlameOrigin, HandScoredEvent, RunHistoryV2Coverage, RunHistoryV2Event, XMultContribution } from './runHistoryV2';
import { chapterNumberForRound, chapterRoundForRound } from './chapters';
import { classifyRunHistoryV2Timelines } from './runHistoryV2Timeline';

const number = (value: number | bigint) => typeof value === 'bigint' ? formatExactScore(value) : formatPlayerNumber(value);
// A collectible ID is stable identity, not a Roster position.
const die = (id: number) => `Die #${id}`;
const label = (value: string) => value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\b\w/g, character => character.toUpperCase());

const originLabel: Record<FlameOrigin, string> = {
  ember: 'Ember', bonfire: 'Bonfire', charge: 'Charge', boss: 'Boss',
  special_offer: 'Special Offer', external: 'External',
};

function xMultLabel(contribution: XMultContribution): string {
  if (contribution.sourceId === 'charge') return `Charge ×${number(contribution.factor)}${contribution.chargeSources?.length
    ? ` [${contribution.chargeSources.map(source => `${FLAMES[source.flame].name}${source.instanceId === undefined ? '' : ` #${number(source.instanceId)}`} ×${number(source.factor)}`).join(', ')}]` : ''}`;
  const source = contribution.sourceId in FLAMES
    ? FLAMES[contribution.sourceId as keyof typeof FLAMES].name
    : String(contribution.sourceId);
  const location = originLabel[contribution.origin];
  return `${location} ${source} ×${number(contribution.factor)}`;
}

function sideEffectLabel(effect: HandScoredEvent['sideEffects'][number]): string {
  switch (effect.type) {
    case 'gold': return `${effect.dieId === undefined ? '' : `${die(effect.dieId)} `}${label(effect.source)} +${number(effect.amount)} Gold`;
    case 'double_time': return `${die(effect.dieId)} Double Time ${effect.succeeded ? 'succeeded' : 'failed'}`;
    case 'special_die': return `${die(effect.dieId)} ${label(effect.dieType)} ${effect.detail}`;
    case 'charge': return `Charge ${label(effect.operation)} ×${number(effect.before)}→×${number(effect.after)}`;
    case 'flame_activation': return `${originLabel[effect.origin]} ${FLAMES[effect.flame].name}${effect.factor === undefined ? '' : ` ×${number(effect.factor)}`}`;
    case 'free_play': return `${die(effect.dieId)} Free Play event ${effect.rerollEventId}`;
    case 'sustainable': return `${die(effect.dieId)} Sustainable preserved ${HANDS[effect.hand].name} (${number(effect.chargesRemaining)} left)`;
    case 'conjoined': return `${die(effect.dieId)} Conjoined duplicated itself for ${HANDS[effect.hand].name} Qualification and Scoring`;
    case 'boss_state': return `${label(effect.boss)} ${label(effect.change)}`;
  }
}

export function renderHandScoredV2(event: HandScoredEvent): string {
  const play = event.playSource === 'manual' ? 'PLAY' : 'FREE PLAY';
  const title = `${play} · ${HANDS[event.hand].name} Lv${number(event.level)}`;
  const meaningfulPips = event.pipsContributions.some(item => item.source !== 'hand_base' && item.source !== 'die_base');
  const meaningfulMult = event.multContributions.some(item => item.source !== 'hand_base');
  const expanded = meaningfulPips || meaningfulMult || event.xMultContributions.length > 0 || event.sideEffects.length > 0;
  if (!expanded) return `${title} · ${(event.score.infernoMultiplier ?? 1) > 1 ? `Inferno ×${number(event.score.infernoMultiplier ?? 1)} · ` : ''}${number(event.score.finalPips)} Pips × ${number(event.score.finalMult)} Mult × ${number(event.score.finalXMult * event.score.bossFactor)} XMult = ${number(event.score.awarded)}`;

  const dice = event.scoringDice.map(item => `${die(item.dieId)}=${number(item.pips)}`).join(', ');
  const pipsEffects = event.pipsContributions.filter(item => item.source !== 'hand_base' && item.source !== 'die_base')
    .map(item => `${item.dieId === undefined ? '' : `${die(item.dieId)} `}${label(item.source)} +${number(item.amount)}`);
  const multEffects = event.multContributions.filter(item => item.source !== 'hand_base')
    .map(item => `${label(item.source)} ×${number(item.factor)}`);
  const xMultEffects = event.xMultContributions.map(xMultLabel);
  const other = event.sideEffects.map(sideEffectLabel);
  return [
    title,
    `Dice: ${dice}`,
    `Pips: ${number(event.score.basePips)} → ${number(event.score.finalPips)}${pipsEffects.length ? ` [${pipsEffects.join(', ')}]` : ''}`,
    `Mult: ${number(event.score.baseMult)} → ${number(event.score.finalMult)}${multEffects.length ? ` [${multEffects.join(', ')}]` : ''}`,
    `XMult: 1 → ${number(event.score.finalXMult * event.score.bossFactor)}${xMultEffects.length ? ` [${xMultEffects.join(', ')}]` : ''}`,
    `Score: ${(event.score.infernoMultiplier ?? 1) > 1 ? `Inferno ×${number(event.score.infernoMultiplier ?? 1)} · ` : ''}${number(event.score.awarded)}`,
    ...(other.length ? [`Other: ${other.join(' · ')}`] : []),
  ].join('\n');
}

export function renderRunHistoryV2Event(event: RunHistoryV2Event): string {
  switch (event.kind) {
    case 'run_started': return `RUN · ${event.seed} · schema ${event.schemaVersion} · ${event.ruleset}`;
    case 'chapter_started': return `CHAPTER ${number(event.chapter)} · ${event.miniBoss} / ${event.boss}`;
    case 'round_attempt_started': {
      const target = event.target as typeof event.target & { final?: number };
      return `ROUND ${number(event.round)} · Attempt ${number(event.attempt)} · Goal ${number(target.finalGoal ?? target.final ?? 0)}${event.boss ? ` · ${event.boss}` : ''}`;
    }
    case 'hand_scored': return renderHandScoredV2(event);
    case 'special_die_activated': return `SPECIAL DIE · ${label(event.dieType)} Lv${number(event.level)} · ${die(event.dieId)} · ${event.detail}`;
    case 'roll_batch': return `ROLL · ${event.reason} · ${event.results.map(result => `${die(result.dieId)} ${number(result.beforeFace)}→${number(result.afterFace)}`).join(' · ')}`;
    case 'shop_visit_started': return `SHOP VISIT ${number(event.shopVisitId)} · ${event.reason} · ${label(event.initialStage)}`;
    case 'shop_stage_changed': return `SHOP ${number(event.shopVisitId)} · ${label(event.from)} → ${label(event.to)}`;
    case 'temper_changed': return `TEMPER · ${event.operation.toUpperCase()} · ${label(event.source)} ${event.operation === 'earned' ? '+' : '−'}${number(event.amount)} · balance ${number(event.balance)}`;
    case 'training_session_started': return `TRAINING SESSION · Shop ${number(event.shopVisitId)} · Upper baseline ${number(event.upperBaseline)} · Lower baseline ${number(event.lowerBaseline)}`;
    case 'team_training_applied': return `TEAM TRAINING · Offer ${number(event.offerId)} · all hands +1`;
    case 'shop_visit_completed': return `SHOP ${number(event.shopVisitId)} COMPLETE · ${label(event.progression)}`;
    case 'shop_offers_presented': return `OFFERS · ${event.pool}${event.shopVisitId === undefined ? '' : ` · Shop ${number(event.shopVisitId)}`}`
      + ` · ${event.offers.map(offer => `${offer.contentId} [${offer.rarity}]`).join(', ')}`;
    case 'shop_transaction': {
      const transaction = event.transaction;
      switch (transaction.type) {
        case 'dice_purchased': return `DICE PURCHASE · offer ${number(transaction.offerId)} · Die #${number(transaction.dieId)} ${label(transaction.dieType)} Lv${number(transaction.level)} · ${number(transaction.pricePaid)} Gold · ${label(transaction.destination.area)} ${number(transaction.destination.index + 1)}`;
        case 'dice_sold': return `DICE SALE · Die #${number(transaction.dieId)} ${transaction.effects.map(effect => `${label(effect.type)} Lv${number(effect.level)}`).join(' + ') || 'Normal'} · ${number(transaction.proceeds)} Gold (${number(transaction.componentSalvage)} components + ${number(transaction.complexityPremium)} complexity + ${number(transaction.vintageAppreciation)} Vintage) · ${label(transaction.source.area)} ${number(transaction.source.index + 1)}`;
        case 'dice_moved': return `DICE MOVE · ${label(transaction.source.area)} ${number(transaction.source.index + 1)} → ${label(transaction.destination.area)} ${number(transaction.destination.index + 1)} · source #${number(transaction.sourceDieId)}${transaction.destinationDieId === null ? '' : ` · destination #${number(transaction.destinationDieId)}`}`;
        case 'dice_fused': return `DICE ${transaction.operation.toUpperCase()} · source #${number(transaction.sourceId)} → destination #${number(transaction.destinationId)} · ${transaction.effects.map(effect => `${label(effect.type)} Lv${number(effect.level)}`).join(' + ')} · ${transaction.temperCost} Temper · rating ${transaction.forgeRating} · ${label(transaction.destination.area)} ${number(transaction.destination.index + 1)}`;
        case 'dice_offers_rerolled': return `DICE OFFERS REROLLED · ${number(transaction.cost)} Gold · ${transaction.oldOfferIds.join(',')} → ${transaction.newOfferIds.join(',')} · reroll ${number(transaction.rerollCount)}`;
        default: return `SHOP · ${transaction.type} · ${'amount' in transaction ? number(transaction.amount) : ''}`.trim();
      }
    }
    case 'flame_changed': return `FLAME · ${event.change.type}${'flame' in event.change ? ` · ${FLAMES[event.change.flame].name}` : ''}`;
    case 'charge_changed': return `CHARGE · ${event.operation} · ×${number(event.before)}→×${number(event.after)}`;
    case 'engulfment_attempted': return `ENGULFMENT · Shop ${number(event.shopVisitId)} · ${event.success ? 'SUCCESS' : 'OFFERING REJECTED'}`;
    case 'inferno_evaluated': return `INFERNO EVALUATION · ${event.evaluation.success ? 'READY' : 'NOT YET'} · effective ×${number(event.evaluation.effectiveValue)} / ×${number(event.evaluation.threshold)} · meter ${number((event.evaluation.previousReadiness ?? 0) * 100)}% → ${number(event.evaluation.readiness * 100)}% · ${event.evaluation.flames.length} Flame${event.evaluation.flames.length === 1 ? '' : 's'}`;
    case 'inferno_suspension_changed': return `INFERNO · ${event.suspended ? 'SUSPENDED' : 'REACTIVATED'} · ${event.reason}`;
    case 'boss_state_changed': return `BOSS · ${event.boss} · ${event.change}`;
    case 'scorecard_refreshed': return 'SCORECARD · refreshed';
    case 'round_attempt_finished': return `${event.outcome === 'cleared' ? 'CLEAR' : 'BUST'} · ${number(event.score)} / ${number(event.target)}`;
    case 'checkpoint_restored': return `RESTORE · ${event.reason} · timeline ${event.fromTimelineId}→${event.toTimelineId}`;
    case 'run_finished': return `RUN ${event.outcome.toUpperCase()} · Round ${number(event.finalRound)} · ${number(event.score)} / ${number(event.target)}`;
    case 'error': return `ERROR · ${event.detail}`;
    case 'map_transition': return `MAP · ${event.fromNode ?? 'start'} → ${event.toNode}`;
  }
}

export function renderRunHistoryV2(events: readonly RunHistoryV2Event[]): string {
  return events.map(renderRunHistoryV2Event).join('\n');
}

export function renderGroupedRunHistoryV2(events: readonly RunHistoryV2Event[], coverage?: RunHistoryV2Coverage): string {
  const classification = classifyRunHistoryV2Timelines(events, coverage);
  const lines: string[] = [];
  let group = '';
  for (const event of events) {
    const nextGroup = `${event.round}:${event.attempt}`;
    if (nextGroup !== group) {
      group = nextGroup;
      lines.push('', `CHAPTER ${chapterNumberForRound(event.round)} · ROUND ${event.round} (LOCAL ${chapterRoundForRound(event.round)}) · ATTEMPT ${event.attempt}`);
    }
    const rendered = renderRunHistoryV2Event(event);
    const status = classification.status(event);
    lines.push(status === 'canonical' ? rendered
      : status === 'abandoned' ? `[ROLLED BACK · TIMELINE ${event.timelineId}] ${rendered}`
      : `[PARTIAL / UNKNOWN · TIMELINE ${event.timelineId}] ${rendered}`);
  }
  return lines.join('\n').trim();
}
