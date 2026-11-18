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

## 15. Phase 2 complex-effect profiling (2026-11-14)

### Executive result

This read-only pass confirms that Board snapshot construction is the dominant engine cost in a large effect chain. The 434-event Jumping Bean fixture took 72.40 ms median in direct dispatch. A separately instrumented `Resolver` run spent 48.95 ms cloning Board snapshots, 69.6% of its 70.34 ms total. Event construction excluding the snapshot clone was only 3.59 ms median. Game-state cloning, ledger construction/freezing, ledger serialization, and in-memory persistence were individually small by comparison.

The same fixture created 5.32 MB of serialized Board snapshots. Only 134 of 434 snapshots were unique, and 300 of 433 adjacent pairs (69.3%) were byte-identical. The unique snapshot payload was 1.62 MB, 30.5% of the emitted payload. This proves substantial duplication, but it does not by itself prove that snapshots can be removed: playback currently consumes the Board attached to every event.

Browser profiling found a second confirmed delay outside the engine. `IndexedDbRunRepository.commit` waits for `cleanupOrphanedChunks` after the durable session/chunk transaction (`src/game/runRepository.ts:157-174`), and `useGame.commit` waits for that entire promise before publishing the resolution (`src/useGame.ts:153-176`). Under 4x CPU throttling, the elapsed cleanup gate took 109.5 ms median for the high fixture and publication's first subsequent DOM mutation occurred 410.5 ms after click capture. Cleanup is not effect calculation, but it is on the effect-to-visible-playback critical path.

No production source was changed in this pass.

### Method

The new harness is `docs/gameplay-performance-audit/complex-resolution-profile.spec.ts`. It uses deterministic saved states and constant or seeded random sources for five fixtures:

- Low: a one-die left-hand Play.
- Medium: a five-die Play with five simultaneous Flames and four effects on every die.
- Medium: a Curtain Call/free-Play reroll with seven effects on the rerolled die and five Flames.
- High: three Jumping Bean dice, each with four effects, plus five Flames; the fixture searches 80 deterministic seeds and retains the largest valid chain.
- Boss coverage: the multi-Flame fixture with Juggler active.

The engine probe collected 15 post-warmup samples per fixture. It timed dispatch, state cloning, direct Resolver work, `Resolver.emit`, direct V2 emission, categorized `structuredClone` calls, `chunkForResolution`, exact-JSON serialization, and `MemoryRunRepository.commit`. Snapshot counts and bytes are exact for each deterministic resolution; equality is exact serialized Board equality.

The production-browser probe collected five samples per fixture on desktop and at a 360x740 viewport with Chrome's 4x CPU throttle. It measured Chrome task/script/layout/style counters, long tasks, read-write IndexedDB transaction boundaries, DOM mutation boundaries, and heap before/after forced collection. Browser task/script counters include the click and a fixed 300 ms observation window; they are not pure engine timings. The cleanup gate is elapsed time from completion of the durable write to completion of cleanup's ledger transaction, so it includes cleanup's uninstrumented read-only session scan. The first DOM mutation at or after the last persistence transaction is reported as a publication bound because instant playback can publish and finish without exposing an `EVENT n / total` marker. This is an inference from the measured transaction and mutation sequence, not a direct React commit marker.

Raw artifacts:

- `docs/gameplay-performance-audit/phase2-engine-stages.json`
- `docs/gameplay-performance-audit/phase2-browser-stages.json`

Reproduce with:

```powershell
npx playwright test --config docs/gameplay-performance-audit/playwright.config.ts -g "complex engine"
npx playwright test --config docs/gameplay-performance-audit/playwright.config.ts -g "complex browser"
```

### Engine timing breakdown

Times are median / p95 / worst in milliseconds across 15 samples. Resolver was measured in a separate run from dispatch, so small inversions such as the boss Resolver median exceeding dispatch are sampling noise, not hidden negative overhead. "Effect body" is Resolver total minus `emit` and direct `emitV2`; it includes qualification, controller, scoring, and chained-effect calculations.

