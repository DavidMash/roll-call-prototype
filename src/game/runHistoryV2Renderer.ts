import { FLAMES } from './flames';
import { HANDS } from './hands';
import { formatExactScore, formatPlayerNumber } from './copy';
import type { FlameOrigin, HandScoredEvent, RunHistoryV2Coverage, RunHistoryV2Event, XMultContribution } from './runHistoryV2';
import { chapterNumberForRound, chapterRoundForRound } from './chapters';
import { classifyRunHistoryV2Timelines } from './runHistoryV2Timeline';
import { SPECIAL_DICE } from './specialDice';
import { formatEffectLevel } from './effectLevel';

const number = (value: number | bigint) => typeof value === 'bigint' ? formatExactScore(value) : formatPlayerNumber(value);
// A collectible ID is stable identity, not a Roster position.
const die = (id: number) => `Die #${id}`;
const scoredDie = (item: HandScoredEvent['scoringDice'][number]) => item.face === item.pips
  ? `${die(item.dieId)}=${number(item.pips)}`
  : `${die(item.dieId)} face ${number(item.face)} · ${number(item.pips)} Pips`;
const resolvedDie = (item: HandScoredEvent['resolvedDicePips'][number]) => item.face.rank === item.totalPips
  ? `${die(item.dieId)}=${number(item.totalPips)}`
  : `${die(item.dieId)} face ${number(item.face.rank)} · ${number(item.totalPips)} Pips`;
const label = (value: string) => value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\b\w/g, character => character.toUpperCase());
const specialDieLabel = (type: keyof typeof SPECIAL_DICE) => SPECIAL_DICE[type].name;

const originLabel: Record<FlameOrigin, string> = {
  ember: 'Ember', bonfire: 'Bonfire', charge: 'Charge', boss: 'Boss',
  special_offer: 'Special Offer', external: 'External',
};

