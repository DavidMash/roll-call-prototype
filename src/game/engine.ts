import { CONFIG, diceRerollCost, handTrainingCost, lifeRestoreCost, offerRerollCost, teamTrainingCost } from './config';
import { activeFace, createDice } from './dice';
import { Resolver } from './effects';
import type { ResolverOptions } from './effects';
import { enhancementCost, enhancementSellValue, ENHANCEMENTS, ENHANCEMENT_IDS, isEnhancement, placementError, stacks, VINTAGE_BASE_SELL_CAP } from './enhancements';
import {
  activeFlameId, activeFlameInvestment, flameEffectText, FLAMES, hasChargeBonfire, hasOwnedChargeFlame,
  HAND_FAMILY_FLAME_IDS, hasOwnedFlame, isChargeFlame, isFlame, ownedFlameIds, recalculateMaxCharge,
  sixPackMultiplierAfterUpperHands, sixPackStartingMultiplier,
} from './flames';
import { HANDS, HAND_IDS, initialHandLevels, initialHandPlayCounts, isValidSelection } from './hands';
import { hashSeed, SeededRng } from './rng';
import { boardSnapshot, createStats } from './telemetry';
import { activeEncounterDice, bossSchedule, isBigBossRound, unavailableEncounterHands } from './bosses';
import { chapterNumberForRound, ensureChapterPlan } from './chapters';
import { postBossShopNodeAfter } from './progression';
import { formatPlayerNumber } from './copy';
import { rarityLabel } from './rarity';
import { enhancementOfferIsFree, initialSpecialOfferEffects, trainingOfferIsFree, trainingOfferKey, usableManualRerolls } from './specialOffers';
import type { Action, Board, GameState, HandId, RandomSource, Resolution, Shop, TrainingOffer } from './types';

const attemptSeed = (seed: string, round: number, attempt: number) => hashSeed(`${seed}:round:${round}:attempt:${attempt}`);

function normalizedTrainingOffer(offer: TrainingOffer | { hand: HandId; purchased?: boolean }): TrainingOffer {
  if ('kind' in offer) {
    const purchases = Number.isFinite(offer.purchases) ? Math.max(0, Math.floor(offer.purchases)) : 0;
    return { ...offer, purchases };
  }
  return { kind: 'hand', hand: offer.hand, purchases: offer.purchased ? 1 : 0 };
}

function normalizeShop(shop: Shop): void {
  shop.trainingOffers = shop.trainingOffers.map(offer => normalizedTrainingOffer(offer));
  shop.lifeRestores = Math.max(0, Math.floor(shop.lifeRestores ?? 0));
}

function normalizeSpecialRuntime(state: GameState | GameState['roundCheckpoint']): void {
  if (!state) return;
  state.specialOfferEffects = { ...initialSpecialOfferEffects(), ...(state.specialOfferEffects ?? {}) };
  state.specialOfferEffects.carePackageRerolls = Math.max(0, Math.floor(state.specialOfferEffects.carePackageRerolls));
  for (const key of ['taxEvasionRounds', 'cashBonusRounds', 'powerballRounds', 'bottledFairyRounds', 'badDreamRounds'] as const)
    state.specialOfferEffects[key] = Math.max(0, Math.floor(state.specialOfferEffects[key]));
  state.specialOfferEffects.semesterShopsRemaining = Math.max(0, Math.floor(state.specialOfferEffects.semesterShopsRemaining));
  state.suppressedPostBossRewardRounds ??= [];
  state.bossSilenced ??= false;
  state.specialOffer ??= null;
}

function normalizeSixPackRuntime(state: Pick<Board, 'dice' | 'bonfires' | 'sixPackXMult' | 'sixPackUpperHandsPlayed'>): void {
  const startingFactor = state.bonfires.includes('sixPack') ? sixPackStartingMultiplier(100)
    : sixPackStartingMultiplier(activeFlameInvestment(state.dice.find(die => activeFlameId(die.flame) === 'sixPack')?.flame ?? null));
  const missingCount = state.sixPackUpperHandsPlayed === undefined;
  const inferred = startingFactor <= 1 ? 0 : Math.round(6 * (startingFactor - Math.max(1, state.sixPackXMult ?? 1)) / (startingFactor - 1));
  state.sixPackUpperHandsPlayed = Math.max(0, Math.min(6, Math.floor(missingCount ? inferred : state.sixPackUpperHandsPlayed)));
  state.sixPackXMult = missingCount ? sixPackMultiplierAfterUpperHands(startingFactor, state.sixPackUpperHandsPlayed)
    : Math.max(1, state.sixPackXMult ?? 1);
}

function normalizeHandFamilyFlameRuntime(state: Pick<Board, 'dice' | 'bonfires' | 'handFamilyFlameStages'>): void {
  const stages = state.handFamilyFlameStages ?? {};
  const owned = ownedFlameIds(state as Pick<GameState, 'dice' | 'bonfires'>);
  state.handFamilyFlameStages = Object.fromEntries(HAND_FAMILY_FLAME_IDS.filter(id => owned.has(id)).map(id => {
    const stage = stages[id];
    return [id, stage === 'payoff' || stage === 'spent' ? stage : 'setup'];
  }));
}

