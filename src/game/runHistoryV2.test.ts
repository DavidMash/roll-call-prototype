import { describe, expect, it } from 'vitest';
import { activeFace } from './dice';
import { dispatch, newRun, validateAction } from './engine';
import { HAND_IDS, handOptions } from './hands';
import { handScore } from './scoring';
import { renderHandScoredV2, renderRunHistoryV2 } from './runHistoryV2Renderer';
import { createRunHistoryTextV2 } from './runHistoryV2Export';
import { summarizeRunHistoryV2 } from './runHistoryV2Summary';
import type { HandScoredEvent, RollBatchEvent } from './runHistoryV2';
import type { Enhancement, GameState, RandomSource, Rank } from './types';
import { DEBUG_TRACE_MAX_RECORDS } from './debugTrace';
import { compactGameStateForPersistence } from './persistence';

const constant = (value = 0): RandomSource => ({ next: () => value });
const sequence = (...values: number[]): RandomSource => { let index = 0; return { next: () => values[index++] ?? 0 }; };

function game(values: Rank[] = [1, 2, 3, 4, 5], seed = 'history-v2'): GameState {
  const state = newRun(seed, constant()).state;
  state.dice.forEach((die, index) => { die.value = values[index]; });
  state.target = 1_000_000;
  state.stats.rounds[0].target = state.target;
  return state;
}

function enhance(state: GameState, dieId: number, enhancement: Enhancement, stacks = 1, rank?: Rank): void {
  const face = state.dice[dieId].faces[(rank ?? state.dice[dieId].value) - 1];
  face.enhancements[enhancement] = stacks;
  if (enhancement === 'vintage') face.vintageSellValue = 0;
}

const handEvents = (state: GameState) => state.historyV2.filter((event): event is HandScoredEvent => event.kind === 'hand_scored');
const rollEvents = (state: GameState) => state.historyV2.filter((event): event is RollBatchEvent => event.kind === 'roll_batch');

function forceBust(state: GameState): GameState {
  state.dice.forEach((die, index) => { die.value = ([1, 2, 2, 4, 5] as Rank[])[index]; });
  state.target = 1_000_000;
  state.stats.rounds.at(-1)!.target = state.target;
  state.manualRerollsRemaining = 0;
  state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
  return dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant()).state;
}

