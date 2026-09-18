# Sustainable probability audit

Sustainable previously used `Face.sustainableUsedThisRound` as per-physical-face, per-round runtime state. A successful activation marked one selected face spent, the UI dimmed its badge, telemetry stored a `sustainableActivations` record, and `startRound` reset all spent flags.

That model has been removed. Faces now contain only their rank, persistent Workout pips, and enhancement stack counts. There is no Sustainable spent field in the domain, snapshots, events, UI, debug export, telemetry, or round reset path.

After the complete hand accumulator finalizes and awards its score, `Resolver.play` sums Sustainable stacks from selected participating face snapshots only. Unselected matching faces and Hitchhiker-only contributors are excluded. A positive total produces exactly one check through the centralized seeded RNG with probability `1 − 0.5^stacks`. Success preserves the category; failure consumes it. The same face can make another independent check later in the same round.

`ABILITY_CHECKED` is history-only audit feedback for both outcomes and includes the participating die IDs, hand, stack total, chance, and result. Successful non-winning checks additionally emit the normal visible `ABILITY_TRIGGERED` event. Winning hands still perform the check for deterministic history and telemetry, but successful playback is suppressed because category availability no longer matters after clearance. Post-hand rerolls remain skipped on a winning hand.

`stats.probabilityProcs.sustainable` records checks, successes, failures, and the stack count used by each check. `stats.triggers.sustainable` continues to count successful activations. The exported schema is version 4.

Unit coverage verifies the formula directly, one-stack success and failure, combined participating stacks, unselected/Hitchhiker exclusion, repeated same-round success, failure after prior success, independent Sticky/Sustainable draws, absence of reset state, winning-hand behavior, and seeded reproducibility. Browser coverage reaches Sticky + Sustainable through real seeded actions, demonstrates two successful uses in one round, and verifies that no spent presentation exists.
