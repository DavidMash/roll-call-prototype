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

- Choose a hand to select a deterministic participating set, or click dice to constrain the available hands. Press **PLAY** to resolve it.
- Upper-section hands may contain any non-empty subset of dice currently showing that number. Clicking the hand initially selects all matching dice, but the player may deselect individual matching dice before pressing Play. A dice-first matching subset is preserved when choosing its upper hand.
- This lets the player preserve useful board structure—for example, keeping one duplicate 4 while rerolling another to pursue a straight. The chosen subset determines normal hand contributions, participating Multiplier, Sustainable, and scored-die rerolls. Unselected Hitchhikers can contribute pips and trigger their own Golden/Workout; unselected dice can also act through Slippy or roll effects. The upper category is normally consumed after one play, regardless of subset size.
- For ambiguous lower hands, deselect a chosen die and select a replacement. Lower hands still require exactly their prescribed number of participants. The play button requires a valid participating set.
- Each round gives the player **3 manual die rerolls**. A manual reroll charge rerolls one selected physical die. Multiple dice may be rerolled at once by spending one charge per die; the same die can be rerolled again in a later action. Select dice and press **Reroll Selected — N**. No hand is required, and selections clear when the action starts.
- Manual rerolls are real gameplay rolls: Weighted, Magnetic, and Jumping Bean use the existing effect queue. Sticky cannot block the player-requested roll. Manual rolls do not play or consume a hand, activate Slippy/Sustainable/Hitchhiker, or grant direct hand points. Automatic initial rolls, hand rerolls, ability rerolls, and flips spend no manual charges and never replenish them.
- The player cannot lose while manual rerolls remain. If no hand can be played, the player must use their remaining rerolls before the run can end. Loss requires **below goal + no legal unconsumed hand on the complete board + zero manual rerolls**. The whole current chain finishes before clearance or loss; an effect chain reaching the goal clears the round even on the final charge. Categories and the manual budget reset at the beginning of each gameplay round, before initial effects.
- Clearing grants **5 gold on Round 1, increasing by 1 each round**, and opens a shop with three distinct enhancement offers and a free roll of all five dice. Runs still begin with 0 gold; Golden income is separate from the round-clear reward.
- Drag an offer onto a die, or click **Select or drag** then click a die. Only its exposed physical face receives the purchase. A purchased offer stays unavailable until a paid refresh.
- Shop dice rerolls cost 1/2/4/8… gold; offer refreshes cost 3/6/12/24… gold. Both reset every shop and are separate from manual gameplay rerolls. The shop does not display, spend, or reset manual rerolls. Leave with **NEXT ROUND** whenever you want.
- **NORMAL / FAST / INSTANT** and **Skip playback** affect only visualization. Rules have already resolved synchronously.
- Open **Inspect all physical faces** to review your 30 physical faces, enhancement stacks, and persistent Workout pips.
- Open **Run data & event history** to copy structured run statistics, the action sequence, current RNG state, and board; or copy the complete readable event log. Clipboard failure provides a manual-copy dialog.
- Seeds are visible and editable. Restart the same seed, enter a specific seed, or start with a new seed. URL parameters `?seed=example&speed=instant` are also supported. Restarting or reloading replaces the in-memory run.

All 13 enhancements are implemented: Bonus, Multiplier, Jumping Bean, Golden, Workout, Missing Link, Mirror, Magnetic, Sticky, Slippy, Sustainable, Hitchhiker, and Weighted. The in-app reference describes each.

Prototype balance uses a **50-point base target**, **1.35x target growth per round**, and the round-clear gold progression above. These values reflect early playtesting and are expected to continue changing. They live in `src/game/config.ts` for tuning.

## Scoring categories

There are **14 categories** and no Chance hand. Ones through Sixes are upper-section categories at **x1**, using any non-empty selected natural matching subset.