describe('Run History V2 hand scoring', () => {
  it('emits one complete simple hand event that reconciles with the authoritative score', () => {
    const state = game([2, 2, 3, 4, 5]);
    const result = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant());
    const event = handEvents(result.state).at(-1)!;
    const legacy = result.state.stats.handScores.at(-1)!;

    expect(event).toMatchObject({
      kind: 'hand_scored', hand: 'pair', level: 1, playSource: 'manual', consumed: true,
      score: { basePips: legacy.basePips, finalPips: legacy.pips, baseMult: legacy.baseMultiplier,
        finalMult: legacy.multiplier, finalXMult: legacy.xMult, bossFactor: legacy.bossFactor,
        raw: legacy.rawScore, awarded: legacy.score, rounding: { mode: 'nearest_integer' } },
      roundScore: { before: 0, afterAward: legacy.score, after: legacy.score },
    });
    expect(event.selectedDice).toEqual([0, 1]);
    expect(event.scoringDice.map(die => die.dieId)).toEqual([0, 1]);
    expect(event.pipsContributions.map(item => item.amount).reduce((sum, amount) => sum + amount, 0)).toBe(event.score.finalPips);
    expect(renderHandScoredV2(event)).toBe('PLAY · Pair Lv1 · 12 Pips × 1.5 Mult × 1 XMult = 18');
  });

  it('captures Pips, Mult, checks, side effects, and explicit Ember/Bonfire/Wildfire/Charge/Boss origins', () => {
    const state = game([4, 4, 4, 4, 4]);
    enhance(state, 0, 'vintage');
    enhance(state, 0, 'bonus');
    enhance(state, 0, 'teamwork');
    enhance(state, 0, 'tank');
    enhance(state, 1, 'loneWolf');
    enhance(state, 2, 'workout');
    enhance(state, 3, 'golden');
    enhance(state, 4, 'doubleTime');
    state.dice[0].flame = { id: 'vineyard', investedGold: 50 };
    state.bonfires = ['lowball', 'momentum'];
    state.wildfires = [{ flame: 'boxSet', sacrificedFlame: 'minigun', sacrificedAverage: 5,
      transferMultiplier: 10, resolved: { kind: 'xMult', baseMax: 9, max: 90 } }];
    state.handFamilyFlameStages.boxSet = 'payoff';
    state.chargeXMult = 3;
    state.chargeArmed = true;
    state.boss = { type: 'fly', flyHand: 'ones', caught: false, moves: 0 };

    const result = dispatch(state, { type: 'PLAY', hand: 'fiveKind', dieIds: [0, 1, 2, 3, 4] }, constant());
    const event = handEvents(result.state).at(-1)!;
    expect(event.pipsContributions.map(item => item.source)).toEqual(expect.arrayContaining(['bonus', 'teamwork']));
    expect(event.multContributions.some(item => item.source === 'tank')).toBe(true);
    expect(event.checks).toContainEqual(expect.objectContaining({ source: 'doubleTime', succeeded: true }));
    expect(event.sideEffects.map(effect => effect.type)).toEqual(expect.arrayContaining([
      'vintage_growth', 'workout', 'gold', 'double_time', 'charge',
    ]));
    expect(event.xMultContributions.map(item => [item.sourceId, item.origin])).toEqual([
      ['charge', 'charge'], ['lowball', 'bonfire'], ['boxSet', 'wildfire'], ['vineyard', 'ember'], ['fly', 'boss'],
    ]);
    expect(event.score.awarded).toBe(result.state.stats.handScores.at(-1)!.score);
    const rendered = renderHandScoredV2(event);
    expect(rendered).toContain('Ember D1 Vineyard ×3');
    expect(rendered).toContain('Bonfire Lowball ×3');
    expect(rendered).toContain('Wildfire Box Set ×90');
    expect(rendered).toContain('Charge ×3');
    expect(rendered).toContain('Boss fly ×0.5');
    expect(rendered).not.toContain('Bonfire Box Set');
    expect(rendered).toContain('Workout');
    expect(rendered).toMatchInlineSnapshot(`
      "PLAY · Five of a Kind Lv1
      Dice: D1=14, D2=4, D3=4, D4=4, D5=4
      Pips: 15 → 65 [D1 Bonus +10, D1 Teamwork +16]
      Mult: 5 → 7.5 [Tank D1 ×1.5]
      XMult: 1 → 1,215 [Charge ×3, Bonfire Lowball ×3, Wildfire Box Set ×90, Ember D1 Vineyard ×3, Boss fly ×0.5]
      Score: 592,313
      Other: D1 Vintage 0→3 · D3 Workout 4→5 · D4 Golden +1 Gold · D5 Double Time succeeded · Charge Consume Reset ×3→×1 · Bonfire Momentum · Charge Gain ×1→×1.5 · Fly BOSS HAND CHANGED · Double Time 50% ✓"
    `);

    const loneWolf = game([4, 2, 3, 5, 6]);
    enhance(loneWolf, 0, 'loneWolf');
    const loneEvent = handEvents(dispatch(loneWolf, { type: 'PLAY', hand: 'fours', dieIds: [0] }, constant()).state).at(-1)!;
    expect(loneEvent.pipsContributions.some(item => item.source === 'lone_wolf')).toBe(true);
  });

  it('keeps Jumping Bean free plays separate and linked to their triggering roll batch', () => {
    const state = game([1, 2, 3, 4, 5]);
    enhance(state, 0, 'jumpingBean', 1, 6);
    enhance(state, 0, 'sticky', 1, 6);
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0] }, sequence(.99, 0));
    const freePlay = handEvents(result.state).find(event => event.playSource === 'jumpingBean')!;
    const triggeringRoll = rollEvents(result.state).find(event => event.reason === 'manual')!;
    expect(freePlay).toBeDefined();
    expect(freePlay.parentSeq).toBe(triggeringRoll.seq);
    expect(freePlay.consumed).toBe(false);
    expect(result.state.consumed).not.toContain('sixes');
  });
});

