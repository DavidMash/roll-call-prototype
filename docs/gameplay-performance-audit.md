# Roll Call gameplay performance audit

Date: 2026-11-14  
Scope: investigation only; no gameplay or production behavior changes

## 1. Executive summary

The most important confirmed problem is dice-selection work. In a production build, selecting one die took a 103.3 ms median and 123.4 ms worst observed desktop click round trip (three samples). At a 360×740 viewport with 4× CPU throttling, the median was 566.2 ms. A focused Chrome measurement of one desktop selection attributed 117.9 ms of 133.1 ms main-thread task time to script, versus only 3.3 ms of layout and 2.5 ms of style recalculation. This is computation/render work, not a paint-heavy die animation.

The root cause is a combination of:

- selection state living in `App`, causing the active application tree to render again (`src/App.tsx:54-77`, `src/App.tsx:253-313`);
- `toggleBoardDie` testing every encounter hand through full, ranked legal-combination generation (`src/game/selection.ts:97-108`);
- `legalHandCombinations` generating combinations and sorting them with repeated canonical score previews (`src/game/selection.ts:36-56`);
- `RoundScreen` repeating selection normalization, qualification, scoring previews, validation, dead-board checks, and Flame-presentation derivation during that render (`src/components/RoundScreen.tsx:80-146`);
- the Dice Dock and scorecard also deriving state again (`src/components/DiceDock.tsx:33-49`, `src/components/HandList.tsx:179-184`, `src/game/scorecardAvailability.ts:10-15`).

A second confirmed problem is Speed Demon. Its 50 ms `setInterval` updates `RoundScreen` state (`src/components/RoundScreen.tsx:70-74`). During a two-second idle production sample, a normal Round screen used 2.1 ms of main-thread task time and 0.1 ms of script; adding Speed Demon increased those figures to 155.4 ms and 123.6 ms, with 44 style recalculations. This timer repeatedly drives the expensive Round render path even when the player does nothing.

Normal gameplay commands were not generally slow on the test machine. Median click round trips were 46.1 ms for a normal reroll, 45.0 ms for Flywheel, 44.3 ms for a normal Play, and 48.2 ms for a five-Flame/multi-effect Play. A 43-playback-event Jumping Bean chain had a 50.8 ms median and 77.8 ms worst observed click round trip. The latter did produce a long-task-sized sample, so effect-chain scaling remains important, but the tested chain did not explain routine multi-second pauses.

Persistence is on the critical response path: `useGame` does not publish the resolved authoritative state until `repository.commit` completes (`src/useGame.ts:153-176`). Durable completion had a 61.8 ms median with no archived chunks and 69.4 ms with 1,000 chunks. This is a smaller desktop contributor than selection, but it delays outcome playback and is likely more visible on slower storage. The repository also scans every stored ledger chunk for orphans after every commit (`src/game/runRepository.ts:58-75`, `src/game/runRepository.ts:157-174`), work that should not remain on every gameplay action's critical path.

The engine has a strongly supported scaling risk: each playback event receives a `structuredClone` of almost the entire Board (`src/game/effects.ts:445-455`, `src/game/telemetry.ts:28-45`). A resolution may emit up to 1,000 events, and generated chunks clone and recursively freeze the resulting events (`src/game/ledger.ts:75-91`). This is not the dominant cost for ordinary actions in the measured fixtures, but it is the most plausible source of combination-specific long pauses and garbage-collection pressure as effect chains grow.

Recommended order:

1. Make selection inference use the existing cheap exact-combination predicate instead of ranked combination generation.
2. Isolate Speed Demon's clock update from `RoundScreen`.
3. Remove orphan cleanup from the per-action durable-commit critical path.
4. Narrow Flame-presentation invalidation and avoid whole-Board serialization during renders.
5. Reduce or share per-event Board snapshots after adding an engine benchmark that checks playback equivalence.

No evidence justifies moving the engine to a worker, replacing the state model, or applying blanket `React.memo`/`useMemo`/`useCallback` changes at this time.

## 2. How profiling was performed

### Environment

- Windows 10/11 x64 host
- Headless Google Chrome 157.0.8103.40
- Vite production build served by `vite preview`
- Production URL used `speed=instant` for processing measurements, so deliberate normal-speed animation pacing did not dominate the numbers
- Desktop viewport: 1280×900
- Constrained viewport: 360×740 with Chrome 4× CPU throttling
- Three isolated samples per interaction/environment
- Each fixture unmounted the previous application, cleared its test IndexedDB data, seeded a deterministic saved state, and entered that saved run

The production build succeeded and produced:

- JavaScript: 1,091.51 kB minified / 326.01 kB gzip
- CSS: 333.31 kB / 54.36 kB gzip
- a Vite warning for a JavaScript chunk over 500 kB

