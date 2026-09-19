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
- This lets the player preserve useful board structure—for example, keeping one duplicate 4 while rerolling another to pursue a straight. The chosen subset determines qualification and normal scored-die rerolls. Each showing, unselected Hitchhiker gets its probability check and, on success, joins as a full scoring die without helping qualification or receiving that normal reroll. Unselected dice can also act through Slippy or roll effects.
- For ambiguous lower hands, deselect a chosen die and select a replacement. Lower hands still require exactly their prescribed number of participants. The play button requires a valid participating set.
- Each round gives the player **3 manual die rerolls**. A manual reroll charge rerolls one selected physical die. Multiple dice may be rerolled at once by spending one charge per die; the same die can be rerolled again in a later action. Select dice and press **Reroll Selected — N**. No hand is required, and selections clear when the action starts.
- Manual rerolls are real gameplay rolls: Weighted, Magnetic, and Jumping Bean use the existing effect queue. Sticky cannot block the player-requested roll. Manual rolls do not play or consume a hand, activate Slippy/Sustainable/Hitchhiker, or grant direct hand points. Automatic initial rolls, hand rerolls, ability rerolls, and flips spend no manual charges and never replenish them.
- The player cannot lose while manual rerolls remain. If no hand can be played, the player must use their remaining rerolls before the run can end. Loss requires **below goal + no legal unconsumed hand on the complete board + zero manual rerolls**. The whole current chain finishes before clearance or loss; an effect chain reaching the goal clears the round even on the final charge. Categories and the manual budget reset at the beginning of each gameplay round, before initial effects.
- Clearing grants **5 gold on Round 1, increasing by 1 each round**. Most clears open the normal shop directly. Every third clear (Rounds 3, 6, 9, ...) opens a Flame Reward first, then the normal shop. Runs still begin with 0 gold; Golden income is separate from the round-clear reward.
- Every scoring hand starts at **Level 1**. A Hand Training card costs **4 gold** and permanently raises its named hand by one level for the current run. Any or all three cards may be purchased directly; they stay fixed for that shop and have no reroll action. A new run resets every hand to Level 1.
- Drag an offer onto a die, or click **Select or drag** then click a die. Only its exposed physical face receives the purchase. A purchased offer stays unavailable until a paid refresh.
- Shop dice rerolls cost 1/2/4/8… gold; offer refreshes cost 3/6/12/24… gold. Both reset every shop and are separate from manual gameplay rerolls. The shop does not display, spend, or reset manual rerolls. Leave with **NEXT ROUND** whenever you want.
- **NORMAL / FAST / INSTANT** and **Skip playback** affect only visualization. Rules have already resolved synchronously.
- Open **Inspect all physical faces** to review your 30 physical faces, enhancement stacks, and persistent Workout pips.
- Open **Run data & event history** to copy structured run statistics, the action sequence, current RNG state, and board; or copy the complete readable event log. Clipboard failure provides a manual-copy dialog.
- Seeds are visible and editable. Restart the same seed, enter a specific seed, or start with a new seed. URL parameters `?seed=example&speed=instant` are also supported. Restarting or reloading replaces the in-memory run.

All 14 face enhancements are implemented: Bonus, Multiplier, Jumping Bean, Golden, Workout, Missing Link, Mirror, Magnetic, Sticky, Slippy, Sustainable, Hitchhiker, Weighted, and Jackpot. The in-app reference describes each.

Bonus, Multiplier, Golden, Workout, Weighted, Jackpot, and Hitchhiker are stackable. Sticky, Sustainable, and Hitchhiker use one combined diminishing-return probability check with `1 - 0.5^stacks`. Jumping Bean, Missing Link, Mirror, Magnetic, and Slippy remain binary on each physical face. Stackable badges show one readable count such as **Sticky ×2**, **Hitchhiker ×2**, or **Jackpot ×3**.

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

## Flames and XMult

Flames are whole-die upgrades: each physical die has zero or one Flame, and the Flame remains for the run unless it is replaced. Multiple dice may own the same Flame. A physical die “scores in a hand” when it is either a selected shape die or successfully joins through Hitchhiker; Hitchhiker still never helps qualify the hand.