| Lower hand | Participating dice | Base multiplier |
| --- | --- | --- |
| Pair | Exactly 2 assignable to one rank | x1.5 |
| Two Pair | Exactly 4 assignable to two distinct pairs | x2 |
| Three of a Kind | Exactly 3 assignable to one rank | x2.5 |
| Small Straight | Exactly 4 consecutive assigned ranks | x2.5 |
| Full House | Exactly 5 assignable to distinct 3/2 rank groups | x3.5 |
| Four of a Kind | Exactly 4 assignable to one rank | x4 |
| Large Straight | Exactly 5 consecutive assigned ranks | x4 |
| Five of a Kind | Exactly 5 assignable to one rank | x5 |

Pair and Two Pair use the same live scoring engine, consumption, Sustainable, and selection rules as other hands. Hand-first selection chooses the existing stable physical-index default; the player can deselect a die and choose a replacement. Dice-first selection keeps all compatible hands available, including upper/Pair ambiguity. Only selected participants contribute their Multiplier and normal scored-die rerolls; unselected Hitchhikers retain their usual pip contributions.

Mirror supports **Pair, Two Pair, Three of a Kind, Full House, Four of a Kind, and Five of a Kind**. Each physical Mirror fills one matching slot and scores its actual physical pips. Two Pair still needs two different assigned ranks: `3, Mirror-6, 5, 5` qualifies, while `3, 4, 5, Mirror-6` does not. Multiple Mirrors can fill different slots, including two distinct all-wild pairs. Missing Link remains straight-specific.

## Sustainable

**Sustainable:** The first time this physical face would cause a played hand to be consumed each round, the hand is preserved instead. That Sustainable face is then spent until the next gameplay round.

Each physical die/face has its own once-per-round use. Only selected participating faces qualify; an unselected face, including a scoring Hitchhiker, neither preserves the hand nor spends a charge. If several available Sustainable faces participate, only the one on the lowest-index physical die is spent. Already-spent faces are ignored, leaving other available selected faces able to preserve later plays.

The charge remains spent when the die rolls away and back, when Magnetic flips it, and throughout the shop. All physical faces reset before the next round's initial roll. The exposed badge dims and says **Sustainable · spent** during gameplay; the face inspector also shows spent charges. The shop continues to show Sustainable normally, and its price and non-stackable purchase rule are unchanged.

Sticky still keeps the die in place: the first play may preserve both the face and category, but a second play using the same spent face consumes the category. This keeps their synergy while preventing infinite repeatable hands. Winning hands record and spend Sustainable consistently after the final score award, before clearance, without any post-hand rerolls. The [Sustainable audit](docs/sustainable-audit.md) describes the domain state and event boundary.

## Hand scoring

A played hand has two live scoring values: **Pips** and **Multiplier**. Scoring faces and effects modify those values during resolution. Once all hand-bound effects finish, the hand scores **Pips × Multiplier**, adding that result to round score exactly once.

- Selected faces contribute printed pips plus previously earned Workout growth. Bonus adds **10 Pips per stack** before multiplication. Each selected Multiplier stack adds **0.5** to the hand's base multiplier.
- Each currently showing, unselected Hitchhiker adds its full scoring-pip value, including Bonus and prior Workout growth, to the active hand before multiplication. A selected Hitchhiker does not contribute twice. A Hitchhiker-only face's own Multiplier does not affect the hand because that die was not selected as a participant.
- Golden adds gold once whenever a selected or Hitchhiker face scores, without multiplication. Workout increases that physical face after its current contribution, before hand finalization; the current hand keeps the pre-increment pips.
- After finalization, spend one available selected Sustainable charge to preserve the category, or record consumption, then check the round target. If a played hand reaches or exceeds the target, its hand-bound scoring effects finish and the round immediately clears. The dice do not perform normal post-hand rerolls; Sticky/Slippy and Weighted/Magnetic/Jumping Bean effects that would only result from those skipped rolls do not occur.
- If the hand leaves the round below target, normal Sticky/Slippy rerolls and their complete roll-effect chains proceed before clearance/loss is checked. Initial-roll, manual-reroll, and active Jumping Bean chains still finish completely even if they cross the target. The existing free five-die shop exposure roll happens separately after `ROUND_CLEARED`; it is not a post-hand gameplay reroll.
- Jumping Bean remains independent scoring for initial, manual, post-hand, and chained rolls: its scoring pips × (1 + its own Multiplier stacks × 0.5). It does not change a finalized hand accumulator. Its Golden and Workout trigger as usual.

