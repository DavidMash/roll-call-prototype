import { BOSSES, bossTypeForRound, isBigBossRound, isBossRound, isMiniBossRound, targetForBoss } from './bosses';
import { targetForRound } from './config';
import { formatPlayerNumber } from './copy';
import { chapterEncounterRounds, chapterNumberForRound, chapterRoundForRound, firstRoundOfChapter } from './chapters';
import type { BossType, ChapterPlan, RunNode } from './types';

export const encounterNode = (round: number, boss?: BossType | null): RunNode => boss || isBossRound(round)
  ? { id: `boss:${round}`, type: isMiniBossRound(round) ? 'mini_boss_round' : 'boss_round', round, boss: boss ?? undefined }
  : { id: `round:${round}`, type: 'normal_round', round };
export const shopNodeBefore = (round: number): RunNode => ({ id: `shop:before-round:${round}`, type: 'shop', round });
export const postBossShopNodeAfter = (round: number): RunNode => ({ id: `shop:after-round:${round}`, type: 'shop', round });
export const flameNodeAfter = (round: number): RunNode => ({ id: `flame:after-round:${round}`, type: 'flame_selection', round });
export const specialOfferNodeAfter = (round: number): RunNode => ({ id: `special:after-round:${round}`, type: 'special_offer', round });
export const postBossRewardForRound = (round: number): 'flame' | 'specialOffer' =>
  isMiniBossRound(round) ? 'specialOffer' : 'flame';

export const timeTravelDestinationRound = (completedMiniBossRound: number): number =>
  Math.max(1, completedMiniBossRound - 2);

export function routeThrough(seed: string, throughRound: number): RunNode[] {
  const route: RunNode[] = [];
  for (let round = 1; round <= throughRound; round++) {
    const boss = bossTypeForRound(seed, round);
    route.push(encounterNode(round, boss));
    if (boss) route.push(postBossRewardForRound(round) === 'flame' ? flameNodeAfter(round) : specialOfferNodeAfter(round));
    route.push(isBigBossRound(round) ? postBossShopNodeAfter(round) : shopNodeBefore(round + 1));
  }
  return route;
}

export function chapterRoute(seed: string, chapterNumber: number, plan?: ChapterPlan): RunNode[] {
  const firstRound = firstRoundOfChapter(chapterNumber);
  const { miniBossRound, bossRound } = chapterEncounterRounds(chapterNumber);
  const miniBoss = plan?.miniBoss ?? bossTypeForRound(seed, miniBossRound);
  const boss = plan?.boss ?? bossTypeForRound(seed, bossRound);
  return [
    encounterNode(firstRound),
    shopNodeBefore(firstRound + 1),
    encounterNode(firstRound + 1),
    shopNodeBefore(miniBossRound),
    encounterNode(miniBossRound, miniBoss),
    shopNodeBefore(firstRound + 3),
    encounterNode(firstRound + 3),
    shopNodeBefore(firstRound + 4),
    encounterNode(firstRound + 4),
    shopNodeBefore(bossRound),
    encounterNode(bossRound, boss),
    postBossShopNodeAfter(bossRound),
  ];
}

/** Retained name for callers; the map now receives the whole current Chapter. */
export function routeWindow(seed: string, destinationId: string, _radius = 2, plan?: ChapterPlan): RunNode[] {
  const roundMatch = Number(destinationId.match(/\d+/)?.[0] ?? 1);
  return chapterRoute(seed, chapterNumberForRound(roundMatch), plan);
}

export function nodeLabel(node: RunNode): string {
  if (node.type === 'normal_round') return `R${formatPlayerNumber(chapterRoundForRound(node.round))}`;
  if (node.type === 'mini_boss_round') return 'MINI-BOSS';
  if (node.type === 'boss_round') return 'BOSS';
  if (node.type === 'flame_selection') return 'FLAME';
  if (node.type === 'special_offer') return 'SPECIAL OFFER';
  return 'SHOP';
}

export function encounterTarget(node: RunNode): number | null {
  if (node.type !== 'normal_round' && node.type !== 'mini_boss_round' && node.type !== 'boss_round') return null;
  const normalTarget = targetForRound(node.round);
  return node.boss ? targetForBoss(node.boss, normalTarget) : normalTarget;
}

export const nodeDescription = (node: RunNode) => node.boss ? BOSSES[node.boss].name : nodeLabel(node);
