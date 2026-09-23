import { CONFIG, diceRerollCost, lifeRestoreCost, offerRerollCost } from './config';
import { activeFace, createDice } from './dice';
import { Resolver } from './effects';
import { attachmentError, enhancementCost, enhancementSellValue, ENHANCEMENTS, ENHANCEMENT_IDS, isEnhancement, stacks } from './enhancements';
import { activeFlameId, activeFlameInvestment, flameEffectText, FLAMES, hasOwnedFlame, isFlame } from './flames';
import { HANDS, initialHandLevels, initialHandPlayCounts, isValidSelection } from './hands';
import { hashSeed, SeededRng } from './rng';
import { boardSnapshot, createStats } from './telemetry';
import type { Action, Board, GameState, RandomSource, Resolution } from './types';

const attemptSeed = (seed: string, round: number, attempt: number) => hashSeed(`${seed}:round:${round}:attempt:${attempt}`);

function normalizedState(state: GameState): GameState {
  const next = structuredClone(state);
  for (const die of next.dice) {
    for (const face of die.faces) {
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
      if (stacks(face, 'vintage')) face.vintageSellValue = Math.max(0, Math.floor(face.vintageSellValue ?? 0));
      else delete face.vintageSellValue;
    }
    const id = activeFlameId(die.flame);
    die.flame = id ? { id, investedGold: activeFlameInvestment(die.flame) } : null;
  }
  next.bonfires = next.bonfires.filter(isFlame);
  if (next.shop) next.shop.offers = next.shop.offers.filter(offer => isEnhancement(offer.enhancement));
  if (next.flameReward) next.flameReward.offers = next.flameReward.offers.filter(offer => isFlame(offer.flame));
  next.stats.jumpingBeanFreePlays ??= [];
  next.lives = Math.max(0, Math.min(CONFIG.maxLives, Math.floor(next.lives ?? CONFIG.maxLives)));
  next.livesPurchasedThisRun = Math.max(0, Math.floor(next.livesPurchasedThisRun ?? 0));
  next.roundAttemptNumber = Math.max(1, Math.floor(next.roundAttemptNumber ?? 1));
  next.bust ??= null;
  next.flameTutorial ??= { pendingDieId: null, completed: false };
  next.roundCheckpoint ??= null;
  next.stats.sales ??= [];
  next.stats.busts ??= [];
  next.stats.lifeRestores ??= [];
  next.stats.vintageGrowth ??= [];
  next.stats.rounds = next.stats.rounds.map(round => ({ ...round, attempt: round.attempt ?? 1 }));
  next.stats.flameStokes ??= ((next.stats as unknown as { flameDonations?: GameState['stats']['flameStokes'] }).flameDonations ?? []);
  next.stats.flameStokes = next.stats.flameStokes.map(stoke => ({ ...stoke,
    from: stoke.from ?? Math.max(0, stoke.total - stoke.amount), source: stoke.source ?? 'flame_reward' }));
  next.stats.goldBySource.flameBonus ??= 0;
  next.stats.goldBySource.enhancementSale ??= 0;
  next.stats.goldSpentBySource.lifeRestore ??= 0;
  return next;
}