The primary matrix reports Playwright input-to-click-completion round trips. This includes browser automation dispatch and is an upper bound on handler/commit-to-feedback latency, not a pure JavaScript duration. It is useful for comparisons within this run. A separate Chrome Performance-domain sample provides the JavaScript/layout/style breakdown for the most important interaction, die selection.

React's production renderer reported two root commits for the focused selection. The standard production build does not retain per-Fiber `actualDuration`, so component-level milliseconds are not presented as measured values. The hook did show broad update flags across the root/Mantine subtree; component attribution below combines that commit evidence with the directly executed source path. This limitation is preferable to presenting development-mode component durations as production results.

Raw and reproducible artifacts:

- `docs/gameplay-performance-audit/measurements.json`
- `docs/gameplay-performance-audit/selection-detail.json`
- `docs/gameplay-performance-audit/chained-measurements.json`
- `docs/gameplay-performance-audit/persistence-measurements.json`
- `docs/gameplay-performance-audit/idle-animation-measurements.json`
- `docs/gameplay-performance-audit/modal-memory-measurements.json`
- `docs/gameplay-performance-audit/profiling-harness.spec.ts`
- `docs/gameplay-performance-audit/playwright.config.ts`

### Reproduction

```powershell
npm run build
npx playwright test -c docs/gameplay-performance-audit/playwright.config.ts
```

The full profiling config also contains focused tests which can be selected with `--grep` for `detailed selection`, `chained automatic`, `durable persistence`, `idle animation`, or `repeated modal`.

## 3. Measured performance results

### Gameplay interaction timing comparison

All values are milliseconds. “Median / worst” is the click round trip across three samples. These are measured results, not estimates.

| Interaction | Environment | Median | Worst | Interpretation |
|---|---:|---:|---:|---|
| Select one die | Desktop production | 103.3 | 123.4 | Confirmed slow input path |
| Deselect one die | Desktop production | 27.9 | 92.6 | Variable; same computation path, sometimes warm |
| Normal manual reroll | Desktop production | 46.1 | 48.1 | Moderate, consistent |
| Flywheel-assisted reroll | Desktop production | 45.0 | 49.0 | No measurable Flywheel penalty |
| Open Lightning Strike | Desktop production | 176.2 | 191.6 | Confirmed modal construction/render spike |
| Confirm Lightning Strike | Desktop production | 42.1 | 265.9 | Usually moderate; one large outlier |
| Normal Hand Play | Desktop production | 44.3 | 51.3 | Moderate, consistent |
| Five-Flame, multi-effect Hand Play | Desktop production | 48.2 | 61.3 | Only slightly slower in this fixture |
| 43-event Jumping Bean chain | Desktop production | 50.8 | 77.8 | One long-task-sized sample; bounded fixture |
| Round Summary to Shop | Desktop production | 34.8 | 42.8 | No processing stall observed |
| Shop stage navigation | Desktop production | 41.4 | 111.1 | One render outlier |
| Select/manage a Shop die | Desktop production | 32.3 | 39.3 | No stall observed |
| Manual reroll, 0 archived chunks | Desktop production | 42.1 | 45.9 | Baseline action return |
| Manual reroll, 200 archived chunks | Desktop production | 42.3 | 42.3 | No action-return degradation |
| Manual reroll, 1,000 archived chunks | Desktop production | 32.9 | 37.6 | No action-return degradation |
| Select one die | Mobile, 4× CPU | 566.2 | 582.3 | Severe constrained-device latency |
| Normal manual reroll | Mobile, 4× CPU | 100.0 | 123.1 | Noticeably slower but below selection |

The 200-chunk row happened to contain identical rounded values; the raw values are retained in the artifact.

### Focused die-selection breakdown

One separate production selection sample recorded:

| Metric | Measured value |
|---|---:|
| Click round trip | 177.4 ms |
| Chrome main-thread task time | 133.1 ms |
| Script time | 117.9 ms |
| Layout | 3.3 ms |
| Style recalculation | 2.5 ms |
| Layout count | 1 |
| Style recalculation count | 11 |
| React root commits | 2 |

The discrepancy between the focused click and the three-sample median is normal sample variation plus instrumentation overhead. Both agree that script dominates and that layout/paint is not the root cause.

### Durable persistence completion

This measurement starts immediately before a manual reroll and polls the saved IndexedDB state until the new action ID is durable.

| Existing ledger chunks | Durable median | Durable worst | Click-return median |
|---:|---:|---:|---:|
| 0 | 61.8 ms | 62.3 ms | 46.9 ms |
| 200 | 55.5 ms | 60.0 ms | 39.3 ms |
| 1,000 | 69.4 ms | 70.1 ms | 38.8 ms |

There is no monotonic degradation at 200 chunks, and the 1,000-chunk increase is small on this machine. The result does not confirm history size as the cause of routine lag. It does confirm that the UI's outcome publication is gated on tens of milliseconds of storage work.

### Idle animations and timers

