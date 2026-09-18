# Sustainable usage audit

Previously `Resolver.play` checked whether any selected face had Sustainable, triggered every selected Sustainable face, and skipped consumption without tracking usage. Sticky could leave a single upper-hand die unchanged, so that category could be played indefinitely.

`Face.sustainableUsedThisRound` now stores runtime usage on each physical die's physical face. Enhancement presence, stacking eligibility, cost, and scoring values are unchanged. Rolls and flips change only the active rank, so returning to a previously used face cannot restore its charge. `startRound` resets all 30 physical faces before `ROUND_STARTED` and the initial gameplay roll; opening or rerolling the shop does not reset them.

After the complete hand accumulator finalizes and awards its single score, participants are inspected in ascending physical-die order. The first selected Sustainable face with an unspent charge preserves the hand, becomes spent, and records one successful trigger. Other charges stay available; spent selected faces and all unselected faces, including Hitchhikers, are ignored. If no charge qualifies, the hand is consumed normally.

The existing `ABILITY_TRIGGERED` event provides the physical die, face, selected hand, `sustainableSpent: true`, and an immutable board snapshot with the spent flag. Its readable message states that consumption was prevented and the face is now spent for the round. This uses the existing ability feedback and playback infrastructure. The exposed Sustainable badge dims and adds “spent” during gameplay; the face inspector labels spent charges. Shop badges and face details show the enhancement normally.

Winning hands use the same bookkeeping before the existing target check. They still clear without creating a post-hand gameplay reroll batch. Initial/manual/active independent roll chains keep their existing completion boundaries.

Existing `stats.triggers.sustainable` now counts only successful finite activations. The additive `sustainableActivations` record list contains round, physical die, physical face, and selected hand, allowing per-round counts and distinct face counts without double-counting score or removing telemetry fields.

Unit coverage reproduces the exploit, verifies rejection of a third play, tests Pair/Two Pair, multiple charges and reversed caller ordering, different faces on one die, unselected Hitchhiker exclusion, manual/Magnetic persistence, shop persistence, round reset, winning-hand event ordering, and seeded reproducibility. The browser reproduction reaches Sticky + Sustainable through actual seeded plays and purchases, verifies normal ability playback and spent badge feedback, then confirms consumption on the second play. No production fixture hooks or component-level rule workaround were added.