describe('Run History V2 roll batches', () => {
  it('groups manual results and preserves exclusion, spend, Magnetic, Bump, and Weighted metadata', () => {
    const state = game([1, 2, 3, 4, 5]);
    enhance(state, 0, 'bump');
    enhance(state, 1, 'magnetic');
    enhance(state, 2, 'magnetic', 1, 6);
    enhance(state, 3, 'weighted', 2, 6);
    const result = dispatch(state, { type: 'MANUAL_REROLL', dieIds: [0, 2, 3] }, constant());
    const roll = rollEvents(result.state).at(-1)!;

    expect(roll).toMatchObject({ kind: 'roll_batch', reason: 'manual', context: 'gameplay',
      dieIds: [0, 2, 3], heldDieIds: [1], spend: { normalCharges: 3, carePackageCharges: 0, remaining: 0 } });
    expect(roll.results.find(item => item.dieId === 0)?.bump).toEqual({ source: 'enhancement' });
    expect(roll.results.find(item => item.dieId === 2)?.magneticAnchorIds).toEqual([1]);
    expect(roll.results.find(item => item.dieId === 3)?.weighted).toMatchObject({ sourceFace: 6, stacks: 2 });
    expect(roll.results.every(item => item.previousFaceExcluded || item.bump !== null)).toBe(true);
    expect(renderRunHistoryV2([roll])).toContain('ROLL · manual');
  });

  it('keeps automatic post-hand rolls and Warden unlock state structured without changing playback', () => {
    const state = game([1, 2, 3, 4, 5]);
    const played = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant());
    expect(rollEvents(played.state).some(event => event.reason === 'post_hand')).toBe(true);
    expect(played.events.some(event => event.type === 'DICE_REROLL_STARTED')).toBe(true);
    expect(played.events.some(event => event.type === 'DIE_ROLLED')).toBe(true);

    const warden = game();
    warden.boss = { type: 'warden', activeDieIds: [0], startingDieId: 0, nextUnlockTarget: 5,
      unlockCosts: [5, 10, 25, 60], unlockTargets: [5], pendingReinforcements: 1 };
    const unlocked = dispatch(warden, { type: 'UNLOCK_WARDEN_DIE', dieId: 1 }, constant());
    expect(unlocked.state.historyV2.some(event => event.kind === 'boss_state_changed'
      && event.boss === 'warden' && event.change === 'warden_unlock' && event.dieIds.includes(1))).toBe(true);
    expect(unlocked.events.some(event => event.type === 'DIE_ROLLED')).toBe(false);
  });
});

