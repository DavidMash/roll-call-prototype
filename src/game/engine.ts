import { CONFIG, diceRerollCost, handTrainingCost, lifeRestoreCost, offerRerollCost, teamTrainingCost } from './config';
import { activeFace, createDice } from './dice';
import { Resolver } from './effects';
import { enhancementCost, enhancementSellValue, ENHANCEMENTS, ENHANCEMENT_IDS, isEnhancement, placementError, stacks } from './enhancements';
import {
  activeFlameId, activeFlameInvestment, flameEffectText, FLAMES, hasChargeBonfire, hasOwnedChargeFlame,
  hasOwnedFlame, isChargeFlame, isFlame, recalculateMaxCharge, sixPackMultiplierAfterUpperHands, sixPackStartingMultiplier,
} from './flames';
import { HANDS, HAND_IDS, initialHandLevels, initialHandPlayCounts, isValidSelection } from './hands';
import { hashSeed, SeededRng } from './rng';
import { boardSnapshot, createStats } from './telemetry';
import { activeEncounterDice, bossSchedule, unavailableEncounterHands } from './bosses';
import { formatPlayerNumber } from './copy';
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

function normalizeSixPackRuntime(state: Pick<Board, 'dice' | 'bonfires' | 'sixPackXMult' | 'sixPackUpperHandsPlayed'>): void {
  const startingFactor = state.bonfires.includes('sixPack') ? sixPackStartingMultiplier(100)
    : sixPackStartingMultiplier(activeFlameInvestment(state.dice.find(die => activeFlameId(die.flame) === 'sixPack')?.flame ?? null));
  const missingCount = state.sixPackUpperHandsPlayed === undefined;
  const inferred = startingFactor <= 1 ? 0 : Math.round(6 * (startingFactor - Math.max(1, state.sixPackXMult ?? 1)) / (startingFactor - 1));
  state.sixPackUpperHandsPlayed = Math.max(0, Math.min(6, Math.floor(missingCount ? inferred : state.sixPackUpperHandsPlayed)));
  state.sixPackXMult = missingCount ? sixPackMultiplierAfterUpperHands(startingFactor, state.sixPackUpperHandsPlayed)
    : Math.max(1, state.sixPackXMult ?? 1);
}

