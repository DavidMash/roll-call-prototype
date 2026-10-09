# Run History V2 — Pass 2 semantics

## Experienced and canonical data

Experienced metrics reduce every V2 event, including events inside ranges later identified by `checkpoint_restored` as
abandoned. They describe what the player saw or did: attempts, Busts, offers, hands, checks, activations, Shop actions,
Boss attempts, and largest hands.

Canonical metrics describe the retained run. Final build, Gold, Lives, hand levels, inventory, purchases, training,
Embers, Bonfires, Wildfires, and canonical economy totals come from the retained `GameState`/`RunStats` snapshot.
They are not reconstructed by subtracting events or parsing text.

`classifyRunHistoryV2Timelines` marks the inclusive abandoned sequence ranges declared by each rollback event. The
normal history keeps those events visible but labels them `ROLLED BACK`. `checkpoint_restored` itself belongs to the
new canonical timeline.

## Partial histories

New runs store complete coverage metadata. Pass 1 saves containing `run_started` normalize as complete. Older saves
without a V2 stream normalize as partial, recording the first Round and action available after migration. Exports warn
that experienced totals cover only that interval. Legacy prose is never parsed to backfill V2.

## Debug Trace

Normal mode retains at most 256 ordinary records and 64 KiB of serialized ordinary records. It reports dropped count
and first available sequence. Errors, invariant failures, checkpoint restores, persistence failures, and the mutable
truncation diagnostic live outside the ring and are not evicted.

Full trace mode is selected before starting/restarting a reproduction with `?debugTrace=full`. It is intentionally
unbounded and remains separate from playback events and playback Board snapshots.

## Legacy systems retained for Pass 3

- Legacy `history` is still generated for old saves, parity checks, remaining characterization tests, and checkpoint
  work.
- `RunStats` remains authoritative for retained canonical economy/build aggregates and specialist telemetry not yet
  represented fully in V2.
- Existing gameplay checkpoints remain intact. V2 history and Debug Trace use the existing preserve-across-restore
  pattern; RollbackState/checkpoint ownership is deferred to Pass 3.
- Playback events and their Board snapshots are unchanged.