Two-second production idle windows:

| Round state | Task time | Script | Layout | Style | Style recalculations |
|---|---:|---:|---:|---:|---:|
| Baseline | 2.1 ms | 0.1 ms | 0 ms | 0 ms | 0 |
| Speed Demon equipped | 155.4 ms | 123.6 ms | 1.6 ms | 6.8 ms | 44 |

This is a confirmed background CPU cost and will compete with input work on constrained devices.

### Modal repetition and memory

After forced garbage collection, repeatedly opening and closing the Shop die information modal produced:

| Cycles | JS heap after GC |
|---:|---:|
| 0 | 6.24 MB |
| 30 | 7.81 MB |
| 60 | 8.14 MB |

The second batch retained much less than the first (+0.33 MB versus +1.57 MB), which is consistent with cache/portal warm-up but does not prove a plateau. This is a suspected low-severity retention risk, not a confirmed leak. A heap-snapshot dominator comparison is needed before changing modal code.

## 4. Input-to-UI architecture

The common gameplay path is:

1. A die/button handler updates ephemeral selection or calls `App.submit` (`src/App.tsx:134-141`).
2. Selection is stored at the `App` level, so the active `TopHud`, `RoundScreen`, `DiceDock`, portals, and modal props are reconstructed (`src/App.tsx:253-327`).
3. `RoundScreen` normalizes selection and recalculates qualification, preview score, Flame presentation, action validation, and playable-hand/dead-board state (`src/components/RoundScreen.tsx:80-146`).
4. `DiceDock` filters the dice and validates Flame actions (`src/components/DiceDock.tsx:33-49`). `HandScorecard` derives availability for all hands (`src/components/HandList.tsx:179-184`).
5. For gameplay commands, `useGame.submit` calls authoritative `dispatch` synchronously (`src/useGame.ts:200-210`).
6. `dispatch` validates and clones the state, runs the resolver, generates events, then clones/freezes a ledger chunk (`src/game/engine.ts:1007-1041`, `src/game/engine.ts:1117-1123`).
7. `useGame.commit` serializes pending chunks for its size limit, writes IndexedDB, compacts runtime history, and only then publishes the new resolution (`src/useGame.ts:134-176`).
8. Published playback advances through React state updates and timers (`src/useGame.ts:75-125`). Each event may carry a full Board snapshot used to render intermediate states.

This keeps resolution deterministic and authoritative. The proposed optimizations do not require weakening that model.

## 5. React rendering findings

### Confirmed: local selection invalidates the application root

Affected interactions: select/deselect one die, select all, scorecard selection, any repeated targeting gesture.

Evidence:

- Desktop selection median 103.3 ms; 4×-throttled mobile median 566.2 ms.
- Focused Chrome sample: 117.9 ms script versus 3.3 ms layout.
- Two root commits were recorded for a selection.
- Selection state and its setter originate in `App`, which renders all major gameplay surfaces (`src/App.tsx:54-77`, `src/App.tsx:253-313`).

The expensive part is not merely the number of React components. `toggleBoardDie` calls `legalHandCombinations` for the currently selected hand and then every encounter hand (`src/game/selection.ts:97-108`). Each call can generate all combinations and sort them by repeated `canonicalPlayPreview` scoring (`src/game/selection.ts:36-56`). After selection updates, `RoundScreen` repeats related derivations.

Correction: first replace exact-existence checks with the existing `hasLegalCombination(board, hand, exactDieIds)` path (`src/game/selection.ts:59-68`). It intentionally skips combination ranking and scoring. If selection remains slow after that, move ephemeral selection into a narrow gameplay-selection boundary so `TopHud` and unrelated portals do not rerender.

Risk: low for substituting exact existence if tests verify unique-hand inference, required dice, boss restrictions, special faces, and repeated scorecard cycling. Medium for changing state ownership because selection reset behavior spans actions and screens.

Verification: production CDP sample of first selection, deselection, and selecting all five dice; assert identical selected hand/dice semantics and compare median script time.

### Strongly supported: repeated render derivations

`RoundScreen` performs multiple `validateAction` calls, `currentlyPlayableManualHands`, selection normalization, qualification, and preview computation in one render (`src/components/RoundScreen.tsx:80-146`). These functions are correct, but they overlap in the legal-combination and scoring work they request. `HandScorecard` already uses a memoized availability gate, so a blanket memoization recommendation would miss the higher-value duplication.

Correction: compute the small set of action/selection facts once per render from shared intermediate values, starting with exact-combination existence. Profile again before introducing memoization. Do not add a parallel “usability” or ranking model.

### Strongly supported: Flame presentation invalidation is broad

`flameCandidatePresentationKey` serializes almost the whole Board on eligible Round renders (`src/game/flamePresentation.ts:42-45`). `possibleXMultFlames` then walks hands and legal combinations and scores each combination (`src/game/flamePresentation.ts:47-55`). Other Flame eligibility paths call `legalHandCombinations` repeatedly (`src/game/flamePresentation.ts:110-160`).

