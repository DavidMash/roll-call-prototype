import { ENHANCEMENTS } from './enhancements';
import { FLAMES } from './flames';
import { HANDS } from './hands';
import { formatPlayerNumber } from './copy';
import type { FlameOrigin, HandScoredEvent, RunHistoryV2Coverage, RunHistoryV2Event, XMultContribution } from './runHistoryV2';
import { chapterNumberForRound, chapterRoundForRound } from './chapters';
import { classifyRunHistoryV2Timelines } from './runHistoryV2Timeline';

const number = (value: number) => formatPlayerNumber(value);
const die = (id: number) => `D${id + 1}`;
const label = (value: string) => value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\b\w/g, character => character.toUpperCase());

const originLabel: Record<FlameOrigin, string> = {
  ember: 'Ember', bonfire: 'Bonfire', wildfire: 'Wildfire', charge: 'Charge', boss: 'Boss',
  special_offer: 'Special Offer', external: 'External',
};

function xMultLabel(contribution: XMultContribution): string {
  if (contribution.sourceId === 'charge') return `Charge ×${number(contribution.factor)}`;
  const source = contribution.sourceId in FLAMES
    ? FLAMES[contribution.sourceId as keyof typeof FLAMES].name
    : String(contribution.sourceId);
  const location = contribution.dieId === undefined ? originLabel[contribution.origin]
    : `${originLabel[contribution.origin]} ${die(contribution.dieId)}`;
  return `${location} ${source} ×${number(contribution.factor)}`;
}

function sideEffectLabel(effect: HandScoredEvent['sideEffects'][number]): string {
  switch (effect.type) {
    case 'workout': return `${die(effect.dieId)} Workout ${number(effect.before)}→${number(effect.after)}`;
    case 'personal_trainer': return `${die(effect.dieId)} Personal Trainer ${HANDS[effect.hand].name} Lv${number(effect.beforeLevel)}→${number(effect.afterLevel)}`;
    case 'gold': return `${effect.dieId === undefined ? '' : `${die(effect.dieId)} `}${label(effect.source)} +${number(effect.amount)} Gold`;
    case 'vintage_growth': return `${die(effect.dieId)} Vintage ${number(effect.before)}→${number(effect.after)}`;
    case 'double_time': return `${die(effect.dieId)} Double Time ${effect.succeeded ? 'succeeded' : 'failed'}`;
    case 'charge': return `Charge ${label(effect.operation)} ×${number(effect.before)}→×${number(effect.after)}`;
    case 'flame_activation': return `${originLabel[effect.origin]} ${FLAMES[effect.flame].name}${effect.factor === undefined ? '' : ` ×${number(effect.factor)}`}`;
    case 'enhancement': return `${ENHANCEMENTS[effect.enhancement].name}${effect.amount === undefined ? '' : ` ${number(effect.amount)}`}`;
    case 'boss_state': return `${label(effect.boss)} ${label(effect.change)}`;
  }
}

export function renderHandScoredV2(event: HandScoredEvent): string {
  const play = event.playSource === 'jumpingBean' ? 'FREE PLAY' : 'PLAY';
  const title = `${play} · ${HANDS[event.hand].name} Lv${number(event.level)}`;
  const meaningfulPips = event.pipsContributions.some(item => item.source !== 'hand_base' && item.source !== 'die_base');
  const meaningfulMult = event.multContributions.some(item => item.source !== 'hand_base');
  const expanded = meaningfulPips || meaningfulMult || event.xMultContributions.length > 0
    || event.checks.length > 0 || event.sideEffects.length > 0;
  if (!expanded) return `${title} · ${number(event.score.finalPips)} Pips × ${number(event.score.finalMult)} Mult × ${number(event.score.finalXMult * event.score.bossFactor)} XMult = ${number(event.score.awarded)}`;

  const dice = event.scoringDice.map(item => `${die(item.dieId)}=${number(item.pips)}`).join(', ');
  const pipsEffects = event.pipsContributions.filter(item => item.source !== 'hand_base' && item.source !== 'die_base')
    .map(item => `${item.dieId === undefined ? '' : `${die(item.dieId)} `}${label(item.source)} +${number(item.amount)}`);
  const multEffects = event.multContributions.filter(item => item.source !== 'hand_base')
    .map(item => `${label(item.source)}${item.dieId === undefined ? '' : ` ${die(item.dieId)}`} ×${number(item.factor)}`);
  const xMultEffects = event.xMultContributions.map(xMultLabel);
  const other = event.sideEffects.map(sideEffectLabel);
  if (event.checks.length) other.push(...event.checks.map(check => `${ENHANCEMENTS[check.source].name} ${number(check.chance * 100)}% ${check.succeeded ? '✓' : '✗'}`));
  return [
    title,
    `Dice: ${dice}`,
    `Pips: ${number(event.score.basePips)} → ${number(event.score.finalPips)}${pipsEffects.length ? ` [${pipsEffects.join(', ')}]` : ''}`,
    `Mult: ${number(event.score.baseMult)} → ${number(event.score.finalMult)}${multEffects.length ? ` [${multEffects.join(', ')}]` : ''}`,
    `XMult: 1 → ${number(event.score.finalXMult * event.score.bossFactor)}${xMultEffects.length ? ` [${xMultEffects.join(', ')}]` : ''}`,
    `Score: ${number(event.score.awarded)}`,
    ...(other.length ? [`Other: ${other.join(' · ')}`] : []),
  ].join('\n');
}

export function renderRunHistoryV2Event(event: RunHistoryV2Event): string {
  switch (event.kind) {
    case 'run_started': return `RUN · ${event.seed} · schema ${event.schemaVersion} · ${event.ruleset}`;
    case 'chapter_started': return `CHAPTER ${number(event.chapter)} · ${event.miniBoss} / ${event.boss}`;
    case 'round_attempt_started': return `ROUND ${number(event.round)} · Attempt ${number(event.attempt)} · Goal ${number(event.target.final)}${event.boss ? ` · ${event.boss}` : ''}`;
    case 'hand_scored': return renderHandScoredV2(event);
    case 'roll_batch': return `ROLL · ${event.reason} · ${event.results.map(result => `${die(result.dieId)} ${number(result.beforeFace)}→${number(result.afterFace)}`).join(' · ')}`;
    case 'shop_offers_presented': return `OFFERS · ${event.pool} · ${event.offers.map(offer => `${offer.contentId} [${offer.rarity}]`).join(', ')}`;
    case 'shop_transaction': return `SHOP · ${event.transaction.type} · ${'amount' in event.transaction ? number(event.transaction.amount) : ''}`.trim();
    case 'flame_changed': return `FLAME · ${event.change.type}${'flame' in event.change ? ` · ${FLAMES[event.change.flame].name}` : ''}`;
    case 'charge_changed': return `CHARGE · ${event.operation} · ×${number(event.before)}→×${number(event.after)}`;
    case 'hooded_challenge_changed': return `HOODED FIGURE · ${event.change}${event.challengeId ? ` · ${event.challengeId}` : ''}`;
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
