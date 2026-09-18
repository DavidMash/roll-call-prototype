import { CONFIG, diceRerollCost, offerRerollCost } from './config';
import { activeFace, createDice } from './dice';
import { Resolver } from './effects';
import { canAttach, enhancementCost, ENHANCEMENTS } from './enhancements';
import { isValidSelection } from './hands';
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
  if (state.phase !== 'shop' || !state.shop) return 'This action requires an open shop.';
  if (action.type === 'BUY') {
    const offer = state.shop.offers.find(item => item.id === action.offerId);
    const die = state.dice.find(item => item.id === action.dieId);
    if (!offer || offer.purchased || !die) return 'Choose an available offer and a physical die.';
    if (state.gold < enhancementCost(offer.enhancement)) return 'Not enough gold for this enhancement.';
    if (!canAttach(activeFace(die), offer.enhancement)) return `${ENHANCEMENTS[offer.enhancement].name} is already on this physical face.`;
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
        resolver.spendGold(cost, `Bought ${ENHANCEMENTS[offer.enhancement].name}: −${cost} gold`);
        face.enhancements[offer.enhancement] = (face.enhancements[offer.enhancement] ?? 0) + 1;
        offer.purchased = true;
        next.stats.purchases.push({ round: next.round, enhancement: offer.enhancement, dieId: die.id, face: face.rank, cost });
        const key = `D${die.id + 1}:${face.rank}`;
        if (!next.stats.enhancedFaces.includes(key)) next.stats.enhancedFaces.push(key);
        resolver.emit({ type: 'OFFER_PURCHASED', enhancement: offer.enhancement, dieIds: [die.id], face: face.rank,
          message: `${ENHANCEMENTS[offer.enhancement].name} attached to D${die.id + 1}, physical face ${face.rank}` });
        break;
      }
      case 'REROLL_DICE':
        resolver.spendGold(diceRerollCost(next.shop!.diceRerolls), 'Paid for shop dice reroll');
        next.shop!.diceRerolls++;
        next.stats.shopDiceRerolls++;
        resolver.rollBatch(next.dice.map(die => die.id), 'Shop dice reroll', false);
        break;
      case 'REROLL_OFFERS':
        resolver.spendGold(offerRerollCost(next.shop!.offerRerolls), 'Paid for enhancement reroll');
        next.shop!.offerRerolls++;
        next.stats.enhancementShopRerolls++;
        resolver.freshOffers();
        resolver.emit({ type: 'OFFERS_REFRESHED', message: 'Three fresh distinct enhancement offers' });
        break;
      case 'NEXT_ROUND': next.round++; resolver.startRound(); break;
    }
  }, random);
}