The measured multi-Flame Play itself was only 3.9 ms slower at the median than a normal Play, so this audit does not claim Flame resolution is generally slow. The risk applies most directly to selection/rerender paths on Flame-heavy boards.

Correction: key presentation data from the specific authoritative fields that affect it, or derive it once after an authoritative board change. Selection-only changes should not stringify the full Board or recompute board-only candidate factors.

Risk: medium. Candidate presentation is player-visible and must remain exact for boss, special-die, and Flame interactions.

### Not recommended yet

- Blanket `React.memo`, `useMemo`, or `useCallback` usage. Many props are unstable, but the confirmed cost is expensive work in the render path; memo wrappers without stable boundaries will add complexity without removing it.
- A global selector store or external state library. Reprofile after the exact-combination and Speed Demon changes.
- Virtualizing the scorecard or five-die dock. Their item counts are small.

## 6. Game engine and effect-resolution findings

### Confirmed architecture cost: full state and ledger cloning

Every accepted action enters `execute`, which normally clones the whole state before resolution (`src/game/engine.ts:1007-1013`, `src/game/ledger.ts:64-68`). `chunkForResolution` clones new events and recursively freezes the whole chunk (`src/game/ledger.ts:75-91`). These costs are part of the deterministic immutable boundary.

Normal reroll/Play measurements around 44-48 ms show that this is acceptable for ordinary desktop actions. It should not be removed speculatively.

### Strongly supported scaling risk: full Board snapshot per playback event

`Resolver.emit` adds `boardSnapshot(this.state)` to nearly every gameplay playback event (`src/game/effects.ts:445-455`). `boardSnapshot` selects most Board fields and then performs `structuredClone` (`src/game/telemetry.ts:28-45`). Long chains therefore multiply Board cloning, event memory, ledger cloning, recursive freezing, IndexedDB cloning, and later garbage collection.

The measured 43-event Jumping Bean fixture was 50.8 ms median / 77.8 ms worst. That is not a multi-second stall, but the worst sample crossed the long-task threshold. The resolver permits up to 1,000 events (`src/game/config.ts:24`, `src/game/effects.ts:445-446`), so rare combinations can be much larger than the fixture.

Correction: benchmark snapshot count and bytes first, then reuse a snapshot between adjacent events when no presentation-relevant Board field changed, or store a smaller presentation snapshot. Preserve the exact event ordering, replay output, and authoritative final state.

Risk: high. Playback correctness, debugging exports, and replay determinism depend on these snapshots.

### Effect-chain bounds are present

Jumping Bean drains a finite queue and performs Free Play/follow-up Roll descendants (`src/game/effects.ts:1132-1147`). The global resolution event cap stops infinite ability chains at 1,000 events. This is good defensive behavior. The cap limits nontermination, not latency: hundreds of full snapshots can still create a long pause before the error or completion.

Correction: retain the cap. Add event-count, snapshot-byte, and resolution-time benchmarks for curated maximum-invocation fixtures.

### Repeated validation

Validation occurs in the UI for affordance state and again authoritatively in `dispatch`. The second validation is required. Avoid trying to share transient UI validation results with the engine. Instead, reduce repeated UI calls within one render and keep authoritative dispatch validation intact.

## 7. Animation and visual rendering findings

### Confirmed: Speed Demon timer competes with gameplay

The timer calls `setDecisionMs` every 50 ms (`src/components/RoundScreen.tsx:70-74`). Because the state is owned by `RoundScreen`, each tick revisits the large derivation/render path. Measured idle script utilization was roughly 124 ms per two seconds, versus effectively zero without the Flame.

Correction: keep authoritative elapsed time in the existing ref/timer source, but render the countdown in a small leaf component or update a CSS/custom-property display without rerendering `RoundScreen`. Compute the precise decision time once when the player commits the Play. If preview accuracy requires live thresholds, schedule only threshold crossings or a visibly sufficient lower frequency.

Risk: medium. Speed Demon qualification is timing-sensitive; tests must cover boundary values and pause/modal behavior.

### Intentional pacing is distinct from stalls

Normal playback is deliberately 350 ms per ordinary event and 200 ms per scoring die; fast playback is 90/80 ms, while instant uses 0 ms (`src/game/config.ts:22-23`, `src/game/playback.ts:7-11`). Score summaries hold for 420 ms and scorecard refreshes for 720/260/420 ms. Map, chapter, rolling, and score animations in `src/styles.css` are also deliberate.

These delays should not be reported as computation lag. The UI should remain responsive during them, and the instant-mode results show ordinary action processing can be well below the visible normal-speed sequence.

### CSS/visual effects

