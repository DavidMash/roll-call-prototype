# Scoring architecture audit

The deterministic resolver owns all rolls, hand plays, effects, RNG, history, and round transitions. React only replays immutable event snapshots, so playback speed cannot affect outcomes.

## Hand pipeline

Every manual or Jumping Bean hand creates one `HandScoreAccumulator` from the category's trained level. Scoring uses:

```text
round(scoring-die Pips × trained Hand Mult × product(XMult factors) × Inferno)
```

Ordinary Mult comes only from the trained hand. Workout growth happens after its current face contribution. Successful manual Hitchhikers add Pips but never help form the selected shape. Golden resolves for every scoring face. Jackpot resolves only for scoring faces after that score is known to clear the round.

The final rounded award is written once to the round total and category total. XMult factors retain their source and are multiplied canonically. A non-visible rounding audit preserves full-precision inputs.

## Jumping Bean

Jumping Bean uses the same hand pipeline with source `jumpingBean`. Rank 1–6 maps to Ones–Sixes and only the triggering die scores. The free play neither requires nor consumes normal category availability, does not run Hitchhiker or generic post-hand rerolls, and does not consume armed Charge. It does increment run-wide hand history after factors that use the previous-play snapshot have evaluated.

If the free play does not clear the round, Sticky may prevent its one follow-up reroll. Otherwise that die passes through the centralized gameplay roll pipeline, preserving Bump, held-anchor Magnetic, Weighted, Third Rail generation, and deterministic Bean chaining. The free-played hand also qualifies for Momentum and Power Surge.

## Telemetry

Current Run History V2 uses the `dice-pips-hand-mult-v1` ruleset. Hand records include ordered resolved per-die Pips, Hand Mult, XMult, Inferno, play source, and consumption semantics. Every Flame XMult contribution is an `XMultFactor`; Jumping Bean remains a categorized Free Play rather than Effect Score.