| Fixture | Playback / V2 events | Dispatch | Resolver | Board snapshot clone | Event construction excluding snapshot | Effect body | State clone | Ledger clone/freeze | Ledger serialize | Memory persistence |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Simple left Play | 8 / 3 | 2.04 / 3.34 / 3.34 | 1.29 / 3.02 / 3.02 | 0.48 / 0.61 / 0.61 | 0.06 median | 0.75 median | 0.22 median | 0.05 median | 0.02 median | 0.05 median |
| Multi-Flame + special dice | 61 / 34 | 10.82 / 14.80 / 14.80 | 9.63 / 14.83 / 14.83 | 6.94 / 11.81 / 11.81 | 0.46 median | 1.36 median | 0.30 median | 0.35 median | 0.21 median | 0.31 median |
| Curtain Call / Free Play | 25 / 15 | 4.26 / 4.95 / 4.95 | 3.34 / 4.69 / 4.69 | 1.87 / 2.69 / 2.69 | 0.23 median | 1.12 median | 0.26 median | 0.14 median | 0.08 median | 0.12 median |
| Jumping Bean chain | 434 / 208 | 72.40 / 78.72 / 78.72 | 70.34 / 81.87 / 81.87 | 48.95 / 53.41 / 53.41 | 3.59 median | 17.94 median | 0.27 median | 2.26 median | 1.45 median | 1.92 median |
| Juggler + multi-Flame Play | 61 / 34 | 9.30 / 10.78 / 10.78 | 9.48 / 11.00 / 11.00 | 6.93 / 8.34 / 8.34 | 0.40 median | 1.31 median | 0.30 median | 0.36 median | 0.21 median | 0.30 median |

Dispatch scales nearly linearly over the measured 8, 25, 61, and 434 playback-event fixtures: 2.04, 4.26, 10.82, and 72.40 ms median. The richer high fixture costs approximately 0.167 ms per playback event in this Node-based probe. That is a characterization, not a universal per-event constant, because Board size and effect work differ by fixture.

The Juggler fixture emitted the same number of events as the equivalent non-boss fixture and was not slower. This verifies that boss plumbing was present, but it does not establish the cost of bosses that generate additional events or controller work. Such bosses remain an unmeasured scaling risk rather than a confirmed bottleneck.

### Snapshot construction and allocation pressure

`Resolver.emit` calls `boardSnapshot(this.state)` for every applicable playback event (`src/game/effects.ts:445-454`). `boardSnapshot` selects most mutable Board fields and immediately `structuredClone`s the object (`src/game/telemetry.ts:28-36`). The following payload sizes are exact UTF-8 byte counts of the serialized snapshots in each deterministic resolution.

| Fixture | Snapshots | Total snapshot bytes | Unique snapshots | Unique snapshot bytes | Adjacent identical | Duplicate payload reduction if perfectly interned |
|---|---:|---:|---:|---:|---:|---:|
| Simple left Play | 8 | 35,164 | 3 | 13,225 | 5 / 7 (71.4%) | 62.4% |
| Curtain Call / Free Play | 25 | 180,606 | 10 | 72,498 | 15 / 24 (62.5%) | 59.9% |
| Multi-Flame + special dice | 61 | 725,260 | 25 | 297,071 | 36 / 60 (60.0%) | 59.0% |
| Juggler + multi-Flame Play | 61 | 726,724 | 25 | 297,671 | 36 / 60 (60.0%) | 59.0% |
| Jumping Bean chain | 434 | 5,317,996 | 134 | 1,621,742 | 300 / 433 (69.3%) | 69.5% |

The snapshot payload per event also grows with Board richness: approximately 4.4 KB in the simple fixture versus 11.9 KB in the high fixture. Event count and Board size therefore multiply one another.