export function normalizeGameState(state: GameState): GameState {
  const next = structuredClone(state);
  next.scorecardCycleConsumed ??= next.consumed.filter(hand =>
    next.bossSilenced || next.boss?.type !== 'neglected' || !next.boss.neglectedHands.includes(hand));
  normalizeSpecialRuntime(next);
  const legacy = next as GameState & { flameReward?: GameState['flameSelection'] };
  if (!next.flameSelection && legacy.flameReward) next.flameSelection = legacy.flameReward;
  delete legacy.flameReward;
  if ((next.phase as string) === 'flameReward') next.phase = 'flameSelection';
  for (const die of next.dice) {
    die.owner ??= 'player';
    for (const face of die.faces) {
      const legacyMagnetic = face as typeof face & { magneticUsed?: boolean; magneticDestinationUsed?: boolean };
      delete legacyMagnetic.magneticUsed;
      delete legacyMagnetic.magneticDestinationUsed;
      delete (face.enhancements as Record<string, number | undefined>).multiplier;
      for (const id of ENHANCEMENT_IDS) {
        const value = face.enhancements[id];
        if (value === undefined) continue;
        const normalized = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
        const cap = ENHANCEMENTS[id].maxStacks;
        const clamped = cap === null ? normalized : Math.min(normalized, cap);
        if (clamped > 0) face.enhancements[id] = clamped;
        else delete face.enhancements[id];
      }
      if ((face.enhancements.vintage ?? 0) > 0) {
        face.vintageSellValue = Math.min(VINTAGE_BASE_SELL_CAP, Math.max(0, Math.floor(face.vintageSellValue ?? 0)));
        if (face.vintageSommelierBoosted) face.vintageSommelierBoosted = true;
        else delete face.vintageSommelierBoosted;
      } else {
        delete face.vintageSellValue;
        delete face.vintageSommelierBoosted;
      }
    }
    const rawFlame = die.flame as unknown;
    const rawId = typeof rawFlame === 'string' ? rawFlame
      : rawFlame && typeof rawFlame === 'object' && 'id' in rawFlame ? (rawFlame as { id: unknown }).id : null;
    if (rawId === 'charge') die.flame = typeof rawFlame === 'object'
      ? { id: 'momentum', investedGold: activeFlameInvestment(rawFlame) } : { id: 'momentum', investedGold: 0 };
    const id = activeFlameId(die.flame);
    die.flame = id ? { id, investedGold: activeFlameInvestment(die.flame) } : null;
  }
  next.bonfires = [...new Set(next.bonfires.map(id => (id as string) === 'charge' ? 'momentum' : id).filter(isFlame))];
  if (next.shop) {
    next.shop.offers = next.shop.offers.filter(offer => isEnhancement(offer.enhancement));
    normalizeShop(next.shop);
    if (!next.shop.kind && next.phase === 'shop' && !next.bust && isBigBossRound(next.round)) next.shop.kind = 'post_boss';
  }
  if (next.roundCheckpoint) {
    next.roundCheckpoint.scorecardCycleConsumed ??= next.roundCheckpoint.consumed.filter(hand =>
      next.roundCheckpoint!.bossSilenced || next.roundCheckpoint!.boss?.type !== 'neglected'
      || !next.roundCheckpoint!.boss.neglectedHands.includes(hand));
    next.roundCheckpoint.chapterPlans ??= structuredClone(next.chapterPlans ?? {});
    next.roundCheckpoint.presentedChapters ??= Array.from(
      { length: chapterNumberForRound(next.roundCheckpoint.round) }, (_, index) => index + 1,
    );
    ensureChapterPlan(next.roundCheckpoint, chapterNumberForRound(next.roundCheckpoint.round));
    normalizeSpecialRuntime(next.roundCheckpoint);
    if (next.roundCheckpoint.shop) normalizeShop(next.roundCheckpoint.shop);
    for (const die of next.roundCheckpoint.dice) {
      for (const face of die.faces) {
        const legacyMagnetic = face as typeof face & { magneticUsed?: boolean; magneticDestinationUsed?: boolean };
        delete legacyMagnetic.magneticUsed;
        delete legacyMagnetic.magneticDestinationUsed;
        if ((face.enhancements.vintage ?? 0) > 0) {
          face.vintageSellValue = Math.min(VINTAGE_BASE_SELL_CAP, Math.max(0, Math.floor(face.vintageSellValue ?? 0)));
          if (face.vintageSommelierBoosted) face.vintageSommelierBoosted = true;
          else delete face.vintageSommelierBoosted;
        } else {
          delete face.vintageSellValue;
          delete face.vintageSommelierBoosted;
        }
      }
      const rawFlame = die.flame as unknown;
      const rawId = typeof rawFlame === 'string' ? rawFlame
        : rawFlame && typeof rawFlame === 'object' && 'id' in rawFlame ? (rawFlame as { id: unknown }).id : null;
      if (rawId === 'charge') die.flame = typeof rawFlame === 'object'
        ? { id: 'momentum', investedGold: activeFlameInvestment(rawFlame) } : { id: 'momentum', investedGold: 0 };
      const id = activeFlameId(die.flame);
      die.flame = id ? { id, investedGold: activeFlameInvestment(die.flame) } : null;
    }
    next.roundCheckpoint.bonfires = [...new Set(next.roundCheckpoint.bonfires
      .map(id => (id as string) === 'charge' ? 'momentum' : id).filter(isFlame))];
    recalculateMaxCharge(next.roundCheckpoint);
    next.roundCheckpoint.decisionId = Math.max(0, Math.floor(next.roundCheckpoint.decisionId ?? 0));
    normalizeSixPackRuntime(next.roundCheckpoint);
    normalizeHandFamilyFlameRuntime(next.roundCheckpoint);
  }
  if (next.flameSelection) next.flameSelection.offers = next.flameSelection.offers
    .map(offer => ({ ...offer, flame: (offer.flame as string) === 'charge' ? 'momentum' as const : offer.flame }))
    .filter(offer => isFlame(offer.flame));
  next.roundSummary ??= null;
  next.fetchTarget ??= null;
  next.stats.jumpingBeanFreePlays ??= [];
  next.bossSchedule ??= bossSchedule(next.seed);
  next.chapterPlans ??= {};
  next.presentedChapters ??= Array.from({ length: chapterNumberForRound(next.round) }, (_, index) => index + 1);
  ensureChapterPlan(next, chapterNumberForRound(next.round));
  if (next.badDreamCheckpoint) {
    next.badDreamCheckpoint.scorecardCycleConsumed ??= next.badDreamCheckpoint.consumed.filter(hand =>
      next.badDreamCheckpoint!.bossSilenced || next.badDreamCheckpoint!.boss?.type !== 'neglected'
      || !next.badDreamCheckpoint!.boss.neglectedHands.includes(hand));
    next.badDreamCheckpoint.chapterPlans ??= structuredClone(next.chapterPlans);
    next.badDreamCheckpoint.presentedChapters ??= Array.from(
      { length: chapterNumberForRound(next.badDreamCheckpoint.round) }, (_, index) => index + 1,
    );
    ensureChapterPlan(next.badDreamCheckpoint, chapterNumberForRound(next.badDreamCheckpoint.round));
  }
  next.boss ??= null;
  if (next.boss?.type === 'warden') next.boss.unlockCosts ??= [];
  if (next.boss?.type === 'caller') {
    next.boss.manualHandsPlayed ??= Math.max(0, 3 - next.boss.playsRemaining);
    next.boss.callDeadline ??= next.boss.manualHandsPlayed + next.boss.playsRemaining;
  }
  if (next.roundCheckpoint?.boss?.type === 'warden') next.roundCheckpoint.boss.unlockCosts ??= [];
  next.currentNodeId ??= '';
  next.lives = Math.max(0, Math.min(CONFIG.maxLives, Math.floor(next.lives ?? CONFIG.maxLives)));
  next.roundAttemptNumber = Math.max(1, Math.floor(next.roundAttemptNumber ?? 1));
  next.bust ??= null;
  next.flameTutorial ??= { pendingDieId: null, completed: false };
  next.roundCheckpoint ??= null;
  next.badDreamCheckpoint ??= null;
  next.stats.sales ??= [];
  next.stats.mapTransitions ??= [];
  next.stats.mapTransitions = next.stats.mapTransitions.map(record => ({ ...record,
    nodeType: (record.nodeType as string) === 'flame_reward' ? 'flame_selection' : record.nodeType }));
  // Version-1 saves could already have announced the next Chapter while the
  // post-Boss Shop was active. Move that persisted boundary back without
  // touching the materialized Chapter plan or the Shop's RNG-backed contents.
  if (next.phase === 'shop' && !next.bust && isBigBossRound(next.round) && next.shop?.kind === 'post_boss') {
    const nextChapter = chapterNumberForRound(next.round) + 1;
    const legacyShopId = `shop:before-round:${next.round + 1}`;
    if (next.currentNodeId === legacyShopId) next.currentNodeId = postBossShopNodeAfter(next.round).id;
    next.presentedChapters = next.presentedChapters.filter(chapter => chapter !== nextChapter);
    const filteredHistory = next.history.filter(record => !(record.type === 'CHAPTER_STARTED'
      && record.chapterNumber === nextChapter && record.round === next.round));
    if (filteredHistory.length !== next.history.length)
      next.history = filteredHistory.map((record, id) => ({ ...record, id }));
    for (const transition of next.stats.mapTransitions) {
      if (transition.toNode === legacyShopId && transition.round === next.round + 1)
        Object.assign(transition, { toNode: postBossShopNodeAfter(next.round).id, round: next.round });
    }
    for (const record of next.history) {
      if (record.type === 'MAP_TRANSITION' && record.toNode === legacyShopId)
        Object.assign(record, { toNode: postBossShopNodeAfter(next.round).id, round: next.round });
    }
  }
  next.stats.bossEncounters ??= [];
  next.stats.callerEvents ??= [];
  next.stats.wardenEvents ??= [];
  next.stats.hexerEvents ??= [];
  next.stats.scoreBySource.boss ??= 0;
  next.stats.busts ??= [];
  next.stats.busts = next.stats.busts.map(bust => ({ ...bust,
    checkpointRestored: bust.checkpointRestored ?? true,
    returnedToShop: bust.returnedToShop ?? bust.livesAfter > 0 }));
  next.stats.lifeRestores ??= [];
  next.stats.vintageGrowth ??= [];
  next.stats.probabilityProcs.personalTrainer ??= { checks: 0, successes: 0, failures: 0, stacksAtCheck: [] };
  next.stats.rounds = next.stats.rounds.map(round => {
    const legacyPayout = round.payout as (typeof round.payout & { flameBonusGold?: number }) | null;
    const payout = legacyPayout ? { ...legacyPayout,
      bossRewardGold: legacyPayout.bossRewardGold ?? legacyPayout.flameBonusGold ?? 0 } : null;
    if (payout) delete (payout as { flameBonusGold?: number }).flameBonusGold;
    return { ...round, attempt: round.attempt ?? 1, goldBefore: round.goldBefore ?? next.gold,
      goldBySourceBefore: round.goldBySourceBefore ?? structuredClone(next.stats.goldBySource), payout };
  });
  const legacyLastPayout = next.lastRoundPayout as (typeof next.lastRoundPayout & { flameBonusGold?: number }) | null;
  if (legacyLastPayout) {
    next.lastRoundPayout = { ...legacyLastPayout,
      bossRewardGold: legacyLastPayout.bossRewardGold ?? legacyLastPayout.flameBonusGold ?? 0 };
    delete (next.lastRoundPayout as { flameBonusGold?: number }).flameBonusGold;
  }
  next.stats.flameStokes ??= ((next.stats as unknown as { flameDonations?: GameState['stats']['flameStokes'] }).flameDonations ?? []);
  next.stats.flameStokes = next.stats.flameStokes.map(stoke => ({ ...stoke,
    from: stoke.from ?? Math.max(0, stoke.total - stoke.amount),
    source: (stoke.source as string) === 'flame_reward' ? 'flame_selection' : stoke.source ?? 'flame_selection' }));
  const legacyGold = next.stats.goldBySource as Record<string, number>;
  next.stats.goldBySource.bossReward ??= legacyGold.flameBonus ?? 0;
  delete legacyGold.flameBonus;
  next.stats.roundSummaries ??= [];
  next.history = next.history.map(record => {
    if ((record.type as string) !== 'FLAME_REWARD_OPENED' && (record.nodeType as string) !== 'flame_reward') return record;
    return { ...record,
      type: (record.type as string) === 'FLAME_REWARD_OPENED' ? 'FLAME_SELECTION_OPENED' as const : record.type,
      nodeType: (record.nodeType as string) === 'flame_reward' ? 'flame_selection' as const : record.nodeType };
  });
  next.stats.actions = next.stats.actions.map(action => (action.type as string) === 'CONTINUE_FLAME_REWARD'
    ? { type: 'CONTINUE_FLAME_SELECTION' } : action);
  next.stats.goldBySource.enhancementSale ??= 0;
  next.stats.goldBySource.specialOffer ??= 0;
  next.stats.goldBySource.cashBonus ??= 0;
  next.stats.goldSpentBySource.lifeRestore ??= 0;
  next.decisionId = Math.max(0, Math.floor(next.decisionId ?? 0));
  normalizeSixPackRuntime(next);
  normalizeHandFamilyFlameRuntime(next);
  recalculateMaxCharge(next);
  return next;
}

