# Run History V2 — Pass 1 derivation status

Run History V2 is a parallel, non-authoritative stream in this pass. Legacy `history`, `RunStats`, playback events,
clipboard exports, the History UI, and checkpoint persistence remain authoritative.

## Fully derivable from V2

- schema, ruleset, seed, and finished-run outcome;
- final Chapter/Round and finished-run Boss;
- experienced Round attempts, clears, Busts by Chapter, Lives lost, and Lives restored;
- largest hand, highest cleared-Round score, hand usage, and score by hand;
- highest observed hand level and finished-run final hand levels;
- Gold earned/spent by source/category;
- Enhancement offer impressions and purchases by rarity;
- training purchase count/spend, Vintage sale revenue, and Shop reroll spend;
- Flame acquisition/replacement/stoke/Bonfire/Wildfire timeline and scoring activation counts;
- Charge gains, arming, consumption, and resets where emitted;
- selected Special Offers, Hooded lifecycle outcomes, and basic Boss encounter outcomes.

The Pass 1 reducer reports experienced activity. `timelineId` and `checkpoint_restored` events preserve enough
information to identify abandoned Bust, Bad Dream, and Time Travel timelines, but canonical-only reduction is deferred.

## Still dependent on RunStats or current board state

- authoritative active-run final hand levels after non-training level changes such as Focus; finished runs include a final snapshot;
- detailed standalone/Boss score attribution;
- full Caller, Warden, and Hexer analysis fields beyond the basic structured Boss events;
- probability stack distributions and decision-time distributions;
- continuous Hooded challenge progress values between lifecycle milestones;
- legacy failed-attempt aggregate semantics and canonical-versus-experienced reconciliation;
- exact current inventory/loadout summaries while a run is still active.

These gaps are intentional for Pass 1. Filling them should happen by adding focused V2 fields/events, not by making the
new reducer parse legacy messages or by replacing `RunStats` prematurely.