export function validateAction(state: Board, action: Action): string | null {
  if (action.type === 'RETRY_ROUND') return state.phase === 'bust' && state.lives > 0 ? null : 'A living Bust is required to retry the round.';
  if (action.type === 'MANUAL_REROLL') {
    if (state.phase !== 'round') return 'Manual rerolls can only be used during a gameplay round.';
    if (!action.dieIds.length) return 'Select at least one die to reroll.';
    if (new Set(action.dieIds).size !== action.dieIds.length
      || action.dieIds.some(id => !Number.isInteger(id) || !state.dice.some(die => die.id === id))) return 'Select distinct physical dice that are on the board.';
    if (action.dieIds.length > state.manualRerollsRemaining) return 'Not enough manual rerolls for these dice.';
    return null;
  }
  if (action.type === 'PLAY') {
    if (state.phase !== 'round') return 'Hands can only be played during a round.';
    if (state.consumed.includes(action.hand)) return 'That hand has already been consumed.';
    if (!isValidSelection(state.dice, action.hand, action.dieIds)) return 'Select a complete valid set of participating dice.';
    return null;
  }
  if (action.type === 'TOGGLE_CHARGE') {
    if (state.phase !== 'round') return 'Charge can only be armed during a gameplay round.';
    const owned = state.bonfires.includes('charge') || state.dice.some(die => activeFlameId(die.flame) === 'charge');
    if (!owned) return 'This run does not own Charge.';
    if (!state.chargeArmed && state.chargeXMult <= 1) return 'Charge has no stored bonus yet.';
    return null;
  }
  if (action.type === 'STOKE_FLAME') {
    if (state.phase !== 'shop' || !state.shop) return 'Flames can only be Stoked in a normal Shop.';
    const die = state.dice.find(item => item.id === action.dieId);
    if (!die?.flame || !activeFlameId(die.flame)) return 'Choose an active Flame to invest in.';
    if (!Number.isInteger(action.amount) || action.amount <= 0) return 'Stoking requires a positive whole Gold amount.';
    if (action.amount > state.gold) return 'Not enough gold to stoke that Ember.';
    if (activeFlameInvestment(die.flame) + action.amount > 100) return 'A Flame cannot hold more than 100 invested Gold.';
    return null;
  }
  if (action.type === 'CHOOSE_FLAME' || action.type === 'CONTINUE_FLAME_REWARD') {
    if (state.phase !== 'flameReward' || !state.flameReward) return 'This action requires an open Flame Reward.';
    if (action.type === 'CHOOSE_FLAME') {
      if (state.flameReward.acquired) return 'Only one new Flame may be acquired per reward.';
      const offer = state.flameReward.offers.find(item => item.id === action.offerId);
      if (!offer || !state.dice.some(die => die.id === action.dieId)) return 'Choose an available Flame and a physical die.';
      if (hasOwnedFlame(state as GameState, offer.flame)) return 'That Flame type is already owned by this run.';
    }
    return null;
  }
  if (state.phase !== 'shop' || !state.shop) return 'This action requires an open shop.';
  if (action.type === 'BUY') {
    const offer = state.shop.offers.find(item => item.id === action.offerId);
    const die = state.dice.find(item => item.id === action.dieId);
    if (!offer || offer.purchased || !die) return 'Choose an available offer and a physical die.';
    if (state.gold < enhancementCost(offer.enhancement)) return 'Not enough gold for this enhancement.';
    return attachmentError(activeFace(die), offer.enhancement);
  }
  if (action.type === 'SELL_ENHANCEMENT') {
    const die = state.dice.find(item => item.id === action.dieId);
    if (!die || !Number.isInteger(action.face) || !stacks(die.faces[action.face - 1], action.enhancement)) return 'Choose an enhancement that exists on that physical face.';
  }
  if (action.type === 'RESTORE_LIFE') {
    if (state.lives >= CONFIG.maxLives) return 'All lives are already restored.';
    if (state.gold < lifeRestoreCost(state.livesPurchasedThisRun)) return 'Not enough gold to restore a life.';
  }
  if (action.type === 'TRAIN_HAND') {
    const offer = state.shop.trainingOffers.find(item => item.hand === action.hand);
    if (!offer || offer.purchased) return 'Choose an available hand training offer.';
    if (state.gold < CONFIG.handTrainingCost) return 'Not enough gold to train this hand.';
  }
  if (action.type === 'REROLL_DICE' && state.gold < diceRerollCost(state.shop.diceRerolls)) return 'Not enough gold to reroll the shop dice.';
  if (action.type === 'REROLL_OFFERS' && state.gold < offerRerollCost(state.shop.offerRerolls)) return 'Not enough gold to reroll enhancements.';
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
    score: 0, gold: CONFIG.startingGold, lives: CONFIG.maxLives, livesPurchasedThisRun: 0, roundAttemptNumber: 1,
    bust: null, flameTutorial: { pendingDieId: null, completed: false }, dice: createDice(), bonfires: [], chargeXMult: 1,
    chargeArmed: false, hotStreakGoal: null, hotStreakCharges: 0, lifetimeNormalShopGoldSpent: 0, consumed: [], shop: null,
    handLevels: initialHandLevels(), handPlayCounts: initialHandPlayCounts(), targetPracticeHand: null,
    scoreByHand: {}, effectScore: 0, lastRoundPayout: null, flameReward: null,
    manualRerollsRemaining: CONFIG.manualRerollsPerRound, nextOfferId: 0, stats: createStats(seed), history: [], roundCheckpoint: null,
  };
  return execute(state, resolver => resolver.startRound(), random, random ? undefined : attemptSeed(seed, 1, 1));
}