Every third cleared round opens a **Flame Reward** after normal clear Gold and before the shop. The reward rolls all five dice once with shop-like semantics: Weighted and Clockwork apply, while Jumping Bean, Magnetic, Charge, and scoring do not. It presents three distinct, uniformly seeded Flame offers. One offered Flame is attached to one physical die for free. Rerolling only the offers costs **5, 10, 20, 40, ... Gold**; the rolled faces do not change. Replacing an existing Flame requires confirmation and permanently removes the old Flame. After selection, the same five exposed faces carry into the normal shop without another free roll.

The engine always tracks **XMult**, starting at ×1. Final scoring is:

`Score = Math.round(Pips × Mult × XMult)`

Additive and multiplicative Flame effects compose as `(1 + total additive bonuses) × product of multiplicative effects`. For example, +1 Charge, +0.5 Dragon's Hoard, and ×2 Ultimate produce `(1 + 1 + 0.5) × 2 = ×5`. The live XMult column remains hidden until the run owns an XMult-capable Flame; after that it remains visible even when the current value is ×1. XMult is live resolution state, not a static scorecard hand stat.

| Flame | Effect |
| --- | --- |
| Ultimate | If this die scores in a hand tied for the run's highest current hand level, ×2 XMult. |
| Minigun | If this die scores in an Upper-section hand, ×2 XMult. |
| Triple-Up | A purchased stackable face enhancement on this die applies 3 stacks for the price of one; binary enhancements apply once. It is not retroactive. |
| Hail Mary | If this die scores when the hand-start manual-reroll count is 0, ×2 XMult. |
| Clockwork | Every real roll advances this die 1→2→3→4→5→6→1. Magnetic flips are not rolls; Weighted cannot alter the Clockwork result. |
| Charge | Each gameplay roll stores +0.5 XMult for the next played hand, whether or not this die scores. All stored Charge is consumed and reset after that hand. Shop, Flame Reward, and Magnetic do not build it. |
| Double Encore | The first category this die scores in each round gains 2 finite bonus uses. Multiple dice add +2 each; Sustainable is checked only after bonus uses are exhausted. |
| Personal Trainer | If this die scores in the played hand that clears the round, that hand gains 1 level after its score is calculated. Standalone clears do not train. |
| Loose Cannon | Independent scoring from this die, currently chiefly Jumping Bean, gets ×2 XMult. Normal hand score is unaffected. |
| Dragon's Hoard | If this die scores, +0.05 XMult per Gold held at hand start. Later income cannot change the snapshot. |
| Bloated | If this die scores, +0.1 XMult per enhancement stack across all six of its faces at hand start. The Flame itself does not count. |
| Well Trained | If this die scores, +0.1 XMult per previous run-wide play of that category. The selected row previews the deterministic selected-die bonus; it has no permanent target. |
| Target Practice | At round start, one seeded target is chosen from the three least-played Lower hands. It stays fixed and visibly marked all round. A Target Practice die scoring in it grants ×3 XMult. |

Target Practice tie pools are resolved with the run's seeded RNG, so enum order cannot silently choose the target. Sustainable-preserved and Double Encore plays both increase run-wide hand play counts, and Well Trained always uses the count before the current play.

## Probability and roll-weight enhancements

**Sticky:** When this face would reroll because it scored, it has a 50% chance to remain instead. Additional Sticky stacks increase the chance with diminishing returns: 50%, 75%, 87.5%, 93.75%, and so on, using `1 − 0.5^stacks`. One combined seeded check is made per qualifying face. Sticky can prevent the normal scored-die reroll and Jumping Bean's automatic reroll, but it does not prevent manual, shop, or Slippy rerolls. Slippy remains a separate cause and each physical die still rolls at most once in the shared post-hand batch.

**Sustainable:** When a hand containing this scoring face would be consumed, Sustainable has a chance to preserve the hand. All Sustainable stacks on selected shape dice and successful Hitchhiker scoring dice combine into one seeded check using `1 − 0.5^stacks`; unselected faces whose Hitchhiker check fails do not contribute. Sustainable never becomes spent and may check again later in the same round. Double Encore bonus uses are spent before Sustainable is checked. A successful winning-hand check is retained in audit data but is not shown as prominent playback because the round is already ending. The [Sustainable audit](docs/sustainable-audit.md) records the updated state and event boundary.