After forced garbage collection in the production browser, the high fixture retained a median 2.4 MB in both environments. Median peak deltas were 2.5 MB desktop and 4.3 MB under 4x throttling. The medium multi-Flame fixture retained about 1.0 MB. These heap deltas include React, persistence, and playback allocations and should not be attributed solely to snapshots. The Node per-dispatch heap deltas were non-monotonic without per-sample forced GC, so they are retained in the raw artifact but not used as evidence.

### Browser critical-path timing

Values are median / p95 / worst milliseconds across five production-build samples. "To IDB write" is click capture to the start of the durable transaction and includes input dispatch, engine work, React scheduling, and repository preparation. "Publish bound" is the first DOM mutation at or after cleanup completes. Chrome task/script totals cover the fixed observation window. Long task is the largest PerformanceObserver entry over 50 ms.

| Environment / fixture | To IDB write | Durable write | Orphan cleanup | Publish bound | Chrome task / script median | Largest long task median |
|---|---:|---:|---:|---:|---:|---:|
| Desktop, simple | 37.2 / 47.5 / 47.5 | 5.6 / 6.4 / 6.4 | 0.9 / 4.1 / 4.1 | 50.3 / 57.0 / 57.0 | 49.6 / 19.0 | none |
| Desktop, multi-Flame | 57.5 / 62.3 / 62.3 | 16.6 / 23.2 / 23.2 | 1.4 / 6.1 / 6.1 | 80.7 / 85.3 / 85.3 | 91.3 / 33.0 | none |
| Desktop, Curtain Call | 50.6 / 52.7 / 52.7 | 10.8 / 26.5 / 26.5 | 0.9 / 1.3 / 1.3 | 65.8 / 84.8 / 84.8 | 71.8 / 27.9 | none |
| Desktop, Jumping Bean | 58.0 / 61.3 / 61.3 | 10.2 / 10.9 / 10.9 | 1.2 / 1.4 / 1.4 | 73.2 / 75.6 / 75.6 | 103.0 / 51.5 | none |
| 4x CPU, simple | 103.4 / 105.5 / 105.5 | 23.5 / 25.3 / 25.3 | 3.9 / 4.1 / 4.1 | 154.6 / 157.7 / 157.7 | 237.4 / 110.2 | 73 ms |
| 4x CPU, multi-Flame | 135.0 / 169.3 / 169.3 | 58.9 / 103.2 / 103.2 | 50.1 / 104.3 / 104.3 | 274.4 / 370.6 / 370.6 | 384.0 / 170.3 | 106 ms |
| 4x CPU, Curtain Call | 123.2 / 125.5 / 125.5 | 53.0 / 57.5 / 57.5 | 36.9 / 44.0 / 44.0 | 236.6 / 243.8 / 243.8 | 338.4 / 147.9 | 91 ms |
| 4x CPU, Jumping Bean | 219.2 / 228.9 / 228.9 | 52.9 / 55.5 / 55.5 | 109.5 / 113.6 / 113.6 | 410.5 / 418.6 / 418.6 | 512.2 / 270.2 | 206 ms |
| 4x CPU, Juggler + multi-Flame | 150.7 / 163.1 / 163.1 | 63.2 / 85.7 / 85.7 | 56.5 / 57.8 / 57.8 | 294.9 / 331.4 / 331.4 | 406.5 / 184.4 | 111 ms |

The desktop high-chain browser result reaches the IndexedDB transaction sooner than the direct 72.4 ms Node dispatch median. These are different processes, random-source paths, fixtures after browser setup, and timing boundaries; they must not be subtracted from one another. The within-harness comparisons and stage proportions are the reliable conclusions.

### Most expensive functions and root causes

1. **Confirmed: `boardSnapshot` cloning in `Resolver.emit` — high severity for large chains.** Every playback event clones a broad Board. It accounts for 48.95 ms median and 69.6% of direct Resolver time in the 434-event fixture. Adjacent events frequently have identical Boards because several presentation events are emitted between state mutations.

