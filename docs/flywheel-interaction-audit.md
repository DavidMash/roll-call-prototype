# Flywheel interaction audit

Date: 2026-11-14  
Original scope: read-only gameplay audit.  
Correction status: the approved gameplay decisions were implemented and verified on 2026-11-14. The original findings remain below as the pre-correction evidence record; this resolution update is authoritative for current behavior.

## Executive summary

Flywheel is a **Manual Reroll cost controller**, not a roll generator. Selecting an eligible Flywheel die does not create an extra roll attempt, extra resolved die, or second Manual Reroll action. The selected dice still enter one canonical `manual` roll batch and receive one roll intent each. Flywheel changes the resource cost before that batch and consumes one of its own per-Round invocations.

The central path is internally coherent:

- one player action increments the Manual Reroll action counters once;
- each selected die is counted once in `manualDiceRerolled`;
- normal and Care Package resources are spent only after Flywheel coverage is calculated;
- each eligible selected Flywheel consumes exactly one invocation;
- roll controllers and landing reactions see the same `manual` batch they would see without Flywheel;
- Lightning Strike evaluates each prediction once and applies one Charge multiplication per hit, subject to the Charge cap.

The original audit found three high-severity interaction problems:

1. **A legal zero-cost Flywheel reroll is ignored by dead-board termination.** The engine can Bust or consume Bottled Fairy even when `validateAction` says a Flywheel-only Manual Reroll is legal.
2. **Lightning Strike compares after Jumping Bean's chained follow-up Rolls, not against the result of the requested Manual Reroll batch.** This can turn a correct manual-roll prediction into a miss, or the reverse.
3. **Forced roll controllers can resolve to the wrong rank when a Chameleon-mutated die no longer contains the requested rank.** A reproduced Flywheel + Chameleon + Magnetic reroll recorded Magnetic as the controller but landed on rank 4 instead of the anchor's rank 6.

All three are now resolved. The correction also implements the approved per-die Flywheel pricing and Jump Start rules, preserves Fly's normal-reserve mercy exception, and guarantees that committed Curtain Call rerolls finish. The current full unit suite passes: **75 files, 823 tests**. Browser and production validation results are recorded in the final validation table below.

### Evidence labels

- **Verified — test:** asserted by an existing automated test.
- **Verified — probe:** reproduced with an in-memory, read-only deterministic scenario; no file was created.
- **Verified — source:** directly established by the authoritative implementation path.
- **Documented intent:** stated in player-facing rules or an explicit test name/comment.
- **Ambiguous intent:** current sources disagree or no rule defines the boundary.

## Correction resolution update

### Authoritative rules after correction