The center playback displays persistent **PIPS / MULT** values as contributions build, then the final multiplication and score addition. The [scoring audit](docs/scoring-audit.md) records the previous behavior and the domain/event changes.

## Architecture

`src/game/` contains the rules independently of React:

| Module | Responsibility |
| --- | --- |
| `config.ts` | Targets, rewards, costs, multipliers, enhancement strengths, timing, safety cap |
| `types.ts` | Physical faces/dice, board, actions, events, statistics |
| `rng.ts` | Serializable Mulberry32 random stream and seed hashing |
| `dice.ts` | Face pips, opposite faces, weighted gameplay/shop rolls |
| `hands.ts` | Physical subsets, distinct matching-group assignments, straight wilds, deterministic defaults |
| `selection.ts` | Selection in both directions; constraints never decide loss |
| `scoring.ts` | Selected-hand and standalone pip/multiplier calculations |
| `enhancements.ts` | Complete catalog, stacks, placement eligibility |
| `effects.ts` | FIFO roll triggers, scoring order, reroll batches, round boundaries |
| `engine.ts` | Validated immutable commands, new runs, injectable randomness |
| `telemetry.ts` | Round/run statistics, board snapshots, structured exports |

`newRun(seed)` and `dispatch(state, action)` return `{ state, events, error? }`. They clone the input, resolve synchronously, and produce ordered events with board snapshots. Rejected commands preserve the input and consume no randomness. `useGame.ts` plays the snapshots; it never determines a roll, score, purchase, or phase transition. One serialized RNG stream supplies dice rolls, magnetic destinations, shop exposure, and offer selection. Tests can inject a `RandomSource` with `next()` in `[0, 1)`.

For programmatic reproduction with the same rules version, call `newRun(data.seed)`, then dispatch each item in exported `data.actions`. Engine tests verify entire states and traces, and browser tests compare the visible board with the pure engine after actions.

## Deterministic edge-case choices

- **Target rounding:** use `round(50 × 1.35^(round−1) / 5) × 5`, keeping the existing nearest-multiple-of-five rounding. Targets for Rounds 1–10 are **50, 70, 90, 125, 165, 225, 305, 410, 550, 745**. The formula is centralized for tuning.
- Batch dice draw all outcomes before roll effects consume RNG. Dice, face lists, and default subsets use ascending physical index. Triggers from each die are queued Weighted → Magnetic → Jumping Bean; chains append to the FIFO queue. When a Magnetic trigger flips multiple dice, destinations are drawn in physical-die order, including a draw for a die with only one magnetic face.
- Jumping Bean uses the complete landed-face snapshot, including pips and Sticky, even if a queued Magnetic effect changed its visible face. Workout increments the triggering physical face after scoring. Magnetic destinations are never rolls and do not create roll triggers.
- A stack activation counts once per enhancement per relevant face/event; its numeric effect includes all stacks. Wild feedback is shown for participating wild faces in the relevant hand family, including when their natural rank could qualify. This explains qualification without changing actual pips.
- Hitchhiker contributes pips to the selected hand without adding a scored reroll; its die may still reroll through Slippy. Sustainable applies only to selected-hand participants, once per physical face per round. Successful activations retain the existing trigger count and add `sustainableActivations` records with round, die, face, and hand; per-round counts and distinct activated faces can be derived from these records. `ABILITY_TRIGGERED` identifies the spent face explicitly with `sustainableSpent: true`. Slippy is deduplicated into the ordinary post-hand batch and can override Sticky's scoring suppression.
- A winning played hand emits `POST_HAND_REROLLS_SKIPPED` and bypasses the entire gameplay reroll scheduler. No skipped reroll draws, Slippy activations, or resulting roll chains are recorded. Pair/Two Pair counts and multiplied scores use the existing per-hand telemetry maps and final hand records.
- Manual rerolls reject empty, duplicate-ID, invalid-ID, over-budget, and outside-round requests without changing state or consuming RNG. Accepted batches use ascending physical-die order, charge once for the initial selected dice, and clear dice/hand selection immediately. No extra charges or refunds arise from subsequent effects. A dead-board rescue is counted once per manual action if the pre-action gameplay board had no playable hand and the completed chain creates one or reaches the target, evaluated before shop exposure rolls.
- Run exports record per-round manual grants, charges spent, action count, rescue count, and charges left at clearance. Run totals include manual actions, physical-die reroll count (including repeats), rescue count, and each manual batch's physical IDs, cost, remaining budget, and rescue flags. Loss records distinguish a manual reroll from the most recent hand play. The action sequence remains replayable from the seed.
- Export schema **2**, scoring model **hand-accumulator-v1**, preserves existing fields and adds final hand arithmetic, hand Bonus pips, and Hitchhiker pips contributed. All final multiplied hand score belongs to `scoreBySource.hand` and the selected category. The legacy `scoreBySource.hitchhiker` key remains present at zero; schema 1 used it for separate standalone Hitchhiker score. Historical exports retain their original semantics.
- A resolution exceeding 10,000 emitted events stops in a diagnostic state, writes a development error, preserves its trace, and permits restart. This is an exceptional guard, not a gameplay loss. There is no finite-round win condition.

