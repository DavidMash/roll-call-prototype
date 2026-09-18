# Roll Call

A playable single-player roguelike dice prototype for gameplay validation. React, TypeScript, Vite, Mantine, and Vitest; everything runs locally in browser memory.

## Run

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. On Windows PowerShell with script execution disabled, use `npm.cmd` instead of `npm`.

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
```

The browser tests use Playwright with installed Google Chrome. If Chrome is unavailable, install it with `npx playwright install chrome`, or change `channel` in `playwright.config.ts` to an installed browser. Browser tests start and stop their own Vite server.

## Playing

- The persistent scorecard shows all 14 categories for the entire round. Playable rows are active, currently impossible rows are muted, the selected row is highlighted, and consumed rows remain visible and disabled with their earned score.
- Choose a scorecard row to select a deterministic participating set, or click dice first to constrain which rows are actionable. Press **PLAY** to resolve it; selecting a row never scores immediately.
- A row's score is the cumulative round score actually earned through that category. If Sustainable preserves a category, its row remains available and later awards are added to the same value. **Effect Score** separately totals standalone scoring such as Jumping Bean, so hand rows plus Effect Score reconcile to Round Total.
- Upper-section hands may contain any non-empty subset of dice currently showing that number. Clicking the hand initially selects all matching dice, but the player may deselect individual matching dice before pressing Play. A dice-first matching subset is preserved when choosing its upper hand.
- This lets the player preserve useful board structure—for example, keeping one duplicate 4 while rerolling another to pursue a straight. The chosen subset determines normal hand contributions, participating Multiplier, Sustainable, and scored-die rerolls. Unselected Hitchhikers can contribute pips and trigger their own Golden/Workout; unselected dice can also act through Slippy or roll effects. The upper category is normally consumed after one play, regardless of subset size.
- For ambiguous lower hands, deselect a chosen die and select a replacement. Lower hands still require exactly their prescribed number of participants. The play button requires a valid participating set.
- Each round gives the player **3 manual die rerolls**. A manual reroll charge rerolls one selected physical die. Multiple dice may be rerolled at once by spending one charge per die; the same die can be rerolled again in a later action. Select dice and press **Reroll Selected — N**. No hand is required, and selections clear when the action starts.
- Manual rerolls are real gameplay rolls: Weighted, Magnetic, and Jumping Bean use the existing effect queue. Sticky cannot block the player-requested roll. Manual rolls do not play or consume a hand, activate Slippy/Sustainable/Hitchhiker, or grant direct hand points. Automatic initial rolls, hand rerolls, ability rerolls, and flips spend no manual charges and never replenish them.
- The player cannot lose while manual rerolls remain. If no hand can be played, the player must use their remaining rerolls before the run can end. Loss requires **below goal + no legal unconsumed hand on the complete board + zero manual rerolls**. The whole current chain finishes before clearance or loss; an effect chain reaching the goal clears the round even on the final charge. Categories and the manual budget reset at the beginning of each gameplay round, before initial effects.
- Clearing grants **5 gold on Round 1, increasing by 1 each round**, and opens a shop with three distinct enhancement offers, three distinct Hand Training offers, and a free roll of all five dice. Runs still begin with 0 gold; Golden income is separate from the round-clear reward.
- Every scoring hand starts at **Level 1**. A Hand Training card costs **4 gold** and permanently raises its named hand by one level for the current run. Any or all three cards may be purchased directly; they stay fixed for that shop and have no reroll action. A new run resets every hand to Level 1.
- Drag an offer onto a die, or click **Select or drag** then click a die. Only its exposed physical face receives the purchase. A purchased offer stays unavailable until a paid refresh.
- Shop dice rerolls cost 1/2/4/8… gold; offer refreshes cost 3/6/12/24… gold. Both reset every shop and are separate from manual gameplay rerolls. The shop does not display, spend, or reset manual rerolls. Leave with **NEXT ROUND** whenever you want.
- **NORMAL / FAST / INSTANT** and **Skip playback** affect only visualization. Rules have already resolved synchronously.
- Open **Inspect all physical faces** to review your 30 physical faces, enhancement stacks, and persistent Workout pips.
- Open **Run data & event history** to copy structured run statistics, the action sequence, current RNG state, and board; or copy the complete readable event log. Clipboard failure provides a manual-copy dialog.
- Seeds are visible and editable. Restart the same seed, enter a specific seed, or start with a new seed. URL parameters `?seed=example&speed=instant` are also supported. Restarting or reloading replaces the in-memory run.

All 14 enhancements are implemented: Bonus, Multiplier, Jumping Bean, Golden, Workout, Missing Link, Mirror, Magnetic, Sticky, Slippy, Sustainable, Hitchhiker, Weighted, and Jackpot. The in-app reference describes each.

Bonus, Multiplier, Golden, Workout, Weighted, and Jackpot are numerical stackers. Sticky and Sustainable are probability stackers. Jumping Bean, Missing Link, Mirror, Magnetic, Slippy, and Hitchhiker remain binary on each physical face. Stackable badges show one readable count such as **Sticky ×2** or **Jackpot ×3**.

Prototype balance uses a **50-point base target**, **1.35x target growth per round**, and the round-clear gold progression above. These values reflect early playtesting and are expected to continue changing. They live in `src/game/config.ts` for tuning.

## Scoring categories

There are **14 categories** and no Chance hand. Level 1 Base Pips now derive from starting multiplier as `5 + (2 × starting multiplier)`, rather than every hand receiving 10. Ones through Sixes use any non-empty selected natural matching subset.

| Hand | Participating dice | Level 1 Pips | Level 1 Mult | Pips / level | Mult / level |
| --- | --- | ---: | ---: | ---: | ---: |
| Ones–Sixes | Any non-empty matching subset | 7 | ×1 | +3 | +0.25 |
| Pair | Exactly 2 assignable to one rank | 8 | ×1.5 | +3 | +0.25 |
| Two Pair | Exactly 4 assignable to two distinct pairs | 9 | ×2 | +4 | +0.5 |
| Three of a Kind | Exactly 3 assignable to one rank | 10 | ×2.5 | +4 | +0.5 |
| Small Straight | Exactly 4 consecutive assigned ranks | 10 | ×2.5 | +4 | +0.5 |
| Full House | Exactly 5 assignable to distinct 3/2 rank groups | 12 | ×3.5 | +5 | +0.75 |
| Four of a Kind | Exactly 4 assignable to one rank | 13 | ×4 | +5 | +0.75 |
| Large Straight | Exactly 5 consecutive assigned ranks | 13 | ×4 | +5 | +0.75 |
| Five of a Kind | Exactly 5 assignable to one rank | 15 | ×5 | +6 | +1 |

Pips growth is the fixed value `round(Level 1 Base Pips × 0.40)`. Mult growth is `max(0.25, roundToNearestQuarter(Level 1 Mult × 0.20))`. Current stats add those fixed increments once for every level above 1; growth never compounds. This intentionally makes difficult hands start stronger and scale faster.

Pair and Two Pair use the same live scoring engine, consumption, Sustainable, and selection rules as other hands. Hand-first selection chooses the existing stable physical-index default; the player can deselect a die and choose a replacement. Dice-first selection keeps all compatible hands available, including upper/Pair ambiguity. Only selected participants contribute their Multiplier and normal scored-die rerolls; unselected Hitchhikers retain their usual pip contributions.

Mirror supports **Pair, Two Pair, Three of a Kind, Full House, Four of a Kind, and Five of a Kind**. Each physical Mirror fills one matching slot and scores its actual physical pips. Two Pair still needs two different assigned ranks: `3, Mirror-6, 5, 5` qualifies, while `3, 4, 5, Mirror-6` does not. Multiple Mirrors can fill different slots, including two distinct all-wild pairs. Missing Link remains straight-specific.

## Probability and roll-weight enhancements

**Sticky:** When this face would reroll because it scored, it has a 50% chance to remain instead. Additional Sticky stacks increase the chance with diminishing returns: 50%, 75%, 87.5%, 93.75%, and so on, using `1 − 0.5^stacks`. One combined seeded check is made per qualifying face. Sticky can prevent the normal scored-die reroll and Jumping Bean's automatic reroll, but it does not prevent manual, shop, or Slippy rerolls. Slippy remains a separate cause and each physical die still rolls at most once in the shared post-hand batch.

**Sustainable:** When a hand containing this participating face would be consumed, Sustainable has a chance to preserve the hand. All Sustainable stacks on selected participating dice combine into one seeded check using `1 − 0.5^stacks`; unselected matching dice and Hitchhiker-only dice do not contribute. Sustainable never becomes spent and may check again later in the same round. A successful winning-hand check is retained in audit data but is not shown as prominent playback because the round is already ending. The [Sustainable audit](docs/sustainable-audit.md) records the updated state and event boundary.

**Weighted:** Each stack adds +1 roll weight to this physical face's opposite side, so the target weight is `1 + stacks`. One stack changes the opposite side from weight 1 to 2 (a `2/7` chance); two stacks produce weight 3 (`3/8`), rather than multiplying weights. Opposite pairs remain 1/6, 2/5, and 3/4. Weighted applies to every real gameplay or shop roll, but Magnetic flips are not rolls.

**Jackpot:** Gain **3 Gold per stack** when this face is currently showing on a physical die held out of the played hand that reaches or exceeds the round target. Participating dice do not qualify. A Hitchhiker-only contribution does not count as participation, so an unselected Hitchhiker + Jackpot face can contribute Pips and still receive its Jackpot payout. Jackpot triggers only for a normal played-hand clear; initial-roll, manual-reroll, and post-hand Jumping Bean clears do not trigger it.

Only successful Sticky and Sustainable checks show prominent **STICKY** or **SUSTAINABLE** feedback. Both successful and failed checks remain available in event history and proc telemetry with their stack count and chance. **WEIGHTED** appears once when a roll lands on a face whose probability was increased, regardless of stack count.

## Hand scoring

A played hand has two live scoring values: **Pips** and **Multiplier**. The accumulator starts from the selected hand's current level-derived Base Pips and Base Multiplier. Scoring faces and effects then modify those live values. Once all hand-bound effects finish, the hand adds exactly one result using:

**(Base Hand Pips + participating face Pips + Pip effects) × (Base Hand Multiplier + Multiplier effects)**

Base Pips are hand stats, not physical-face pips. They do not trigger Golden, Workout, Sticky, Sustainable, Hitchhiker, Jumping Bean, Magnetic, or any other face effect. Hand level is the authoritative persistent run state; current Base Pips and Mult are derived rather than independently mutated. Training never changes historical round scores.

- Selected faces contribute printed pips plus previously earned Workout growth. Bonus adds **10 Pips per stack** before multiplication. Each selected Multiplier stack adds **0.5** to the hand's base multiplier.
- Each currently showing, unselected Hitchhiker adds its full scoring-pip value, including Bonus and prior Workout growth, to the active hand before multiplication. A selected Hitchhiker does not contribute twice. A Hitchhiker-only face's own Multiplier does not affect the hand because that die was not selected as a participant.
- Golden adds gold once whenever a selected or Hitchhiker face scores, without multiplication. Workout increases that physical face after its current contribution, before hand finalization; the current hand keeps the pre-increment pips.
- After finalization, combine Sustainable stacks across selected participants and make one preservation check, or consume the category when the check fails or no stacks participate. If a played hand reaches or exceeds the target, currently showing Jackpot faces on non-participating dice pay out in physical-die order, then the round clears. The dice do not perform normal post-hand rerolls; Sticky/Slippy and Weighted/Magnetic/Jumping Bean effects that would only result from those skipped rolls do not occur.
- If the hand leaves the round below target, normal Sticky/Slippy rerolls and their complete roll-effect chains proceed before clearance/loss is checked. Initial-roll, manual-reroll, and active Jumping Bean chains still finish completely even if they cross the target. The existing free five-die shop exposure roll happens separately after `ROUND_CLEARED`; it is not a post-hand gameplay reroll.
- Jumping Bean remains independent scoring for initial, manual, post-hand, and chained rolls: its scoring pips × (1 + its own Multiplier stacks × 0.5). It does not change a finalized hand accumulator. Its Golden and Workout trigger as usual.

The center playback begins at the hand's Base Pips and Base Multiplier, displays persistent **PIPS / MULT** values as dice and effects build, then shows the final multiplication and score addition. The [scoring audit](docs/scoring-audit.md) records the previous behavior and the domain/event changes.

## Architecture

`src/game/` contains the rules independently of React:

| Module | Responsibility |
| --- | --- |
| `config.ts` | Targets, rewards, costs, enhancement strengths, timing, safety cap |
| `types.ts` | Physical faces/dice, board, actions, events, statistics |
| `rng.ts` | Serializable Mulberry32 random stream and seed hashing |
| `dice.ts` | Face pips, opposite faces, weighted gameplay/shop rolls |
| `hands.ts` | Central Level 1 multipliers, derived level stats/growth, physical subsets, matching groups, straight wilds, deterministic defaults |
| `selection.ts` | Selection in both directions; constraints never decide loss |
| `scoring.ts` | Selected-hand and standalone pip/multiplier calculations |
| `enhancements.ts` | Complete catalog, stacks, placement eligibility |
| `effects.ts` | FIFO roll triggers, scoring order, reroll batches, round boundaries |
| `engine.ts` | Validated immutable commands, new runs, injectable randomness |
| `telemetry.ts` | Round/run statistics, board snapshots, structured exports |

`newRun(seed)` and `dispatch(state, action)` return `{ state, events, error? }`. They clone the input, resolve synchronously, and produce ordered events with board snapshots. Rejected commands preserve the input and consume no randomness. `useGame.ts` plays the snapshots; it never determines a roll, score, purchase, or phase transition. One serialized RNG stream supplies dice rolls, magnetic destinations, shop exposure, enhancement offers, and Hand Training offers. Tests can inject a `RandomSource` with `next()` in `[0, 1)`.

For programmatic reproduction with the same rules version, call `newRun(data.seed)`, then dispatch each item in exported `data.actions`. Engine tests verify entire states and traces, and browser tests compare the visible board with the pure engine after actions.

## Deterministic edge-case choices

- **Target rounding:** use `round(50 × 1.35^(round−1) / 5) × 5`, keeping the existing nearest-multiple-of-five rounding. Targets for Rounds 1–10 are **50, 70, 90, 125, 165, 225, 305, 410, 550, 745**. The formula is centralized for tuning.
- Batch dice draw all outcomes before roll effects consume RNG. Dice, face lists, and default subsets use ascending physical index. Triggers from each die are queued Weighted → Magnetic → Jumping Bean; chains append to the FIFO queue. When a Magnetic trigger flips multiple dice, destinations are drawn in physical-die order, including a draw for a die with only one magnetic face.
- Jumping Bean uses the complete landed-face snapshot, including pips and Sticky, even if a queued Magnetic effect changed its visible face. Workout increments the triggering physical face after scoring. Magnetic destinations are never rolls and do not create roll triggers.
- A stack activation counts once per enhancement per relevant face/event; its numeric effect includes all stacks. Wild feedback is shown for participating wild faces in the relevant hand family, including when their natural rank could qualify. This explains qualification without changing actual pips.
- Hitchhiker contributes pips to the selected hand without adding a scored reroll; its die may still reroll through Slippy. Sustainable counts only selected-hand participants and has no spent or round-reset state. Sticky and Sustainable each use one centralized seeded probability draw per check and record checks, successes, failures, and stack counts. Slippy is deduplicated into the ordinary post-hand batch and remains independent of Sticky's scoring suppression.
- A winning played hand emits `POST_HAND_REROLLS_SKIPPED` and bypasses the entire gameplay reroll scheduler. No skipped reroll draws, Slippy activations, or resulting roll chains are recorded. Pair/Two Pair counts and multiplied scores use the existing per-hand telemetry maps and final hand records.
- Jackpot eligibility is evaluated after the played hand's final score has reached the target and before `POST_HAND_REROLLS_SKIPPED` and round clearance. It uses selected participant IDs, not scoring contributions, so held Hitchhikers qualify. Standalone score paths call round evaluation without passing through Jackpot resolution.
- Manual rerolls reject empty, duplicate-ID, invalid-ID, over-budget, and outside-round requests without changing state or consuming RNG. Accepted batches use ascending physical-die order, charge once for the initial selected dice, and clear dice/hand selection immediately. No extra charges or refunds arise from subsequent effects. A dead-board rescue is counted once per manual action if the pre-action gameplay board had no playable hand and the completed chain creates one or reaches the target, evaluated before shop exposure rolls.
- Run exports record per-round manual grants, charges spent, action count, rescue count, and charges left at clearance. Run totals include manual actions, physical-die reroll count (including repeats), rescue count, and each manual batch's physical IDs, cost, remaining budget, and rescue flags. Loss records distinguish a manual reroll from the most recent hand play. The action sequence remains replayable from the seed.
- Export schema **6**, scoring model **trained-hand-accumulator-v3**, includes every final hand level, Hand Training purchases and spend, each scored hand's level, Sticky/Sustainable probability-proc telemetry, and separate Golden, Jackpot, and round-clear gold income. All final multiplied hand score belongs to `scoreBySource.hand` and the selected category. The legacy `scoreBySource.hitchhiker` key remains present at zero; schema 1 used it for separate standalone Hitchhiker score. Historical exports retain their original semantics.
- A resolution exceeding 10,000 emitted events stops in a diagnostic state, writes a development error, preserves its trace, and permits restart. This is an exceptional guard, not a gameplay loss. There is no finite-round win condition.

## Validation

Unit tests cover every hand family, upper-hand subsets and their participation-based enhancement effects, subset ambiguity, both wilds, enhancement stacking and interactions, shop legality and costs, weighted distributions, magnetic snapshots, roll chains, safety diagnostics, round clearance/loss, telemetry totals, and seeded replay. Manual reroll tests cover per-die charging, repeated dice, rejection without RNG use, every currently showing enhancement, initial-effect resets, hand/ability independence, roll-trigger chains, final-charge rescues/clears/losses, telemetry, and shop separation. A multi-seed engine audit plays complete runs through purchases, manual rerolls and eventual loss. Browser tests cover the actual play/shop/loss/export flow, drag-and-drop, offer refreshes, physical-subset changes, playback skipping, and a narrow viewport. Both hand-first and dice-first browser cases verify that playing one 4 on a 1/2/4/4/5 board scores and rerolls only that physical die, preserves the duplicate, and still consumes Fours. Browser tests also cover single/multi-die manual spending, disabled controls during playback, cleared selection, deterministic dead-board guidance, rescue, and loss only after the final roll completes. Dead-board browser states are produced by seeded legal player actions; there is no test-state injection into the game UI.

Validation commands: `npm.cmd test`, `npm.cmd run test:browser`, `npm.cmd run typecheck` (also invoked by the build), and `npm.cmd run build`. `npm` works equivalently in shells where PowerShell does not intercept it with a blocked script. Probability coverage uses controlled RNG values for Sticky and Sustainable success/failure, multi-stack formulas, participation boundaries, same-round reuse, winning-hand bookkeeping, and interactions with Slippy and Jumping Bean. Weighted coverage verifies linear weights, every opposite mapping, real roll paths, shop use, and Magnetic exclusion. Jackpot coverage verifies held/participating faces, linear stack payouts, multiple dice, exact-target clears, Hitchhiker participation semantics, standalone-clear exclusion, no post-win rerolls, telemetry, seeded replay, and visible browser feedback. Browser coverage also includes repeated Sustainable attempts without spent presentation and a visible stacked Sticky badge.

No known gameplay blockers. Browser automation exercises a real pointer drag onto an exposed die face and visible Jumping Bean feedback on the next round's initial roll. Clipboard access depends on the browser; the manual-copy fallback is included. The prototype intentionally has no persistence, backend, deployment, audio, or elaborate art.

## Questions for playtesting

1. Are there meaningful choices between consuming an upper hand and reserving dice/categories for a larger hand?
2. Do face-specific upgrades and shop exposure make physical dice feel different, particularly when choosing three of four matches?
3. Are Bonus and Sustainable/Sticky combinations too dominant relative to wilds, gold, and roll-chain abilities?
4. Does target growth produce useful run lengths, and is gold sufficient to experiment with both purchases and rerolls?
5. Can players explain every score and reroll from the visible ticks, especially Magnetic plus Jumping Bean?