function xMultLabel(contribution: XMultContribution): string {
  if (contribution.sourceId === 'charge') return `Charge ×${number(contribution.factor)}${contribution.chargeSources?.length
    ? ` [${contribution.chargeSources.map(source => `${FLAMES[source.flame].name}${source.instanceId === undefined ? '' : ` #${number(source.instanceId)}`} ×${number(source.factor)}`).join(', ')}]` : ''}`;
  const source = contribution.sourceId in FLAMES
    ? FLAMES[contribution.sourceId as keyof typeof FLAMES].name
    : label(String(contribution.sourceId));
  const location = originLabel[contribution.origin];
  return `${location} ${source} ×${number(contribution.factor)}`;
}

function scoreEquation(event: HandScoredEvent): string {
  const effectiveXMult = event.score.finalXMult * event.score.bossFactor;
  const factors = [`${number(event.score.finalPips)} Pips`, `${number(event.score.finalMult)} Mult`];
  if (effectiveXMult !== 1) factors.push(`${number(effectiveXMult)} XMult`);
  if ((event.score.infernoMultiplier ?? 1n) > 1n) factors.push(`${number(event.score.infernoMultiplier ?? 1n)} Inferno`);
  return `${factors.join(' × ')} = ${number(event.score.awarded)}`;
}

function sideEffectLabel(effect: HandScoredEvent['sideEffects'][number]): string {
  switch (effect.type) {
    case 'gold': return `${effect.dieId === undefined ? '' : `${die(effect.dieId)} `}${label(effect.source)} +${number(effect.amount)}G`;
    case 'double_time': return `${die(effect.dieId)} Double Time ${effect.succeeded ? 'succeeded' : 'failed'}`;
    case 'special_die': return `${die(effect.dieId)} ${specialDieLabel(effect.dieType)} ${effect.detail}`;
    case 'charge': return `Charge ${label(effect.operation)} ×${number(effect.before)}→×${number(effect.after)}`;
    case 'flame_activation': return `${originLabel[effect.origin]} ${FLAMES[effect.flame].name}${effect.factor === undefined ? '' : ` ×${number(effect.factor)}`}`;
    case 'free_play': return effect.pipsMultiplier === undefined
      ? `${die(effect.dieId)} Free Play event ${effect.rerollEventId}`
      : `${die(effect.dieId)} Curtain Call Free Play before Manual Reroll · ×${number(effect.pipsMultiplier)} die Pips`;
    case 'sustainable': return `${die(effect.dieId)} Sustainable preserved ${HANDS[effect.hand].name} (${number(effect.chargesRemaining)} left)`;
    case 'conjoined': return `${die(effect.dieId)} Conjoined duplicated itself for ${HANDS[effect.hand].name} Qualification and Scoring`;
    case 'boss_state': {
      if (effect.boss === 'caller' && effect.change === 'CALLER_CALLED' && effect.hand) return `Caller called ${HANDS[effect.hand].name}`;
      if (effect.boss === 'fly' && effect.state === 'target' && effect.hand) return `Fly moved to ${HANDS[effect.hand].name}`;
      if (effect.boss === 'fly' && effect.state === 'caught' && effect.hand) return `Fly caught on ${HANDS[effect.hand].name}`;
      if (effect.boss === 'pendulum' && effect.state?.startsWith('requested_')) return `Pendulum requested section: ${effect.state.slice(10).toUpperCase()}`;
      if (effect.boss === 'pendulum' && effect.state?.startsWith('remained_')) return `Pendulum ×0.5 · remained on ${effect.state.slice(9).toUpperCase()}`;
      return `${label(effect.boss)} ${label(effect.change)}`;
    }
  }
}

export function renderHandScoredV2(event: HandScoredEvent): string {
  const play = event.playSource === 'manual' ? 'PLAY' : 'FREE PLAY';
  const title = `${play} · ${HANDS[event.hand].name} Lv${number(event.level)}`;
  const meaningfulPips = event.pipsContributions.some(item => item.source !== 'die_base');
  const meaningfulMult = event.multContributions.some(item => item.source !== 'hand');
  const expanded = meaningfulPips || meaningfulMult || event.xMultContributions.length > 0 || event.sideEffects.length > 0;
  const resolvedDice = event.resolvedDicePips.map(resolvedDie);
  const unusualDice = event.resolvedDicePips.filter(item => item.face.rank !== item.totalPips).map(resolvedDie);
  if (!expanded) return `${title} · ${scoreEquation(event)}${unusualDice.length ? ` · Dice: ${unusualDice.join(', ')}` : ''}`;

  const dice = resolvedDice.length ? resolvedDice.join(', ') : event.scoringDice.map(scoredDie).join(', ');
  const pipsEffects = event.pipsContributions.filter(item => item.source !== 'die_base')
    .map(item => `${item.dieId === undefined ? '' : `${die(item.dieId)} `}${label(item.source)} +${number(item.amount)}`);
  const multEffects = event.multContributions.filter(item => item.source !== 'hand')
    .map(item => `${label(item.source)} ×${number(item.factor)}`);
  const xMultEffects = event.xMultContributions.map(xMultLabel);
  const other = event.sideEffects.map(sideEffectLabel);
  return [
    title,
    `Dice: ${dice}`,
    `Pips: ${number(event.score.finalPips)} from dice${pipsEffects.length ? ` [${pipsEffects.join(', ')}]` : ''}`,
    `Hand Mult: ${number(event.score.handMult)}${event.score.finalMult !== event.score.handMult ? ` → ${number(event.score.finalMult)}` : ''}${multEffects.length ? ` [${multEffects.join(', ')}]` : ''}`,
    `XMult: 1 → ${number(event.score.finalXMult * event.score.bossFactor)}${xMultEffects.length ? ` [${xMultEffects.join(', ')}]` : ''}`,
    `Score: ${scoreEquation(event)}`,
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
    case 'special_die_activated': return `SPECIAL DIE · ${specialDieLabel(event.dieType)} Lv${number(event.level)} · ${die(event.dieId)} · ${event.detail}`;
    case 'roll_batch': return `ROLL · ${event.reason} · ${event.results.map(result => `${die(result.dieId)} ${number(result.beforeFace)}→${number(result.afterFace)}`).join(' · ')}`;
    case 'shop_visit_started': return `SHOP VISIT ${number(event.shopVisitId)} · ${event.reason} · ${label(event.initialStage)}`;
    case 'shop_stage_changed': return `SHOP ${number(event.shopVisitId)} · ${label(event.from)} → ${label(event.to)}`;
    case 'temper_changed': return `TEMPER · ${event.operation.toUpperCase()} · ${event.source === 'fusion' ? 'Forge' : label(event.source)} ${event.operation === 'earned' ? '+' : '−'}${number(event.amount)}T · balance ${number(event.balance)}T`;
    case 'training_session_started': return `TRAINING SESSION · Shop ${number(event.shopVisitId)} · Upper baseline ${number(event.upperBaseline)} · Lower baseline ${number(event.lowerBaseline)}`;
    case 'team_training_applied': return `TEAM TRAINING · Offer ${number(event.offerId)} · all hands +1`;
    case 'shop_visit_completed': return `SHOP ${number(event.shopVisitId)} COMPLETE · ${label(event.progression)}`;
    case 'shop_offers_presented': return `OFFERS · ${event.pool}${event.shopVisitId === undefined ? '' : ` · Shop ${number(event.shopVisitId)}`}`
      + ` · ${event.offers.map(offer => `${offer.contentId} [${offer.rarity}]`).join(', ')}`;
    case 'shop_transaction': {
      const transaction = event.transaction;
      switch (transaction.type) {
        case 'dice_purchased': return `DICE PURCHASE · offer ${number(transaction.offerId)} · Die #${number(transaction.dieId)} ${specialDieLabel(transaction.dieType)} Lv${number(transaction.level)} · ${number(transaction.pricePaid)}G · ${label(transaction.destination.area)} ${number(transaction.destination.index + 1)}`;
        case 'dice_sold': return `DICE SALE · Die #${number(transaction.dieId)} ${transaction.effects.map(effect => `${specialDieLabel(effect.type)} Lv${number(effect.level)}`).join(' + ') || 'Normal'} · ${number(transaction.proceeds)}G (${number(transaction.componentSalvage)} components + ${number(transaction.complexityPremium)} complexity + ${number(transaction.vintageAppreciation)} Vintage) · ${label(transaction.source.area)} ${number(transaction.source.index + 1)}`;
        case 'dice_moved': return `DICE MOVE · ${label(transaction.source.area)} ${number(transaction.source.index + 1)} → ${label(transaction.destination.area)} ${number(transaction.destination.index + 1)} · source #${number(transaction.sourceDieId)}${transaction.destinationDieId === null ? '' : ` · destination #${number(transaction.destinationDieId)}`}`;
        case 'dice_fused': return `DICE FORGE · ingredients #${number(transaction.ingredientIds[0])} + #${number(transaction.ingredientIds[1])} → result #${number(transaction.resultId)} · ${transaction.effects.map(effect => `${specialDieLabel(effect.type)}${effect.level > 1 ? ` ${formatEffectLevel(effect.level)}` : ''}`).join(' + ')} · ${transaction.temperCost}T · rating ${transaction.forgeRating} · ${label(transaction.destination.area)} ${number(transaction.destination.index + 1)}`;
        case 'dice_offers_rerolled': return `DICE OFFERS REROLLED · ${number(transaction.cost)}G · ${transaction.oldOfferIds.join(',')} → ${transaction.newOfferIds.join(',')} · reroll ${number(transaction.rerollCount)}`;
        default: return `SHOP · ${transaction.type} · ${'amount' in transaction ? number(transaction.amount) : ''}`.trim();
      }
    }
    case 'flame_changed': return `FLAME · ${event.change.type}${'flame' in event.change ? ` · ${FLAMES[event.change.flame].name}` : ''}`;
    case 'flame_runtime_changed': return event.change === 'sequence_stage'
      ? `FLAME · ${FLAMES[event.flame].name} · ${String(event.from).toUpperCase()} → ${String(event.to).toUpperCase()} · ${label(event.reason)}`
      : `FLAME · ${FLAMES[event.flame].name} · streak reset${event.hand ? ` by ${HANDS[event.hand].name}` : ''}`;
    case 'flame_sequence': {
      if (event.resetReason) return `FLAME · ${FLAMES[event.flame].name} · sequence reset after scorecard refresh`;
      if (!event.advanced || !event.playedHand) return '';
      return `FLAME · ${FLAMES[event.flame].name} · ${HANDS[event.playedHand].name}${event.factorApplied ? ` ×${number(event.factorApplied)}` : ''}${event.completed ? ' · COMPLETE' : event.newRequiredHand ? ` · next ${HANDS[event.newRequiredHand].name}` : ''}`;
    }
    case 'flame_action': {
      const action = event.action;
      if (action.type === 'burn_it_down') return `FLAME ACTION · Burn It Down · sacrificed ${number(action.scoreSacrificed)} / ${number(action.target)} · Charge +${number(action.chargeGained)}`;
      if (action.type === 'grease_the_engine') return `FLAME ACTION · Grease the Engine · ${number(action.cost)}G · Charge +${number(action.chargeGained)}`;
      if (action.type === 'lightning_strike') return `FLAME ACTION · Lightning Strike · ${die(action.dieId)} predicted ${number(action.predictedFace)}, rolled ${number(action.actualFace)} · ${action.hit ? `HIT · Charge +${number(action.chargeGained)}` : 'MISS'}`;
      if (action.type === 'hot_potato_play') return `FLAME · Hot Potato Clock · ${die(action.targetBefore)} ${action.played ? 'Played; streak reset' : `avoided; streak ${number(action.streak)}`} · Charge +${number(action.chargeGained)}${action.targetAfter === null ? '' : ` · moved to ${die(action.targetAfter)}`}`;
      if (action.type === 'dare_activated') return `FLAME ACTION · Dare Devil · Dare ${number(action.dareCount)} · next Ultimate ×${number(action.storedFactor)} · Rolled ${action.dieIds.map(die).join(', ')}`;
      return `FLAME · Dare Devil payoff · ${HANDS[action.hand].name} ×${number(action.factor)} · ${number(action.dareCount)} Dare${action.dareCount === 1 ? '' : 's'} consumed`;
    }
    case 'score_package_completed': return `SCORE PACKAGE · ${HANDS[event.hand].name} · ${number(event.score)} Score`;
    case 'score_package_removed': return `${event.reason === 'double_or_nothing' ? 'DOUBLE OR NOTHING' : 'ALL IN FAILED'} · −${number(event.amount)} Score`;
    case 'double_or_nothing': {
      if (event.phase === 'offered') return `DOUBLE OR NOTHING · ${HANDS[event.hand].name} · ${number(event.packageScore)} Score offered at ×${number(event.factor)}`;
      if (event.phase === 'accepted') return `DOUBLE OR NOTHING · ${HANDS[event.hand].name} · −${number(event.scoreRemoved ?? event.packageScore)} Score · wager active`;
      if (event.phase === 'redeemed') return `DOUBLE OR NOTHING · ${HANDS[event.hand].name} replayed · ×${number(event.factor)}`;
      return `DOUBLE OR NOTHING · ${HANDS[event.hand].name} · ${event.phase.toUpperCase()}`;
    }
    case 'all_in': return event.phase === 'armed'
      ? `ALL IN · armed at ×${number(event.factor)}`
      : event.success
        ? `ALL IN · ${event.hand ? HANDS[event.hand].name : 'manual Play'} · ×${number(event.factor)} · Round cleared`
        : `ALL IN FAILED · ${event.hand ? HANDS[event.hand].name : 'manual Play'} · −${number(event.scoreRemoved ?? 0n)} Score`;
    case 'charge_changed': return `CHARGE · ${event.operation} · ×${number(event.before)}→×${number(event.after)}`;
    case 'flame_charge_generated': return '';
    case 'engulfment_attempted': return `ENGULFMENT · Shop ${number(event.shopVisitId)} · ${event.success ? 'SUCCESS' : 'OFFERING REJECTED'}`;
    case 'inferno_evaluated': return `INFERNO EVALUATION · ${event.evaluation.success ? 'READY' : 'NOT YET'} · effective ×${number(event.evaluation.effectiveValue)} / ×${number(event.evaluation.threshold)} · meter ${number((event.evaluation.previousReadiness ?? 0) * 100)}% → ${number(event.evaluation.readiness * 100)}% · ${event.evaluation.flames.length} Flame${event.evaluation.flames.length === 1 ? '' : 's'}`;
    case 'inferno_suspension_changed': return `INFERNO · ${event.suspended ? 'SUSPENDED' : 'REACTIVATED'} · ${event.reason}`;
    case 'boss_state_changed': {
      if (event.boss === 'caller' && event.change === 'called' && event.hand) return `BOSS · Caller called ${HANDS[event.hand].name}`;
      if (event.boss === 'fly' && event.change === 'target' && event.hand) return `BOSS · Fly moved to ${HANDS[event.hand].name}`;
      if (event.boss === 'fly' && event.change === 'caught' && event.hand) return `BOSS · Fly caught on ${HANDS[event.hand].name}`;
      if (event.boss === 'pendulum' && event.change === 'requested' && event.state?.startsWith('requested_'))
        return `BOSS · Pendulum requested section: ${event.state.slice(10).toUpperCase()}`;
      if (event.boss === 'pendulum' && event.change === 'remained' && event.state?.startsWith('remained_'))
        return `BOSS · Pendulum ×0.5 · remained on ${event.state.slice(9).toUpperCase()}`;
      return `BOSS · ${label(event.boss)} · ${label(event.change)}`;
    }
    case 'ultimate_targets_changed': return `ULTIMATE TARGETS · ${event.targets.map(hand => HANDS[hand].name).join(', ')}`;
    case 'bench_warmer_target_changed': return `BENCH WARMER · ${HANDS[event.target].name}`;
    case 'scorecard_refreshed': return 'SCORECARD · refreshed';
    case 'round_attempt_finished': return `${event.outcome === 'cleared' ? 'CLEAR' : 'BUST'} · ${number(event.score)} / ${number(event.target)}`;
    case 'checkpoint_restored': return `RESTORE · ${event.reason} · timeline ${event.fromTimelineId}→${event.toTimelineId}`;
    case 'run_finished': return `RUN ${event.outcome.toUpperCase()} · Round ${number(event.finalRound)} · ${number(event.score)} / ${number(event.target)}`;
    case 'error': return `ERROR · ${event.detail}`;
    case 'map_transition': return `MAP · ${event.fromNode ?? 'start'} → ${event.toNode}`;
  }
}

export function renderRunHistoryV2(events: readonly RunHistoryV2Event[]): string {
  return events.map(renderRunHistoryV2Event).filter(Boolean).join('\n');
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
    if (!rendered) continue;
    const status = classification.status(event);
    lines.push(status === 'canonical' ? rendered
      : status === 'abandoned' ? `[ROLLED BACK · TIMELINE ${event.timelineId}] ${rendered}`
      : `[PARTIAL / UNKNOWN · TIMELINE ${event.timelineId}] ${rendered}`);
  }
  return lines.join('\n').trim();
}