The UI uses blur/backdrop filters, drop shadows, brightness/saturation filters, and several concurrent map/chapter animations (`src/styles.css:27`, `src/styles.css:386`, `src/styles.css:551-649`). They may matter on low-end GPUs during transitions, but the focused selection sample had very small layout/style cost, so they are not implicated in routine selection lag. Reduced-motion behavior disables animations and transitions globally (`src/styles.css:525`).

### Cleanup review

Inspected timers and listeners generally return cleanup functions: Speed Demon clears its interval, Round keyboard handling removes its listener, map/chapter/shop timers clear on teardown, and Lightning Strike disconnects its `ResizeObserver` and cancels its frame (`src/components/LightningStrikeModal.tsx:48-58`). No source-confirmed listener leak was found.

## 8. History, memory, and persistence findings

### Confirmed: durable save gates outcome publication

`commit` sets saving state, starts IndexedDB, and calls `publish(next)` only in `finally` (`src/useGame.ts:153-176`). This guarantees the authoritative result is not presented ahead of the attempted save, but it puts storage latency directly between an action and its resolved playback.

The tested durable medians were 55-69 ms. On the audit machine this is not a major pause; on slower mobile storage it can compound engine work.

### Confirmed source issue: global orphan scan after every commit

After every session/chunk transaction, `cleanupOrphanedChunks` loads all sessions and opens a cursor across the entire ledger store (`src/game/runRepository.ts:58-75`, `src/game/runRepository.ts:157-174`). Its cost scales with all stored chunks, including abandoned run IDs, not only the active run.

The controlled 1,000-live-chunk test did not show severe degradation. During harness development, overlapping teardown/reseed operations exposed how global chunk cleanup can hold database work, but that concurrency is not a normal gameplay measurement and is not included in the timing table.

Correction: perform orphan cleanup on startup, run replacement/removal, shop/round transitions, or an idle task; do not await it before publishing every gameplay action. Keep the core session/chunk transaction durable before allowing the next authoritative command.

Risk: low to medium. Tests must simulate crashes between the core commit and deferred cleanup and verify resumability.

### Runtime history is bounded after commit

`compactRuntimeLedger` retains bounded recent data and selected evidence after durable commits (`src/game/ledger.ts:98-110`). The 0/200/1,000 chunk comparison did not show progressive action-return slowdown. This argues against broad history removal or replay redesign.

### Memory

The modal test retained 1.90 MB after 60 cycles and forced GC, with growth slowing sharply in the second batch. No unbounded array, queue, or application cache was identified from source review. Keep this as a monitoring/benchmark item; do not change modal mechanics based on one headless-browser heap series.

## 9. Confirmed bottlenecks versus suspected risks

### Confirmed

1. Dice selection is a high-latency script/render path, severe under CPU throttling.
2. Speed Demon's 20 Hz state update creates substantial idle main-thread work.
3. Lightning Strike modal opening is comparatively expensive (176.2 ms median).
4. Persistence completion gates resolved playback by roughly 55-69 ms on the tested machine.
5. The production bundle is large enough to affect startup/first-load parsing, though not routine already-loaded actions.

### Strongly supported but not yet isolated as a user-visible bottleneck

1. Whole-Board serialization and Flame candidate enumeration during Flame-heavy renders.
2. Full Board snapshot cloning for every playback event.
3. Clone/freeze/IndexedDB amplification for large effect chains.
4. Whole-store orphan scanning after every commit.

### Suspected only

1. Modal/portal retention after repeated open/close cycles.
2. GPU cost from blur/filter-heavy map and chapter transitions on low-end hardware.
3. Garbage-collection pauses for near-cap effect chains; the 43-event chain was not large enough to reproduce a long pause.

## 10. Severity-ranked issues

| Severity | Issue | Affected interactions | Evidence | Regression risk |
|---|---|---|---|---|
| High | Full ranked combination/scoring work on selection plus root rerender | Select/deselect/select all, scorecard targeting | 103 ms desktop median; 566 ms throttled; 118 ms script focused sample | Low-medium |
| High | Speed Demon 50 ms `RoundScreen` state timer | Any action while equipped; idle battery/CPU | 155 ms task time per 2 s versus 2 ms baseline | Medium |
| Medium | Per-event full Board snapshots and clone/freeze amplification | Large Flame/special-die chains, automatic rolls | Source path; 43-event worst 78 ms | High |
| Medium | Lightning modal construction and prediction UI | Opening Lightning Strike | 176 ms median | Low-medium |
| Medium | Durable commit and orphan cleanup gate playback | Every authoritative action | 55-69 ms durable median; global cursor source path | Medium |
| Medium | Broad Flame presentation invalidation | Flame-heavy selection and renders | Whole-Board JSON plus combination scoring source path | Medium |
| Low | Large startup bundle | Initial load/reload | 1.09 MB minified JS | Low |
| Low, unconfirmed | Modal retention | Long sessions with repeated modal use | +1.90 MB after 60 cycles; slowing growth | Medium |