describe('Run History V2 lifecycle, timeline, renderer, and summary', () => {
  it('records scorecard refresh, Shop/Flame transactions, Bonfire creation, and life restoration', () => {
    const state = game();
    state.consumed = HAND_IDS.filter(hand => hand !== 'ones');
    state.scorecardCycleConsumed = [...state.consumed];
    activeFace(state.dice[0]).enhancements.sticky = 1;
    let current = dispatch(state, { type: 'PLAY', hand: 'ones', dieIds: [0] }, constant()).state;
    expect(current.historyV2.some(event => event.kind === 'scorecard_refreshed')).toBe(true);

    current.phase = 'shop'; current.gold = 200; current.lives = 2;
    current.shop = { kind: 'between_rounds', offers: [{ id: 501, enhancement: 'bonus', purchased: false }],
      trainingOffers: [{ kind: 'hand', hand: 'pair', purchases: 0 }], diceRerolls: 0, offerRerolls: 0,
      lifeRestores: 0, freeEnhancementOfferIds: [], freeTrainingOfferKeys: [] };
    current = dispatch(current, { type: 'BUY', offerId: 501, dieId: 0 }, constant()).state;
    current = dispatch(current, { type: 'TRAIN_HAND', hand: 'pair' }, constant()).state;
    current = dispatch(current, { type: 'RESTORE_LIFE' }, constant()).state;
    current.dice[0].flame = { id: 'ultimate', investedGold: 99 };
    current = dispatch(current, { type: 'STOKE_FLAME', dieId: 0, amount: 1 }, constant()).state;
    expect(current.historyV2.some(event => event.kind === 'shop_transaction'
      && event.transaction.type === 'enhancement_purchased')).toBe(true);
    expect(current.historyV2.some(event => event.kind === 'shop_transaction'
      && event.transaction.type === 'training')).toBe(true);
    expect(current.historyV2.some(event => event.kind === 'shop_transaction'
      && event.transaction.type === 'life_restored')).toBe(true);
    expect(current.historyV2.some(event => event.kind === 'flame_changed'
      && event.change.type === 'bonfire_created')).toBe(true);
  });

  it('records Hooded/Wildfire conversion and explicit sacrifice data', () => {
    const state = game();
    state.bonfires = ['ultimate', 'minigun', 'hailMary', 'fullOfGrace', 'vineyard'];
    state.bonfireContributions.vineyard = { roundCount: 1, factorSum: 5 };
    state.phase = 'hoodedFigure';
    state.hoodedFigure.interaction = { kind: 'return', stage: 'confirm', lines: [], lineIndex: 0,
      recipient: 'ultimate', sacrifice: 'vineyard' };
    const result = dispatch(state, { type: 'CONFIRM_WILDFIRE' }, constant(.2));
    expect(result.state.historyV2).toContainEqual(expect.objectContaining({ kind: 'flame_changed', change: expect.objectContaining({
      type: 'wildfire_created', flame: 'ultimate', sacrificedFlame: 'vineyard',
    }) }));
  });

  it('keeps experienced rollback activity and starts a new timeline for Bust, Bad Dream, and Time Travel', () => {
    let busted = forceBust(game());
    const bustRestore = busted.historyV2.find(event => event.kind === 'checkpoint_restored' && event.reason === 'bust');
    expect(bustRestore).toMatchObject({ fromTimelineId: 0, toTimelineId: 1 });
    expect(new Set(busted.historyV2.map(event => event.timelineId))).toEqual(new Set([0, 1]));
    busted = dispatch(busted, { type: 'RETRY_ROUND' }, constant()).state;
    expect(busted.historyV2.some(event => event.kind === 'round_attempt_started' && event.attempt === 2 && event.timelineId === 1)).toBe(true);

    let dream = game();
    dream.phase = 'specialOffer';
    dream.specialOffer = { offers: [{ id: 700, type: 'badDream' }], acquired: false };
    dream = dispatch(dream, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 700 }, constant()).state;
    dream = dispatch(dream, { type: 'CONTINUE_SPECIAL_OFFER' }, constant()).state;
    dream = dispatch(dream, { type: 'NEXT_ROUND' }, constant()).state;
    dream.lives = 1;
    dream = forceBust(dream);
    expect(dream.historyV2.some(event => event.kind === 'checkpoint_restored' && event.reason === 'bad_dream')).toBe(true);
    expect(summarizeRunHistoryV2(dream.historyV2, dream).timelines.abandonedRanges)
      .toContainEqual(expect.objectContaining({ reason: 'bad_dream' }));
    expect(dream.phase).toBe('specialOffer');

    let travel = game();
    travel.round = 9; travel.phase = 'specialOffer'; travel.presentedChapters = [1, 2];
    travel.specialOffer = { offers: [{ id: 701, type: 'timeTravel' }], acquired: false };
    travel = dispatch(travel, { type: 'CHOOSE_SPECIAL_OFFER', offerId: 701 }, constant()).state;
    expect(travel.round).toBe(7);
    expect(travel.historyV2.some(event => event.kind === 'checkpoint_restored' && event.reason === 'time_travel')).toBe(true);
    expect(summarizeRunHistoryV2(travel.historyV2, travel).timelines.abandonedRanges)
      .toContainEqual(expect.objectContaining({ reason: 'time_travel', canonicalRound: 7 }));
  });

  it('derives representative high-value metrics and reconciles scoring/economy with RunStats', () => {
    const state = game([2, 2, 3, 4, 5]);
    state.target = 1; state.stats.rounds[0].target = 1;
    enhance(state, 0, 'golden');
    const cleared = dispatch(state, { type: 'PLAY', hand: 'pair', dieIds: [0, 1] }, constant()).state;
    const shop = dispatch(cleared, { type: 'CONTINUE_ROUND_SUMMARY' }, constant()).state;
    const summary = summarizeRunHistoryV2(shop.historyV2, shop);
    expect(summary.identity.seed).toBe(state.seed);
    expect(summary.canonical.roundsCleared).toBe(shop.stats.rounds.filter(round => round.cleared).length);
    expect(summary.experienced.handUsage.pair).toBe(shop.handPlayCounts.pair);
    expect(summary.experienced.scoreByHand.pair).toBe(shop.scoreByHand.pair);
    expect(summary.experienced.goldEarnedBySource.golden).toBe(shop.stats.goldBySource.golden);
    expect(summary.experienced.goldEarnedBySource.roundBase).toBe(shop.stats.goldBySource.roundBase);
    expect(summary.experienced.offerImpressions.enhancement.total).toBe(3);
    expect(summary.experienced.largestHand?.score).toBe(shop.stats.handScores.at(-1)?.score);
  });

  it('emits run completion without losing the final failed attempt', () => {
    const state = game(); state.lives = 1;
    const lost = forceBust(state);
    expect(lost.phase).toBe('lost');
    expect(lost.historyV2.at(-1)).toMatchObject({ kind: 'run_finished', outcome: 'lost' });
    expect(summarizeRunHistoryV2(lost.historyV2, lost).canonical.outcome).toBe('lost');
  });
});