const requiredChargeFlameDieIds = (state: Board) => activeEncounterDice(state)
  .filter(die => isChargeFlame(activeFlameId(die.flame))).map(die => die.id).sort((a, b) => a - b);

export function validateAction(state: Board, action: Action): string | null {
  if (action.type === 'CONTINUE_ROUND_SUMMARY') return state.phase === 'roundSummary' && !!state.roundSummary
    ? null : 'A completed encounter summary is required.';
  if (action.type === 'RETRY_ROUND') return state.phase === 'shop' && !!state.shop && !!state.bust && state.lives > 0
    ? null : 'A returned Bust Shop is required to retry the round.';
  if (action.type === 'MANUAL_REROLL') {
    if (state.phase !== 'round') return 'Manual rerolls can only be used during a gameplay round.';
    if (!state.bossSilenced && state.boss?.type === 'warden' && state.boss.pendingReinforcements > 0) return 'Unlock a Warden die before taking another action.';
    if (!action.dieIds.length) return 'Select at least one die to reroll.';
    if (new Set(action.dieIds).size !== action.dieIds.length
      || action.dieIds.some(id => !Number.isInteger(id) || !activeEncounterDice(state).some(die => die.id === id))) return 'Select distinct unlocked dice that are on the board.';
    if (action.dieIds.length > usableManualRerolls(state)) return 'Not enough manual rerolls for these dice.';
    return null;
  }
  if (action.type === 'PLAY') {
    if (state.phase !== 'round') return 'Hands can only be played during a round.';
    if (!state.bossSilenced && state.boss?.type === 'warden' && state.boss.pendingReinforcements > 0) return 'Unlock a Warden die before committing another hand.';
    if (action.decisionMs !== undefined && (!Number.isFinite(action.decisionMs) || action.decisionMs < 0)) return 'Decision time must be a nonnegative number.';
    if (unavailableEncounterHands(state).includes(action.hand)) return state.boss?.type === 'marathon'
      ? 'That hand is still cooling down.' : state.boss?.type === 'quickdraw' ? 'Quickdraw has no Lower shot remaining.' : 'That hand has already been consumed.';
    if (!state.bossSilenced && state.boss?.type === 'hexer' && !action.dieIds.includes(state.boss.cursedDieId)) return 'The Cursed Die must participate in every hand.';
    if (state.chargeArmed && !hasChargeBonfire(state)) {
      const missing = requiredChargeFlameDieIds(state).filter(id => !action.dieIds.includes(id));
      if (missing.length) return 'Every Charge Flame die must participate while Charge is armed.';
    }
    if (!isValidSelection(activeEncounterDice(state), action.hand, action.dieIds)) return 'Select a complete valid set of participating dice.';
    return null;
  }
  if (action.type === 'UNLOCK_WARDEN_DIE') {
    if (state.phase !== 'round' || state.bossSilenced || state.boss?.type !== 'warden') return 'Dice can only be unlocked during The Warden encounter.';
    if (state.boss.pendingReinforcements <= 0) return 'No Warden reinforcement is ready.';
    const die = state.dice.find(item => item.id === action.dieId && item.owner === 'player');
    if (!die || state.boss.activeDieIds.includes(die.id)) return 'Choose a locked player die.';
    return null;
  }
  if (action.type === 'TOGGLE_CHARGE') {
    if (state.phase !== 'round') return 'Charge can only be armed during a gameplay round.';
    if (!hasOwnedChargeFlame(state)) return 'This run does not own a Charge Flame.';
    if (!state.chargeArmed && state.chargeXMult <= 1) return 'Charge has no stored bonus yet.';
    if (!state.chargeArmed && !hasChargeBonfire(state)) {
      const required = requiredChargeFlameDieIds(state);
      const selected = action.dieIds ?? [];
      if (!required.length || required.some(id => !selected.includes(id)) || !action.hand
        || !isValidSelection(activeEncounterDice(state), action.hand, selected))
        return 'Select every Charge Flame die in the intended hand before arming Charge.';
    }
    return null;
  }
  if (action.type === 'STOKE_FLAME') {
    if (state.phase !== 'shop' || !state.shop) return 'Flames can only be Stoked in a normal Shop.';
    const die = state.dice.find(item => item.id === action.dieId && item.owner === 'player');
    if (!die?.flame || !activeFlameId(die.flame)) return 'Choose an active Flame to invest in.';
    if (!Number.isInteger(action.amount) || action.amount <= 0) return 'Stoking requires a positive whole Gold amount.';
    if (action.amount > state.gold) return 'Not enough Gold to Stoke that Ember.';
    if (activeFlameInvestment(die.flame) + action.amount > 100) return 'A Flame cannot hold more than 100 invested Gold.';
    return null;
  }
  if (action.type === 'CHOOSE_FLAME' || action.type === 'CONTINUE_FLAME_SELECTION') {
    if (state.phase !== 'flameSelection' || !state.flameSelection) return 'This action requires an open Flame Selection.';
    if (action.type === 'CHOOSE_FLAME') {
      if (state.flameSelection.acquired) return 'Only one new Flame may be acquired per selection.';
      const offer = state.flameSelection.offers.find(item => item.id === action.offerId);
      if (!offer || !state.dice.some(die => die.id === action.dieId && die.owner === 'player')) return 'Choose an available Flame and a physical die.';
      if (hasOwnedFlame(state as GameState, offer.flame)) return 'That Flame type is already owned by this run.';
    }
    return null;
  }
  if (action.type === 'CHOOSE_SPECIAL_OFFER' || action.type === 'CONTINUE_SPECIAL_OFFER') {
    if (state.phase !== 'specialOffer' || !state.specialOffer) return 'This action requires an open Special Offer.';
    if (action.type === 'CHOOSE_SPECIAL_OFFER') {
      if (state.specialOffer.acquired) return 'Only one Special Offer may be chosen.';
      if (!state.specialOffer.offers.some(offer => offer.id === action.offerId)) return 'Choose an available Special Offer.';
    } else if (!state.specialOffer.acquired) return 'Choose one Special Offer before continuing.';
    return null;
  }
  if (state.phase !== 'shop' || !state.shop) return 'This action requires an open shop.';
  if (action.type === 'NEXT_CHAPTER') {
    if (state.bust || state.shop.kind !== 'post_boss' || !isBigBossRound(state.round))
      return 'Next Chapter is only available from the final post-Boss Shop.';
  }
  if (action.type === 'NEXT_ROUND' && state.shop.kind === 'post_boss' && !state.bust)
    return 'Use Next Chapter after the final post-Boss Shop.';
  if (action.type === 'NEXT_ROUND' && state.bust) return 'Use Retry Round after preparing for the failed round.';
  if (action.type === 'BUY') {
    const offer = state.shop.offers.find(item => item.id === action.offerId);
    const die = state.dice.find(item => item.id === action.dieId);
    if (!offer || offer.purchased || !die) return 'Choose an available offer and a physical die.';
    const cost = enhancementOfferIsFree(state.shop, offer.id) ? 0 : enhancementCost(offer.enhancement);
    if (state.gold < cost) return 'Not enough Gold for this Enhancement.';
    return placementError(die, activeFace(die), offer.enhancement);
  }
  if (action.type === 'SELL_ENHANCEMENT') {
    const die = state.dice.find(item => item.id === action.dieId);
    if (!die || !Number.isInteger(action.face) || !stacks(die.faces[action.face - 1], action.enhancement)) return 'Choose an Enhancement on that Face.';
  }
  if (action.type === 'RESTORE_LIFE') {
    if (state.lives >= CONFIG.maxLives) return 'All lives are already restored.';
    if (state.gold < lifeRestoreCost(state.shop.lifeRestores)) return 'Not enough Gold to restore a Life.';
  }
  if (action.type === 'TRAIN_HAND') {
    const offer = state.shop.trainingOffers.find(item => item.kind === 'hand' && item.hand === action.hand);
    if (!offer) return 'Choose an available hand training offer.';
    if (state.gold < (trainingOfferIsFree(state.shop, offer) ? 0 : handTrainingCost(offer.purchases))) return 'Not enough Gold to train this hand.';
  }
  if (action.type === 'TRAIN_ALL_HANDS') {
    const offer = state.shop.trainingOffers.find(item => item.kind === 'team');
    if (!offer) return 'Choose an available Team Training offer.';
    if (state.gold < (trainingOfferIsFree(state.shop, offer) ? 0 : teamTrainingCost(offer.purchases))) return 'Not enough Gold for Team Training.';
  }
  if (action.type === 'REROLL_DICE' && state.gold < diceRerollCost(state.shop.diceRerolls)) return 'Not enough Gold to reroll Shop dice.';
  if (action.type === 'REROLL_OFFERS' && state.gold < offerRerollCost(state.shop.offerRerolls)) return 'Not enough Gold to reroll offers.';
  return null;
}