2. **Confirmed: effect/controller/scoring work — moderate secondary cost.** Resolver work outside emission was 17.94 ms median in the high fixture. This bucket contains real mechanics and was not subdivided further because snapshot work already dominates. It should be profiled by function only after snapshot pressure is removed; changing it first carries greater deterministic-gameplay risk.

3. **Confirmed: orphan cleanup on the publication path — high severity on throttled devices.** `cleanupOrphanedChunks` reads every session and scans the ledger store (`src/game/runRepository.ts:58-75`). The repository awaits it after every commit, and publication waits on the repository. Its elapsed gate was 109.5 ms median in the high throttled fixture, work unrelated to whether the active chunk is already durable.

4. **Confirmed but small: ledger cloning/freezing.** `chunkForResolution` clones the action and new V2 events, then recursively freezes the result (`src/game/ledger.ts:75-90`). It cost 2.26 ms median at 208 V2 events, 3.1% of dispatch. It is not a priority bottleneck.

5. **Confirmed but small: serialization and in-memory persistence.** Exact ledger serialization was 1.45 ms and `MemoryRunRepository.commit` 1.92 ms median in the high fixture. IndexedDB's durable write is materially larger in the browser, but it also includes browser storage scheduling and structured cloning. The measurements do not justify changing the ledger format solely for CPU time.

6. **Not confirmed: full GameState clone.** `cloneGameState` uses `structuredClone` (`src/game/ledger.ts:64-68`) but cost only 0.27 ms median in the high fixture. It is not responsible for the measured pause.

### Ranked optimization candidates

| Rank | Candidate | Evidence-based expected benefit | Risk |
|---:|---|---|---|
| 1 | Add an explicit `reuse previous Board` path only at emission call sites proven to have no intervening Board mutation, while continuing to attach a Board to every playback event | The high fixture has 300 byte-identical adjacent pairs. Avoiding those clones has a measured upper bound of about 33.8 ms (300/434 of the 48.95 ms clone bucket) and about 3.70 MB of duplicate serialized payload. | Medium. An incorrect annotation would corrupt playback, but the scope can be kept to audited call sites and checked against legacy fresh snapshots in tests. |
| 2 | Remove orphan cleanup from the action-to-publication critical path after the active transaction commits; retain cleanup at startup and lifecycle-safe maintenance points | Avoids 36.9-109.5 ms median under 4x throttling in the measured complex fixtures without changing active-run serialization. | Low-moderate. Must prove cleanup failures cannot affect save acknowledgement and that abandoned chunks remain bounded and are eventually removed. |
| 3 | Intern identical snapshots in stored/history representation while preserving per-event playback access | Up to 59-69.5% snapshot payload reduction in these fixtures; likely reduces IndexedDB clone/allocation and GC pressure. It does not avoid initial snapshot construction unless paired with mutation-aware reuse. | Medium-high. Requires a versioned storage/recovery format and equivalent playback reconstruction; not suitable as the first change. |
| 4 | Profile the remaining effect-body bucket and eliminate only proven repeated qualification/controller calculations | At most 17.94 ms median in the high fixture before any snapshot improvement; likely a smaller practical gain. | High. This is authoritative mechanics and RNG/controller ordering is sensitive. |
| 5 | Reduce ledger clone/freeze or serialization work | Combined measured median is about 3.7 ms in the high fixture. | Medium for small benefit. Immutable ledger and recovery guarantees make shortcuts unattractive. |

Blanket memoization, removal of per-event Boards, a worker, or a new state architecture is not supported by these measurements.

### Recommended narrow Phase 2 implementation plan

1. First move orphan cleanup out of `IndexedDbRunRepository.commit`'s awaited publication path, keeping the active session/chunk transaction unchanged. Add repository tests for successful save despite deferred-cleanup failure, eventual orphan removal, replacement/removal, and reload/recovery. Re-run the browser fixture to verify that publication follows the durable transaction rather than cleanup.

