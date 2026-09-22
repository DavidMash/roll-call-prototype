# Scoring architecture audit

The deterministic resolver owns all rolls, hand plays, effects, RNG, history, and round transitions. React only replays immutable event snapshots, so playback speed cannot affect outcomes.

## Hand pipeline

Every manual or Jumping Bean hand creates one `HandScoreAccumulator` from the category's trained level. Scoring uses:

```text
round((trained Base Pips + scoring-die Pips + Bonus) × trained Base Mult × product(XMult factors))
```

Ordinary Mult comes only from the trained hand. Workout growth happens after its current face contribution. Successful manual Hitchhikers add Pips but never help form the selected shape. Golden resolves for every scoring face. Jackpot resolves only for scoring faces after that score is known to clear the round.

The final rounded award is written once to the round total and category total. XMult factors retain their source and are multiplied canonically. A non-visible rounding audit preserves full-precision inputs.

## Jumping Bean

Jumping Bean uses the same hand pipeline with source `jumpingBean`. Rank 1–6 maps to Ones–Sixes and only the triggering die scores. The free play neither requires nor consumes normal category availability, does not run Hitchhiker or generic post-hand rerolls, and does not consume armed Charge. It does increment run-wide hand history after factors that use the previous-play snapshot have evaluated.

If the free play does not clear the round, Sticky may prevent its one follow-up reroll. Otherwise that die passes through the centralized gameplay roll pipeline, preserving Bump, held-anchor Magnetic, Weighted, Charge gain, and deterministic Bean chaining.

## Telemetry

Export schema 12 uses `multiplicative-flames-v2`. Hand records include play source and consumption semantics. Every Flame XMult contribution is an `XMultFactor` and the accumulator recomputes the canonical product after each factor; event playback reports `prior XMult × factor = result`. Stoke records identify `flame_reward` versus `shop`, the previous and resulting investment, amount, Flame, die, and round. Bean records include category, scoring die, trained Base Pips/Mult, score, XMult factors, history before/after, Sticky/follow-up outcome, round clearance, and Jackpot payout. Jumping Bean does not add Effect Score or standalone-score records.
