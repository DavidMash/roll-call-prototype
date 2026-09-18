# Hand-scoring audit

The audit traced `Resolver.play`, `handScore`, `standaloneScore`, `scoringPips`, `whenScored`, and the event playback component before changing behavior.

| Stage | Previous behavior | Current behavior |
| --- | --- | --- |
| Hand Base Pips | No intrinsic hand pips | The hand's current trained level supplies derived Base Pips when its accumulator is created; this is not a face-scoring event |
| Selected base pips | Collected by `handScore` from printed rank, prior Workout growth, and Bonus | Captured face snapshots contribute printed rank and prior Workout growth into the live hand accumulator |
| Bonus | Already included before multiplication; never a separate score addition | Explicit pip contribution before finalization; Hitchhiker Bonus is included in its contribution |
| Selected Multiplier | Already included before multiplication | Explicit increment to the live hand multiplier |
| Hitchhiker | After awarding selected-hand score, each unselected Hitchhiker scored separately with its own Bonus and Multiplier | Adds full scoring pips to the active hand; its own Multiplier is ignored |
| Golden | Triggered after the selected or standalone score was added | Selected and Hitchhiker Golden resolve before hand finalization; independent Bean timing remains unchanged |
| Workout | Used old pips, then grew after the selected or standalone score was added | Current contributions use old pips, then grow before hand finalization; independent Bean timing remains unchanged |
| Final hand score | `HAND_SCORE_CALCULATED`, then immediate `SCORE_ADDED`, before Golden/Workout/Hitchhiker | `HAND_SCORE_FINALIZED` after every hand-bound contribution and trigger; one shared finalizer records raw Pips × Mult, rounds it once, then exactly one hand `SCORE_ADDED` awards the integer |
| Consumption and rerolls | Post-hand rolls and effects finished before consumption | Consume after final hand award, check target, then reroll only if below target |

The suspected early finalization existed for Hitchhiker and hand-bound trigger timing. Selected Bonus and Multiplier arithmetic was already correct. For 12 selected pips at x2 with an unselected 6-pip Hitchhiker, the previous score was 24 + 6 = 30; the current score is (12 + 6) × 2 = 36.

## Domain boundary and snapshots

`HandScoreAccumulator` holds the selected category/physical IDs, level-derived `basePips`/`baseMultiplier`, live `currentPips`/`currentMultiplier`, Bonus pips, Hitchhiker pips, and nullable raw/final results. It is initialized from the hand's authoritative level before face contributions. Pure contribution helpers are shared by score previews and resolution. Capturing all faces before contributions prevents current Workout increments from changing the current score.

Every event emitted while the accumulator is active carries an immutable `handScore` snapshot, including Golden/Workout ticks. `HAND_PIPS_CHANGED`, `HAND_MULTIPLIER_CHANGED`, and `HITCHHIKER_ADDED_PIPS` expose changes directly. `HAND_SCORE_FINALIZED` exposes the multiplication result while round score is still unchanged; the following hand `SCORE_ADDED` awards it once.

The accumulator closes before consumption or any rerolls. `STANDALONE_SCORE_CALCULATED` identifies independent Jumping Bean arithmetic. No roll-trigger chain can feed back into a finalized hand. Hand and standalone scoring both call the same `finalizeScore` helper: full Pips and Mult precision produce `rawScore`, then `Math.round(rawScore)` produces the one authoritative integer award. A non-visible `SCORE_ROUNDING_AUDIT` history entry preserves both values without putting the raw decimal in prominent playback.

Later playtesting added Pair/Two Pair and updated lower multipliers in centralized configuration. Both hands use this same accumulator. A winning hand now checks its target after finalization and consumption bookkeeping, emits `POST_HAND_REROLLS_SKIPPED`, and clears without scheduling normal/Slippy gameplay rerolls. All hand-bound Golden/Workout/Hitchhiker effects have already finished. Existing independent initial/manual/active Bean chains still finish before clearance. The free shop exposure roll remains separate and occurs after `ROUND_CLEARED`.

## Telemetry compatibility

Export schema 7 declares `scoringModel: rounded-score-accumulator-v4`. Final rounded hand score is attributed to the selected category and `scoreBySource.hand`. `handScores` records Base Pips/Base Multiplier, raw and rounded final arithmetic, and Bonus/Hitchhiker pip contributions; `handBonusPips` and `hitchhikerPipsContributed` record run totals. Each round also records integer `scoreByHand` and `effectScore`, matching the authoritative current-round board breakdown used by the scorecard. Bonus pips include Bonus carried by Hitchhikers.

`scoreBySource.hitchhiker` remains a legacy key at zero for current runs, preventing score double-counting. Schema 1 exports used that field for standalone Hitchhiker score, including the Hitchhiker face's own multiplier. Existing historical exports are not rewritten; replay requires the matching rules version.

## Validation coverage

Engine tests assert below-half, exact-half, above-half, and exact-integer rounding; unchanged round score during accumulation; immutable event snapshots; Bonus/Multiplier/Hitchhiker ordering; per-play Sustainable rounding; rounded target crossing; independent Bean rounding; telemetry totals; and deterministic replay.

Browser fixtures reach enhanced and trained boards through seeded legal plays and shop purchases. A controlled playback clock checks literal Pips, fractional Mult, the whole-number final award, integer scorecard/round totals, and the single award in order using the existing playback system. No production fixture hooks or alternate scoring engine were added.