2. In a separate change, give `Resolver.emit` an internal, explicit option to reuse the preceding event's already-immutable Board. Apply it only to audited adjacent emission sequences where no state mutation occurs between events; fall back to a fresh snapshot when no prior event exists. Do not add a global cache, serialized equality check, or broad mutation-version system in this pass.

3. For every annotated reuse path, add a test-only shadow check that constructs the legacy fresh snapshot and asserts exact equality. Run it across the full correctness suite, deterministic replay fixtures, all bosses/controllers, shop/round transitions, and curated 1,000-event-cap chains. Also assert event sequence, final state, RNG state, V2 ledger, and playback frames are byte-equivalent. Expand reuse only when another call site is independently proven safe.

4. Benchmark each change independently using this harness. Success criteria should be distribution-based: a material reduction in high-chain Resolver time and snapshot bytes for snapshot reuse, and publication no longer waiting for cleanup in the persistence change. Do not proceed to effect-body optimization unless a fresh profile shows it has become the dominant long task.

This ordering separates a low-mechanics-risk persistence latency change from the higher-integrity snapshot change and makes any replay discrepancy attributable to one optimization.

### Validation of this profiling pass

- Engine stage profile: passed, five deterministic fixtures x 15 samples.
- Production browser profile: passed, five fixtures x two environments x five samples.
- The harness compiled through Playwright and produced both raw JSON artifacts.
- No production gameplay, persistence, scoring, RNG, event ordering, or playback code was modified.

## 16. Phase 2 implementation results (2026-11-14)

### Outcome and production changes

Both measured bottlenecks were addressed without changing gameplay, event payloads, event order, RNG use, scoring, or the durable save boundary.

- `IndexedDbRunRepository.commit` now resolves after the active session and ledger chunks complete their existing atomic read-write transaction. It no longer performs a global orphan scan after every action. See `src/game/runRepository.ts:187-208`.
- Orphan cleanup is coalesced and scheduled through `requestIdleCallback` (with a delayed fallback) at repository initialization, run replacement, and run deletion. Failures are isolated from gameplay and a later lifecycle can retry. See `src/game/runRepository.ts:83-104`, `src/game/runRepository.ts:146-147`, and `src/game/runRepository.ts:208-230`.
- Cleanup now reads live sessions and scans ledger chunks inside one transaction across both stores. This removes the stale-live-set race in which a cleanup could read old sessions, wait behind a new commit, and then delete the new run's chunks. See `src/game/runRepository.ts:58-76`.
- Playback snapshot reuse is opt-in at explicit emission sites through `emitWithPreviousBoard`; ordinary `emit` still constructs a fresh Board. If no previous playback event exists, the mechanism falls back to a fresh snapshot. See `src/game/effects.ts:452-478`.
- The public `GameEvent` format is unchanged: every event still has a complete Board. Reused Boards are already-detached `structuredClone` results, so subsequent authoritative-state mutations cannot modify them.

### Revised persistence-maintenance lifecycle

The active save remains authoritative and ordered as before:

1. Clone the pending chunks and compact session state.
2. Write the active session and all pending chunks in one IndexedDB transaction.
3. Await transaction completion.
4. Advance committed ledger counters and allow `useGame` to publish.

Global orphan maintenance is not part of those steps. Initialization requests one idle cleanup. Replacing a slot with a different run ID and deleting a run request maintenance again. Module-level scheduled/running/requested flags coalesce competing requests and guarantee only one cleanup operation is active. A request arriving during cleanup produces at most one subsequent run. Routine same-run gameplay commits do not request cleanup.

Replacement is crash-safe: the replacement session and chunks become durable together, while old chunks may temporarily remain orphaned until idle maintenance. Cleanup derives the live run IDs and deletes orphaned chunks within one transaction, so it cannot delete chunks belonging to the consistent session snapshot observed by that transaction. Cleanup failure is best-effort and does not change the already-completed active save's status.

### Persistence before/after measurements