## Validation

Unit tests cover every hand family, upper-hand subsets and their participation-based enhancement effects, subset ambiguity, both wilds, enhancement stacking and interactions, shop legality and costs, weighted distributions, magnetic snapshots, roll chains, safety diagnostics, round clearance/loss, telemetry totals, and seeded replay. Manual reroll tests cover per-die charging, repeated dice, rejection without RNG use, every currently showing enhancement, initial-effect resets, hand/ability independence, roll-trigger chains, final-charge rescues/clears/losses, telemetry, and shop separation. A multi-seed engine audit plays complete runs through purchases, manual rerolls and eventual loss. Browser tests cover the actual play/shop/loss/export flow, drag-and-drop, offer refreshes, physical-subset changes, playback skipping, and a narrow viewport. Both hand-first and dice-first browser cases verify that playing one 4 on a 1/2/4/4/5 board scores and rerolls only that physical die, preserves the duplicate, and still consumes Fours. Browser tests also cover single/multi-die manual spending, disabled controls during playback, cleared selection, deterministic dead-board guidance, rescue, and loss only after the final roll completes. Dead-board browser states are produced by seeded legal player actions; there is no test-state injection into the game UI.

Validation commands: `npm.cmd test` (225 unit tests), `npm.cmd run test:browser` (sixteen browser checks), `npm.cmd run typecheck` (also invoked by the build), and `npm.cmd run build`. `npm` works equivalently in shells where PowerShell does not intercept it with a blocked script. Sustainable coverage includes the Sticky exploit, independent physical charges, stable single-charge selection, reroll/Magnetic/shop persistence, round reset, winning-hand bookkeeping, and an actual seeded shop-purchase browser reproduction with visible spent feedback.

No known gameplay blockers. Browser automation exercises a real pointer drag onto an exposed die face and visible Jumping Bean feedback on the next round's initial roll. Clipboard access depends on the browser; the manual-copy fallback is included. The prototype intentionally has no persistence, backend, deployment, audio, or elaborate art.

## Questions for playtesting

1. Are there meaningful choices between consuming an upper hand and reserving dice/categories for a larger hand?
2. Do face-specific upgrades and shop exposure make physical dice feel different, particularly when choosing three of four matches?
3. Are Bonus and Sustainable/Sticky combinations too dominant relative to wilds, gold, and roll-chain abilities?
4. Does target growth produce useful run lengths, and is gold sufficient to experiment with both purchases and rerolls?
5. Can players explain every score and reroll from the visible ticks, especially Magnetic plus Jumping Bean?