describe('Run History V2 instrumentation safety and size', () => {
  it('does not change seeded state or playback events when V2 retention is disabled', () => {
    let instrumented = newRun('v2-seeded-parity').state;
    let control = structuredClone(instrumented);
    const actions = [
      { type: 'MANUAL_REROLL' as const, dieIds: [0] },
      { type: 'PLAY' as const, hand: 'ones' as const, dieIds: [0] },
    ];
    for (const action of actions) {
      const withV2 = dispatch(instrumented, action);
      const withoutV2 = dispatch(control, action, undefined, { disableHistoryV2: true });
      expect(withV2.events).toEqual(withoutV2.events);
      instrumented = withV2.state; control = withoutV2.state;
      const strip = ({ historyV2: _historyV2, ...state }: GameState) => state;
      expect(strip(instrumented)).toEqual(strip(control));
    }
  });

  it('keeps the controlled 60-Round V2 stream smaller than equivalent legacy history', () => {
    let state = newRun('v2-long-run-size').state;
    let steps = 0;
    while (state.round <= 60 && state.phase !== 'lost' && state.phase !== 'error' && steps < 3_000) {
      let action: Parameters<typeof dispatch>[1];
      if (state.phase === 'round') {
        state.target = 1; state.stats.rounds.at(-1)!.target = 1;
        if (!state.bossSilenced && state.boss?.type === 'warden' && state.boss.pendingReinforcements > 0) {
          const activeDieIds = state.boss.activeDieIds;
          const locked = state.dice.find(die => !activeDieIds.includes(die.id))!;
          action = { type: 'UNLOCK_WARDEN_DIE', dieId: locked.id };
        } else {
          const choices = handOptions(state.dice, state.consumed).filter(option => !option.consumed)
            .flatMap(option => option.combinations.map(dieIds => ({ hand: option.id, dieIds,
              score: handScore(state.dice, option.id, dieIds).score }))).sort((a, b) => b.score - a.score);
          action = choices.map(choice => ({ type: 'PLAY' as const, hand: choice.hand, dieIds: choice.dieIds }))
            .find(candidate => validateAction(state, candidate) === null) ?? { type: 'MANUAL_REROLL', dieIds: [0] };
        }
      } else if (state.phase === 'roundSummary') action = { type: 'CONTINUE_ROUND_SUMMARY' };
      else if (state.phase === 'flameSelection') action = state.flameSelection!.acquired
        ? { type: 'CONTINUE_FLAME_SELECTION' }
        : { type: 'CHOOSE_FLAME', offerId: state.flameSelection!.offers[0].id, dieId: 0 };
      else if (state.phase === 'specialOffer') action = state.specialOffer!.acquired
        ? { type: 'CONTINUE_SPECIAL_OFFER' }
        : { type: 'CHOOSE_SPECIAL_OFFER', offerId: state.specialOffer!.offers[0].id };
      else if (state.phase === 'hoodedFigure') action = state.hoodedFigure.interaction?.stage === 'story'
        ? { type: 'ADVANCE_HOODED_FIGURE' } : { type: 'WALK_AWAY_WILDFIRE' };
      else if (state.phase === 'shop') action = state.bust ? { type: 'RETRY_ROUND' }
        : state.shop?.kind === 'post_boss' ? { type: 'NEXT_CHAPTER' } : { type: 'NEXT_ROUND' };
      else if (state.phase === 'bust') action = { type: 'RETRY_ROUND' };
      else break;
      const result = dispatch(state, action);
      expect(result.error).toBeUndefined();
      state = result.state; steps++;
      if (state.round === 60 && state.phase !== 'round') break;
    }
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
    const sizes = {
      legacyHistory: bytes(state.history),
      v2History: bytes(state.historyV2),
      renderedV2: Buffer.byteLength(renderRunHistoryV2(state.historyV2)),
      normalExport: Buffer.byteLength(createRunHistoryTextV2(state)),
      debugTrace: bytes(state.debugTrace),
      runStats: bytes(state.stats),
      rollbackState: bytes(state.roundCheckpoint),
      actionJournal: bytes(state.actionJournal),
      persistedState: bytes(compactGameStateForPersistence(state)),
      fullState: bytes(state),
    };
    expect(state.round).toBe(60);
    expect(state.history).toEqual([]);
    expect(sizes.v2History).toBeLessThan(443_281);
    expect(sizes.renderedV2).toBeLessThan(sizes.v2History);
    expect(state.debugTrace.records).toHaveLength(DEBUG_TRACE_MAX_RECORDS);
    expect(state.debugTrace.droppedRecords).toBeGreaterThan(0);
    expect({ legacyEntries: state.history.length, v2Entries: state.historyV2.length, ...sizes }).toEqual({
      legacyEntries: 0, v2Entries: 656, legacyHistory: 2, v2History: 307_119,
      renderedV2: 32_503, normalExport: 38_362, debugTrace: 44_643,
      runStats: 75_054, rollbackState: 4_843, actionJournal: 7_954,
      persistedState: 368_071, fullState: 444_857,
    });
  }, 30_000);
});