export function dispatch(state: GameState, action: Action, random?: RandomSource): Resolution {
  const normalized = normalizedState(state);
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
      case 'PLAY': resolver.play(action.hand, action.dieIds); break;
      case 'MANUAL_REROLL': resolver.manualReroll(action.dieIds); break;
      case 'TOGGLE_CHARGE':
        next.chargeArmed = !next.chargeArmed;
        if (next.chargeArmed) next.stats.chargeArmed++;
        resolver.emit({ type: 'CHARGE_ARMED', flame: 'charge', xMult: next.chargeXMult,
          message: `Charge ${next.chargeArmed ? `armed at ×${resolver.format(next.chargeXMult)}` : 'disarmed'}` });
        break;
      case 'BUY': {
        const offer = next.shop!.offers.find(item => item.id === action.offerId)!;
        const die = next.dice[action.dieId];
        const face = activeFace(die);
        const cost = enhancementCost(offer.enhancement);
        resolver.spendGold(cost, `Bought ${ENHANCEMENTS[offer.enhancement].name}: −${cost} gold`, 'enhancement');
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
        resolver.addGold(totalProceeds, `Sold ${definition.name} ×${stacksSold}: +${totalProceeds} Gold`, 'enhancementSale', die.id, action.enhancement, face.rank);
        next.stats.sales.push({ round: next.round, enhancement: action.enhancement, dieId: die.id, face: face.rank, stacksSold,
          baseSellPrice: definition.baseSellPrice, totalProceeds, goldBefore, goldAfter: next.gold, vintageSellValue });
        resolver.emit({ type: 'ENHANCEMENT_SOLD', enhancement: action.enhancement, dieIds: [die.id], face: face.rank,
          amount: totalProceeds, message: `Sold all ${stacksSold} ${definition.name} stack${stacksSold === 1 ? '' : 's'} from D${die.id + 1} face ${face.rank} for ${totalProceeds} Gold` });
        break;
      }
      case 'CHOOSE_FLAME': {
        const offer = next.flameReward!.offers.find(item => item.id === action.offerId)!;
        const die = next.dice[action.dieId];
        const replaced = activeFlameId(die.flame);
        const firstFlame = next.stats.flameAcquisitions.length === 0;
        die.flame = { id: offer.flame, investedGold: 0 };
        next.flameReward!.acquired = true;
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
        resolver.spendGold(action.amount, `Stoked ${FLAMES[flame.id].name}: −${action.amount} Gold (Shop)`, 'flameInvestment');
        flame.investedGold += action.amount;
        next.stats.flameStokes.push({ round: next.round, dieId: die.id, flame: flame.id, amount: action.amount,
          from, total: flame.investedGold, source });
        next.stats.totalFlameInvestment += action.amount;
        resolver.emit({ type: 'FLAME_INVESTED', flame: flame.id, dieIds: [die.id], amount: action.amount,
          message: `Stoked ${FLAMES[flame.id].name}: ${from} → ${flame.investedGold} / 100 · ${flameEffectText(flame.id, flame.investedGold, next)}` });
        if (flame.investedGold === 100) {
          const id = flame.id;
          die.flame = null;
          if (!next.bonfires.includes(id)) next.bonfires.push(id);
          next.stats.bonfiresCreated.push({ round: next.round, flame: id });
          resolver.emit({ type: 'BONFIRE_CREATED', flame: id, dieIds: [die.id],
            message: `${FLAMES[id].name} became a Bonfire and detached from D${die.id + 1}` });
        }
        break;
      }
      case 'CONTINUE_FLAME_REWARD':
        if (!next.flameReward!.acquired) {
          next.stats.flameSkips.push(next.round);
          resolver.emit({ type: 'FLAME_SKIPPED', message: `Skipped Flame acquisition for round ${next.round}` });
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
        const offer = next.shop!.trainingOffers.find(item => item.hand === action.hand)!;
        const fromLevel = next.handLevels[action.hand];
        const toLevel = fromLevel + 1;
        resolver.spendGold(CONFIG.handTrainingCost, `Trained ${HANDS[action.hand].name} to level ${toLevel}: −${CONFIG.handTrainingCost} gold`, 'handTraining');
        next.handLevels[action.hand] = toLevel;
        offer.purchased = true;
        next.stats.trainingPurchases.push({ round: next.round, hand: action.hand, fromLevel, toLevel, cost: CONFIG.handTrainingCost });
        next.stats.trainingPurchasesTotal++;
        next.stats.trainingGoldSpent += CONFIG.handTrainingCost;
        resolver.emit({ type: 'TRAINING_PURCHASED', hand: action.hand, goldSpendSource: 'handTraining', message: `${HANDS[action.hand].name} trained to level ${toLevel}` });
        break;
      }
      case 'RESTORE_LIFE': {
        const purchaseNumber = next.livesPurchasedThisRun + 1;
        const cost = lifeRestoreCost(next.livesPurchasedThisRun);
        const goldBefore = next.gold;
        const livesBefore = next.lives;
        const lifetimeSpendBefore = next.lifetimeNormalShopGoldSpent;
        resolver.spendGold(cost, `Restored life #${purchaseNumber}: −${cost} Gold`, 'lifeRestore');
        next.lives++;
        next.livesPurchasedThisRun++;
        next.stats.lifeRestores.push({ round: next.round, purchaseNumber, cost, goldBefore, goldAfter: next.gold,
          livesBefore, livesAfter: next.lives, lifetimeSpendBefore, lifetimeSpendAfter: next.lifetimeNormalShopGoldSpent });
        resolver.emit({ type: 'LIFE_RESTORED', amount: cost,
          message: `Restore #${purchaseNumber}: ${cost} Gold · lives ${livesBefore} → ${next.lives} · lifetime shop spend +${cost}` });
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
