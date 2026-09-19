import { CONFIG, diceRerollCost, flameRerollCost, offerRerollCost } from './config';
import { activeFace, createDice } from './dice';
import { Resolver } from './effects';
import { canAttach, enhancementCost, ENHANCEMENTS } from './enhancements';
import { FLAMES } from './flames';
import { HANDS, initialHandLevels, initialHandPlayCounts, isValidSelection } from './hands';
import { hashSeed, SeededRng } from './rng';
import { boardSnapshot, createStats } from './telemetry';
import type { Action, Board, GameState, RandomSource, Resolution } from './types';

export function validateAction(state: Board, action: Action): string | null {
  if (action.type === 'MANUAL_REROLL') {
    if (state.phase !== 'round') return 'Manual rerolls can only be used during a gameplay round.';
    if (!action.dieIds.length) return 'Select at least one die to reroll.';
    if (new Set(action.dieIds).size !== action.dieIds.length
      || action.dieIds.some(id => !Number.isInteger(id) || !state.dice.some(die => die.id === id))) {
      return 'Select distinct physical dice that are on the board.';
    }
    if (action.dieIds.length > state.manualRerollsRemaining) return 'Not enough manual rerolls for these dice.';
    return null;
  }
  if (action.type === 'PLAY') {
    if (state.phase !== 'round') return 'Hands can only be played during a round.';
    if (state.consumed.includes(action.hand)) return 'That hand has already been consumed.';
    if (!isValidSelection(state.dice, action.hand, action.dieIds)) return 'Select a complete valid set of participating dice.';
    return null;
  }
  if (action.type === 'CHOOSE_FLAME' || action.type === 'REROLL_FLAMES') {
    if (state.phase !== 'flameReward' || !state.flameReward) return 'This action requires an open Flame Reward.';
    if (action.type === 'CHOOSE_FLAME') {
      if (!state.flameReward.offers.some(offer => offer.id === action.offerId) || !state.dice.some(die => die.id === action.dieId)) {
        return 'Choose an available Flame and a physical die.';
      }
    } else if (state.gold < flameRerollCost(state.flameReward.offerRerolls)) return 'Not enough gold to reroll Flame offers.';
    return null;
  }
  if (state.phase !== 'shop' || !state.shop) return 'This action requires an open shop.';
  if (action.type === 'BUY') {
    const offer = state.shop.offers.find(item => item.id === action.offerId);
    const die = state.dice.find(item => item.id === action.dieId);
    if (!offer || offer.purchased || !die) return 'Choose an available offer and a physical die.';
    if (state.gold < enhancementCost(offer.enhancement)) return 'Not enough gold for this enhancement.';
    if (!canAttach(activeFace(die), offer.enhancement)) return `${ENHANCEMENTS[offer.enhancement].name} is already on this physical face.`;
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

function execute(state: GameState, run: (resolver: Resolver) => void, random?: RandomSource): Resolution {
  const next = structuredClone(state);
  const seeded = new SeededRng(next.rngState);
  const resolver = new Resolver(next, random ?? seeded);
  try {
    run(resolver);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Roll Call engine] ${message}`);
    next.phase = 'error';
    next.stats.resolutionError = message;
    // A diagnostic stop preserves the trace and permits restart instead of freezing.
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
    score: 0, gold: CONFIG.startingGold, dice: createDice(), consumed: [], shop: null,
    handLevels: initialHandLevels(), handPlayCounts: initialHandPlayCounts(),
    bonusHandUses: {}, doubleEncoreUsedDieIds: [], targetPracticeHand: null,
    scoreByHand: {}, effectScore: 0,
    flameReward: null,
    manualRerollsRemaining: CONFIG.manualRerollsPerRound,
    nextOfferId: 0, stats: createStats(seed), history: [],
  };
  return execute(state, resolver => resolver.startRound(), random);
}

export function dispatch(state: GameState, action: Action, random?: RandomSource): Resolution {
  const error = validateAction(state, action);
  if (error) return { state, events: [], error };
  return execute(state, resolver => {
    const next = resolver.state;
    next.stats.actions.push(structuredClone(action));
    switch (action.type) {
      case 'PLAY': resolver.play(action.hand, action.dieIds); break;
      case 'MANUAL_REROLL': resolver.manualReroll(action.dieIds); break;
      case 'BUY': {
        const offer = next.shop!.offers.find(item => item.id === action.offerId)!;
        const die = next.dice[action.dieId];
        const face = activeFace(die);
        const cost = enhancementCost(offer.enhancement);
        resolver.spendGold(cost, `Bought ${ENHANCEMENTS[offer.enhancement].name}: −${cost} gold`, 'enhancement');
        const stacksApplied = die.flame === 'tripleUp' && ENHANCEMENTS[offer.enhancement].stackable ? 3 : 1;
        face.enhancements[offer.enhancement] = (face.enhancements[offer.enhancement] ?? 0) + stacksApplied;
        if (stacksApplied === 3) resolver.triggerFlame('tripleUp', die.id, `${ENHANCEMENTS[offer.enhancement].name} applied as 3 stacks`);
        offer.purchased = true;
        next.stats.purchases.push({ round: next.round, enhancement: offer.enhancement, dieId: die.id, face: face.rank, cost, stacksApplied });
        const key = `D${die.id + 1}:${face.rank}`;
        if (!next.stats.enhancedFaces.includes(key)) next.stats.enhancedFaces.push(key);
        resolver.emit({ type: 'OFFER_PURCHASED', enhancement: offer.enhancement, dieIds: [die.id], face: face.rank,
          message: `${ENHANCEMENTS[offer.enhancement].name} x${stacksApplied} attached to D${die.id + 1}, physical face ${face.rank}${stacksApplied === 3 ? ' by Triple-Up' : ''}` });
        break;
      }
      case 'CHOOSE_FLAME': {
        const offer = next.flameReward!.offers.find(item => item.id === action.offerId)!;
        const die = next.dice[action.dieId];
        const replaced = die.flame;
        die.flame = offer.flame;
        next.stats.flameAcquisitions.push({ round: next.round, dieId: die.id, flame: offer.flame, replaced });
        resolver.emit({ type: replaced ? 'FLAME_REPLACED' : 'FLAME_ACQUIRED', flame: offer.flame, dieIds: [die.id],
          message: replaced
            ? `D${die.id + 1} replaced ${FLAMES[replaced].name} with ${FLAMES[offer.flame].name}`
            : `D${die.id + 1} acquired ${FLAMES[offer.flame].name}` });
        resolver.openShop(false);
        break;
      }
      case 'REROLL_FLAMES': {
        const cost = flameRerollCost(next.flameReward!.offerRerolls);
        resolver.spendGold(cost, `Paid for Flame offer reroll: −${cost} gold`, 'flameReroll');
        next.flameReward!.offerRerolls++;
        next.stats.flameOfferRerolls++;
        next.stats.flameRerollGoldSpent += cost;
        resolver.freshFlameOffers();
        resolver.emit({ type: 'FLAME_OFFERS_REFRESHED', message: 'Three fresh distinct Flame offers' });
        break;
      }
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
        next.stats.trainingPurchases.push({
          round: next.round,
          hand: action.hand,
          fromLevel,
          toLevel,
          cost: CONFIG.handTrainingCost,
        });
        next.stats.trainingPurchasesTotal++;
        next.stats.trainingGoldSpent += CONFIG.handTrainingCost;
        resolver.emit({
          type: 'TRAINING_PURCHASED',
          hand: action.hand,
          goldSpendSource: 'handTraining',
          message: `${HANDS[action.hand].name} trained to level ${toLevel}`,
        });
        break;
      }
      case 'NEXT_ROUND': next.round++; resolver.startRound(); break;
    }
  }, random);
}
