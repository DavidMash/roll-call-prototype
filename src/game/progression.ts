import { BOSSES, bossTypeForRound, isBossRound, isMiniBossRound, targetForBoss } from './bosses';
import { targetForRound } from './config';
import { formatPlayerNumber } from './copy';
import type { BossType, RunNode } from './types';

export const encounterNode = (round: number, boss?: BossType | null): RunNode => boss || isBossRound(round)
  ? { id: `boss:${round}`, type: isMiniBossRound(round) ? 'mini_boss_round' : 'boss_round', round, boss: boss ?? undefined }
  : { id: `round:${round}`, type: 'normal_round', round };
export const shopNodeBefore = (round: number): RunNode => ({ id: `shop:before-round:${round}`, type: 'shop', round });
export const flameNodeAfter = (round: number): RunNode => ({ id: `flame:after-round:${round}`, type: 'flame_selection', round });
export const specialOfferNodeAfter = (round: number): RunNode => ({ id: `special:after-round:${round}`, type: 'special_offer', round });
export const postBossRewardForRound = (round: number): 'flame' | 'specialOffer' =>
  isMiniBossRound(round) ? 'specialOffer' : 'flame';

export function routeThrough(seed: string, throughRound: number): RunNode[] {
  const route: RunNode[] = [];
  for (let round = 1; round <= throughRound; round++) {
    const boss = bossTypeForRound(seed, round);
    route.push(encounterNode(round, boss));
    if (boss) route.push(postBossRewardForRound(round) === 'flame' ? flameNodeAfter(round) : specialOfferNodeAfter(round));
    route.push(shopNodeBefore(round + 1));
  }
  return route;
}

export function routeWindow(seed: string, destinationId: string, radius = 2): RunNode[] {
  const roundMatch = Number(destinationId.match(/\d+/)?.[0] ?? 1);
  const route = routeThrough(seed, Math.max(6, roundMatch + 4));
  const index = Math.max(0, route.findIndex(node => node.id === destinationId));
  return route.slice(Math.max(0, index - radius), index + radius + 1);
}

export function nodeLabel(node: RunNode): string {
  if (node.type === 'normal_round') return `Round ${formatPlayerNumber(node.round)}`;
  if (node.type === 'mini_boss_round') return `MINI-BOSS ${formatPlayerNumber(node.round)}`;
  if (node.type === 'boss_round') return `Boss Round ${formatPlayerNumber(node.round)}`;
  if (node.type === 'flame_selection') return 'FLAME SELECTION';
  if (node.type === 'special_offer') return 'SPECIAL OFFER';
  return 'SHOP';
}

export function encounterTarget(node: RunNode): number | null {
  if (node.type !== 'normal_round' && node.type !== 'mini_boss_round' && node.type !== 'boss_round') return null;
  const normalTarget = targetForRound(node.round);
  return node.boss ? targetForBoss(node.boss, normalTarget) : normalTarget;
}

export const nodeDescription = (node: RunNode) => node.boss ? BOSSES[node.boss].name : nodeLabel(node);