## 11. Prioritized optimization recommendations

### Quick wins

1. **Use `hasLegalCombination` for exact selection inference.** In `normalizeBoardSelection` and `toggleBoardDie`, replace full ranked combination generation where the caller only asks whether the exact dice form a hand. Keep `legalHandCombinations` for scorecard cycling/ranking. This directly attacks the confirmed selection hotspot with existing logic.

2. **Isolate Speed Demon updates.** Move the visible clock to a leaf and keep `decisionMs` out of `RoundScreen` state. Preserve precise commit-time calculation and timing semantics.

3. **Defer orphan cleanup.** Complete the active run transaction, then schedule cleanup outside the action-to-publish path. Cleanup should also run when replacing/removing runs.

4. **Avoid repeated validation in one render.** Reuse already constructed action/reason results inside `RoundScreen` and `DiceDock`. Keep dispatch validation unchanged.

5. **Lazy-load non-gameplay surfaces if startup matters.** The bundle warning supports splitting debug/help/scenario-heavy screens, but measure startup before spending gameplay-optimization time here.

### Moderate improvements

1. **Create a narrow selection/render boundary.** After the quick selection fix, keep transient selection near `RoundScreen`/`DiceDock` or expose it through a small context so `TopHud` and unrelated modal trees do not rerender. Preserve App-level reset triggers through explicit callbacks.

2. **Narrow Flame-presentation dependencies.** Separate board-only candidate presentation from selection/time-dependent preview data. Replace whole-Board JSON serialization with a small, explicit signature only after tests enumerate all dependent mechanics.

3. **Reduce snapshot duplication.** Reuse identical Board snapshots across adjacent events or define a compact playback snapshot. Validate exact replay and all event rendering before rollout.

4. **Profile and streamline Lightning modal initialization.** Its open cost is confirmed. Candidate work includes deriving distinct outcomes only when dice change, avoiding duplicate validation during initial mount, and measuring the `ResizeObserver`/layout contribution. Do not memoize blindly.

### Architectural improvements — only if follow-up profiling justifies them

1. **Worker-based resolution.** Consider only if curated 200-1,000-event benchmarks still block the main thread after snapshot reduction. State transfer itself is expensive, and current ordinary actions do not justify this complexity.

2. **Selector-based external game store.** Consider only if root invalidation remains material after narrowing transient selection ownership.

3. **Separate append-only replay storage from per-action session commits.** This may help very long runs, but the 1,000-chunk measurement does not currently justify a persistence redesign.

## 12. Proposed performance regression benchmarks

Keep these separate from gameplay correctness tests. Store raw samples and compare distributions; do not use a single strict wall-clock assertion in shared CI.

### Dice selection responsiveness

- Production build, deterministic fresh/mid/late fixtures.
- Select, deselect, and select all five dice.
- Record Chrome task/script/layout/style metrics and React commit count.
- Run 15-30 samples locally; report median and p95/worst.
- CI: compare against a rolling baseline or a generous ratio (for example, fail only on >50% median regression with a minimum absolute delta). Verify selected hand/dice correctness separately.

### Reroll and Play processing

- Direct engine benchmark around `dispatch` for normal reroll, Flywheel, Lightning confirmation, normal Play, and multi-Flame Play.
- Browser benchmark from trusted input to first busy/visual feedback, durable save completion, and playback start as three separate timestamps.
- Preserve event sequence, final state, RNG state, and ledger output in correctness assertions.

### Complex effect chains

- Curated Jumping Bean, Curtain Call, Free Play, automatic-roll, boss, and multi-Flame fixtures at low/medium/high event counts.
- Record dispatch time, event count, Board snapshot count, serialized chunk bytes, peak heap, and GC/long tasks.
- Prefer complexity/ratio checks across event counts over a hard millisecond ceiling.

### Long-run stability

- Compare 0, 200, 1,000, and a realistic maximum number of ledger chunks.
- Measure action return, durable completion, repository cleanup, session load, and heap after forced GC.
- Include abandoned run IDs to exercise orphan cleanup separately from live-run history.

### Animation and timer budget

- Two-second idle samples for baseline, Speed Demon, map, chapter splash, and open modals.
- Speed Demon should not continuously rerender the full Round tree; use task/script time and commit count as the regression signal.
- Repeat under 4× CPU throttle and reduced motion.

### Memory and cleanup

- Open/close each gameplay modal in two 30-cycle batches with forced GC between batches.
- Track listener/observer/timer counts where browser tooling permits and compare heap dominators, not only total heap.
- Navigate away during active timers/animations and assert no further commits from the unmounted surface.

## 13. Verification performed