**Hitchhiker:** Every currently showing, unselected Hitchhiker face makes one combined seeded check per played hand using `1 − 0.5^stacks` (50%, 75%, 87.5%, ...). On success it joins after qualification as a full scoring die: Pips, Bonus, Multiplier, Golden, Workout, Sustainable, and applicable Flames all resolve. It never helps form the hand and never gets the selected shape-die's normal scored reroll, though Slippy can still reroll it. Only successful checks show prominent **HITCHHIKER** feedback.

**Weighted:** Each stack adds +1 roll weight to this physical face's opposite side, so the target weight is `1 + stacks`. One stack changes the opposite side from weight 1 to 2 (a `2/7` chance); two stacks produce weight 3 (`3/8`), rather than multiplying weights. Opposite pairs remain 1/6, 2/5, and 3/4. Weighted applies to every real gameplay or shop roll, but Magnetic flips are not rolls.

**Jackpot:** Gain **3 Gold per stack** when this face is currently showing on a physical die that did not score in the played hand reaching the round target. Selected dice and successful Hitchhikers do not qualify; a failed Hitchhiker remains outside and may qualify. Jackpot triggers only for a normal played-hand clear; initial-roll, manual-reroll, and post-hand Jumping Bean clears do not trigger it.

Only successful Sticky and Sustainable checks show prominent **STICKY** or **SUSTAINABLE** feedback. Both successful and failed checks remain available in event history and proc telemetry with their stack count and chance. **WEIGHTED** appears once when a roll lands on a face whose probability was increased, regardless of stack count.

## Hand scoring

A played hand has three live scoring values: **Pips**, **Multiplier**, and **XMult**. The accumulator starts from the selected hand's current level-derived Base Pips and Base Multiplier with XMult ×1. Scoring faces and effects then modify those live values. Once all hand-bound effects finish, the hand adds exactly one result using:

**(Base Hand Pips + scoring-face Pips + Pip effects) × (Base Hand Multiplier + Multiplier effects) × final XMult**

Pips remain literal and Multiplier/XMult values may remain fractional. After all three are known, each scoring event awards `Math.round(Pips × Multiplier × XMult)` exactly once. Category totals, Effect Score, round score, and target comparisons use those already-rounded integer awards. Sustainable and Encore replays round independently before their category awards are accumulated.

Base Pips are hand stats, not physical-face pips. They do not trigger Golden, Workout, Sticky, Sustainable, Hitchhiker, Jumping Bean, Magnetic, or any other face effect. Hand level is the authoritative persistent run state; current Base Pips and Mult are derived rather than independently mutated. Training never changes historical round scores.

- Selected faces contribute printed pips plus previously earned Workout growth. Bonus adds **10 Pips per stack** before multiplication. Each selected Multiplier stack adds **0.5** to the hand's base multiplier.
- Each currently showing, unselected Hitchhiker makes its seeded proc check after the selected hand is already valid. On success, it adds its full scoring-pip value, Bonus, and Multiplier to the active accumulator. A selected Hitchhiker does not check or contribute twice.
- Golden adds gold once whenever a selected or Hitchhiker face scores, without multiplication. Workout increases that physical face after its current contribution, before hand finalization; the current hand keeps the pre-increment pips.
- After finalization, spend a finite Double Encore bonus use if one exists; otherwise combine Sustainable stacks across selected and successful-Hitchhiker scorers for one preservation check, or consume normally. If a played hand reaches or exceeds the target, currently showing Jackpot faces that did not score pay out in physical-die order, then the round clears. The dice do not perform normal post-hand rerolls; Sticky/Slippy and Weighted/Magnetic/Jumping Bean effects that would only result from those skipped rolls do not occur.
- If the hand leaves the round below target, normal Sticky/Slippy rerolls and their complete roll-effect chains proceed before clearance/loss is checked. Initial-roll, manual-reroll, and active Jumping Bean chains still finish completely even if they cross the target. The existing free five-die shop exposure roll happens separately after `ROUND_CLEARED`; it is not a post-hand gameplay reroll.
- Jumping Bean remains independent scoring for initial, manual, post-hand, and chained rolls: its scoring pips × (1 + its own Multiplier stacks × 0.5) × standalone XMult, rounded once at finalization. Loose Cannon supplies ×2 standalone XMult. It does not change a finalized hand accumulator. Its Golden and Workout trigger as usual.