The persistence-only after run was captured before snapshot reuse was implemented. Values are median / p95 / worst milliseconds across five production samples. Publication is the first DOM mutation after the last awaited read-write transaction. Durable-write time remains independently visible and is still awaited.

| Environment / fixture | Durable write before | Durable write after | Publication before | Publication after | Median publication improvement |
|---|---:|---:|---:|---:|---:|
| Desktop, Jumping Bean high chain | 10.2 / 10.9 / 10.9 | 8.9 / 10.8 / 10.8 | 73.2 / 75.6 / 75.6 | 70.5 / 83.0 / 83.0 | 3.7%; tail noise |
| 4x CPU, simple Play | 23.5 / 25.3 / 25.3 | 22.9 / 23.5 / 23.5 | 154.6 / 157.7 / 157.7 | 140.9 / 149.4 / 149.4 | 8.9% |
| 4x CPU, multi-Flame Play | 58.9 / 103.2 / 103.2 | 63.2 / 63.5 / 63.5 | 274.4 / 370.6 / 370.6 | 225.7 / 243.6 / 243.6 | 17.7% |
| 4x CPU, Curtain Call | 53.0 / 57.5 / 57.5 | 55.0 / 59.0 / 59.0 | 236.6 / 243.8 / 243.8 | 196.4 / 208.2 / 208.2 | 17.0% |
| 4x CPU, Jumping Bean high chain | 52.9 / 55.5 / 55.5 | 53.6 / 55.5 / 55.5 | 410.5 / 418.6 / 418.6 | 299.2 / 308.4 / 308.4 | 27.1% |
| 4x CPU, boss fixture | 63.2 / 85.7 / 85.7 | 64.2 / 78.0 / 78.0 | 294.9 / 331.4 / 331.4 | 240.8 / 242.5 / 242.5 | 18.3% |

The high-chain durable write was effectively unchanged (52.9 to 53.6 ms median), while publication improved by 111.3 ms. This supports the intended conclusion: recovery durability was preserved and only unrelated maintenance was removed from the publication gate. Desktop cleanup was already inexpensive, so desktop publication changes are small and noisy.

The archived-ledger profile uses an ordinary one-die Manual Reroll after loading 0, 200, or 1,000 empty chunks belonging to the active run. Setup/load time is excluded. Values are median / p95 / worst milliseconds.

| Environment | Archived chunks | Durable write | Publication |
|---|---:|---:|---:|
| Desktop | 0 | 7.2 / 8.1 / 8.1 | 47.2 / 49.3 / 49.3 |
| Desktop | 200 | 7.6 / 7.8 / 7.8 | 48.5 / 49.1 / 49.1 |
| Desktop | 1,000 | 7.4 / 7.9 / 7.9 | 48.2 / 48.5 / 48.5 |
| 4x CPU | 0 | 21.5 / 21.9 / 21.9 | 122.9 / 127.5 / 127.5 |
| 4x CPU | 200 | 22.5 / 23.5 / 23.5 | 127.2 / 133.1 / 133.1 |
| 4x CPU | 1,000 | 22.8 / 23.4 / 23.4 | 129.0 / 136.3 / 136.3 |

Publication remains nearly flat as archived chunks grow because gameplay commits no longer scan them.

### Snapshot reuse and validity rules

Reuse is deliberately local rather than a general cache. `emitWithPreviousBoard` may reuse only the immediately preceding event's detached Board. The audited sites are:

- Golden's `GOLD_ADDED` to its immediately following special-die presentation.
- Completed per-die Pips presentation and the following hand-Mult presentation, where intervening changes are accumulator/history data excluded from Board.
- Flame trigger to its immediately following XMult or Charge presentation.
- Subsequent base-roll events after all physical results are committed; any intervening roll reaction either does not change Board or emits its own fresh current snapshot.
- Jumping Bean's Free Play presentation to its immediate hand/opening-roll presentation.
- The finalized hand-score presentation after the previous scoring presentation, where intervening changes are stats/history rather than Board fields.