- `npm run build` — passed, including TypeScript checking and production Vite build.
- Focused engine/persistence correctness tests — 59 passed across `selectionBoard`, `runRepository`, `playback`, `configurableDice`, and `interactionUxCleanup`.
- Full production interaction profiling matrix — passed (16 rows × 3 samples).
- Focused detailed-selection, chained-effect, durable-persistence, idle-animation, and repeated-modal profiles — passed.

The audit changed only documentation/profiling artifacts. No production gameplay code, mechanics, randomness, scoring, Flame behavior, or persistence behavior was modified.

## 14. Phase 1 implementation results (2026-11-14)

### Outcome

Phase 1 implemented the two highest-priority changes without changing game mechanics:

- Exact selection legality in `normalizeBoardSelection` and `toggleBoardDie` now uses `hasLegalCombination`. Ranked `legalHandCombinations` remains in the scorecard selection path where ordering and cycling require it. See `src/game/selection.ts:73-105`.
- Speed Demon's authoritative `DecisionTimer` is shared by the Round and a small HUD leaf. Only `SpeedDemonFlameBadge` refreshes every 50 ms; `RoundScreen` no longer owns clock-tick state. A Play still freezes `DecisionTimer` directly at the action timestamp. See `src/App.tsx:77`, `src/components/RoundScreen.tsx:55-70`, `src/components/RoundScreen.tsx:155-159`, and `src/components/TopHud.tsx:56-68`.
- Speed Demon's clock-driven display transformation was factored into `withSpeedDemonDecisionTime`, which is used by both normal Flame presentation and the isolated badge. See `src/game/flamePresentation.ts:42-54` and `src/game/flamePresentation.ts:203-208`.
- The scorecard now computes encounter-die count and unavailable-hand membership once per scorecard render rather than once per section/row. See `src/components/HandList.tsx:40-65` and `src/components/HandList.tsx:165-174`.

The selection-only intermediate profile reduced median desktop Chrome script work from 78.3 ms to 4.3 ms and task work from 98.9 ms to 19.3 ms. Because browser processing was already small after this change, moving selection state out of `App` was not justified. Production React instrumentation still observed two root commits for a selection, but the post-change focused sample spent only 7.7 ms in script and 19.0 ms in total tasks. Production component durations are unavailable/minified in this build, so no component-level duration is claimed.

### Measurement method and interpretation

The Phase 1 harness uses the same production Vite preview and Chrome CDP setup as the audit. Primary selection cases use 15-20 samples. Chrome task/script/layout/style deltas cover the click plus a fixed settle window. The separately reported Playwright click round-trip includes locator actionability, input dispatch, and driver/browser communication; it is not an input-to-paint measurement. This distinction matters because Playwright adds an approximately 250 ms actionability floor to some repeated toggle samples.

Raw data:

- `docs/gameplay-performance-audit/phase1-before.json`
- `docs/gameplay-performance-audit/phase1-selection-only.json`
- `docs/gameplay-performance-audit/phase1-after.json`
- `docs/gameplay-performance-audit/phase1-supporting-after.json`
- `docs/gameplay-performance-audit/phase1-selection-detail-after.json`

### Before/after primary results

Values are median / p95 / worst in milliseconds. Improvement is based on medians from the paired Phase 1 production runs.

| Interaction | Environment | Measurement | Before | After | Median improvement |
|---|---|---:|---:|---:|---:|
| Select one die | Desktop | Playwright round-trip | 323.7 / 350.5 / 353.5 | 248.7 / 251.3 / 259.0 | 23.2% |
| Select one die | Desktop | Chrome task | 98.9 / 125.4 / 136.1 | 17.1 / 20.1 / 20.5 | 82.7% |
| Select one die | Desktop | Chrome script | 78.3 / 108.3 / 122.8 | 4.0 / 5.8 / 9.0 | 94.9% |
| Select one die | Mobile, 4x CPU | Playwright round-trip | 735.0 / 808.3 / 808.3 | 336.2 / 866.8 / 866.8 | 54.2% median; noisy tail |
| Select one die | Mobile, 4x CPU | Chrome task | 480.8 / 552.4 / 552.4 | 72.8 / 78.6 / 78.6 | 84.9% |
| Select one die | Mobile, 4x CPU | Chrome script | 408.4 / 496.7 / 496.7 | 19.6 / 27.2 / 27.2 | 95.2% |
| Select all five dice | Desktop | Playwright round-trip | 442.2 / 502.4 / 502.4 | 106.6 / 121.4 / 121.4 | 75.9% |
| Select all five dice | Desktop | Chrome task | 384.0 / 456.0 / 456.0 | 36.4 / 41.7 / 41.7 | 90.5% |
| Select all five dice | Desktop | Chrome script | 352.6 / 425.9 / 425.9 | 18.7 / 22.5 / 22.5 | 94.7% |
| Select with complex Flames | Desktop | Playwright round-trip | 43.2 / 107.0 / 107.0 | 32.8 / 104.8 / 104.8 | 24.1% |
| Select with complex Flames | Desktop | Chrome task | 31.7 / 44.9 / 44.9 | 27.8 / 49.7 / 49.7 | 12.3% median |
| Select with complex Flames | Desktop | Chrome script | 17.8 / 28.9 / 28.9 | 12.6 / 15.2 / 15.2 | 29.2% |
| Select with Speed Demon | Desktop | Playwright round-trip | 138.7 / 165.3 / 165.3 | 23.3 / 41.5 / 41.5 | 83.2% |
| Select with Speed Demon | Desktop | Chrome task | 161.9 / 222.0 / 222.0 | 12.7 / 17.4 / 17.4 | 92.2% |
| Select with Speed Demon | Desktop | Chrome script | 151.3 / 209.5 / 209.5 | 5.5 / 7.1 / 7.1 | 96.4% |