export function normalizeGameState(state: GameState): GameState {
  const next = structuredClone(state);
  const legacy = next as GameState & { flameReward?: GameState['flameSelection'] };
  if (!next.flameSelection && legacy.flameReward) next.flameSelection = legacy.flameReward;
  delete legacy.flameReward;
  if ((next.phase as string) === 'flameReward') next.phase = 'flameSelection';
  for (const die of next.dice) {
    die.owner ??= 'player';
    for (const face of die.faces) {
      const legacyMagnetic = face as typeof face & { magneticUsed?: boolean };
      if (legacyMagnetic.magneticUsed) face.magneticDestinationUsed = true;
      delete legacyMagnetic.magneticUsed;
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
      if ((face.enhancements.vintage ?? 0) > 0) face.vintageSellValue = Math.max(0, Math.floor(face.vintageSellValue ?? 0));
      else delete face.vintageSellValue;
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
  }
  if (next.roundCheckpoint) {
    if (next.roundCheckpoint.shop) normalizeShop(next.roundCheckpoint.shop);
    for (const die of next.roundCheckpoint.dice) {
      for (const face of die.faces) {
        const legacyMagnetic = face as typeof face & { magneticUsed?: boolean };
        if (legacyMagnetic.magneticUsed) face.magneticDestinationUsed = true;
        delete legacyMagnetic.magneticUsed;
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
  }
  if (next.flameSelection) next.flameSelection.offers = next.flameSelection.offers
    .map(offer => ({ ...offer, flame: (offer.flame as string) === 'charge' ? 'momentum' as const : offer.flame }))
    .filter(offer => isFlame(offer.flame));
  next.roundSummary ??= null;
  next.stats.jumpingBeanFreePlays ??= [];
  next.bossSchedule ??= bossSchedule(next.seed);
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
  next.stats.sales ??= [];
  next.stats.mapTransitions ??= [];
  next.stats.mapTransitions = next.stats.mapTransitions.map(record => ({ ...record,
    nodeType: (record.nodeType as string) === 'flame_reward' ? 'flame_selection' : record.nodeType }));
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
  next.history = next.history.map(record => ({ ...record,
    type: (record.type as string) === 'FLAME_REWARD_OPENED' ? 'FLAME_SELECTION_OPENED' : record.type,
    nodeType: (record.nodeType as string) === 'flame_reward' ? 'flame_selection' : record.nodeType }));
  next.stats.actions = next.stats.actions.map(action => (action.type as string) === 'CONTINUE_FLAME_REWARD'
    ? { type: 'CONTINUE_FLAME_SELECTION' } : action);
  next.stats.goldBySource.enhancementSale ??= 0;
  next.stats.goldSpentBySource.lifeRestore ??= 0;
  next.decisionId = Math.max(0, Math.floor(next.decisionId ?? 0));
  normalizeSixPackRuntime(next);
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
    if (state.boss?.type === 'warden' && state.boss.pendingReinforcements > 0) return 'Unlock a Warden die before taking another action.';
    if (!action.dieIds.length) return 'Select at least one die to reroll.';
    if (new Set(action.dieIds).size !== action.dieIds.length
      || action.dieIds.some(id => !Number.isInteger(id) || !activeEncounterDice(state).some(die => die.id === id))) return 'Select distinct unlocked dice that are on the board.';
    if (action.dieIds.length > state.manualRerollsRemaining) return 'Not enough manual rerolls for these dice.';
    return null;
  }
  if (action.type === 'PLAY') {
    if (state.phase !== 'round') return 'Hands can only be played during a round.';
    if (state.boss?.type === 'warden' && state.boss.pendingReinforcements > 0) return 'Unlock a Warden die before committing another hand.';
    if (action.decisionMs !== undefined && (!Number.isFinite(action.decisionMs) || action.decisionMs < 0)) return 'Decision time must be a nonnegative number.';
    if (unavailableEncounterHands(state).includes(action.hand)) return state.boss?.type === 'marathon'
      ? 'That hand is still cooling down.' : state.boss?.type === 'quickdraw' ? 'Quickdraw has no Lower shot remaining.' : 'That hand has already been consumed.';
    if (state.boss?.type === 'hexer' && !action.dieIds.includes(state.boss.cursedDieId)) return 'The Cursed Die must participate in every hand.';
    if (state.chargeArmed && !hasChargeBonfire(state)) {
      const missing = requiredChargeFlameDieIds(state).filter(id => !action.dieIds.includes(id));
      if (missing.length) return 'Every Charge Flame die must participate while Charge is armed.';
    }
    if (!isValidSelection(activeEncounterDice(state), action.hand, action.dieIds)) return 'Select a complete valid set of participating dice.';
    return null;
  }
  if (action.type === 'UNLOCK_WARDEN_DIE') {
    if (state.phase !== 'round' || state.boss?.type !== 'warden') return 'Dice can only be unlocked during The Warden encounter.';
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
  if (state.phase !== 'shop' || !state.shop) return 'This action requires an open shop.';
  if (action.type === 'NEXT_ROUND' && state.bust) return 'Use Retry Round after preparing for the failed round.';
  if (action.type === 'BUY') {
    const offer = state.shop.offers.find(item => item.id === action.offerId);
    const die = state.dice.find(item => item.id === action.dieId);
    if (!offer || offer.purchased || !die) return 'Choose an available offer and a physical die.';
    if (state.gold < enhancementCost(offer.enhancement)) return 'Not enough Gold for this Enhancement.';
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
    if (state.gold < handTrainingCost(offer.purchases)) return 'Not enough Gold to train this hand.';
  }
  if (action.type === 'TRAIN_ALL_HANDS') {
    const offer = state.shop.trainingOffers.find(item => item.kind === 'team');
    if (!offer) return 'Choose an available Team Training offer.';
    if (state.gold < teamTrainingCost(offer.purchases)) return 'Not enough Gold for Team Training.';
  }
  if (action.type === 'REROLL_DICE' && state.gold < diceRerollCost(state.shop.diceRerolls)) return 'Not enough Gold to reroll Shop dice.';
  if (action.type === 'REROLL_OFFERS' && state.gold < offerRerollCost(state.shop.offerRerolls)) return 'Not enough Gold to reroll offers.';
  return null;
}

function execute(state: GameState, run: (resolver: Resolver) => void, random?: RandomSource, rngStateOverride?: number): Resolution {
  const next = structuredClone(state);
  if (rngStateOverride !== undefined) next.rngState = rngStateOverride;
  const seeded = new SeededRng(next.rngState);
  const resolver = new Resolver(next, random ?? seeded);
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
  next.rngState = seeded.state;
  return { state: next, events: resolver.events };
}

export function newRun(seed: string, random?: RandomSource): Resolution {
  const state: GameState = {
    phase: 'round', seed, rngState: hashSeed(seed), round: 1, target: CONFIG.baseTarget,
    score: 0, gold: CONFIG.startingGold, lives: CONFIG.maxLives, roundAttemptNumber: 1,
    bossSchedule: bossSchedule(seed), boss: null, currentNodeId: '',
    bust: null, flameTutorial: { pendingDieId: null, completed: false }, dice: createDice(), bonfires: [], chargeXMult: 1, maxCharge: 1,
    chargeArmed: false, decisionId: 0, sixPackXMult: 1, sixPackUpperHandsPlayed: 0, hotStreakGoal: null, hotStreakCharges: 0, lifetimeNormalShopGoldSpent: 0, consumed: [], shop: null,
    handLevels: initialHandLevels(), handPlayCounts: initialHandPlayCounts(), targetPracticeHand: null,
    scoreByHand: {}, effectScore: 0, lastRoundPayout: null, roundSummary: null, flameSelection: null,
    manualRerollsRemaining: CONFIG.manualRerollsPerRound, nextOfferId: 0, stats: createStats(seed), history: [], roundCheckpoint: null,
  };
  return execute(state, resolver => resolver.startRound(), random, random ? undefined : attemptSeed(seed, 1, 1));
}

export function dispatch(state: GameState, action: Action, random?: RandomSource): Resolution {
  const normalized = normalizeGameState(state);
  const normalizationChangedState = JSON.stringify(normalized) !== JSON.stringify(state);
  const error = validateAction(normalized, action);
  if (error) return { state: normalizationChangedState ? normalized : state, events: [], error };
  const rngStateOverride = random ? undefined : action.type === 'NEXT_ROUND'
    ? attemptSeed(normalized.seed, normalized.round + 1, 1)
    : action.type === 'RETRY_ROUND' ? attemptSeed(normalized.seed, normalized.round, normalized.roundAttemptNumber) : undefined;
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
        const cost = enhancementCost(offer.enhancement);
        resolver.spendGold(cost, `Bought ${ENHANCEMENTS[offer.enhancement].name}: −${formatPlayerNumber(cost)} gold`, 'enhancement');
        face.enhancements[offer.enhancement] = (face.enhancements[offer.enhancement] ?? 0) + 1;
        if (offer.enhancement === 'vintage') face.vintageSellValue = 0;
        offer.purchased = true;
        next.stats.purchases.push({ round: next.round, enhancement: offer.enhancement, dieId: die.id, face: face.rank, cost, stacksApplied: 1 });
        const key = `D${die.id + 1}:${face.rank}`;
        if (!next.stats.enhancedFaces.includes(key)) next.stats.enhancedFaces.push(key);
        resolver.emit({ type: 'OFFER_PURCHASED', enhancement: offer.enhancement, dieIds: [die.id], face: face.rank,
          message: `${ENHANCEMENTS[offer.enhancement].name} attached to D${die.id + 1}, physical face ${face.rank}` });
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
        if (action.enhancement === 'vintage') delete face.vintageSellValue;
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
        recalculateMaxCharge(next);
        next.flameSelection!.acquired = true;
        next.stats.flameAcquisitions.push({ round: next.round, dieId: die.id, flame: offer.flame, replaced });
        if (firstFlame && !next.flameTutorial.completed) next.flameTutorial.pendingDieId = die.id;
        resolver.emit({ type: replaced ? 'FLAME_REPLACED' : 'FLAME_ACQUIRED', flame: offer.flame, dieIds: [die.id],
          message: replaced ? `D${die.id + 1} replaced ${FLAMES[replaced].name} with ${FLAMES[offer.flame].name}; prior investment was lost`
            : `D${die.id + 1} acquired ${FLAMES[offer.flame].name} as a 0-Gold ember` });
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
        resolver.openShop(false);
        break;
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
        const cost = handTrainingCost(offer.purchases);
        resolver.spendGold(cost, `Trained ${HANDS[action.hand].name} to level ${formatPlayerNumber(toLevel)}: −${formatPlayerNumber(cost)} gold`, 'handTraining');
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
        const cost = teamTrainingCost(offer.purchases);
        resolver.spendGold(cost, `Team Training: −${formatPlayerNumber(cost)} gold`, 'handTraining');
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
      case 'NEXT_ROUND': next.round++; next.roundAttemptNumber = 1; resolver.startRound(); break;
    }
  }, random, rngStateOverride);
}