The center playback begins at the hand's Base Pips, Base Multiplier, and XMult ×1, displays live **PIPS / MULT / XMULT** values as dice and effects build, then shows the whole-number award. XMULT remains visually gated until an XMult Flame is owned. Raw fractional calculations and their rounded awards remain available in event-history audit entries. The [scoring audit](docs/scoring-audit.md) records the previous behavior and the domain/event changes.

## Architecture

`src/game/` contains the rules independently of React:

| Module | Responsibility |
| --- | --- |
| `config.ts` | Targets, rewards, costs, enhancement strengths, timing, safety cap |
| `types.ts` | Physical faces/dice, board, actions, events, statistics |
| `rng.ts` | Serializable Mulberry32 random stream and seed hashing |
| `dice.ts` | Face pips, opposite faces, Weighted rolls, Clockwork roll override |
| `hands.ts` | Central Level 1 multipliers, derived level stats/growth, physical subsets, matching groups, straight wilds, deterministic defaults |
| `selection.ts` | Selection in both directions; constraints never decide loss |
| `scoring.ts` | Hand/standalone Pips, Mult, XMult accumulation and one final rounded award |
| `enhancements.ts` | Complete catalog, stacks, placement eligibility |
| `flames.ts` | Stable Flame catalog, hand-start snapshots, XMult composition and ownership helpers |
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
- Hitchhiker uses one seeded diminishing-return check per eligible face. A success becomes a full scoring die without adding a selected-die reroll; Slippy remains independent. Sustainable counts selected shape dice plus successful Hitchhikers and has no spent state. Sticky, Sustainable, and Hitchhiker record checks, successes, failures, and stack counts.
- A winning played hand emits `POST_HAND_REROLLS_SKIPPED` and bypasses the entire gameplay reroll scheduler. No skipped reroll draws, Slippy activations, or resulting roll chains are recorded. Pair/Two Pair counts and multiplied scores use the existing per-hand telemetry maps and final hand records.
- Jackpot eligibility is evaluated after the played hand's final score reaches the target and before `POST_HAND_REROLLS_SKIPPED` and round clearance. It excludes every scoring die, including successful Hitchhikers. Failed Hitchhikers remain eligible. Standalone score paths call round evaluation without passing through Jackpot resolution.
- Manual rerolls reject empty, duplicate-ID, invalid-ID, over-budget, and outside-round requests without changing state or consuming RNG. Accepted batches use ascending physical-die order, charge once for the initial selected dice, and clear dice/hand selection immediately. No extra charges or refunds arise from subsequent effects. A dead-board rescue is counted once per manual action if the pre-action gameplay board had no playable hand and the completed chain creates one or reaches the target, evaluated before shop exposure rolls.
- Run exports record per-round manual grants, charges spent, action count, rescue count, and charges left at clearance. Run totals include manual actions, physical-die reroll count (including repeats), rescue count, and each manual batch's physical IDs, cost, remaining budget, and rescue flags. Loss records distinguish a manual reroll from the most recent hand play. The action sequence remains replayable from the seed.
- Export schema **8**, scoring model **flame-xmult-accumulator-v5**, includes raw/final scores and XMult, final Flame ownership, acquisitions/replacements, Flame rerolls and spend, Flame triggers/contributions, Target Practice targets, Charge, Encore, Trainer, and Sticky/Sustainable/Hitchhiker proc telemetry. Golden, Jackpot, and round-clear income remain separate. All rounded hand score belongs to `scoreBySource.hand` and the selected category; the legacy `scoreBySource.hitchhiker` key remains zero.
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