- **Flywheel price:** for selected dice `S` and eligible selected Flywheel dice `F`, `resource cost = |S| - |F|`. Every covered Flywheel consumes one invocation. Normal resources pay first and Care Package pays the remainder. An all-covered selection costs zero.
- **Affordability:** `canAffordManualReroll` compares that authoritative cost with normal plus Care Package reserves. Both validation and UI cost preview use the same resolver ([`manualRerolls.ts:14-35`](../src/game/manualRerolls.ts#L14), [`engine.ts:648-659`](../src/game/engine.ts#L648), [`RoundScreen.tsx:113-122`](../src/components/RoundScreen.tsx#L113)).
- **Legal opportunity:** `hasLegalManualReroll` asks whether at least one currently active die can form an affordable one-die selection. It observes Round phase, Warden setup, Warden locks, the Magician's missing die, Infected suppression, remaining Flywheel invocations, and both resource pools ([`manualRerolls.ts:38-42`](../src/game/manualRerolls.ts#L38)). Because costs are additive and never negative, testing active singleton selections is sufficient to prove whether any legal selection exists.
- **Jump Start:** every selected die in one successful Manual Reroll applies the investment-scaled Charge multiplier once, sequentially and up to the Charge cap. The trigger count is independent of resource spend. Automatic and effect-generated Rolls do not call this path ([`effects.ts:2201-2244`](../src/game/effects.ts#L2201)).
- **Lightning Strike:** the `manual` roll batch event is captured before queued Jumping Bean follow-ups drain. Predictions compare with that batch's post-controller `afterFace` result. Each hit independently applies the existing multiplier; follow-up batches add no predictions or rewards ([`effects.ts:2088-2130`](../src/game/effects.ts#L2088)).
- **Forced ranks:** Magic, Magnetic, and Clockwork may only install a rank found on an actual physical face. An unavailable request is inapplicable, consumes no use/count, and control continues in established priority order. Duplicate ranks deterministically select the first matching physical face ([`effects.ts:917-976`](../src/game/effects.ts#L917)).
- **Boss mercy:** Magician final-opportunity correction uses the shared legal-opportunity query after current-action Flywheel uses have been consumed. Fly intentionally remains a normal-reserve-only exception and can activate while Care Package or Flywheel opportunities remain ([`effects.ts:1049-1061`](../src/game/effects.ts#L1049), [`effects.ts:1340-1350`](../src/game/effects.ts#L1340)).
- **Curtain Call:** resource and Flywheel costs are committed before the manual batch starts. A pre-roll Free Play may clear the Round, but the requested batch, controllers, landing reactions, queued reactions, Lightning evaluation, and history recording still finish. The existing transition guard produces only one Round completion ([`effects.ts:1034-1099`](../src/game/effects.ts#L1034), [`effects.ts:1124-1143`](../src/game/effects.ts#L1124)).

### Finding dispositions

| Finding | Disposition | Implementation and regression evidence |
|---|---|---|
| FWA-01 dead-board termination | **Resolved** | Shared `hasLegalManualReroll` now gates Bust and Bottled Fairy. Tests cover a zero-resource free action, Tightrope, and deferred Fairy consumption ([`flywheelInteractionCorrections.test.ts:134-181`](../src/game/flywheelInteractionCorrections.test.ts#L134)). |
| FWA-02 Lightning + Jumping Bean boundary | **Resolved** | Lightning reads the returned original manual batch, not mutable terminal die state. A deterministic test lands on predicted 1, follows up to 2, and records a hit ([`flywheelInteractionCorrections.test.ts:184-206`](../src/game/flywheelInteractionCorrections.test.ts#L184)). |
| FWA-03 missing forced ranks | **Resolved** | The forced helper returns inapplicable for absent ranks. Tests cover Magic-to-Clockwork fallthrough, Magnetic, Clockwork-to-Tank, Snake Eyes, duplicates, attribution, and use accounting ([`flywheelInteractionCorrections.test.ts:232-311`](../src/game/flywheelInteractionCorrections.test.ts#L232)). |
| FWA-04 Jump Start trigger unit | **Resolved by decision** | It now triggers once per selected manually rerolled die, including free Flywheel dice, with sequential cap-aware events ([`flywheelInteractionCorrections.test.ts:101-131`](../src/game/flywheelInteractionCorrections.test.ts#L101)). |
| FWA-05 Magician final opportunity | **Resolved** | Remaining legal free Flywheel actions defer mercy; the final consumed invocation permits it ([`flywheelInteractionCorrections.test.ts:314-337`](../src/game/flywheelInteractionCorrections.test.ts#L314)). |
| FWA-06 mixed-selection pricing | **Resolved by decision** | Cost is exactly the uncovered selected-die count. Tests cover multiple, exhausted, Infected, and Cursed dice plus normal/Care Package split ([`flywheelInteractionCorrections.test.ts:51-98`](../src/game/flywheelInteractionCorrections.test.ts#L51)). |
| FWA-07 Fly mercy | **Intentional exception** | No mechanics change. Copy identifies the doubled pool as normal Manual Rerolls, and a regression proves mercy can activate while Care Package and Flywheel remain ([`bossFairnessPatch.test.ts:188-202`](../src/game/bossFairnessPatch.test.ts#L188)). |
| FWA-08 Lightning description | **Resolved** | Verbose copy now documents independent per-hit multiplication and the original manual-outcome boundary ([`effectDescriptions.ts:96`](../src/game/effectDescriptions.ts#L96)). |
| FWA-09 legacy `INVOKE_FLYWHEEL` | **Resolved** | The unreachable action variant, validation branch, dispatch branch, and resolver method were removed. Persisted history remains data-only and does not replay this command. |

### Additional approved decision: committed Curtain Call

Two deterministic regressions cover the rule that a committed action finishes after Curtain Call clears the Round: a paid reroll still lands and triggers Third Rail, and a free Flywheel + Lightning action consumes its invocation and evaluates the committed manual outcome. Both assert a single `round_attempt_finished` event ([`flywheelInteractionCorrections.test.ts:340-386`](../src/game/flywheelInteractionCorrections.test.ts#L340)).

### Final validation

| Check | Result |
|---|---|
| Focused Flywheel, Charge, interaction, and boss Vitest suite | **Passed:** 4 files, 62 tests |
| Complete Vitest suite | **Passed:** 75 files, 823 tests |
| Focused Playwright reroll suite | **Passed after updating one obsolete Flywheel-copy assertion:** 11 tests |
| Complete Playwright suite | **Passed:** 160 tests in 5.1 minutes |
| TypeScript typecheck | **Passed:** `tsc --noEmit` |
| Production build | **Passed:** 7,166 modules transformed by Vite |
| Legacy command search | **Passed:** no `INVOKE_FLYWHEEL` references remain in `src/` or `tests/` |
| Diff hygiene | **Passed:** `git diff --check` reports no whitespace errors; browser-generated screenshot refreshes were restored |

The first complete browser run reported two failures because Magician and Fly preview fixtures still expected the old phrase “twice as many Manual Rerolls.” The received UI correctly used the approved clarification “twice as many normal Manual Rerolls.” Those fixtures were updated, both focused cases passed, and the subsequent complete 160-test Playwright run passed without retries or ignored failures. The build retains the repository's existing large-chunk warning; no new build error or gameplay issue remains.

## Original audit record (pre-correction)

The remaining mechanics, matrix, findings, and proposed tests preserve what the read-only audit observed before the approved corrections. Refer to the correction resolution update above for current behavior.

## Exact Flywheel mechanics

### Definition and activation

Flywheel is an automatic, level-scaled special-die effect. Its player-facing rule says that, when the die is selected for a Manual Reroll, it covers that die's participation; if all selected dice are covered, the whole action is free ([`specialDice.ts:54`](../src/game/specialDice.ts#L54), [`effectDescriptions.ts:36`](../src/game/effectDescriptions.ts#L36)). Each level grants one invocation per Round through `invocationCapacity` and `resetDieRoundState` ([`specialDice.ts:96-122`](../src/game/specialDice.ts#L96)).

`resolveManualRerollCost` is authoritative for coverage ([`manualRerolls.ts:12-29`](../src/game/manualRerolls.ts#L12)). A selected die is covered only when all of the following are true:

- it is a player-owned die in the submitted selection;
- it currently has a Flywheel effect;
- its exposed face is not Infected, because Infected suppresses the whole-die effect;
- that Flywheel effect has at least one invocation remaining.

The exact cost formula is:

| Selection | Resource cost | Flywheel uses consumed |
|---|---:|---:|
| No eligible selected Flywheel | number of selected dice | 0 |
| Every selected die has eligible Flywheel | 0 | one per selected Flywheel die |
| Mixed selection with at least one eligible Flywheel | 1 total | one per eligible selected Flywheel die |

The mixed-selection rule is broader than “subtract the covered dice”: one eligible Flywheel collapses any number of uncovered selected dice to one paid resource. Existing tests deliberately assert this behavior ([`interactionUxCleanup.test.ts:51-58`](../src/game/interactionUxCleanup.test.ts#L51)). Whether that is the intended balance rule remains ambiguous because the description only says Flywheel covers “this die's participation.”

### What Flywheel does not do

Flywheel does **not**:

- generate an additional roll batch;
- generate an additional physical roll attempt;
- add a die to the selection;
- reroll locked-away Warden dice or the Magician's missing die;
- cover an unselected die;
- cover the boss-owned Cursed Die by itself;
- participate in post-Play, Juggler, Dare Devil, Jumping Bean, Magician-return, Shop, or initial-round Rolls.

Those distinctions follow from Flywheel being consulted only by `resolveManualRerollCost`, while the actual dice are rolled once by `rollBatch(..., 'manual')` ([`effects.ts:2199-2248`](../src/game/effects.ts#L2199)).

### Resource accounting

Validation compares the Flywheel-adjusted cost with normal plus Care Package reserves ([`engine.ts:648-658`](../src/game/engine.ts#L648), [`specialOffers.ts:52-54`](../src/game/specialOffers.ts#L52)). Payment is then split normal-first and Care-Package-second ([`effects.ts:2205-2208`](../src/game/effects.ts#L2205)). Therefore:

- an all-Flywheel selection spends neither pool;
- a mixed selection spends exactly one normal resource when available;
- otherwise that one resource comes from Care Package;
- Flywheel invocations are separate from both resource pools;
- `manualRerollsUsedThisRound` still increments for a free action;
- `manualRerollActions` increments once, while `manualDiceRerolled` increments by the selected-die count;
- normal unused-Reroll payout continues to examine only the normal pool.

This means “Manual Reroll action,” “die manually rerolled,” and “Reroll resource spent” are three distinct units in current state and telemetry.

## Resolution timeline

For one player-initiated Flywheel-assisted Manual Reroll, the exact order is:

1. **Command validation.** `validateManualReroll` checks Round phase, Warden setup, nonempty/distinct active dice, and Flywheel-adjusted affordability ([`engine.ts:648-658`](../src/game/engine.ts#L648)).
2. **Coverage calculation.** Eligible selected Flywheels and total cost are resolved once ([`manualRerolls.ts:12-29`](../src/game/manualRerolls.ts#L12)).
3. **Resource expenditure.** Normal resources are depleted first, then Care Package ([`effects.ts:2205-2208`](../src/game/effects.ts#L2205)).
4. **Action statistics.** One action is recorded; selected-die and paid-charge counters are recorded independently ([`effects.ts:2209-2216`](../src/game/effects.ts#L2209)).
5. **Flywheel use expenditure.** One invocation is consumed for every covered selected Flywheel ([`effects.ts:2217-2220`](../src/game/effects.ts#L2217)).
6. **Manual-action event.** One `MANUAL_REROLL_STARTED` event is emitted ([`effects.ts:2231`](../src/game/effects.ts#L2231)).
7. **Jump Start.** Charge triggers are attributed from paid resource cost, before any dice roll ([`effects.ts:2232-2238`](../src/game/effects.ts#L2232)).
8. **Manual roll batch begins.** One batch is created with `reason='manual'`; its intent flags are `reroll=true`, `manual=true`, `effectGenerated=false`, and `excludeStartingFace=true` ([`resolution.ts:160-193`](../src/game/resolution.ts#L160)).
9. **Curtain Call pre-roll Plays.** Each selected, unsuppressed Curtain Call die Free Plays its current Left Hand before any selected face changes ([`effects.ts:1032`](../src/game/effects.ts#L1032), [`effects.ts:1111-1130`](../src/game/effects.ts#L1111)).
10. **Batch event.** One `DICE_REROLL_STARTED` event is emitted ([`effects.ts:1036-1037`](../src/game/effects.ts#L1036)).
11. **One roll intent per selected die.** Duplicate IDs are removed and encounter order is used ([`effects.ts:1028-1039`](../src/game/effects.ts#L1028)).
12. **Controller arbitration.** For each die the priority is Magic, external Magnetic, Clockwork, Tank, then randomized/Weighted selection ([`effects.ts:911-981`](../src/game/effects.ts#L911)).
13. **Magician last-opportunity correction.** Eligible RNG results may be replaced before faces are installed ([`effects.ts:1040-1059`](../src/game/effects.ts#L1040)).
14. **Final batch faces installed.** Non-intercepted physical faces are written once ([`effects.ts:1060-1062`](../src/game/effects.ts#L1060)).
15. **Per-result landing reactions.** Non-intercepted results emit `DIE_ROLLED`; Third Rail, Hexer telemetry, Jumping Bean, and Flux Capacitor resolve from the installed outcomes ([`effects.ts:984-1023`](../src/game/effects.ts#L984)).
16. **Batch history.** One `roll_batch` event records resource spend, controller, physical faces, result ranks, and intercept state ([`effects.ts:1063-1088`](../src/game/effects.ts#L1063)).
17. **Queued chains drain.** Jumping Bean Free Plays and separate `jumping_bean_followup` roll batches run to exhaustion/termination ([`effects.ts:1093-1109`](../src/game/effects.ts#L1093)).
18. **Dead-board rescue and Round evaluation.** Rescue telemetry is updated, then `evaluate()` may continue, refill, clear, or Bust ([`effects.ts:2243-2249`](../src/game/effects.ts#L2243), [`effects.ts:2980-3063`](../src/game/effects.ts#L2980)).
19. **Lightning Strike only.** The Lightning wrapper returns from `manualReroll`, then compares each prediction with each die's *current* exposed outcome and applies one Charge multiplication per hit ([`effects.ts:2086-2129`](../src/game/effects.ts#L2086)).

### Architectural event units

| Unit | Representation | Count for a Flywheel-assisted selection of N dice |
|---|---|---:|
| Player command | `MANUAL_REROLL` or `ACTIVATE_LIGHTNING_STRIKE` | 1 |
| Manual Reroll action | stats + `MANUAL_REROLL_STARTED` | 1 |
| Resource expenditure | `normalCharges + carePackageCharges` | 0, 1, or N |
| Flywheel expenditure | per-effect invocation | one per covered selected die |
| Roll batch | `RollBatchIntent(reason='manual')` | 1 |
| Die roll attempt | one `RollIntent` per selected die | N |
| Resolved batch result | one `RollResolution` per selected die | N |
| `DIE_ROLLED` landing event | non-intercepted results only | N minus Tank intercepts |
| Effect-generated follow-up | separate batch, e.g. Jumping Bean | 0 or more |
| Lightning evaluation | one comparison per prediction after `manualReroll` returns | N |

The architecture represents these distinctions explicitly in `RollBatchIntent`, `RollIntent`, run-history spend data, and separate statistics ([`resolution.ts:80-129`](../src/game/resolution.ts#L80), [`runHistoryV2.ts:20-22`](../src/game/runHistoryV2.ts#L20)). It does not currently expose a reusable concept equivalent to “a legal zero-cost Manual Reroll remains,” which is the source of several findings.

## Comprehensive interaction matrix

| Effect/system | Trigger condition and unit | Current behavior with Flywheel | Expected behavior based on existing rules | Potential issue | Severity |
|---|---|---|---|---|---|
| Flywheel | Once per eligible selected Flywheel die, per Manual Reroll action | **Verified — test/source:** consumes one invocation; changes cost only; no extra roll | **Documented intent:** automatic coverage | Mixed pricing is stronger than the prose explains | Medium |
| Normal Manual Rerolls / Inferno Extra Reroll | Once per actual resource spent | **Verified — source:** spend occurs after Flywheel adjustment; upgrades only enlarge normal reserve | **Documented intent:** permanent reserve size | Correct | None |
| Care Package | Once per actual resource spent after normal reserve | **Verified — test/source:** fully covered costs 0; mixed costs 1; normal pays first | **Documented intent:** additional persistent Manual Rerolls | Correct; no direct Flywheel test | Low coverage gap |
| Jump Start Flame | One Charge multiplication per paid attribution ID | **Verified — source:** full Flywheel gives 0; mixed gives exactly 1, regardless selected count | **Documented intent conflicts:** test says “Rerolls spent”; player copy says “Each die you Manual Reroll” | Flywheel changes triggers from per-die/action semantics to per-resource semantics | Medium |
| Lightning Strike Flame | Once per predicted die after one Manual Reroll action | **Verified — probe/source:** independent hits compound; all-Flywheel can cost 0; each Flywheel use spent once; Charge cap respected | **Documented intent:** independent predictions and capped multiplicative rewards | Comparison occurs after queued follow-up Rolls; stale verbose copy still says “at least one” | High for chained result; Low for copy |
| Third Rail Flame | Once per non-intercepted installed result showing rank 3 | **Verified — source:** selected Flywheel die is ordinary `manual` batch input; each landing on 3 triggers once | **Documented intent:** per Rolled 3 | Correct; Jumping Bean follow-up can legitimately trigger again as a separate Roll | None |
| Casual Flame | At later Ultimate Play, based on Manual Reroll action count | **Verified — source:** even a zero-cost Flywheel action disables Casual | **Documented intent:** “if you have not used a Manual Reroll” | Correct if “used” means action, not resource | None |
| Hail Mary Flame | At Play, when normal reserve is 0 | **Verified — source:** ignores Care Package and Flywheel, and can qualify while either remains | **Documented intent:** explicitly says “normal Manual Rerolls” | Correct by current copy, though unlike dead-board eligibility | None |
| Curtain Call die | Once per selected eligible die before a manual batch | **Verified — test/source:** Flywheel cost does not suppress it; Free Play happens before the face changes | **Documented intent:** before manually rerolling this die | Correct; fully free Flywheel actions still trigger it | None |
| Jumping Bean die | Once per qualifying non-intercepted landing, followed by a separate automatic Roll | **Verified — source:** Flywheel does not add triggers; a manual landing and each chained follow-up are separate physical Rolls | **Documented intent:** whenever this die Rolls its chosen number | Correct by itself; creates Lightning comparison ambiguity | High in Lightning combination |
| Momentum, Power Surge, Minigun, Hot Streak, Hot Potato, progressive sequences, and other Play observers reached through Curtain Call/Jumping Bean | Once per generated Free Play according to each Flame's ordinary qualification | **Verified — source/tests:** generated Plays use the canonical Play pipeline; Flywheel only determines whether the initiating manual action costs resources | **Documented intent:** Free Plays remain real Plays with source-specific qualification | No Flywheel-specific duplication found; Hot Potato and some sequence state can advance during the reroll's generated Play | None |
| Basic, Bonus, Furnace, Workout, Tank, Golden, Vintage, Double Time, Sustainable, and other Score observers reached through Curtain Call/Jumping Bean | Once per canonical Score occurrence according to each die effect | **Verified — source/tests:** the generated Free Play resolves ordinary Pips and Score effects before/following the requested roll as appropriate | **Documented intent:** these effects respond to Scoring, not resource spend | No Flywheel-specific duplication found | None |
| All In, Bribery, Double or Nothing, and armed Charge | Consumption is restricted to a qualifying manual Play/root package | **Verified — source:** Curtain Call and Jumping Bean Free Plays do not consume these pending manual-Play modifiers | **Documented intent:** next manual Play where specified | Correct | None |
| Stored Dare Devil payoff | Next Ultimate Play, including a generated Free Play | **Verified — source:** a Curtain Call/Jumping Bean Ultimate can receive and consume stored Dare count | **Documented intent:** “next Ultimate,” with no manual-only qualifier | Correct by current wording; worth preserving in combination tests | Low coverage gap |
| Magic die | Once on the next eligible reroll of that die | **Verified — source:** Flywheel does not change priority or consume an extra Magic use | **Documented intent:** force the next Reroll to the armed face | Missing-rank forced resolution can land on another rank after Chameleon mutation | High in affected combination |
| Magnetic die / Flux Capacitor Flame | Magnetic: once per attracted die until anchor uses exhaust; Flux: once per batch using count attracted | **Verified — source:** a selected Magnetic die cannot anchor because it is in the rolling set; an unselected anchor can pull Flywheel-selected dice | **Documented intent:** copy anchor's exposed rank; Flux scales with affected dice | Forced missing-rank bug reproduced with Chameleon; event says Magnetic but installed rank differs | High |
| Clockwork die | Once per eligible reroll attempt, up to `3 × level` | **Verified — source:** Flywheel action is a reroll and advances the controller once | **Documented intent:** next face in sequence | Uses the same missing-rank `forced()` helper and can fail after Chameleon removes the target rank | High potential |
| Tank die | Once per reroll attempt, not per landing | **Verified — source:** Flywheel use/resource accounting occurs; Tank keeps its face, adds Pips, suppresses `DIE_ROLLED` and landing reactions | **Documented intent:** every action/effect that attempts to Reroll it | Correct; Lightning may correctly predict the retained face | None |
| Weighted die | Per randomized physical-face selection | **Verified — source:** Flywheel does not change weights; manual batch still excludes the starting physical face | **Documented intent:** selected-number faces are more likely | Correct; duplicate ranks remain separately weighted physical faces | None |
| Chameleon die / duplicate ranks | Prediction options are one per distinct rank; rolling still selects physical faces | **Verified — tests/source:** duplicates are deduplicated for Lightning; Flywheel does not alter outcome identity | **Documented intent:** predictions compare numerical outcome, not physical identity | Forced controller helper assumes requested rank maps to a usable physical index when rank is absent | High in controller combination |
| Snake Eyes face mutations | Scored physical faces mutate to rank 1 | **Verified — source:** later predictions derive from current face definitions; Flywheel does not bypass mutation | **Documented intent:** scored faces turn into 1s | Same duplicate/missing-rank controller risk as Chameleon | Medium |
| Infected faces | Suppression based on currently exposed face | **Verified — source:** an exposed Infected face prevents Flywheel coverage; if another Flywheel participates, the suppressed die is uncovered | **Documented intent:** Infected suppresses the die's special effects | Correct; eligibility is based on the pre-roll face | None |
| Warden | Active-die filter before validation | **Verified — source/tests:** locked dice cannot be selected, covered, predicted, or rolled | **Documented intent:** only released dice are active | Correct | None |
| Hexer Cursed Die / rank 7 | Boss-owned required die; ordinary selectable reroll target | **Verified — tests/source:** cannot own Flywheel, but can join a mixed Flywheel selection; rank 7 is a defined prediction identity | **Documented intent:** Cursed Die joins and must be used | Mixed Flywheel can reduce a Cursed + many-die selection to one resource; balance intent is unstated | Medium ambiguity |
| Magician missing die | Missing die excluded from active encounter; RNG mercy correction on “final opportunity” | **Verified — source:** missing die cannot be selected; correction checks only normal + Care Package reserves | **Ambiguous intent:** final opportunity should likely include remaining legal Flywheel actions | Can force a called rank even when another zero-cost Flywheel action remains | Medium |
| Tightrope | Starts Round with 0 normal Rerolls | **Verified — source:** Flywheel-only actions validate at zero reserve, but `evaluate()` may Bust before the player can take one | **Documented intent:** start with 0 Rerolls, not “disable Flywheel” | Legal Flywheel action ignored by dead-board terminal check | High |
| Bottled Fairy | When dead board has zero normal + Care Package resources | **Verified — source:** refills before considering unused Flywheel coverage | **Documented intent:** refill “if you would Bust” | It can be consumed even though a legal free Flywheel action exists | High |
| Fly boss mercy | Becomes active when normal reserve reaches 0 | **Verified — source:** ignores both Care Package and Flywheel | **Ambiguous intent:** boss copy only says doubled Manual Rerolls; mercy rule is not player-documented here | Mercy can activate while paid or free rerolls remain | Medium |
| Dare Devil | One effect-generated batch over all active player dice | **Verified — source:** not `manual`; spends no resources and does not trigger/consume Flywheel, Jump Start, Curtain Call, Casual, or Lightning | **Documented intent:** Roll all available player dice, not Manual Reroll | Correct | None |
| Post-Play rerolls, Crawler, and Juggler | Separate `post_hand`, `winning_settle`, or `juggler` batches | **Verified — source/tests:** no Flywheel coverage or consumption; controllers/landing reactions still apply | **Documented intent:** automatic post-Play Rolls | Correct | None |
| Magician return Roll | Separate effect-generated batch | **Verified — source:** no Flywheel; normal roll controllers/reactions apply | **Documented intent:** returned die Rolls | Correct | None |
| Dead-board rescue telemetry | Once after initiating manual action if board becomes playable/cleared | **Verified — source:** selected dice and cost are recorded correctly | **Inferred intent:** a legal manual option should prevent premature Bust | Terminal eligibility omits Flywheel | High |
| Run history, playback, and counters | Action, batch, result, and spend have separate records | **Verified — source/tests:** one manual action; N selected dice; 0/1/N charges; one batch; N results; separate follow-up batches | **Inferred intent:** deterministic audit trail | Correct; legacy standalone Flywheel resolver remains dead code | Low maintainability |
| Hand training | No reroll or roll observer found | **Verified — source search:** training changes hand levels only | No expected Flywheel interaction | None | None |

## Findings by severity

### Critical

No Critical issue was found.

### High

#### FWA-01 — Dead-board termination ignores legal zero-cost Flywheel actions

**Status:** Verified — probe and source.  
**Affected code:** `validateManualReroll` in [`engine.ts:648-658`](../src/game/engine.ts#L648); `usableManualRerolls` in [`specialOffers.ts:52-54`](../src/game/specialOffers.ts#L52); `evaluate` in [`effects.ts:3049-3062`](../src/game/effects.ts#L3049).

`validateManualReroll` correctly permits an all-Flywheel selection with zero normal and zero Care Package reserves because its calculated resource cost is zero. `evaluate()`, however, decides whether the board may continue using only `normal + Care Package`. It never asks whether any zero-cost Flywheel selection remains.

**Concrete reproduction:** create a dead board with all currently qualifying Hands consumed, leave another rank's Hand available, set both reroll reserves to zero, and give an active die one unused Flywheel invocation. Before evaluation, `validateAction({ type: 'MANUAL_REROLL', dieIds: [flywheelId] })` returns `null`. Calling `evaluate()` immediately changes phase from `round` to `shop`, reduces Lives from 3 to 2, and records a Bust.

This also affects Tightrope opening boards and can consume Bottled Fairy prematurely. The expected rule is inferred from the authoritative action validator: if the action is legal, a dead-board check should not make it unreachable.

#### FWA-02 — Lightning Strike observes Jumping Bean's terminal chain state, not its manual-batch result

**Status:** Verified — probe and source; intended boundary is ambiguous.  
**Affected code:** `manualReroll` drains the queue at [`effects.ts:2241-2242`](../src/game/effects.ts#L2241); Jumping Bean chain at [`effects.ts:1093-1109`](../src/game/effects.ts#L1093); Lightning comparison at [`effects.ts:2094-2100`](../src/game/effects.ts#L2094).

Lightning calls `manualReroll`, which rolls, applies reactions, drains all Jumping Bean follow-ups, and evaluates the Round. Only after that method returns does Lightning read each die's current face.

**Concrete reproduction:** start a Jumping Bean die on rank 6, configure its chosen number as 1, predict rank 1, force the manual batch to land on 1, then force the automatic Jumping Bean follow-up to land on 2. History records a `manual` batch `6 → 1` and a `jumping_bean_followup` batch `1 → 2`; Lightning records actual rank 2 and a miss.

There is no duplicate Lightning reward because Lightning is not subscribed to roll events—it evaluates exactly once per submitted prediction. The issue is which outcome owns the prediction. Existing copy says “final outcome,” while the prior interaction design emphasizes resolution after reroll controllers; Jumping Bean is a post-roll reaction, not a controller. This rule needs an explicit decision.

#### FWA-03 — Forced controllers can install a different rank when Chameleon removed the target rank

**Status:** Verified — probe and source.  
**Affected code:** shared `forced()` helper and Magic/Magnetic/Clockwork paths in [`effects.ts:919-956`](../src/game/effects.ts#L919); Chameleon-derived outcome definitions in [`dice.ts:13-20`](../src/game/dice.ts#L13).

The helper searches for a physical face with the target rank. If none exists, it falls back to using the target rank as a physical-face index. On a duplicate/missing-rank Chameleon die, that physical face may contain a different rank. History and later reactions use the installed face, not the helper's intended `value`.

**Concrete reproduction:** make die 0 a Chameleon + Flywheel die with faces `[2,2,3,3,4,4]`; make unselected die 1 a Magnetic anchor showing 6; set both resource pools to zero; manually reroll only die 0. Validation succeeds through Flywheel. The batch records controller `magneticDie`, anchor die 1, and physical face 6, but its installed/final rank is 4. Magnetic promised rank 6.

The same helper is used by Magic and Clockwork, so both are exposed to the same class of failure. For Lightning, the UI correctly refuses rank 6 because it is not a defined Chameleon outcome, but the controller's own semantics are violated and its activation message can disagree with the result.

### Medium

#### FWA-04 — Jump Start's trigger unit conflicts with player-facing wording

**Status:** Verified — source; documented intent conflicts.  
**Affected code:** [`effects.ts:2232-2238`](../src/game/effects.ts#L2232), [`effectDescriptions.ts:63`](../src/game/effectDescriptions.ts#L63), [`flames.ts:235-236`](../src/game/flames.ts#L235), [`chargeFamily.test.ts:82-90`](../src/game/chargeFamily.test.ts#L82).

The implementation triggers once per resource-attributed uncovered die. A fully covered selection produces zero Jump Start triggers. Any mixed selection produces exactly one trigger. The current test explicitly calls this “the actual number of Rerolls spent,” but the player copy says “Each die you Manual Reroll.”

**Concrete reproduction:** own full-investment Jump Start; select one active Flywheel die and two ordinary dice. All three dice receive manual roll intents, stats add three to `manualDiceRerolled`, but Jump Start multiplies Charge only once. Select only multiple Flywheel dice and it triggers zero times.

#### FWA-05 — Magician “final opportunity” does not count remaining Flywheel actions

**Status:** Verified — source; expected behavior is inferred.  
**Affected code:** [`effects.ts:1040-1059`](../src/game/effects.ts#L1040), [`specialOffers.ts:52-54`](../src/game/specialOffers.ts#L52).

The Magician correction becomes eligible when normal plus Care Package reserves equal zero and the pre-roll board has no playable Hand. It does not consider an unused Flywheel invocation on another die or a higher-level Flywheel with uses remaining after the current action.

**Concrete reproduction:** during the Magician encounter, set normal and Care Package reserves to zero, leave two legal Flywheel-only rerolls (or a level-2 Flywheel), and start from a dead board with outstanding called Hands. On the first free manual action, the engine may rewrite an RNG result to a called rank as if it were the final opportunity.

#### FWA-06 — Mixed-selection pricing is not explained by the Flywheel rule

**Status:** Verified — test/source; intended balance is ambiguous.  
**Affected code:** [`manualRerolls.ts:25-29`](../src/game/manualRerolls.ts#L25), [`effectDescriptions.ts:36`](../src/game/effectDescriptions.ts#L36), [`interactionUxCleanup.test.ts:51-58`](../src/game/interactionUxCleanup.test.ts#L51).

**Concrete reproduction:** select one eligible Flywheel die plus four ordinary or boss dice. Cost is one total resource, not four uncovered resources. This is explicitly tested, so it is current implementation intent, but the displayed rule can reasonably be read as covering only the Flywheel die.

#### FWA-07 — Fly boss mercy ignores Care Package and Flywheel availability

**Status:** Verified — source; intent is ambiguous.  
**Affected code:** [`effects.ts:1327-1341`](../src/game/effects.ts#L1327).

**Concrete reproduction:** reach zero normal resources during The Fly while retaining Care Package resources or an unused Flywheel. The next Fly movement sets `mercyActive` even though further Manual Rerolls are available. This pre-existing normal-reserve check is not caused by Flywheel, but Flywheel increases the semantic mismatch.

### Low

#### FWA-08 — Lightning Strike's verbose description still documents the retired one-hit rule

**Status:** Verified — source.  
**Affected code:** [`effectDescriptions.ts:96`](../src/game/effectDescriptions.ts#L96) versus [`flames.ts:270`](../src/game/flames.ts#L270) and [`effects.ts:2102-2114`](../src/game/effects.ts#L2102).

**Concrete reproduction:** open the full Lightning Strike detail text. It says “If at least one final outcome matches,” while the effect summary, modal, engine, telemetry, and tests use an independent multiplier for every correct die.

#### FWA-09 — Obsolete standalone Flywheel dispatch and resolver code remains

**Status:** Verified — source.  
**Affected code:** rejection in [`engine.ts:776-782`](../src/game/engine.ts#L776); unreachable resolver in [`effects.ts:1972-1981`](../src/game/effects.ts#L1972).

**Concrete reproduction:** validated dispatch of `INVOKE_FLYWHEEL` is rejected, but `Resolver.invokeFlywheel()` still implements the old one-die, non-manual `other` roll. It is not reachable through the authoritative command path, so this is a maintenance risk rather than a current player-facing bug.

## Lightning Strike compatibility assessment

### Confirmed correct

- **Independent predictions:** one result is built per submitted die, and every hit calls `growCharge` once ([`effects.ts:2095-2111`](../src/game/effects.ts#L2095)).
- **Multiplicative reward:** the requested combined factor is `perPredictionFactor ** hitCount`; individual calls compound against current Charge ([`effects.ts:2106-2114`](../src/game/effects.ts#L2106)).
- **Charge caps:** every call uses `min(maxCharge, before × factor)` and records requested versus applied factor ([`effects.ts:763-785`](../src/game/effects.ts#L763)).
- **One manual action:** Lightning delegates to exactly one `manualReroll(dieIds)` call.
- **Flywheel accounting:** all-covered predictions can cost zero; mixed predictions cost one; each covered selected Flywheel consumes one invocation. A deterministic two-die probe produced two Lightning Charge events, one Manual Reroll action, two manually rerolled dice, zero resource spend, and one consumed invocation on each Flywheel.
- **Care Package:** adjusted cost is split normal-first, Care-Package-second. Lightning's diagnostic spend is computed from the same cost before calling `manualReroll` and matches the canonical spend.
- **No duplicate rewards from roll events:** Lightning has no `DIE_ROLLED` listener and rewards only after `manualReroll` returns.
- **Chameleon duplicate outcomes:** options and comparisons use distinct rank identities, not physical-face identity ([`dice.ts:8-20`](../src/game/dice.ts#L8), [`flameUpdatePass3A.test.ts:244-250`](../src/game/flameUpdatePass3A.test.ts#L244)).
- **Hexer rank 7:** rank 7 is defined by the seven-faced Cursed Die and is tested end-to-end ([`bosses.ts:271-278`](../src/game/bosses.ts#L271), [`flameUpdatePass3A.test.ts:252-259`](../src/game/flameUpdatePass3A.test.ts#L252)).
- **Tank:** an intercepted reroll keeps its exposed rank; Lightning compares that retained final rank once.
- **Magic, Magnetic, Clockwork, Magician correction, and Weighted:** Lightning normally compares after controller arbitration and installed-face resolution, which is the correct architectural point for controllers.

### Not confirmed correct

- **Jumping Bean ownership of the prediction result:** current comparison is after all queued follow-up Rolls, not after the `manual` batch result (FWA-02).
- **Missing-rank forced controllers:** final installed rank can violate the controller's target after Chameleon/Snake Eyes mutations (FWA-03).
- **Round-ending pre-roll effects:** Curtain Call can run before the predicted roll; the pipeline does not stop the requested batch merely because that Free Play may change Round state. No current test defines Lightning behavior when Curtain Call clears the Round before the dice roll.
- **Player-facing detail text:** one description still states the obsolete “at least one” mechanic (FWA-08).

### Prediction-interface semantics

The modal derives choices from `distinctDieOutcomes(die)`, renders the actual die component, and submits one defined outcome per selected die ([`LightningStrikeModal.tsx:20-78`](../src/components/LightningStrikeModal.tsx#L20)). It does not assume six ranks; it supports the Cursed 7 and deduplicates Chameleon ranks. The current `DieOutcomeIdentity` union contains only rank outcomes; no nonnumeric face identity exists in the current model ([`types.ts:339-343`](../src/game/types.ts#L339)).

Flywheel itself introduces no new outcome and therefore requires no extra prediction option. The interface does not explain controller-constrained results (for example, Tank retention or armed Magic) or the fact that Jumping Bean may replace the manual result before evaluation. Those omissions become materially misleading in FWA-02 and FWA-03.

## Rule clarifications required

1. **Terminal reroll availability:** define whether “rerolls remain” means stored resources or any currently legal Manual Reroll action, including a zero-cost Flywheel selection. The validator and dead-board evaluator should share the chosen definition.
2. **Mixed Flywheel cost:** confirm whether one participating Flywheel intentionally changes the entire mixed action to one total resource, or whether only Flywheel dice should be subtracted from ordinary per-die cost.
3. **Jump Start unit:** choose one of: selected die, uncovered selected die, physical roll attempt, Manual Reroll action, or actual resource spent. Align copy, telemetry attribution, and tests.
4. **Lightning outcome boundary:** choose the result of the `manual` roll batch after controllers, or the die's terminal face after all post-roll chains. Explicitly define Jumping Bean and any future chained reactions.
5. **Forced absent ranks:** define what Magic, Magnetic, and Clockwork do when Chameleon/Snake Eyes has removed the requested rank. Options include no activation, nearest/next defined outcome, temporary identity, or an explicit physical-face rule.
6. **Boss mercy:** define whether Magician/Fly mercy checks normal reserves only, all stored resources, or all legal reroll actions including Flywheel.
7. **Curtain Call clear:** define whether a Manual Reroll/Lightning action continues if its pre-roll Curtain Call Free Play clears the Round.

## Test validation and coverage gaps

### Executed existing tests

| Command | Result |
|---|---|
| Focused Vitest run covering Flywheel, Lightning, Charge Flames, configurable dice, Curtain Call, Care Package, bosses, and resolution architecture | 9 files passed; 144 tests passed |
| `npm test` | 74 files passed; 804 tests passed |

No source, test, fixture, snapshot, or gameplay file was changed. The deterministic probes loaded the existing modules in memory and mutated only ephemeral game states.

### Proposed regression tests

1. **Flywheel dead-board availability:** with zero normal/Care Package reserves and one unused Flywheel, assert `evaluate()` does not Bust while an all-covered selection is legal.
2. **Tightrope + Flywheel opening:** deterministic dead opening, zero reserves, unused Flywheel; assert the player reaches an actionable Round state.
3. **Bottled Fairy + Flywheel:** assert the Fairy is not consumed while a legal free Flywheel rescue remains, if that is the chosen rule.
4. **Mixed-cost boundary:** table-test zero, one, and several covered/uncovered dice, including an exhausted and an Infected Flywheel.
5. **Jump Start + Flywheel:** table-test all-covered and mixed batches after choosing the intended trigger unit.
6. **Lightning + all-Flywheel:** zero stored resources, multiple correct predictions, one manual action, zero charges, one invocation per covered die, one reward event per hit, cap applied.
7. **Lightning + mixed Flywheel + Care Package + Cursed 7:** assert exact normal/Care/Flywheel spend and independent mixed hit/miss results.
8. **Lightning + Jumping Bean:** make manual and follow-up outcomes differ; assert the chosen prediction boundary and exactly one evaluation per prediction.
9. **Lightning + Tank:** predict retained face, verify one hit, no `DIE_ROLLED`, and normal action/resource/Flywheel accounting.
10. **Flywheel + Chameleon + Magnetic/Magic/Clockwork:** target a missing rank and assert the explicitly chosen forced-outcome rule.
11. **Magician final opportunity:** retain another legal Flywheel use at zero stored resources and verify mercy correction timing.
12. **Warden and Magician availability:** assert locked/missing dice cannot gain coverage through mixed selection or appear in Lightning predictions.
13. **Event cardinality:** for a multi-die Flywheel batch, assert one manual command/event/batch, N roll intents/results, correct Tank exceptions, and separate Jumping Bean batches.
14. **Curtain Call clears Round:** define and assert whether the requested roll and Lightning evaluation continue.
15. **Fly mercy with Care Package/Flywheel:** assert mercy activation against the clarified resource rule.

## Prioritized remediation plan

1. **Make the rule decisions first:** terminal availability, Lightning/Jumping Bean boundary, mixed cost, Jump Start unit, and missing-rank controller behavior.
2. **Unify Manual Reroll availability:** introduce one authoritative query that can answer both “can this submitted selection be paid?” and “does any legal selection remain?” Use it in validation, `evaluate`, Bottled Fairy, and Magician/Fly mercy where the clarified rules require it.
3. **Bind Lightning to an explicit result artifact:** return or retain the canonical `manual` batch results instead of rereading mutable die state after queue drain, if the manual-batch boundary is selected.
4. **Repair forced-outcome resolution:** never translate a missing rank into an unrelated physical index. Record controller intent and installed outcome consistently.
5. **Align Jump Start and Flywheel copy/tests:** implement the chosen unit without duplicating resource calculations.
6. **Add the combination tests above, then run the full unit and browser suites.**
7. **Clean low-risk debt:** update Lightning's verbose description and remove the rejected legacy Flywheel command/resolver only after gameplay decisions and regression coverage are in place.