Deselecting was already cheap before this pass. Desktop Chrome task time improved from 21.7 ms to 16.3 ms median (25.2%); mobile task time improved from 89.5 ms to 77.7 ms (13.2%). Desktop Playwright round-trip moved from 235.1 ms to 247.1 ms even though browser processing decreased, which is consistent with driver/actionability noise and is not presented as a latency improvement.

The original audit's headline medians (103.3 ms desktop and 566.2 ms throttled mobile) came from a different sampling pass. The paired Phase 1 comparison above is the percentage source; the direction and magnitude of Chrome processing improvements agree with the original focused 117.9 ms script sample.

### Speed Demon idle CPU

Five two-second samples were collected per environment.

| Environment | Measurement | Before median / p95 / worst | After median / p95 / worst | Median improvement |
|---|---:|---:|---:|---:|
| Desktop | Chrome task | 188.2 / 200.7 / 200.7 | 36.9 / 38.8 / 38.8 | 80.4% |
| Desktop | Chrome script | 116.4 / 123.7 / 123.7 | 12.4 / 12.8 / 12.8 | 89.4% |
| Mobile, 4x CPU | Chrome task | 494.8 / 834.9 / 834.9 | 125.3 / 135.9 / 135.9 | 74.7% |
| Mobile, 4x CPU | Chrome script | 419.8 / 574.9 / 574.9 | 42.3 / 43.5 / 43.5 | 89.9% |

The remaining work is the intentional 20 Hz update of one Mantine badge plus normal browser timer/style overhead. `RoundScreen`, scorecard availability, selection normalization, Play validation, and Flame candidate enumeration are no longer driven by the visual clock.

### Supporting interaction checks

These five-sample post-change measurements confirm that the focused changes did not move the cost into adjacent actions. Values are median Chrome task / script milliseconds; windows include post-click settling and should not be compared directly with dispatch-only engine timings.

| Interaction | Desktop | Mobile, 4x CPU |
|---|---:|---:|
| Normal reroll | 31.2 / 12.6 | 151.9 / 75.5 |
| Multi-Flame, multi-effect Play | 105.7 / 41.4 | 453.6 / 206.8 |
| Open Lightning Strike | 45.8 / 7.0 | 103.9 / 35.2 |

Playwright round-trip medians were 42.8 / 86.2 ms for reroll, 49.9 / 150.5 ms for complex Play, and 33.6 / 106.7 ms for Lightning Strike (desktop / throttled mobile). The previous audit used three samples and a different settle protocol, so these supporting values are treated as regression checks rather than percentage claims.

### Correctness and validation

Focused tests cover:

- Boolean exact checks without canonical preview/ranking work.
- Retaining and clearing normalized selections.
- Ambiguous manual selections.
- Missing Link special-die inference.
- Hexer required-die and existing boss restrictions.
- Ranked scorecard cycling and projected-score ordering.
- Speed Demon at 999/1000/1001 ms and 4999/5000/5001 ms.
- Blocked-time exclusion, exact freeze time, and authoritative dispatch application.

Validation completed:

- Focused selection/Speed Demon/Flame/component tests: 41 passed.
- Full unit and integration suite: 76 files, 831 tests passed.
- Full Playwright browser suite: 160 tests passed.
- TypeScript typecheck: passed.
- Production build: passed. Vite's existing large-chunk warning remains.
- Production Phase 1 benchmark: passed for before, selection-only, after, supporting, and detailed-selection runs.

### Remaining concerns and next target

Selection still causes two root React commits because transient selection remains in `App`. The measured browser cost after the Boolean change is small enough that introducing a new ownership boundary now would add complexity without evidence of a worthwhile gain. Revisit only if future mechanics make the remaining 17 ms desktop task budget grow materially.

The largest updated supporting sample is the complex multi-Flame Play under 4x CPU throttling (453.6 ms task, 206.8 ms script median). The next optimization pass should profile effect-chain event generation and repeated Board snapshot/history construction inside that Play, preserving deterministic event order and persistence guarantees. Lightning Strike initialization remains a secondary target. Neither was changed in Phase 1.
