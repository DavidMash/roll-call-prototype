# Run History V2 Pass 3 ownership

This document records the field audit used for Pass 3. It is an ownership map, not a new balance or gameplay specification.

## Durable owners

| Concern | Authoritative owner | Rollback behavior |
| --- | --- | --- |
| Current playable run | `GameState` / `Board` | Restored from `RollbackState` |
| Experienced and canonical history | `historyV2` | Append-only; never restored |
| Rollback gameplay | `RollbackState` (`board`, `rngState`, `nextOfferId`) | Snapshot itself is replaced, never nested |
| Deterministic player actions | `actionJournal` | Durable and never restored |
| Ordinary diagnostics | bounded `DebugTrace` | Not persisted or checkpointed |
| Critical diagnostics | `DebugTrace.critical` | Persisted once; not checkpointed |
| Playback animation | transient resolution events and Board snapshots | Unchanged; never checkpointed |
| Human text | V2 renderer | Generated on demand; never persisted |
| Summary | V2 experienced/canonical reducers plus final `GameState` | Derived on demand |

## `RunStats` inventory

### Removed because V2 or canonical state is authoritative

- `actions` moved to the top-level `actionJournal`.
- `handsPlayed`, `scoreByHand`, `flameSkips`, `bonfiresCreated`, `xMultFactorsByFlame`, `targetPracticeTargets`, `lowballAverages`, and `roundSummaries` were removed. Their history is represented by V2; current score/hand counts already live on `Board`.
- Historical arrays `purchases`, `sales`, `busts`, `mapTransitions`, `lifeRestores`, `vintageGrowth`, `trainingPurchases`, `flameAcquisitions`, `flameStokes`, `handScores`, `jumpingBeanFreePlays`, and `loss` remain available during a live process for compatibility/specialist tooling, but are cleared in current-format saves. V2 is their durable owner.

### Canonical current-state data owned by `GameState`

- Final Gold, Lives, hand levels, hand play counts, score by hand, Enhancements, current Embers, Bonfires, Wildfires, sacrificed Flames, Shop state, Boss state, Charge state, Hooded state, and current Round state come from `Board`.
- `lifetimeNormalShopGoldSpent` on `Board` is the gameplay value. The older RunStats counter remains compatibility telemetry only.

### Intentionally retained specialist telemetry

- `rounds`: current-round engine bookkeeping plus decision-time and per-round diagnostic distributions.
- `bossEncounters`, `callerEvents`, `wardenEvents`, `hexerEvents`: detailed encounter diagnostics not fully represented by current V2 boss events.
- `manualRerolls`: decision-time detail; V2 owns the roll result and spend.
- `standaloneScores`: fine-grained non-hand/Boss score attribution.
- `hotStreakSkippedHands`, `enhancedFaces`, and aggregate trigger counters: compact specialist distributions used by balance/debug tooling.
- `resolutionError`: current error state surfaced by the UI.
- Gold source/spend counters and the current `RoundStats` baseline remain persisted because current-round payout delta calculation uses them during resume.

Other scalar counters in `RunStats` are deliberately retained as small specialist aggregates while remaining summary-independent. They do not duplicate large event arrays. The normal Run Summary does not read RunStats for experienced or canonical historical metrics.

## Legacy compatibility

Schema-v2 and pre-V2 saves are normalized before validation. Broad legacy checkpoints are projected into `RollbackState`; legacy action arrays move to `actionJournal`; missing V2 coverage is marked partial. Legacy prose is accepted only for resume and is never parsed into V2. New actions write only V2, and the next schema-v3 save discards legacy prose.