function execute(state: GameState, run: (resolver: Resolver) => void, random?: RandomSource, rngStateOverride?: number,
  options?: ResolverOptions): Resolution {
  const next = structuredClone(state);
  if (rngStateOverride !== undefined) next.rngState = rngStateOverride;
  const seeded = new SeededRng(next.rngState);
  const resolver = new Resolver(next, random ?? seeded, options);
  try { run(resolver); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Roll Call engine] ${message}`);
    next.phase = 'error';
    next.stats.resolutionError = message;
    const record = { id: next.history.length, round: next.round, type: 'RESOLUTION_ERROR' as const, message };
    next.history.push(record);
    resolver.events.push({ ...record, board: boardSnapshot(next) });
  }
  next.rngState = resolver.rngStateAfterResolution ?? seeded.state;
  return { state: next, events: resolver.events };
}

export function newRun(seed: string, random?: RandomSource): Resolution {
  const state: GameState = {
    phase: 'round', seed, rngState: hashSeed(seed), round: 1, target: CONFIG.baseTarget,
    score: 0, gold: CONFIG.startingGold, lives: CONFIG.maxLives, roundAttemptNumber: 1,
    bossSchedule: {}, chapterPlans: {}, presentedChapters: [], boss: null, bossSilenced: false, currentNodeId: '',
    bust: null, flameTutorial: { pendingDieId: null, completed: false }, dice: createDice(), bonfires: [], chargeXMult: 1, maxCharge: 1,
    chargeArmed: false, decisionId: 0, sixPackXMult: 1, sixPackUpperHandsPlayed: 0, hotStreakGoal: null, hotStreakCharges: 0, handFamilyFlameStages: {}, lifetimeNormalShopGoldSpent: 0, consumed: [], scorecardCycleConsumed: [], shop: null,
    fetchTarget: null,
    handLevels: initialHandLevels(), handPlayCounts: initialHandPlayCounts(), targetPracticeHand: null,
    scoreByHand: {}, effectScore: 0, lastRoundPayout: null, roundSummary: null, flameSelection: null, specialOffer: null,
    manualRerollsRemaining: CONFIG.manualRerollsPerRound, specialOfferEffects: initialSpecialOfferEffects(), suppressedPostBossRewardRounds: [],
    nextOfferId: 0, stats: createStats(seed), history: [], roundCheckpoint: null, badDreamCheckpoint: null,
  };
  return execute(state, resolver => resolver.startRound(), random, random ? undefined : attemptSeed(seed, 1, 1));
}

export function dispatch(state: GameState, action: Action, random?: RandomSource, options?: ResolverOptions): Resolution {
  const normalized = normalizeGameState(state);
  const normalizationChangedState = JSON.stringify(normalized) !== JSON.stringify(state);
  const error = validateAction(normalized, action);
  if (error) return { state: normalizationChangedState ? normalized : state, events: [], error };
  const rngStateOverride = random ? undefined : action.type === 'NEXT_ROUND' || action.type === 'NEXT_CHAPTER'
    ? attemptSeed(normalized.seed, normalized.round + 1, 1)
    : action.type === 'RETRY_ROUND' ? attemptSeed(normalized.seed, normalized.round, normalized.roundAttemptNumber)
      : action.type === 'CONTINUE_SPECIAL_OFFER' && normalized.specialOffer?.chosen?.type === 'timeTravel'
        ? attemptSeed(normalized.seed, normalized.round, 1) : undefined;
  return execute(normalized, resolver => {
    const next = resolver.state;
    next.stats.actions.push(structuredClone(action));
    switch (action.type) {
      case 'PLAY': resolver.play(action.hand, action.dieIds, 'manual', action.decisionMs ?? null); break;
      case 'MANUAL_REROLL': resolver.manualReroll(action.dieIds); break;
      case 'UNLOCK_WARDEN_DIE': resolver.unlockWardenDie(action.dieId); break;
      case 'TOGGLE_CHARGE':
        next.chargeArmed = !next.chargeArmed;
        if (next.chargeArmed) next.stats.chargeArmed++;
        resolver.emit({ type: 'CHARGE_ARMED', xMult: next.chargeXMult,
          message: `Charge ${next.chargeArmed ? `armed at ×${resolver.format(next.chargeXMult)}` : 'disarmed'}` });
        break;
      case 'BUY': {
        const offer = next.shop!.offers.find(item => item.id === action.offerId)!;
        const die = next.dice[action.dieId];
        const face = activeFace(die);
        const cost = enhancementOfferIsFree(next.shop!, offer.id) ? 0 : enhancementCost(offer.enhancement);
        if (cost) resolver.spendGold(cost, `Bought ${ENHANCEMENTS[offer.enhancement].name} [${rarityLabel(ENHANCEMENTS[offer.enhancement].rarity)}]: −${formatPlayerNumber(cost)} gold`, 'enhancement');
        next.shop!.freeEnhancementOfferIds = (next.shop!.freeEnhancementOfferIds ?? []).filter(id => id !== offer.id);
        face.enhancements[offer.enhancement] = (face.enhancements[offer.enhancement] ?? 0) + 1;
        if (offer.enhancement === 'vintage') { face.vintageSellValue = 0; delete face.vintageSommelierBoosted; }
        offer.purchased = true;
        next.stats.purchases.push({ round: next.round, enhancement: offer.enhancement, dieId: die.id, face: face.rank, cost, stacksApplied: 1 });
        const key = `D${die.id + 1}:${face.rank}`;
        if (!next.stats.enhancedFaces.includes(key)) next.stats.enhancedFaces.push(key);
        resolver.emit({ type: 'OFFER_PURCHASED', enhancement: offer.enhancement, rarity: ENHANCEMENTS[offer.enhancement].rarity, dieIds: [die.id], face: face.rank,
          message: `${ENHANCEMENTS[offer.enhancement].name} [${rarityLabel(ENHANCEMENTS[offer.enhancement].rarity)}] added to D${die.id + 1} face ${face.rank}` });
        break;
      }
      case 'SELL_ENHANCEMENT': {
        const die = next.dice[action.dieId];
        const face = die.faces[action.face - 1];
        const stacksSold = stacks(face, action.enhancement);
        const definition = ENHANCEMENTS[action.enhancement];
        const totalProceeds = enhancementSellValue(face, action.enhancement);
        const goldBefore = next.gold;
        const vintageSellValue = action.enhancement === 'vintage' ? totalProceeds : undefined;
        delete face.enhancements[action.enhancement];
        if (action.enhancement === 'vintage') { delete face.vintageSellValue; delete face.vintageSommelierBoosted; }
        resolver.addGold(totalProceeds, `Sold ${definition.name} ×${formatPlayerNumber(stacksSold)}: +${formatPlayerNumber(totalProceeds)} Gold`, 'enhancementSale', die.id, action.enhancement, face.rank);
        next.stats.sales.push({ round: next.round, enhancement: action.enhancement, dieId: die.id, face: face.rank, stacksSold,
          baseSellPrice: definition.baseSellPrice, totalProceeds, goldBefore, goldAfter: next.gold, vintageSellValue });
        resolver.emit({ type: 'ENHANCEMENT_SOLD', enhancement: action.enhancement, dieIds: [die.id], face: face.rank,
          amount: totalProceeds, message: `Sold all ${formatPlayerNumber(stacksSold)} ${definition.name} stack${stacksSold === 1 ? '' : 's'} from D${die.id + 1} face ${face.rank} for ${formatPlayerNumber(totalProceeds)} Gold` });
        break;
      }
      case 'CHOOSE_FLAME': {
        const offer = next.flameSelection!.offers.find(item => item.id === action.offerId)!;
        const die = next.dice[action.dieId];
        const replaced = activeFlameId(die.flame);
        const firstFlame = next.stats.flameAcquisitions.length === 0;
        die.flame = { id: offer.flame, investedGold: 0 };
        if (replaced === 'fetch') next.fetchTarget = null;
        if (offer.flame === 'fetch') resolver.setFetchTarget(die.id, null);
        normalizeHandFamilyFlameRuntime(next);
        recalculateMaxCharge(next);
        next.flameSelection!.acquired = true;
        next.stats.flameAcquisitions.push({ round: next.round, dieId: die.id, flame: offer.flame, replaced });
        if (firstFlame && !next.flameTutorial.completed) next.flameTutorial.pendingDieId = die.id;
        resolver.emit({ type: replaced ? 'FLAME_REPLACED' : 'FLAME_ACQUIRED', flame: offer.flame, rarity: FLAMES[offer.flame].rarity, dieIds: [die.id],
          message: replaced ? `D${die.id + 1} replaced ${FLAMES[replaced].name} with ${FLAMES[offer.flame].name} [${rarityLabel(FLAMES[offer.flame].rarity)}]; prior investment was lost`
            : `D${die.id + 1} acquired ${FLAMES[offer.flame].name} [${rarityLabel(FLAMES[offer.flame].rarity)}] as a 0-Gold ember` });
        break;
      }
      case 'STOKE_FLAME': {
        const die = next.dice[action.dieId];
        const id = activeFlameId(die.flame)!;
        const flame = die.flame = { id, investedGold: activeFlameInvestment(die.flame) };
        const source = 'shop' as const;
        const from = flame.investedGold;
        resolver.spendGold(action.amount, `Stoked ${FLAMES[flame.id].name}: −${formatPlayerNumber(action.amount)} Gold (Shop)`, 'flameInvestment');
        flame.investedGold += action.amount;
        recalculateMaxCharge(next);
        next.stats.flameStokes.push({ round: next.round, dieId: die.id, flame: flame.id, amount: action.amount,
          from, total: flame.investedGold, source });
        next.stats.totalFlameInvestment += action.amount;
        resolver.emit({ type: 'FLAME_INVESTED', flame: flame.id, dieIds: [die.id], amount: action.amount,
          message: `Stoked ${FLAMES[flame.id].name}: ${formatPlayerNumber(from)} → ${formatPlayerNumber(flame.investedGold)} / 100 · ${flameEffectText(flame.id, flame.investedGold, next)}` });
        if (flame.investedGold === 100) {
          const id = flame.id;
          die.flame = null;
          if (!next.bonfires.includes(id)) next.bonfires.push(id);
          recalculateMaxCharge(next);
          next.stats.bonfiresCreated.push({ round: next.round, flame: id });
          resolver.emit({ type: 'BONFIRE_CREATED', flame: id, dieIds: [die.id],
            message: `${FLAMES[id].name} became a Bonfire and detached from D${die.id + 1}` });
        }
        break;
      }
      case 'CONTINUE_ROUND_SUMMARY': resolver.continueRoundSummary(); break;
      case 'CONTINUE_FLAME_SELECTION':
        if (!next.flameSelection!.acquired) {
          next.stats.flameSkips.push(next.round);
          resolver.emit({ type: 'FLAME_SKIPPED', message: `Skipped Flame acquisition for round ${formatPlayerNumber(next.round)}` });
        }
        resolver.openShop();
        break;
      case 'CHOOSE_SPECIAL_OFFER': resolver.chooseSpecialOffer(action.offerId); break;
      case 'CONTINUE_SPECIAL_OFFER': resolver.continueSpecialOffer(); break;
      case 'REROLL_DICE':
        resolver.spendGold(diceRerollCost(next.shop!.diceRerolls), 'Paid for shop dice reroll', 'shopDiceReroll');
        next.shop!.diceRerolls++;
        next.stats.shopDiceRerolls++;
        resolver.rollBatch(next.dice.map(die => die.id), 'Shop dice reroll', 'shop');
        break;
      case 'REROLL_OFFERS':
        resolver.spendGold(offerRerollCost(next.shop!.offerRerolls), 'Paid for enhancement reroll', 'enhancementReroll');
        next.shop!.offerRerolls++;
        next.stats.enhancementShopRerolls++;
        resolver.freshOffers();
        resolver.emit({ type: 'OFFERS_REFRESHED', message: 'Three fresh distinct enhancement offers' });
        break;
      case 'TRAIN_HAND': {
        const offer = next.shop!.trainingOffers.find(item => item.kind === 'hand' && item.hand === action.hand)!;
        const fromLevel = next.handLevels[action.hand];
        const toLevel = fromLevel + 1;
        const key = trainingOfferKey(offer);
        const cost = trainingOfferIsFree(next.shop!, offer) ? 0 : handTrainingCost(offer.purchases);
        if (cost) resolver.spendGold(cost, `Trained ${HANDS[action.hand].name} to level ${formatPlayerNumber(toLevel)}: −${formatPlayerNumber(cost)} gold`, 'handTraining');
        next.shop!.freeTrainingOfferKeys = (next.shop!.freeTrainingOfferKeys ?? []).filter(item => item !== key);
        next.handLevels[action.hand] = toLevel;
        offer.purchases++;
        next.stats.trainingPurchases.push({ round: next.round, hand: action.hand, fromLevel, toLevel, cost });
        next.stats.trainingPurchasesTotal++;
        next.stats.trainingGoldSpent += cost;
        resolver.emit({ type: 'TRAINING_PURCHASED', hand: action.hand, goldSpendSource: 'handTraining', amount: cost,
          message: `${HANDS[action.hand].name} trained to level ${formatPlayerNumber(toLevel)} · next training ${formatPlayerNumber(handTrainingCost(offer.purchases))} Gold` });
        break;
      }
      case 'TRAIN_ALL_HANDS': {
        const offer = next.shop!.trainingOffers.find(item => item.kind === 'team')!;
        const key = trainingOfferKey(offer);
        const cost = trainingOfferIsFree(next.shop!, offer) ? 0 : teamTrainingCost(offer.purchases);
        if (cost) resolver.spendGold(cost, `Team Training: −${formatPlayerNumber(cost)} gold`, 'handTraining');
        next.shop!.freeTrainingOfferKeys = (next.shop!.freeTrainingOfferKeys ?? []).filter(item => item !== key);
        for (const hand of HAND_IDS) next.handLevels[hand]++;
        offer.purchases++;
        next.stats.trainingPurchases.push({ round: next.round, hand: 'all', cost });
        next.stats.trainingPurchasesTotal++;
        next.stats.trainingGoldSpent += cost;
        resolver.emit({ type: 'TRAINING_PURCHASED', goldSpendSource: 'handTraining', amount: cost,
          message: `Team Training raised every hand by 1 level · next training ${formatPlayerNumber(teamTrainingCost(offer.purchases))} Gold` });
        break;
      }
      case 'RESTORE_LIFE': {
        const purchaseNumber = next.stats.lifeRestores.length + 1;
        const cost = lifeRestoreCost(next.shop!.lifeRestores);
        const goldBefore = next.gold;
        const livesBefore = next.lives;
        const lifetimeSpendBefore = next.lifetimeNormalShopGoldSpent;
        resolver.spendGold(cost, `Restored life #${formatPlayerNumber(purchaseNumber)}: −${formatPlayerNumber(cost)} Gold`, 'lifeRestore');
        next.lives++;
        next.shop!.lifeRestores++;
        next.stats.lifeRestores.push({ round: next.round, purchaseNumber, cost, goldBefore, goldAfter: next.gold,
          livesBefore, livesAfter: next.lives, lifetimeSpendBefore, lifetimeSpendAfter: next.lifetimeNormalShopGoldSpent });
        resolver.emit({ type: 'LIFE_RESTORED', amount: cost,
          message: `Restore #${formatPlayerNumber(purchaseNumber)}: ${formatPlayerNumber(cost)} Gold · lives ${formatPlayerNumber(livesBefore)} → ${formatPlayerNumber(next.lives)} · lifetime shop spend +${formatPlayerNumber(cost)}` });
        break;
      }
      case 'DISMISS_FLAME_TUTORIAL':
        next.flameTutorial = { pendingDieId: null, completed: true };
        resolver.emit({ type: 'FLAME_TUTORIAL_COMPLETED', message: 'First-Flame shop tutorial completed' });
        break;
      case 'RETRY_ROUND': resolver.startRound(true); break;
      case 'NEXT_CHAPTER':
        if (next.flameTutorial.pendingDieId !== null && !next.flameTutorial.completed) next.flameTutorial = { pendingDieId: null, completed: true };
        next.round++; next.roundAttemptNumber = 1; resolver.startRound(); break;
      case 'NEXT_ROUND':
        if (next.flameTutorial.pendingDieId !== null && !next.flameTutorial.completed) next.flameTutorial = { pendingDieId: null, completed: true };
        next.round++; next.roundAttemptNumber = 1; resolver.startRound(); break;
    }
  }, random, rngStateOverride, options);
}