No reusable reference survives past the immediately preceding event, and sites that cannot prove the absence of an intervening presentation-relevant mutation retain ordinary fresh cloning. `disableSnapshotReuse` provides the legacy path, and `verifySnapshotReuse` constructs a shadow fresh snapshot and requires exact serialized equality at every optimized site (`src/game/effects.ts:97-99`, `src/game/effects.ts:461-470`).

### Snapshot before/after measurements

Values are median / p95 / worst milliseconds across 15 samples. The before and after rows are generated in the same harness run from identical states; the before path explicitly disables reuse.

| Fixture | Events | Dispatch before | Dispatch after | Snapshot clone before | Snapshot clone after | Constructed / reused after | Median dispatch improvement |
|---|---:|---:|---:|---:|---:|---:|---:|
| Simple Play | 8 | 2.09 / 2.91 / 2.91 | 1.21 / 1.95 / 1.95 | 0.46 / 0.63 / 0.63 | 0.28 / 0.38 / 0.38 | 5 / 3 | 42.1% |
| Ordinary Manual Reroll | 3 | 1.00 / 1.81 / 1.81 | 0.74 / 1.40 / 1.40 | 0.16 / 0.22 / 0.22 | 0.16 / 0.25 / 0.25 | 3 / 0 | no attributable clone gain |
| Multi-Flame special-die Play | 61 | 10.33 / 14.44 / 14.44 | 6.76 / 8.02 / 8.02 | 7.21 / 9.36 / 9.36 | 3.68 / 4.65 / 4.65 | 35 / 26 | 34.6% |
| Curtain Call / Free Play | 25 | 4.43 / 5.40 / 5.40 | 2.99 / 4.23 / 4.23 | 1.82 / 2.56 / 2.56 | 1.15 / 2.16 / 2.16 | 16 / 9 | 32.6% |
| Jumping Bean ~70 events | 72 | 10.23 / 13.62 / 13.62 | 7.31 / 7.76 / 7.76 | 5.27 / 6.03 / 6.03 | 2.94 / 3.67 / 3.67 | 39 / 33 | 28.5% |
| Jumping Bean ~200 events | 210 | 30.66 / 38.36 / 38.36 | 22.02 / 24.14 / 24.14 | 17.61 / 19.17 / 19.17 | 9.43 / 10.71 / 10.71 | 111 / 99 | 28.2% |
| Jumping Bean 400+ events | 454 | 75.21 / 101.76 / 101.76 | 53.64 / 66.77 / 66.77 | 50.56 / 65.29 / 65.29 | 27.58 / 33.00 / 33.00 | 237 / 217 | 28.7% |
| Juggler + multi-Flame Play | 25 | 4.32 / 6.31 / 6.31 | 3.31 / 4.27 / 4.27 | 2.69 / 3.65 / 3.65 | 1.83 / 2.63 / 2.63 | 15 / 10 | 23.2% |

For the 454-event chain, distinct runtime Board references fell from 454 to 237 (47.8%), and median snapshot cloning fell 45.5%. The exact serialized public event payload remains 5,248,455 bytes before and after because each event still serializes a complete Board. Ledger construction was also intentionally unchanged (2.01 ms before versus 2.24 ms after median in this noisy sample), and playback Boards are not part of V2 ledger chunks. No storage-size reduction is claimed.

Forced-GC browser heap measurements after optimization retained 3.72 MB desktop and 4.04 MB under 4x throttling for the 454-event fixture. There is no identically configured pre-change browser heap sample, so reference-count reduction is the supported allocation result; a browser heap percentage improvement is not claimed.

### Final production-browser scaling

The deterministic Jumping Bean fixtures use invariant faces so the same 72, 210, and 454 events resolve in engine and browser paths. Final median production results were:

| Environment | Events | Publication | Chrome task | Chrome script | Largest long task | Retained heap |
|---|---:|---:|---:|---:|---:|---:|
| Desktop | 72 | 68.2 ms | 76.3 ms | 32.4 ms | none | 0.92 MB |
| Desktop | 210 | 80.0 ms | 98.8 ms | 43.3 ms | none | 1.83 MB |
| Desktop | 454 | 101.6 ms | 144.0 ms | 70.2 ms | 54 ms | 3.72 MB |
| 4x CPU | 72 | 215.0 ms | 369.0 ms | 161.5 ms | 106 ms | 0.82 MB |
| 4x CPU | 210 | 284.2 ms | 464.7 ms | 233.6 ms | 177 ms | 1.75 MB |
| 4x CPU | 454 | 405.2 ms | 641.6 ms | 351.8 ms | 293 ms | 4.04 MB |

These task windows include React publication, playback initialization, browser rendering, persistence, and a fixed observation interval. The paired direct-engine measurements above isolate snapshot improvement. A comparison between the persistence-only browser run and final run was noisy on throttled medium fixtures, so no additional browser percentage is claimed for snapshot reuse.

### Playback and persistence equivalence evidence

`src/game/snapshotReuse.test.ts` runs optimized and legacy snapshot modes from identical deterministic fixtures covering multi-Flame scoring, special dice, Curtain Call, generated Free Plays, a large Jumping Bean chain, Juggler, and Round starts. It asserts:

- exact event payload and ordering equality;
- exact Board content through the shadow fresh-snapshot check;
- exact final authoritative state, RNG state, and ledger chunk;
- preservation of shared references through whole-event `structuredClone`;
- no change to emitted Boards after later authoritative-state mutation.

The full browser suite additionally covers normal/fast/instant playback, scoring feedback, boss transitions, rerolls, Round transitions, save/reload, and tutorial-authored Board adjustments.

`tests/persistenceMaintenance.spec.ts` uses real IndexedDB to verify:

- an aborted active transaction leaves no partial session or chunks and does not advance committed counters;
- deferred cleanup failure neither removes the live run nor blocks later recovery;
- a later lifecycle removes abandoned chunks;
- competing repository maintenance requests coalesce;
- replacement preserves and reloads the new run before old chunks are removed;
- explicit run deletion removes the session and its chunks.

### Artifacts

- `docs/gameplay-performance-audit/phase2-persistence-before.json`
- `docs/gameplay-performance-audit/phase2-persistence-after.json`
- `docs/gameplay-performance-audit/phase2-snapshot-before.json`
- `docs/gameplay-performance-audit/phase2-snapshot-after.json`
- `docs/gameplay-performance-audit/phase2-engine-stages.json` (optimized alias)
- `docs/gameplay-performance-audit/phase2-browser-stages.json`
- `docs/gameplay-performance-audit/phase2-persistence-scaling.json`

### Validation

- Focused snapshot/effect/playback/persistence/tutorial tests: 96 passed.
- Full unit and integration suite: 77 files, 836 tests passed.
- Full Playwright browser suite: 163 tests passed.
- Phase 2 profiling suite: three profiles passed; corrected final engine/browser rerun: two profiles passed.
- TypeScript typecheck: passed.
- Production build: passed. The existing large-chunk warning remains.

### Remaining risks

- Snapshot cloning is still the largest single direct-engine bucket in the 454-event fixture at 27.58 ms median. Another 237 fresh snapshots remain; further reuse should be added only after separately auditing and shadow-verifying each site.
- A 454-event chain still produces a 293 ms median largest long task under 4x throttling. The remaining Resolver effect body, React publication/playback setup, and browser rendering now merit a fresh profile before any further change.
- Idle orphan cleanup still scans the global ledger store when it runs. It is no longer player-blocking or per-action, but very large installations may benefit from bounded/indexed maintenance in a later pass if idle traces demonstrate a problem.
- Snapshot sharing assumes playback consumers treat Boards as immutable. Existing tutorial code performs controlled field patching; the complete tutorial/browser suite passes because those patches are consistent across the shared snapshots it touches. Future code should continue avoiding in-place mutation of emitted playback Boards.
